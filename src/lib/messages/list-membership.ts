import type { MessageFolder } from "@/hooks/types";
import type { MessageStateSnapshot } from "./actions/types";
import { labelFilterMatches } from "@/lib/labels/label-utils";

/** The fields that decide which folder lists still contain a message. */
export type MessageMembershipFields = Pick<
	MessageStateSnapshot,
	"status" | "snoozedUntil" | "starred"
> & {
	/** Optional: rows from servers or caches that predate promotions have none. */
	category?: string | null;
	/** Optional: unknown labels count as still carrying the label being viewed. */
	labelIds?: string[];
};

/** Statuses a label view never lists (Gmail keeps labelled mail in Trash and Spam out of the label). */
const OUTSIDE_LABEL_VIEWS = new Set(["trash", "spam", "template"]);

function snoozedAt(value: string | null | undefined, now: number): boolean {
	if (!value) return false;
	const time = Date.parse(value);
	return Number.isFinite(time) && time > now;
}

/**
 * Mirrors the server's list filters in `src/app/api/messages/route.ts`.
 * A paginated list only contains rows whose current state matches its query.
 */
export function messageMatchesFolder(
	state: MessageMembershipFields,
	folder: MessageFolder,
	labelId?: string | null,
	now = Date.now(),
): boolean {
	if (labelId) {
		// A label view lists every direction and status except Trash and Spam; snoozed mail stays listed.
		// `labelId` may be a comma-separated group of same-named labels (the unified sidebar).
		if (OUTSIDE_LABEL_VIEWS.has(state.status)) return false;
		return state.labelIds === undefined || labelFilterMatches(state.labelIds, labelId);
	}
	if (folder === "starred") return state.starred;
	// Labels never take mail out of the inbox: only status and snooze decide.
	if (folder === "inbox") {
		return state.status === "received"
			&& !snoozedAt(state.snoozedUntil, now);
	}
	// Inbox membership above ignores the category on purpose: the mailbox's promotions mode is not known
	// here, so a promotion restored to Inbox in a "separate" mailbox may show in a cached Inbox list until
	// the next refetch.
	if (folder === "promotions") {
		return state.status === "received"
			&& !snoozedAt(state.snoozedUntil, now)
			&& state.category === "promotions";
	}
	if (folder === "snoozed") {
		return state.status === "received"
			&& snoozedAt(state.snoozedUntil, now);
	}
	if (folder === "sent") return state.status === "sent";
	if (folder === "scheduled") return state.status === "queued";
	if (folder === "drafts") return state.status === "draft";
	return state.status === folder;
}

/**
 * Reads the list identity back from the request key so cache ingress can apply
 * membership without the hook passing folder/labelId through every call.
 */
export function getListMembershipContext(
	params: URLSearchParams | string,
): { folder: MessageFolder; labelId?: string | null } | null {
	const search = typeof params === "string" ? new URLSearchParams(params) : params;
	const labelId = search.get("labelId");
	if (labelId) return { folder: "inbox", labelId };
	if (search.get("starred") === "true") return { folder: "starred" };
	if (search.get("snoozed") === "true") return { folder: "snoozed" };
	if (search.get("scheduled") === "true") return { folder: "scheduled" };
	const status = search.get("status");
	const direction = search.get("direction");
	if (direction === "inbound" && status === "received" && search.get("category") === "promotions") return { folder: "promotions" };
	if (direction === "inbound" && status === "received") return { folder: "inbox" };
	if (direction === "outbound" && status === "sent") return { folder: "sent" };
	if (direction === "outbound" && status === "draft") return { folder: "drafts" };
	if (status === "archived" || status === "trash" || status === "spam") return { folder: status };
	return null;
}

/**
 * Tombstones survive pagination: a row moved from page 2 should return to the
 * same list even if backfill changed the offset before the undo completes.
 */
export function getListMembershipKey(params: URLSearchParams | string): string {
	const search = new URLSearchParams(typeof params === "string" ? params : params.toString());
	search.delete("offset");
	search.delete("limit");
	return search.toString();
}
