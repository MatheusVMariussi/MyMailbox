import { getClientIp } from "./client-ip";

function isProduction(): boolean {
	return process.env.NODE_ENV === "production";
}

/**
 * Spend one unit of a platform rate-limit binding. A binding missing in production is a
 * misconfiguration, so the request is refused (and logged) rather than left unlimited; local
 * development has none and is allowed. A binding that throws lets the request through so a limiter
 * outage does not lock everyone out of signing in, and the per-account attempt limits
 * (account-attempts.ts) still apply; the failure is logged.
 */
export async function spendRateLimit(limiter: RateLimit | undefined, key: string, name: string): Promise<boolean> {
	if (!limiter) {
		if (!isProduction()) return true;
		console.error(`Rate limiter ${name} is not bound; refusing the request. Add it to wrangler.jsonc "ratelimits".`);
		return false;
	}
	try {
		return (await limiter.limit({ key })).success;
	} catch (error) {
		console.error(`Rate limiter ${name} unavailable; allowing the request`, error);
		return true;
	}
}

/**
 * Key rate limits by the resolved client IP. Without a per-client key every
 * visitor lands in one shared "unknown" bucket and scanners can lock out
 * legitimate logins; trusting raw forwarding headers here would be worse —
 * a client could rotate them to leave the bucket entirely.
 */
function clientRateLimitKey(request: Request): string {
	return getClientIp(request) ?? "unknown";
}

export async function allowLoginAttempt(env: CloudflareEnv, request: Request): Promise<boolean> {
	return spendRateLimit(env.LOGIN_RATE_LIMIT, clientRateLimitKey(request), "LOGIN_RATE_LIMIT");
}
