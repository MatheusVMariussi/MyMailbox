import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { readJsonObject } from "@/lib/http/request";
import { createLabel, LabelError, listLabels } from "@/lib/labels/service";
import { getMailboxAccessLevel, listAccessibleMailboxIds } from "@/lib/mailboxes/access";
import { labelSchema } from "@/lib/validators";

/** Labels of one mailbox (`mailboxId`), or of every mailbox the user can read. */
export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const db = getDb(env);
	const mailboxId = new URL(request.url).searchParams.get("mailboxId");
	if (mailboxId) {
		const access = await getMailboxAccessLevel(db, auth.user, mailboxId);
		if (!access?.canRead) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		return NextResponse.json({ labels: await listLabels(db, [mailboxId]) });
	}
	return NextResponse.json({ labels: await listLabels(db, await listAccessibleMailboxIds(db, auth.user)) });
}

export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const parsed = labelSchema.safeParse(await readJsonObject(request));
	if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid label" }, { status: 400 });

	const db = getDb(env);
	const access = await getMailboxAccessLevel(db, auth.user, parsed.data.mailboxId);
	if (!access?.canManage) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	try {
		const label = await createLabel(db, {
			userId: access.mailbox.userId,
			mailboxId: access.mailbox.id,
			name: parsed.data.name,
			color: parsed.data.color,
		});
		return NextResponse.json(label, { status: 201 });
	} catch (error) {
		if (error instanceof LabelError) return NextResponse.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
