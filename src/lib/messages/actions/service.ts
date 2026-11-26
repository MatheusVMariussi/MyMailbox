import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { isEmptyLabelDelta } from "@/lib/labels/label-utils";
import { addMessageLabels, getLabel, loadLabels, loadMessageLabelIds, loadSameNamedLabels, removeMessageLabels } from "@/lib/labels/service";
import type { LabelPair, LabelRecord, MessageLabelDelta } from "@/lib/labels/types";
import type { SessionUser } from "@/lib/auth/types";
import { isOthersDraft } from "@/lib/email/draft-access";
import { createAuditLogs } from "@/lib/mailboxes/audit";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import type { MailboxAccessLevel } from "@/lib/mailboxes/types";
import { applySpamFeedback } from "@/lib/spam/feedback";
import { claimMessageActionUndoToken, releaseMessageActionUndoClaim } from "./claims";
import {
	actionNeedsManage,
	getChangedStateFields,
	getMessageActionPatch,
	isReversibleMessageAction,
	recordHasChanges,
	snapshotMessageState,
	planUndoRecord,
	type MessageActionTarget,
} from "./definitions";
import { MAX_UNDO_AGE_MS, signUndoTokenForEnv, verifyUndoTokenForEnv } from "./token";
import type {
	MessageActionInput,
	MessageActionRecord,
	MessageActionResponse,
	MessageActionSkipped,
	MessageStateField,
	MessageStateSnapshot,
	UndoMessageActionResponse,
} from "./types";

const MAX_ACTION_MESSAGES = 5000;
const MESSAGE_ID_CHUNK = 90;
const MESSAGE_QUERY_CONCURRENCY = 5;
const D1_BOUND_PARAMETER_BUDGET = 90;

export class MessageActionError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "MessageActionError";
	}
}

type LoadedTarget = MessageActionTarget & { mailboxId: string | null; userId: string | null; privateDraft: boolean; labelIds: string[] };

type PlannedUpdate = {
	id: string;
	/** Every field the operation writes; used for both the CAS and the update. */
	fields: MessageStateField[];
	condition: MessageStateSnapshot;
	values: Partial<MessageStateSnapshot>;
};

function selectTargetChunk(db: AppDatabase, chunk: string[]) {
	return db.select({
		id: messages.id,
		userId: messages.userId,
		mailboxId: messages.mailboxId,
		direction: messages.direction,
		privateDraft: messages.privateDraft,
		status: messages.status,
		read: messages.read,
		starred: messages.starred,
		snoozedUntil: messages.snoozedUntil,
	}).from(messages).where(inArray(messages.id, chunk));
}

async function loadTargets(db: AppDatabase, ids: string[], withLabels = false): Promise<LoadedTarget[]> {
	const chunks: string[][] = [];
	for (let index = 0; index < ids.length; index += MESSAGE_ID_CHUNK) chunks.push(ids.slice(index, index + MESSAGE_ID_CHUNK));
	const rows: Array<Omit<LoadedTarget, "labelIds">> = [];
	for (let index = 0; index < chunks.length; index += MESSAGE_QUERY_CONCURRENCY) {
		const batch = await Promise.all(chunks.slice(index, index + MESSAGE_QUERY_CONCURRENCY).map((chunk) => selectTargetChunk(db, chunk)));
		rows.push(...batch.flat());
	}
	const labelIds = withLabels ? await loadMessageLabelIds(db, rows.map((row) => row.id)) : new Map<string, string[]>();
	return rows.map((row) => ({ ...row, labelIds: labelIds.get(row.id) ?? [] }));
}

async function loadAccessMap(
	db: AppDatabase,
	user: SessionUser,
	rows: Array<{ mailboxId: string | null }>,
): Promise<Map<string, MailboxAccessLevel | null>> {
	const ids = [...new Set(rows.map((row) => row.mailboxId).filter((id): id is string => !!id))];
	return new Map(await Promise.all(ids.map(async (id) => [id, await getMailboxAccessLevel(db, user, id)] as const)));
}

