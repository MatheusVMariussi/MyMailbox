import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { loadApp } from "./helpers/real-db.mjs";

// 0004_search rebuilds the full-text index with Bcc and adds `messages.size_bytes` for larger:/smaller:.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "drizzle", "migrations");
const { app, newDatabase } = await loadApp("search-migration", `
	export { outboundMessageSize } from "./src/lib/email/message-size-utils.ts";
`);

const seed = `
	INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'u1@example.com', 'hash', 'U1', 'admin', 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d1', 'u1', 'example.com', 'z1', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ('mb1', 'u1', 'd1', 'me', 'personal', 1);
`;
const match = (sqlite, query) => sqlite.prepare("SELECT m.id FROM messages m WHERE m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?) ORDER BY m.id").all(query).map((row) => row.id);

/** A database at 0003, seeded, so 0004 runs over mail indexed without Bcc. */
async function databaseBefore0004(t, data) {
	const directory = mkdtempSync(join(tmpdir(), "mymailbox-search-migration-"));
	after(() => rmSync(directory, { recursive: true, force: true }));
	mkdirSync(join(directory, "meta"));
	const tags = ["0000_baseline", "0001_triggers_and_seeds", "0002_labels", "0003_projects"];
	for (const tag of tags) copyFileSync(join(migrationsDir, `${tag}.sql`), join(directory, `${tag}.sql`));
	writeFileSync(join(directory, "meta", "_journal.json"), JSON.stringify({ entries: tags.map((tag) => ({ tag })) }));
	const database = new app.SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await app.applyMigrations(database, directory);
	database.db.exec(seed + data);
	return database;
}

test("existing mail is re-indexed with its Bcc and keeps matching its other columns", async (t) => {
	const database = await databaseBefore0004(t, `
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, bcc_addr, subject, text_body, status, created_at) VALUES
			('sent', 'u1', 'mb1', 'outbound', 'me@example.com', 'ana@x.test', 'hidden@boss.test', 'Quarterly plan', 'numbers', 'sent', 1),
			('other', 'u1', 'mb1', 'inbound', 'bob@x.test', 'me@example.com', NULL, 'Lunch', 'tacos', 'received', 2);
	`);
	await app.applyMigrations(database, migrationsDir);
	const sqlite = database.db;
	assert.deepEqual(match(sqlite, 'bcc_addr : "hidden"*'), ["sent"]);
	assert.deepEqual(match(sqlite, '"tacos"*'), ["other"]);
	assert.deepEqual(match(sqlite, 'from_addr : "bob"*'), ["other"]);
	assert.deepEqual(sqlite.prepare("SELECT id, size_bytes FROM messages ORDER BY id").all().map((row) => ({ ...row })), [
		{ id: "other", size_bytes: 0 },
		{ id: "sent", size_bytes: 0 },
	]);
});

test("the rebuilt index follows inserts, updates and deletes, Bcc included", async (t) => {
	const { sqlite } = await newDatabase(t, seed);
	sqlite.exec(`INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, bcc_addr, subject, status, size_bytes, created_at)
		VALUES ('m1', 'u1', 'mb1', 'outbound', 'me@example.com', 'ana@x.test', 'carol@x.test', 'Hello', 'sent', 2048, 1)`);
	assert.deepEqual(match(sqlite, 'bcc_addr : "carol"*'), ["m1"]);
	sqlite.exec("UPDATE messages SET bcc_addr = 'dave@x.test' WHERE id = 'm1'");
	assert.deepEqual(match(sqlite, 'bcc_addr : "carol"*'), []);
	assert.deepEqual(match(sqlite, 'bcc_addr : "dave"*'), ["m1"]);
	sqlite.exec("DELETE FROM messages WHERE id = 'm1'");
	assert.deepEqual(match(sqlite, '"hello"*'), []);
	const triggers = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'messages_fts_%' ORDER BY name").all().map((row) => row.name);
	assert.deepEqual(triggers, ["messages_fts_ad", "messages_fts_ai", "messages_fts_au"]);
	const plan = sqlite.prepare("EXPLAIN QUERY PLAN SELECT id FROM messages WHERE mailbox_id = 'mb1' AND size_bytes >= 1024").all().map((row) => row.detail).join("\n");
	assert.match(plan, /messages_size_idx/);
});

test("an outbound message's size counts its text, HTML and attachments in bytes", () => {
	assert.equal(app.outboundMessageSize({ text: "héllo", html: null, attachments: [] }), 6);
	assert.equal(app.outboundMessageSize({ text: "a", html: "<p>a</p>", attachments: [{ content: new ArrayBuffer(10) }, { content: new ArrayBuffer(5) }] }), 1 + 8 + 15);
	assert.equal(app.outboundMessageSize({}), 0);
});
