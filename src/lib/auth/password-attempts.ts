import { clearAccountAttempt, reserveAccountAttempt, spendUnknownAccountAttempt, type AccountAttemptPolicy } from "./account-attempts";

/**
 * Wrong passwords are limited per account across every IP: sign-in and step-up share one budget, so a
 * stolen session cannot be used to guess the password either (see account-attempts.ts). Passkey
 * sign-in does not spend it, so an attacker spending an account's budget cannot lock a passkey out.
 */
const PASSWORD_ATTEMPTS: AccountAttemptPolicy = { action: "auth.password_failed", maxFailed: 10, windowMinutes: 15 };

/** Seconds a locked-out client is told to wait: the length of the window. */
export const PASSWORD_LOCKOUT_RETRY_AFTER = String(PASSWORD_ATTEMPTS.windowMinutes * 60);

/** Returns an attempt id to clear once the password is right, or null when the account is out of attempts. */
export function reservePasswordAttempt(env: CloudflareEnv, userId: string, request: Request): Promise<string | null> {
	return reserveAccountAttempt(env, userId, request, PASSWORD_ATTEMPTS);
}

/** The cost of `reservePasswordAttempt` for a sign-in whose email has no account; counts against nothing. */
export function spendUnknownPasswordAttempt(env: CloudflareEnv, request: Request): Promise<void> {
	return spendUnknownAccountAttempt(env, request, PASSWORD_ATTEMPTS);
}

/** A correct password is not a failed attempt. */
export function clearPasswordAttempt(env: CloudflareEnv, attemptId: string): Promise<void> {
	return clearAccountAttempt(env, attemptId);
}
