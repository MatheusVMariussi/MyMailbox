import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

// Searching over REST: `scope=search` on the session list and reader navigation searches every folder but Spam
// and Trash (unless the query names them), keeps the mailbox and project scope, resolves label: and project:,
// and maps a refused query to 400. `/api/v1/messages` gains the operators without the exclusion.
const D1_MAX_BOUND_PARAMETERS = 100;
const mocks = {
	"@/lib/cloudflare": "export function getEnv(){return globalThis.searchScopeEnv}",
	"@/lib/auth/cookies": "export async function getCurrentUser(){return globalThis.searchScopeUser} export async function requireUser(){return globalThis.searchScopeUser}",
	"@/lib/api/auth": `
		export async function requireSessionUser() { return { user: globalThis.searchScopeUser, error: null }; }
		export async function authenticateApiKey() { return { userId: globalThis.searchScopeUser.id, scopes: ["read"], mailboxIds: null }; }
		export function requireScope() { return true; }
	`,
};
const { app, newDatabase } = await loadApp("search-scope", `
	export * as list from "./src/app/api/messages/route.ts";
	export * as navigation from "./src/app/api/messages/navigation/route.ts";
	export * as v1 from "./src/app/api/v1/messages/route.ts";
`, { mocks });

const seed = `
	INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
		('owner', 'me@alpha.test', 'h', 'Owner', 'admin', 1),
		('other', 'other@x.test', 'h', 'Other', 'user', 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES
		('d-alpha', 'owner', 'alpha.test', 'z', 'active', 1),
		('d-foreign', 'other', 'foreign.test', 'z', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES
		('mb-a', 'owner', 'd-alpha', 'me', 'personal', 1),
		('mb-b', 'owner', 'd-alpha', 'team', 'personal', 1),
		('mb-x', 'other', 'd-foreign', 'other', 'personal', 1);
	INSERT INTO projects (id, user_id, name, color, sort_order, created_at) VALUES ('p-beta', 'owner', 'Beta', '#4f8cff', 0, 1);
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, private_draft, project_id, created_at) VALUES
		('i1', 'owner', 'mb-a', 'inbound', 'ana@x.test', 'me@alpha.test', 'Quarterly report', 'received', 0, 0, NULL, 10),
		('i2', 'owner', 'mb-b', 'inbound', 'bob@x.test', 'team@alpha.test', 'Lunch plans', 'received', 0, 0, 'p-beta', 11),
		('s1', 'owner', 'mb-a', 'outbound', 'me@alpha.test', 'ana@x.test', 'Re: Quarterly report', 'sent', 1, 0, NULL, 12),
		('a1', 'owner', 'mb-b', 'inbound', 'carol@y.test', 'team@alpha.test', 'Quarterly numbers', 'archived', 1, 0, 'p-beta', 13),
		('sp', 'owner', 'mb-a', 'inbound', 'scam@y.test', 'me@alpha.test', 'Quarterly prize', 'spam', 0, 0, NULL, 14),
		('tr', 'owner', 'mb-b', 'inbound', 'dan@y.test', 'team@alpha.test', 'Quarterly old', 'trash', 1, 0, NULL, 15),
		('dr', 'owner', 'mb-a', 'outbound', 'me@alpha.test', 'ana@x.test', 'Quarterly draft', 'draft', 1, 1, NULL, 16),
		('tp', 'owner', 'mb-a', 'outbound', 'me@alpha.test', '', 'Quarterly template', 'template', 1, 0, NULL, 17),
		('x1', 'other', 'mb-x', 'inbound', 'ana@x.test', 'other@foreign.test', 'Quarterly secret', 'received', 0, 0, NULL, 18);
	INSERT INTO labels (id, user_id, mailbox_id, name, color, created_at) VALUES
		('l-a', 'owner', 'mb-a', 'Clients', '#2563eb', 1),
		('l-b', 'owner', 'mb-b', 'clients', '#2563eb', 1);
	INSERT INTO message_labels (message_id, label_id) VALUES ('i1', 'l-a'), ('a1', 'l-b');
`;
const owner = { id: "owner", email: "me@alpha.test", name: "Owner", role: "admin" };
const get = (path, params) => new Request(`http://localhost${path}?${new URLSearchParams(params)}`);
const json = async (response) => ({ status: response.status, body: await response.json() });
const ids = (body) => body.messages.map((message) => message.id).sort();
const list = async (params) => {
	const { status, body } = await json(await app.list.GET(get("/api/messages", params)));
	assert.equal(status, 200, JSON.stringify(body));
	return ids(body);
};

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
	globalThis.searchScopeEnv = fixture.env;
	globalThis.searchScopeUser = owner;
	t.after(() => { delete globalThis.searchScopeEnv; delete globalThis.searchScopeUser; });
	return { ...fixture, state };
}

test("a search covers every folder but Spam and Trash, and never templates or other users' mail", async (t) => {
	await setup(t);
	assert.deepEqual(await list({ scope: "search", q: "quarterly" }), ["a1", "dr", "i1", "s1"]);
	// Folder parameters sent alongside are ignored while searching.
	assert.deepEqual(await list({ scope: "search", q: "quarterly", direction: "inbound", status: "received", labelId: "l-a", starred: "true" }), ["a1", "dr", "i1", "s1"]);
	assert.deepEqual(await list({ scope: "search", q: "quarterly in:spam" }), ["sp"]);
	assert.deepEqual(await list({ scope: "search", q: "quarterly in:trash" }), ["tr"]);
	assert.deepEqual(await list({ scope: "search", q: "quarterly in:anywhere" }), ["a1", "dr", "i1", "s1", "sp", "tr"]);
	assert.deepEqual(await list({ scope: "search", q: "quarterly -in:sent" }), ["a1", "dr", "i1"]);
});