function normalizeMessageIds(input: MessageActionInput): string[] {
	if (!Array.isArray(input.messageIds)) throw new MessageActionError("Message IDs are required");
	const ids = [...new Set(input.messageIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
	if (ids.length === 0) throw new MessageActionError("Message IDs are required");
	if (ids.length > MAX_ACTION_MESSAGES) throw new MessageActionError(`Select up to ${MAX_ACTION_MESSAGES} messages at a time`);
	return ids;
}

function toDatabasePatch(patch: Partial<MessageStateSnapshot>) {
	const { snoozedUntil, ...fields } = patch;
	return {
		...fields,
		...(snoozedUntil !== undefined
			? { snoozedUntil: snoozedUntil ? new Date(snoozedUntil) : null }
			: {}),
	};
}

function pickStatePatch(
	fields: Array<keyof MessageStateSnapshot>,
	state: Partial<MessageStateSnapshot>,
): Partial<MessageStateSnapshot> {
	const patch: Partial<MessageStateSnapshot> = {};
	for (const field of fields) patch[field] = state[field] as never;
	return patch;
}

function stateCondition(field: keyof MessageStateSnapshot, expected: MessageStateSnapshot[keyof MessageStateSnapshot]): SQL {
	if (field === "status") return eq(messages.status, expected as string);
	if (field === "read") return eq(messages.read, expected as boolean);
	if (field === "starred") return eq(messages.starred, expected as boolean);
	return expected === null ? isNull(messages.snoozedUntil) : eq(messages.snoozedUntil, new Date(expected as string));
}

function stateConditions(
	fields: Array<keyof MessageStateSnapshot>,
	state: MessageStateSnapshot,
): SQL[] {
	return fields.map((field) => stateCondition(field, state[field]));
}

function validateSnoozeTime(value: string | null | undefined): string {
	if (typeof value !== "string") throw new MessageActionError("Choose a future snooze time");
	const date = new Date(value);
	if (Number.isNaN(date.getTime()) || date <= new Date()) throw new MessageActionError("Choose a future snooze time");
	return date.toISOString();
}

async function updatePlannedRow(
	db: AppDatabase,
	plan: PlannedUpdate,
): Promise<"applied" | "stale" | "failed"> {
	try {
		const updated = await db.update(messages)
			.set(toDatabasePatch(pickStatePatch(plan.fields, plan.values)))
			.where(and(eq(messages.id, plan.id), ...stateConditions(plan.fields, plan.condition)))
			.returning({ id: messages.id });
		return updated.length > 0 ? "applied" : "stale";
	} catch {
		return "failed";
	}
}

function planRowCondition(plan: PlannedUpdate): SQL {
	return and(eq(messages.id, plan.id), ...stateConditions(plan.fields, plan.condition))!;
}

/** Raw-CASE parameter values: timestamps are epoch seconds, SQLite booleans are integers. */
function toCaseValue(field: MessageStateField, value: MessageStateSnapshot[MessageStateField]): unknown {
	if (field === "snoozedUntil") {
		return value === null ? null : Math.floor(new Date(value as string).getTime() / 1000);
	}
	if (field === "read" || field === "starred") return value ? 1 : 0;
	return value;
}

function countVaryingFields(plans: PlannedUpdate[]): number {
	return plans[0].fields.filter((field) => plans.some((plan) => plan.values[field] !== plans[0].values[field])).length;
}

/** Fields with one target use a plain SET; per-row targets use a CASE expression. */
function buildUpdateSet(plans: PlannedUpdate[]) {
	const fields = plans[0].fields;
	const uniform: Partial<MessageStateSnapshot> = {};
	const cases: Record<string, SQL> = {};
	for (const field of fields) {
		const first = plans[0].values[field];
		if (plans.every((plan) => plan.values[field] === first)) {
			uniform[field] = first as never;
			continue;
		}
		const branches = plans.map((plan) => sql`when ${plan.id} then ${toCaseValue(field, plan.values[field] as never)}`);
		cases[field] = sql`case ${messages.id} ${sql.join(branches, sql` `)} else ${messages[field]} end`;
	}
	return { ...toDatabasePatch(uniform), ...cases };
}

/** Keeps every statement under D1's bound-parameter limit. */
function updateChunkSize(parametersPerRow: number): number {
	return Math.max(1, Math.floor(D1_BOUND_PARAMETER_BUDGET / parametersPerRow));
}

/**
 * Runs bounded CAS updates. Rows are grouped by written fields and their per-row
 * conditions ORed, so D1's query cap does not turn a large or heterogeneous
 * selection into one query per message. Any batch miss falls back to per-row
 * CAS to report the exact stale rows.
 */
async function runPlannedUpdates(
	db: AppDatabase,
	plans: PlannedUpdate[],
): Promise<{ applied: Set<string>; skipped: MessageActionSkipped[] }> {
	const applied = new Set<string>();
	const skipped: MessageActionSkipped[] = [];
	const groups = new Map<string, PlannedUpdate[]>();
	for (const plan of plans) {
		const key = plan.fields.join("|");
		const group = groups.get(key);
		if (group) group.push(plan);
		else groups.set(key, [plan]);
	}

	for (const group of groups.values()) {
		// One id plus one condition value per field, plus two parameters per CASE branch.
		const parametersPerRow = 1 + group[0].fields.length + countVaryingFields(group) * 2;
		const chunkSize = updateChunkSize(parametersPerRow);
		for (let index = 0; index < group.length; index += chunkSize) {
			const chunk = group.slice(index, index + chunkSize);
			let updatedIds = new Set<string>();
			try {
				const updated = await db.update(messages)
					.set(buildUpdateSet(chunk))
					.where(or(...chunk.map(planRowCondition)))
					.returning({ id: messages.id });
				updatedIds = new Set(updated.map((row) => row.id));
			} catch {
				updatedIds = new Set();
			}

			for (const plan of chunk) {
				const outcome = updatedIds.has(plan.id) ? "applied" : await updatePlannedRow(db, plan);
				if (outcome === "applied") applied.add(plan.id);
				else skipped.push({ id: plan.id, reason: outcome });
			}
		}
	}
	return { applied, skipped };
}

const LABEL_ACTIONS = new Set(["move", "label", "unlabel"]);

async function loadActionLabel(
	db: AppDatabase,
	user: SessionUser,
	labelId: string | null | undefined,
): Promise<LabelRecord> {
	if (!labelId) throw new MessageActionError("Label is required");
	const label = await getLabel(db, labelId);
	if (!label) throw new MessageActionError("Label not found", 404);
	const access = await getMailboxAccessLevel(db, user, label.mailboxId);
	if (!access?.canManage) throw new MessageActionError("Label not found", 404);
	return label;
}

type LabelChanges = { added: Map<string, string[]>; removed: Map<string, string[]> };

function byMessage(pairs: LabelPair[]): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const pair of pairs) result.set(pair.messageId, [...(result.get(pair.messageId) ?? []), pair.labelId]);
	return result;
}

