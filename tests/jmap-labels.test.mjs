import assert from "node:assert/strict";
import test from "node:test";
import { loadApp, sharedMailboxSeed } from "./helpers/real-db.mjs";

// JMAP sees labels as Mailboxes (`<mailbox>~f~<label>`, role null): an Email is in one system
// mailbox (its status) plus one label mailbox per label it carries.
const { app, newDatabase } = await loadApp("jmap-labels", `
	export { mailboxSet, buildAllMailboxes } from "./src/lib/jmap/mailboxes.ts";
	export { emailSet, emailGet, emailQuery } from "./src/lib/jmap/emails.ts";
`);

const seed = `${sharedMailboxSeed("full_access")}
	INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES ('acc-3', 'mb-admin', 'delegate', 'read_only', 1);
	INSERT INTO labels (id, user_id, mailbox_id, name, created_at) VALUES
		('l-own', 'delegate', 'mb-delegate', 'Mine', 1), ('l-two', 'delegate', 'mb-delegate', 'Two', 1), ('l-foreign', 'admin', 'mb-admin', 'Theirs', 1);
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, created_at) VALUES
		('m-foreign', 'admin', 'mb-admin', 'inbound', 'x@example.net', 'admin@example.com', 'Secret', 'received', 0, 2),
		('m-own', 'delegate', 'mb-delegate', 'inbound', 'x@example.net', 'delegate@example.com', 'Mine', 'received', 0, 2),
		('m-sent', 'delegate', 'mb-delegate', 'outbound', 'delegate@example.com', 'x@example.net', 'Reply', 'sent', 1, 3);
	INSERT INTO message_labels (message_id, label_id) VALUES ('m-foreign', 'l-foreign');
`;
const OWN = "mb-delegate~f~l-own";
const TWO = "mb-delegate~f~l-two";
const INBOX = "mb-delegate~inbox";
const ARCHIVE = "mb-delegate~archive";

function context(db, env) {
	return {
		env, db, accountId: "acct", origin: "http://localhost", createdIds: {}, memo: undefined,
		auth: { userId: "delegate", user: { id: "delegate", email: "delegate@example.com", role: "user" }, scopes: ["jmap"], mailboxIds: null },
	};
}
const labelsOf = (sqlite, id) => sqlite.prepare("SELECT label_id FROM message_labels WHERE message_id = ? ORDER BY label_id").all(id).map((row) => row.label_id);
const statusOf = (sqlite, id) => sqlite.prepare("SELECT status FROM messages WHERE id = ?").get(id).status;

test("mailboxIds list the status mailbox and every label", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m-own', 'l-own'), ('m-own', 'l-two')");
	const { list } = await app.emailGet(context(db, env), { ids: ["m-own", "m-sent"], properties: ["mailboxIds"] });
	const byId = new Map(list.map((email) => [email.id, email.mailboxIds]));
	assert.deepEqual(byId.get("m-own"), { [INBOX]: true, [OWN]: true, [TWO]: true });
	assert.deepEqual(byId.get("m-sent"), { "mb-delegate~sent": true });
});

test("inMailbox on a label matches its messages in any status, and NOT keeps the rest", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m-own', 'l-own'), ('m-sent', 'l-own')");
	const query = async (filter) => (await app.emailQuery(context(db, env), { filter })).ids.sort();
	assert.deepEqual(await query({ inMailbox: OWN }), ["m-own", "m-sent"]);
	assert.deepEqual(await query({ inMailbox: INBOX }), ["m-own"]);
	assert.deepEqual(await query({ inMailbox: TWO }), []);
	assert.deepEqual(await query({ operator: "NOT", conditions: [{ inMailbox: TWO }] }), ["m-own", "m-sent"]);
	assert.deepEqual(await query({ operator: "NOT", conditions: [{ inMailbox: OWN }] }), []);
	assert.deepEqual(await query({ inMailboxOtherThan: [OWN] }), ["m-own", "m-sent"]);
});

test("Mailbox objects carry label counts, with role null", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m-own', 'l-own'), ('m-sent', 'l-own')");
	const all = await app.buildAllMailboxes(context(db, env));
	const own = all.find((mailbox) => mailbox.id === OWN);
	assert.deepEqual({ name: own.name, role: own.role, parentId: own.parentId, totalEmails: own.totalEmails, unreadEmails: own.unreadEmails }, { name: "Mine", role: null, parentId: "mb-delegate", totalEmails: 2, unreadEmails: 1 });
	assert.equal(all.find((mailbox) => mailbox.id === INBOX).totalEmails, 1);
	assert.equal(all.find((mailbox) => mailbox.id === "mb-delegate").totalEmails, 2);
});

