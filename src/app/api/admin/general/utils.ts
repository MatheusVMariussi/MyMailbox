import { z } from "zod";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { OUTBOUND_ATTACHMENT_CEILING_MB, clampOutboundAttachmentMb } from "@/lib/email/attachment-limits";
import { getOutboundAttachmentMaxMb } from "@/lib/email/attachment-policy";
import { isMissingColumnError } from "@/lib/database-errors";

const schema = z.object({
	outboundAttachmentMaxMb: z.number().int().min(1),
});

async function readSettings(env: CloudflareEnv) {
	return { outboundAttachmentMaxMb: await getOutboundAttachmentMaxMb(env), outboundAttachmentCeilingMb: OUTBOUND_ATTACHMENT_CEILING_MB };
}

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	if (!isPrimaryAdmin(auth.user)) return Response.json({ error: "Forbidden" }, { status: 403 });
	return Response.json(await readSettings(env), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	if (!isPrimaryAdmin(auth.user)) return Response.json({ error: "Forbidden" }, { status: 403 });
	if (!hasValidSessionMutationOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: `Enter a valid attachment limit (1 to ${OUTBOUND_ATTACHMENT_CEILING_MB} MB)` }, { status: 400 });
	const values = { updatedAt: new Date(), outboundAttachmentMaxMb: clampOutboundAttachmentMb(parsed.data.outboundAttachmentMaxMb) };
	try {
		await getDb(env).insert(appSettings).values({ id: "default", ...values }).onConflictDoUpdate({ target: appSettings.id, set: values });
	} catch (error) {
		if (!isMissingColumnError(error)) throw error;
		return Response.json({ error: "Apply pending database migrations first." }, { status: 500 });
	}
	return Response.json(await readSettings(env), { headers: { "Cache-Control": "no-store" } });
}
