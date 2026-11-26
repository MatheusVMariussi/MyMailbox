import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { authenticateAdminApiKey } from "@/lib/api/admin-auth";
import { R2_STORAGE_STATUS, testStorage } from "@/lib/storage/health";

/** Which object storage is active: always the R2 `BUCKET` binding. Credentials are never returned. */
export async function GET(request: Request) {
	const env = getEnv();
	const auth = await authenticateAdminApiKey(env, request, "storage");
	if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	return NextResponse.json({ storage: R2_STORAGE_STATUS });
}

/** Round-trips a small object through R2. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await authenticateAdminApiKey(env, request, "storage");
	if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const result = await testStorage(env);
	return NextResponse.json({ storage: R2_STORAGE_STATUS, ...result }, { status: result.ok ? 200 : 502 });
}
