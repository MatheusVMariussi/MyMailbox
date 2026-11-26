import assert from "node:assert/strict";
import test from "node:test";
import { loadApp, sharedMailboxSeed } from "./helpers/real-db.mjs";

// The REST surface of labels: CRUD, label/move through the bulk and action routes, the label view,
// counts and reader navigation. A label never takes mail out of the inbox and a sent message stays sent.
const mocks = {
	"@/lib/cloudflare": "export function getEnv(){return globalThis.labelsEnv}",
	"@/lib/auth/cookies": "export async function getCurrentUser(){return globalThis.labelsUser} export async function requireUser(){return globalThis.labelsUser}",
	"@/lib/security/server-secret": "export async function getServerSecret(){return 'labels-test-secret'}",
	"@/lib/api/auth": `
		export async function requireSessionUser() { return { user: globalThis.labelsUser, error: null }; }
		export async function authenticateApiKey() { return { userId: globalThis.labelsUser.id, scopes: ["read"], mailboxIds: null }; }
		export function requireScope() { return true; }
	`,
};
const { app, newDatabase } = await loadApp("labels-api", `
	export * as labels from "./src/app/api/labels/route.ts";
	export * as label from "./src/app/api/labels/[id]/route.ts";
	export * as bulk from "./src/app/api/messages/bulk/route.ts";
	export * as actions from "./src/app/api/messages/actions/route.ts";
	export * as list from "./src/app/api/messages/route.ts";
	export * as counts from "./src/app/api/messages/counts/route.ts";
	export * as navigation from "./src/app/api/messages/navigation/route.ts";
	export * as v1 from "./src/app/api/v1/messages/route.ts";
	export { isLabelBulkAction, getStatusForBulkAction } from "./src/app/api/messages/bulk/utils.ts";
`, { mocks });

const seed = `${sharedMailboxSeed("read_only")}
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, created_at) VALUES
		('in-1', 'admin', 'mb-team', 'inbound', 'x@example.net', 'team@example.com', 'Hello', 'received', 0, 2),
		('sent-1', 'admin', 'mb-team', 'outbound', 'team@example.com', 'x@example.net', 'Reply', 'sent', 1, 3),
		('in-2', 'admin', 'mb-team', 'inbound', 'y@example.net', 'team@example.com', 'Other', 'received', 0, 4),
		('mine', 'admin', 'mb-admin', 'inbound', 'z@example.net', 'admin@example.com', 'Mine', 'received', 0, 5);
`;
const user = (id) => ({ id, email: `${id}@example.com`, role: id === "admin" ? "admin" : "user" });
const get = (url) => new Request(`http://localhost${url}`);
const send = (method, body) => new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id) => ({ params: Promise.resolve({ id }) });

async function setup(t, who = "admin") {
	const fixture = await newDatabase(t, seed);
	globalThis.labelsEnv = fixture.env;
	globalThis.labelsUser = user(who);
	t.after(() => { delete globalThis.labelsEnv; delete globalThis.labelsUser; });
	return fixture;
}
const json = async (response) => ({ status: response.status, body: await response.json() });
const labelsOf = (sqlite, id) => sqlite.prepare("SELECT label_id FROM message_labels WHERE message_id = ? ORDER BY label_id").all(id).map((row) => row.label_id);
const statusOf = (sqlite, id) => sqlite.prepare("SELECT status FROM messages WHERE id = ?").get(id).status;
const createLabel = async (mailboxId, name) => (await json(await app.labels.POST(send("POST", { mailboxId, name, color: "#16a34a" })))).body;

test("labels are created, listed per mailbox or for every mailbox, renamed, recolored and deleted", async (t) => {
	await setup(t);
	const work = await createLabel("mb-team", "  Work  ");
	assert.equal(work.name, "Work");
	await createLabel("mb-admin", "Personal");
	assert.equal((await app.labels.POST(send("POST", { mailboxId: "mb-team", name: "Work" }))).status, 409);
	assert.equal((await app.labels.POST(send("POST", { mailboxId: "mb-team", name: " " }))).status, 400);

	assert.deepEqual((await json(await app.labels.GET(get("/api/labels?mailboxId=mb-team")))).body.labels.map((label) => label.name), ["Work"]);
	assert.deepEqual((await json(await app.labels.GET(get("/api/labels")))).body.labels.map((label) => label.name), ["Personal", "Work"]);

	const renamed = await json(await app.label.PATCH(send("PATCH", { name: "Clients", color: "#dc2626" }), params(work.id)));
	assert.deepEqual({ status: renamed.status, name: renamed.body.name, color: renamed.body.color }, { status: 200, name: "Clients", color: "#dc2626" });
	assert.equal((await app.label.PATCH(send("PATCH", {}), params(work.id))).status, 400);

	const removed = await json(await app.label.DELETE(get("/x"), params(work.id)));
	assert.deepEqual(removed.body, { ok: true, done: true, removed: 0 });
	assert.equal((await app.label.DELETE(get("/x"), params(work.id))).status, 404);
});

test("a read-only sharee sees labels but cannot create, change or apply them", async (t) => {
	const { env } = await setup(t, "admin");
	const work = await createLabel("mb-team", "Work");
	globalThis.labelsUser = user("delegate");
	assert.equal((await json(await app.labels.GET(get("/api/labels?mailboxId=mb-team")))).body.labels.length, 1);
	assert.equal((await app.labels.GET(get("/api/labels?mailboxId=mb-admin"))).status, 404);
	assert.equal((await app.labels.POST(send("POST", { mailboxId: "mb-team", name: "Mine" }))).status, 404);
	assert.equal((await app.label.PATCH(send("PATCH", { name: "X" }), params(work.id))).status, 404);
	assert.equal((await app.label.DELETE(get("/x"), params(work.id))).status, 404);
	assert.equal((await app.actions.POST(send("POST", { op: "apply", action: "label", labelId: work.id, messageIds: ["in-1"] }))).status, 404);
	assert.ok(env);
});

