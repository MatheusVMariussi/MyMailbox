import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Mailbox rules are Gmail-style filters over labels: every matching store rule adds its label, `skip_inbox`
// archives, and the first matching spam or trash rule wins outright (that mail gets no labels).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-inbound-label-rules-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./tests/helpers/sqlite-database.ts";
			export { applyMigrations } from "./tests/helpers/migrate.ts";
			export { getDb } from "./src/db/index.ts";
			export { processInboundMessage } from "./src/lib/email/inbound.ts";
			export { resolveInboxRuleDestination } from "./src/lib/email/routing.ts";
		`,
		resolveDir: root,
		sourcefile: "inbound-label-rules-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "next/headers": "next/headers.js", "next/server": "next/server.js", "cloudflare:workers": "./tests/helpers/cloudflare-workers.ts" },
	logLevel: "silent",
});
const m = await import(pathToFileURL(join(directory, "entry.mjs")).href);

function mime(from, subject) {
	return `From: ${from}\r\nTo: me@one.test\r\nSubject: ${subject}\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x.test>\r\nDate: Thu, 19 Nov 2026 10:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nhello\r\n`;
}

/** rules: [id, matchField, value, action, labelId, skipInbox, priority] */
async function fixture(t, rules) {
	const database = new m.SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await m.applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('admin', 'owner@one.test', 'hash', 'Owner', 'admin', 1, 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('one', 'admin', 'one.test', 'zone-one', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('box', 'admin', 'one', 'me', 1), ('other', 'admin', 'one', 'other', 1);
		INSERT INTO labels (id, user_id, mailbox_id, name, created_at) VALUES ('work', 'admin', 'box', 'Work', 1), ('invoices', 'admin', 'box', 'Invoices', 1), ('foreign', 'admin', 'other', 'Foreign', 1);
	`);
	const insert = database.db.prepare(`
		INSERT INTO routing_rules (id, user_id, domain_id, scope, mailbox_id, label_id, skip_inbox, pattern, match_field, match_operator, match_value, action, enabled, priority, created_at)
		VALUES (?, 'admin', 'one', 'mailbox', 'box', ?, ?, ?, ?, 'contains', ?, ?, 1, ?, 1)
	`);
	for (const [id, field, value, action, labelId, skipInbox, priority] of rules) insert.run(id, labelId ?? null, skipInbox ? 1 : 0, value, field, value, action, priority ?? 10);
	const objects = new Map();
	const webhooks = [];
	const env = {
		DB: database,
		BUCKET: { get: async (key) => (objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null), put: async () => {}, delete: async (key) => { objects.delete(key); } },
		REALTIME: { getByName: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
	};
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	let n = 0;
	const deliver = async (from, subject) => {
		const key = `raw/${++n}`;
		objects.set(key, new TextEncoder().encode(mime(from, subject)).buffer);
		await m.processInboundMessage(env, { from: "bounce@x.test", to: "me@one.test", rawR2Key: key });
		const row = database.db.prepare("SELECT id, status FROM messages WHERE raw_r2_key = ?").get(key);
		const labels = database.db.prepare("SELECT label_id FROM message_labels WHERE message_id = ? ORDER BY label_id").all(row.id).map((entry) => entry.label_id);
		return { status: row.status, labels };
	};
	const quiet = console.info;
	console.info = () => {};
	t.after(() => { console.info = quiet; });
	return { db: m.getDb(env), deliver, webhooks };
}

const input = (fromAddress, subject) => ({ mailboxId: "box", toAddress: "me@one.test", fromAddress, subject });

test("two matching store rules add both labels and the message stays in the inbox", async (t) => {
	const { db, deliver } = await fixture(t, [
		["r1", "email", "boss@corp.test", "store", "work"],
		["r2", "title", "invoice", "store", "invoices"],
	]);
	assert.deepEqual(await m.resolveInboxRuleDestination(db, input("boss@corp.test", "Invoice 42")), { status: "received", labelIds: ["work", "invoices"] });
	assert.deepEqual(await deliver("Boss <boss@corp.test>", "Invoice 42"), { status: "received", labels: ["invoices", "work"] });
	assert.deepEqual(await deliver("Boss <boss@corp.test>", "Lunch"), { status: "received", labels: ["work"] });
	assert.deepEqual(await deliver("Friend <friend@x.test>", "Lunch"), { status: "received", labels: [] });
});

test("skip_inbox archives what it matches, with its label", async (t) => {
	const { deliver } = await fixture(t, [
		["r1", "title", "invoice", "store", "invoices", true],
		["r2", "email", "boss@corp.test", "store", "work"],
	]);
	assert.deepEqual(await deliver("Boss <boss@corp.test>", "Invoice 42"), { status: "archived", labels: ["invoices", "work"] });
	assert.deepEqual(await deliver("Boss <boss@corp.test>", "Lunch"), { status: "received", labels: ["work"] });
});

test("a skip-inbox rule without a label only archives", async (t) => {
	const { deliver } = await fixture(t, [["r1", "title", "digest", "store", null, true]]);
	assert.deepEqual(await deliver("News <news@x.test>", "Weekly digest"), { status: "archived", labels: [] });
});

test("a matching spam or trash rule is terminal and adds no labels", async (t) => {
	const { db, deliver } = await fixture(t, [
		["r1", "email", "boss@corp.test", "store", "work", false, 20],
		["r2", "title", "casino", "spam", null, false, 10],
		["r3", "title", "unsubscribe me", "trash", null, false, 5],
	]);
	assert.deepEqual(await m.resolveInboxRuleDestination(db, input("boss@corp.test", "Casino night")), { status: "spam", labelIds: [] });
	assert.deepEqual(await deliver("Boss <boss@corp.test>", "Casino night"), { status: "spam", labels: [] });
	assert.deepEqual(await deliver("Boss <boss@corp.test>", "Please unsubscribe me"), { status: "trash", labels: [] });
});

test("a rule naming a label of another mailbox adds nothing", async (t) => {
	const { db, deliver } = await fixture(t, [["r1", "email", "boss@corp.test", "store", "foreign"]]);
	assert.deepEqual(await m.resolveInboxRuleDestination(db, input("boss@corp.test", "Hi")), { status: "received", labelIds: [] });
	assert.deepEqual(await deliver("Boss <boss@corp.test>", "Hi"), { status: "received", labels: [] });
});
