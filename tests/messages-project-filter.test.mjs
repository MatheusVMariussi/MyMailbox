import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

// The unified inbox and its project filter over REST: lists, counts and reader navigation filtered by project,
// per-project counts, grouped (same-named) labels across mailboxes, and D1's 100-parameter ceiling with many
// mailboxes. Also the /api/projects surface.
const D1_MAX_BOUND_PARAMETERS = 100;
const mocks = {
	"@/lib/cloudflare": "export function getEnv(){return globalThis.projectFilterEnv}",
	"@/lib/auth/cookies": "export async function getCurrentUser(){return globalThis.projectFilterUser} export async function requireUser(){return globalThis.projectFilterUser}",
	"@/lib/api/auth": `
		export async function requireSessionUser() { return { user: globalThis.projectFilterUser, error: null }; }
		export async function authenticateApiKey() { return { userId: globalThis.projectFilterUser.id, scopes: ["read"], mailboxIds: null }; }
		export function requireScope() { return true; }
	`,
};
const { app, newDatabase } = await loadApp("messages-project-filter", `
	export * as list from "./src/app/api/messages/route.ts";
	export * as counts from "./src/app/api/messages/counts/route.ts";
	export * as navigation from "./src/app/api/messages/navigation/route.ts";
	export * as v1 from "./src/app/api/v1/messages/route.ts";
	export * as projects from "./src/app/api/projects/route.ts";
	export * as project from "./src/app/api/projects/[id]/route.ts";
	export * as addresses from "./src/app/api/projects/[id]/addresses/route.ts";
	export * as restamp from "./src/app/api/projects/[id]/restamp/route.ts";
`, { mocks });

const seed = `
	INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
		('owner', 'me@alpha.test', 'h', 'Owner', 'admin', 1),
		('other', 'other@x.test', 'h', 'Other', 'user', 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES
		('d-alpha', 'owner', 'alpha.test', 'z', 'active', 1),
		('d-beta', 'owner', 'beta.test', 'z', 'active', 1),
		('d-foreign', 'other', 'foreign.test', 'z', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES
		('mb-a', 'owner', 'd-alpha', 'me', 'personal', 1),
		('mb-b', 'owner', 'd-beta', 'team', 'personal', 1),
		('mb-x', 'other', 'd-foreign', 'other', 'personal', 1);
	INSERT INTO projects (id, user_id, name, color, sort_order, created_at) VALUES
		('p-alpha', 'owner', 'Alpha', '#4f8cff', 0, 1),
		('p-beta', 'owner', 'Beta', '#34d399', 1, 1);
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, project_id, created_at) VALUES
		('a1', 'owner', 'mb-a', 'inbound', 'x@y.test', 'me@alpha.test', 'A1', 'received', 0, 'p-alpha', 10),
		('a2', 'owner', 'mb-a', 'inbound', 'x@y.test', 'me@alpha.test', 'A2', 'received', 1, 'p-alpha', 11),
		('b1', 'owner', 'mb-b', 'inbound', 'x@y.test', 'team@beta.test', 'B1', 'received', 0, 'p-beta', 12),
		('b2', 'owner', 'mb-a', 'inbound', 'x@y.test', 'me@beta.test', 'B2', 'archived', 0, 'p-beta', 13),
		('n1', 'owner', 'mb-b', 'inbound', 'x@y.test', 'team@beta.test', 'N1', 'received', 0, NULL, 14),
		('s1', 'owner', 'mb-b', 'outbound', 'team@beta.test', 'r@y.test', 'S1', 'sent', 1, 'p-beta', 15),
		('x1', 'other', 'mb-x', 'inbound', 'x@y.test', 'other@foreign.test', 'X1', 'received', 0, 'p-alpha', 16);
	INSERT INTO labels (id, user_id, mailbox_id, name, color, created_at) VALUES
		('l-a', 'owner', 'mb-a', 'Clients', '#2563eb', 1),
		('l-b', 'owner', 'mb-b', 'Clients', '#2563eb', 1);
	INSERT INTO message_labels (message_id, label_id) VALUES ('a1', 'l-a'), ('b1', 'l-b'), ('b2', 'l-a');
`;
const owner = { id: "owner", email: "me@alpha.test", name: "Owner", role: "admin" };
const get = (url) => new Request(`http://localhost${url}`);
const send = (method, body) => new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id) => ({ params: Promise.resolve({ id }) });
const json = async (response) => ({ status: response.status, body: await response.json() });
const ids = (body) => body.messages.map((message) => message.id).sort();

