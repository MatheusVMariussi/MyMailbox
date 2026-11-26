import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

// Every search operator on the real schema (`buildSearchFilter` → `compileSearchTree`): relative dates against a
// fixed now, sizes, labels across mailboxes, projects by name, and NULL-safe negation of column predicates.
const { app, newDatabase } = await loadApp("search-conditions", `
	export { and, inArray } from "drizzle-orm";
	export { messages } from "./src/db/schema/index.ts";
	export { buildSearchFilter } from "./src/lib/search/service.ts";
	export { searchScopeExclusion, buildSearchConditions } from "./src/lib/search/conditions.ts";
`);

const NOW = new Date(Date.UTC(2026, 10, 26, 12, 0, 0));
const DAY = 86_400;
const ago = (days) => Math.floor(NOW.getTime() / 1000) - days * DAY;
const seed = `
	INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
		('u1', 'me@example.com', 'h', 'Me', 'admin', 1),
		('u2', 'other@example.com', 'h', 'Other', 'user', 1);
	INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d1', 'u1', 'example.com', 'z', 'active', 1);
	INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES
		('mb1', 'u1', 'd1', 'me', 'personal', 1),
		('mb2', 'u1', 'd1', 'team', 'personal', 1);
	INSERT INTO projects (id, user_id, name, color, sort_order, created_at) VALUES
		('p1', 'u1', 'Side Project', '#4f8cff', 0, 1),
		('p2', 'u1', 'Acme', '#34d399', 1, 1),
		('p3', 'u2', 'Acme', '#34d399', 0, 1);
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, bcc_addr, subject, text_body, status, read, starred, category, snoozed_until, delivered_to, project_id, size_bytes, created_at) VALUES
		('m-inbox', 'u1', 'mb1', 'inbound', 'ana@x.test', 'sales@example.com', NULL, 'Quarterly report', 'numbers attached', 'received', 0, 1, NULL, NULL, 'sales@example.com', 'p1', 5000, ${ago(1)}),
		('m-promo', 'u1', 'mb1', 'inbound', 'deals@shop.test', 'me@example.com', NULL, 'Big sale', 'discounts', 'received', 1, 0, 'promotions', NULL, 'me@example.com', NULL, 800, ${ago(10)}),
		('m-sent', 'u1', 'mb1', 'outbound', 'me@example.com', 'bob@x.test', 'boss@x.test', 'Re: Quarterly report', 'see attached', 'sent', 1, 0, NULL, NULL, NULL, 'p1', 2048, ${ago(2)}),
		('m-draft', 'u1', 'mb1', 'outbound', 'me@example.com', 'bob@x.test', NULL, 'Draft idea', 'tbd', 'draft', 1, 0, NULL, NULL, NULL, NULL, 0, ${ago(3)}),
		('m-archived', 'u1', 'mb2', 'inbound', 'carol@y.test', 'team@example.com', NULL, 'Trip photos', 'look', 'archived', 1, 0, NULL, NULL, 'team@example.com', 'p2', ${3 * 1024 * 1024}, ${ago(40)}),
		('m-snoozed', 'u1', 'mb2', 'inbound', 'dan@y.test', 'team@example.com', NULL, 'Later', 'remind me', 'received', 0, 0, NULL, ${ago(-1)}, 'team@example.com', NULL, 100, ${ago(5)}),
		('m-spam', 'u1', 'mb1', 'inbound', 'win@scam.test', 'me@example.com', NULL, 'Win money', 'now', 'spam', 1, 0, NULL, NULL, 'me@example.com', NULL, 0, ${ago(1)}),
		('m-trash', 'u1', 'mb2', 'inbound', 'eve@y.test', 'team@example.com', NULL, 'Old stuff', 'bye', 'trash', 1, 0, NULL, NULL, 'team@example.com', 'p3', 0, ${ago(400)});
	INSERT INTO message_attachments (id, message_id, filename, content_type, size, disposition, r2_key, created_at) VALUES
		('a1', 'm-inbox', 'Report-Q3.PDF', 'application/pdf', 4000, 'attachment', 'k1', 1),
		('a2', 'm-archived', 'photo_1.jpg', 'image/jpeg', 3000000, 'inline', 'k2', 1);
	INSERT INTO labels (id, user_id, mailbox_id, name, color, created_at) VALUES
		('l1', 'u1', 'mb1', 'Client Work', '#2563eb', 1),
		('l2', 'u1', 'mb2', 'client-work', '#2563eb', 1),
		('l3', 'u1', 'mb1', 'Personal', '#2563eb', 1);
	INSERT INTO message_labels (message_id, label_id) VALUES ('m-inbox', 'l1'), ('m-archived', 'l2'), ('m-sent', 'l3');
`;
const ALL = ["m-archived", "m-draft", "m-inbox", "m-promo", "m-sent", "m-snoozed", "m-spam", "m-trash"];
const except = (...ids) => ALL.filter((id) => !ids.includes(id));

