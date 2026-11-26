import { and, asc, count, eq, exists, inArray, notExists, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { labels, messageLabels, messages } from "@/db/schema";
import { isLabelMailboxMismatchError, isUniqueConstraintError } from "@/lib/database-errors";
import { draftsVisibleTo } from "@/lib/email/draft-access";
import { selectInBatches } from "@/lib/db-params";
import { newId } from "@/lib/ids";
import { chunk, groupPairsByLabel, LABEL_PAIR_CHUNK, uniquePairs } from "./label-utils";
import type { LabelDeleteResult, LabelPair, LabelRecord } from "./types";

/** Memberships removed per statement while deleting a label; each row fires the change-log triggers. */
export const LABEL_DELETE_BATCH = 500;
/** Statements one deletion call may run before it reports `done: false` and the caller asks again. */
export const LABEL_DELETE_MAX_BATCHES = 10;

export class LabelError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "LabelError";
	}
}

const labelColumns = {
	id: labels.id,
	userId: labels.userId,
	mailboxId: labels.mailboxId,
	name: labels.name,
	color: labels.color,
	createdAt: labels.createdAt,
};

/** The labels of these mailboxes, by name. */
export async function listLabels(db: AppDatabase, mailboxIds: readonly string[]): Promise<LabelRecord[]> {
	const rows = await selectInBatches(mailboxIds, (batch) => db.select(labelColumns).from(labels).where(inArray(labels.mailboxId, batch)));
	return rows.sort((left, right) => left.name.localeCompare(right.name) || left.mailboxId.localeCompare(right.mailboxId));
}

export async function getLabel(db: AppDatabase, labelId: string): Promise<LabelRecord | null> {
	const [row] = await db.select(labelColumns).from(labels).where(eq(labels.id, labelId)).limit(1);
	return row ?? null;
}

export async function loadLabels(db: AppDatabase, labelIds: readonly string[]): Promise<Map<string, LabelRecord>> {
	const rows = await selectInBatches(labelIds, (batch) => db.select(labelColumns).from(labels).where(inArray(labels.id, batch)));
	return new Map(rows.map((row) => [row.id, row]));
}

/**
 * For each mailbox, its label named like `label` (the label itself in its own mailbox). Mailboxes without one
 * are absent. Lets one "Label as" choice apply across a unified selection.
 */
export async function loadSameNamedLabels(db: AppDatabase, label: LabelRecord, mailboxIds: readonly string[]): Promise<Map<string, LabelRecord>> {
	const others = [...new Set(mailboxIds)].filter((id) => id !== label.mailboxId);
	const rows = await selectInBatches(others, (batch) => db.select(labelColumns).from(labels).where(and(eq(labels.name, label.name), inArray(labels.mailboxId, batch))));
	return new Map([[label.mailboxId, label], ...rows.map((row) => [row.mailboxId, row] as const)]);
}

export async function createLabel(
	db: AppDatabase,
	input: { userId: string; mailboxId: string; name: string; color: string },
): Promise<LabelRecord> {
	const record: LabelRecord = { id: newId("lbl"), userId: input.userId, mailboxId: input.mailboxId, name: input.name, color: input.color, createdAt: new Date(Math.floor(Date.now() / 1000) * 1000) };
	try {
		await db.insert(labels).values(record);
	} catch (error) {
		if (isUniqueConstraintError(error)) throw new LabelError("A label with that name already exists", 409);
		throw error;
	}
	return record;
}

export async function updateLabel(
	db: AppDatabase,
	label: LabelRecord,
	patch: { name?: string; color?: string },
): Promise<LabelRecord> {
	const values: { name?: string; color?: string } = {};
	if (patch.name !== undefined && patch.name !== label.name) values.name = patch.name;
	if (patch.color !== undefined && patch.color !== label.color) values.color = patch.color;
	if (Object.keys(values).length === 0) return label;
	try {
		await db.update(labels).set(values).where(eq(labels.id, label.id));
	} catch (error) {
		if (isUniqueConstraintError(error)) throw new LabelError("A label with that name already exists", 409);
		throw error;
	}
	return { ...label, ...values };
}

/**
 * Deletes a label in bounded steps: every membership row fires the change-log triggers, so a large
 * label is emptied a batch at a time and the label row goes only once nothing references it. A call
 * that runs out of batches returns `done: false`; calling again continues.
 */
export async function deleteLabel(db: AppDatabase, labelId: string, maxBatches = LABEL_DELETE_MAX_BATCHES): Promise<LabelDeleteResult> {
	let removed = 0;
	for (let batch = 0; batch < maxBatches; batch++) {
		const deleted = await db
			.delete(messageLabels)
			.where(sql`${messageLabels.labelId} = ${labelId} AND rowid IN (SELECT rowid FROM ${messageLabels} WHERE ${messageLabels.labelId} = ${labelId} LIMIT ${sql.raw(String(LABEL_DELETE_BATCH))})`)
			.returning({ messageId: messageLabels.messageId });
		removed += deleted.length;
		if (deleted.length < LABEL_DELETE_BATCH) {
			await db.delete(labels).where(eq(labels.id, labelId));
			return { done: true, removed };
		}
	}
	return { done: false, removed };
}

