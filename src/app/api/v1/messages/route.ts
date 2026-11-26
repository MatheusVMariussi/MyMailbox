import { NextResponse } from "next/server";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { authenticateApiKey, requireScope } from "@/lib/api/auth";
import { getDb } from "@/db";
import { messages, users } from "@/db/schema";
import { getMailboxAccessLevel, listAccessibleMailboxIds } from "@/lib/mailboxes/access";
import { SearchQueryError } from "@/lib/search/conditions";
import { buildSearchFilter } from "@/lib/search/service";
import { draftsVisibleTo } from "@/lib/email/draft-access";
import { getRequestTimeZone } from "@/lib/time/utils";
import { parseLimit } from "@/lib/api/query-params";
import { loadMessageLabelIds } from "@/lib/labels/service";
import { parseProjectParam } from "@/lib/projects/project-utils";
import { projectFilterCondition } from "@/lib/projects/service";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth || !requireScope(auth.scopes, "read")) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const direction = url.searchParams.get("direction");
	const query = url.searchParams.get("q")?.trim();
	const projectId = parseProjectParam(url.searchParams.get("projectId"));
	const limit = parseLimit(url.searchParams.get("limit"), 50, 100);

	const db = getDb(env);
	const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
	if (!user || user.disabled) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const conditions: SQL[] = [];
	// The mailboxes this request reads, which `label:` resolves against.
	let searchedMailboxIds: string[];
	if (mailboxId) {
		if (auth.mailboxIds && !auth.mailboxIds.includes(mailboxId)) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		const access = await getMailboxAccessLevel(db, user, mailboxId);
		if (!access?.canRead) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		conditions.push(eq(messages.mailboxId, mailboxId));
		searchedMailboxIds = [mailboxId];
	} else {
		const accessibleMailboxIds = (await listAccessibleMailboxIds(db, user)).filter((id) => !auth.mailboxIds || auth.mailboxIds.includes(id));
		searchedMailboxIds = accessibleMailboxIds;
		if (accessibleMailboxIds.length > 0) {
			conditions.push(inArray(messages.mailboxId, accessibleMailboxIds));
		} else if (auth.mailboxIds) {
			return NextResponse.json({ messages: [] });
		} else {
			conditions.push(eq(messages.userId, auth.userId));
		}
	}
	// Other users' drafts in a shared mailbox are private, as in the web list.
	conditions.push(draftsVisibleTo(auth.userId));
	if (direction === "inbound" || direction === "outbound") {
		conditions.push(eq(messages.direction, direction));
	}
	if (projectId) conditions.push(projectFilterCondition(projectId));
	if (query) {
		// The session list's grammar; unlike a web search, Spam and Trash are not left out.
		try {
			const search = await buildSearchFilter(db, { query, timeZone: getRequestTimeZone(request, user.timeZone) }, { mailboxIds: searchedMailboxIds, userId: auth.userId });
			if (search.condition) conditions.push(search.condition);
		} catch (error) {
			if (error instanceof SearchQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
			throw error;
		}
	}

	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(limit);
	const labelIds = await loadMessageLabelIds(db, rows.map((row) => row.id));

	// `folder_id` is a dead column since labels replaced folders; each row lists its label ids instead.
	return NextResponse.json({ messages: rows.map(({ legacyFolderId: _legacyFolderId, ...row }) => ({ ...row, labelIds: labelIds.get(row.id) ?? [] })) });
}
