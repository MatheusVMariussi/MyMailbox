import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { readJsonObject } from "@/lib/http/request";
import { deleteProject, getOwnProject, ProjectError, updateProject } from "@/lib/projects/service";
import { projectUpdateSchema } from "@/lib/validators";
import type { ProjectRouteParams } from "./types";

/** Rename, recolor or reorder one of the user's projects. */
export async function PATCH(request: Request, { params }: ProjectRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = projectUpdateSchema.safeParse(await readJsonObject(request));
	if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid project" }, { status: 400 });
	const db = getDb(env);
	const project = await getOwnProject(db, auth.user.id, id);
	if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
	try {
		return NextResponse.json(await updateProject(db, project, parsed.data));
	} catch (error) {
		if (error instanceof ProjectError) return NextResponse.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

/** Deletes the project and its addresses; mail keeps its messages and loses the project at the next re-stamp. */
export async function DELETE(request: Request, { params }: ProjectRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const db = getDb(env);
	const project = await getOwnProject(db, auth.user.id, id);
	if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
	await deleteProject(db, project.id);
	return NextResponse.json({ ok: true });
}
