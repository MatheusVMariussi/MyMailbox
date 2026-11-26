import { NextResponse } from "next/server";
import { eq, desc, and, or, count, isNull, isNotNull, inArray, lte, gt, notInArray, ne, sql, sum } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { messages, outboundJobs } from "@/db/schema";
import { getContactDisplayNameMap } from "@/lib/contacts/service";
import { getPartyDisplayName } from "@/lib/contacts/utils";
import { getFirstEmailAddressEntry, normalizeEmailAddress } from "@/lib/email/address";
import { getMailboxAccessLevel, hasMailboxPermission, listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { tracksAccountIdentity } from "@/lib/profile/identity-utils";
import { SearchQueryError, searchScopeExclusion } from "@/lib/search/conditions";
import { buildSearchFilter } from "@/lib/search/service";
import { getRequestTimeZone } from "@/lib/time/utils";
import { scheduledMessageCondition } from "@/lib/email/scheduled";
import { selectInBatches } from "@/lib/db-params";
import { conversationKey, getMessageListColumns, loadConversationPage, rowConversationKey } from "./utils";
import type { ListMessage } from "./types";
import { getOpenCounts } from "@/lib/tracking/open-tracking";
import { summarizeNotesForRows } from "@/lib/notes/service";
import { parseLimit, parseOffset } from "@/lib/api/query-params";
import { draftsVisibleTo } from "@/lib/email/draft-access";
import { categoryScopeCondition } from "@/lib/promotions/settings";
import { hasLabelCondition, labelViewStatusCondition, loadMessageLabelIds } from "@/lib/labels/service";
import { LABEL_FILTER_MAX_IDS, parseLabelFilter } from "@/lib/labels/label-utils";
import { parseProjectParam } from "@/lib/projects/project-utils";
import { projectFilterCondition } from "@/lib/projects/service";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const query = url.searchParams.get("q")?.trim();
	const title = url.searchParams.get("title")?.trim();
	// A search (`scope=search` with a query) spans every folder, as in Gmail: the folder parameters are ignored, and
	// the mailbox and project scope, the read toggle and the query still apply.
	const searching = url.searchParams.get("scope") === "search" && !!(query || title);
	const folderParam = (name: string) => (searching ? null : url.searchParams.get(name));
	const direction = folderParam("direction");
	const mailboxId = url.searchParams.get("mailboxId");
	// One label, or a comma-separated group of same-named labels across mailboxes (the unified sidebar).
	const labelIds = parseLabelFilter(folderParam("labelId"));
	const labelId = labelIds ? labelIds.join(",") : null;
	const projectId = parseProjectParam(url.searchParams.get("projectId"));
	const status = folderParam("status");
	const read = url.searchParams.get("read");
	const starred = folderParam("starred");
	const category = folderParam("category");
	const snoozed = folderParam("snoozed");
	const scheduled = folderParam("scheduled");
	const limit = parseLimit(url.searchParams.get("limit"), 50, 100);
	const offset = parseOffset(url.searchParams.get("offset"));
	// Conversation view: one row per thread, represented by its newest message
	// that matches the filter. Drafts are never grouped.
	const groupByThread = url.searchParams.get("group") === "thread" && status !== "draft";

	if (labelIds === false) {
		return NextResponse.json({ error: `labelId names at most ${LABEL_FILTER_MAX_IDS} labels` }, { status: 400 });
	}
	if (category && (category !== "promotions" || status !== "received" || labelId)) {
		return NextResponse.json({ error: "category=promotions needs status=received and no labelId" }, { status: 400 });
	}

	const db = getDb(env);
	const accessibleMailboxes = await listAccessibleMailboxes(db, user);
	const accessibleMailboxIds = accessibleMailboxes.map((mailbox) => mailbox.id);
	const conditions: SQL[] = [];
	if (mailboxId) {
		const mailbox = accessibleMailboxes.find((mailbox) => mailbox.id === mailboxId);
		// Reuse this request's authorization; retain the fallback for mailboxes
		// omitted by the list's domain join (for example, legacy orphaned rows).
		const canRead = mailbox
			? hasMailboxPermission(mailbox.permission, "read_only")
			: (await getMailboxAccessLevel(db, user, mailboxId))?.canRead;
		if (!canRead) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		conditions.push(eq(messages.mailboxId, mailboxId));
	} else if (accessibleMailboxIds.length > 0) {
		conditions.push(inArray(messages.mailboxId, accessibleMailboxIds));
	} else {
		conditions.push(eq(messages.userId, user.id));
	}
	// Another user's unsent drafts are never listed, even in a shared mailbox.
	conditions.push(draftsVisibleTo(user.id));
	if (direction === "inbound" || direction === "outbound") {
		conditions.push(eq(messages.direction, direction));
	}
	if (labelIds) {
		// A label view: the label (or its same-named group), any direction, nothing in Trash or Spam.
		conditions.push(hasLabelCondition(labelIds), labelViewStatusCondition);
	}
	if (projectId) conditions.push(projectFilterCondition(projectId));
	if (status) {
		conditions.push(eq(messages.status, status));
	}
	// Composer templates are stored as messages but never listed.
	if (status !== "template") {
		conditions.push(ne(messages.status, "template"));
	}
	if (status === "received" && !labelId) {
		// The inbox: received and not snoozed. Labels never take mail out of it.
		conditions.push(or(isNull(messages.snoozedUntil), lte(messages.snoozedUntil, new Date()))!);
		// Promotions is its own view, only for mailboxes that turned it on; the Inbox hides what `separate` mailboxes moved there.
		const hidden = await categoryScopeCondition(db, mailboxId ? [mailboxId] : accessibleMailboxIds, category ? "promotions" : "inbox");
		if (hidden) conditions.push(hidden);
	}
	if (starred === "true") {
		conditions.push(eq(messages.starred, true));
	}
	if (snoozed === "true") {
		conditions.push(eq(messages.status, "received"));
		conditions.push(gt(messages.snoozedUntil, new Date()));
	}
	if (scheduled === "true") {
		conditions.push(scheduledMessageCondition(db));
	}
	if (read === "read") {
		conditions.push(eq(messages.read, true));
	}
	if (read === "unread") {
		conditions.push(eq(messages.read, false));
	}
	if (query || title) {
		// Operators and free text compile against the full-text index and columns; `title` is the legacy subject
		// filter, joined as a phrase. `label:` resolves against the mailboxes listed here.
		try {
			const search = await buildSearchFilter(
				db,
				{ query, subject: title, timeZone: getRequestTimeZone(request, user.timeZone) },
				{ mailboxIds: mailboxId ? [mailboxId] : accessibleMailboxIds, userId: user.id },
			);
			if (search.condition) conditions.push(search.condition);
			// A search leaves Spam and Trash out unless the query names them (`in:spam`, `in:trash`, `in:anywhere`).
			const exclusion = searching ? searchScopeExclusion(search.folders) : null;
			if (exclusion) conditions.push(exclusion);
		} catch (error) {
			if (error instanceof SearchQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
			throw error;
		}
	}
	const where = and(...conditions);
	// Messages that were never threaded (older rows, drafts) stand alone.
	const threadKey = conversationKey(searching);

	// The list renders `snippet`. Bodies stay on the thread endpoint.
	const messageListColumns = getMessageListColumns();

	let total = 0;
	let rows: ListMessage[];
	// Which stored messages each visible row stands for, so acting on a
	// conversation row acts on the whole conversation within this folder.
	const threadMessageIds = new Map<string, string[]>();
	// Unread messages per conversation within this folder; the row's unread state
	// has to match what marking it read will actually change.
	const scopedThreadCounts = new Map<string, { total: number; unread: number }>();
	if (groupByThread) {
		const page = await loadConversationPage({ db, where, offset, limit, threadKey });
		total = page.total;
		rows = page.ids.length
			? await selectInBatches(page.ids, (batch) => db.select(messageListColumns).from(messages).where(and(where, inArray(messages.id, batch))))
			: [];
		const rowById = new Map(rows.map((row) => [row.id, row]));
		rows = page.ids.map((id) => rowById.get(id)).filter((row): row is ListMessage => !!row);
		const keys = rows.map((row) => rowConversationKey(row, searching));
		if (keys.length > 0) {
			const members = await selectInBatches(keys, (batch) => db
				.select({ id: messages.id, key: threadKey, read: messages.read })
				.from(messages)
				.where(and(where, inArray(threadKey, batch))));
			for (const member of members) {
				const list = threadMessageIds.get(member.key) ?? [];
				list.push(member.id);
				threadMessageIds.set(member.key, list);
				const counts = scopedThreadCounts.get(member.key) ?? { total: 0, unread: 0 };
				counts.total += 1;
				if (!member.read) counts.unread += 1;
				scopedThreadCounts.set(member.key, counts);
			}
		}
	} else {
		const [totals, pageRows] = await Promise.all([
			db.select({ total: count() }).from(messages).where(where),
			db
				.select(messageListColumns)
				.from(messages)
				.where(where)
				.orderBy(desc(messages.createdAt))
				.limit(limit)
				.offset(offset),
		]);
		total = totals[0]?.total ?? 0;
		rows = pageRows;
	}
	// Conversation sizes for the rows on this page, so the list can show "(3)"
	// next to a subject the way threaded clients do.
	const threadIds = Array.from(new Set(rows.map((row) => row.threadId).filter((id): id is string => !!id)));
	const scope = mailboxId
		? eq(messages.mailboxId, mailboxId)
		: accessibleMailboxIds.length > 0
			? inArray(messages.mailboxId, accessibleMailboxIds)
			: eq(messages.userId, user.id);
	// These enrichments depend only on the selected page, not on each other.
	const [countRows, jobs, openCounts, noteSummaries, contactMaps, labelIdsByMessage] = await Promise.all([
		threadIds.length > 0
			? selectInBatches(threadIds, (batch) => db
				.select({
					threadId: messages.threadId,
					total: count(),
					unread: sum(sql`case when ${messages.read} then 0 else 1 end`),
				})
				.from(messages)
				.where(and(scope, inArray(messages.threadId, batch), isNotNull(messages.threadId), notInArray(messages.status, ["draft", "trash"]), draftsVisibleTo(user.id)))
				.groupBy(messages.threadId))
			: [],
		scheduled === "true" && rows.length > 0
			? selectInBatches(rows.map((row) => row.id), (batch) => db
				.select({ messageId: outboundJobs.messageId, scheduledAt: outboundJobs.scheduledAt })
				.from(outboundJobs)
				.where(and(inArray(outboundJobs.messageId, batch), eq(outboundJobs.status, "queued"), isNotNull(outboundJobs.scheduledAt))))
			: [],
		getOpenCounts(env, rows.filter((row) => row.direction === "outbound").map((row) => row.id)),
		summarizeNotesForRows(db, rows),
		Promise.all(
			Array.from(new Set(rows.map((message) => message.userId))).map(async (userId) => [
				userId,
				await getContactDisplayNameMap(
					env,
					userId,
					rows
						.filter((message) => message.userId === userId)
						.flatMap((message) => [message.fromAddr, getFirstEmailAddressEntry(message.toAddr)]),
				),
			] as const),
		),
		loadMessageLabelIds(db, rows.map((row) => row.id)),
	]);
	const threadCounts = new Map<string, { total: number; unread: number }>();
	for (const row of countRows) {
		if (row.threadId) threadCounts.set(row.threadId, { total: row.total, unread: Number(row.unread ?? 0) });
	}
	const scheduledAtByMessageId = new Map<string, string>();
	for (const job of jobs) {
		if (job.messageId && job.scheduledAt) scheduledAtByMessageId.set(job.messageId, job.scheduledAt.toISOString());
	}
	const mailboxNameMap = new Map(
		accessibleMailboxes.map((mailbox) => [
			mailbox.id,
			mailbox.userId === user.id && tracksAccountIdentity(mailbox, user.email)
				? user.name
				: mailbox.displayName ?? mailbox.localPart,
		]),
	);
	const contactMapsByUserId = new Map(contactMaps);
	// `Message.textBody`/`htmlBody` are optional on the wire type and the
	// reading pane loads them from /api/messages/[id]/thread, so they are
	// neither selected nor sent here.
	const enrichedRows = rows.map(({ rawR2Key: _rawR2Key, ...message }) => {
		const threadStats = message.threadId ? threadCounts.get(message.threadId) : undefined;
		const folderUnread = scopedThreadCounts.get(rowConversationKey(message, searching))?.unread;
		const contactMap = contactMapsByUserId.get(message.userId);
		const accountName = message.mailboxId ? mailboxNameMap.get(message.mailboxId) : null;
		const firstTo = getFirstEmailAddressEntry(message.toAddr);
		return {
			...message,
			snippet: message.snippet,
			...(scheduledAtByMessageId.has(message.id) ? { scheduledAt: scheduledAtByMessageId.get(message.id) } : {}),
			...(openCounts.has(message.id) ? { openCount: openCounts.get(message.id) } : {}),
			...(noteSummaries.has(message.id) ? { noteCount: noteSummaries.get(message.id)!.count, notePreview: noteSummaries.get(message.id)!.preview } : {}),
			fromContactName:
				(message.direction === "outbound" ? accountName : null) ??
				getPartyDisplayName(message.fromAddr, contactMap?.get(normalizeEmailAddress(message.fromAddr))),
			toContactName: getPartyDisplayName(firstTo, contactMap?.get(normalizeEmailAddress(firstTo))),
			labelIds: labelIdsByMessage.get(message.id) ?? [],
			threadCount: threadStats?.total || 1,
			threadUnread: (groupByThread ? folderUnread : threadStats?.unread) || 0,
			...(groupByThread
				? { threadMessageIds: threadMessageIds.get(rowConversationKey(message, searching)) ?? [message.id] }
				: {}),
		};
	});

	return NextResponse.json({ messages: enrichedRows, total, limit, offset, grouped: groupByThread });
}
