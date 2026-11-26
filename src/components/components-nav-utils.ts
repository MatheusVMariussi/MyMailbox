import { getMessageQueryParams, fetchMessageList } from "@/hooks/utils";
import type { MessageFolder } from "@/hooks/types";

export type MailboxPrefetchOptions = {
	query?: string;
	grouped?: boolean;
	projectId?: string | null;
};

export async function preloadMailboxPage(href: string, mailboxId?: string, options: MailboxPrefetchOptions = {}) {
	const labelMatch = href.match(/^\/labels\/([^/]+)$/);
	const folder = (labelMatch ? "inbox" : href.slice(1)) as MessageFolder;
	const supportedFolders: MessageFolder[] = ["inbox", "promotions", "starred", "snoozed", "sent", "scheduled", "drafts", "archived", "spam", "trash"];
	if (!supportedFolders.includes(folder)) return;

	const params = getMessageQueryParams(
		folder,
		mailboxId,
		{
			query: options.query?.trim() || undefined,
			read: "all",
			limit: 25,
			offset: 0,
			group: options.grouped && folder !== "drafts" ? "thread" : undefined,
			projectId: options.projectId,
		},
		labelMatch ? decodeURIComponent(labelMatch[1]) : undefined,
	);
	await fetchMessageList(params).catch(() => undefined);
}
