import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { verifySvixSignature } from "@/lib/email/svix";
import { getSuppressionMode, recordSuppressionEvents } from "./suppression";
import { mapResendEvent } from "./suppression-utils";

/** Bounce and complaint events are a few KB; anything bigger is not from Resend. */
export const MAX_EVENT_BYTES = 256 * 1024;

export type EventResult = { status: number; body: Record<string, unknown> };

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const markerKey = (prefix: string, id: string) => `${prefix}${id.replace(/[^A-Za-z0-9_-]/g, "")}`;

export async function getResendEventsSecret(env: CloudflareEnv): Promise<string | null> {
	try {
		const [row] = await getDb(env).select({ secret: appSettings.resendEventsWebhookSecret }).from(appSettings).where(eq(appSettings.id, "default")).limit(1);
		return row?.secret ?? null;
	} catch {
		return null;
	}
}

/**
 * Resend `email.bounced` / `email.complained`, signed with the secret of the separate events webhook.
 * A captured request replays only once: the svix-id is remembered in the bucket after it was handled.
 * Mode "off" still verifies, then answers 200 without recording (so Resend stops retrying) and without
 * touching the bucket: the marker only prevents double counting, and nothing is counted while off.
 */
export async function processResendEvent(
	env: CloudflareEnv,
	request: { body: string; headers: { id: string | null; timestamp: string | null; signature: string | null } },
): Promise<EventResult> {
	const secret = await getResendEventsSecret(env);
	if (!secret) return { status: 503, body: { error: "Resend bounce events are not set up" } };
	if (bytes(request.body) > MAX_EVENT_BYTES) return { status: 413, body: { error: "Body too large" } };
	if (!await verifySvixSignature(secret, request.headers, request.body)) return { status: 401, body: { error: "Invalid signature" } };

	if (await getSuppressionMode(env) === "off") return { status: 200, body: { recorded: 0 } };

	const seen = request.headers.id ? markerKey("provider-events/resend/", request.headers.id) : null;
	if (seen && await env.BUCKET.head(seen)) return { status: 200, body: { ignored: "Already processed" } };

	let event: unknown;
	try { event = JSON.parse(request.body); } catch { return { status: 400, body: { error: "Invalid body" } }; }
	const mapped = mapResendEvent(event);
	const recorded = mapped ? await recordSuppressionEvents(env, { sender: mapped.sender, source: "resend", entries: mapped.entries }) : 0;
	if (seen) await env.BUCKET.put(seen, new Uint8Array(0));
	return { status: 200, body: { recorded } };
}
