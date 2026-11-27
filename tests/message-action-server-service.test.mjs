import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-undo-service-"));
after(() => rmSync(directory, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
			export {
				applyMessageActionForUser, undoMessageActionForUser, MessageActionError,
			} from "./src/lib/messages/actions/service.ts";
		`,
		resolveDir: root,
		sourcefile: "message-action-service-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
	plugins: [{
		name: "message-action-service-mocks",
		setup(builder) {
			const alias = (filter, namespace, contents) => {
				builder.onResolve({ filter }, () => ({ path: namespace, namespace }));
				builder.onLoad({ filter: /.*/, namespace }, () => ({ contents, loader: "js" }));
			};
			alias(/^@\/db$/, "mock-db", "export function getDb() { return globalThis.__messageDb; }");
			alias(/^@\/lib\/mailboxes\/access$/, "mock-access", `
				export async function getMailboxAccessLevel() {
					return { canRead: true, canManage: true };
				}
			`);
			alias(/^@\/lib\/mailboxes\/audit$/, "mock-audit", `
				export async function createAuditLogs(_env, inputs) {
					if (globalThis.__failUndoAudit && inputs.some((input) => input.metadata?.undoOf)) {
						throw new Error("injected audit failure");
					}
					(globalThis.__undoAudits ??= []).push(...inputs);
				}
			`);
			alias(/^@\/lib\/spam\/feedback$/, "mock-spam", `
				export async function applySpamFeedback(_env, _user, messageId, classification) {
					const status = classification === "spam" ? "spam" : "received";
					globalThis.__rawSqlite.prepare("UPDATE messages SET status = ? WHERE id = ?").run(status, messageId);
					return true;
				}
			`);
			alias(/^@\/lib\/security\/server-secret$/, "mock-secret", "export async function getServerSecret() { return 'message-action-test-secret'; }");
		},
	}],
});
const m = await import(pathToFileURL(join(directory, "entry.mjs")).href);

const sqlite = new Database(":memory:");
sqlite.exec(`
	CREATE TABLE messages (
		id text PRIMARY KEY NOT NULL,
		user_id text,
		private_draft integer NOT NULL DEFAULT 0,
		mailbox_id text,
		direction text NOT NULL,
		status text NOT NULL,
		read integer NOT NULL,
		starred integer NOT NULL,
		snoozed_until integer
	);
	CREATE TABLE labels (
		id text PRIMARY KEY NOT NULL,
		user_id text NOT NULL DEFAULT 'user-1',
		mailbox_id text NOT NULL,
		name text NOT NULL,
		color text NOT NULL DEFAULT '#2563eb',
		created_at integer NOT NULL DEFAULT 0
	);
	CREATE TABLE message_labels (
		message_id text NOT NULL,
		label_id text NOT NULL,
		created_at integer DEFAULT (unixepoch()) NOT NULL
	);
	CREATE UNIQUE INDEX message_labels_message_label_idx ON message_labels (message_id, label_id);
	CREATE TABLE message_action_undo_claims (
		nonce text PRIMARY KEY NOT NULL,
		user_id text NOT NULL,
		expires_at integer NOT NULL
	);
	CREATE INDEX message_action_undo_claims_expires_idx ON message_action_undo_claims (expires_at);
`);
globalThis.__messageDb = drizzle(sqlite);
globalThis.__rawSqlite = sqlite;
after(() => sqlite.close());

const user = { id: "user-1" };

function reset(message = {}) {
	sqlite.exec("DELETE FROM messages; DELETE FROM message_action_undo_claims; DELETE FROM labels; DELETE FROM message_labels;");
	globalThis.__undoAudits = [];
	globalThis.__failUndoAudit = false;
	const row = {
		id: "m1",
		mailboxId: "mb1",
		direction: "inbound",
		status: "received",
		read: 0,
		starred: 0,
		snoozedUntil: null,
		...message,
	};
	sqlite.prepare("INSERT INTO messages (id, mailbox_id, direction, status, read, starred, snoozed_until) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.run(row.id, row.mailboxId, row.direction, row.status, row.read, row.starred, row.snoozedUntil);
	return row;
}

function rowState(id = "m1") {
	return sqlite.prepare("SELECT status, read, starred, snoozed_until FROM messages WHERE id = ?").get(id);
}

function withDbProbe({ beforeUpdate } = {}) {
	const base = globalThis.__messageDb;
	let updates = 0;
	globalThis.__messageDb = new Proxy(base, {
		get(target, property) {
			if (property === "update") {
				return (table) => {
					updates += 1;
					if (updates === 1 && beforeUpdate) beforeUpdate();
					return target.update(table);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return {
		updates: () => updates,
		restore: () => { globalThis.__messageDb = base; },
	};
}

test("apply signs the server CAS result and undo restores it exactly once", async () => {
	reset();
	const applied = await m.applyMessageActionForUser({}, user, { action: "archive", messageIds: ["m1"] });
	assert.equal(applied.applied.length, 1);
	assert.ok(applied.undoToken);
	assert.deepEqual(rowState(), { status: "archived", read: 0, starred: 0, snoozed_until: null });

	const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(undo.restored, ["m1"]);
	assert.equal(rowState().status, "received");
	await assert.rejects(
		m.undoMessageActionForUser({}, user, applied.undoToken),
		(error) => error instanceof m.MessageActionError && error.status === 410,
	);
});

test("undo tokens are bound to the user who received them", async () => {
	reset();
	const applied = await m.applyMessageActionForUser({}, user, { action: "star", messageIds: ["m1"] });
	await assert.rejects(
		m.undoMessageActionForUser({}, { id: "user-2" }, applied.undoToken),
		(error) => error instanceof m.MessageActionError && error.status === 410,
	);
	assert.equal(rowState().starred, 1);
	const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(undo.restored, ["m1"]);
	assert.equal(rowState().starred, 0);
});

test("a mixed undo restores only rows still holding the action's applied state", async () => {
	reset();
	sqlite.prepare("INSERT INTO messages (id, mailbox_id, direction, status, read, starred, snoozed_until) VALUES ('m2', 'mb1', 'inbound', 'received', 0, 0, NULL)").run();
	const applied = await m.applyMessageActionForUser({}, user, { action: "read", messageIds: ["m1", "m2"] });
	assert.equal(applied.applied.length, 2);
	sqlite.prepare("UPDATE messages SET read = 0 WHERE id = 'm2'").run();
	const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(undo.restored, ["m1"]);
	assert.deepEqual(undo.skipped, [{ id: "m2", reason: "stale" }]);
	assert.equal(rowState("m1").read, 0);
	assert.equal(rowState("m2").read, 0);
	// A stale-only settle keeps the one-time claim consumed.
	await assert.rejects(
		m.undoMessageActionForUser({}, user, applied.undoToken),
		(error) => error instanceof m.MessageActionError && error.status === 410,
	);
});

test("spam and inbox-from-spam apply normally but never issue an undo token", async () => {
	reset();
	const spam = await m.applyMessageActionForUser({}, user, { action: "spam", messageIds: ["m1"] });
	assert.equal(spam.undoToken, undefined);
	assert.equal(rowState().status, "spam");

	reset({ status: "spam" });
	const inbox = await m.applyMessageActionForUser({}, user, { action: "inbox", messageIds: ["m1"] });
	assert.equal(inbox.undoToken, undefined);
	assert.equal(rowState().status, "received");
});

test("only actually changed rows are reported as applied", async () => {
	reset({ status: "archived" });
	const applied = await m.applyMessageActionForUser({}, user, { action: "archive", messageIds: ["m1"] });
	assert.deepEqual(applied.applied, []);
	assert.equal(applied.undoToken, undefined);
});

test("a partial transient undo keeps the claim, reports the failed row, and audits restores", async () => {
	reset();
	sqlite.prepare("INSERT INTO messages (id, mailbox_id, direction, status, read, starred, snoozed_until) VALUES ('m2', 'mb1', 'inbound', 'received', 0, 0, NULL)").run();
	const applied = await m.applyMessageActionForUser({}, user, { action: "read", messageIds: ["m1", "m2"] });
	globalThis.__undoAudits = [];
	sqlite.exec(`
		CREATE TRIGGER fail_m2_restore BEFORE UPDATE OF read ON messages
		WHEN OLD.id = 'm2' AND OLD.read = 1 AND NEW.read = 0
		BEGIN
			SELECT RAISE(ABORT, 'injected restore failure');
		END;
	`);
	let undo;
	try {
		undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	} finally {
		sqlite.exec("DROP TRIGGER fail_m2_restore");
	}
	assert.deepEqual(undo.restored, ["m1"]);
	assert.deepEqual(undo.skipped, [{ id: "m2", reason: "failed" }]);
	assert.equal(rowState("m1").read, 0);
	assert.equal(rowState("m2").read, 1);
	assert.deepEqual(globalThis.__undoAudits.map((entry) => entry.messageId), ["m1"]);
	assert.equal(globalThis.__undoAudits[0].metadata.undoOf, "read");
	// The committed restore makes the token non-retryable.
	await assert.rejects(
		m.undoMessageActionForUser({}, user, applied.undoToken),
		(error) => error instanceof m.MessageActionError && error.status === 410,
	);
});

test("a zero-progress transient undo releases the claim so a clean retry works", async () => {
	reset();
	sqlite.prepare("INSERT INTO messages (id, mailbox_id, direction, status, read, starred, snoozed_until) VALUES ('m2', 'mb1', 'inbound', 'received', 0, 0, NULL)").run();
	const applied = await m.applyMessageActionForUser({}, user, { action: "read", messageIds: ["m1", "m2"] });
	sqlite.exec(`
		CREATE TRIGGER fail_all_restore BEFORE UPDATE OF read ON messages
		WHEN OLD.read = 1 AND NEW.read = 0
		BEGIN
			SELECT RAISE(ABORT, 'injected restore failure');
		END;
	`);
	try {
		await assert.rejects(
			m.undoMessageActionForUser({}, user, applied.undoToken),
			(error) => error instanceof m.MessageActionError && error.status === 500,
		);
	} finally {
		sqlite.exec("DROP TRIGGER fail_all_restore");
	}
	assert.equal(rowState("m1").read, 1);
	const retry = await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(retry.restored.sort(), ["m1", "m2"]);
	assert.equal(rowState("m1").read, 0);
	assert.equal(rowState("m2").read, 0);
});

test("an audit failure after a committed restore does not release the claim", async () => {
	reset();
	const applied = await m.applyMessageActionForUser({}, user, { action: "read", messageIds: ["m1"] });
	globalThis.__undoAudits = [];
	globalThis.__failUndoAudit = true;
	let undo;
	const originalError = console.error;
	console.error = () => undefined;
	try {
		undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	} finally {
		console.error = originalError;
		globalThis.__failUndoAudit = false;
	}
	assert.deepEqual(undo.restored, ["m1"]);
	assert.equal(rowState("m1").read, 0);
	await assert.rejects(
		m.undoMessageActionForUser({}, user, applied.undoToken),
		(error) => error instanceof m.MessageActionError && error.status === 410,
	);
});

test("a bulk apply batches CAS updates instead of one query per message", async () => {
	reset();
	const insert = sqlite.prepare("INSERT INTO messages (id, mailbox_id, direction, status, read, starred, snoozed_until) VALUES (?, 'mb1', 'inbound', 'received', 0, 0, NULL)");
	const ids = ["m1"];
	for (let index = 2; index <= 120; index += 1) {
		ids.push(`m${index}`);
		insert.run(`m${index}`);
	}
	const probe = withDbProbe();
	try {
		const applied = await m.applyMessageActionForUser({}, user, { action: "archive", messageIds: ids });
		assert.equal(applied.applied.length, 120);
		assert.ok(probe.updates() <= 5, `expected a bounded number of updates, got ${probe.updates()}`);
	} finally {
		probe.restore();
	}
	assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE status = 'archived'").get().count, 120);
});

test("a bulk undo also batches its CAS restores", async () => {
	reset();
	const insert = sqlite.prepare("INSERT INTO messages (id, mailbox_id, direction, status, read, starred, snoozed_until) VALUES (?, 'mb1', 'inbound', 'received', 0, 0, NULL)");
	const ids = ["m1"];
	for (let index = 2; index <= 120; index += 1) {
		ids.push(`m${index}`);
		insert.run(`m${index}`);
	}
	const applied = await m.applyMessageActionForUser({}, user, { action: "read", messageIds: ids });
	assert.ok(applied.undoToken);
	const probe = withDbProbe();
	try {
		const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
		assert.equal(undo.restored.length, 120);
		assert.ok(probe.updates() <= 5, `expected a bounded number of updates, got ${probe.updates()}`);
	} finally {
		probe.restore();
	}
	assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE read = 0").get().count, 120);
});

test("heterogeneous previous values still batch apply and undo", async () => {
	reset();
	const insert = sqlite.prepare("INSERT INTO messages (id, mailbox_id, direction, status, read, starred, snoozed_until) VALUES (?, 'mb1', 'inbound', 'received', 0, 0, ?)");
	const ids = ["m1"];
	const snoozedUntil = new Map([["m1", 1800000000]]);
	sqlite.prepare("UPDATE messages SET snoozed_until = 1800000000 WHERE id = 'm1'").run();
	for (let index = 2; index <= 100; index += 1) {
		ids.push(`m${index}`);
		snoozedUntil.set(`m${index}`, 1800000000 + index);
		insert.run(`m${index}`, 1800000000 + index);
	}
	const applyProbe = withDbProbe();
	let applied;
	try {
		applied = await m.applyMessageActionForUser({}, user, { action: "inbox", messageIds: ids });
		assert.equal(applied.applied.length, 100);
		assert.ok(applyProbe.updates() <= 8, `expected a bounded apply, got ${applyProbe.updates()}`);
	} finally {
		applyProbe.restore();
	}
	const undoProbe = withDbProbe();
	try {
		const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
		assert.equal(undo.restored.length, 100);
		assert.ok(undoProbe.updates() <= 10, `expected a bounded undo, got ${undoProbe.updates()}`);
	} finally {
		undoProbe.restore();
	}
	for (const [id, seconds] of snoozedUntil) assert.equal(rowState(id).snoozed_until, seconds, id);
});

test("apply CAS checks every field the action writes, not only changed ones", async () => {
	// A concurrent snooze between the read and the CAS: the inbox move writes snoozedUntil too,
	// so it must not report the row's old snooze as applied.
	reset({ status: "archived" });
	const probe = withDbProbe({
		beforeUpdate: () => sqlite.prepare("UPDATE messages SET snoozed_until = 4102444800 WHERE id = 'm1'").run(),
	});
	let applied;
	try {
		applied = await m.applyMessageActionForUser({}, user, { action: "inbox", messageIds: ["m1"] });
	} finally {
		probe.restore();
	}
	assert.deepEqual(applied.applied, []);
	assert.deepEqual(applied.skipped, [{ id: "m1", reason: "stale" }]);
	assert.deepEqual(rowState(), { status: "archived", read: 0, starred: 0, snoozed_until: 4102444800 });
});

test("a CAS race rejects a stale archive snapshot instead of signing it", async () => {
	reset();
	// Simulates the row being changed between the service's read and its CAS
	// write: the conditional UPDATE affects no row, so nothing is signed.
	sqlite.exec(`
		CREATE TRIGGER block_archive BEFORE UPDATE OF status ON messages
		WHEN OLD.id = 'm1' AND NEW.status = 'archived'
		BEGIN
			SELECT RAISE(IGNORE);
		END;
	`);
	const applied = await m.applyMessageActionForUser({}, user, { action: "archive", messageIds: ["m1"] });
	assert.deepEqual(applied.applied, []);
	assert.deepEqual(applied.skipped, [{ id: "m1", reason: "stale" }]);
	assert.equal(applied.undoToken, undefined);
	sqlite.exec("DROP TRIGGER block_archive");
});

function labels(id = "m1") {
	return sqlite.prepare("SELECT label_id FROM message_labels WHERE message_id = ? ORDER BY label_id").all(id).map((row) => row.label_id);
}

function addLabel(id, mailboxId = "mb1") {
	sqlite.prepare("INSERT INTO labels (id, mailbox_id, name) VALUES (?, ?, ?)").run(id, mailboxId, id);
}

test("label adds one label, keeps the status, and undo removes exactly that pair", async () => {
	reset();
	addLabel("work");
	addLabel("travel");
	sqlite.prepare("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'travel')").run();
	const applied = await m.applyMessageActionForUser({}, user, { action: "label", messageIds: ["m1"], labelId: "work" });
	assert.deepEqual(applied.applied.map((record) => record.labels), [{ added: ["work"], removed: [] }]);
	assert.equal(rowState().status, "received");
	assert.deepEqual(labels(), ["travel", "work"]);

	const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(undo.restored, ["m1"]);
	assert.deepEqual(labels(), ["travel"]);
});

test("labelling mail that already has the label changes nothing and signs no undo", async () => {
	reset();
	addLabel("work");
	sqlite.prepare("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'work')").run();
	const applied = await m.applyMessageActionForUser({}, user, { action: "label", messageIds: ["m1"], labelId: "work" });
	assert.deepEqual(applied.applied, []);
	assert.equal(applied.undoToken, undefined);
});

test("move labels and archives inbox mail; undo restores the inbox and drops the label", async () => {
	reset();
	addLabel("work");
	const applied = await m.applyMessageActionForUser({}, user, { action: "move", messageIds: ["m1"], labelId: "work" });
	assert.equal(rowState().status, "archived");
	assert.deepEqual(labels(), ["work"]);
	assert.equal(applied.applied[0].applied.status, "archived");

	await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.equal(rowState().status, "received");
	assert.deepEqual(labels(), []);
});

test("a sent message keeps status sent when labelled or moved", async () => {
	reset({ direction: "outbound", status: "sent", read: 1 });
	addLabel("work");
	addLabel("clients");
	await m.applyMessageActionForUser({}, user, { action: "label", messageIds: ["m1"], labelId: "work" });
	await m.applyMessageActionForUser({}, user, { action: "move", messageIds: ["m1"], labelId: "clients" });
	assert.equal(rowState().status, "sent");
	assert.deepEqual(labels(), ["clients", "work"]);
});

test("archive, trash and spam keep labels", async () => {
	for (const action of ["archive", "trash", "spam"]) {
		reset();
		addLabel("work");
		sqlite.prepare("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'work')").run();
		await m.applyMessageActionForUser({}, user, { action, messageIds: ["m1"] });
		assert.deepEqual(labels(), ["work"], action);
	}
});

test("unlabel removes the label, and undo puts it back only while the label exists", async () => {
	reset();
	addLabel("work");
	sqlite.prepare("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'work')").run();
	const applied = await m.applyMessageActionForUser({}, user, { action: "unlabel", messageIds: ["m1"], labelId: "work" });
	assert.deepEqual(applied.applied[0].labels, { added: [], removed: ["work"] });
	assert.deepEqual(labels(), []);
	await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(labels(), ["work"]);

	const again = await m.applyMessageActionForUser({}, user, { action: "unlabel", messageIds: ["m1"], labelId: "work" });
	sqlite.exec("DELETE FROM labels WHERE id = 'work'");
	await m.undoMessageActionForUser({}, user, again.undoToken);
	assert.deepEqual(labels(), []);
});

function withTrigger(sql, name, run) {
	sqlite.exec(sql);
	const originalError = console.error;
	console.error = () => undefined;
	return run().finally(() => {
		console.error = originalError;
		sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`);
	});
}

