import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

// Labels are a table: messages carry any number through message_labels, and triggers log every label and
// membership change for JMAP and realtime and keep a label in its message's mailbox.
const { newDatabase } = await loadApp("labels-schema", "");

const seed = `
	INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'u1@example.com', 'hash', 'U1', 'admin', 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d1', 'u1', 'example.com', 'z1', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ('mb1', 'u1', 'd1', 'me', 'personal', 1), ('mb2', 'u1', 'd1', 'other', 'personal', 1);
`;

test("messages have no folder column and keep their list indexes; rules name a label", async (t) => {
	const { sqlite } = await newDatabase(t);
	const messageColumns = sqlite.prepare("SELECT name FROM pragma_table_info('messages')").all().map((row) => row.name);
	assert.ok(!messageColumns.includes("folder_id"));
	assert.equal(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('folders', 'messages_folder_idx')").get(), undefined);
	const indexes = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'messages' AND sql IS NOT NULL").all();
	for (const name of ["messages_inbox_page_idx", "messages_thread_key_idx", "messages_nav_cover_idx", "messages_counts_cover_idx", "messages_category_page_idx", "messages_category_count_idx"]) {
		assert.ok(indexes.some((index) => index.name === name), name);
	}
	const ruleColumns = sqlite.prepare("SELECT name FROM pragma_table_info('routing_rules')").all().map((row) => row.name);
	assert.ok(ruleColumns.includes("label_id") && ruleColumns.includes("skip_inbox") && !ruleColumns.includes("folder_id"));
	const foreignKeys = sqlite.prepare("SELECT \"table\", \"from\" FROM pragma_foreign_key_list('message_labels') ORDER BY \"from\"").all().map((row) => ({ ...row }));
	assert.deepEqual(foreignKeys, [{ table: "labels", from: "label_id" }, { table: "messages", from: "message_id" }]);
});

test("the label triggers exist and the folder ones are gone", async (t) => {
	const { sqlite } = await newDatabase(t);
	const triggers = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => row.name);
	assert.ok(!triggers.some((name) => name.includes("folder")), triggers.join(", "));
	for (const name of [
		"jmap_changes_labels_ai", "jmap_changes_labels_au", "jmap_changes_labels_ad",
		"jmap_labels_ai", "jmap_labels_au", "jmap_labels_au_old", "jmap_labels_ad",
		"message_labels_same_mailbox_bi",
		"jmap_changes_message_labels_ai", "jmap_changes_message_labels_ad", "jmap_message_labels_ai", "jmap_message_labels_ad",
	]) assert.ok(triggers.includes(name), name);
});

async function labelled(t) {
	const fixture = await newDatabase(t, `${seed}
		INSERT INTO labels (id, user_id, mailbox_id, name, created_at) VALUES ('l1', 'u1', 'mb1', 'Clients', 1), ('l2', 'u1', 'mb2', 'Elsewhere', 1);
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, thread_id, created_at) VALUES
			('m1', 'u1', 'mb1', 'inbound', 'a@x.test', 'me@example.com', 'received', 't1', 1);
	`);
	const seq = () => fixture.sqlite.prepare("SELECT coalesce(max(seq), 0) AS seq FROM jmap_changes").get().seq;
	const revision = () => fixture.sqlite.prepare("SELECT revision FROM jmap_mailbox_revisions WHERE mailbox_id = 'mb1'").get()?.revision ?? 0;
	const changesAfter = (since) => fixture.sqlite.prepare("SELECT mailbox_id, object_type, object_id, thread_id, change FROM jmap_changes WHERE seq > ? ORDER BY seq").all(since).map((row) => ({ ...row }));
	return { ...fixture, seq, revision, changesAfter };
}

test("adding and removing a label logs an Email update and bumps the mailbox revision", async (t) => {
	const { sqlite, seq, revision, changesAfter } = await labelled(t);
	const update = { mailbox_id: "mb1", object_type: "email", object_id: "m1", thread_id: "t1", change: "updated" };

	let since = seq();
	let before = revision();
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'l1')");
	assert.deepEqual(changesAfter(since), [update]);
	assert.equal(revision(), before + 1);
	assert.ok(sqlite.prepare("SELECT created_at FROM message_labels").get().created_at > 0);

	since = seq();
	before = revision();
	sqlite.exec("DELETE FROM message_labels WHERE message_id = 'm1' AND label_id = 'l1'");
	assert.deepEqual(changesAfter(since), [update]);
	assert.equal(revision(), before + 1);
});

test("deleting a label removes its memberships and reports the label and the Email", async (t) => {
	const { sqlite, seq, changesAfter } = await labelled(t);
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'l1')");
	const since = seq();
	sqlite.exec("DELETE FROM labels WHERE id = 'l1'");
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM message_labels").get().n, 0);
	const changes = changesAfter(since);
	assert.ok(changes.some((row) => row.object_type === "mailbox" && row.object_id === "l1" && row.change === "destroyed"));
	assert.ok(changes.some((row) => row.object_type === "email" && row.object_id === "m1" && row.change === "updated"));
});

test("deleting a labelled message reports it destroyed, never updated afterwards", async (t) => {
	const { sqlite, seq, changesAfter } = await labelled(t);
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'l1')");
	const since = seq();
	sqlite.exec("DELETE FROM messages WHERE id = 'm1'");
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM message_labels").get().n, 0);
	assert.deepEqual(changesAfter(since).map((row) => row.change), ["destroyed"]);
});

test("a label from another mailbox is refused", async (t) => {
	const { sqlite } = await labelled(t);
	assert.throws(() => sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'l2')"), /label-mailbox-mismatch/);
	assert.throws(() => sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m1', 'l1'), ('m1', 'l1')"), /UNIQUE/);
});
