import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mymailbox-search-negation-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
			export { parseSearch } from "./src/lib/search/parser-utils.ts";
			export { ftsPartFor, pruneSearchTree } from "./src/lib/search/fts-utils.ts";
		`,
		resolveDir: root,
		sourcefile: "search-negation-entry.ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	logLevel: "silent",
	alias: { "@": join(root, "src") },
});
const { ftsPartFor, parseSearch, pruneSearchTree } = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

function compile(query) {
	const node = pruneSearchTree(parseSearch(query, { timeZone: "UTC" }).root);
	return node ? ftsPartFor(node) : null;
}

function run(query) {
	const db = new DatabaseSync(":memory:");
	db.exec("CREATE VIRTUAL TABLE f USING fts5(subject)");
	db.exec("INSERT INTO f(subject) VALUES ('newsletter weekly'), ('invoice due'), ('hello there')");
	const { expression, negated } = compile(query);
	const sql = negated
		? "SELECT subject FROM f WHERE rowid NOT IN (SELECT rowid FROM f WHERE f MATCH ?)"
		: "SELECT subject FROM f WHERE rowid IN (SELECT rowid FROM f WHERE f MATCH ?)";
	return db.prepare(sql).all(expression).map((row) => row.subject);
}

test("a negation-only search excludes the term and keeps everything else", () => {
	assert.equal(compile("-newsletter").negated, true);
	assert.deepEqual(run("-newsletter").sort(), ["hello there", "invoice due"]);
});

test("positive terms with a negation still use the combined MATCH", () => {
	assert.equal(compile("-newsletter hello").negated, false);
	assert.deepEqual(run("-newsletter hello"), ["hello there"]);
});

test("a negated operator stays an operator instead of becoming a negated phrase", () => {
	const node = parseSearch("-from:x", { timeZone: "UTC" }).root;
	assert.deepEqual(node, { kind: "not", child: { kind: "term", field: "from", value: "x", phrase: false } });
});

test("a query with no text terms has nothing to match", () => {
	assert.equal(ftsPartFor(parseSearch("is:unread", { timeZone: "UTC" }).root), null);
});
