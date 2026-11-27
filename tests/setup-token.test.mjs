import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * First-run setup provisions DNS with the owner's Cloudflare token, so every setup and registration
 * route needs the deploy-time SETUP_TOKEN secret. Without it, setup refuses to run anywhere but a
 * local development host.
 */
const directory = mkdtempSync(join(root, "node_modules", "mymailbox-setup-token-"));
after(() => rmSync(directory, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./tests/helpers/sqlite-database.ts";
			export { applyMigrations } from "./tests/helpers/migrate.ts";
			export { POST as prepare } from "./src/app/api/setup/prepare/route.ts";
			export { GET as status } from "./src/app/api/setup/status/route.ts";
			export { POST as setupDomain } from "./src/app/api/setup/domain/route.ts";
			export { POST as setupMx } from "./src/app/api/setup/domain/mx/route.ts";
			export { POST as register } from "./src/app/api/auth/register/route.ts";
		`,
		resolveDir: root,
		sourcefile: "setup-token-entry.ts",
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

const routes = await import(pathToFileURL(join(directory, "entry.mjs")).href);
const { SqliteDatabase, applyMigrations } = routes;

const TOKEN = "correct-horse-battery-staple-setup";
const registration = { domain: "example.com", username: "owner", password: "a-long-password", resetEmail: "owner@elsewhere.test", skipDns: true };

function request(path, { host = "mail.example.com", token, body } = {}) {
	const headers = { "Content-Type": "application/json", Origin: `https://${host}` };
	if (token !== undefined) headers["X-MyMailbox-Setup-Token"] = token;
	return new Request(`https://${host}${path}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function fixture(t, extraEnv = {}) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const env = { DB: database, EMAIL: { configured: true }, SETUP_TOKEN: TOKEN, ...extraEnv };
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	t.mock.method(globalThis, "fetch", async (url) => {
		throw new Error(`Cloudflare must not be contacted: ${url}`);
	});
	const userCount = () => database.db.prepare("SELECT count(*) AS count FROM users").get().count;
	return { database, env, userCount };
}

test("every setup route refuses a request without the setup token", async (t) => {
	const f = await fixture(t);
	const calls = [
		() => routes.prepare(request("/api/setup/prepare")),
		() => routes.setupDomain(request("/api/setup/domain", { body: { hostname: "example.com", skipDns: true } })),
		() => routes.setupMx(request("/api/setup/domain/mx", { body: { hostname: "example.com", skipDns: true } })),
		() => routes.register(request("/api/auth/register", { body: registration })),
	];
	for (const call of calls) {
		const response = await call();
		const body = await response.json();
		assert.equal(response.status, 401, JSON.stringify(body));
		assert.equal(body.code, "setup_token_required");
	}
	assert.equal(f.userCount(), 0);
});

test("a wrong setup token is refused and creates no account", async (t) => {
	const f = await fixture(t);
	for (const token of ["wrong", `${TOKEN}x`, TOKEN.slice(0, -1)]) {
		const response = await routes.register(request("/api/auth/register", { token, body: registration }));
		const body = await response.json();
		assert.equal(response.status, 401);
		assert.equal(body.code, "setup_token_invalid");
	}
	assert.equal(f.userCount(), 0);
});

test("the right setup token lets setup and registration run", async (t) => {
	const f = await fixture(t);
	const domain = await routes.setupDomain(request("/api/setup/domain", { token: TOKEN, body: { hostname: "example.com", skipDns: true } }));
	assert.equal(domain.status, 200, JSON.stringify(await domain.clone().json()));
	const registered = await routes.register(request("/api/auth/register", { token: TOKEN, body: registration }));
	assert.equal(registered.status, 200, JSON.stringify(await registered.clone().json()));
	assert.equal(f.userCount(), 1);
});

test("without SETUP_TOKEN, setup is refused on a public host with operator instructions", async (t) => {
	const f = await fixture(t, { SETUP_TOKEN: undefined });
	for (const call of [
		() => routes.prepare(request("/api/setup/prepare")),
		() => routes.register(request("/api/auth/register", { token: "anything", body: registration })),
	]) {
		const response = await call();
		const body = await response.json();
		assert.equal(response.status, 503);
		assert.equal(body.code, "setup_token_unset");
		assert.match(body.error, /wrangler secret put SETUP_TOKEN/);
	}
	assert.equal(f.userCount(), 0);
});

test("without SETUP_TOKEN, a local development host may still run setup", async (t) => {
	const f = await fixture(t, { SETUP_TOKEN: undefined });
	for (const host of ["localhost:3000", "127.0.0.1:3000"]) {
		const response = await routes.setupDomain(request("/api/setup/domain", { host, body: { hostname: "example.com", skipDns: true } }));
		assert.equal(response.status, 200, `${host}: ${JSON.stringify(await response.clone().json())}`);
	}
	const registered = await routes.register(request("/api/auth/register", { host: "localhost:3000", body: registration }));
	assert.equal(registered.status, 200, JSON.stringify(await registered.clone().json()));
	assert.equal(f.userCount(), 1);
});

test("the public setup status names no domain; only the token-gated prepare step does", async (t) => {
	const f = await fixture(t, { CF_TOKEN: "token" });
	const status = async () => {
		const response = await routes.status(new Request("https://mail.example.com/api/setup/status"));
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("Cache-Control"), "no-store");
		return response.json();
	};
	assert.deepEqual(await status(), { hasAdminAccount: false, hasPrimaryDomain: false });

	// A setup interrupted after its domain step: the domain exists, no admin does yet.
	f.database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'someone@example.com', 'hash', 'Someone', 'user', 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, sending_requested, created_at) VALUES ('d1', 'u1', 'example.com', 'z1', 'active', 1, 1);
	`);
	const publicBody = await status();
	assert.deepEqual(publicBody, { hasAdminAccount: false, hasPrimaryDomain: true });
	assert.doesNotMatch(JSON.stringify(publicBody), /example\.com/);

	const refused = await routes.prepare(request("/api/setup/prepare"));
	assert.equal(refused.status, 401);
	assert.doesNotMatch(await refused.text(), /example\.com/);
	const prepared = await routes.prepare(request("/api/setup/prepare", { token: TOKEN }));
	const body = await prepared.json();
	assert.equal(prepared.status, 200, JSON.stringify(body));
	assert.deepEqual(body.primaryDomain, { hostname: "example.com", sendingRequested: true });
});

