import { NextResponse } from "next/server";
import { timingSafeEqualText } from "@/lib/api-keys";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { authError } from "@/lib/http/auth-error";
import {
	isLocalDevelopmentHostname,
	MAX_SETUP_TOKEN_LENGTH,
	SETUP_TOKEN_ERRORS,
	SETUP_TOKEN_HEADER,
	type SetupTokenErrorCode,
} from "./token-utils";

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	let hex = "";
	for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
	return hex;
}

/**
 * First-run setup claims the installation and provisions DNS with the operator's Cloudflare token, so
 * it needs the deploy-time `SETUP_TOKEN` secret. Both values are hashed before the constant-time
 * compare, so neither their content nor their length shows in the timing. Without the secret, setup
 * runs only on a local development host, which a deployed Worker is never reached on.
 */
export async function verifySetupToken(
	env: Pick<CloudflareEnv, "SETUP_TOKEN">,
	request: Request,
): Promise<SetupTokenErrorCode | null> {
	const expected = env.SETUP_TOKEN?.trim();
	if (!expected) {
		return isLocalDevelopmentHostname(new URL(request.url).hostname) ? null : "setup_token_unset";
	}
	const presented = request.headers.get(SETUP_TOKEN_HEADER)?.trim() ?? "";
	if (!presented) return "setup_token_required";
	if (presented.length > MAX_SETUP_TOKEN_LENGTH) return "setup_token_invalid";
	const [expectedDigest, presentedDigest] = await Promise.all([sha256Hex(expected), sha256Hex(presented)]);
	return timingSafeEqualText(expectedDigest, presentedDigest) ? null : "setup_token_invalid";
}

/**
 * The gate every first-run setup and registration route runs before anything else: the per-IP login
 * budget, then the setup token. Returns the refusal, or null when the request may continue.
 */
export async function guardSetupRequest(env: CloudflareEnv, request: Request): Promise<NextResponse | null> {
	if (!(await allowLoginAttempt(env, request))) {
		return authError("rate_limited", 429, { "Retry-After": "60" });
	}
	const failure = await verifySetupToken(env, request);
	if (!failure) return null;
	if (failure === "setup_token_unset") {
		console.error("First-run setup refused: set the SETUP_TOKEN Worker secret (npx wrangler secret put SETUP_TOKEN).");
	}
	const { status, message } = SETUP_TOKEN_ERRORS[failure];
	return NextResponse.json({ error: message, code: failure }, { status, headers: { "Cache-Control": "no-store" } });
}
