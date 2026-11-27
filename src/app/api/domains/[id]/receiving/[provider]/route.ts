import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireUser } from "@/lib/auth/cookies";
import { canManageDomains } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { getDomainForUser } from "@/lib/domains/service";
import { setupReceiving } from "@/lib/domains/receiving";
import { MxConflictError } from "@/lib/domains/receiving-dns";
import { mtaStsBlockedResponse } from "@/lib/deliverability/mta-sts-block-response";

type Params = { params: Promise<{ id: string; provider: string }> };
const noStore = { "Cache-Control": "no-store" };
const providerSchema = z.enum(["cloudflare"]);

/** Sets up Cloudflare Email Routing and points the domain's MX at it. 409 MX_CONFLICT asks the caller to confirm replacing other MX records. */
export async function POST(request: Request, { params }: Params) {
	const { id, provider: rawProvider } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!canManageDomains(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	if (!providerSchema.safeParse(rawProvider).success) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
	const body = (await request.json().catch(() => ({}))) as { replaceMx?: boolean };
	try {
		await setupReceiving(env, domain, { replaceMx: body.replaceMx === true });
		return NextResponse.json({ ok: true }, { headers: noStore });
	} catch (error) {
		const blocked = await mtaStsBlockedResponse(error);
		if (blocked) return blocked;
		if (error instanceof MxConflictError) return NextResponse.json({ error: error.message, code: error.code, records: error.records }, { status: 409 });
		return NextResponse.json({ error: error instanceof Error ? error.message : "Setup failed" }, { status: 502 });
	}
}
