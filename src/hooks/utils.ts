import { authFetch } from "@/lib/auth/client";
import { getUserTimeZone } from "@/lib/time/utils";
import { patchCachedMessage } from "@/lib/messages/detail-cache";
import {
	applyPendingToMessageList,
	applyPendingToMessages,
	getThreadUnreadTargets,
	rememberMessageRows,
	type ThreadUnreadTarget,
} from "@/lib/messages/field-store";
import {
	applyMembershipToList,
	clearMembershipState,
	rememberMembershipRows,
} from "@/lib/messages/membership-store";
import { isReadOnlyChange, type MessageFieldPatch } from "@/lib/messages/change-events";
import type { MessageFilterOptions, MessageFolder } from "./types";
import type { MessageCounts, MessageListResponse } from "./types";

/** The filters of a folder or label view. */
function setFolderParams(params: URLSearchParams, folder: MessageFolder, labelId?: string | null) {
	// A label view lists every direction and status (but Trash and Spam), so it sets no folder filter.
	if (labelId) params.set("labelId", labelId);
	else if (folder === "inbox") {
		params.set("direction", "inbound");
		params.set("status", "received");
	}
	if (folder === "promotions") {
		params.set("direction", "inbound");
		params.set("status", "received");
		params.set("category", "promotions");
	}
	else if (folder === "starred") params.set("starred", "true");
	else if (folder === "snoozed") params.set("snoozed", "true");
	else if (folder === "sent") {
		params.set("direction", "outbound");
		params.set("status", "sent");
	} else if (folder === "scheduled") {
		params.set("direction", "outbound");
		params.set("scheduled", "true");
	} else if (folder === "drafts") {
		params.set("direction", "outbound");
		params.set("status", "draft");
	} else if (folder === "archived" || folder === "trash" || folder === "spam") {
		params.set("status", folder);
	}
}

/**
 * The list request for a folder, or for a search. A search (a non-empty query) goes to the server whole with
 * `scope=search`, which spans every folder as in Gmail, so no folder or label filter is sent; the mailbox,
 * project and unread toggle still apply. Nothing is lifted out of the query: `is:unread` inside an OR or a
 * negation only means what it says on the server, which parses the whole tree.
 */
export function getMessageQueryParams(
	folder: MessageFolder,
	mailboxId?: string | null,
	filters?: MessageFilterOptions,
	labelId?: string | null,
) {
	const params = new URLSearchParams();
	params.set("timeZone", getUserTimeZone());
	const query = filters?.query?.trim();
	if (query) {
		params.set("scope", "search");
		params.set("q", query);
	} else {
		setFolderParams(params, folder, labelId);
	}
	if (mailboxId) params.set("mailboxId", mailboxId);
	if (filters?.title?.trim()) params.set("title", filters.title.trim());
	if (filters?.read && filters.read !== "all") params.set("read", filters.read);
	if (filters?.limit) params.set("limit", String(filters.limit));
	if (filters?.offset) params.set("offset", String(filters.offset));
	if (filters?.group) params.set("group", filters.group);
	if (filters?.projectId) params.set("projectId", filters.projectId);

	return params;
}

/** A list request the server refused; a 400 is a search it could not run (too long or too complex). */
export class MessageListRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "MessageListRequestError";
	}
}

const messageCountsCache = new Map<string, MessageCounts>();
const messageCountsRequests = new Map<string, Promise<MessageCounts | undefined>>();
const messageListCache = new Map<string, MessageListResponse>();
const messageListRequests = new Map<string, Promise<MessageListResponse>>();
let messageCacheGeneration = 0;
let messageCountsGeneration = 0;

export function clearMessageCountsCache() {
	messageCountsGeneration += 1;
	messageCountsCache.clear();
	messageCountsRequests.clear();
}

export function clearMessageListCache() {
	messageCacheGeneration += 1;
	messageListCache.clear();
	messageListRequests.clear();
}

