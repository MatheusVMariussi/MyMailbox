import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "node_modules", "mymailbox-jmap-other-than-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./tests/helpers/sqlite-database.ts";
			export { applyMigrations } from "./tests/helpers/migrate.ts";
			export { getDb } from "./src/db/index.ts";
			export { processRequest } from "./src/lib/jmap/processor.ts";
		`,
		resolveDir: root,
		sourcefile: "jmap-other-than-entry.ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "next/headers": "next/headers.js", "next/server": "next/server.js", "cloudflare:workers": "./tests/helpers/cloudflare-workers.ts" },
	logLevel: "silent",
});
const { SqliteDatabase, applyMigrations, getDb, processRequest } = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

const MAILBOX = "mbx_test";

/** An admin with one mailbox holding the given inbound messages. */
async function fixture(t, rows) {
	const database = new SqliteDatabase(":memory:");
	await applyMigrations(database, join(root, "drizzle/migrations"));
	t.after(() => database.db.close());
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('admin', 'owner@one.test', 'hash', 'Owner', 'admin', 1, 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('one', 'admin', 'one.test', 'zone-one', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, display_name, use_all_domains, type, disabled, created_at) VALUES ('${MAILBOX}', 'admin', 'one', 'support', 'Support', 1, 'personal', 0, 1);
	`);
	const insert = database.db.prepare(
		`INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, starred, created_at) VALUES (?, 'admin', '${MAILBOX}', 'inbound', ?, 'support@one.test', ?, 'received', 0, 0, ?)`,
	);
	for (const row of rows) insert.run(row.id, row.from ?? "a@one.test", row.subject ?? null, row.at ?? 2);
	const env = { DB: database };
	return {
		env,
		db: getDb(env),
		auth: { userId: "admin", email: "owner@one.test", scopes: ["jmap"], mailboxIds: null, user: { id: "admin", email: "owner@one.test", role: "admin" } },
		accountId: "admin",
		origin: "http://test",
		createdIds: {},
	};
}

async function query(ctx, args) {
	const res = await processRequest(ctx, { using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"], methodCalls: [["Email/query", { accountId: "admin", ...args }, "q"]] });
	return res.methodResponses[0][1];
}

const LABEL = `${MAILBOX}~f~lbl_work`;
const INBOX = `${MAILBOX}~inbox`;

/** m_inbox has no label, m_work carries the "Work" label and stays in the inbox, m_filed is archived with it. */
async function withLabel(t) {
	const ctx = await fixture(t, [{ id: "m_inbox", at: 10 }, { id: "m_work", at: 20 }, { id: "m_filed", at: 30 }]);
	ctx.env.DB.db.exec(`
		INSERT INTO labels (id, user_id, mailbox_id, name, created_at) VALUES ('lbl_work', 'admin', '${MAILBOX}', 'Work', 1);
		INSERT INTO message_labels (message_id, label_id) VALUES ('m_work', 'lbl_work'), ('m_filed', 'lbl_work');
		UPDATE messages SET status = 'archived' WHERE id = 'm_filed';
	`);
	return ctx;
}

test("inMailboxOtherThan a label keeps every message that is also in a system mailbox", async (t) => {
	const ctx = await withLabel(t);
	assert.deepEqual((await query(ctx, { filter: { inMailboxOtherThan: [LABEL] } })).ids, ["m_filed", "m_work", "m_inbox"]);
});

test("inMailboxOtherThan the inbox and a label keeps what is elsewhere too", async (t) => {
	const ctx = await withLabel(t);
	assert.deepEqual((await query(ctx, { filter: { inMailboxOtherThan: [INBOX, LABEL] } })).ids, ["m_filed"]);
	assert.deepEqual((await query(ctx, { filter: { inMailboxOtherThan: [INBOX] } })).ids, ["m_filed", "m_work"]);
});

test("NOT inMailbox a label keeps the mailbox's unlabelled messages", async (t) => {
	const ctx = await withLabel(t);
	assert.deepEqual((await query(ctx, { filter: { operator: "NOT", conditions: [{ inMailbox: LABEL }] } })).ids, ["m_inbox"]);
});

test("inMailbox a label matches only its messages, whatever their status", async (t) => {
	const ctx = await withLabel(t);
	assert.deepEqual((await query(ctx, { filter: { inMailbox: LABEL } })).ids, ["m_filed", "m_work"]);
	assert.deepEqual((await query(ctx, { filter: { inMailbox: INBOX } })).ids, ["m_work", "m_inbox"]);
});