async function setup(t) {
	const fixture = await newDatabase(t, seed);
	const search = async (query, { mailboxIds = ["mb1", "mb2"], timeZone = "UTC" } = {}) => {
		const filter = await app.buildSearchFilter(fixture.db, { query, timeZone, now: NOW }, { mailboxIds, userId: "u1" });
		const where = app.and(app.inArray(app.messages.mailboxId, mailboxIds), ...(filter.condition ? [filter.condition] : []));
		return (await fixture.db.select({ id: app.messages.id }).from(app.messages).where(where)).map((row) => row.id).sort();
	};
	return { ...fixture, search };
}

test("text and field operators", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("quarterly"), ["m-inbox", "m-sent"]);
	assert.deepEqual(await search("from:ana"), ["m-inbox"]);
	assert.deepEqual(await search("bcc:boss"), ["m-sent"]);
	assert.deepEqual(await search("to:bob"), ["m-draft", "m-sent"]);
	assert.deepEqual(await search('subject:"quarterly report"'), ["m-inbox", "m-sent"]);
	assert.deepEqual(await search("!!!"), ALL, "nothing indexable filters nothing");
});

test("attachments, flags and folders", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("has:attachment"), ["m-inbox"], "inline images are not attachments");
	assert.deepEqual(await search("filename:pdf"), ["m-inbox"]);
	assert.deepEqual(await search("filename:report-q3"), ["m-inbox"]);
	assert.deepEqual(await search("filename:photo_"), ["m-archived"], "an underscore is a plain character");
	assert.deepEqual(await search("is:unread"), ["m-inbox", "m-snoozed"]);
	assert.deepEqual(await search("is:read"), except("m-inbox", "m-snoozed"));
	assert.deepEqual(await search("is:starred"), ["m-inbox"]);
	assert.deepEqual(await search("is:snoozed"), ["m-snoozed"]);
	assert.deepEqual(await search("in:inbox"), ["m-inbox", "m-promo"], "Inbox includes promotions and leaves snoozed mail out");
	assert.deepEqual(await search("in:sent"), ["m-sent"]);
	assert.deepEqual(await search("in:drafts"), ["m-draft"]);
	assert.deepEqual(await search("in:archive"), ["m-archived"]);
	assert.deepEqual(await search("in:spam"), ["m-spam"]);
	assert.deepEqual(await search("in:trash"), ["m-trash"]);
	assert.deepEqual(await search("in:snoozed"), ["m-snoozed"]);
	assert.deepEqual(await search("in:anywhere"), ALL);
	assert.deepEqual(await search("category:promotions"), ["m-promo"]);
	assert.deepEqual(await search("category:primary"), except("m-promo"));
});

test("labels match same-named labels across the searched mailboxes", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("label:client-work"), ["m-archived", "m-inbox"]);
	assert.deepEqual(await search('label:"CLIENT WORK"'), ["m-archived", "m-inbox"]);
	assert.deepEqual(await search("label:client-work", { mailboxIds: ["mb1"] }), ["m-inbox"], "a single-mailbox scope keeps its own label");
	assert.deepEqual(await search("label:personal"), ["m-sent"]);
	assert.deepEqual(await search("label:nope"), [], "an unknown label matches nothing");
	assert.deepEqual(await search("label:personal OR label:client-work"), ["m-archived", "m-inbox", "m-sent"]);
});

test("projects match the user's own project by name", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("project:side-project"), ["m-inbox", "m-sent"]);
	assert.deepEqual(await search('project:"SIDE PROJECT"'), ["m-inbox", "m-sent"]);
	assert.deepEqual(await search("project:acme"), ["m-archived"], "another user's project of the same name does not count");
	assert.deepEqual(await search("project:nope"), []);
});

test("delivered-to matches the whole address exactly, a fragment anywhere", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("deliveredto:Sales@Example.com"), ["m-inbox"]);
	assert.deepEqual(await search("deliveredto:me@example.com"), ["m-promo", "m-spam"]);
	assert.deepEqual(await search("deliveredto:@example.com"), ["m-archived", "m-inbox", "m-promo", "m-snoozed", "m-spam", "m-trash"]);
});