function insertPadded(count) {
	sqlite.exec("DELETE FROM messages");
	const insert = sqlite.prepare("INSERT INTO messages (id, mailbox_id, direction, status, read, starred, snoozed_until) VALUES (?, 'mb1', 'inbound', 'received', 0, 0, NULL)");
	const ids = [];
	for (let index = 1; index <= count; index += 1) {
		const id = `m${String(index).padStart(3, "0")}`;
		ids.push(id);
		insert.run(id);
	}
	return ids;
}

test("a label chunk that fails mid-way reports exactly the committed messages, and undo reverts only those", async () => {
	reset();
	addLabel("work");
	const ids = insertPadded(100);
	// Pairs go out 45 per statement: the second statement (m046..m090) aborts as a whole.
	const applied = await withTrigger(`
		CREATE TRIGGER fail_label_chunk BEFORE INSERT ON message_labels
		WHEN NEW.message_id = 'm050'
		BEGIN
			SELECT RAISE(ABORT, 'injected label failure');
		END;
	`, "fail_label_chunk", () => m.applyMessageActionForUser({}, user, { action: "label", messageIds: ids, labelId: "work" }));

	const labelled = sqlite.prepare("SELECT message_id FROM message_labels WHERE label_id = 'work' ORDER BY message_id").all().map((row) => row.message_id);
	assert.equal(labelled.length, 55);
	assert.ok(!labelled.includes("m050"));
	assert.deepEqual(applied.applied.map((record) => record.id).sort(), labelled);
	for (const record of applied.applied) assert.deepEqual(record.labels, { added: ["work"], removed: [] });
	const failed = applied.skipped.filter((item) => item.reason === "failed").map((item) => item.id).sort();
	assert.deepEqual(failed, ids.filter((id) => !labelled.includes(id)));
	assert.ok(applied.undoToken);

	const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(undo.restored.sort(), labelled);
	assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM message_labels").get().count, 0);
});

