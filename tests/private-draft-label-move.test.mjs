import assert from "node:assert/strict";
import test from "node:test";
import { loadApp, sharedMailboxSeed } from "./helpers/real-db.mjs";

// A private draft the author labels over JMAP must stay private: a label move is not a send. Only an
// explicit "sent" (a real send, or the author marking it sent) releases it. A live draft takes no labels.
const { app, newDatabase } = await loadApp("private-draft-label-move", `
	export { emailSet, emailGet } from "./src/lib/jmap/emails.ts";
	export { encodeMailboxRef } from "./src/lib/jmap/ids.ts";
`);
const seed = `${sharedMailboxSeed("read_only")}
	UPDATE mailbox_access SET permission = 'full_access' WHERE user_id = 'author';
	INSERT INTO labels (id, user_id, mailbox_id, name, created_at) VALUES ('f1','admin','mb-team','F1',1),('f2','admin','mb-team','F2',1);
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, text_body, status, private_draft, created_at) VALUES
		('d-trash','author','mb-team','outbound','team@example.com','x@y.z','secret one','unsent','trash',1,2),
		('d-live','author','mb-team','outbound','team@example.com','x@y.z','secret two','unsent','draft',1,3),
		('s-sent','author','mb-team','outbound','team@example.com','x@y.z','shared','sent','sent',0,4);`;
const ctx = (db, env, id) => ({ env, db, accountId: "acct", origin: "http://localhost", createdIds: {}, memo: undefined,
	auth: { userId: id, user: { id, email: `${id}@example.com`, role: "user" }, scopes: ["jmap"], mailboxIds: null } });
const priv = (sqlite, id) => sqlite.prepare("SELECT private_draft AS p FROM messages WHERE id = ?").get(id).p;

test("labelling a private draft keeps it hidden from other readers, and a live draft takes no label", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	const ref = (labelId) => app.encodeMailboxRef({ kind: "label", mailboxId: "mb-team", labelId });
	const move = (id, labelId) => app.emailSet(ctx(db, env, "author"), { update: { [id]: { mailboxIds: { [ref(labelId)]: true } } } });
	for (const label of ["f1", "f2"]) {
		assert.deepEqual((await move("d-trash", label)).notUpdated, {});
		assert.equal((await move("d-live", label)).notUpdated["d-live"].type, "invalidProperties");
	}
	// Out of Trash into a label: archived, never sent.
	assert.equal(sqlite.prepare("SELECT status FROM messages WHERE id = 'd-trash'").get().status, "archived");
	assert.equal(sqlite.prepare("SELECT status FROM messages WHERE id = 'd-live'").get().status, "draft");
	assert.equal(priv(sqlite, "d-trash"), 1);
	assert.equal(priv(sqlite, "d-live"), 1);
	const seen = await app.emailGet(ctx(db, env, "delegate"), { ids: ["d-trash", "d-live"], properties: ["subject"] });
	assert.deepEqual(seen.list, []);
	assert.deepEqual(seen.notFound.sort(), ["d-live", "d-trash"]);
});

test("labelling sent mail keeps it visible and sent, and marking a draft sent releases it", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	const f1 = app.encodeMailboxRef({ kind: "label", mailboxId: "mb-team", labelId: "f1" });
	await app.emailSet(ctx(db, env, "author"), { update: { "s-sent": { mailboxIds: { [f1]: true } } } });
	assert.equal(priv(sqlite, "s-sent"), 0);
	assert.equal(sqlite.prepare("SELECT status FROM messages WHERE id = 's-sent'").get().status, "sent");
	const sentBox = app.encodeMailboxRef({ kind: "role", mailboxId: "mb-team", role: "sent" });
	await app.emailSet(ctx(db, env, "author"), { update: { "d-live": { mailboxIds: { [sentBox]: true } } } });
	assert.equal(priv(sqlite, "d-live"), 0);
});
