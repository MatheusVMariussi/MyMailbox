import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Text-only searches compile to one FTS5 MATCH (`src/lib/search/fts-utils.ts`). FTS5 has no unary NOT, so a
// negation rides on a positive sibling as binary NOT or turns the whole MATCH into `rowid NOT IN (…)`; these
// run the produced expressions on a real FTS5 table with the index's columns.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-search-fts-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { parseSearch } from "./src/lib/search/parser-utils.ts";
			export { ftsPartFor, pruneSearchTree } from "./src/lib/search/fts-utils.ts";
		`,
		resolveDir: root,
		sourcefile: "search-fts-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});
const m = await import(pathToFileURL(join(directory, "entry.mjs")).href);

const db = new DatabaseSync(":memory:");
after(() => db.close());
db.exec("CREATE VIRTUAL TABLE messages_fts USING fts5(subject, from_addr, to_addr, cc_addr, bcc_addr, text_body, html_body, tokenize='unicode61 remove_diacritics 2')");
const rows = [
	["newsletter weekly", "news@list.test", "me@x.test", null, null, "the weekly digest"],
	["invoice due", "billing@acme.test", "me@x.test", "carol@x.test", null, "pay soon"],
	["hello there", "maya@acme.test", "me@x.test", null, "dave@boss.test", "just saying hello"],
	["Relatório mensal", "ana@x.test", "me@x.test", null, null, "números do mês"],
];
const insert = db.prepare("INSERT INTO messages_fts (subject, from_addr, to_addr, cc_addr, bcc_addr, text_body) VALUES (?, ?, ?, ?, ?, ?)");
for (const row of rows) insert.run(...row);

function part(query) {
	const node = m.pruneSearchTree(m.parseSearch(query).root);
	return node ? m.ftsPartFor(node) : null;
}

/** Subjects a text-only query selects, through one MATCH. */
function run(query) {
	const compiled = part(query);
	assert.ok(compiled, `${query} compiles to one MATCH`);
	const sql = `SELECT subject FROM messages_fts WHERE rowid ${compiled.negated ? "NOT IN" : "IN"} (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?) ORDER BY rowid`;
	return db.prepare(sql).all(compiled.expression).map((row) => row.subject);
}

test("terms match by prefix, phrases exactly, across every column", () => {
	assert.deepEqual(run("inv"), ["invoice due"]);
	assert.deepEqual(run('"weekly digest"'), ["newsletter weekly"]);
	assert.deepEqual(run('"digest weekly"'), []);
	assert.deepEqual(run("relatorio"), ["Relatório mensal"], "diacritics fold");
	assert.deepEqual(run("acme"), ["invoice due", "hello there"]);
});

test("OR and groups", () => {
	assert.deepEqual(run("invoice OR newsletter"), ["newsletter weekly", "invoice due"]);
	assert.deepEqual(run("(invoice OR newsletter) due"), ["invoice due"]);
	assert.deepEqual(run("{hello invoice}"), ["invoice due", "hello there"]);
	assert.deepEqual(run("acme (hello OR pay)"), ["invoice due", "hello there"]);
});

test("a negation beside a positive becomes binary NOT", () => {
	const compiled = part("-newsletter acme");
	assert.equal(compiled.negated, false);
	assert.deepEqual(run("-newsletter acme"), ["invoice due", "hello there"]);
	assert.deepEqual(run("acme -billing"), ["hello there"]);
});

test("a negation with no positive sibling excludes its matches", () => {
	const compiled = part("-newsletter");
	assert.equal(compiled.negated, true);
	assert.deepEqual(run("-newsletter"), ["invoice due", "hello there", "Relatório mensal"]);
	assert.deepEqual(run("-newsletter -invoice"), ["hello there", "Relatório mensal"]);
	assert.deepEqual(run("-(acme OR weekly)"), ["Relatório mensal"]);
});

test("a negation inside an OR stays one MATCH", () => {
	assert.deepEqual(run("invoice OR -acme"), ["newsletter weekly", "invoice due", "Relatório mensal"]);
	assert.deepEqual(run("-invoice OR -acme"), ["newsletter weekly", "hello there", "Relatório mensal"]);
	assert.deepEqual(run("(weekly OR -acme) -mensal"), ["newsletter weekly"]);
	assert.deepEqual(run("-(invoice OR -acme)"), ["hello there"]);
});

test("field operators restrict a term to their column; to: covers Cc", () => {
	assert.deepEqual(run("from:maya@acme.test"), ["hello there"]);
	assert.deepEqual(run("from:acme"), ["invoice due", "hello there"]);
	assert.deepEqual(run("cc:carol"), ["invoice due"]);
	assert.deepEqual(run("to:carol"), ["invoice due"]);
	assert.deepEqual(run("bcc:dave"), ["hello there"]);
	assert.deepEqual(run("to:dave"), [], "Bcc is not To");
	assert.deepEqual(run('subject:"invoice due"'), ["invoice due"]);
	assert.deepEqual(run("subject:pay"), [], "the body is not the subject");
	assert.deepEqual(run("from:(maya OR news)"), ["newsletter weekly", "hello there"]);
	assert.deepEqual(run("-from:acme"), ["newsletter weekly", "Relatório mensal"]);
});

test("user text never alters the FTS5 grammar", () => {
	for (const query of ['"a"" OR ""b"', 'subject:"x) OR (y"', "NEAR(a b)", "a*", "^start", "col:umn", "{x : y}", '"', "AND OR NOT", "from:\"'\"", "a NOT b"]) {
		const compiled = part(query);
		if (!compiled) continue;
		assert.doesNotThrow(() => db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?").all(compiled.expression), query);
	}
	assert.deepEqual(run("a NOT b"), [], "NOT is a word, not an operator");
});

test("terms with nothing indexable are left out instead of failing the MATCH", () => {
	assert.equal(part("!!!"), null);
	assert.deepEqual(run("invoice !!!"), ["invoice due"]);
	assert.deepEqual(run("from:@ invoice"), ["invoice due"]);
});
