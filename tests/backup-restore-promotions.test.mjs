import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import Database from "better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "node_modules", ".cache", "backup-restore-promotions");
const outfile = join(outDir, "backup.mjs");
await build({
	stdin: {
		contents: 'export * from "./src/lib/backups/export";',
		resolveDir: root,
		loader: "ts",
	},
	outfile,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	logLevel: "silent",
	alias: { "@": join(root, "src") },
	banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const { exportDatabaseRecords, restoreDatabaseRecords } = await import(pathToFileURL(outfile).href);
const { migrations } = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8"));

function d1(sqlite) {
	const prepare = (sql) => {
		const statement = {
			values: [],
			bind(...values) {
				statement.values = values;
				return statement;
			},
			async all() {
				return { results: sqlite.prepare(sql).all(...statement.values), success: true, meta: {} };
			},
			async run() {
				const result = sqlite.prepare(sql).run(...statement.values);
				return { results: [], success: true, meta: { changes: result.changes } };
			},
			async first() {
				return sqlite.prepare(sql).get(...statement.values) ?? null;
			},
		};
		return statement;
	};
	return {
		prepare,
		async batch(statements) {
			return Promise.all(statements.map((statement) => statement.run()));
		},
	};
}

function database() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	for (const migration of migrations) {
		for (const statement of migration.statements) sqlite.exec(statement);
	}
	return sqlite;
}

function seed(sqlite) {
	sqlite.exec("insert into users (id, email, password_hash, name, created_at) values ('u','u@x.test','h','U',1)");
	sqlite.exec("insert into domains (id, user_id, hostname, zone_id, created_at) values ('d','u','x.test','z',1)");
	sqlite.exec("insert into mailboxes (id, user_id, domain_id, local_part, created_at) values ('m','u','d','a',1)");
	sqlite.exec("insert into messages (id, user_id, mailbox_id, direction, status, from_addr, to_addr, subject, created_at) values ('msg','u','m','inbound','received','a@b.test','a@x.test','hi',1)");
}
const toBuffer = (backup) => backup.buffer.slice(backup.byteOffset, backup.byteOffset + backup.byteLength);
const count = (sqlite, table) => sqlite.prepare(`select count(*) as n from ${table}`).get().n;

test("promotion data survives a backup and restore", async () => {
	const sqlite = database();
	seed(sqlite);
	sqlite.exec("update messages set category = 'promotions', sender_address = 'a@b.test'");
	sqlite.exec("insert into mailbox_promotion_settings (mailbox_id, mode, backfill_status, backfill_stalls, updated_at) values ('m','show','failed',3,1)");
	await restoreDatabaseRecords(d1(sqlite), toBuffer(await exportDatabaseRecords(d1(sqlite))));
	assert.equal(count(sqlite, "users"), 1);
	assert.deepEqual({ ...sqlite.prepare("select category, sender_address from messages").get() }, { category: "promotions", sender_address: "a@b.test" });
	assert.deepEqual({ ...sqlite.prepare("select mode, backfill_status, backfill_stalls from mailbox_promotion_settings").get() }, { mode: "show", backfill_status: "failed", backfill_stalls: 3 });
});

test("a database still missing a table backs up and restores without it", async () => {
	const sqlite = database();
	sqlite.exec("drop table mailbox_sender_preferences; drop table mailbox_promotion_settings");
	seed(sqlite);
	const backup = await exportDatabaseRecords(d1(sqlite));
	assert.deepEqual(JSON.parse(new TextDecoder().decode(backup)).tables.mailbox_promotion_settings, []);
	await restoreDatabaseRecords(d1(sqlite), toBuffer(backup));
	assert.equal(count(sqlite, "users"), 1);
	assert.equal(count(sqlite, "messages"), 1);
});

test("restoring rows of a table this database does not have yet fails before anything is deleted", async () => {
	const source = database();
	seed(source);
	source.exec("insert into mailbox_promotion_settings (mailbox_id, mode, updated_at) values ('m','show',1)");
	const backup = await exportDatabaseRecords(d1(source));
	const target = database();
	target.exec("drop table mailbox_promotion_settings");
	seed(target);
	await assert.rejects(restoreDatabaseRecords(d1(target), toBuffer(backup)), /Apply pending database migrations before restoring mailbox_promotion_settings/);
	assert.equal(count(target, "users"), 1);
	assert.equal(count(target, "messages"), 1);
});

test("columns a newer backup carries but this database lacks are dropped, so nothing fails after the teardown", async () => {
	const source = database();
	seed(source);
	source.exec("insert into mailbox_promotion_settings (mailbox_id, mode, backfill_status, backfill_stalls, backfill_error, backfill_day, backfill_day_rows, updated_at) values ('m','show','failed',3,'boom',20000,5,1)");
	const backup = await exportDatabaseRecords(d1(source));
	const target = database();
	target.exec("alter table mailbox_promotion_settings drop column backfill_stalls");
	seed(target);
	await restoreDatabaseRecords(d1(target), toBuffer(backup));
	assert.deepEqual({ ...target.prepare("select mailbox_id, mode, backfill_status from mailbox_promotion_settings").get() }, { mailbox_id: "m", mode: "show", backfill_status: "failed" });
	assert.equal(count(target, "messages"), 1);
});

test("a backup written by an older Mailflare format is refused before anything is deleted", async () => {
	const sqlite = database();
	seed(sqlite);
	const document = JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(d1(sqlite))));
	document.version = 2;
	const old = new TextEncoder().encode(JSON.stringify(document));
	await assert.rejects(restoreDatabaseRecords(d1(sqlite), toBuffer(old)), /older Mailflare release/);
	assert.equal(count(sqlite, "messages"), 1);
});
