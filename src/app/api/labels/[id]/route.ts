import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { readJsonObject } from "@/lib/http/request";
import { deleteLabel, LabelError, updateLabel } from "@/lib/labels/service";
import { labelUpdateSchema } from "@/lib/validators";
import { getLabelAccess } from "../utils";
import type { LabelRouteParams } from "./types";

/** Rename or recolor a label. */
export async function PATCH(request: Request, { params }: LabelRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = labelUpdateSchema.safeParse(await readJsonObject(request));
	if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid label" }, { status: 400 });

	const db = getDb(env);
	const access = await getLabelAccess(db, auth.user, id);
	if (!access?.canManage) return NextResponse.json({ error: "Label not found" }, { status: 404 });
	try {
		return NextResponse.json(await updateLabel(db, access.label, parsed.data));
	} catch (error) {
		if (error instanceof LabelError) return NextResponse.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

/**
 * Removes the label from its messages (never the messages) and then the label. A large label is
 * emptied in bounded steps: `done: false` means call again.
 */
export async function DELETE(request: Request, { params }: LabelRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const db = getDb(env);
	const access = await getLabelAccess(db, auth.user, id);
	if (!access?.canManage) return NextResponse.json({ error: "Label not found" }, { status: 404 });
	const result = await deleteLabel(db, id);
	return NextResponse.json({ ok: true, ...result });
}
