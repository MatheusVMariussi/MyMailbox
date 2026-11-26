import type { LABEL_COLOR_VALUES } from "./colors";

export type LabelColor = (typeof LABEL_COLOR_VALUES)[number];

export type LabelColorOption = {
	value: LabelColor;
	label: string;
};

/** A label row as the API returns it. Labels belong to one mailbox. */
export type LabelRecord = {
	id: string;
	userId: string;
	mailboxId: string;
	name: string;
	color: string;
	createdAt: Date;
};

/** One message carrying one label. */
export type LabelPair = {
	messageId: string;
	labelId: string;
};

/** The labels an action added to and removed from one message; undo reverts exactly these. */
export type MessageLabelDelta = {
	added: string[];
	removed: string[];
};

/** Outcome of one bounded label deletion call; `done` is false while memberships remain. */
export type LabelDeleteResult = {
	done: boolean;
	removed: number;
};
