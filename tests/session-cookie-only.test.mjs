import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadApp } from "./helpers/real-db.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The web client authenticates with the HttpOnly session cookie only. The session token never reaches
 * page scripts (no JSON body, no localStorage) and a session token sent as a Bearer header is not a
 * credential, so every cookie-authenticated mutation goes through the same-origin check.
 */
const { app, newDatabase } = await loadApp("session-cookie-only", `
	export { getCurrentUser } from "./src/lib/auth/cookies.ts";
	export { createSession, getSessionTokenFromRequestHeaders } from "./src/lib/auth/session.ts";
	export { hasValidSessionMutationOrigin } from "./src/lib/auth/origin.ts";
	export { hashPassword } from "./src/lib/auth/password.ts";
	export * as login from "./src/app/api/auth/login/route.ts";
	export * as switchRoute from "./src/app/api/auth/switch/route.ts";
	export * as logout from "./src/app/api/auth/logout/route.ts";
`, {
	mocks: {
		"next/headers": "export async function cookies(){ const jar = globalThis.__cookieJar ?? {}; return { get: (name) => name in jar ? { value: jar[name] } : undefined }; }",
	},
});

const PASSWORD = "a-long-password";

async function fixture(t) {
	const { env, sqlite } = await newDatabase(t);
	const hash = app.hashPassword(PASSWORD);
	sqlite.prepare("INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('alice', 'alice@mail.test', ?, 'Alice', 'admin', 1), ('bob', 'bob@mail.test', ?, 'Bob', 'user', 1)").run(hash, hash);
	env.APP_URL = "https://mail.test";
	globalThis.__testEnv = env;
	globalThis.__cookieJar = {};
	t.after(() => { delete globalThis.__testEnv; delete globalThis.__cookieJar; });
	return { env, sqlite };
}

const sessionCookie = (response) => response.headers.getSetCookie().find((cookie) => cookie.startsWith("ep_session="));
const cookieValue = (cookie) => decodeURIComponent(cookie.split(";")[0].slice("ep_session=".length));

test("signing in sets the HttpOnly cookie and does not hand the token to the page", async (t) => {
	await fixture(t);
	const response = await app.login.POST(new Request("https://mail.test/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "https://mail.test" },
		body: JSON.stringify({ email: "alice@mail.test", password: PASSWORD }),
	}));
	assert.equal(response.status, 200);
	const cookie = sessionCookie(response);
	assert.ok(cookie, "a session cookie is set");
	assert.match(cookie, /HttpOnly/i);
	const token = cookieValue(cookie);
	const text = await response.text();
	assert.ok(!text.includes(token), "the response body does not contain the session token");
	const body = JSON.parse(text);
	assert.equal(body.token, undefined);
	assert.equal(body.authenticated, true);
});

test("a session token in a Bearer header is not a credential", async (t) => {
	const { env } = await fixture(t);
	const token = await app.createSession(env, "alice");
	const bearer = new Request("https://mail.test/api/x", { headers: { Authorization: `Bearer ${token}` } });
	assert.equal(await app.getCurrentUser(env, bearer), null);
	assert.equal(app.getSessionTokenFromRequestHeaders(bearer), undefined);
	const cookie = new Request("https://mail.test/api/x", { headers: { Cookie: `ep_session=${encodeURIComponent(token)}` } });
	assert.equal((await app.getCurrentUser(env, cookie))?.id, "alice");
	assert.equal(app.getSessionTokenFromRequestHeaders(cookie), token);
});

test("an Authorization header does not exempt a cookie mutation from the origin check", async (t) => {
	const { env } = await fixture(t);
	const token = await app.createSession(env, "alice");
	const headers = { Cookie: `ep_session=${token}`, Authorization: `Bearer ${token}` };
	const crossSite = new Request("https://mail.test/api/x", { method: "POST", headers });
	assert.equal(app.hasValidSessionMutationOrigin(crossSite), false);
	assert.equal(await app.getCurrentUser(env, crossSite), null);
	const sameOrigin = new Request("https://mail.test/api/x", { method: "POST", headers: { ...headers, Origin: "https://mail.test" } });
	assert.equal((await app.getCurrentUser(env, sameOrigin))?.id, "alice");
});

test("switching or signing out of an account does not return a session token", async (t) => {
	const { env } = await fixture(t);
	const alice = await app.createSession(env, "alice");
	const bob = await app.createSession(env, "bob");
	globalThis.__cookieJar = { ep_session: alice, ep_accounts: `${alice}.${bob}` };
	const switched = await app.switchRoute.POST(new Request("https://mail.test/api/auth/switch", {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "https://mail.test" },
		body: JSON.stringify({ userId: "bob" }),
	}));
	assert.equal(switched.status, 200);
	const switchedText = await switched.text();
	assert.ok(!switchedText.includes(bob) && !switchedText.includes(alice), switchedText);
	assert.equal(cookieValue(sessionCookie(switched)), bob);

	globalThis.__cookieJar = { ep_session: bob, ep_accounts: `${alice}.${bob}` };
	const loggedOut = await app.logout.POST(new Request("https://mail.test/api/auth/logout", {
		method: "POST",
		headers: { Origin: "https://mail.test", Cookie: `ep_session=${bob}` },
	}));
	assert.equal(loggedOut.status, 200);
	const loggedOutText = await loggedOut.text();
	assert.ok(!loggedOutText.includes(alice), loggedOutText);
	assert.equal(JSON.parse(loggedOutText).switched, true);
	assert.equal(cookieValue(sessionCookie(loggedOut)), alice);
});

// The browser module: nothing about the session is kept where page scripts can read it.
const clientDirectory = mkdtempSync(join(root, "node_modules", "session-cookie-only-client-"));
after(() => rmSync(clientDirectory, { recursive: true, force: true }));
await build({
	stdin: { contents: `export * from "./src/lib/auth/client.ts";`, resolveDir: root, sourcefile: "session-client-entry.ts" },
	outfile: join(clientDirectory, "client.mjs"),
	bundle: true,
	platform: "neutral",
	format: "esm",
	target: "es2022",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});

function installBrowser() {
	const store = new Map([["mymailbox-session-token", "sess_stale_token_from_an_older_build"]]);
	globalThis.localStorage = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => { store.set(key, String(value)); },
		removeItem: (key) => { store.delete(key); },
	};
	globalThis.window = { dispatchEvent: () => true, location: { assign: () => {} } };
	return store;
}

test("the web client keeps no session token in storage and sends no Bearer header", async (t) => {
	const store = installBrowser();
	t.after(() => { delete globalThis.localStorage; delete globalThis.window; });
	const client = await import(`${pathToFileURL(join(clientDirectory, "client.mjs")).href}?case=storage`);
	assert.equal(store.has("mymailbox-session-token"), false, "the token an older build stored is removed on load");

	const response = new Response(JSON.stringify({ ok: true, authenticated: true, redirect: "/inbox" }), { headers: { "Content-Type": "application/json" } });
	await client.persistAuthSession(response);
	assert.equal(client.getAuthHeaders().has("Authorization"), false);
	const key = client.getClientSessionKey();
	assert.ok(key, "a signed-in browser has a session key for its caches");
	assert.ok(!key.startsWith("sess_"));

	client.clearClientSession();
	assert.equal(client.getClientSessionKey(), null);
	assert.ok([...store.values()].every((value) => !String(value).startsWith("sess_")));
});
