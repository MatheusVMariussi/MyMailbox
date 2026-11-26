import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

// The web client's side of search: the list request sends the query whole with scope=search (no read-state
// lifting, so `is:unread` inside OR or a negation keeps its meaning), the box runs a query as you type only
// once it is settled, and the operator cheat sheet is translated.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(root, "node_modules", "mymailbox-search-client-"));
after(() => rmSync(temp, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { getMessageQueryParams } from "./src/hooks/utils.ts";
			export { getListMembershipContext } from "./src/lib/messages/list-membership.ts";
			export { isSearchQuerySettled, appendSearchOperator } from "./src/lib/search/input-utils.ts";
			export { SEARCH_HELP_ENTRIES } from "./src/components/mail-search/search-help-utils.ts";
		`,
		resolveDir: root,
		sourcefile: "entry.ts",
		loader: "ts",
	},
	outfile: join(temp, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	alias: { "@": join(root, "src") },
	packages: "external",
	external: ["react"],
	logLevel: "silent",
});
const u = await import(pathToFileURL(join(temp, "entry.mjs")).href);

test("a search sends the query whole with scope=search and no folder filters", () => {
	const params = u.getMessageQueryParams("inbox", "mb1", { query: "is:unread OR from:x", read: "all", projectId: "p1", group: "thread", limit: 25 });
	assert.equal(params.get("q"), "is:unread OR from:x");
	assert.equal(params.get("scope"), "search");
	assert.equal(params.get("read"), null, "is:unread is not lifted out of an OR");
	assert.equal(params.get("status"), null);
	assert.equal(params.get("direction"), null);
	assert.equal(params.get("mailboxId"), "mb1");
	assert.equal(params.get("projectId"), "p1");
	assert.equal(params.get("group"), "thread");
	assert.equal(u.getMessageQueryParams("sent", null, { query: "-is:read" }).get("q"), "-is:read");
	assert.equal(u.getMessageQueryParams("inbox", null, { query: "invoice" }, "l1,l2").get("labelId"), null, "a search leaves the label view");
	assert.equal(u.getMessageQueryParams("starred", null, { query: "invoice" }).get("starred"), null);
	assert.equal(u.getMessageQueryParams("inbox", null, { query: "invoice", read: "unread" }).get("read"), "unread", "the unread toggle still applies");
});

test("without a query the folder parameters are unchanged", () => {
	const params = u.getMessageQueryParams("inbox", "mb1", { query: "   ", read: "all" });
	assert.equal(params.get("scope"), null);
	assert.equal(params.get("q"), null);
	assert.equal(params.get("status"), "received");
	assert.equal(params.get("direction"), "inbound");
	assert.equal(u.getMessageQueryParams("inbox", null, {}, "l1").get("labelId"), "l1");
});

test("search lists are not filtered optimistically by a folder's membership", () => {
	assert.equal(u.getListMembershipContext(u.getMessageQueryParams("inbox", null, { query: "invoice" })), null);
	assert.deepEqual(u.getListMembershipContext(u.getMessageQueryParams("inbox", null, {})), { folder: "inbox" });
});

test("a query runs as you type only once it is settled", () => {
	for (const query of ["", "invoice", "from:ana", "a OR b", "(a OR b) c", '"exact words"', "-is:read", "label:x larger:1K"]) {
		assert.equal(u.isSearchQuerySettled(query), true, query);
	}
	for (const query of ["from:", "a OR", "a AND", "(a OR b", '"open phrase', "-", "a -", "a)", "{x y", "is:read from:"]) {
		assert.equal(u.isSearchQuerySettled(query), false, query);
	}
});

test("picking an operator from the cheat sheet appends it to the query", () => {
	assert.equal(u.appendSearchOperator("", "from:"), "from:");
	assert.equal(u.appendSearchOperator("invoice", "is:unread"), "invoice is:unread");
	assert.equal(u.appendSearchOperator("invoice  ", "has:attachment"), "invoice has:attachment");
});

test("every cheat-sheet entry is translated in English and Brazilian Portuguese", () => {
	const en = JSON.parse(readFileSync(join(root, "src/lib/i18n/en.json"), "utf8"));
	const ptBR = JSON.parse(readFileSync(join(root, "public/locales/pt-BR.json"), "utf8"));
	assert.ok(u.SEARCH_HELP_ENTRIES.length >= 10);
	const keys = [...u.SEARCH_HELP_ENTRIES.map((entry) => entry.descriptionKey), "search.help.open", "search.help.title", "search.help.enter", "search.results", "search.invalid"];
	for (const key of keys) {
		assert.equal(typeof en[key], "string", `en ${key}`);
		assert.equal(typeof ptBR[key], "string", `pt-BR ${key}`);
		assert.doesNotMatch(ptBR[key], /[—!]/, `pt-BR ${key} has no em dash or exclamation mark`);
	}
});
