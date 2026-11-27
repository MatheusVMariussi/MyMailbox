import { and, count, eq, gt } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { auditLogs } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getAuthActivityMetadata } from "./activity";

/** How many failures of one kind an account may have within a sliding window. */
export type AccountAttemptPolicy = {
	/** The audit-log action each attempt is recorded under. */
	action: string;
	maxFailed: number;
	windowMinutes: number;
};

/**
 * Failed guesses are limited per account, across every IP and challenge, so the per-IP limiter is not
 * the only thing standing between a distributed guesser and a password or code. Each attempt is
 * logged (in `audit_logs`) before the secret is checked, so parallel guesses count too; a correct
 * secret removes its own entry with `clearAccountAttempt`, and wrong ones stay in the audit log.
 *
 * Returns an attempt id to clear once the secret is right, or null when the account is out of attempts.
 */
export async function reserveAccountAttempt(
	env: CloudflareEnv,
	userId: string,
	request: Request,
	policy: AccountAttemptPolicy,
): Promise<string | null> {
	const db = getDb(env);
	const id = await recordAttempt(db, userId, request, policy);
	if (await countAttempts(db, userId, policy) <= policy.maxFailed) return id;
	await clearAccountAttempt(env, id);
	return null;
}

/**
 * What `reserveAccountAttempt` costs, for a sign-in that names no account: the same insert and count, so
 * the time a guess takes does not tell an unknown address from a real one. The row has no target user,
 * so it counts against nothing; such guesses are bounded by the per-IP limiter.
 */
export async function spendUnknownAccountAttempt(env: CloudflareEnv, request: Request, policy: AccountAttemptPolicy): Promise<void> {
	const db = getDb(env);
	await recordAttempt(db, null, request, policy);
	await countAttempts(db, newId("usr"), policy);
}

async function recordAttempt(db: AppDatabase, targetUserId: string | null, request: Request, policy: AccountAttemptPolicy): Promise<string> {
	const id = newId("aud");
	await db.insert(auditLogs).values({
		id,
		targetUserId,
		action: policy.action,
		metadata: JSON.stringify(getAuthActivityMetadata(request)),
	});
	return id;
}

async function countAttempts(db: AppDatabase, userId: string, policy: AccountAttemptPolicy): Promise<number> {
	const since = new Date(Date.now() - policy.windowMinutes * 60 * 1000);
	const [row] = await db
		.select({ attempts: count() })
		.from(auditLogs)
		.where(and(eq(auditLogs.targetUserId, userId), eq(auditLogs.action, policy.action), gt(auditLogs.createdAt, since)));
	return row?.attempts ?? 0;
}

/** A correct secret is not a failed attempt. */
export async function clearAccountAttempt(env: CloudflareEnv, attemptId: string): Promise<void> {
	await getDb(env).delete(auditLogs).where(eq(auditLogs.id, attemptId));
}
