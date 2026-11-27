import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { getSessionTokenFromRequestHeaders } from "@/lib/auth/session";
import { authorizeSecurityChange } from "@/lib/auth/webauthn/authorize";
import { authError } from "@/lib/http/auth-error";
import { getResendKeyStatus } from "@/lib/email/outbound-provider";
import { checkResendKey, resendClient } from "@/lib/email/resend-api";

/** Replacing or removing the key needs a fresh step-up (or the password), like other security changes. */
const proofSchema = {
	password: z.string().min(1).max(128).optional(),
	code: z.string().trim().min(6).max(32).optional(),
	stepUpToken: z.string().min(8).max(200).optional(),
};
const putSchema = z.object({ apiKey: z.string().trim().min(1).max(500), ...proofSchema });
const deleteSchema = z.object(proofSchema);

const ENVIRONMENT_KEY_ERROR = "The Resend API key comes from the RESEND_API_KEY Worker secret. Change it with `npx wrangler secret put RESEND_API_KEY`.";

async function authorize(request: Request, mutation: boolean) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return { env, user: null, error: auth.error };
	if (!isPrimaryAdmin(auth.user)) return { env, user: null, error: Response.json({ error: "Only the primary administrator can manage the Resend API key" }, { status: 403 }) };
	if (mutation && !hasValidSessionMutationOrigin(request)) return { env, user: null, error: Response.json({ error: "Invalid origin" }, { status: 403 }) };
	return { env, user: auth.user, error: null };
}

async function status(env: CloudflareEnv) {
	const { configured, source } = await getResendKeyStatus(env);
	return { configured, source };
}

export async function GET(request: Request) {
	const access = await authorize(request, false);
	if (access.error) return access.error;
	return Response.json(await status(access.env), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
	const access = await authorize(request, true);
	if (access.error || !access.user) return access.error;
	const parsed = putSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: "Enter a Resend API key" }, { status: 400 });
	// The secret wins over the database; a stored key would be ignored, so do not pretend to replace it.
	if ((await getResendKeyStatus(access.env)).source === "environment") {
		return Response.json({ error: ENVIRONMENT_KEY_ERROR }, { status: 409 });
	}
	if (!(await authorizeSecurityChange(access.env, access.user, getSessionTokenFromRequestHeaders(request), parsed.data, "provider.resend_key"))) {
		return authError("verification_required", 401);
	}
	const check = await checkResendKey(resendClient(access.env, parsed.data.apiKey)).catch(() => null);
	if (!check) return Response.json({ error: "Could not reach Resend to check the key" }, { status: 502 });
	if (!check.valid) return Response.json({ error: "Resend rejected this API key" }, { status: 400 });
	const values = { resendApiKey: parsed.data.apiKey, updatedAt: new Date() };
	await getDb(access.env).insert(appSettings).values({ id: "default", ...values }).onConflictDoUpdate({ target: appSettings.id, set: values });
	return Response.json({ ...(await status(access.env)), canManageDomains: check.canManageDomains }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
	const access = await authorize(request, true);
	if (access.error || !access.user) return access.error;
	const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) return authError("invalid_request", 400);
	if (!(await authorizeSecurityChange(access.env, access.user, getSessionTokenFromRequestHeaders(request), parsed.data, "provider.resend_key"))) {
		return authError("verification_required", 401);
	}
	await getDb(access.env).update(appSettings).set({ resendApiKey: null, updatedAt: new Date() }).where(eq(appSettings.id, "default"));
	return Response.json(await status(access.env), { headers: { "Cache-Control": "no-store" } });
}
