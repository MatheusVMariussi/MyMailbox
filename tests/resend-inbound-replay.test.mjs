import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * The Resend inbound webhook: a verified delivery is processed once per Svix message id (a replay
 * within the signature tolerance is acknowledged and ignored, and a failed attempt can be retried),
 * and the raw download is cut off at the 25 MiB receiving limit instead of being buffered whole.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { app, newDatabase } = await loadApp("resend-inbound-replay", `
	export * as inbound from "./src/app/api/inbound/resend/route.ts";
	export { openFileBucket } from "./tests/helpers/file-bucket.ts";
	export { sweepOrphanedRawMail } from "./src/lib/email/raw-sweeper.ts";
`);

const secretBytes = Buffer.from("inbound-webhook-secret");
const SECRET = `whsec_${secretBytes.toString("base64")}`;
const MIB = 1024 * 1024;

function signed(id, body = JSON.stringify({ type: "email.received", data: { email_id: "em_1" } })) {
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = `v1,${createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
	return new Request("https://mail.test/api/inbound/resend", {
		method: "POST",
		headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
		body,
	});
}

async function fixture(t, download) {
	const database = await newDatabase(t, `
		UPDATE app_settings SET resend_api_key = 're_key', resend_webhook_secret = '${SECRET}' WHERE id = 'default';
	`);
	const bucketRoot = mkdtempSync(join(root, "node_modules", "resend-replay-bucket-"));
	t.after(() => rmSync(bucketRoot, { recursive: true, force: true }));
	const env = { ...database.env, BUCKET: app.openFileBucket(bucketRoot) };
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	const calls = { resend: 0, download: 0 };
	t.mock.method(globalThis, "fetch", async (url) => {
		const target = String(url);
		if (target.includes("/emails/receiving/")) {
			calls.resend += 1;
			// No recipient is on a domain this install manages, so intake stores nothing.
			return Response.json({ id: "em_1", from: "friend@x.test", to: ["someone@elsewhere.test"], raw: { download_url: "https://download.test/raw" } });
		}
		if (target === "https://download.test/raw") {
			calls.download += 1;
			return download();
		}
		throw new Error(`unexpected fetch ${target}`);
	});
	return { env, calls };
}

const smallMessage = () => new Response("From: a@x.test\r\nTo: someone@elsewhere.test\r\nSubject: hi\r\n\r\nhello\r\n");

test("a replayed Svix delivery is acknowledged without being processed again", async (t) => {
	const { calls } = await fixture(t, smallMessage);
	const first = await app.inbound.POST(signed("msg_replay"));
	assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
	assert.deepEqual(calls, { resend: 1, download: 1 });

	const replay = await app.inbound.POST(signed("msg_replay"));
	assert.equal(replay.status, 200);
	assert.equal((await replay.json()).ignored, "Already processed");
	assert.deepEqual(calls, { resend: 1, download: 1 }, "Resend is not asked again");

	assert.equal((await app.inbound.POST(signed("msg_other"))).status, 200);
	assert.deepEqual(calls, { resend: 2, download: 2 }, "a different delivery is processed");
});

test("a failed attempt leaves the delivery open for the provider's retry", async (t) => {
	let fail = true;
	const { calls } = await fixture(t, () => (fail ? new Response("nope", { status: 500 }) : smallMessage()));
	assert.equal((await app.inbound.POST(signed("msg_retry"))).status, 502);
	fail = false;
	assert.equal((await app.inbound.POST(signed("msg_retry"))).status, 200);
	assert.equal(calls.download, 2);
});

test("an oversized raw download is dropped without buffering it", async (t) => {
	let pulled = 0;
	const { calls } = await fixture(t, () => new Response(new ReadableStream({
		pull(controller) {
			pulled += 1;
			if (pulled > 40) return controller.close();
			controller.enqueue(new Uint8Array(MIB));
		},
	})));
	const response = await app.inbound.POST(signed("msg_big"));
	assert.equal(response.status, 200);
	assert.match((await response.json()).dropped, /25 MiB/);
	assert.equal(calls.download, 1);
	assert.ok(pulled <= 27, `read ${pulled} MiB before stopping`);
});

test("replay markers are swept once they are old", async (t) => {
	const { env } = await fixture(t, smallMessage);
	await app.inbound.POST(signed("msg_sweep"));
	assert.ok((await env.BUCKET.list({ prefix: "svix-seen/" })).objects.length === 1);
	await app.sweepOrphanedRawMail(env, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
	assert.equal((await env.BUCKET.list({ prefix: "svix-seen/" })).objects.length, 0);
});