/** Applies label deltas and reports the pairs that really changed, per message. */
async function applyLabelDeltas(db: AppDatabase, entries: Array<{ id: string; labels: MessageLabelDelta }>): Promise<LabelChanges> {
	const add = entries.flatMap((entry) => entry.labels.added.map((labelId) => ({ messageId: entry.id, labelId })));
	const remove = entries.flatMap((entry) => entry.labels.removed.map((labelId) => ({ messageId: entry.id, labelId })));
	const added = add.length ? await addMessageLabels(db, add) : [];
	const removed = remove.length ? await removeMessageLabels(db, remove) : [];
	return { added: byMessage(added), removed: byMessage(removed) };
}

function labelChangesOf(changes: LabelChanges, id: string): MessageLabelDelta | undefined {
	const delta = { added: changes.added.get(id) ?? [], removed: changes.removed.get(id) ?? [] };
	return isEmptyLabelDelta(delta) ? undefined : delta;
}

function auditActionFor(action: string): string {
	if (action === "read" || action === "unread") return "email.read";
	if (action === "label" || action === "unlabel") return "email.label";
	return "email.delete";
}

type ApplyEntry = { plan: PlannedUpdate | null; record: MessageActionRecord; labels?: MessageLabelDelta };

/** Applies one explicit action and returns the exact before/after state of every message it changed. */
export async function applyMessageActionForUser(
	env: CloudflareEnv,
	user: SessionUser,
	input: MessageActionInput,
): Promise<MessageActionResponse> {
	if (!isReversibleMessageAction(input.action)) throw new MessageActionError("Invalid message action");
	const action = input.action;
	const ids = normalizeMessageIds(input);
	const snoozedUntil = action === "snooze" ? validateSnoozeTime(input.snoozedUntil) : undefined;
	const db = getDb(env);
	const label = LABEL_ACTIONS.has(action) ? await loadActionLabel(db, user, input.labelId) : null;
	const rows = await loadTargets(db, ids, !!label);
	if (rows.length === 0) throw new MessageActionError("No accessible messages", 404);
	// A selection in the unified inbox spans mailboxes: each message takes its own mailbox's label of that name.
	const labelByMailbox = label ? await loadSameNamedLabels(db, label, rows.flatMap((row) => row.mailboxId ? [row.mailboxId] : [])) : null;

	const accessByMailbox = await loadAccessMap(db, user, rows);
	const applied: MessageActionRecord[] = [];
	const skipped: MessageActionSkipped[] = [];
	const entries: ApplyEntry[] = [];
	const seen = new Set<string>();

	for (const row of rows) {
		seen.add(row.id);
		// Another user's draft is invisible to this user: report it exactly like a missing message.
		if (!row.mailboxId || isOthersDraft(row, user.id)) {
			skipped.push({ id: row.id, reason: "not_found" });
			continue;
		}
		const access = accessByMailbox.get(row.mailboxId);
		const required = actionNeedsManage(action) ? access?.canManage : access?.canRead;
		if (!required) {
			skipped.push({ id: row.id, reason: "forbidden" });
			continue;
		}
		// A label belongs to one mailbox: mail of a mailbox without a label of that name is left alone.
		const rowLabel = labelByMailbox?.get(row.mailboxId);
		if (label && !rowLabel) {
			skipped.push({ id: row.id, reason: "not_applicable" });
			continue;
		}

		const result = getMessageActionPatch(action, { labelId: rowLabel?.id, snoozedUntil }, row);
		if (!result.patch) {
			skipped.push({ id: row.id, reason: result.reason });
			continue;
		}
		const previous = snapshotMessageState(row);
		const next = { ...previous, ...result.patch };
		const fields = Object.keys(result.patch) as MessageStateField[];
		const changedFields = getChangedStateFields(previous, next);
		const trainingAction = action === "spam" || (action === "inbox" && row.status === "spam");
		if (changedFields.length === 0 && isEmptyLabelDelta(result.labels) && !trainingAction) continue;

		if (trainingAction) {
			try {
				const classification = action === "spam" ? "spam" : "ham";
				const changed = await applySpamFeedback(env, user, row.id, classification, access);
				if (!changed) {
					skipped.push({ id: row.id, reason: "not_applicable" });
					continue;
				}
			} catch {
				skipped.push({ id: row.id, reason: "failed" });
				continue;
			}
			// Spam feedback writes the status itself and is not undoable.
			if (action === "inbox") {
				const remaining = fields.filter((field) => field !== "status");
				if (remaining.length > 0) {
					try {
						const updated = await db.update(messages)
							.set(toDatabasePatch(pickStatePatch(remaining, next)))
							.where(eq(messages.id, row.id))
							.returning({ id: messages.id });
						if (updated.length === 0) {
							skipped.push({ id: row.id, reason: "not_found" });
							continue;
						}
					} catch {
						skipped.push({ id: row.id, reason: "failed" });
						continue;
					}
				}
			}
			if (recordHasChanges({ previous, applied: next })) {
				applied.push({ id: row.id, mailboxId: row.mailboxId, previous, applied: next });
			}
			continue;
		}

		entries.push({
			plan: changedFields.length > 0 ? { id: row.id, fields, condition: previous, values: next } : null,
			record: { id: row.id, mailboxId: row.mailboxId, previous, applied: changedFields.length > 0 ? next : previous },
			labels: isEmptyLabelDelta(result.labels) ? undefined : result.labels,
		});
	}

	const updates = await runPlannedUpdates(db, entries.flatMap((entry) => entry.plan ? [entry.plan] : []));
	skipped.push(...updates.skipped);
	// Labels follow a status change only when it committed, so a stale move adds nothing.
	const committed = entries.filter((entry) => !entry.plan || updates.applied.has(entry.plan.id));
	const labelled = committed.flatMap((entry) => entry.labels ? [{ id: entry.record.id, labels: entry.labels }] : []);
	let labelChanges: LabelChanges = { added: new Map(), removed: new Map() };
	try {
		labelChanges = await applyLabelDeltas(db, labelled);
	} catch (error) {
		console.error("Message label update failed", error);
		for (const entry of committed) if (!entry.plan && entry.labels) skipped.push({ id: entry.record.id, reason: "failed" });
	}
	for (const entry of committed) {
		const labels = labelChangesOf(labelChanges, entry.record.id);
		const record = labels ? { ...entry.record, labels } : entry.record;
		if (recordHasChanges(record)) applied.push(record);
	}
	for (const missing of ids.filter((id) => !seen.has(id))) {
		skipped.push({ id: missing, reason: "not_found" });
	}

	if (applied.length === 0 && skipped.some((item) => item.reason === "failed")) {
		throw new MessageActionError("Could not update messages", 500);
	}

	const changedRecords = applied.filter(recordHasChanges);
	const hasTrainingRecord = action === "spam"
		|| (action === "inbox" && applied.some((record) => record.previous.status === "spam"));
	const auditRecords = action === "spam"
		? []
		: action === "inbox"
			? changedRecords.filter((record) => record.previous.status !== "spam")
			: changedRecords;
	if (auditRecords.length > 0) {
		await createAuditLogs(env, auditRecords.map((record) => ({
			actorUserId: user.id,
			messageId: record.id,
			action: auditActionFor(action),
			metadata: { messageAction: action, ...(label ? { labelId: label.id } : {}) },
		})));
	}

	const undoToken = !hasTrainingRecord && changedRecords.length > 0
		? await signUndoTokenForEnv(env, {
			v: 3,
			issuedAt: Date.now(),
			action,
			userId: user.id,
			nonce: crypto.randomUUID(),
			records: changedRecords,
		})
		: undefined;

	return { ok: true, action, applied, skipped, undoToken };
}