test("registration spends the per-IP login budget", async (t) => {
	const keys = [];
	const f = await fixture(t, { LOGIN_RATE_LIMIT: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } });
	const response = await routes.register(request("/api/auth/register", { token: TOKEN, body: registration }));
	assert.equal(response.status, 429);
	assert.equal(keys.length, 1);
	assert.equal(f.userCount(), 0);
});

test("a failed database preparation does not echo the database error", async (t) => {
	// An empty D1 whose statements fail with internal detail: the users table is missing (fresh install), and
	// creating the migration ledger fails.
	const statement = (sql) => {
		const fail = () => {
			if (/\busers\b/.test(sql)) throw new Error("D1_ERROR: no such table: users: SQLITE_ERROR");
			if (/sqlite_master/.test(sql)) return null;
			throw new Error("D1_ERROR: internal detail /var/secret/path SQLITE_IOERR");
		};
		const prepared = {
			bind: () => prepared,
			first: async () => fail(),
			all: async () => (/sqlite_master/.test(sql) ? { results: [] } : fail()),
			raw: async () => (/sqlite_master/.test(sql) ? [] : fail()),
			run: async () => fail(),
		};
		return prepared;
	};
	const db = { prepare: statement, batch: async () => { throw new Error("D1_ERROR: internal detail /var/secret/path"); } };
	globalThis.__testEnv = { DB: db, CF_TOKEN: "token", SETUP_TOKEN: TOKEN };
	t.after(() => { delete globalThis.__testEnv; });
	t.mock.method(console, "error", () => {});
	const response = await routes.prepare(request("/api/setup/prepare", { token: TOKEN }));
	const text = await response.text();
	assert.equal(response.status, 500);
	assert.doesNotMatch(text, /secret|SQLITE|D1_ERROR/i);
});
