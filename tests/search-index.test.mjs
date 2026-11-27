import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

// The full-text index covers Bcc (bcc:), and every message stores its size (`messages.size_bytes`, larger:/smaller:).
const { app, newDatabase } = await loadApp("search-index", `
	export { outboundMessageSize } from "./src/lib/email/message-size-utils.ts";
`);

const seed = `
	INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'u1@example.com', 'hash', 'U1', 'admin', 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d1', 'u1', 'example.com', 'z1', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ('mb1', 'u1', 'd1', 'me', 'personal', 1);
`;
const match = (sqlite, query) => sqlite.prepare("SELECT m.id FROM messages m WHERE m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?) ORDER BY m.id").all(query).map((row) => row.id);

test("the index follows inserts, updates and deletes, Bcc included", async (t) => {
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
