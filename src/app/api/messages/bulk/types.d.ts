/** `move`, `label` and `unlabel` take a `labelId`. */
export type BulkMessageAction = "archive" | "trash" | "spam" | "read" | "unread" | "inbox" | "move" | "label" | "unlabel" | "delete";

/** Folders whose messages can be permanently deleted or emptied in one go. */
export type PermanentDeleteFolder = "trash" | "spam";

export type BulkMessagePayload = {
	messageIds?: string[];
	action?: BulkMessageAction;
	labelId?: string;
};
