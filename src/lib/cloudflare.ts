import { env } from "cloudflare:workers";
import { getD1Session, withD1Session } from "@/lib/d1-session-context";
import { withDatabase } from "@/db/with-database";

export function getEnv(): CloudflareEnv {
	const base = env as CloudflareEnv;
	const session = getD1Session();
	return withDatabase(session ? withD1Session(base, session) : base);
}

export async function getEnvAsync(): Promise<CloudflareEnv> {
	return getEnv();
}
