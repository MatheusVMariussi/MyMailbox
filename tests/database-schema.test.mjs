import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadApp } from "./helpers/real-db.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "drizzle/migrations");

const { app, newDatabase } = await loadApp("database-schema", `
	export * as schemaModule from "./src/db/schema/index.ts";
	export { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
	export { is } from "drizzle-orm";
	export { applyPendingMigrations, getMigrationStatus } from "./src/lib/migrations/service.ts";
	export { BACKUP_TABLES, INTERNAL_TABLES, INTERNAL_TABLE_PATTERNS } from "./src/lib/backups/export.ts";
`);

/** Tables SQLite, D1 and the migration ledger own, plus the FTS5 index and its shadow tables. */
const isInternal = (name) => name === "d1_migrations" || name.startsWith("sqlite_") || name.startsWith("_cf") || name.startsWith("messages_fts");

// Every table the schema module exports (the `schema` object handed to drizzle lists only the ones queried relationally).
const schemaTables = new Map(Object.values(app.schemaModule).filter((value) => app.is(value, app.SQLiteTable)).map((table) => {
	const config = app.getTableConfig(table);
	return [config.name, config.columns.map((column) => column.name).sort()];
}));
const sqlFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();

test("the migration bundle matches the SQL files", () => {
	const bundle = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8"));
	assert.deepEqual(bundle.migrations.map((migration) => migration.name), sqlFiles, "run `npm run db:bundle`");
	for (const migration of bundle.migrations) assert.ok(migration.statements.length > 0, migration.name);
});

test("the journal lists every SQL file in order", () => {
	const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
	assert.deepEqual(journal.entries.map((entry) => `${entry.tag}.sql`), sqlFiles);
	assert.deepEqual(journal.entries.map((entry) => entry.idx), sqlFiles.map((_, index) => index));
});

test("the migrations create exactly the schema's tables and columns", async (t) => {
	const { sqlite } = await newDatabase(t);
	const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name).filter((name) => !isInternal(name));
	assert.deepEqual(tables, [...schemaTables.keys()].sort());
	for (const [table, columns] of schemaTables) {
		const migrated = sqlite.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY name`).all().map((row) => row.name);
		assert.deepEqual(migrated, columns, table);
	}
});

test("the migrations create the search index, triggers and seed rows", async (t) => {
	const { sqlite } = await newDatabase(t);
	assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'messages_fts'").get());
	const triggers = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => row.name);
	assert.equal(triggers.length, 30);
	for (const prefix of ["messages_fts_", "messages_trashed_at_", "jmap_changes_", "jmap_messages_", "jmap_folders_", "jmap_mailboxes_", "jmap_mailbox_aliases_", "passkey_credentials_count_", "users_"]) {
		assert.ok(triggers.some((name) => name.startsWith(prefix)), prefix);
	}
	assert.deepEqual(sqlite.prepare("SELECT id, enabled FROM backup_settings").all().map((row) => ({ ...row })), [{ id: "default", enabled: 0 }]);
	assert.deepEqual(sqlite.prepare("SELECT id FROM app_settings").all().map((row) => row.id), ["default"]);
	assert.deepEqual({ ...sqlite.prepare("SELECT id, seq FROM jmap_change_floor").get() }, { id: 1, seq: 0 });
});

test("the in-app runner builds the same database as the SQL files", async (t) => {
	const fromFiles = await newDatabase(t);
	const runner = new app.SqliteDatabase(":memory:");
	t.after(() => runner.db.close());
	const result = await app.applyPendingMigrations(runner);
	assert.deepEqual(result.applied, sqlFiles);
	assert.equal((await app.getMigrationStatus(runner)).ready, true);
	const objects = (sqlite) => sqlite.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' ORDER BY type, name").all().map((row) => ({ ...row }));
	assert.deepEqual(objects(runner.db), objects(fromFiles.sqlite));
});

test("backups cover every migrated table", async (t) => {
	const { sqlite } = await newDatabase(t);
	const created = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
		.filter((name) => !app.INTERNAL_TABLES.includes(name) && !app.INTERNAL_TABLE_PATTERNS.some((pattern) => name.startsWith(pattern.replace(/%$/, ""))));
	assert.deepEqual(created.filter((name) => !app.BACKUP_TABLES.includes(name)), []);
	assert.deepEqual(app.BACKUP_TABLES.filter((name) => !created.includes(name)), []);
});
