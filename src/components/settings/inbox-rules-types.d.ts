export type RuleLabel = {
	id: string;
	name: string;
};

export type InboxRule = {
	id: string;
	pattern: string;
	matchField: "email" | "content" | "title" | "mail_type";
	matchOperator: "contains" | "exact";
	matchValue: string;
	action: "store" | "forward" | "reject" | "spam" | "trash";
	labelId: string | null;
	/** A matching store rule also archives the message. */
	skipInbox: boolean;
	forwardTo: string | null;
	keepCopy: boolean;
	priority: number;
};

export type InboxRuleInput = {
	mailboxId: string;
	matchField: "email" | "content" | "title" | "mail_type";
	matchOperator: "contains" | "exact";
	matchValue: string;
	destination: string;
	skipInbox?: boolean;
	forwardTo?: string;
	keepCopy?: boolean;
	priority: number;
	/** Step-up grant, sent when the server asks to confirm a forward to an outside address. */
	stepUpToken?: string;
};

export type InboxRulesResponse = {
	rules: InboxRule[];
	error?: string;
};

export type RuleLabelsResponse = {
	labels: RuleLabel[];
	error?: string;
};
