import type { MessageCounts, MessageFolder } from "@/hooks/types";
import { performMessageAction } from "@/lib/messages/actions/client";

export function getFolderNavCount(folder: MessageFolder, counts: MessageCounts["folders"]): number | undefined {
	return counts[folder].unread;
}

async function moveMessages(payload: { messageIds: string[]; action: "archive" | "spam" | "trash" | "move"; labelId?: string }) {
	await performMessageAction(payload);
}

export function moveMessagesToSystemFolder(messageIds: string[], action: "archive" | "spam" | "trash") {
	return moveMessages({ messageIds, action });
}

/** Dropping mail on a label means "Move to": add the label and take inbox mail out of the inbox. */
export function moveMessagesToLabel(messageIds: string[], labelId: string) {
	return moveMessages({ messageIds, action: "move", labelId });
}
