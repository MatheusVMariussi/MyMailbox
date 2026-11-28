import type { MessageDirection, MessageFolder } from "@/hooks/types";

/** The way out of (or back from) where the message sits now; null when neither fits. */
export type RowSheetPrimaryMove = "archive" | "unarchive" | "notSpam" | "restore" | null;

/** A system folder "Move to" can send the message to; each is a bulk action of the same name. */
export type RowSheetMoveFolder = "inbox" | "archive" | "spam" | "trash";

export type RowSheetActions = {
	/** Mark read or unread. */
	readToggle: boolean;
	primaryMove: RowSheetPrimaryMove;
	snooze: "snooze" | "unsnooze" | null;
	reportSpam: boolean;
	/** Move to Trash (reversible, with undo). */
	trash: boolean;
	/** Remove for good; the server only destroys mail already in Trash or Spam. */
	deleteForever: boolean;
	moveFolders: RowSheetMoveFolder[];
};

export type RowSheetInput = {
	/** `messages.status`: received, sent, draft, spam, trash or archived. */
	status: string;
	direction: MessageDirection;
	snoozed: boolean;
};

/**
 * What the long-press sheet offers for one row. It follows the message's own
 * status rather than the folder on screen, because label views, Starred and
 * search list messages from several folders. Sent mail only gets the actions
 * that cannot file it as received mail (the bulk "inbox" action sets
 * `received`, which is wrong for a message we sent).
 */
export function getRowSheetActions({ status, direction, snoozed }: RowSheetInput): RowSheetActions {
	const inbound = direction === "inbound";
	const thrownAway = status === "trash" || status === "spam";
	return {
		readToggle: inbound && !thrownAway,
		primaryMove: inbound ? primaryMoveFor(status) : null,
		snooze: inbound && status === "received" ? (snoozed ? "unsnooze" : "snooze") : null,
		reportSpam: inbound && status !== "spam",
		trash: status !== "trash",
		deleteForever: thrownAway,
		moveFolders: moveFoldersFor(status, inbound),
	};
}

function primaryMoveFor(status: string): RowSheetPrimaryMove {
	if (status === "received") return "archive";
	if (status === "archived") return "unarchive";
	if (status === "spam") return "notSpam";
	if (status === "trash") return "restore";
	return null;
}

function moveFoldersFor(status: string, inbound: boolean): RowSheetMoveFolder[] {
	const current: Record<RowSheetMoveFolder, string> = { inbox: "received", archive: "archived", spam: "spam", trash: "trash" };
	const candidates: RowSheetMoveFolder[] = inbound ? ["inbox", "archive", "spam", "trash"] : ["trash"];
	return candidates.filter((folder) => current[folder] !== status);
}

/** Folders whose rows open the sheet on a long press; drafts and scheduled sends open the composer instead. */
export function supportsRowSheet(folder: MessageFolder, status: string): boolean {
	return folder !== "drafts" && folder !== "scheduled" && status !== "draft";
}
