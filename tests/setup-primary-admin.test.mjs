import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Setup is closed once one primary admin exists. The database enforces that there is only one, a
 * database error while looking for it keeps setup closed, and a failed domain step after the admin
 * was created does not reopen setup.
 */
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-setup-primary-admin-"));
after(() => rmSync(directory, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./tests/helpers/sqlite-database.ts";
			export { applyMigrations } from "./tests/helpers/migrate.ts";
			export { hasAdminAccount } from "./src/lib/auth/setup.ts";
			export { POST as register } from "./src/app/api/auth/register/route.ts";
		`,
		resolveDir: root,
		sourcefile: "setup-primary-admin-entry.ts",
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

const { SqliteDatabase, applyMigrations, hasAdminAccount, register } = await import(pathToFileURL(join(directory, "entry.mjs")).href);

const SETUP_TOKEN = "setup-token-for-tests";

function registration(body) {
	return register(new Request("https://mail.example.com/api/auth/register", {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "https://mail.example.com", "X-MyMailbox-Setup-Token": SETUP_TOKEN },
		body: JSON.stringify({ password: "a-long-password", resetEmail: "owner@elsewhere.test", skipDns: true, ...body }),
	}));
}

async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const env = { DB: database, EMAIL: { configured: true }, SETUP_TOKEN };
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	t.mock.method(globalThis, "fetch", async (url) => { throw new Error(`unexpected fetch ${url}`); });
	return { database, env, sqlite: database.db };
}

test("the database refuses a second primary admin", async (t) => {
	const { sqlite } = await fixture(t);
	sqlite.prepare("INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('a', 'a@x.test', 'h', 'A', 'admin', 1, 1)").run();
	assert.throws(
		() => sqlite.prepare("INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('b', 'b@x.test', 'h', 'B', 'admin', 1, 1)").run(),
		/UNIQUE constraint failed/,
	);
	// Ordinary accounts and admins that are not primary are unaffected.
	sqlite.prepare("INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('c', 'c@x.test', 'h', 'C', 'admin', 0, 1), ('d', 'd@x.test', 'h', 'D', 'user', 0, 1)").run();
	// Handing the role over (step down first, as transfer-primary does) still works.
	sqlite.prepare("UPDATE users SET is_primary_admin = 0 WHERE id = 'a'").run();
	sqlite.prepare("UPDATE users SET is_primary_admin = 1 WHERE id = 'c'").run();
});

test("concurrent first registrations leave exactly one primary admin", async (t) => {
	const { sqlite, env } = await fixture(t);
	// Hold both requests at the Turnstile check, which runs after "is there an admin yet?" and before the
	// insert, so both have seen an open setup before either writes.
	env.TURNSTILE_SECRET_KEY = "turnstile-secret";
	let arrived = 0;
	let release;
	const barrier = new Promise((resolve) => { release = resolve; });
	globalThis.fetch.mock.mockImplementation(async () => {
		arrived += 1;
		if (arrived === 2) release();
		await barrier;
		return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
	});
	const responses = await Promise.all([
		registration({ domain: "one.test", username: "first", turnstileToken: "ok" }),
		registration({ domain: "two.test", username: "second", turnstileToken: "ok" }),
	]);
	const statuses = responses.map((response) => response.status).sort();
	assert.deepEqual(statuses, [200, 403]);
	assert.equal(sqlite.prepare("SELECT count(*) AS count FROM users WHERE is_primary_admin = 1").get().count, 1);
	assert.equal(sqlite.prepare("SELECT count(*) AS count FROM users").get().count, 1);
});

test("setup reads as closed when the admin lookup fails", async (t) => {
	t.mock.method(console, "error", () => {});
	const failing = {
		prepare() {
			const statement = {
				bind: () => statement,
				all: async () => { throw new Error("D1_ERROR: Network connection lost."); },
				raw: async () => { throw new Error("D1_ERROR: Network connection lost."); },
				first: async () => { throw new Error("D1_ERROR: Network connection lost."); },
				run: async () => { throw new Error("D1_ERROR: Network connection lost."); },
			};
			return statement;
		},
	};
	assert.equal(await hasAdminAccount({ DB: failing }), true);
});

test("a missing users table is open only on a database with no other tables", async (t) => {
	const empty = new SqliteDatabase(":memory:");
	t.after(() => empty.db.close());
	assert.equal(await hasAdminAccount({ DB: empty }), false);
	// The ledger exists but nothing was applied: still a fresh install.
	empty.db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
	assert.equal(await hasAdminAccount({ DB: empty }), false);

	t.mock.method(console, "error", () => {});
	const damaged = new SqliteDatabase(":memory:");
	t.after(() => damaged.db.close());
	damaged.db.exec("CREATE TABLE mailboxes (id TEXT PRIMARY KEY)");
	assert.equal(await hasAdminAccount({ DB: damaged }), true);
});

test("a failed domain step keeps the new admin and setup closed", async (t) => {
	const { sqlite } = await fixture(t);
	t.mock.method(console, "warn", () => {});
	// Another (non-admin) account already holds the hostname, so adding the domain fails.
	sqlite.exec(`
		INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('other', 'other@x.test', 'h', 'Other', 'user', 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('dom-other', 'other', 'taken.test', 'manual', 'active', 1);
	`);
	const failed = await registration({ domain: "taken.test", username: "owner" });
	const body = await failed.json();
	assert.ok(failed.status >= 400, JSON.stringify(body));
	assert.equal(body.accountCreated, true);
	assert.equal(body.redirect, "/login");
	const admin = sqlite.prepare("SELECT id, role, is_primary_admin FROM users WHERE email = 'owner@taken.test'").get();
	assert.ok(admin, "the admin account is kept");
	assert.equal(admin.is_primary_admin, 1);
	assert.equal(sqlite.prepare("SELECT count(*) AS count FROM domains WHERE user_id = ?").get(admin.id).count, 0);
	assert.equal(sqlite.prepare("SELECT count(*) AS count FROM mailboxes WHERE user_id = ?").get(admin.id).count, 0);

	const retry = await registration({ domain: "free.test", username: "intruder" });
	assert.equal(retry.status, 403);
});
