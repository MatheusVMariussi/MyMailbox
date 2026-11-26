import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// The Gmail-style grammar (`src/lib/search/parser-utils.ts`): every construct, precedence, repeated
// operators, unknown keys and values kept as text, and totality over malformed input.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-search-parser-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { parseSearch, normalizeSearchName, searchFolderNames, SEARCH_MAX_QUERY_LENGTH, SEARCH_MAX_LEAVES, SEARCH_MAX_DEPTH } from "./src/lib/search/parser-utils.ts";
			export { parseSearchQuery } from "./src/lib/search/query-utils.ts";
		`,
		resolveDir: root,
		sourcefile: "search-parser-entry.ts",
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

/** A compact s-expression of a node, so assertions read like the query. */
function show(node) {
	if (!node) return null;
	switch (node.kind) {
		case "and":
		case "or":
			return `(${node.kind} ${node.children.map(show).join(" ")})`;
		case "not":
			return `(not ${show(node.child)})`;
		case "term": {
			const value = node.phrase ? `"${node.value}"` : node.value;
			return node.field ? `${node.field}:${value}` : value;
		}
		case "date":
			return `${node.bound}:${node.at.toISOString()}`;
		case "age":
			return `${node.bound}_than:${node.amount}${node.unit}`;
		case "size":
			return `${node.bound}:${node.bytes}`;
		default:
			return `${node.kind}:${node.value}`;
	}
}
const parse = (query, timeZone = "UTC") => show(m.parseSearch(query, { timeZone }).root);

test("words, phrases and field operators", () => {
	assert.equal(parse("invoice"), "invoice");
	assert.equal(parse('"private window"'), '"private window"');
	assert.equal(parse("from:maya to:sam subject:report"), "(and from:maya to:sam subject:report)");
	assert.equal(parse('from:"Sam Okoro" cc:ana bcc:boss title:x'), '(and from:"Sam Okoro" cc:ana bcc:boss subject:x)');
	assert.equal(parse("FROM:maya"), "from:maya", "keys are case-insensitive");
	assert.equal(parse("from:maya@acme.test"), "from:maya@acme.test");
});

test("flag, folder and attachment operators", () => {
	assert.equal(parse("has:attachment has:attachments"), "(and has:attachment has:attachment)");
	assert.equal(parse("filename:Report.PDF"), "filename:report.pdf");
	assert.equal(parse("is:unread is:read is:starred is:snoozed"), "(and is:unread is:read is:starred is:snoozed)");
	assert.equal(parse(":unread"), "is:unread", "the legacy bare form keeps working");
	assert.equal(parse(":read"), "is:read");
	assert.equal(
		parse("in:inbox in:sent in:drafts in:draft in:spam in:trash in:archive in:archived in:snoozed in:anywhere"),
		"(and in:inbox in:sent in:drafts in:drafts in:spam in:trash in:archive in:archive in:snoozed in:anywhere)",
	);
	assert.equal(parse("category:promotions category:Promotion category:primary category:INBOX"), "(and category:promotions category:promotions category:primary category:primary)");
});

test("labels and projects compare lower-cased with spaces, hyphens and slashes equivalent", () => {
	assert.equal(parse("label:Client-Work"), "label:client work");
	assert.equal(parse('label:"Client  Work"'), "label:client work");
	assert.equal(parse("label:clients/acme"), "label:clients acme");
	assert.equal(parse("project:Side-Project"), "project:side project");
	assert.equal(m.normalizeSearchName(" Família  Silva "), "família silva");
	assert.equal(m.normalizeSearchName("AÇÃO"), "ação", "Unicode letters fold too");
	assert.equal(parse("deliveredto:Sales@Acme.Test"), "deliveredto:sales@acme.test");
});

test("dates, relative ages and sizes", () => {
	assert.equal(parse("after:2026-09-01 before:2026/09/30"), "(and after:2026-09-01T00:00:00.000Z before:2026-09-30T00:00:00.000Z)");
	assert.equal(parse("newer:2026-09-01 older:2026-09-30"), "(and after:2026-09-01T00:00:00.000Z before:2026-09-30T00:00:00.000Z)");
	assert.equal(parse("after:2026-09-01", "America/Sao_Paulo"), "after:2026-09-01T03:00:00.000Z", "midnight in the account's zone");
	assert.equal(parse("after:1788000000"), `after:${new Date(1788000000 * 1000).toISOString()}`, "epoch seconds, as Gmail accepts");
	assert.equal(parse("newer_than:7d older_than:2w newer_than:3m older_than:1Y"), "(and newer_than:7d older_than:2w newer_than:3m older_than:1y)");
	assert.equal(parse("larger:1K smaller:10M size:2g larger:500"), `(and larger:1024 smaller:${10 * 1024 * 1024} larger:${2 * 1024 ** 3} larger:500)`);
	assert.equal(parse("larger:1.5kb"), "larger:1536");
});

test("negation applies to words, phrases, operators and groups", () => {
	assert.equal(parse("-newsletter"), "(not newsletter)");
	assert.equal(parse('-"weekly digest"'), '(not "weekly digest")');
	assert.equal(parse("-from:x"), "(not from:x)", "a negated operator stays an operator");
	assert.equal(parse("-is:read"), "(not is:read)");
	assert.equal(parse("-(a b)"), "(not (and a b))");
	assert.equal(parse("--a"), "a", "a double negation cancels");
	assert.equal(parse("e-mail"), "e-mail", "an inner hyphen is part of the word");
});

test("OR binds tighter than the implicit AND, as in Gmail", () => {
	assert.equal(parse("a OR b"), "(or a b)");
	assert.equal(parse("a b OR c"), "(and a (or b c))");
	assert.equal(parse("a OR b c"), "(and (or a b) c)");
	assert.equal(parse("a OR b OR c d"), "(and (or a b c) d)");
	assert.equal(parse("from:x OR from:y"), "(or from:x from:y)");
	assert.equal(parse("a AND b"), "(and a b)", "an explicit AND is the implicit one");
	assert.equal(parse("a AND b OR c"), "(and a (or b c))");
	assert.equal(parse("a or b"), "(and a or b)", "lower-case or is a word");
	assert.equal(parse("ORANGE ANDROID"), "(and ORANGE ANDROID)");
	assert.equal(parse("-a OR b"), "(or (not a) b)");
});

test("parentheses and braces group", () => {
	assert.equal(parse("(a OR b) c"), "(and (or a b) c)");
	assert.equal(parse("(from:x OR from:y) -is:read"), "(and (or from:x from:y) (not is:read))");
	assert.equal(parse("a (b OR (c d))"), "(and a (or b (and c d)))");
	assert.equal(parse("{a b c}"), "(or a b c)", "Gmail's brace group is an OR");
	assert.equal(parse("{from:x from:y} report"), "(and (or from:x from:y) report)");
	assert.equal(parse("-{a b}"), "(not (or a b))");
	assert.equal(parse("()"), null);
});

test("an operator applies to every term of its group", () => {
	assert.equal(parse("from:(alice OR bob)"), "(or from:alice from:bob)");
	assert.equal(parse("subject:(dinner movie)"), "(and subject:dinner subject:movie)");
	assert.equal(parse('subject:(-draft "q3 plan")'), '(and (not subject:draft) subject:"q3 plan")');
	assert.equal(parse("label:(work OR home)"), "(or label:work label:home)");
	assert.equal(parse("from:(alice to:bob)"), "(and from:alice to:bob)", "an inner operator keeps its own key");
});

test("repeated operators all apply", () => {
	assert.equal(parse("from:a from:b"), "(and from:a from:b)");
	assert.equal(parse("label:x label:y"), "(and label:x label:y)");
});

test("an unknown key or a known key with an unknown value stays free text", () => {
	assert.equal(parse("foo:bar"), "foo:bar");
	assert.equal(parse("http://acme.test/x"), "http://acme.test/x");
	assert.equal(parse("has:drive"), "has:drive");
	assert.equal(parse("is:important"), "is:important");
	assert.equal(parse("in:nowhere"), "in:nowhere");
	assert.equal(parse("category:social"), "category:social");
	assert.equal(parse("after:yesterday"), "after:yesterday");
	assert.equal(parse("after:2026-02-30"), "after:2026-02-30", "an impossible date is not a date");
	assert.equal(parse("larger:huge"), "larger:huge");
	assert.equal(parse("older_than:3x"), "older_than:3x");
	assert.equal(parse("from:"), "from:", "an operator without a value is text, never dropped");
	assert.equal(parse("-is:important"), "(not is:important)");
});

test("malformed input degrades gracefully and never throws", () => {
	assert.equal(parse('"unbalanced quote'), '"unbalanced quote"');
	assert.equal(parse('from:"Sam'), 'from:"Sam"');
	assert.equal(parse("(a OR b"), "(or a b)");
	assert.equal(parse("a OR"), "a", "a trailing OR is dropped");
	assert.equal(parse("OR a"), "a", "a leading OR is dropped");
	assert.equal(parse("a OR OR b"), "(or a b)");
	assert.equal(parse("-"), null, "a lone minus is nothing");
	assert.equal(parse("a - b"), "(and a b)");
	assert.equal(parse(")) a ((b"), "(and a b)");
	assert.equal(parse("a)"), "a");
	assert.equal(parse('""'), null);
	assert.equal(parse("-(  )"), null);
	assert.equal(parse("{"), null);
	assert.equal(parse("   "), null);
	assert.equal(parse(""), null);
	const alphabet = ['"', "(", ")", "{", "}", "-", " ", "OR", "AND", "a", "from:", "is:read", ":", "label:", "x"];
	let seed = 7;
	const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
	for (let round = 0; round < 2000; round += 1) {
		const length = next() % 14;
		const query = Array.from({ length }, () => alphabet[next() % alphabet.length]).join(next() % 2 ? " " : "");
		assert.doesNotThrow(() => m.parseSearch(query), query);
	}
	assert.doesNotThrow(() => m.parseSearch(null));
	assert.doesNotThrow(() => m.parseSearch(undefined));
});

test("length, leaf count and nesting depth are capped", () => {
	const long = m.parseSearch("a ".repeat(m.SEARCH_MAX_QUERY_LENGTH));
	assert.equal(long.limited, true);
	const many = m.parseSearch(Array.from({ length: m.SEARCH_MAX_LEAVES + 5 }, (_, index) => `w${index}`).join(" "));
	assert.equal(many.limited, true);
	assert.equal(many.root.children.length, m.SEARCH_MAX_LEAVES);
	assert.equal(m.parseSearch("a b c").limited, false);
	const deep = m.parseSearch(`${"(a OR ".repeat(40)}z${")".repeat(40)}`);
	const depth = (node) => node.kind === "and" || node.kind === "or" ? 1 + Math.max(...node.children.map(depth)) : node.kind === "not" ? 1 + depth(node.child) : 0;
	assert.ok(depth(deep.root) <= m.SEARCH_MAX_DEPTH + 1, `depth ${depth(deep.root)}`);
	assert.equal(deep.limited, false);
	assert.doesNotThrow(() => m.parseSearch("-".repeat(900) + "x"));
	assert.doesNotThrow(() => m.parseSearch("(".repeat(900)));
});

test("in: values named anywhere in the query lift the default Spam and Trash exclusion", () => {
	const names = (query) => [...m.searchFolderNames(m.parseSearch(query).root)].sort();
	assert.deepEqual(names("report"), []);
	assert.deepEqual(names("in:spam OR in:inbox"), ["inbox", "spam"]);
	assert.deepEqual(names("-in:trash"), ["trash"]);
	assert.deepEqual(names("(a OR in:anywhere)"), ["anywhere"]);
});

test("the flat projection of a top-level AND keeps the older parse shape", () => {
	const combined = m.parseSearchQuery("category:promotions from:x is:unread sale");
	assert.deepEqual([combined.category, combined.from, combined.read, combined.text], ["promotions", "x", "unread", "sale"]);
	assert.equal(combined.needsFullText, true);
	assert.equal(m.parseSearchQuery("category:promotions").needsFullText, false);
	assert.equal(m.parseSearchQuery("category:social").text, "category:social");
	assert.equal(m.parseSearchQuery('-newsletter "exact words" hello').text, '-newsletter "exact words" hello');
	assert.equal(m.parseSearchQuery("is:unread OR is:read").read, undefined, "a flag inside OR is not lifted");
	assert.equal(m.parseSearchQuery("-is:unread").read, undefined, "a negated flag is not lifted");
});
