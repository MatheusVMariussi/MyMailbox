import type { MessageLabelDelta } from "@/lib/labels/types";

/**
 * Explicit message actions whose effect can be reverted from the undo toast. `label` and `unlabel`
 * add or remove one label; `move` adds one and archives mail that was in the inbox (or Trash/Spam).
 */
export type ReversibleMessageAction =
	| "archive"
	| "trash"
	| "spam"
	| "inbox"
	| "move"
	| "label"
	| "unlabel"
	| "read"
	| "unread"
	| "star"
	| "unstar"
	| "snooze"
	| "unsnooze";

/** The message fields an action may change. Undo restores only the fields it changed. Labels travel as a delta. */
export type MessageStateSnapshot = {
	status: string;
	read: boolean;
	starred: boolean;
	snoozedUntil: string | null;
};

export type MessageStateField = keyof MessageStateSnapshot;

/** One successfully applied message, with the server-confirmed before and after states. */
export type MessageActionRecord = {
	id: string;
	mailboxId: string | null;
	previous: MessageStateSnapshot;
	applied: MessageStateSnapshot;
	/** The labels this action really added and removed; undo reverts exactly these pairs. */
	labels?: MessageLabelDelta;
};

export type MessageActionSkipReason =
	| "not_found"
	| "forbidden"
	| "not_applicable"
	| "invalid_target"
	| "stale"
	| "failed";

export type MessageActionSkipped = {
	id: string;
	reason: MessageActionSkipReason;
};

export type MessageActionInput = {
	action: ReversibleMessageAction;
	messageIds: string[];
	/** The label for `move`, `label` and `unlabel`. */
	labelId?: string | null;
	snoozedUntil?: string | null;
};

export type MessageActionResponse = {
	ok: true;
	action: ReversibleMessageAction;
	applied: MessageActionRecord[];
	skipped: MessageActionSkipped[];
	/** Signed, short-lived proof of the server-confirmed previous states. */
	undoToken?: string;
};

export type UndoMessageActionResponse = {
	ok: true;
	action: ReversibleMessageAction;
	restored: string[];
	skipped: MessageActionSkipped[];
};

/** Payload carried by the signed undo token; never trusted from the request body directly. */
export type MessageUndoTokenPayload = {
	v: 3;
	issuedAt: number;
	action: ReversibleMessageAction;
	/** The session user who received the token; another user cannot redeem it. */
	userId: string;
	/** Single-use claim key. */
	nonce: string;
	records: MessageActionRecord[];
};

export type MessageActionRequestOptions = {
	/** Show the independent undo toast. Defaults to true for explicit actions. */
	undo?: boolean;
	/** Suppress the global cache/change event; the caller owns optimistic state. */
	notify?: boolean;
};

export type MessageActionTransportBody =
	| ({
			op: "apply";
	  } & MessageActionInput)
	| {
			op: "undo";
			token: string;
	  };
