import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * Projects belong to one user, and so do their address mappings: unique per owner, domain and local part.
 * Mail is stamped only with a project of the mailbox owner (inbound) or of the acting user (sends, drafts),
 * even when another user has mapped the same address on a shared domain.
 */
const mocks = {
	"@/lib/auth/cookies": "export async function getCurrentUser(){return globalThis.projectScopeUser} export async function requireUser(){return globalThis.projectScopeUser}",
	"@/lib/api/auth": `
		export async function requireSessionUser() { return { user: globalThis.projectScopeUser, error: null }; }
		export async function authenticateApiKey() { return null; }
		export function requireScope() { return false; }
	`,
};
const { app, newDatabase } = await loadApp("project-owner-scope", `
	export { processInboundMessage } from "./src/lib/email/inbound.ts";
	export { resolveProjectSafely, restampMessages } from "./src/lib/projects/service.ts";
	export * as addresses from "./src/app/api/projects/[id]/addresses/route.ts";
	export * as drafts from "./src/app/api/drafts/route.ts";
`, { mocks });

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
	INSERT INTO project_addresses (id, project_id, user_id, domain_id, local_part, created_at) VALUES
		('a-alpha', 'p-alpha', 'admin', 'd-one', '', 1),
		('a-bob', 'p-bob', 'bob', 'd-one', 'me', 1);
`;
const admin = { id: "admin", email: "owner@one.test", name: "Owner", role: "admin" };
const bob = { id: "bob", email: "bob@one.test", name: "Bob", role: "user" };
const json = (method, body) => new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id) => ({ params: Promise.resolve({ id }) });

async function fixture(t) {
	const database = await newDatabase(t, seed);
	const objects = new Map();
	const env = {
		...database.env,
		BUCKET: { get: async (key) => (objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null), put: async () => {}, delete: async (key) => { objects.delete(key); } },
		REALTIME: { getByName: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
	};
	globalThis.__testEnv = env;
	t.after(() => {
		delete globalThis.__testEnv;
		delete globalThis.projectScopeUser;
	});
	t.mock.method(console, "info", () => {});
	t.mock.method(console, "warn", () => {});
	return { ...database, env, objects };
}

function inboundMime(to, id) {
	return `From: Friend <friend@x.test>\r\nTo: ${to}\r\nSubject: Hello\r\nMessage-ID: <${id}@x.test>\r\nDate: Thu, 19 Nov 2026 10:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nhi\r\n`;
}

test("inbound mail is not stamped with another user's project for its address", async (t) => {
	const { env, sqlite, objects } = await fixture(t);
	objects.set("raw/1", new TextEncoder().encode(inboundMime("me@one.test", "scope-1")).buffer);
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

test("two users on a shared domain each map hello@ to their own project, and each one's mail carries their own", async (t) => {
	const { env, sqlite, objects } = await fixture(t);
	// hello@one.test is admin's shared mailbox; bob may send as it.
	sqlite.exec(`
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ('hello-box', 'admin', 'd-one', 'hello', 'shared', 1);
		INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES ('acc-hello', 'hello-box', 'bob', 'send_as', 1);
		INSERT INTO projects (id, user_id, name, color, created_at) VALUES
			('p-desk', 'admin', 'Help desk', '#c084fc', 1),
			('p-bob-hello', 'bob', 'Bob hello', '#fbbf24', 1);
	`);
	const mapHello = async (user, projectId) => {
		globalThis.projectScopeUser = user;
		const response = await app.addresses.PUT(json("PUT", { addresses: [{ domainId: "d-one", localPart: "Hello" }] }), params(projectId));
		return { status: response.status, body: await response.json() };
	};

	const mappedByAdmin = await mapHello(admin, "p-desk");
	assert.equal(mappedByAdmin.status, 200, JSON.stringify(mappedByAdmin.body));
	const mappedByBob = await mapHello(bob, "p-bob-hello");
	assert.equal(mappedByBob.status, 200, JSON.stringify(mappedByBob.body));
	assert.deepEqual(mappedByBob.body.addresses.map((address) => `${address.localPart}@${address.hostname}`), ["hello@one.test"]);
	assert.deepEqual(
		sqlite.prepare("SELECT user_id, project_id FROM project_addresses WHERE local_part = 'hello' ORDER BY user_id").all().map((row) => ({ ...row })),
		[{ user_id: "admin", project_id: "p-desk" }, { user_id: "bob", project_id: "p-bob-hello" }],
	);

	// The same user still cannot give one address to two of their projects; the old set stays.
	const taken = await mapHello(bob, "p-bob");
	assert.equal(taken.status, 409);
	assert.match(taken.body.error, /hello@one\.test already belongs to another of your projects/);
	assert.deepEqual(sqlite.prepare("SELECT local_part FROM project_addresses WHERE project_id = 'p-bob'").all().map((row) => row.local_part), ["me"]);
	assert.throws(
		() => sqlite.exec("INSERT INTO project_addresses (id, project_id, user_id, domain_id, local_part, created_at) VALUES ('dup', 'p-bob', 'bob', 'd-one', 'hello', 1)"),
		/UNIQUE constraint failed: project_addresses\.user_id, project_addresses\.domain_id, project_addresses\.local_part/,
	);

	// Mail delivered to hello@ belongs to the mailbox owner, so it carries admin's project.
	objects.set("raw/hello", new TextEncoder().encode(inboundMime("hello@one.test", "hello-1")).buffer);
	await app.processInboundMessage(env, { from: "bounce@x.test", to: "hello@one.test", rawR2Key: "raw/hello" });
	assert.deepEqual({ ...sqlite.prepare("SELECT user_id, project_id FROM messages WHERE raw_r2_key = 'raw/hello'").get() }, { user_id: "admin", project_id: "p-desk" });

	// A draft from hello@ carries the project of whoever writes it.
	const draftFrom = async (user) => {
		globalThis.projectScopeUser = user;
		const response = await app.drafts.POST(json("POST", { from: "hello@one.test", mailboxId: "hello-box", to: "friend@x.test", subject: "Hi", text: "hello" }));
		const body = await response.json();
		assert.equal(response.status, 200, JSON.stringify(body));
		return { ...sqlite.prepare("SELECT user_id, project_id FROM messages WHERE id = ?").get(body.draft.id) };
	};
	assert.deepEqual(await draftFrom(bob), { user_id: "bob", project_id: "p-bob-hello" });
	assert.deepEqual(await draftFrom(admin), { user_id: "admin", project_id: "p-desk" });
});
