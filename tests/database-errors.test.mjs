import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-database-errors-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		errors: join(root, "src/lib/database-errors.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	external: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*"],
	logLevel: "silent",
});

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const { isMissingColumnError, isMissingTableError, isUniqueConstraintError } = await load("errors");

test("driver errors are found through drizzle's wrapper", () => {
	const wrapped = new Error("Failed query: select 1\nparams: ", { cause: new Error("no such table: message_tracking") });
	assert.equal(isMissingTableError(wrapped), true);
	assert.equal(isMissingTableError(new Error("D1_ERROR: no such table: x: SQLITE_ERROR")), true);
	assert.equal(isMissingTableError(new Error("Failed query", { cause: new Error("database is locked") })), false);
	assert.equal(isUniqueConstraintError(new Error("Failed query", { cause: new Error("UNIQUE constraint failed: domain_tracking_hosts.hostname") })), true);
	assert.equal(isUniqueConstraintError(new Error("no such table")), false);
});

test("missing column wording", () => {
	for (const message of [
		"no such column: messages.new_col",
		"table messages has no column named new_col",
	]) assert.equal(isMissingColumnError(new Error("Failed query", { cause: new Error(message) })), true, message);
	assert.equal(isMissingColumnError(new Error("ambiguous column name: id")), false);
	assert.equal(isMissingColumnError(new Error("syntax error")), false);
});
