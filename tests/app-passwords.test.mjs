import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-app-passwords-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
			export { generateAppPassword, generateApiKey } from "./src/lib/api-keys.ts";
			export { clearApiKeyVerificationCache } from "./src/lib/api/find-api-key.ts";
			export { authenticateApiRequest } from "./src/lib/api/key-auth.ts";
			export { availableAppPasswordProtocols, revokeAllAppPasswords } from "./src/lib/auth/app-passwords.ts";
			export { handleJmapRequest } from "./src/lib/jmap/handler.ts";
			export { appPasswordGuessKey } from "./src/lib/auth/app-passwords.ts";
			export { deleteUserSessions } from "./src/lib/auth/session.ts";
			export { API_KEY_SCOPES, APP_PASSWORD_PROTOCOLS } from "./src/lib/api/scopes.ts";
			export { SqliteDatabase } from "./tests/helpers/sqlite-database.ts";
			export { applyMigrations } from "./tests/helpers/migrate.ts";
		`,
		resolveDir: root,
		sourcefile: "app-passwords-entry.ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "cloudflare:workers": "./tests/helpers/cloudflare-workers.ts" },
	logLevel: "silent",
});

const {
	generateAppPassword,
	generateApiKey,
	clearApiKeyVerificationCache,
	authenticateApiRequest,
	availableAppPasswordProtocols,
	revokeAllAppPasswords,
	deleteUserSessions,
	handleJmapRequest,
	appPasswordGuessKey,
	API_KEY_SCOPES,
	APP_PASSWORD_PROTOCOLS,
	SqliteDatabase,
	applyMigrations,
} = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

async function fixture(t, extraEnv = {}) {
	clearApiKeyVerificationCache();
	const database = new SqliteDatabase(":memory:");
	t.after(() => {
		database.db.close();
		clearApiKeyVerificationCache();
	});
	await applyMigrations(database, join(root, "drizzle/migrations"));
	for (const id of ["u1", "u2"]) database.db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, 'User', 'x', 'user', 1)").run(id, `${id}@one.test`);
	return { database, env: { DB: database, ...extraEnv } };
}

async function addKey(database, { id, userId = "u1", kind = "app", scopes = ["jmap"], issued }) {
	const key = issued ?? (kind === "legacy" || kind === "mcp" || kind === "device" ? await generateApiKey() : await generateAppPassword());
	database.db
		.prepare("INSERT INTO api_keys (id, user_id, name, prefix, key_hash, key_sha256, kind, scopes, created_at) VALUES (?, ?, 'k', ?, ?, ?, ?, ?, 1)")
		.run(id, userId, key.prefix, key.hash, key.sha256, kind, JSON.stringify(scopes));
	return key;
}

const lastUsed = (database, id) => database.db.prepare("SELECT last_used_at, last_used_protocol, last_used_ip FROM api_keys WHERE id = ?").get(id);
const keyIds = (database) => database.db.prepare("SELECT id FROM api_keys ORDER BY id").all().map((row) => row.id);
const basic = (password, user = "me@example.test") => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const jmapAuth = (env, password, ip) => authenticateApiRequest(env, new Request("https://mail.example/jmap/api", { headers: { Authorization: basic(password), ...(ip ? { "cf-connecting-ip": ip } : {}) } }), "jmap");
const jmapSession = (env, password, headers = {}) => handleJmapRequest(new Request("https://mail.example/jmap/session", { headers: { Authorization: basic(password), ...headers } }), env);

test("app passwords speak JMAP only", () => {
	assert.deepEqual([...APP_PASSWORD_PROTOCOLS], ["jmap"]);
	assert.deepEqual(availableAppPasswordProtocols(), ["jmap"]);
	assert.equal(API_KEY_SCOPES.includes("jmap"), true);
});

test("the account password is never accepted", async (t) => {
	const { database, env } = await fixture(t);
	await addKey(database, { id: "mail" });
	database.db.prepare("UPDATE users SET password_hash = ? WHERE id = 'u1'").run("$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234");
	assert.equal(await jmapAuth(env, "correct horse battery"), null);
});

test("a disabled user's app password stops working", async (t) => {
	const { database, env } = await fixture(t);
	const key = await addKey(database, { id: "mail" });
	database.db.prepare("UPDATE users SET disabled = 1 WHERE id = 'u1'").run();
	assert.equal(await jmapAuth(env, key.fullKey), null);
});

test("last protocol and IP are recorded, at most once a minute", async (t) => {
	const { database, env } = await fixture(t);
	const key = await addKey(database, { id: "mail" });
	assert.deepEqual({ ...lastUsed(database, "mail") }, { last_used_at: null, last_used_protocol: null, last_used_ip: null });
	await jmapAuth(env, key.fullKey, "203.0.113.5");
	const first = lastUsed(database, "mail");
	assert.equal(first.last_used_protocol, "jmap");
	assert.equal(first.last_used_ip, "203.0.113.5");
	assert.ok(first.last_used_at);
	await jmapAuth(env, key.fullKey, "198.51.100.9");
	assert.deepEqual({ ...lastUsed(database, "mail") }, { ...first });
	database.db.prepare("UPDATE api_keys SET last_used_at = last_used_at - 120 WHERE id = 'mail'").run();
	await jmapAuth(env, key.fullKey, "198.51.100.9");
	assert.equal(lastUsed(database, "mail").last_used_ip, "198.51.100.9");
});

test("JMAP keeps accepting an app password and records the protocol", async (t) => {
	const { database, env } = await fixture(t);
	const key = await addKey(database, { id: "mail", scopes: ["jmap"] });
	const request = new Request("https://mail.example/jmap/api", { headers: { Authorization: basic(key.fullKey), "cf-connecting-ip": "203.0.113.7" } });
	const auth = await authenticateApiRequest(env, request, "jmap");
	assert.equal(auth?.keyId, "mail");
	assert.equal(auth?.keyKind, "app");
	assert.equal(lastUsed(database, "mail").last_used_protocol, "jmap");
	assert.equal(lastUsed(database, "mail").last_used_ip, "203.0.113.7");
});

test("the per-IP guess limiter runs only for a password this isolate has not verified", async (t) => {
	const calls = [];
	let allow = true;
	const limiter = { limit: async ({ key }) => { calls.push(key); return { success: allow }; } };
	const { database, env } = await fixture(t, { DEVICE_LOGIN_RATE_LIMIT: limiter });
	const key = await addKey(database, { id: "mail" });
	const ip = { "cf-connecting-ip": "203.0.113.5" };

	assert.equal((await jmapSession(env, key.fullKey, ip)).status, 200);
	assert.deepEqual(calls, ["app-auth:ip:203.0.113.5"]);
	assert.equal((await jmapSession(env, key.fullKey, ip)).status, 200);
	assert.equal(calls.length, 1, "a verified password skips the limiter");

	allow = false;
	assert.equal((await jmapSession(env, "guess-guess-guess", ip)).status, 429);
	assert.equal(calls.length, 2);
	assert.equal((await jmapSession(env, key.fullKey, ip)).status, 200, "the real client is not locked out by a guesser's bucket");
});

test("a limiter that throws does not lock everyone out", async (t) => {
	const { database, env } = await fixture(t, { DEVICE_LOGIN_RATE_LIMIT: { limit: async () => { throw new Error("down"); } } });
	const key = await addKey(database, { id: "mail" });
	assert.equal((await jmapSession(env, key.fullKey)).status, 200);
});

test("deleteUserSessions revokes app passwords and JMAP-only keys, and nothing else", async (t) => {
	const { database, env } = await fixture(t);
	await addKey(database, { id: "app-jmap", kind: "app", scopes: ["jmap"] });
	await addKey(database, { id: "old-jmap", kind: "legacy", scopes: ["jmap"] });
	await addKey(database, { id: "old-mixed", kind: "legacy", scopes: ["send", "jmap"] });
	await addKey(database, { id: "api-read", kind: "legacy", scopes: ["read", "send"] });
	await addKey(database, { id: "api-cal", kind: "legacy", scopes: ["calendar:read"] });
	await addKey(database, { id: "mcp", kind: "mcp", scopes: ["mcp:read"] });
	await addKey(database, { id: "other-app", userId: "u2", kind: "app", scopes: ["jmap"] });
	await addKey(database, { id: "other-jmap", userId: "u2", kind: "legacy", scopes: ["jmap"] });

	await deleteUserSessions(env, "u1");
	assert.deepEqual(keyIds(database), ["api-cal", "api-read", "mcp", "old-mixed", "other-app", "other-jmap"]);
});

test("revoking everything for a user with no keys is a no-op", async (t) => {
	const { database, env } = await fixture(t);
	await revokeAllAppPasswords(env, "u1");
	assert.deepEqual(keyIds(database), []);
});

test("a revoked app password stops working at once, even from a warm cache", async (t) => {
	const { database, env } = await fixture(t);
	const key = await addKey(database, { id: "mail" });
	assert.equal((await jmapAuth(env, key.fullKey))?.keyId, "mail");
	await deleteUserSessions(env, "u1");
	assert.equal(await jmapAuth(env, key.fullKey), null);
});

test("a mixed legacy key survives every password-related revocation; jmap-only and app keys do not", async (t) => {
	const { database, env } = await fixture(t);
	for (const [id, scopes] of [["send-jmap", ["send", "jmap"]], ["read-jmap", ["read", "jmap"]], ["wild", ["jmap", "calendar:read"]]]) await addKey(database, { id, kind: "legacy", scopes });
	await addKey(database, { id: "jmap-only", kind: "legacy", scopes: ["jmap"] });
	await addKey(database, { id: "app", kind: "app", scopes: ["jmap"] });
	await deleteUserSessions(env, "u1", "keep-this-session");
	assert.deepEqual(keyIds(database), ["read-jmap", "send-jmap", "wild"]);
});

test("2FA enable, passkey recovery, admin reset, v1 admin reset and password reset all revoke through deleteUserSessions", () => {
	for (const file of ["src/lib/auth/mfa.ts", "src/app/api/auth/passkey/setup/verify/route.ts", "src/app/api/accounts/[id]/route.ts", "src/app/api/v1/accounts/[id]/utils.ts", "src/lib/auth/password-reset.ts", "src/app/api/settings/password/route.ts"]) {
		assert.match(readFileSync(join(root, file), "utf8"), /deleteUserSessions\(/, file);
	}
});

test("the guess limiter buckets IPv6 by /64, maps IPv4-in-IPv6, and never shares an unknown bucket", () => {
	const key = (ip, secret = "abcdefghijklmnop") => appPasswordGuessKey(ip, secret);
	assert.equal(key("203.0.113.5"), "app-auth:ip:203.0.113.5");
	assert.equal(key("::ffff:203.0.113.5"), key("203.0.113.5"));
	assert.equal(key("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), key("2001:0db8:0001:0002::1"));
	assert.equal(key("[2001:DB8:1:2::9]"), key("2001:db8:1:2::1"));
	assert.notEqual(key("2001:db8:1:3::1"), key("2001:db8:1:2::1"));
	const noIpA = key(null, "AAAAzzzzzzzzzzzz");
	const noIpB = key(null, "BBBBzzzzzzzzzzzz");
	assert.notEqual(noIpA, noIpB);
	assert.equal(key(null, "AAAAzzyyyyyyyyyy"), noIpA, "guesses at one key share a bucket");
	assert.equal(noIpA.includes("unknown"), false);
	assert.equal(noIpA.includes("ip:"), false);
});

test("without an IP the limiter works per key instead of sharing one bucket", async (t) => {
	const calls = [];
	const limiter = { limit: async ({ key }) => { calls.push(key); return { success: !key.includes("ZZZZ") }; } };
	const { database, env } = await fixture(t, { DEVICE_LOGIN_RATE_LIMIT: limiter });
	const key = await addKey(database, { id: "mail" });
	assert.equal((await jmapSession(env, "ZZZZ-guess-guess")).status, 429);
	assert.equal((await jmapSession(env, key.fullKey)).status, 200, "another key's bucket is not spent");
	assert.equal(calls.length, 2);
	assert.notEqual(calls[0], calls[1]);
});

const jmapGet = (headers, url = "https://mail.example/jmap/session") => handleJmapRequest(new Request(url, { headers }), nodeEnv);
let nodeEnv;

test("JMAP Basic still works over plain HTTP, is rate limited, and Bearer is unaffected", async (t) => {
	const previous = process.env.TRUST_PROXY;
	delete process.env.TRUST_PROXY;
	t.after(() => { if (previous === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previous; });
	let allow = true;
	const calls = [];
	const limiter = { limit: async ({ key }) => { calls.push(key); return { success: allow }; } };
	const { database, env } = await fixture(t, { MAILFLARE_RUNTIME: "node", DEVICE_LOGIN_RATE_LIMIT: limiter });
	nodeEnv = env;
	const old = await addKey(database, { id: "old", kind: "legacy", scopes: ["send", "jmap"] });
	const plain = (auth) => ({ Authorization: auth, host: "mail.example.com", "x-mailflare-client-ip": "203.0.113.5" });
	// Plain HTTP Basic keeps working for existing clients (Docker/LAN), as before app passwords.
	const plainHttp = await jmapGet(plain(basic(old.fullKey)), "http://mail.example.com/jmap/session");
	assert.equal(plainHttp.status, 200);
	assert.equal(lastUsed(database, "old").last_used_protocol, "jmap");
	// Bearer is not Basic and keeps working.
	assert.equal((await jmapGet(plain(`Bearer ${old.fullKey}`), "http://mail.example.com/jmap/session")).status, 200);
	// Behind a trusted TLS proxy Basic works; a first sight of the secret spends the budget, later ones do not.
	clearApiKeyVerificationCache();
	process.env.TRUST_PROXY = "1";
	const proxied = { ...plain(basic(old.fullKey)), "x-forwarded-proto": "https" };
	assert.equal((await jmapGet(proxied, "http://mail.example.com/jmap/session")).status, 200);
	assert.equal((await jmapGet(proxied, "http://mail.example.com/jmap/session")).status, 200);
	assert.equal(calls.length, 2);
	allow = false;
	const guess = await jmapGet({ ...proxied, Authorization: basic("not-a-real-key-123") }, "http://mail.example.com/jmap/session");
	assert.equal(guess.status, 429);
	assert.equal((await jmapGet(proxied, "http://mail.example.com/jmap/session")).status, 200, "a verified secret is not throttled");
});
