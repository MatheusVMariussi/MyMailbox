import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { readJsonObject } from "@/lib/http/request";
import { getOwnProject, listProjectDomains, ProjectError, setProjectAddresses } from "@/lib/projects/service";
import { projectAddressesSchema } from "@/lib/validators";
import type { ProjectRouteParams } from "../types";

/**
 * Replaces the domains and addresses the project owns. Only domains the user can access may be mapped, and an
 * address is unique among the user's own projects: another user on a shared domain may map it to theirs.
 */
export async function PUT(request: Request, { params }: ProjectRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = projectAddressesSchema.safeParse(await readJsonObject(request));
	if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid addresses" }, { status: 400 });
	const db = getDb(env);
	const project = await getOwnProject(db, auth.user.id, id);
	if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
	const hostnames = new Map((await listProjectDomains(db, auth.user)).map((domain) => [domain.id, domain.hostname]));
	if (parsed.data.addresses.some((address) => !hostnames.has(address.domainId))) {
		return NextResponse.json({ error: "Domain not found" }, { status: 404 });
	}
	try {
		return NextResponse.json({ addresses: await setProjectAddresses(db, project, parsed.data.addresses, hostnames) });
	} catch (error) {
		if (error instanceof ProjectError) return NextResponse.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
