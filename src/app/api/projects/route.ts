import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { readJsonObject } from "@/lib/http/request";
import { createProject, listProjectDomains, listProjects, ProjectError } from "@/lib/projects/service";
import { projectSchema } from "@/lib/validators";

/** The user's projects with their addresses, and the domains they may map. */
export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const db = getDb(env);
	const [projects, domains] = await Promise.all([listProjects(db, auth.user.id), listProjectDomains(db, auth.user)]);
	return NextResponse.json({ projects, domains });
}

export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = projectSchema.safeParse(await readJsonObject(request));
	if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid project" }, { status: 400 });
	try {
		const project = await createProject(getDb(env), { userId: auth.user.id, name: parsed.data.name, color: parsed.data.color });
		return NextResponse.json(project, { status: 201 });
	} catch (error) {
		if (error instanceof ProjectError) return NextResponse.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