test("absolute and relative dates", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("after:2026-11-23"), ["m-draft", "m-inbox", "m-sent", "m-spam"]);
	assert.deepEqual(await search("before:2026-11-01"), ["m-archived", "m-trash"]);
	assert.deepEqual(await search("newer_than:7d"), ["m-draft", "m-inbox", "m-sent", "m-snoozed", "m-spam"]);
	assert.deepEqual(await search("newer_than:1w"), ["m-draft", "m-inbox", "m-sent", "m-snoozed", "m-spam"]);
	assert.deepEqual(await search("older_than:1m"), ["m-archived", "m-trash"]);
	assert.deepEqual(await search("older_than:1y"), ["m-trash"]);
	assert.deepEqual(await search("newer_than:2d older_than:1d"), ["m-sent"]);
});

test("sizes are 1024-based and an unknown size is never smaller", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("larger:1K"), ["m-archived", "m-inbox", "m-sent"]);
	assert.deepEqual(await search("larger:2K"), ["m-archived", "m-inbox", "m-sent"]);
	assert.deepEqual(await search("larger:3M"), ["m-archived"]);
	assert.deepEqual(await search("smaller:1K"), ["m-promo", "m-snoozed"]);
	assert.deepEqual(await search("size:4K"), ["m-archived", "m-inbox"]);
});

test("combinations follow the tree", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("from:ana OR from:carol"), ["m-archived", "m-inbox"]);
	assert.deepEqual(await search('in:sent subject:"quarterly"'), ["m-sent"]);
	assert.deepEqual(await search("(label:personal OR has:attachment) -is:starred"), ["m-sent"]);
	assert.deepEqual(await search("quarterly -in:sent"), ["m-inbox"]);
	assert.deepEqual(await search("quarterly OR is:snoozed"), ["m-inbox", "m-sent", "m-snoozed"]);
	assert.deepEqual(await search("{in:spam in:trash} -from:eve"), ["m-spam"]);
});

test("negated column predicates keep rows whose column is null", async (t) => {
	const { search } = await setup(t);
	assert.deepEqual(await search("-category:promotions"), except("m-promo"));
	assert.deepEqual(await search("-category:primary"), ["m-promo"]);
	assert.deepEqual(await search("-is:snoozed"), except("m-snoozed"));
	assert.deepEqual(await search("-label:client-work"), except("m-inbox", "m-archived"));
	assert.deepEqual(await search("-label:nope"), ALL);
	assert.deepEqual(await search("-has:attachment"), except("m-inbox"));
	assert.deepEqual(await search("-filename:pdf"), except("m-inbox"));
	assert.deepEqual(await search("-project:acme"), except("m-archived"));
	assert.deepEqual(await search("-deliveredto:sales@example.com"), except("m-inbox"));
	assert.deepEqual(await search("-larger:1K"), except("m-archived", "m-inbox", "m-sent"));
	assert.deepEqual(await search("-in:inbox"), except("m-inbox", "m-promo"));
	assert.deepEqual(await search("-quarterly"), except("m-inbox", "m-sent"));
});

test("searches leave Spam and Trash out unless the query names them", async (t) => {
	const { db } = await setup(t);
	const scoped = async (query) => {
		const filter = await app.buildSearchFilter(db, { query, timeZone: "UTC", now: NOW }, { mailboxIds: ["mb1", "mb2"], userId: "u1" });
		const exclusion = app.searchScopeExclusion(filter.folders);
		const conditions = [filter.condition, exclusion].filter(Boolean);
		return (await db.select({ id: app.messages.id }).from(app.messages).where(app.and(...conditions))).map((row) => row.id).sort();
	};
	assert.deepEqual(await scoped("is:read"), ["m-archived", "m-draft", "m-promo", "m-sent"]);
	assert.deepEqual(await scoped("in:spam"), ["m-spam"]);
	assert.deepEqual(await scoped("in:trash OR quarterly"), ["m-inbox", "m-sent", "m-trash"]);
	assert.deepEqual(await scoped("in:anywhere is:read"), except("m-inbox", "m-snoozed"));
	assert.equal(app.searchScopeExclusion(new Set(["spam", "trash"])), null);
});

test("the plain string form keeps working for callers without names to resolve", async (t) => {
	const { db } = await setup(t);
	const ids = async (query) => (await db.select({ id: app.messages.id }).from(app.messages).where(app.and(...app.buildSearchConditions(query, "UTC")))).map((row) => row.id).sort();
	assert.deepEqual(await ids("category:promotions"), ["m-promo"]);
	assert.deepEqual(await ids("label:personal"), [], "unresolved labels match nothing");
});
