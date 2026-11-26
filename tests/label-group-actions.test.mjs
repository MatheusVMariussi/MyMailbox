import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

// In the unified inbox a selection spans mailboxes, while a label belongs to one. "Label as", "Move to" and
// removing a label therefore apply, per message, the label of the same name in that message's own mailbox.
const mocks = {
	"@/lib/cloudflare": "export function getEnv(){return globalThis.labelGroupEnv}",
	"@/lib/auth/cookies": "export async function getCurrentUser(){return globalThis.labelGroupUser} export async function requireUser(){return globalThis.labelGroupUser}",
	"@/lib/security/server-secret": "export async function getServerSecret(){return 'label-group-secret'}",
	"@/lib/api/auth": "export async function requireSessionUser() { return { user: globalThis.labelGroupUser, error: null }; }",
};
const { app, newDatabase } = await loadApp("label-group-actions", `
	export * as bulk from "./src/app/api/messages/bulk/route.ts";
`, { mocks });

const seed = `
	INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('owner', 'me@alpha.test', 'h', 'Owner', 'admin', 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d', 'owner', 'alpha.test', 'z', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES
		('mb-a', 'owner', 'd', 'me', 'personal', 1),
		('mb-b', 'owner', 'd', 'team', 'personal', 1),
		('mb-c', 'owner', 'd', 'misc', 'personal', 1);
	INSERT INTO labels (id, user_id, mailbox_id, name, color, created_at) VALUES
		('l-a', 'owner', 'mb-a', 'Clients', '#2563eb', 1),
		('l-b', 'owner', 'mb-b', 'Clients', '#2563eb', 1),
		('l-other', 'owner', 'mb-c', 'Other', '#2563eb', 1);
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, created_at) VALUES
		('a1', 'owner', 'mb-a', 'inbound', 'x@y.test', 'me@alpha.test', 'A', 'received', 0, 1),
		('b1', 'owner', 'mb-b', 'inbound', 'x@y.test', 'team@alpha.test', 'B', 'received', 0, 2),
		('c1', 'owner', 'mb-c', 'inbound', 'x@y.test', 'misc@alpha.test', 'C', 'received', 0, 3);
`;
const send = (body) => new Request("http://localhost/api/messages/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function setup(t) {
	const fixture = await newDatabase(t, seed);
	globalThis.labelGroupEnv = fixture.env;
	globalThis.labelGroupUser = { id: "owner", email: "me@alpha.test", name: "Owner", role: "admin" };
	t.after(() => { delete globalThis.labelGroupEnv; delete globalThis.labelGroupUser; });
	return fixture;
}
const memberships = (sqlite) => sqlite.prepare("SELECT message_id, label_id FROM message_labels ORDER BY message_id").all().map((row) => `${row.message_id}:${row.label_id}`);

test("labelling a cross-mailbox selection uses each mailbox's label of that name", async (t) => {
	const { sqlite } = await setup(t);
	const response = await app.bulk.POST(send({ messageIds: ["a1", "b1", "c1"], action: "label", labelId: "l-a" }));
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.deepEqual(memberships(sqlite), ["a1:l-a", "b1:l-b"]);
	assert.deepEqual({ applied: body.applied, skipped: body.skipped }, { applied: 2, skipped: 1 }, "c1's mailbox has no Clients label");
});

test("moving archives each message and labels it in its own mailbox; removing works the same way", async (t) => {
	const { sqlite } = await setup(t);
	assert.equal((await app.bulk.POST(send({ messageIds: ["a1", "b1"], action: "move", labelId: "l-b" }))).status, 200);
	assert.deepEqual(memberships(sqlite), ["a1:l-a", "b1:l-b"]);
	assert.deepEqual(sqlite.prepare("SELECT status FROM messages WHERE id IN ('a1', 'b1')").all().map((row) => row.status), ["archived", "archived"]);
	assert.equal((await app.bulk.POST(send({ messageIds: ["a1", "b1"], action: "unlabel", labelId: "l-a" }))).status, 200);
	assert.deepEqual(memberships(sqlite), []);
});