async function setup(t, extraSeed = "") {
	const fixture = await newDatabase(t, seed + extraSeed);
	const state = { maxBound: 0 };
	// Behave like D1: refuse a statement that binds more than 100 parameters.
	const prepare = fixture.env.DB.prepare.bind(fixture.env.DB);
	fixture.env.DB.prepare = (sql) => {
		const wrap = (statement) => {
			const bind = statement.bind.bind(statement);
			statement.bind = (...args) => {
				state.maxBound = Math.max(state.maxBound, args.length);
				if (args.length > D1_MAX_BOUND_PARAMETERS) throw new Error(`D1_ERROR: too many SQL variables (${args.length}): ${sql.slice(0, 120)}`);
				return wrap(bind(...args));
			};
			return statement;
		};
		return wrap(prepare(sql));
	};
	globalThis.projectFilterEnv = fixture.env;
	globalThis.projectFilterUser = owner;
	t.after(() => { delete globalThis.projectFilterEnv; delete globalThis.projectFilterUser; });
	return { ...fixture, state };
}

test("the unified inbox lists every accessible mailbox and carries each row's project", async (t) => {
	await setup(t);
	const { body } = await json(await app.list.GET(get("/api/messages?direction=inbound&status=received")));
	assert.deepEqual(ids(body), ["a1", "a2", "b1", "n1"]);
	assert.equal(body.messages.find((message) => message.id === "b1").projectId, "p-beta");
	assert.equal(body.messages.find((message) => message.id === "n1").projectId, null);
});

test("a project filter narrows lists, reader navigation and the v1 API", async (t) => {
	await setup(t);
	assert.deepEqual(ids((await json(await app.list.GET(get("/api/messages?direction=inbound&status=received&projectId=p-alpha")))).body), ["a1", "a2"]);
	assert.deepEqual(ids((await json(await app.list.GET(get("/api/messages?projectId=p-beta")))).body), ["b1", "b2", "s1"]);
	assert.deepEqual(ids((await json(await app.list.GET(get("/api/messages?direction=inbound&status=received&projectId=p-beta&mailboxId=mb-a")))).body), []);
	const navigation = (await json(await app.navigation.GET(get("/api/messages/navigation?folder=inbox&projectId=p-beta")))).body;
	assert.deepEqual(navigation.messages.map((entry) => entry.id), ["b1"]);
	assert.deepEqual(ids((await json(await app.v1.GET(get("/api/v1/messages?projectId=p-alpha")))).body), ["a1", "a2"]);
	// A malformed id filters nothing rather than matching everything by accident.
	assert.equal((await json(await app.list.GET(get("/api/messages?direction=inbound&status=received&projectId=%27%20OR%201")))).body.messages.length, 4);
});

test("counts report Inbox per project, and a project scope narrows the folder counts only", async (t) => {
	await setup(t);
	const all = (await json(await app.counts.GET(get("/api/messages/counts")))).body.counts;
	assert.deepEqual(all.projects, { "p-alpha": { total: 2, unread: 1 }, "p-beta": { total: 1, unread: 1 } });
	assert.deepEqual(all.folders.inbox, { total: 4, unread: 3 });
	const beta = (await json(await app.counts.GET(get("/api/messages/counts?projectId=p-beta")))).body.counts;
	assert.deepEqual(beta.folders.inbox, { total: 1, unread: 1 });
	assert.deepEqual(beta.folders.archived, { total: 1, unread: 1 });
	assert.deepEqual(beta.folders.sent, { total: 1, unread: 0 });
	assert.deepEqual(beta.projects, all.projects, "per-project counts ignore the scope");
});

