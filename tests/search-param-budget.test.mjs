import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

// Each compiled search reports the parameters it binds, and the compiler refuses a query past
// SEARCH_PARAM_BUDGET before it reaches D1 (100 bound parameters per statement).
const { app, newDatabase } = await loadApp("search-param-budget", `
	export { messages } from "./src/db/schema/index.ts";
	export { parseSearch } from "./src/lib/search/parser-utils.ts";
	export { compileSearchTree, SearchQueryError, SEARCH_PARAM_BUDGET } from "./src/lib/search/conditions.ts";
	export { buildSearchFilter } from "./src/lib/search/service.ts";
`);

const context = {
	now: new Date(Date.UTC(2026, 10, 26)),
	labelIds: new Map([["work", ["l1"]], ["shared", ["l1", "l2", "l3"]]]),
	projectIds: new Map([["acme", ["p1"]], ["twins", ["p1", "p2"]]]),
};

test("every operator declares exactly the parameters it binds", async (t) => {
	const { db } = await newDatabase(t);
	const queries = [
		"invoice", '"exact phrase"', "from:a to:b cc:c bcc:d subject:e", "a OR b", "-a", "a -b", "a OR -b", "(a OR b) -(c d)",
		"has:attachment", "filename:pdf", "is:unread", "is:read", "is:starred", "is:snoozed",
		"in:inbox", "in:sent", "in:drafts", "in:spam", "in:trash", "in:archive", "in:snoozed", "in:anywhere",
		"label:work", "label:shared", "label:missing", "project:acme", "project:twins", "project:missing",
		"deliveredto:a@b.test", "deliveredto:b.test", "category:promotions", "category:primary",
		"after:2026-01-01", "before:2026-01-01", "newer_than:2d", "older_than:1y", "larger:1M", "smaller:10K",
		"-category:promotions", "-label:work", "-is:snoozed", "-has:attachment", "-in:inbox",
		"from:x OR has:attachment", "(a OR in:sent) -label:work larger:1K", "{from:x label:work} -(b OR is:read)",
	];
	for (const query of queries) {
		const { condition, params } = app.compileSearchTree(app.parseSearch(query).root, context);
		const bound = db.select({ id: app.messages.id }).from(app.messages).where(condition).toSQL().params.length;
		assert.equal(params, bound, query);
		assert.doesNotThrow(() => db.select({ id: app.messages.id }).from(app.messages).where(condition).all(), query);
	}
});

test("text-only subtrees cost one parameter however many terms they hold", () => {
	const words = Array.from({ length: 50 }, (_, index) => (index % 3 === 0 ? `-w${index}` : index % 3 === 1 ? `w${index} OR` : `from:w${index}`)).join(" ");
	assert.equal(app.compileSearchTree(app.parseSearch(words).root, context).params, 1);
});

test("the worst valid query stays within the budget and one more parameter is refused", () => {
	const fill = (count) => Array.from({ length: count }, (_, index) => `larger:${index + 1}`).join(" ");
	assert.equal(app.compileSearchTree(app.parseSearch(fill(app.SEARCH_PARAM_BUDGET)).root, context).params, app.SEARCH_PARAM_BUDGET);
	assert.throws(
		() => app.compileSearchTree(app.parseSearch(fill(app.SEARCH_PARAM_BUDGET + 1)).root, context),
		(error) => error instanceof app.SearchQueryError && error.code === "budget" && /too complex/.test(error.message),
	);
});

test("a query cut at the length or leaf cap is refused, not silently widened", async (t) => {
	const { db } = await newDatabase(t);
	const scope = { mailboxIds: [], userId: "u1" };
	await assert.rejects(
		app.buildSearchFilter(db, { query: "a ".repeat(800), timeZone: "UTC" }, scope),
		(error) => error instanceof app.SearchQueryError && error.code === "limited",
	);
	await assert.rejects(
		app.buildSearchFilter(db, { query: Array.from({ length: 70 }, (_, index) => `w${index}`).join(" "), timeZone: "UTC" }, scope),
		(error) => error instanceof app.SearchQueryError && error.code === "limited",
	);
});
