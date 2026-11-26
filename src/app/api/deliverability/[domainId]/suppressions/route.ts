import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { authorizeDomainAdmin } from "@/lib/deliverability/access";
import { listSuppressions } from "@/lib/deliverability/suppression-admin";

type Params = { params: Promise<{ domainId: string }> };

export async function GET(request: Request, { params }: Params) {
	const { domainId } = await params;
	const env = getEnv();
	const access = await authorizeDomainAdmin(env, request, domainId, false);
	if (access.error) return access.error;
	const query = new URL(request.url).searchParams;
	return NextResponse.json(await listSuppressions(env, domainId, {
		q: query.get("q") ?? undefined,
		reason: query.get("reason") ?? undefined,
		offset: Number(query.get("offset")),
		limit: Number(query.get("limit")),
	}));
}
