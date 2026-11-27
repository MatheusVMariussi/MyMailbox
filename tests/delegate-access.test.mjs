import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "delegate-access-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./tests/helpers/sqlite-database.ts";
			export { applyMigrations } from "./tests/helpers/migrate.ts";
			export { createSession, getUserFromSession } from "./src/lib/auth/session.ts";
			export * as contactsRoute from "./src/app/api/contacts/route.ts";
		`,
		resolveDir: root,
		sourcefile: "delegate-access-test-entry.ts",
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
const { SqliteDatabase, applyMigrations, createSession, getUserFromSession, contactsRoute } =
	await import(pathToFileURL(join(directory, "entry.mjs")).href);

// The primary admin owns a shared inbox; Sam is a member of it with the permission each test sets.
async function fixture(t, permission) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, avatar_key, created_at) VALUES
			('primary', 'owner@one.test', 'hash', 'Owner', 'admin', 'avatars/primary', 1),
			('sam', 'sam@one.test', 'hash', 'Sam', 'user', NULL, 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('one', 'primary', 'one.test', 'zone-one', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, display_name, type, use_all_domains, disabled, created_at) VALUES
			('m-owner', 'primary', 'one', 'owner', 'Owner', 'personal', 0, 0, 1),
			('m-sam', 'sam', 'one', 'sam', 'Sam', 'personal', 0, 0, 1),
			('m-shared', 'primary', 'one', 'support', 'Support', 'shared', 0, 0, 1);
		INSERT INTO contacts (id, user_id, email, display_name, avatar_key, source, created_at)
			VALUES ('c-owner', 'primary', 'owner@one.test', 'Owner', 'avatars/primary', 'manual', 1);
	`);
	database.db.prepare("INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_by_user_id, created_at) VALUES ('grant', 'm-shared', 'sam', ?, 'primary', 1)").run(permission);
	const deleted = [];
	const env = {
		DB: database, APP_URL: "https://mail.test",
		BUCKET: { async delete(keys) { deleted.push(...[keys].flat()); } },
	};
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	const token = await createSession(env, "sam");
	return {
		sql: database.db,
		env,
		deleted,
		sam: () => getUserFromSession(env, token),
		request: (path, method = "GET") => new Request(`https://mail.test${path}`, {
			method, headers: { Cookie: `ep_session=${token}`, Origin: "https://mail.test" },
		}),
	};
}

test("a shared-inbox manager cannot delete the owner's own contact or its avatar", async t => {
	const f = await fixture(t, "full_access");
	const response = await contactsRoute.DELETE(f.request("/api/contacts?mailboxId=m-shared&address=owner%40one.test", "DELETE"));
	assert.equal(response.status, 403);
	assert.deepEqual(f.deleted, []);
	assert.equal(f.sql.prepare("SELECT count(*) AS count FROM contacts WHERE id='c-owner'").get().count, 1);
});

test("a shared-inbox manager can still delete an ordinary contact", async t => {
	const f = await fixture(t, "full_access");
	f.sql.exec("INSERT INTO contacts (id, user_id, email, display_name, source, created_at) VALUES ('c-friend', 'primary', 'friend@example.net', 'Friend', 'inbound', 1)");
	const response = await contactsRoute.DELETE(f.request("/api/contacts?mailboxId=m-shared&address=friend%40example.net", "DELETE"));
	assert.equal(response.status, 200);
	assert.equal(f.sql.prepare("SELECT count(*) AS count FROM contacts WHERE id='c-friend'").get().count, 0);
});
