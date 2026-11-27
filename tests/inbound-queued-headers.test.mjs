import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * Queue messages are limited to 128 KB, so the header map an inbound message carries is bounded: the
 * headers the pipeline reads are kept first, the rest are truncated or left out. A message with huge
 * headers can then still be enqueued instead of failing (and being retried by the sender) forever.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { app, newDatabase } = await loadApp("inbound-queued-headers", `
	export { boundQueuedHeaders, MAX_QUEUED_HEADERS_BYTES } from "./src/lib/email/queued-headers.ts";
	export { intakeIncomingMail } from "./src/lib/email/intake.ts";
`);

const QUEUE_MESSAGE_LIMIT = 128 * 1024;
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function hugeHeaders() {
	const headers = {};
	for (let index = 0; index < 600; index++) headers[`x-junk-${index}`] = "j".repeat(2_000);
	headers["x-enormous"] = "e".repeat(400_000);
	// The headers the pipeline reads come last, as a hostile sender would arrange them.
	headers["authentication-results"] = "mx.cloudflare.net; dkim=pass header.d=x.test; spf=pass; dmarc=pass header.from=x.test";
	headers.from = "Friend <friend@x.test>";
	headers.subject = "Hello";
	headers["list-unsubscribe"] = "<https://x.test/unsubscribe>";
	headers["auto-submitted"] = "auto-replied";
	return headers;
}

test("a huge header map is bounded and keeps what the pipeline reads", () => {
	const bounded = app.boundQueuedHeaders(hugeHeaders());
	assert.ok(bytes(bounded) <= app.MAX_QUEUED_HEADERS_BYTES + 1024, `${bytes(bounded)} bytes`);
	assert.ok(app.MAX_QUEUED_HEADERS_BYTES < QUEUE_MESSAGE_LIMIT / 2);
	assert.equal(bounded["authentication-results"], hugeHeaders()["authentication-results"]);
	assert.equal(bounded.from, "Friend <friend@x.test>");
	assert.equal(bounded.subject, "Hello");
	assert.equal(bounded["list-unsubscribe"], "<https://x.test/unsubscribe>");
	assert.equal(bounded["auto-submitted"], "auto-replied");
	assert.ok(!bounded["x-enormous"] || bounded["x-enormous"].length < 10_000, "an oversized value is truncated");
});

test("an ordinary header map passes through unchanged", () => {
	const headers = { from: "a@x.test", to: "b@y.test", subject: "Hi", "message-id": "<1@x.test>", "x-mailer": "Mail 1.0" };
	assert.deepEqual(app.boundQueuedHeaders(headers), headers);
});

test("provider intake enqueues a bounded header map", async (t) => {
	const { env } = await newDatabase(t, `
		INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('u', 'u@one.test', 'h', 'U', 'admin', 1, 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d', 'u', 'one.test', 'z', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('m', 'u', 'd', 'me', 1);
	`);
	const sent = [];
	Object.assign(env, {
		BUCKET: { put: async () => {}, get: async () => null, head: async () => null, delete: async () => {} },
		INBOUND_QUEUE: { send: async (payload) => { sent.push(payload); } },
	});
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	const raw = new TextEncoder().encode("From: friend@x.test\r\nTo: me@one.test\r\nSubject: Hello\r\n\r\nhi\r\n").buffer;
	const result = await app.intakeIncomingMail(env, { from: "friend@x.test", to: "me@one.test", raw, headers: hugeHeaders() }, { forward: async () => false });
	assert.equal(result.action, "store");
	assert.equal(sent.length, 1);
	assert.ok(bytes(sent[0]) < QUEUE_MESSAGE_LIMIT, `${bytes(sent[0])} bytes`);
	assert.equal(sent[0].headers.from, "Friend <friend@x.test>");
});

test("the Worker email handler bounds the headers it enqueues", () => {
	const source = readFileSync(join(root, "worker.ts"), "utf8");
	const handler = source.slice(source.indexOf("async email("), source.indexOf("async queue("));
	assert.match(handler, /headers: boundQueuedHeaders\(headerMap\)/);
});
