import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

const D1_MAX_PARAMS = 100;
const { app, newDatabase } = await loadApp("labels-service", `
	export * as labels from "./src/lib/labels/service.ts";
	export * as utils from "./src/lib/labels/label-utils.ts";
`);

const ids = (count, prefix = "m") => Array.from({ length: count }, (_, i) => `${prefix}-${String(i).padStart(4, "0")}`);

async function setup(t, messageCount = 3) {
	const rows = ids(messageCount).map((id, index) => `('${id}', 'u1', 'mb1', 'inbound', 'a@x.test', 'me@example.com', 'received', ${index + 1})`);
	const fixture = await newDatabase(t, `
		INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'u1@example.com', 'hash', 'U1', 'admin', 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d1', 'u1', 'example.com', 'z1', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ('mb1', 'u1', 'd1', 'me', 'personal', 1), ('mb2', 'u1', 'd1', 'other', 'personal', 1);
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, created_at) VALUES ${rows.join(",")};
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, created_at) VALUES ('elsewhere', 'u1', 'mb2', 'inbound', 'a@x.test', 'o@example.com', 'received', 1);
	`);
	return fixture;
}

// Records the largest parameter list handed to the database (the pattern of d1-param-budget.test.mjs).
function watch(env) {
	const peak = { count: 0, sql: "" };
	const prepare = env.DB.prepare.bind(env.DB);
	env.DB.prepare = (sql) => {
		const statement = prepare(sql);
		const bind = statement.bind.bind(statement);
		statement.bind = (...values) => {
			if (values.length > peak.count) Object.assign(peak, { count: values.length, sql });
			return bind(...values);
		};
		return statement;
	};
	return peak;
}

test("label names are trimmed, collapsed and bounded", () => {
	assert.equal(app.utils.normalizeLabelName("  Clients   2026 "), "Clients 2026");
	assert.equal(app.utils.normalizeLabelName(""), null);
	assert.equal(app.utils.normalizeLabelName("   "), null);
	assert.equal(app.utils.normalizeLabelName("x".repeat(81)), null);
	assert.equal(app.utils.normalizeLabelName("bad\u0007name"), null);
	assert.equal(app.utils.normalizeLabelName(42), null);
});

test("label deltas apply, invert and stay unknown when the set is unknown", () => {
	assert.deepEqual(app.utils.applyLabelDelta(["a", "b"], { added: ["c", "a"], removed: ["b"] }), ["a", "c"]);
	assert.equal(app.utils.applyLabelDelta(undefined, { added: ["c"], removed: [] }), undefined);
	assert.deepEqual(app.utils.invertLabelDelta({ added: ["a"], removed: ["b"] }), { added: ["b"], removed: ["a"] });
	assert.deepEqual(app.utils.labelDeltaFor(["a"], "a", true), { added: [], removed: [] });
	assert.deepEqual(app.utils.labelDeltaFor(["a"], "b", true), { added: ["b"], removed: [] });
	assert.deepEqual(app.utils.labelDeltaFor(["a"], "b", false), { added: [], removed: [] });
	assert.deepEqual(app.utils.labelDeltaFor(undefined, "b", false), { added: [], removed: ["b"] });
	assert.equal(app.utils.isLabelDelta({ added: ["a"], removed: [] }), true);
	assert.equal(app.utils.isLabelDelta({ added: "a", removed: [] }), false);
});

test("a message carries several labels and adding one twice changes nothing", async (t) => {
	const { db } = await setup(t);
	const clients = await app.labels.createLabel(db, { userId: "u1", mailboxId: "mb1", name: "Clients", color: "#2563eb" });
	const travel = await app.labels.createLabel(db, { userId: "u1", mailboxId: "mb1", name: "Travel", color: "#16a34a" });

	const first = await app.labels.addMessageLabels(db, [
		{ messageId: "m-0000", labelId: clients.id },
		{ messageId: "m-0000", labelId: travel.id },
		{ messageId: "m-0000", labelId: travel.id },
	]);
	assert.equal(first.length, 2);
	const again = await app.labels.addMessageLabels(db, [{ messageId: "m-0000", labelId: clients.id }, { messageId: "m-0001", labelId: clients.id }]);
	assert.deepEqual(again, [{ messageId: "m-0001", labelId: clients.id }]);

	const byMessage = await app.labels.loadMessageLabelIds(db, ["m-0000", "m-0001", "m-0002"]);
	assert.deepEqual(new Set(byMessage.get("m-0000")), new Set([clients.id, travel.id]));
	assert.deepEqual(byMessage.get("m-0001"), [clients.id]);
	assert.equal(byMessage.has("m-0002"), false);

	const removed = await app.labels.removeMessageLabels(db, [{ messageId: "m-0000", labelId: travel.id }, { messageId: "m-0002", labelId: travel.id }]);
	assert.deepEqual(removed, [{ messageId: "m-0000", labelId: travel.id }]);
	assert.deepEqual((await app.labels.loadMessageLabelIds(db, ["m-0000"])).get("m-0000"), [clients.id]);
});

