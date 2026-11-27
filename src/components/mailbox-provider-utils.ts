import { authFetch, getClientSessionKey } from "@/lib/auth/client";
import type { MailboxOption } from "./mailbox-provider";

let mailboxesCache: MailboxOption[] | null = null;
let mailboxesCacheSessionToken: string | null = null;
let mailboxesRequest: Promise<MailboxOption[]> | null = null;
let mailboxesRequestSessionToken: string | null = null;
let cacheGeneration = 0;
export const SELECTED_MAILBOX_STORAGE_KEY = "selected-mailbox-id";
/** Fired after mailboxes or domains are added, removed or changed, so every mounted MailboxProvider reloads. */
export const MAILBOXES_CHANGED_EVENT = "mymailbox:mailboxes-changed";

/**
 * The primary mailbox is the one at the account address; it is the only mailbox
 * whose name and avatar follow the profile.
 */
export function isIdentityMailbox(mailbox: Pick<MailboxOption, "type" | "isPrimary">): boolean {
	return mailbox.type === "personal" && !!mailbox.isPrimary;
}

export function clearMailboxesCache() {
	cacheGeneration += 1;
	mailboxesCache = null;
	mailboxesCacheSessionToken = null;
	mailboxesRequest = null;
	mailboxesRequestSessionToken = null;
}

/**
 * Mailboxes or domains changed (a domain changes the sender addresses of mailboxes on every domain): drop the
 * cached list so a provider mounted later fetches it again, and tell the mounted ones to reload now.
 */
export function notifyMailboxesChanged(): void {
	clearMailboxesCache();
	if (typeof window !== "undefined") window.dispatchEvent(new Event(MAILBOXES_CHANGED_EVENT));
}

/** The stored choice while it still exists, otherwise the primary mailbox, otherwise the first one. */
export function pickSelectedMailbox<T extends { id: string; isPrimary?: boolean }>(items: T[], storedId: string | null): T | null {
	return (storedId ? items.find((mailbox) => mailbox.id === storedId) : undefined)
		?? items.find((mailbox) => mailbox.isPrimary)
		?? items[0]
		?? null;
}

export function clearMailboxClientState() {
	clearMailboxesCache();
	if (typeof window !== "undefined") {
		localStorage.removeItem(SELECTED_MAILBOX_STORAGE_KEY);
	}
}

export async function fetchMailboxOptions(force = false): Promise<MailboxOption[]> {
	const sessionToken = getClientSessionKey();
	if (!force && mailboxesCache && mailboxesCacheSessionToken === sessionToken) return mailboxesCache;
	if (!force && mailboxesRequest && mailboxesRequestSessionToken === sessionToken) return mailboxesRequest;

	const requestGeneration = cacheGeneration;
	mailboxesRequestSessionToken = sessionToken;
	mailboxesRequest = authFetch("/api/mailboxes")
		.then(async (res) => {
			// A failed request must not read as "no mailboxes": callers keep what they had.
			if (!res.ok) throw new Error(`Unable to load mailboxes (${res.status})`);
			return res.json();
		})
		.then((data) => {
			const items = ((data as { mailboxes?: MailboxOption[] }).mailboxes ?? []).map((m) => ({
				id: m.id,
				domainId: m.domainId,
				localPart: m.localPart,
				hostname: m.hostname,
				displayName: m.displayName,
				signature: m.signature,
				autoReplyEnabled: m.autoReplyEnabled,
				autoReplySubject: m.autoReplySubject,
				autoReplyBody: m.autoReplyBody,
				hasAvatar: m.hasAvatar,
				type: m.type,
				permission: m.permission,
				isPrimary: m.isPrimary,
				senderAddresses: m.senderAddresses,
			}));
			if (requestGeneration === cacheGeneration) {
				mailboxesCache = items;
				mailboxesCacheSessionToken = sessionToken;
			}
			return items;
		})
		.finally(() => {
			if (requestGeneration === cacheGeneration) {
				mailboxesRequest = null;
				mailboxesRequestSessionToken = null;
			}
		});

	return mailboxesRequest;
}
