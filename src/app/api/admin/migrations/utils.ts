import { NextResponse } from "next/server";
import { assertPrimaryAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { getEnv } from "@/lib/cloudflare";

/** Primary-admin session check shared by the migration status and apply handlers. */
export async function authorizeAdminRequest(request: Request) {
	const env = getEnv();
	let user: Awaited<ReturnType<typeof requireUser>>;
	try {
		user = await requireUser(env, request);
	} catch {
		return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
	}
	try {
		assertPrimaryAdmin(user);
	} catch {
		return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
	}
	return { env };
}

export async function authorizeMigrationRequest(request: Request) {
	const authorization = await authorizeAdminRequest(request);
	if ("error" in authorization) return authorization;
	if (request.method !== "GET" && !hasValidSessionMutationOrigin(request)) {
		return { error: NextResponse.json({ error: "Invalid request origin" }, { status: 403 }) };
	}
	return authorization;
}
