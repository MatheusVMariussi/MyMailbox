"use client";

import { AUTH_SESSION_CHANGED_EVENT, authFetch, getClientSessionKey } from "@/lib/auth/client";

const CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 32;
const MAX_INVALIDATION_RETRIES = 8;
const cache = new Map<string, { expiresAt: number; data: LabelListResponse }>();
const requests = new Map<string, Promise<LabelListResponse>>();
let epoch = 0;
let sessionEpoch = 0;
let listenersInstalled = false;

export type LabelListResponse = { labels?: unknown[]; error?: string };

/** Pass as the mailbox id to load the labels of every accessible mailbox (the unified inbox). */
export const ALL_MAILBOXES = "*";

/** Fired after a label is created, renamed, recolored or deleted. */
export const LABELS_CHANGED_EVENT = "mymailbox:labels-changed";

function invalidate(): void {
	++epoch;
	cache.clear();
	requests.clear();
}

function invalidateSession(): void {
	++sessionEpoch;
	invalidate();
}

function installInvalidationListeners(): void {
	if (listenersInstalled || typeof window === "undefined") return;
	listenersInstalled = true;
	window.addEventListener(AUTH_SESSION_CHANGED_EVENT, invalidateSession);
	window.addEventListener("mymailbox:messages-changed", invalidate);
	window.addEventListener(LABELS_CHANGED_EVENT, invalidate);
}

/** Drops cached label lists and tells every consumer (sidebar, menus, rules) to reload. */
export function invalidateLabelCache(): void {
	invalidate();
	if (typeof window !== "undefined") window.dispatchEvent(new window.Event(LABELS_CHANGED_EVENT));
}

/** The labels of one mailbox (or of all, with `ALL_MAILBOXES`), cached briefly and shared between concurrent callers. */
export async function getMailboxLabels<T extends LabelListResponse = LabelListResponse>(
	mailboxId: string,
): Promise<T> {
	installInvalidationListeners();
	const sessionToken = getClientSessionKey();
	const requestSessionEpoch = sessionEpoch;
	const key = `${sessionToken ?? ""}\u0000${mailboxId}`;
	for (let retries = 0; ; retries++) {
		if (sessionEpoch !== requestSessionEpoch || sessionToken !== getClientSessionKey()) {
			throw new Error("Label request was invalidated");
		}
		const now = Date.now();
		const cached = cache.get(key);
		if (cached && cached.expiresAt > now) {
			cache.delete(key);
			cache.set(key, cached);
			return cached.data as T;
		}
		if (cached) cache.delete(key);

		const requestEpoch = epoch;
		let request = requests.get(key);
		if (!request) {
			request = (async () => {
				const params = new URLSearchParams(mailboxId === ALL_MAILBOXES ? {} : { mailboxId });
				const query = params.toString();
				const response = await authFetch(`/api/labels${query ? `?${query}` : ""}`, { cache: "no-store" });
				const data = (await response.json()) as LabelListResponse;
				if (!response.ok) throw new Error(data.error ?? "Unable to load labels");
				if (requestEpoch !== epoch || sessionEpoch !== requestSessionEpoch ||
					sessionToken !== getClientSessionKey() || requests.get(key) !== request) {
					throw new Error("Label request was invalidated");
				}
				cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
				if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
				return data;
			})();
			requests.set(key, request);
		}
		try {
			const data = await request;
			if (sessionEpoch !== requestSessionEpoch || sessionToken !== getClientSessionKey()) {
				throw new Error("Label request was invalidated");
			}
			if (requestEpoch !== epoch) {
				if (retries >= MAX_INVALIDATION_RETRIES) throw new Error("Label request was invalidated");
				continue;
			}
			return data as T;
		} catch (error) {
			if (sessionEpoch !== requestSessionEpoch || sessionToken !== getClientSessionKey()) {
				throw new Error("Label request was invalidated");
			}
			if (requestEpoch === epoch || retries >= MAX_INVALIDATION_RETRIES) throw error;
		} finally {
			if (requests.get(key) === request) requests.delete(key);
		}
	}
}

type LabelWrite = { id: string; mailboxId: string; name: string; color: string };

async function readError(response: Response, fallback: string): Promise<Error> {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
	return new Error(typeof body?.error === "string" ? body.error : fallback);
}

export async function createLabelRequest(input: { mailboxId: string; name: string; color: string }, fallbackError: string): Promise<LabelWrite> {
	const response = await authFetch("/api/labels", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) throw await readError(response, fallbackError);
	const label = (await response.json()) as LabelWrite;
	invalidateLabelCache();
	return label;
}

export async function updateLabelRequest(labelId: string, patch: { name?: string; color?: string }, fallbackError: string): Promise<LabelWrite> {
	const response = await authFetch(`/api/labels/${encodeURIComponent(labelId)}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
	if (!response.ok) throw await readError(response, fallbackError);
	const label = (await response.json()) as LabelWrite;
	invalidateLabelCache();
	return label;
}

/** Deletes a label; the server empties a large one in bounded steps, so keep asking until it is done. */
export async function deleteLabelRequest(labelId: string, fallbackError: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const response = await authFetch(`/api/labels/${encodeURIComponent(labelId)}`, { method: "DELETE" });
		if (!response.ok) throw await readError(response, fallbackError);
		const result = (await response.json()) as { done?: boolean; removed?: number };
		if (result.done) {
			invalidateLabelCache();
			return;
		}
		if (!result.removed) break;
	}
	invalidateLabelCache();
	throw new Error(fallbackError);
}
