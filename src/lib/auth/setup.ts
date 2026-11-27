import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { listTableNames } from "@/db/introspect";
import { isMissingUsersTableError } from "@/lib/auth/setup-utils";

/** Tables SQLite, D1 and the migration ledger create on their own; an install with only these is empty. */
function isPlatformTable(name: string): boolean {
	return name === "d1_migrations" || name.startsWith("sqlite_") || name.startsWith("_cf");
}

/** A database nothing has been applied to: no application tables and no recorded migrations. */
async function isFreshDatabase(db: D1Database): Promise<boolean> {
	const tables = await listTableNames(db);
	if ([...tables].some((name) => !isPlatformTable(name))) return false;
	if (!tables.has("d1_migrations")) return true;
	const recorded = await db.prepare("SELECT count(*) AS count FROM d1_migrations").first<{ count: number }>();
	return (recorded?.count ?? 0) === 0;
}

/**
 * Whether first-run setup is closed. It is open only when no admin exists, and only when that is
 * known for certain: a database error reads as closed, so a failing or half-migrated database can
 * never let a stranger register the first admin. The one exception is a truly empty database
 * (no `users` table and nothing else applied), which is how a new install starts.
 *
 * Without a `DB` binding nothing can be created or read, so setup shows its configuration check
 * (which reports the missing binding) instead.
 */
export async function hasAdminAccount(env: CloudflareEnv): Promise<boolean> {
	if (!env.DB) return false;

	try {
		const db = getDb(env);
		const [admin] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.role, "admin"))
			.limit(1);

		return !!admin;
	} catch (error) {
		if (isMissingUsersTableError(error)) {
			try {
				if (await isFreshDatabase(env.DB)) return false;
			} catch (inspectError) {
				console.error("Could not inspect the database while checking for an admin account; setup stays closed", inspectError);
				return true;
			}
		}
		console.error("Could not check for an admin account; setup stays closed", error);
		return true;
	}
}
