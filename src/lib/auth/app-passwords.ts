import { and, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "@/db";
import { apiKeys } from "@/db/schema";
import { isApiKeyVerificationCached } from "@/lib/api/find-api-key";
import { APP_PASSWORD_PROTOCOLS, type AppPasswordScope } from "@/lib/api/scopes";
import { apiKeyLookupPrefix } from "@/lib/api-keys";
import { isListedAsAppPassword } from "@/lib/auth/app-password-utils";
import { getClientIp } from "@/lib/auth/client-ip";

/** The scopes a new app password may carry on this server. */
export function availableAppPasswordProtocols(): AppPasswordScope[] {
	return [...APP_PASSWORD_PROTOCOLS];
}

/** The password half of a Basic header, or null for anything else. Bearer is not accepted. */
export function basicPassword(request: Request): string | null {
	const header = request.headers.get("Authorization") ?? "";
	if (!/^basic\s/i.test(header)) return null;
	let decoded: string;
	try {
		decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6).trim()), (char) => char.charCodeAt(0)));
	} catch {
		return null;
	}
	const separator = decoded.indexOf(":");
	// The username is ignored; the password identifies the account.
	return separator < 0 ? null : decoded.slice(separator + 1);
}

/** An IPv4 address, or the first 64 bits of an IPv6 one, so a client cannot dodge the limit by rotating addresses in its /64. */
function ipBucket(ip: string): string {
	const text = ip.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
	const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return mapped[1];
	if (!text.includes(":")) return text;
	const [head, tail = ""] = text.split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups = text.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
	return groups.slice(0, 4).map((group) => (Number.parseInt(group || "0", 16) || 0).toString(16)).join(":") + "::/64";
}

/**
 * The limiter bucket for one guess. By client IP when there is one. Without an
 * IP (no trusted proxy header) everyone must not share a bucket, so it falls
 * back to the key being guessed: its stored lookup prefix is the front of the
 * secret, which every guess at that key shares.
 */
export function appPasswordGuessKey(ip: string | null, secret: string): string {
	return ip ? `app-auth:ip:${ipBucket(ip)}` : `app-auth:key:${apiKeyLookupPrefix(secret)}`;
}

/**
 * Spend one guess from the budget unless this isolate verified the secret
 * recently (a working client hits the cache and never spends). False when the
 * budget is spent. A limiter that is missing or throws lets the request through.
 */
export async function allowAppPasswordGuess(env: CloudflareEnv, request: Request, password: string): Promise<boolean> {
	if (await isApiKeyVerificationCached(password)) return true;
	const limiter = env.DEVICE_LOGIN_RATE_LIMIT ?? env.LOGIN_RATE_LIMIT;
	if (!limiter) return true;
	try {
		return (await limiter.limit({ key: appPasswordGuessKey(getClientIp(request), password) })).success;
	} catch (error) {
		console.warn("App password rate limiter unavailable", error);
		return true;
	}
}

/**
 * Delete the credentials that skip the sign-in checks: app passwords, and the
 * older JMAP-only keys (`legacy` keys whose scopes are exactly `["jmap"]`, the
 * same rule as `isListedAsAppPassword`). Older keys that mix `jmap` with other
 * scopes are general API keys and stay. `deleteUserSessions` calls this, so a
 * password change, reset or MFA change disconnects mail apps too.
 */
export async function revokeAllAppPasswords(env: CloudflareEnv, userId: string): Promise<void> {
	const db = getDb(env);
	// Scopes are a JSON string array: the quoted name narrows the rows, `isListedAsAppPassword` decides.
	const candidates = await db
		.select({ id: apiKeys.id, kind: apiKeys.kind, scopes: apiKeys.scopes })
		.from(apiKeys)
		.where(and(eq(apiKeys.userId, userId), or(eq(apiKeys.kind, "app"), and(eq(apiKeys.kind, "legacy"), like(apiKeys.scopes, '%"jmap"%')))));
	const ids = candidates.filter(isListedAsAppPassword).map((key) => key.id);
	if (ids.length) await db.delete(apiKeys).where(and(eq(apiKeys.userId, userId), inArray(apiKeys.id, ids)));
}
