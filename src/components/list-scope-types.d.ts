/** What the mail lists show: one mailbox or all of them (null), optionally one project. */
export type ListScope = {
	mailboxId: string | null;
	projectId: string | null;
};

export type ListScopeContextValue = ListScope & {
	/** One mailbox, or null for the unified inbox of every accessible mailbox. Keeps the project filter. */
	setMailboxScope: (mailboxId: string | null) => void;
	/** One project, or null for every project. Keeps the mailbox scope. */
	setProjectFilter: (projectId: string | null) => void;
	/** True until the mailboxes are known, so lists do not fetch a scope that is about to change. */
	isLoading: boolean;
};
