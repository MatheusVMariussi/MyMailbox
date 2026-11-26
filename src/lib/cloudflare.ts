import { env } from "cloudflare:workers";
import { getD1Session, withD1Session } from "@/lib/d1-session-context";

export function getEnv(): CloudflareEnv {
	const base = env as CloudflareEnv;
	const session = getD1Session();
	return session ? withD1Session(base, session) : base;
}

export async function getEnvAsync(): Promise<CloudflareEnv> {
	return getEnv();
}