/** Drops in-flight list requests without throwing away already-patched cached pages. */
export function invalidateMessageListRequests() {
	messageCacheGeneration += 1;
	messageListRequests.clear();
}

export type CachedMessagePatch = {
	read?: boolean;
	starred?: boolean;
};

export type MessageCachePatchOptions = {
	/** Pre-click grouped targets used when rolling back a failed/skipped undo. */
	threadTargets?: Iterable<ThreadUnreadTarget>;
};

function groupFieldPatches(fields: MessageFieldPatch[]): Map<string, CachedMessagePatch> {
	const patches = new Map<string, CachedMessagePatch>();
	for (const field of fields) {
		if (field.read === undefined && field.starred === undefined) continue;
		const current = patches.get(field.id) ?? {};
		if (field.read !== undefined) current.read = field.read;
		if (field.starred !== undefined) current.starred = field.starred;
		patches.set(field.id, current);
	}
	return patches;
}

/**
 * Mirrors field changes into every cached list page and detail. Grouped rows
 * receive an absolute unread target computed from actual member transitions,
 * so applying the same desired value twice cannot move the count twice.
 */
export function patchMessageFieldsInCaches(
	fields: MessageFieldPatch[],
	options: MessageCachePatchOptions = {},
): ThreadUnreadTarget[] {
	const patches = groupFieldPatches(fields);
	const computedTargets = patches.size === 0
		? []
		: getThreadUnreadTargets([...patches].map(([id, patch]) => ({
			id,
			...(patch.read !== undefined ? { read: patch.read } : {}),
		})));
	const forcedTargets = options.threadTargets
		? new Map([...options.threadTargets].map((target) => [target.id, target.threadUnread]))
		: null;
	const targets = computedTargets.map((target) => ({
		id: target.id,
		threadUnread: Math.max(0, Math.trunc(forcedTargets?.get(target.id) ?? target.threadUnread)),
	}));
	if (forcedTargets) {
		for (const [id, threadUnread] of forcedTargets) {
			if (!targets.some((target) => target.id === id)) {
				targets.push({ id, threadUnread: Math.max(0, Math.trunc(threadUnread)) });
			}
		}
	}
	if (patches.size === 0 && targets.length === 0) return [];
	const targetsById = new Map(targets.map((target) => [target.id, target.threadUnread]));
	const ids = new Set(patches.keys());
	invalidateMessageListRequests();
	for (const [key, response] of messageListCache) {
		if (!response.messages?.some((message) => patches.has(message.id)
			|| message.threadMessageIds?.some((id) => ids.has(id))
			|| targetsById.has(message.id))) continue;
		const messages = response.messages.map((message) => {
			const direct = patches.get(message.id);
			if (message.threadMessageIds?.length) {
				const threadTarget = targetsById.get(message.id);
				const memberPatch = message.threadMessageIds
					.map((id) => patches.get(id))
					.find((patch): patch is CachedMessagePatch => !!patch);
				const next = { ...message };
				let changed = false;
				if (threadTarget !== undefined) {
					const threadUnread = Math.min(message.threadMessageIds.length, threadTarget);
					if (next.threadUnread !== threadUnread) {
						next.threadUnread = threadUnread;
						changed = true;
					}
					const read = threadUnread === 0;
					if (next.read !== read) {
						next.read = read;
						changed = true;
					}
				}
				const starred = direct?.starred ?? memberPatch?.starred;
				if (starred !== undefined && next.starred !== starred) {
					next.starred = starred;
					changed = true;
				}
				return changed ? next : message;
			}
			if (!direct) return message;
			const next = { ...message, ...direct };
			return next.read === message.read && next.starred === message.starred ? message : next;
		});
		// A refresh during a pending undo must not see the server's pre-undo value.
		const pendingMessages = applyPendingToMessages(messages);
		messageListCache.set(key, { ...response, messages: pendingMessages });
		rememberMessageRows(pendingMessages);
		rememberMembershipRows(pendingMessages);
	}
	for (const [id, patch] of patches) patchCachedMessage(id, patch);
	return targets;
}

