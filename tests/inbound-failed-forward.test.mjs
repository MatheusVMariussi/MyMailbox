import assert from "node:assert/strict";
import test from "node:test";
import { emailMessage, loadWorker, mailBindings } from "./helpers/worker-email.mjs";

// A forward rule without "keep a copy" only sends mail to the queue when the
// forward itself failed, so the queue must store it rather than drop it.

const { worker, processInboundMessage, newDatabase } = await loadWorker("failed-forward");

const raw = "From: a@ext.test\r\nTo: x@one.test\r\nSubject: hi\r\nMessage-ID: <1@ext.test>\r\n\r\nbody\r\n";

async function setup(t) {
	const { env, sqlite } = await newDatabase(t, `
		INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('admin', 'owner@one.test', 'hash', 'Owner', 'admin', 1, 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('one', 'admin', 'one.test', 'z', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('box', 'admin', 'one', 'me', 1);
		INSERT INTO routing_rules (id, user_id, domain_id, scope, mailbox_id, pattern, action, forward_to, keep_copy, enabled, priority, created_at)
			VALUES ('r', 'admin', 'one', 'domain', 'box', '*', 'forward', 'team@elsewhere.test', 0, 1, 10, 1);
	`);
	const bindings = mailBindings();
	Object.assign(env, { BUCKET: bindings.BUCKET, INBOUND_QUEUE: bindings.INBOUND_QUEUE });
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	return { env, sqlite, queued: bindings.queued };
}

test("a catch-all forward that failed is stored in the catch-all mailbox", async (t) => {
	t.mock.method(console, "error", () => {});
	t.mock.method(console, "warn", () => {});
	t.mock.method(console, "info", () => {});
	const { env, sqlite, queued } = await setup(t);
	const message = emailMessage({ from: "a@ext.test", to: "x@one.test", raw, forwardFails: true });
	await worker.email(message, env, {});
	assert.deepEqual(message.rejected, []);
	assert.equal(queued.length, 1);

	await processInboundMessage(env, queued[0]);
	const rows = sqlite.prepare("SELECT mailbox_id, subject FROM messages").all();
	assert.deepEqual(rows.map((row) => ({ ...row })), [{ mailbox_id: "box", subject: "hi" }]);
});

test("a forward that went through is not queued, so nothing is stored", async (t) => {
	const { env, queued } = await setup(t);
	const message = emailMessage({ from: "a@ext.test", to: "x@one.test", raw });
	await worker.email(message, env, {});
	assert.deepEqual(message.forwarded, ["team@elsewhere.test"]);
	assert.equal(queued.length, 0);
});