/**
 * Adds memberships, idempotently, and returns the pairs that were new. The caller has checked that
 * each label belongs to its message's mailbox; a trigger refuses any pair that does not.
 */
export async function addMessageLabels(db: AppDatabase, pairs: readonly LabelPair[]): Promise<LabelPair[]> {
	const added: LabelPair[] = [];
	for (const part of chunk(uniquePairs(pairs), LABEL_PAIR_CHUNK)) {
		try {
			const rows = await db
				.insert(messageLabels)
				.values(part.map((pair) => ({ messageId: pair.messageId, labelId: pair.labelId })))
				.onConflictDoNothing()
				.returning({ messageId: messageLabels.messageId, labelId: messageLabels.labelId });
			added.push(...rows);
		} catch (error) {
			if (isLabelMailboxMismatchError(error)) {
				throw new LabelError("A label can only be applied to mail in its own mailbox", 400);
			}
			throw error;
		}
	}
	return added;
}

/** Removes memberships and returns the pairs that existed. */
export async function removeMessageLabels(db: AppDatabase, pairs: readonly LabelPair[]): Promise<LabelPair[]> {
	const removed: LabelPair[] = [];
	for (const [labelId, messageIds] of groupPairsByLabel(pairs)) {
		for (const part of chunk(messageIds, LABEL_PAIR_CHUNK)) {
			const rows = await db
				.delete(messageLabels)
				.where(and(eq(messageLabels.labelId, labelId), inArray(messageLabels.messageId, part)))
				.returning({ messageId: messageLabels.messageId, labelId: messageLabels.labelId });
			removed.push(...rows);
		}
	}
	return removed;
}

/** Label ids per message, oldest membership first; messages without labels are absent. */
export async function loadMessageLabelIds(db: AppDatabase, messageIds: readonly string[]): Promise<Map<string, string[]>> {
	const rows = await selectInBatches(messageIds, (batch) => db
		.select({ messageId: messageLabels.messageId, labelId: messageLabels.labelId })
		.from(messageLabels)
		.where(inArray(messageLabels.messageId, batch))
		.orderBy(asc(messageLabels.messageId), asc(messageLabels.createdAt), asc(messageLabels.labelId)));
	const result = new Map<string, string[]>();
	for (const row of rows) {
		const list = result.get(row.messageId) ?? [];
		list.push(row.labelId);
		result.set(row.messageId, list);
	}
	return result;
}

/**
 * Messages per label as its view lists them (no Trash or Spam, others' drafts hidden), with the
 * unread received ones; labels without messages are absent.
 */
export async function countLabelMessages(
	db: AppDatabase,
	mailboxIds: readonly string[],
	userId: string,
): Promise<Record<string, { total: number; unread: number }>> {
	const rows = await selectInBatches(mailboxIds, (batch) => db
		.select({
			labelId: messageLabels.labelId,
			total: count(),
			unread: sql<number>`sum(case when ${messages.direction} = 'inbound' and not ${messages.read} then 1 else 0 end)`,
		})
		.from(messageLabels)
		.innerJoin(labels, eq(labels.id, messageLabels.labelId))
		.innerJoin(messages, eq(messages.id, messageLabels.messageId))
		.where(and(inArray(labels.mailboxId, batch), labelViewStatusCondition, draftsVisibleTo(userId)))
		.groupBy(messageLabels.labelId));
	const counts: Record<string, { total: number; unread: number }> = {};
	for (const row of rows) counts[row.labelId] = { total: Number(row.total) || 0, unread: Number(row.unread) || 0 };
	return counts;
}

/**
 * `messages` rows carrying the label, or any of several (same-named labels of different mailboxes, grouped in the
 * unified sidebar). A list binds one parameter, a JSON array read with `json_each`, so its length never counts
 * against D1's 100 bound parameters.
 */
export function hasLabelCondition(labelIds: string | readonly string[]): SQL {
	const ids = typeof labelIds === "string" ? [labelIds] : [...new Set(labelIds)];
	if (ids.length === 1) {
		return exists(sql`(SELECT 1 FROM ${messageLabels} WHERE ${messageLabels.messageId} = ${messages.id} AND ${messageLabels.labelId} = ${ids[0]})`);
	}
	return exists(sql`(SELECT 1 FROM ${messageLabels} WHERE ${messageLabels.messageId} = ${messages.id} AND ${messageLabels.labelId} IN (SELECT value FROM json_each(${JSON.stringify(ids)})))`);
}

/** `messages` rows carrying no label at all: what the user has not curated. */
export function unlabelledCondition(): SQL {
	return notExists(sql`(SELECT 1 FROM ${messageLabels} WHERE ${messageLabels.messageId} = ${messages.id})`);
}

/**
 * What a label view lists besides the label itself: every direction, nothing in Trash or Spam
 * (composer templates are never listed). Literal SQL: the statuses are fixed values.
 */
export const labelViewStatusCondition: SQL = sql`${messages.status} NOT IN ('trash', 'spam', 'template')`;
