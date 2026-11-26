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
`);

/** Tables SQLite, D1 and the migration ledger own, plus the FTS5 index and its shadow tables. */
const isInternal = (name) => name === "d1_migrations" || name.startsWith("sqlite_") || name.startsWith("_cf") || name.startsWith("messages_fts");

// Every table the schema module exports (the `schema` object handed to drizzle lists only the ones queried relationally).
const schemaTables = new Map(Object.values(app.schemaModule).filter((value) => app.is(value, app.SQLiteTable)).map((table) => {
	const config = app.getTableConfig(table);
	return [config.name, config.columns.map((column) => column.name).sort()];
}));

test("the migration bundle matches the SQL files", () => {
	const bundle = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8"));
	const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
	assert.deepEqual(bundle.migrations.map((migration) => migration.name), names, "run `npm run db:bundle`");
	for (const migration of bundle.migrations) assert.ok(migration.statements.length > 0, migration.name);
});

test("the migrations create the schema's tables and columns", async (t) => {
	const { sqlite } = await newDatabase(t);
	const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name).filter((name) => !isInternal(name));
	assert.deepEqual(tables, [...schemaTables.keys()].sort());
	for (const [table, columns] of schemaTables) {
		const migrated = sqlite.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY name`).all().map((row) => row.name);
		assert.deepEqual(migrated, columns, table);
	}
});