test("an undo whose label chunk fails mid-way reports the committed restores and the failed ones", async () => {
	reset();
	addLabel("work");
	const ids = insertPadded(100);
	const applied = await m.applyMessageActionForUser({}, user, { action: "label", messageIds: ids, labelId: "work" });
	assert.equal(applied.applied.length, 100);
	const undo = await withTrigger(`
		CREATE TRIGGER fail_unlabel_chunk BEFORE DELETE ON message_labels
		WHEN OLD.message_id = 'm050'
		BEGIN
			SELECT RAISE(ABORT, 'injected label failure');
		END;
	`, "fail_unlabel_chunk", () => m.undoMessageActionForUser({}, user, applied.undoToken));
	const remaining = sqlite.prepare("SELECT message_id FROM message_labels ORDER BY message_id").all().map((row) => row.message_id);
	assert.equal(remaining.length, 45);
	assert.deepEqual(undo.skipped.map((item) => item.id).sort(), remaining);
	assert.ok(undo.skipped.every((item) => item.reason === "failed"));
	assert.deepEqual(undo.restored.sort(), ids.filter((id) => !remaining.includes(id)));
});

test("a move whose label insert fails reverts its status and reports the message failed", async () => {
	reset();
	addLabel("work");
	await withTrigger(`
		CREATE TRIGGER fail_move_label BEFORE INSERT ON message_labels
		WHEN NEW.message_id = 'm1'
		BEGIN
			SELECT RAISE(ABORT, 'injected label failure');
		END;
	`, "fail_move_label", () => assert.rejects(
		m.applyMessageActionForUser({}, user, { action: "move", messageIds: ["m1"], labelId: "work" }),
		(error) => error instanceof m.MessageActionError && error.status === 500,
	));
	assert.equal(rowState().status, "received");
	assert.deepEqual(labels(), []);
});

