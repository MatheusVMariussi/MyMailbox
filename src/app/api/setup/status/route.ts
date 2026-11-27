import { NextResponse } from "next/server";
import { hasAdminAccount } from "@/lib/auth/setup";
import { getEnv } from "@/lib/cloudflare";
import { isMissingTableError } from "@/lib/database-errors";
import { getPrimaryDomain } from "@/lib/user";

/**
 * Whether a primary domain exists. Before /setup applies the migrations a new install's database has no
 * tables at all; while setup is still open, a missing domains table simply means "no domain yet".
 */
async function hasPrimaryDomain(env: CloudflareEnv, setupOpen: boolean): Promise<boolean> {
	try {
		return !!(await getPrimaryDomain(env));
	} catch (error) {
		if (setupOpen && isMissingTableError(error)) return false;
		throw error;
	}
}

/**
 * Public: whether first-run setup is closed and whether its domain step is done, which is all the setup page
 * needs before the operator proves the setup token. The primary domain's name and settings are never part of
 * it; the token-gated `POST /api/setup/prepare` returns them while setup is open.
 */
export async function GET() {
	const env = getEnv();
	try {
		const adminAccountExists = await hasAdminAccount(env);
		return NextResponse.json({
			hasAdminAccount: adminAccountExists,
			hasPrimaryDomain: await hasPrimaryDomain(env, !adminAccountExists),
		}, {
			headers: { "Cache-Control": "no-store" },
		});
	} catch (error) {
		// Public endpoint: keep the database error in the Worker logs.
		console.error("Could not load setup status", error);
		return NextResponse.json({ error: "Could not load setup status" }, { status: 500 });
	}
}
