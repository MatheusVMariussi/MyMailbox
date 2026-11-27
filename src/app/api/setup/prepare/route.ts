import { NextResponse } from "next/server";
import { hasAdminAccount } from "@/lib/auth/setup";
import { getEnv } from "@/lib/cloudflare";
import { getSetupRequirementChecks } from "@/lib/setup/configuration";
import { migrateCleanDatabase } from "@/lib/setup/migration";
import { guardSetupRequest } from "@/lib/setup/token";

export async function POST(request: Request) {
	const env = getEnv();
	const refused = await guardSetupRequest(env, request);
	if (refused) return refused;
	if (await hasAdminAccount(env)) {
		return NextResponse.json({ error: "Initial setup is already complete" }, { status: 403 });
	}

	const checks = getSetupRequirementChecks(env);
	if (checks.some((check) => !check.configured)) {
		return NextResponse.json({ checks, migrated: false }, { status: 503 });
	}

	try {
		const migrated = await migrateCleanDatabase(env.DB);
		return NextResponse.json({ checks, migrated });
	} catch (error) {
		// The raw D1 error can carry internal detail; it goes to the Worker logs, not the browser.
		console.error("First-run database preparation failed", error);
		return NextResponse.json(
			{ checks, migrated: false, error: "Database preparation failed. Check the Worker logs for the cause." },
			{ status: 500 },
		);
	}
}
