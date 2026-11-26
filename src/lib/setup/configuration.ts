import { getDatabaseConfig } from "@/db/with-database";
import type { SetupRequirementCheck } from "./types";

export function getSetupRequirementChecks(env: CloudflareEnv): SetupRequirementCheck[] {
	const hasApiToken = !!env.CF_TOKEN?.trim();
	const hasGlobalKey = !!env.CF_API_KEY?.trim() && !!env.CF_EMAIL?.trim();

	const database = getDatabaseConfig(env);
	return [
		{
			key: "Cloudflare API credentials",
			configured: hasApiToken || hasGlobalKey,
			message: "Set CF_TOKEN, or set both CF_API_KEY and CF_EMAIL.",
		},
		{
			key: database.driver === "d1" ? "D1 database" : "Database",
			configured: !!env.DB,
			message: database.driver === "d1" ? "Deploy the Worker with the DB binding from wrangler.jsonc." : "Check DATABASE_URL (and DATABASE_DRIVER) for the external database.",
		},
	];
}
