import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

const { app, newDatabase } = await loadApp("projects-service", `
	export * as projects from "./src/lib/projects/service.ts";
`);
const p = app.projects;

const seed = `
	INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
		('owner', 'owner@alpha.test', 'h', 'Owner', 'admin', 1),
		('other', 'other@x.test', 'h', 'Other', 'user', 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES
		('d-alpha', 'owner', 'alpha.test', 'z', 'active', 1),
		('d-beta', 'owner', 'beta.test', 'z', 'active', 1),
		('d-foreign', 'other', 'foreign.test', 'z', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES
		('mb-a', 'owner', 'd-alpha', 'me', 'personal', 1),
		('mb-b', 'owner', 'd-beta', 'team', 'personal', 1),
		('mb-x', 'other', 'd-foreign', 'other', 'personal', 1);
`;
const owner = { id: "owner", email: "owner@alpha.test", role: "admin" };
const hostnames = new Map([["d-alpha", "alpha.test"], ["d-beta", "beta.test"], ["d-foreign", "foreign.test"]]);

test("projects are listed per user in order, with their addresses", async (t) => {
	const { db } = await newDatabase(t, seed);
	const first = await p.createProject(db, { userId: "owner", name: "Alpha", color: "#4f8cff" });
	const second = await p.createProject(db, { userId: "owner", name: "Beta", color: "#34d399" });
	await p.createProject(db, { userId: "other", name: "Alpha", color: "#4f8cff" });
	assert.equal(second.sortOrder, first.sortOrder + 1);
	await p.setProjectAddresses(db, first, [{ domainId: "d-alpha", localPart: "" }, { domainId: "d-beta", localPart: "sales" }], hostnames);
	const listed = await p.listProjects(db, "owner");
	assert.deepEqual(listed.map((project) => project.name), ["Alpha", "Beta"]);
	assert.deepEqual(listed[0].addresses.map((address) => `${address.localPart}@${address.hostname}`), ["@alpha.test", "sales@beta.test"]);
	await assert.rejects(p.createProject(db, { userId: "owner", name: "Alpha", color: "#4f8cff" }), { status: 409 });
	await assert.rejects(p.updateProject(db, second, { name: "Alpha" }), { status: 409 });
	assert.equal((await p.updateProject(db, second, { color: "#fbbf24" })).color, "#fbbf24");
});

test("an address that normalizes like another project's is refused, and the old set stays", async (t) => {
	const { db, sqlite } = await newDatabase(t, seed);
	const alpha = await p.createProject(db, { userId: "owner", name: "Alpha", color: "#4f8cff" });
	const beta = await p.createProject(db, { userId: "owner", name: "Beta", color: "#4f8cff" });
	await p.setProjectAddresses(db, alpha, [{ domainId: "d-alpha", localPart: "first.last" }], hostnames);
	await p.setProjectAddresses(db, beta, [{ domainId: "d-beta", localPart: "" }], hostnames);
	await assert.rejects(p.setProjectAddresses(db, beta, [{ domainId: "d-alpha", localPart: "firstlast" }], hostnames), { status: 409, message: /firstlast@alpha.test/ });
	assert.deepEqual(sqlite.prepare("SELECT project_id, local_part FROM project_addresses ORDER BY local_part DESC").all().map((row) => ({ ...row })), [
		{ project_id: alpha.id, local_part: "first.last" },
		{ project_id: beta.id, local_part: "" },
	]);
	// Replacing its own addresses is fine, even with the same local part.
	await p.setProjectAddresses(db, alpha, [{ domainId: "d-alpha", localPart: "first.last" }, { domainId: "d-alpha", localPart: "" }], hostnames);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM project_addresses WHERE project_id = ?").get(alpha.id).n, 2);
});

test("many addresses are written in statements under D1's parameter limit", async (t) => {
	const { db, sqlite } = await newDatabase(t, seed);
	const alpha = await p.createProject(db, { userId: "owner", name: "Alpha", color: "#4f8cff" });
	const addresses = Array.from({ length: 100 }, (_, index) => ({ domainId: "d-alpha", localPart: `user${index}` }));
	await p.setProjectAddresses(db, alpha, addresses, hostnames);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM project_addresses").get().n, 100);
});

test("the server resolves an address to its project and name", async (t) => {
	const { db } = await newDatabase(t, seed);
	const alpha = await p.createProject(db, { userId: "owner", name: "Alpha", color: "#4f8cff" });
	const sales = await p.createProject(db, { userId: "owner", name: "Sales", color: "#4f8cff" });
	await p.setProjectAddresses(db, alpha, [{ domainId: "d-alpha", localPart: "" }], hostnames);
	await p.setProjectAddresses(db, sales, [{ domainId: "d-alpha", localPart: "sales" }], hostnames);
	assert.deepEqual(await p.resolveProjectForAddress(db, "Sa.les+x@Alpha.test"), { id: sales.id, name: "Sales" });
	assert.deepEqual(await p.resolveProjectForAddress(db, "me@alpha.test"), { id: alpha.id, name: "Alpha" });
	assert.equal(await p.resolveProjectForAddress(db, "me@beta.test"), null);
	assert.equal(await p.resolveProjectSafely(db, null), null);
});