test("adding a label keeps the inbox, labels alone archive received mail, a sent message stays sent", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	const keep = await app.emailSet(context(db, env), { update: { "m-own": { [`mailboxIds/${OWN}`]: true } } });
	assert.deepEqual(keep.updated, { "m-own": null });
	assert.equal(statusOf(sqlite, "m-own"), "received");
	assert.deepEqual(labelsOf(sqlite, "m-own"), ["l-own"]);

	const moved = await app.emailSet(context(db, env), { update: { "m-own": { mailboxIds: { [OWN]: true, [TWO]: true } } } });
	assert.deepEqual(moved.updated, { "m-own": { mailboxIds: { [ARCHIVE]: true, [OWN]: true, [TWO]: true } } });
	assert.equal(statusOf(sqlite, "m-own"), "archived");
	assert.deepEqual(labelsOf(sqlite, "m-own"), ["l-own", "l-two"]);

	const back = await app.emailSet(context(db, env), { update: { "m-own": { mailboxIds: { [INBOX]: true } } } });
	assert.deepEqual(back.updated, { "m-own": null });
	assert.equal(statusOf(sqlite, "m-own"), "received");
	assert.deepEqual(labelsOf(sqlite, "m-own"), []);

	const sent = await app.emailSet(context(db, env), { update: { "m-sent": { mailboxIds: { [OWN]: true } } } });
	assert.deepEqual(sent.updated, { "m-sent": { mailboxIds: { "mb-delegate~sent": true, [OWN]: true } } });
	assert.equal(statusOf(sqlite, "m-sent"), "sent");
});

test("a mailboxIds patch is refused when empty, with two system mailboxes, or naming a foreign label", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	const refused = async (mailboxIds) => (await app.emailSet(context(db, env), { update: { "m-own": { mailboxIds } } })).notUpdated["m-own"];
	assert.equal((await refused({})).type, "invalidProperties");
	assert.equal((await refused({ [INBOX]: true, [ARCHIVE]: true })).type, "invalidProperties");
	assert.equal((await refused({ "mb-delegate~f~l-foreign": true })).type, "invalidProperties");
	assert.equal((await refused({ "mb-delegate~f~nope": true })).type, "invalidProperties");
	assert.equal((await refused({ "mb-admin~f~l-foreign": true })).type, "invalidProperties");
	assert.deepEqual(labelsOf(sqlite, "m-own"), []);
	assert.equal(statusOf(sqlite, "m-own"), "received");
});

test("destroying a label id from another mailbox touches nothing there", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	const result = await app.mailboxSet(context(db, env), { destroy: ["mb-delegate~f~l-foreign"], onDestroyRemoveEmails: true });
	assert.deepEqual(result.destroyed, []);
	assert.deepEqual(result.notDestroyed["mb-delegate~f~l-foreign"], { type: "notFound" });
	assert.deepEqual(labelsOf(sqlite, "m-foreign"), ["l-foreign"]);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM labels WHERE id = 'l-foreign'").get().n, 1);
});

test("destroying a label with mail needs onDestroyRemoveEmails, which drops the label and never the mail", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m-own', 'l-own')");
	const kept = await app.mailboxSet(context(db, env), { destroy: [OWN] });
	assert.deepEqual(kept.notDestroyed[OWN], { type: "mailboxHasEmail" });
	const result = await app.mailboxSet(context(db, env), { destroy: [OWN], onDestroyRemoveEmails: true });
	assert.deepEqual(result.destroyed, [OWN]);
	assert.equal(statusOf(sqlite, "m-own"), "received");
	assert.deepEqual(labelsOf(sqlite, "m-own"), []);
	const empty = await app.mailboxSet(context(db, env), { destroy: [TWO] });
	assert.deepEqual(empty.destroyed, [TWO]);
});

