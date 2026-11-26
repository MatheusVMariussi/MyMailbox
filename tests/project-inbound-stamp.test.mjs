import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-project-inbound-stamp-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./tests/helpers/sqlite-database.ts";
			export { applyMigrations } from "./tests/helpers/migrate.ts";
			export { processInboundMessage } from "./src/lib/email/inbound.ts";
		`,
		resolveDir: root,
		sourcefile: "project-inbound-stamp-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "next/headers": "next/headers.js", "next/server": "next/server.js", "cloudflare:workers": "./tests/helpers/cloudflare-workers.ts" },
	logLevel: "silent",
});
const m = await import(pathToFileURL(join(directory, "entry.mjs")).href);

function mime(to) {
	return `From: Friend <friend@x.test>\r\nTo: ${to}\r\nSubject: Hello\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x.test>\r\nDate: Thu, 19 Nov 2026 10:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nhi there\r\n`;
}

// One owner with four active domains. The mailbox `me` lives on one.test and, with use_all_domains, also receives
// me@ on the other domains. hello@two.test is an alias, three.test has a catch-all, four.test is mapped to nothing.
async function fixture(t) {
	const database = new m.SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await m.applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('admin', 'owner@one.test', 'hash', 'Owner', 'admin', 1, 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES
			('d-one', 'admin', 'one.test', 'z1', 'active', 1),
			('d-two', 'admin', 'two.test', 'z2', 'active', 1),
			('d-three', 'admin', 'three.test', 'z3', 'active', 1),
			('d-four', 'admin', 'four.test', 'z4', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('box', 'admin', 'd-one', 'me', 1);
		INSERT INTO mailbox_aliases (id, mailbox_id, domain_id, local_part, created_at) VALUES ('alias', 'box', 'd-two', 'hello', 1);
		INSERT INTO routing_rules (id, user_id, domain_id, mailbox_id, scope, pattern, match_value, action, created_at) VALUES ('catch', 'admin', 'd-three', 'box', 'domain', '*', '*', 'store', 1);
		INSERT INTO projects (id, user_id, name, color, created_at) VALUES
			('p-alpha', 'admin', 'Alpha', '#4f8cff', 1),
			('p-two', 'admin', 'Two', '#34d399', 1),
			('p-hello', 'admin', 'Hello desk', '#c084fc', 1),
			('p-three', 'admin', 'Three', '#fbbf24', 1);
		INSERT INTO project_addresses (id, project_id, domain_id, local_part, created_at) VALUES
			('a1', 'p-alpha', 'd-one', '', 1),
			('a2', 'p-two', 'd-two', '', 1),
			('a3', 'p-hello', 'd-two', 'hello', 1),
			('a4', 'p-three', 'd-three', '', 1);
	`);
	const objects = new Map();
	const env = {
		DB: database,
		BUCKET: { get: async (key) => (objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null), put: async () => {}, delete: async (key) => { objects.delete(key); } },
		REALTIME: { getByName: () => ({ fetch: async () => new Response(null, { status: 204 }) }) },
	};
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	const quiet = [console.info, console.warn];
	console.info = () => {};
	console.warn = () => {};
	t.after(() => { [console.info, console.warn] = quiet; });
	let n = 0;
	const deliver = async (envelopeTo, header = envelopeTo) => {
		const key = `raw/${++n}`;
		objects.set(key, new TextEncoder().encode(mime(header)).buffer);
		await m.processInboundMessage(env, { from: "bounce@x.test", to: envelopeTo, rawR2Key: key });
		const row = database.db.prepare("SELECT delivered_to, project_id, to_addr FROM messages WHERE raw_r2_key = ?").get(key);
		return row ? { ...row } : null;
	};
	return { deliver, raw: database.db };
}

test("direct mail is stamped with its envelope recipient and the domain's project", async (t) => {
	const { deliver } = await fixture(t);
	assert.deepEqual(await deliver("Me <ME@One.Test>", "me@one.test"), { delivered_to: "me@one.test", project_id: "p-alpha", to_addr: "me@one.test" });
});

test("an alias address beats the domain default", async (t) => {
	const { deliver } = await fixture(t);
	const row = await deliver("hello@two.test");
	assert.equal(row.delivered_to, "hello@two.test");
	assert.equal(row.project_id, "p-hello");
});

test("cross-domain implicit delivery uses the delivered domain, not the mailbox's own", async (t) => {
	const { deliver } = await fixture(t);
	const row = await deliver("me@two.test", "Me <me@one.test>, me@two.test");
	assert.equal(row.delivered_to, "me@two.test");
	assert.equal(row.project_id, "p-two");
});

test("a catch-all delivery takes the project of the address it was sent to", async (t) => {
	const { deliver } = await fixture(t);
	const row = await deliver("anything@three.test");
	assert.equal(row.delivered_to, "anything@three.test");
	assert.equal(row.project_id, "p-three");
});

test("an unmapped domain keeps the recipient and no project", async (t) => {
	const { deliver } = await fixture(t);
	assert.deepEqual(await deliver("me@four.test"), { delivered_to: "me@four.test", project_id: null, to_addr: "me@four.test" });
});

test("a failed project lookup still stores the message", async (t) => {
	const { deliver, raw } = await fixture(t);
	raw.exec("DROP TABLE project_addresses");
	const quiet = console.error;
	console.error = () => {};
	t.after(() => { console.error = quiet; });
	assert.deepEqual(await deliver("me@one.test"), { delivered_to: "me@one.test", project_id: null, to_addr: "me@one.test" });
});