test("a partly failed move reports the failed messages and signs undo for the moved ones", async () => {
	reset();
	addLabel("work");
	const ids = insertPadded(50);
	const applied = await withTrigger(`
		CREATE TRIGGER fail_move_chunk BEFORE INSERT ON message_labels
		WHEN NEW.message_id = 'm046'
		BEGIN
			SELECT RAISE(ABORT, 'injected label failure');
		END;
	`, "fail_move_chunk", () => m.applyMessageActionForUser({}, user, { action: "move", messageIds: ids, labelId: "work" }));
	const moved = ids.slice(0, 45);
	const failed = ids.slice(45);
	assert.deepEqual(applied.applied.map((record) => record.id).sort(), moved);
	assert.deepEqual(applied.skipped, failed.map((id) => ({ id, reason: "failed" })));
	for (const id of failed) {
		assert.equal(rowState(id).status, "received", id);
		assert.deepEqual(labels(id), [], id);
	}
	for (const id of moved) assert.equal(rowState(id).status, "archived", id);

	const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(undo.restored.sort(), moved);
	assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE status = 'received'").get().count, 50);
	assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM message_labels").get().count, 0);
});

test("a move whose label and status revert both fail keeps the committed status undoable", async () => {
	reset();
	addLabel("work");
	sqlite.exec(`
		CREATE TRIGGER fail_move_revert BEFORE UPDATE OF status ON messages
		WHEN OLD.id = 'm1' AND OLD.status = 'archived' AND NEW.status = 'received'
		BEGIN
			SELECT RAISE(ABORT, 'injected revert failure');
		END;
	`);
	let applied;
	try {
		applied = await withTrigger(`
			CREATE TRIGGER fail_move_label BEFORE INSERT ON message_labels
			WHEN NEW.message_id = 'm1'
			BEGIN
				SELECT RAISE(ABORT, 'injected label failure');
			END;
		`, "fail_move_label", () => m.applyMessageActionForUser({}, user, { action: "move", messageIds: ["m1"], labelId: "work" }));
	} finally {
		sqlite.exec("DROP TRIGGER fail_move_revert");
	}
	assert.equal(rowState().status, "archived");
	assert.equal(applied.applied.length, 1);
	assert.equal(applied.applied[0].applied.status, "archived");
	assert.equal(applied.applied[0].labels, undefined);
	assert.ok(applied.undoToken);
	const undo = await m.undoMessageActionForUser({}, user, applied.undoToken);
	assert.deepEqual(undo.restored, ["m1"]);
	assert.equal(rowState().status, "received");
});

test("a label never applies to mail of another mailbox, and an unknown label is refused", async () => {
	reset();
	addLabel("elsewhere", "mb2");
	const applied = await m.applyMessageActionForUser({}, user, { action: "label", messageIds: ["m1"], labelId: "elsewhere" });
	assert.deepEqual(applied.skipped, [{ id: "m1", reason: "not_applicable" }]);
	assert.deepEqual(labels(), []);
	await assert.rejects(
		m.applyMessageActionForUser({}, user, { action: "label", messageIds: ["m1"], labelId: "missing" }),
		(error) => error instanceof m.MessageActionError && error.status === 404,
	);
	await assert.rejects(
		m.applyMessageActionForUser({}, user, { action: "move", messageIds: ["m1"] }),
		(error) => error instanceof m.MessageActionError && error.status === 400,
	);
});
