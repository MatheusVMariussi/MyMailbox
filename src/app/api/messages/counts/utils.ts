import type { MessageCounts, MessageFolder } from "@/hooks/types";
import type { PromotionMode } from "@/lib/promotions/settings";
import type { CountableFolder, MessageCountRow, MessageCountScope, PromotionCountRow } from "./types";

export function getMessageFolder(row: MessageCountRow): CountableFolder {
	if (row.snoozedUntil && row.snoozedUntil > new Date()) return "snoozed";
	if (row.status === "trash") return "trash";
	if (row.status === "spam") return "spam";
	if (row.status === "archived") return "archived";
	// Labels never take mail out of the inbox.
	if (row.direction === "inbound" && row.status === "received") return "inbox";
	if (row.direction === "outbound" && row.status === "sent") return "sent";
	if (row.direction === "outbound" && row.status === "draft") return "drafts";
	return null;
}

export function createEmptyFolderCounts(): MessageCounts["folders"] {
	return {
		inbox: { total: 0, unread: 0 },
		promotions: { total: 0, unread: 0 },
		starred: { total: 0, unread: 0 },
		snoozed: { total: 0, unread: 0 },
		sent: { total: 0, unread: 0 },
		scheduled: { total: 0, unread: 0 },
		drafts: { total: 0, unread: 0 },
		archived: { total: 0, unread: 0 },
		spam: { total: 0, unread: 0 },
		trash: { total: 0, unread: 0 },
	};
}

/** Whether a grouped row counts toward the folders of this scope. */
export function inCountScope(row: { projectId?: string | null }, scope: MessageCountScope = {}): boolean {
	return !scope.projectId || row.projectId === scope.projectId;
}

/**
 * Folder, mailbox and per-project counts from the grouped rows. With a project in `scope` the folder and
 * mailbox counts cover that project only; `projects` (Inbox per project) always covers every project.
 */
export function buildMessageCounts(rows: MessageCountRow[], scope: MessageCountScope = {}): MessageCounts {
	const folders = createEmptyFolderCounts();
	const mailboxMap = new Map<string, { mailboxId: string; total: number; unread: number; inbox: number }>();
	const projects: Record<string, { total: number; unread: number }> = {};

	for (const row of rows) {
		const weight = row.total ?? 1;
		const folder = getMessageFolder(row);
		const unread = row.direction === "inbound" && !row.read;
		if (folder === "inbox" && row.projectId) {
			const project = projects[row.projectId] ?? { total: 0, unread: 0 };
			project.total += weight;
			if (unread) project.unread += weight;
			projects[row.projectId] = project;
		}
		if (!inCountScope(row, scope)) continue;
		if (row.starred) {
			folders.starred.total += weight;
			if (unread) folders.starred.unread += weight;
		}
		if (folder) {
			folders[folder].total += weight;
			if (unread) folders[folder].unread += weight;
		}

		if (!row.mailboxId) continue;

		const mailboxCount = mailboxMap.get(row.mailboxId) ?? {
			mailboxId: row.mailboxId,
			total: 0,
			unread: 0,
			inbox: 0,
		};
		mailboxCount.total += weight;
		if (unread) mailboxCount.unread += weight;
		if (folder === "inbox") mailboxCount.inbox += weight;
		mailboxMap.set(row.mailboxId, mailboxCount);
	}

	return {
		folders,
		labels: {},
		projects,
		mailboxes: Array.from(mailboxMap.values()),
	};
}

/**
 * Adds the promotions folder from its own grouped rows (received, unsnoozed, category promotions, only
 * for mailboxes whose mode is `show` or `separate`). Mailboxes in `separate` mode lose those rows from Inbox.
 */
export function applyPromotionCounts(
	counts: MessageCounts,
	rows: PromotionCountRow[],
	separateIds: ReadonlySet<string>,
	scope: MessageCountScope = {},
): void {
	for (const row of rows) {
		const weight = Number(row.total) || 0;
		const separate = !!row.mailboxId && separateIds.has(row.mailboxId);
		// A separate mailbox's promotions leave its projects' Inbox counts too, whatever the scope.
		const project = separate && row.projectId ? counts.projects?.[row.projectId] : undefined;
		if (project) {
			project.total -= weight;
			if (!row.read) project.unread -= weight;
		}
		if (!inCountScope(row, scope)) continue;
		counts.folders.promotions.total += weight;
		if (!row.read) counts.folders.promotions.unread += weight;
		if (!separate) continue;
		counts.folders.inbox.total -= weight;
		if (!row.read) counts.folders.inbox.unread -= weight;
		const mailbox = counts.mailboxes.find((entry) => entry.mailboxId === row.mailboxId);
		if (mailbox) mailbox.inbox -= weight;
	}
}

export function getFolderLabelCount(folder: MessageFolder, counts: MessageCounts["folders"]) {
	return counts[folder].unread;
}

/** The mailboxes with Promotions turned on, with their mode. The client builds its nav entry and row actions from this, so off mailboxes stay out. */
export function activePromotionModes(modes: ReadonlyMap<string, PromotionMode>): Record<string, Exclude<PromotionMode, "off">> {
	const active: Record<string, Exclude<PromotionMode, "off">> = {};
	for (const [mailboxId, mode] of modes) if (mode !== "off") active[mailboxId] = mode;
	return active;
}
