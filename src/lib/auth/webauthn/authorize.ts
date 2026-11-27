import { verifyPasswordInConstantTime } from "@/lib/auth/password";
import { verifySecondFactor } from "@/lib/auth/mfa";
import { clearPasswordAttempt, reservePasswordAttempt } from "@/lib/auth/password-attempts";
import { clearSecondFactorAttempt, reserveSecondFactorAttempt } from "@/lib/auth/second-factor-attempts";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { consumeStepUpGrant } from "./grants";
import type { StepUpAction } from "./step-up-types";

/**
 * A sensitive settings change may prove the password, or present a fresh
 * passkey step-up grant. When password sign-ins require a second factor, the
 * password path must also present a valid authenticator or recovery code.
 * The password and the code spend the account's sign-in budgets
 * (password-attempts.ts, second-factor-attempts.ts), so a stolen session is
 * not an unlimited oracle for either.
 *
 * The grant is spent for exactly `action` and `targetUserId` and bound to the
 * request's session cookie; callers should bump the target's security version
 * after a successful change.
 */
export async function authorizeSecurityChange(
	env: CloudflareEnv,
	user: { id: string; passwordHash: string; requireSecondFactor: boolean; totpSecret: string | null; totpEnabled: boolean },
	request: Request,
	input: { password?: string; stepUpToken?: string; code?: string },
	action: StepUpAction,
	options: { requireCode?: boolean; targetUserId?: string | null } = {},
): Promise<boolean> {
	if (input.stepUpToken) {
		const sessionToken = getSessionTokenFromRequestHeaders(request);
		if (!sessionToken) return false;
		return consumeStepUpGrant(env, {
			token: input.stepUpToken,
			userId: user.id,
			sessionToken,
			action,
			targetUserId: options.targetUserId,
		});
	}
	if (!input.password) return false;
	const passwordAttempt = await reservePasswordAttempt(env, user.id, request);
	if (!passwordAttempt || !verifyPasswordInConstantTime(input.password, user.passwordHash)) return false;
	await clearPasswordAttempt(env, passwordAttempt);
	if (!options.requireCode && !user.requireSecondFactor) return true;
	if (!input.code) return false;
	const codeAttempt = await reserveSecondFactorAttempt(env, user.id, request);
	if (!codeAttempt || !(await verifySecondFactor(env, user, input.code))) return false;
	await clearSecondFactorAttempt(env, codeAttempt);
	return true;
}
