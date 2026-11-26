import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { parseUndoSendSeconds } from "@/lib/compose/compose-utils";
import { getComposePreferences, updateComposePreferences } from "@/lib/compose/preferences";
import type { ComposePreferences } from "@/lib/compose/types";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	return NextResponse.json(await getComposePreferences(env, auth.user.id));
}

export async function PATCH(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const patch: Partial<ComposePreferences> = {};
	if (body && "trackOpensDefault" in body) {
		if (typeof body.trackOpensDefault !== "boolean") return NextResponse.json({ error: "trackOpensDefault must be a boolean" }, { status: 400 });
		patch.trackOpensDefault = body.trackOpensDefault;
	}
	if (body && "undoSendSeconds" in body) {
		const seconds = parseUndoSendSeconds(body.undoSendSeconds);
		if (seconds === null) return NextResponse.json({ error: "undoSendSeconds must be 0, 5, 10, 15 or 30" }, { status: 400 });
		patch.undoSendSeconds = seconds;
	}
	if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
	return NextResponse.json(await updateComposePreferences(env, auth.user.id, patch));
}
