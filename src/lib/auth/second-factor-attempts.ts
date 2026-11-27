import { clearAccountAttempt, reserveAccountAttempt, type AccountAttemptPolicy } from "./account-attempts";

/**
 * Wrong second-factor codes are limited per account, across every IP and login
 * challenge, so a known password does not leave the six-digit code to the
 * per-IP login limiter alone (see account-attempts.ts).
 */
const SECOND_FACTOR_ATTEMPTS: AccountAttemptPolicy = { action: "auth.second_factor_failed", maxFailed: 5, windowMinutes: 15 };

/** Returns an attempt id to clear once the code is correct, or null when the account is out of attempts. */
export function reserveSecondFactorAttempt(env: CloudflareEnv, userId: string, request: Request): Promise<string | null> {
	return reserveAccountAttempt(env, userId, request, SECOND_FACTOR_ATTEMPTS);
}

/** A correct code is not a failed attempt. */
export function clearSecondFactorAttempt(env: CloudflareEnv, attemptId: string): Promise<void> {
	return clearAccountAttempt(env, attemptId);
}
