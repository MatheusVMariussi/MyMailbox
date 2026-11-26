import type { TranslationKey } from "@/lib/i18n/types";
import { authFetch } from "@/lib/auth/client";
import { requestError } from "@/lib/http/client-error";
import type { ApiKeyScope } from "@/lib/api/scopes";
import type { ManagedApiKey } from "./api-keys-settings-types";

export const STANDARD_KEY_SCOPES: { value: ApiKeyScope; labelKey: TranslationKey; descriptionKey: TranslationKey }[] = [
	{ value: "read", labelKey: "apiKeys.read.label", descriptionKey: "apiKeys.read.description" },
	{ value: "send", labelKey: "apiKeys.send.label", descriptionKey: "apiKeys.send.description" },
	{ value: "calendar:read", labelKey: "apiKeys.calendarRead.label", descriptionKey: "apiKeys.calendarRead.description" },
	{ value: "calendar:write", labelKey: "apiKeys.calendarWrite.label", descriptionKey: "apiKeys.calendarWrite.description" },
];

async function responseData(response: Response): Promise<{ error?: unknown; key?: string; apiKeys?: ManagedApiKey[] }> {
	return response.json().catch(() => ({})) as Promise<{ error?: unknown; key?: string; apiKeys?: ManagedApiKey[] }>;
}

export function keyPermissions(key: ManagedApiKey): string[] {
	try {
		const scopes: unknown = JSON.parse(key.scopes);
		return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : [];
	} catch {
		return [];
	}
}

export async function loadManagedApiKeys(): Promise<ManagedApiKey[]> {
	const response = await authFetch("/api/api-keys");
	const data = await responseData(response);
	if (!response.ok || !data.apiKeys) throw new Error(typeof data.error === "string" ? data.error : "Could not load API keys");
	return data.apiKeys;
}

export async function createManagedApiKey(input: { name: string; scopes: ApiKeyScope[]; mailboxIds: string[] }, stepUpToken?: string): Promise<string> {
	// With a step-up token (jmap keys), a 401 means that proof was refused, not that the session ended.
	const response = await authFetch("/api/api-keys", {
		method: "POST",
		...(stepUpToken ? { redirectOnUnauthorized: false } : {}),
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: input.name, scopes: input.scopes, mailboxIds: input.mailboxIds, ...(stepUpToken ? { stepUpToken } : {}) }),
	});
	const data = (await responseData(response)) as { error?: unknown; code?: unknown; key?: string };
	if (!response.ok || !data.key) throw requestError(data, "Could not create API key");
	return data.key;
}

export async function revokeManagedApiKey(id: string): Promise<void> {
	const response = await authFetch(`/api/api-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
	if (!response.ok) {
		const data = await responseData(response);
		throw new Error(typeof data.error === "string" ? data.error : "Could not revoke API key");
	}
}
