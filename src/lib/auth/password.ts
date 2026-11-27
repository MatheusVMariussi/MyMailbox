import bcrypt from "bcryptjs";

/**
 * Accounts that sign in only with passkeys still need a non-null column value:
 * SQLite cannot drop `NOT NULL` without rebuilding a heavily referenced table.
 * The sentinel can never be produced by hashPassword and every verification
 * path rejects it, so it behaves like a missing password.
 */
export const PASSWORDLESS_PASSWORD_HASH = "!passkey-only";

export function hashPassword(password: string): string {
	return bcrypt.hashSync(password, 12);
}

export function hasPasswordHash(hash: string | null | undefined): hash is string {
	return !!hash && hash !== PASSWORDLESS_PASSWORD_HASH && hash.startsWith("$2");
}

export function verifyPassword(password: string, hash: string | null | undefined): boolean {
	if (!hasPasswordHash(hash)) return false;
	return bcrypt.compareSync(password, hash);
}

/**
 * A cost-12 hash (the cost hashPassword uses) of a random value nobody knows. Comparing against it
 * costs what a real check costs and never matches.
 */
const DUMMY_PASSWORD_HASH = "$2b$12$cJyuQJNME.3WTQ50z1jXMOZnIKEa61/tMOpT7gMJeKBvXJ6Ppj3Lm";

/**
 * verifyPassword for sign-in paths that must not reveal whether an account exists or has a
 * password: an unknown email or a passkey-only account still pays for one bcrypt comparison, so
 * the response time is the same as for a wrong password.
 */
export function verifyPasswordInConstantTime(password: string, hash: string | null | undefined): boolean {
	if (!hasPasswordHash(hash)) {
		bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
		return false;
	}
	return bcrypt.compareSync(password, hash);
}
