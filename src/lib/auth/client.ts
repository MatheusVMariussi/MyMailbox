"use client";

import { getUserTimeZone } from "@/lib/time/utils";
import { clearUserTimeZonePreference } from "@/lib/time/client";
import type {
	AuthFetchOptions,
	AuthSessionChangedDetail,
	AuthSessionResponse,
} from "./client-types";

/**
 * The session lives only in the HttpOnly `ep_session` cookie, which same-origin requests carry on
 * their own; page scripts never see the token. What the client keeps is a random, non-secret key that
 * changes whenever the signed-in account does, so per-account caches and the realtime connection (in
 * this tab and, through the storage event, in the others) know to start over.
 */
const SESSION_KEY_STORAGE = "mymailbox-session";
/** Older builds kept the bearer token here; it is removed on load. */
const LEGACY_SESSION_TOKEN_STORAGE = "mymailbox-session-token";
/** Stored after an explicit sign-out, so other tabs stop instead of minting a new key. */
const SIGNED_OUT = "signed-out";
export const AUTH_SESSION_CHANGED_EVENT = "mymailbox:auth-session-changed";

/** Used when storage is unavailable, so the key stays stable within this tab. */
let memorySessionKey: string | null = null;

function readSessionKey(): string | null {
	try {
		return localStorage.getItem(SESSION_KEY_STORAGE);
	} catch {
		return memorySessionKey;
	}
}

function writeSessionKey(value: string): void {
	memorySessionKey = value;
	try {
		localStorage.setItem(SESSION_KEY_STORAGE, value);
	} catch { /* Storage is optional; the memory copy serves this tab. */ }
}

function newSessionKey(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function removeLegacySessionToken(): void {
	try {
		localStorage.removeItem(LEGACY_SESSION_TOKEN_STORAGE);
	} catch { /* Nothing stored, or storage is unavailable. */ }
}

if (typeof window !== "undefined") removeLegacySessionToken();

function dispatchAuthSessionChanged(authenticated: boolean): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<AuthSessionChangedDetail>(AUTH_SESSION_CHANGED_EVENT, {
			detail: { authenticated },
		}),
	);
}

/**
 * The current browser session's cache key, or null when this browser has not seen a sign-in (or
 * signed out). It is not a credential; the cookie decides whether requests are signed in. Null keeps
 * signed-out pages from opening the realtime connection.
 */
export function getClientSessionKey(): string | null {
	if (typeof window === "undefined") return null;
	const stored = readSessionKey();
	return stored && stored !== SIGNED_OUT ? stored : null;
}

/** A sign-in or account switch: start a new key and tell listeners. */
export function markClientSessionChanged(): void {
	writeSessionKey(newSessionKey());
	clearUserTimeZonePreference();
	dispatchAuthSessionChanged(true);
}

/**
 * The server confirmed a session (AuthGuard). A browser without a key for it (storage cleared, or it
 * signed out and another tab signed in) starts one, which also starts the realtime connection.
 */
export function ensureClientSessionKey(): void {
	if (typeof window !== "undefined" && getClientSessionKey() === null) markClientSessionChanged();
}

export function clearClientSession(): void {
	writeSessionKey(SIGNED_OUT);
	clearUserTimeZonePreference();
	dispatchAuthSessionChanged(false);
}

export function getAuthHeaders(headers?: HeadersInit): Headers {
	const nextHeaders = new Headers(headers);
	if (typeof window !== "undefined" && !nextHeaders.has("X-Time-Zone")) {
		nextHeaders.set("X-Time-Zone", getUserTimeZone());
	}
	return nextHeaders;
}

export async function authFetch(input: RequestInfo | URL, init: AuthFetchOptions = {}): Promise<Response> {
	const { redirectOnUnauthorized = true, headers, ...requestInit } = init;
	const response = await fetch(input, {
		// Same-origin requests send the session cookie by default; say so in case a caller overrides it.
		credentials: "same-origin",
		...requestInit,
		headers: getAuthHeaders(headers),
	});

	if (response.status === 401 && redirectOnUnauthorized && typeof window !== "undefined") {
		clearClientSession();
		window.location.assign("/login");
	}

	return response;
}

/** Reads a sign-in answer; a session was issued (in the cookie) when it says `authenticated`. */
export async function persistAuthSession(response: Response): Promise<AuthSessionResponse> {
	const data = (await response.json()) as AuthSessionResponse;
	if (response.ok && data.authenticated) markClientSessionChanged();
	return data;
}
