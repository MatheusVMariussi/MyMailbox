import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userComposePreferences } from "@/db/schema";
import { DEFAULT_UNDO_SEND_SECONDS, parseUndoSendSeconds } from "./compose-utils";
import type { ComposePreferences } from "./types";

const DEFAULTS: ComposePreferences = { trackOpensDefault: false, undoSendSeconds: DEFAULT_UNDO_SEND_SECONDS };

/** The user's composer defaults; a user without a row gets the defaults. */
export async function getComposePreferences(env: CloudflareEnv, userId: string): Promise<ComposePreferences> {
	const [row] = await getDb(env)
		.select({ trackOpensDefault: userComposePreferences.trackOpensDefault, undoSendSeconds: userComposePreferences.undoSendSeconds })
		.from(userComposePreferences)
		.where(eq(userComposePreferences.userId, userId))
		.limit(1);
	if (!row) return DEFAULTS;
	return { trackOpensDefault: row.trackOpensDefault, undoSendSeconds: parseUndoSendSeconds(row.undoSendSeconds) ?? DEFAULT_UNDO_SEND_SECONDS };
}

export async function updateComposePreferences(env: CloudflareEnv, userId: string, patch: Partial<ComposePreferences>): Promise<ComposePreferences> {
	const next = { ...(await getComposePreferences(env, userId)), ...patch };
	const updatedAt = new Date();
	await getDb(env)
		.insert(userComposePreferences)
		.values({ userId, ...next, updatedAt })
		.onConflictDoUpdate({ target: userComposePreferences.userId, set: { ...next, updatedAt } });
	return next;
}
