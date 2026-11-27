import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * Projects belong to one user. Mail is stamped only with a project of the mailbox owner (inbound) or of
 * the acting user (sends, drafts), even when another user has mapped the same address on a shared domain.
 */
const { app, newDatabase } = await loadApp("project-owner-scope", `
	export { processInboundMessage } from "./src/lib/email/inbound.ts";
	export { resolveProjectSafely, restampMessages } from "./src/lib/projects/service.ts";
`);

// `admin` owns one.test and the mailbox me@one.test, and maps the whole domain to Alpha. `bob` can use the
// shared domain too and maps the exact address me@one.test to his own project.
const seed = `
	INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES
		('admin', 'owner@one.test', 'hash', 'Owner', 'admin', 1, 1),
		('bob', 'bob@one.test', 'hash', 'Bob', 'user', 0, 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d-one', 'admin', 'one.test', 'z1', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES
		('box', 'admin', 'd-one', 'me', 1),
		('bob-box', 'bob', 'd-one', 'bob', 1);
	INSERT INTO projects (id, user_id, name, color, created_at) VALUES
		('p-alpha', 'admin', 'Alpha', '#4f8cff', 1),
		('p-bob', 'bob', 'Bob side project', '#34d399', 1);
	INSERT INTO project_addresses (id, project_id, domain_id, local_part, created_at) VALUES
		('a-alpha', 'p-alpha', 'd-one', '', 1),
		('a-bob', 'p-bob', 'd-one', 'me', 1);
`;

async function fixture(t) {
	const database = await newDatabase(t, seed);
	const objects = new Map();
	const env = {
		...database.env,
		BUCKET: { get: async (key) => (objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null), put: async () => {}, delete: async (key) => { objects.delete(key); } },
		REALTIME: { getByName: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
	};
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	t.mock.method(console, "info", () => {});
	t.mock.method(console, "warn", () => {});
	return { ...database, env, objects };
}

test("inbound mail is not stamped with another user's project for its address", async (t) => {
	const { env, sqlite, objects } = await fixture(t);
	const mime = "From: Friend <friend@x.test>\r\nTo: me@one.test\r\nSubject: Hello\r\nMessage-ID: <scope-1@x.test>\r\nDate: Thu, 19 Nov 2026 10:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nhi\r\n";
	objects.set("raw/1", new TextEncoder().encode(mime).buffer);
	await app.processInboundMessage(env, { from: "bounce@x.test", to: "me@one.test", rawR2Key: "raw/1" });
	const row = sqlite.prepare("SELECT user_id, project_id FROM messages WHERE raw_r2_key = 'raw/1'").get();
	assert.equal(row.user_id, "admin");
	assert.equal(row.project_id, "p-alpha");
});

test("sends and drafts resolve only the acting user's projects", async (t) => {
	const { db } = await fixture(t);
	assert.equal((await app.resolveProjectSafely(db, "admin", "Me <me@one.test>"))?.id, "p-alpha");
	assert.equal((await app.resolveProjectSafely(db, "bob", "me@one.test"))?.id, "p-bob");
	assert.equal(await app.resolveProjectSafely(db, "bob", "bob@one.test"), null, "bob has no mapping for his own address");
});

test("re-stamping uses only the owner's mappings and leaves other users' mail alone", async (t) => {
	const { db, sqlite } = await fixture(t);
	sqlite.exec(`
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, delivered_to, status, created_at) VALUES
			('m-admin', 'admin', 'box', 'inbound', 'friend@x.test', 'me@one.test', 'me@one.test', 'received', 1),
			('m-bob', 'bob', 'bob-box', 'outbound', 'me@one.test', 'friend@x.test', NULL, 'sent', 1);
	`);
	const projectOf = (id) => sqlite.prepare("SELECT project_id FROM messages WHERE id = ?").get(id).project_id;

	await app.restampMessages(db, "admin", ["box", "bob-box"], null);
	assert.equal(projectOf("m-admin"), "p-alpha");
	assert.equal(projectOf("m-bob"), null, "admin's re-stamp does not touch bob's mail");

	await app.restampMessages(db, "bob", ["box", "bob-box"], null);
	assert.equal(projectOf("m-admin"), "p-alpha", "bob's re-stamp does not touch admin's mail");
	assert.equal(projectOf("m-bob"), "p-bob");
});