/**
 * Restores the signed action after claiming its nonce, which blocks replay of a
 * used token. A never-used ABA change still passes the value CAS by design.
 */
export async function undoMessageActionForUser(
	env: CloudflareEnv,
	user: SessionUser,
	token: string,
): Promise<UndoMessageActionResponse> {
	const payload = await verifyUndoTokenForEnv(env, token);
	if (!payload || !isReversibleMessageAction(payload.action) || payload.userId !== user.id) {
		throw new MessageActionError("This undo has expired", 410);
	}
	if (payload.records.length === 0) throw new MessageActionError("Nothing to undo");
	if (payload.records.length > MAX_ACTION_MESSAGES) throw new MessageActionError("Too many messages to undo");

	const claimed = await claimMessageActionUndoToken(env, {
		nonce: payload.nonce,
		userId: user.id,
		expiresAt: new Date(Date.now() + MAX_UNDO_AGE_MS),
	});
	if (claimed === "duplicate") {
		throw new MessageActionError("This undo has already been used", 410);
	}

	// A committed restore keeps the claim; only a zero-progress failure releases it.
	const progress = { restored: 0 };
	try {
		return await performUndoMessageAction(env, user, payload, progress);
	} catch (error) {
		if (progress.restored === 0) {
			await releaseMessageActionUndoClaim(env, { nonce: payload.nonce, userId: user.id }).catch(() => undefined);
		}
		throw error;
	}
}

