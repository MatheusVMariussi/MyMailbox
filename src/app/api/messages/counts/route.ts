import { and, count, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { scheduledMessageCondition } from "@/lib/email/scheduled";
import { draftsVisibleTo } from "@/lib/email/draft-access";
import { activePromotionModes, applyPromotionCounts, buildMessageCounts, inCountScope } from "./utils";
import { parseProjectParam } from "@/lib/projects/project-utils";
import { loadPromotionModes } from "@/lib/promotions/settings";
import { getMailboxAccessLevel, listAccessibleMailboxIds } from "@/lib/mailboxes/access";
import { countLabelMessages } from "@/lib/labels/service";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	// Narrows the folder counts; per-project counts always cover the whole mailbox scope.
	const scope = { projectId: parseProjectParam(url.searchParams.get("projectId")) };
	const db = getDb(env);
	const conditions: SQL[] = [];
	let mailboxIds: string[] = [];

	if (mailboxId) {
		const access = await getMailboxAccessLevel(db, user, mailboxId);
		if (!access?.canRead) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		conditions.push(eq(messages.mailboxId, mailboxId));
		mailboxIds = [mailboxId];
	} else {
		const accessibleMailboxIds = await listAccessibleMailboxIds(db, user);
		mailboxIds = accessibleMailboxIds;
		if (accessibleMailboxIds.length > 0) {
			conditions.push(inArray(messages.mailboxId, accessibleMailboxIds));
		} else {
			conditions.push(eq(messages.userId, user.id));
		}
	}

	conditions.push(draftsVisibleTo(user.id));

	const rows = await db
		.select({
			mailboxId: messages.mailboxId,
			direction: messages.direction,
			status: messages.status,
			read: messages.read,
			starred: messages.starred,
			snoozedUntil: messages.snoozedUntil,
			projectId: messages.projectId,
			total: count(),
			scheduledTotal: sql<number>`sum(case when ${scheduledMessageCondition(db)} then 1 else 0 end)`,
		})
		.from(messages)
		.where(and(...conditions))
		.groupBy(
			messages.mailboxId,
			messages.direction,
			messages.status,
			messages.read,
			messages.starred,
			messages.snoozedUntil,
			// The draft columns sit between snooze and project in messages_counts_cover_idx; grouping on them
			// keeps the GROUP BY in index order (no temporary sort), at the cost of a few more groups.
			messages.userId,
			messages.privateDraft,
			messages.projectId,
		);

	const counts = buildMessageCounts(rows, scope);
	counts.folders.scheduled.total = rows.reduce((total, row) => total + (inCountScope(row, scope) ? Number(row.scheduledTotal) || 0 : 0), 0);
	counts.labels = await countLabelMessages(db, mailboxIds, user.id);

	// Promotions get their own query, and only for mailboxes that opted in, so the grouped query above is unchanged.
	const modes = await loadPromotionModes(db, mailboxIds);
	counts.promotionModes = activePromotionModes(modes);
	const activeIds = Object.keys(counts.promotionModes);
	if (activeIds.length > 0) {
		const promotionRows = await db
			.select({ mailboxId: messages.mailboxId, read: messages.read, projectId: messages.projectId, total: count() })
			.from(messages)
			.where(and(
				inArray(messages.mailboxId, activeIds),
				eq(messages.direction, "inbound"),
				eq(messages.status, "received"),
				eq(messages.category, "promotions"),
				or(isNull(messages.snoozedUntil), lte(messages.snoozedUntil, new Date())),
			))
			// Grouped in index order (snooze sits between read and project), so no temporary sort.
			.groupBy(messages.mailboxId, messages.read, messages.snoozedUntil, messages.projectId);
		applyPromotionCounts(counts, promotionRows, new Set(activeIds.filter((id) => modes.get(id) === "separate")), scope);
	}

	return NextResponse.json({ counts });
}