test("label as keeps the inbox, move archives inbox mail, and a sent message keeps status sent", async (t) => {
	const { sqlite } = await setup(t);
	const work = await createLabel("mb-team", "Work");
	const clients = await createLabel("mb-team", "Clients");

	const labelled = await json(await app.actions.POST(send("POST", { op: "apply", action: "label", labelId: work.id, messageIds: ["in-1", "sent-1"] })));
	assert.equal(labelled.body.applied.length, 2);
	assert.equal(statusOf(sqlite, "in-1"), "received");
	assert.equal(statusOf(sqlite, "sent-1"), "sent");

	const moved = await json(await app.bulk.POST(send("POST", { action: "move", labelId: clients.id, messageIds: ["in-2", "sent-1", "mine"] })));
	assert.deepEqual(moved.body, { ok: true, applied: 2, skipped: 1 });
	assert.equal(statusOf(sqlite, "in-2"), "archived");
	assert.equal(statusOf(sqlite, "sent-1"), "sent");
	assert.deepEqual(labelsOf(sqlite, "sent-1"), [clients.id, work.id].sort());
	assert.deepEqual(labelsOf(sqlite, "mine"), []);
	assert.equal((await app.bulk.POST(send("POST", { action: "move", messageIds: ["in-2"] }))).status, 400);
	assert.equal(app.isLabelBulkAction("label"), true);
	assert.equal(app.getStatusForBulkAction("move"), null);
});

test("the label view lists every direction, keeps archived mail and drops Trash and Spam", async (t) => {
	const { sqlite } = await setup(t);
	const work = await createLabel("mb-team", "Work");
	await app.actions.POST(send("POST", { op: "apply", action: "label", labelId: work.id, messageIds: ["in-1", "sent-1", "in-2"] }));
	await app.actions.POST(send("POST", { op: "apply", action: "archive", messageIds: ["in-1"] }));
	await app.actions.POST(send("POST", { op: "apply", action: "trash", messageIds: ["in-2"] }));
	assert.deepEqual(labelsOf(sqlite, "in-1"), [work.id]);

	const listed = await json(await app.list.GET(get(`/api/messages?mailboxId=mb-team&labelId=${work.id}`)));
	assert.deepEqual(listed.body.messages.map((message) => message.id).sort(), ["in-1", "sent-1"]);
	assert.ok(listed.body.messages.every((message) => message.labelIds.includes(work.id) && !("folderId" in message)));

	const inbox = await json(await app.list.GET(get("/api/messages?mailboxId=mb-team&direction=inbound&status=received")));
	assert.deepEqual(inbox.body.messages.map((message) => message.id), []);
	await app.actions.POST(send("POST", { op: "apply", action: "inbox", messageIds: ["in-1"] }));
	const back = await json(await app.list.GET(get("/api/messages?mailboxId=mb-team&direction=inbound&status=received")));
	assert.deepEqual(back.body.messages.map((message) => [message.id, message.labelIds]), [["in-1", [work.id]]]);

	const counts = (await json(await app.counts.GET(get("/api/messages/counts?mailboxId=mb-team")))).body.counts;
	assert.deepEqual(counts.labels[work.id], { total: 2, unread: 1 });
	assert.equal(counts.folders.inbox.total, 1);

	const navigation = (await json(await app.navigation.GET(get(`/api/messages/navigation?folder=inbox&mailboxId=mb-team&labelId=${work.id}`)))).body;
	assert.deepEqual(navigation.messages.map((entry) => entry.id).sort(), ["in-1", "sent-1"]);
});

test("undoing a label action removes exactly the pairs it added", async (t) => {
	const { sqlite } = await setup(t);
	const work = await createLabel("mb-team", "Work");
	await app.actions.POST(send("POST", { op: "apply", action: "label", labelId: work.id, messageIds: ["in-1"] }));
	const second = await json(await app.actions.POST(send("POST", { op: "apply", action: "move", labelId: work.id, messageIds: ["in-1", "in-2"] })));
	assert.deepEqual(second.body.applied.map((record) => [record.id, record.labels ?? null]), [
		["in-1", null],
		["in-2", { added: [work.id], removed: [] }],
	]);
	const undo = await json(await app.actions.POST(send("POST", { op: "undo", token: second.body.undoToken })));
	assert.deepEqual(undo.body.restored.sort(), ["in-1", "in-2"]);
	assert.deepEqual(labelsOf(sqlite, "in-1"), [work.id]);
	assert.deepEqual(labelsOf(sqlite, "in-2"), []);
	assert.equal(statusOf(sqlite, "in-1"), "received");
	assert.equal(statusOf(sqlite, "in-2"), "received");
});

test("the public messages API lists label ids per row and no folder", async (t) => {
	await setup(t);
	const work = await createLabel("mb-team", "Work");
	await app.actions.POST(send("POST", { op: "apply", action: "label", labelId: work.id, messageIds: ["in-1"] }));
	const { body } = await json(await app.v1.GET(get("/api/v1/messages?mailboxId=mb-team")));
	const byId = new Map(body.messages.map((message) => [message.id, message]));
	assert.deepEqual(byId.get("in-1").labelIds, [work.id]);
	assert.deepEqual(byId.get("sent-1").labelIds, []);
	assert.ok(body.messages.every((message) => !("folderId" in message)));
});