test("separate Promotions leave a project's Inbox count like the folder's", async (t) => {
	await setup(t, `
		UPDATE messages SET category = 'promotions' WHERE id = 'a1';
		INSERT INTO mailbox_promotion_settings (mailbox_id, mode, updated_at) VALUES ('mb-a', 'separate', 1);
	`);
	const counts = (await json(await app.counts.GET(get("/api/messages/counts?projectId=p-alpha")))).body.counts;
	assert.deepEqual(counts.projects["p-alpha"], { total: 1, unread: 0 });
	assert.deepEqual(counts.folders.inbox, { total: 1, unread: 0 });
	assert.deepEqual(counts.folders.promotions, { total: 1, unread: 1 });
});

test("a grouped label lists mail carrying any of its same-named labels", async (t) => {
	await setup(t);
	assert.deepEqual(ids((await json(await app.list.GET(get("/api/messages?labelId=l-a,l-b")))).body), ["a1", "b1", "b2"]);
	assert.deepEqual(ids((await json(await app.list.GET(get("/api/messages?labelId=l-a")))).body), ["a1", "b2"]);
	assert.deepEqual(ids((await json(await app.list.GET(get("/api/messages?labelId=l-a,l-b&projectId=p-beta")))).body), ["b1", "b2"]);
	const navigation = (await json(await app.navigation.GET(get("/api/messages/navigation?folder=inbox&labelId=l-b,l-a")))).body;
	assert.deepEqual(navigation.messages.map((entry) => entry.id).sort(), ["a1", "b1", "b2"]);
	const tooMany = Array.from({ length: 101 }, (_, index) => `l-${index}`).join(",");
	assert.equal((await app.list.GET(get(`/api/messages?labelId=${tooMany}`))).status, 400);
});

test("with many mailboxes, a project filter and a 60-label group stay under D1's 100 parameters", async (t) => {
	const mailboxes = Array.from({ length: 60 }, (_, index) => `('mb-${index}', 'owner', 'd-alpha', 'box${index}', 'personal', 1)`).join(",");
	const labels = Array.from({ length: 60 }, (_, index) => `('lg-${index}', 'owner', 'mb-${index}', 'Group', '#2563eb', 1)`).join(",");
	const rows = Array.from({ length: 120 }, (_, index) => `('m-${index}', 'owner', 'mb-${index % 60}', 'inbound', 'x@y.test', 'box@alpha.test', 'received', 0, 'thr-${index}', '${index % 2 ? "p-alpha" : "p-beta"}', ${100 + index})`).join(",");
	const members = Array.from({ length: 120 }, (_, index) => `('m-${index}', 'lg-${index % 60}')`).join(",");
	const { state } = await setup(t, `
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ${mailboxes};
		INSERT INTO labels (id, user_id, mailbox_id, name, color, created_at) VALUES ${labels};
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, read, thread_id, project_id, created_at) VALUES ${rows};
		INSERT INTO message_labels (message_id, label_id) VALUES ${members};
	`);
	const group = Array.from({ length: 60 }, (_, index) => `lg-${index}`).join(",");
	const list = await json(await app.list.GET(get(`/api/messages?labelId=${group}&projectId=p-alpha&group=thread&limit=100`)));
	assert.equal(list.status, 200, JSON.stringify(list.body));
	assert.equal(list.body.messages.length, 60);
	assert.ok(list.body.messages.every((message) => message.projectId === "p-alpha"));
	const inbox = await json(await app.list.GET(get("/api/messages?direction=inbound&status=received&projectId=p-beta&limit=100")));
	assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
	assert.equal(inbox.body.total, 61);
	const counts = await json(await app.counts.GET(get("/api/messages/counts?projectId=p-alpha")));
	assert.equal(counts.status, 200, JSON.stringify(counts.body));
	assert.equal(counts.body.counts.projects["p-alpha"].total, 62);
	const navigation = await json(await app.navigation.GET(get(`/api/messages/navigation?folder=inbox&labelId=${group}&projectId=p-alpha`)));
	assert.equal(navigation.status, 200);
	assert.equal(navigation.body.messages.length, 60);
	assert.ok(state.maxBound <= D1_MAX_BOUND_PARAMETERS, `max bound ${state.maxBound}`);
});

