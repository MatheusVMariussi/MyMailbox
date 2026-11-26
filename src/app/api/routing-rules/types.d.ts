export type RuleTarget = {
	action: "store" | "forward" | "spam" | "trash";
	labelId: string | null;
	skipInbox: boolean;
	forwardTo: string | null;
	keepCopy: boolean;
};