async function performUndoMessageAction(
	env: CloudflareEnv,
	user: SessionUser,
	payload: NonNullable<Awaited<ReturnType<typeof verifyUndoTokenForEnv>>>,
	progress: { restored: number },
): Promise<UndoMessageActionResponse> {
	const records = [...new Map(payload.records.map((record) => [record.id, record])).values()];
	const db = getDb(env);
	const ids = records.map((record) => record.id);
	const rows = await loadTargets(db, ids);
	const byId = new Map(rows.map((row) => [row.id, row]));
	const accessByMailbox = await loadAccessMap(db, user, rows);
	// Labels the action removed come back only while they exist, in the message's own mailbox.
	const removedLabelIds = records.flatMap((record) => (Array.isArray(record.labels?.removed) ? record.labels.removed : []));
	const labelMailboxes = new Map([...(await loadLabels(db, removedLabelIds)).values()].map((label) => [label.id, label.mailboxId]));

	const skipped: MessageActionSkipped[] = [];
	const plans: Array<{ plan: PlannedUpdate | null; record: MessageActionRecord; labels?: MessageLabelDelta }> = [];

	for (const record of records) {
		const current = byId.get(record.id);
		if (!current || isOthersDraft(current, user.id)) {
			skipped.push({ id: record.id, reason: "not_found" });
			continue;
		}
		const access = current.mailboxId ? accessByMailbox.get(current.mailboxId) : null;
		const plan = planUndoRecord(
			record,
			current,
			{ canRead: !!access?.canRead, canManage: !!access?.canManage },
			labelMailboxes,
		);
		if (!("patch" in plan)) {
			skipped.push({ id: plan.id, reason: plan.reason });
			continue;
		}
		plans.push({
			plan: plan.fields.length > 0 ? { id: record.id, fields: plan.fields, condition: record.applied, values: plan.patch } : null,
			record,
			labels: plan.labels,
		});
	}

	const updates = await runPlannedUpdates(db, plans.flatMap((entry) => entry.plan ? [entry.plan] : []));
	skipped.push(...updates.skipped);
	// A stale status keeps its labels too: the undo of that message is skipped as a whole.
	const committed = plans.filter((entry) => !entry.plan || updates.applied.has(entry.plan.id));
	try {
		await applyLabelDeltas(db, committed.flatMap((entry) => entry.labels ? [{ id: entry.record.id, labels: entry.labels }] : []));
	} catch (error) {
		console.error("Message label undo failed", error);
		const failed = committed.filter((entry) => !entry.plan && entry.labels);
		for (const entry of failed) skipped.push({ id: entry.record.id, reason: "failed" });
		committed.splice(0, committed.length, ...committed.filter((entry) => !failed.includes(entry)));
	}
	const restored = committed.map((entry) => entry.record.id);
	progress.restored += restored.length;

	if (restored.length === 0 && skipped.some((item) => item.reason === "failed")) {
		throw new MessageActionError("Could not restore messages", 500);
	}

	if (restored.length > 0) {
		const restoredSet = new Set(restored);
		try {
			await createAuditLogs(env, records
				.filter((record) => restoredSet.has(record.id))
				.map((record) => ({
					actorUserId: user.id,
					messageId: record.id,
					action: getChangedStateFields(record.previous, record.applied).every((field) => field === "read" || field === "starred")
						? (isEmptyLabelDelta(record.labels) ? "email.read" : "email.label")
						: "email.delete",
					metadata: { undoOf: payload.action },
				})));
		} catch (error) {
			// The restore committed; a failed audit must not make the claim retryable.
			console.error("Message undo audit failed", error);
		}
	}

	return { ok: true, action: payload.action, restored, skipped };
}