test("labels are created and renamed as Mailboxes, and a read-only sharee cannot rename one", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	const created = await app.mailboxSet(context(db, env), { create: { k1: { parentId: "mb-delegate", name: "  Fresh  " } } });
	assert.match(created.created.k1.id, /^mb-delegate~f~/);
	assert.equal(sqlite.prepare("SELECT name FROM labels WHERE mailbox_id = 'mb-delegate' AND name = 'Fresh'").get()?.name, "Fresh");
	const duplicate = await app.mailboxSet(context(db, env), { create: { k2: { parentId: "mb-delegate", name: "Mine" } } });
	assert.equal(duplicate.notCreated.k2.type, "invalidProperties");

	const renamed = await app.mailboxSet(context(db, env), { update: { [OWN]: { name: "Renamed" } } });
	assert.ok(OWN in renamed.updated);
	assert.equal(sqlite.prepare("SELECT name FROM labels WHERE id = 'l-own'").get().name, "Renamed");

	const teamSeed = `${sharedMailboxSeed("read_only")}
		INSERT INTO labels (id, user_id, mailbox_id, name, created_at) VALUES ('l-team', 'admin', 'mb-team', 'Team', 1);
	`;
	const team = await newDatabase(t, teamSeed);
	const result = await app.mailboxSet(context(team.db, team.env), { update: { "mb-team~f~l-team": { name: "renamed" } } });
	assert.deepEqual(result.updated, {});
	assert.deepEqual(result.notUpdated["mb-team~f~l-team"], { type: "forbidden" });
	assert.equal(team.sqlite.prepare("SELECT name FROM labels WHERE id = 'l-team'").get().name, "Team");
});

function quietly(t) {
	const errors = [];
	t.mock.method(console, "error", (...args) => { errors.push(args); });
	return errors;
}

test("a failed label write is reported per message, rolls back its status, and the other updates still apply", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	const errors = quietly(t);
	sqlite.exec(`
		CREATE TRIGGER fail_m_own_label BEFORE INSERT ON message_labels
		WHEN NEW.message_id = 'm-own'
		BEGIN
			SELECT RAISE(ABORT, 'injected label failure');
		END;
	`);
	const result = await app.emailSet(context(db, env), { update: {
		"m-own": { mailboxIds: { [OWN]: true }, "keywords/$flagged": true },
		"m-sent": { "keywords/$flagged": true },
	} });
	assert.equal(result.notUpdated["m-own"].type, "serverFail");
	assert.doesNotMatch(result.notUpdated["m-own"].description, /injected/, "the database error stays in the logs");
	assert.ok(errors.length > 0, "the failure is logged");
	assert.deepEqual(result.updated, { "m-sent": null });
	// The whole update of m-own is one unit: neither the archive, the flag nor the label committed.
	assert.equal(statusOf(sqlite, "m-own"), "received");
	assert.equal(sqlite.prepare("SELECT starred FROM messages WHERE id = 'm-own'").get().starred, 0);
	assert.deepEqual(labelsOf(sqlite, "m-own"), []);
	assert.equal(sqlite.prepare("SELECT starred FROM messages WHERE id = 'm-sent'").get().starred, 1);
});

test("a label that moved to another mailbox meanwhile is reported as invalidProperties", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	// The label check passed; the database's own guard refuses the pair at write time (a race with a label change).
	sqlite.exec(`
		CREATE TRIGGER race_m_own_label BEFORE INSERT ON message_labels
		WHEN NEW.message_id = 'm-own'
		BEGIN
			SELECT RAISE(ABORT, 'label-mailbox-mismatch');
		END;
	`);
	const result = await app.emailSet(context(db, env), { update: { "m-own": { mailboxIds: { [OWN]: true, [TWO]: true } } } });
	assert.equal(result.notUpdated["m-own"].type, "invalidProperties");
	assert.deepEqual(result.notUpdated["m-own"].properties, ["mailboxIds"]);
	assert.equal(statusOf(sqlite, "m-own"), "received");
	assert.deepEqual(labelsOf(sqlite, "m-own"), []);
});

test("a move into Drafts commits the status, the label removal and the hidden marker together", async (t) => {
	const { env, db, sqlite } = await newDatabase(t, seed);
	sqlite.exec("INSERT INTO message_labels (message_id, label_id) VALUES ('m-sent', 'l-own')");
	const result = await app.emailSet(context(db, env), { update: { "m-sent": { mailboxIds: { "mb-delegate~drafts": true } } } });
	assert.deepEqual(result.updated, { "m-sent": null });
	assert.equal(statusOf(sqlite, "m-sent"), "draft");
	assert.deepEqual(labelsOf(sqlite, "m-sent"), []);
	assert.equal(sqlite.prepare("SELECT private_draft FROM messages WHERE id = 'm-sent'").get().private_draft, 1);
	assert.equal(sqlite.prepare("SELECT count(*) AS n FROM jmap_changes WHERE object_id = 'm-sent' AND change = 'hidden'").get().n, 1);
});