export function markMessagesReadInCaches(messageIds: string[], read: boolean) {
	patchMessageFieldsInCaches(messageIds.map((id) => ({ id, read })));
}

// Caches must drop on every change, including ones made while no list is mounted
// (e.g. reading a message from the popup on a page without the inbox list).
if (typeof window !== "undefined") {
	window.addEventListener("mymailbox:messages-changed", (event) => {
		if (!isReadOnlyChange(event)) clearMessageListCache();
		clearMessageCountsCache();
	});
}

export function clearMessageClientState() {
	messageCacheGeneration += 1;
	messageCountsGeneration += 1;
	messageCountsCache.clear();
	messageCountsRequests.clear();
	messageListCache.clear();
	messageListRequests.clear();
	clearMembershipState();
}

export async function fetchMessageCounts(mailboxId?: string | null, force = false, projectId?: string | null): Promise<MessageCounts | undefined> {
	const key = `${mailboxId ?? "all"}\u0000${projectId ?? ""}`;
	if (!force && messageCountsCache.has(key)) return messageCountsCache.get(key);
	if (!force && messageCountsRequests.has(key)) return messageCountsRequests.get(key);

	const requestGeneration = messageCacheGeneration;
	const countsGeneration = messageCountsGeneration;
	const request = (async () => {
		const params = new URLSearchParams();
		if (mailboxId) params.set("mailboxId", mailboxId);
		if (projectId) params.set("projectId", projectId);
		const query = params.toString();
		const res = await authFetch(`/api/messages/counts${query ? `?${query}` : ""}`);
		if (!res.ok) throw new Error(`Message counts request failed (${res.status})`);
		const data = (await res.json()) as { counts?: MessageCounts };
		const counts = data.counts;
		if (
			counts &&
			requestGeneration === messageCacheGeneration &&
			countsGeneration === messageCountsGeneration
		) {
			messageCountsCache.set(key, counts);
		}
		return counts;
	})().finally(() => {
		if (messageCountsRequests.get(key) === request) {
			messageCountsRequests.delete(key);
		}
	});

	messageCountsRequests.set(key, request);
	return request;
}

export function peekMessageList(params: URLSearchParams): MessageListResponse | undefined {
	const key = params.toString();
	const response = messageListCache.get(key);
	if (!response) return undefined;
	return applyMembershipToList(applyPendingToMessageList(response), key);
}

export async function fetchMessageList(params: URLSearchParams, force = false): Promise<MessageListResponse> {
	const key = params.toString();
	if (!force && messageListCache.has(key)) {
		return applyMembershipToList(applyPendingToMessageList(messageListCache.get(key) ?? {}), key);
	}
	if (!force && messageListRequests.has(key)) return messageListRequests.get(key) ?? {};
	const requestGeneration = messageCacheGeneration;
	const request = authFetch(`/api/messages?${key}`)
		.then(async (res) => {
			// An error body is not a message list; do not cache it or paint it as an empty folder.
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				throw new MessageListRequestError(body?.error ?? `Message list request failed (${res.status})`, res.status);
			}
			return res.json();
		})
		.then((data) => {
			// Overlay the read/star fields before caching, so a refresh that started
			// while an undo is pending cannot repaint the server value. Membership is
			// derived at read time because its totals depend on the current overlay
			// and restored rows.
			const response = applyPendingToMessageList(data as MessageListResponse);
			if (requestGeneration === messageCacheGeneration) {
				messageListCache.set(key, response);
				rememberMessageRows(response.messages ?? []);
				rememberMembershipRows(response.messages ?? []);
			}
			return applyMembershipToList(response, key);
		})
		.finally(() => {
			if (requestGeneration === messageCacheGeneration) {
				messageListRequests.delete(key);
			}
		});

	messageListRequests.set(key, request);
	return request;
}