test("mappable domains are the user's own plus those of their accessible mailboxes", async (t) => {
	const { db, sqlite } = await newDatabase(t, seed);
	assert.deepEqual((await p.listProjectDomains(db, owner)).map((domain) => domain.hostname), ["alpha.test", "beta.test"]);
	sqlite.exec("UPDATE mailboxes SET type = 'shared' WHERE id = 'mb-x'; INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES ('acc', 'mb-x', 'owner', 'read_only', 1)");
	assert.deepEqual((await p.listProjectDomains(db, owner)).map((domain) => domain.hostname), ["alpha.test", "beta.test", "foreign.test"]);
});

test("re-stamping walks the mailboxes in bounded pages and writes only what changed", async (t) => {
	const { db, sqlite } = await newDatabase(t, seed);
	const alpha = await p.createProject(db, { userId: "owner", name: "Alpha", color: "#4f8cff" });
	const beta = await p.createProject(db, { userId: "owner", name: "Beta", color: "#4f8cff" });
	const insert = sqlite.prepare(`INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, cc_addr, delivered_to, project_id, status, created_at)
		VALUES (?, 'owner', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
	// Inbound with an envelope recipient, legacy inbound without one (To/Cc decide), outbound (From decides).
	insert.run("in-env", "mb-a", "inbound", "x@y.test", "list@elsewhere.test", null, "me@beta.test", null, "received", 1);
	insert.run("in-legacy", "mb-a", "inbound", "x@y.test", "Me <me@alpha.test>", null, null, null, "received", 2);
	insert.run("in-cc", "mb-a", "inbound", "x@y.test", "list@elsewhere.test", "me@beta.test", null, null, "received", 3);
	insert.run("out", "mb-b", "outbound", "Team <team@beta.test>", "r@y.test", null, null, null, "sent", 4);
	insert.run("stale", "mb-b", "inbound", "x@y.test", "nobody@elsewhere.test", null, null, "prj_deleted", "received", 5);
	insert.run("foreign", "mb-x", "inbound", "x@y.test", "me@alpha.test", null, null, null, "received", 6);
	await p.setProjectAddresses(db, alpha, [{ domainId: "d-alpha", localPart: "" }], hostnames);
	await p.setProjectAddresses(db, beta, [{ domainId: "d-beta", localPart: "" }], hostnames);

	// One page per call, so the cursor has to carry the walk from mailbox to mailbox.
	const calls = [];
	let cursor = null;
	for (let guard = 0; guard < 10; guard++) {
		const result = await p.restampMessages(db, ["mb-b", "mb-a"], cursor, 1);
		calls.push(result);
		if (result.done) break;
		cursor = result.cursor;
	}
	assert.equal(calls.at(-1).done, true);
	assert.equal(calls.reduce((total, call) => total + call.updated, 0), 5);
	const stamps = Object.fromEntries(sqlite.prepare("SELECT id, project_id FROM messages").all().map((row) => [row.id, row.project_id]));
	assert.deepEqual(stamps, { "in-env": beta.id, "in-legacy": alpha.id, "in-cc": beta.id, out: beta.id, stale: null, foreign: null });
	// Nothing left to change: a second run writes nothing.
	assert.deepEqual(await p.restampMessages(db, ["mb-a", "mb-b"], null), { done: true, scanned: 5, updated: 0, cursor: null });
});

test("a re-stamp page stops at the page size and resumes after the last row", async (t) => {
	const { db, sqlite } = await newDatabase(t, seed);
	const insert = sqlite.prepare("INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, created_at) VALUES (?, 'owner', 'mb-a', 'inbound', 'x@y.test', 'me@alpha.test', 'received', 1)");
	for (let index = 0; index < p.RESTAMP_PAGE_SIZE + 3; index++) insert.run(`m-${index}`);
	const alpha = await p.createProject(db, { userId: "owner", name: "Alpha", color: "#4f8cff" });
	await p.setProjectAddresses(db, alpha, [{ domainId: "d-alpha", localPart: "" }], hostnames);
	const first = await p.restampMessages(db, ["mb-a"], null, 1);
	assert.equal(first.done, false);
	assert.equal(first.scanned, p.RESTAMP_PAGE_SIZE);
	const second = await p.restampMessages(db, ["mb-a"], first.cursor, 1);
	assert.equal(second.scanned, 3);
	assert.equal(second.done, true);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM messages WHERE project_id = ?").get(alpha.id).n, p.RESTAMP_PAGE_SIZE + 3);
});