test("label names are unique per mailbox, and rename and recolor keep them so", async (t) => {
	const { db } = await setup(t);
	const clients = await app.labels.createLabel(db, { userId: "u1", mailboxId: "mb1", name: "Clients", color: "#2563eb" });
	await app.labels.createLabel(db, { userId: "u1", mailboxId: "mb2", name: "Clients", color: "#2563eb" });
	const travel = await app.labels.createLabel(db, { userId: "u1", mailboxId: "mb1", name: "Travel", color: "#2563eb" });
	await assert.rejects(app.labels.createLabel(db, { userId: "u1", mailboxId: "mb1", name: "Clients", color: "#2563eb" }), (error) => error.status === 409);
	await assert.rejects(app.labels.updateLabel(db, travel, { name: "Clients" }), (error) => error.status === 409);
	const renamed = await app.labels.updateLabel(db, clients, { name: "Customers", color: "#dc2626" });
	assert.deepEqual({ name: renamed.name, color: renamed.color }, { name: "Customers", color: "#dc2626" });
	assert.deepEqual((await app.labels.listLabels(db, ["mb1"])).map((label) => label.name), ["Customers", "Travel"]);
	assert.equal((await app.labels.listLabels(db, ["mb1", "mb2"])).length, 3);
});

test("a label is never applied to mail of another mailbox", async (t) => {
	const { db, sqlite } = await setup(t);
	const clients = await app.labels.createLabel(db, { userId: "u1", mailboxId: "mb1", name: "Clients", color: "#2563eb" });
	await assert.rejects(app.labels.addMessageLabels(db, [{ messageId: "elsewhere", labelId: clients.id }]), (error) => error.status === 400);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM message_labels").get().n, 0);
});

test("large label writes stay within the D1 parameter limit", async (t) => {
	const { db, env, sqlite } = await setup(t, 300);
	const clients = await app.labels.createLabel(db, { userId: "u1", mailboxId: "mb1", name: "Clients", color: "#2563eb" });
	const peak = watch(env);
	const pairs = ids(300).map((messageId) => ({ messageId, labelId: clients.id }));
	assert.equal((await app.labels.addMessageLabels(db, pairs)).length, 300);
	assert.ok(peak.count <= D1_MAX_PARAMS && peak.count >= 80, `insert bound ${peak.count}: ${peak.sql}`);

	peak.count = 0;
	assert.equal((await app.labels.loadMessageLabelIds(db, ids(300))).size, 300);
	assert.ok(peak.count <= D1_MAX_PARAMS && peak.count >= 80, `lookup bound ${peak.count}: ${peak.sql}`);

	peak.count = 0;
	assert.equal((await app.labels.removeMessageLabels(db, pairs)).length, 300);
	assert.ok(peak.count <= D1_MAX_PARAMS && peak.count >= 40, `delete bound ${peak.count}: ${peak.sql}`);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM message_labels").get().n, 0);
});

test("deleting a large label runs in bounded steps and drops the label last", async (t) => {
	const { db, sqlite } = await setup(t, 620);
	const big = await app.labels.createLabel(db, { userId: "u1", mailboxId: "mb1", name: "Big", color: "#2563eb" });
	await app.labels.addMessageLabels(db, ids(620).map((messageId) => ({ messageId, labelId: big.id })));

	const first = await app.labels.deleteLabel(db, big.id, 1);
	assert.deepEqual(first, { done: false, removed: app.labels.LABEL_DELETE_BATCH });
	assert.ok(await app.labels.getLabel(db, big.id), "the label stays while memberships remain");

	const second = await app.labels.deleteLabel(db, big.id, 1);
	assert.deepEqual(second, { done: true, removed: 620 - app.labels.LABEL_DELETE_BATCH });
	assert.equal(await app.labels.getLabel(db, big.id), null);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM message_labels").get().n, 0);
});
