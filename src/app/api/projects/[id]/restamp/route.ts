import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { readJsonObject } from "@/lib/http/request";
import { listAccessibleMailboxIds } from "@/lib/mailboxes/access";
import { getOwnProject, restampMessages } from "@/lib/projects/service";
import { projectRestampSchema } from "@/lib/validators";
import type { ProjectRouteParams } from "../types";

/**
 * Recomputes the project of the mail in the user's mailboxes after mappings changed. Bounded: one call reads a
 * few pages and returns `done: false` with a `cursor` to send back until it reports `done: true`.
 */
export async function POST(request: Request, { params }: ProjectRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = projectRestampSchema.safeParse((await readJsonObject(request)) ?? {});
	if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid cursor" }, { status: 400 });
	const db = getDb(env);
	if (!await getOwnProject(db, auth.user.id, id)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
	const mailboxIds = await listAccessibleMailboxIds(db, auth.user);
	return NextResponse.json(await restampMessages(db, auth.user.id, mailboxIds, parsed.data.cursor ?? null));
}
