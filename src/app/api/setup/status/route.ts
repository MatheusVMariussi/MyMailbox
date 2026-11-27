import { NextResponse } from "next/server";
import { hasAdminAccount } from "@/lib/auth/setup";
import { getEnv } from "@/lib/cloudflare";
import { getPrimaryDomain } from "@/lib/user";

/**
 * Public: whether first-run setup is closed and whether its domain step is done, which is all the setup page
 * needs before the operator proves the setup token. The primary domain's name and settings are never part of
 * it; the token-gated `POST /api/setup/prepare` returns them while setup is open.
 */
export async function GET() {
	const env = getEnv();
	try {
		const [adminAccountExists, domain] = await Promise.all([
			hasAdminAccount(env),
			getPrimaryDomain(env),
		]);
		return NextResponse.json({
			hasAdminAccount: adminAccountExists,
			hasPrimaryDomain: !!domain,
		}, {
			headers: { "Cache-Control": "no-store" },
		});
	} catch (error) {
		// Public endpoint: keep the database error in the Worker logs.
		console.error("Could not load setup status", error);
		return NextResponse.json({ error: "Could not load setup status" }, { status: 500 });
	}
}