test("a search keeps the selected mailbox or project", async (t) => {
	await setup(t);
	assert.deepEqual(await list({ scope: "search", q: "quarterly", mailboxId: "mb-a" }), ["dr", "i1", "s1"]);
	assert.deepEqual(await list({ scope: "search", q: "quarterly", projectId: "p-beta" }), ["a1"]);
	assert.deepEqual(await list({ scope: "search", q: "label:clients" }), ["a1", "i1"], "same-named labels of every mailbox");
	assert.deepEqual(await list({ scope: "search", q: "label:clients", mailboxId: "mb-a" }), ["i1"]);
	assert.deepEqual(await list({ scope: "search", q: "project:beta" }), ["a1", "i2"]);
	assert.deepEqual(await list({ scope: "search", q: "from:ana OR from:carol" }), ["a1", "i1"]);
	assert.deepEqual(await list({ scope: "search", q: "-is:read" }), ["i1", "i2"], "a negated flag is not lifted out of the query");
	assert.deepEqual(await list({ scope: "search", q: "is:unread OR in:sent" }), ["i1", "i2", "s1"]);
});

test("without scope=search a query still filters within the folder", async (t) => {
	await setup(t);
	assert.deepEqual(await list({ direction: "inbound", status: "received", q: "quarterly" }), ["i1"]);
	assert.deepEqual(await list({ status: "spam", q: "quarterly" }), ["sp"]);
});

test("the legacy title parameter joins the query as a subject phrase", async (t) => {
	await setup(t);
	assert.deepEqual(await list({ scope: "search", title: "Quarterly report" }), ["i1", "s1"]);
	assert.deepEqual(await list({ scope: "search", q: "from:ana", title: "quarterly report" }), ["i1"]);
	assert.deepEqual(await list({ scope: "search", title: 'a" OR "b' }), [], "quotes in the title cannot change the query");
});

test("reader navigation walks the same search", async (t) => {
	await setup(t);
	const { status, body } = await json(await app.navigation.GET(get("/api/messages/navigation", { folder: "inbox", scope: "search", q: "quarterly" })));
	assert.equal(status, 200);
	assert.deepEqual(body.messages.map((entry) => entry.id), ["dr", "a1", "s1", "i1"]);
	const scoped = await json(await app.navigation.GET(get("/api/messages/navigation", { folder: "inbox", scope: "search", q: "label:clients", mailboxId: "mb-a" })));
	assert.deepEqual(scoped.body.messages.map((entry) => entry.id), ["i1"]);
	const within = await json(await app.navigation.GET(get("/api/messages/navigation", { folder: "inbox", q: "quarterly" })));
	assert.deepEqual(within.body.messages.map((entry) => entry.id), ["i1"], "without scope=search the folder still applies");
});

test("the v1 API takes the operators and keeps Spam and Trash", async (t) => {
	await setup(t);
	const search = async (q) => ids((await json(await app.v1.GET(get("/api/v1/messages", { q })))).body);
	assert.deepEqual(await search("quarterly -in:drafts -in:sent -subject:template"), ["a1", "i1", "sp", "tr"]);
	assert.deepEqual(await search("label:clients"), ["a1", "i1"]);
	assert.deepEqual(await search("from:ana OR project:beta"), ["a1", "i1", "i2"]);
});

test("a refused query is a 400 with a clear message on every route", async (t) => {
	await setup(t);
	const tooComplex = Array.from({ length: 41 }, (_, index) => `larger:${index + 1}`).join(" ");
	const tooLong = "a ".repeat(800);
	for (const q of [tooComplex, tooLong]) {
		const listed = await json(await app.list.GET(get("/api/messages", { scope: "search", q })));
		assert.equal(listed.status, 400);
		assert.match(listed.body.error, /too (complex|long)/);
		assert.equal((await app.navigation.GET(get("/api/messages/navigation", { folder: "inbox", scope: "search", q }))).status, 400);
		assert.equal((await app.v1.GET(get("/api/v1/messages", { q }))).status, 400);
	}
});

test("the worst valid search stays under D1's 100 parameters with many mailboxes", async (t) => {
	const mailboxes = Array.from({ length: 40 }, (_, index) => `('mb-${index}', 'owner', 'd-alpha', 'box${index}', 'personal', 1)`).join(",");
	const rows = Array.from({ length: 80 }, (_, index) => `('m-${index}', 'owner', 'mb-${index % 40}', 'inbound', 'x@y.test', 'box@alpha.test', 'received', 0, 'thr-${index % 30}', ${index + 1}, ${100 + index})`).join(",");
	const { state } = await setup(t, `
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ${mailboxes};
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, read, thread_id, size_bytes, created_at) VALUES ${rows};
	`);
	const worst = Array.from({ length: 40 }, () => "larger:1").join(" ");
	for (const group of [undefined, "thread"]) {
		const listed = await json(await app.list.GET(get("/api/messages", { scope: "search", q: worst, projectId: "", read: "unread", limit: "100", ...(group ? { group } : {}) })));
		assert.equal(listed.status, 200, JSON.stringify(listed.body));
		assert.equal(group ? listed.body.messages.length : listed.body.total, group ? 30 : 80);
	}
	const navigation = await json(await app.navigation.GET(get("/api/messages/navigation", { folder: "inbox", scope: "search", q: worst, group: "thread" })));
	assert.equal(navigation.status, 200, JSON.stringify(navigation.body));
	assert.ok(state.maxBound <= D1_MAX_BOUND_PARAMETERS, `max bound ${state.maxBound}`);
});
