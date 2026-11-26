import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-contact-details-route-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./tests/helpers/sqlite-database.ts";
			export { applyMigrations } from "./tests/helpers/migrate.ts";
			export { createSession } from "./src/lib/auth/session.ts";
			export * as contactsRoute from "./src/app/api/contacts/route.ts";
		`,
		resolveDir: root,
		sourcefile: "contact-details-route-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true, platform: "node", format: "esm", target: "node24",
	tsconfig: join(root, "tsconfig.json"), packages: "external",
	alias: { "next/headers": "next/headers.js", "next/server": "next/server.js", "cloudflare:workers": "./tests/helpers/cloudflare-workers.ts" },
	logLevel: "silent",
});
const { SqliteDatabase, applyMigrations, createSession, contactsRoute } = await import(pathToFileURL(join(directory, "entry.mjs")).href);

async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const sql = database.db;
	const addUser = sql.prepare("INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'hash', ?, 'admin', 1)");
	for (const row of [["owner", "owner@one.test", "Owner"], ["manager", "manager@one.test", "Manager"], ["reader", "reader@one.test", "Reader"]]) addUser.run(...row);
	sql.exec(`
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('one', 'owner', 'one.test', 'zone-one', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, display_name, type, use_all_domains, disabled, created_at) VALUES
			('m-owner', 'owner', 'one', 'owner', 'Owner', 'personal', 0, 0, 1),
			('m-shared', 'owner', 'one', 'support', 'Support', 'shared', 0, 0, 1);
		INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES
			('a1', 'm-shared', 'manager', 'full_access', 1), ('a2', 'm-shared', 'reader', 'read_only', 1);
		INSERT INTO contacts (id, user_id, email, display_name, source, blocked, remote_content_allowed, created_at) VALUES ('owner:jane@x.test', 'owner', 'jane@x.test', 'Jane', 'manual', 0, 0, 1);
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, created_at) VALUES ('seen1', 'owner', 'm-shared', 'inbound', 'jane@x.test', 'shared@one.test', 'received', 1);
	`);
	const env = { DB: database, CF_TOKEN: "test-only" };
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	const sessions = new Map();
	for (const id of ["owner", "manager", "reader"]) sessions.set(id, await createSession(env, id));
	return (actor, mailboxId) => contactsRoute.GET(new Request(`https://mail.test/api/contacts?mailboxId=${mailboxId}&address=jane%40x.test`, { headers: { Authorization: `Bearer ${sessions.get(actor)}` } }));
}

test("the contact lookup returns the stored contact to the owner and to delegates of the shared mailbox", async (t) => {
	const get = await fixture(t);
	for (const [actor, mailbox] of [["owner", "m-owner"], ["owner", "m-shared"], ["manager", "m-shared"], ["reader", "m-shared"]]) {
		const response = await get(actor, mailbox);
		assert.equal(response.status, 200, `${actor} ${mailbox}`);
		const body = await response.json();
		assert.equal(body.contact.displayName, "Jane", `${actor} ${mailbox}`);
		assert.equal("details" in body.contact, false, `${actor} ${mailbox}`);
	}
});