test("the unified inbox page walks the unified index instead of sorting every mailbox", async (t) => {
	const { sqlite } = await setup(t);
	const plan = sqlite.prepare(`EXPLAIN QUERY PLAN SELECT id FROM messages
		WHERE mailbox_id IN ('mb-a', 'mb-b') AND (user_id = 'owner' OR private_draft = 0) AND direction = 'inbound' AND status = 'received'
		AND (snoozed_until IS NULL OR snoozed_until <= 5) AND project_id = 'p-alpha'
		ORDER BY created_at DESC LIMIT 25`).all().map((row) => row.detail).join("\n");
	assert.match(plan, /messages_unified_page_idx/);
	assert.doesNotMatch(plan, /TEMP B-TREE/);
});

test("projects are managed over REST, mapped only to accessible domains, and re-stamped in bounded calls", async (t) => {
	const { sqlite } = await setup(t);
	const listed = (await json(await app.projects.GET(get("/api/projects")))).body;
	assert.deepEqual(listed.projects.map((project) => project.name), ["Alpha", "Beta"]);
	assert.deepEqual(listed.domains.map((domain) => domain.hostname), ["alpha.test", "beta.test"]);

	const created = await json(await app.projects.POST(send("POST", { name: "  Gamma  ", color: "#c084fc" })));
	assert.equal(created.status, 201);
	assert.equal(created.body.name, "Gamma");
	assert.equal((await app.projects.POST(send("POST", { name: "Gamma" }))).status, 409);
	assert.equal((await app.projects.POST(send("POST", { name: "Delta", color: "#000000" }))).status, 400);

	assert.equal((await app.addresses.PUT(send("PUT", { addresses: [{ domainId: "d-foreign", localPart: "" }] }), params(created.body.id))).status, 404);
	assert.equal((await app.addresses.PUT(send("PUT", { addresses: [{ domainId: "d-alpha", localPart: "a+b" }] }), params(created.body.id))).status, 400);
	const mapped = await json(await app.addresses.PUT(send("PUT", { addresses: [{ domainId: "d-beta", localPart: " Team " }] }), params(created.body.id)));
	assert.equal(mapped.status, 200);
	assert.deepEqual(mapped.body.addresses.map((address) => `${address.localPart}@${address.hostname}`), ["team@beta.test"]);

	let cursor = null;
	let result;
	do {
		result = (await json(await app.restamp.POST(send("POST", { cursor }), params(created.body.id)))).body;
		cursor = result.cursor;
	} while (!result.done);
	const stamps = Object.fromEntries(sqlite.prepare("SELECT id, project_id FROM messages WHERE user_id = 'owner'").all().map((row) => [row.id, row.project_id]));
	// team@beta.test mail (inbound to it, sent from it) is Gamma's now; nothing else maps any more.
	assert.deepEqual(stamps, { a1: null, a2: null, b1: created.body.id, b2: null, n1: created.body.id, s1: created.body.id });

	assert.equal((await app.project.PATCH(send("PATCH", { name: "Gamma 2" }), params(created.body.id))).status, 200);
	globalThis.projectFilterUser = { id: "other", email: "other@x.test", name: "Other", role: "user" };
	assert.equal((await app.project.PATCH(send("PATCH", { name: "Mine now" }), params(created.body.id))).status, 404);
	assert.equal((await app.project.DELETE(get("/x"), params(created.body.id))).status, 404);
	assert.equal((await app.restamp.POST(send("POST", {}), params(created.body.id))).status, 404);
	globalThis.projectFilterUser = owner;
	assert.equal((await app.project.DELETE(get("/x"), params(created.body.id))).status, 200);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM project_addresses WHERE project_id = ?").get(created.body.id).n, 0);
});
