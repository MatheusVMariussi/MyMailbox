import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * Password guesses are limited per account across every IP (sign-in and step-up share the budget),
 * unknown and passkey-only accounts still pay for a bcrypt comparison so timing does not tell them
 * apart, and the per-IP limiter refuses when its binding is missing in production.
 */
const { app, newDatabase } = await loadApp("password-attempts", `
	export * as login from "./src/app/api/auth/login/route.ts";
	export * as stepUp from "./src/app/api/auth/step-up/route.ts";
	export { createSession } from "./src/lib/auth/session.ts";
	export { allowLoginAttempt } from "./src/lib/auth/rate-limit.ts";
	export { allowAppPasswordGuess } from "./src/lib/auth/app-passwords.ts";
	export { generateTotpSecret } from "./src/lib/auth/totp.ts";
`, {
	mocks: {
		// completeLogin reads the request's cookie jar, which only exists inside Next's request scope.
		"next/headers": "export async function cookies(){ return { get: () => undefined }; }",
		// A fast, observable stand-in for bcrypt: every comparison is recorded with the hash it used.
		bcryptjs: `
			const hashSync = (password) => "$2mock$" + password;
			const compareSync = (password, hash) => { (globalThis.__bcryptCompares ??= []).push(hash); return hash === "$2mock$" + password; };
			export default { hashSync, compareSync };
			export { hashSync, compareSync };
		`,
	},
});

const PASSWORD = "the-right-password";
const ORIGIN = "https://mail.test";

async function fixture(t, env = {}) {
	const database = await newDatabase(t);
	database.sqlite.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
		('alice', 'alice@mail.test', ?, 'Alice', 'admin', 1),
		('pk', 'pk@mail.test', '!passkey-only', 'Passkey', 'user', 1)`).run(`$2mock$${PASSWORD}`);
	Object.assign(database.env, { APP_URL: ORIGIN }, env);
	globalThis.__testEnv = database.env;
	globalThis.__bcryptCompares = [];
	t.after(() => { delete globalThis.__testEnv; });
	let ip = 0;
	const login = (email, password) => app.login.POST(new Request(`${ORIGIN}/api/auth/login`, {
		method: "POST",
		// A new address every time: the per-account limit must hold however the guesses are spread.
		headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": `203.0.113.${(ip++ % 250) + 1}` },
		body: JSON.stringify({ email, password }),
	}));
	return { ...database, login };
}

test("wrong passwords are limited per account, across IPs", async (t) => {
	const f = await fixture(t);
	for (let index = 0; index < 10; index++) assert.equal((await f.login("alice@mail.test", `wrong-${index}`)).status, 401);
	const locked = await f.login("alice@mail.test", PASSWORD);
	assert.equal(locked.status, 429);
	assert.equal((await locked.json()).code, "rate_limited");
});

test("a correct password still signs in after a few wrong ones, and does not count", async (t) => {
	const f = await fixture(t);
	for (let index = 0; index < 3; index++) assert.equal((await f.login("alice@mail.test", "nope")).status, 401);
	assert.equal((await f.login("alice@mail.test", PASSWORD)).status, 200);
	const failures = f.sqlite.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'auth.password_failed'").get().count;
	assert.equal(failures, 3);
});

test("parallel guesses cannot outrun the per-account limit", async (t) => {
	const f = await fixture(t);
	const statuses = await Promise.all(Array.from({ length: 25 }, () => f.login("alice@mail.test", "parallel").then((response) => response.status)));
	// Every guess is logged before any is checked, so a burst may even be refused entirely.
	const checked = statuses.filter((status) => status === 401).length;
	assert.ok(checked <= 10, `${checked} passwords were checked`);
	assert.equal(checked + statuses.filter((status) => status === 429).length, 25);
});

test("unknown and passkey-only accounts still pay for a bcrypt comparison", async (t) => {
	const f = await fixture(t);
	assert.equal((await f.login("nobody@mail.test", PASSWORD)).status, 401);
	assert.equal(globalThis.__bcryptCompares.length, 1, "an unknown email is compared against a dummy hash");
	assert.match(globalThis.__bcryptCompares[0], /^\$2/);
	assert.equal((await f.login("pk@mail.test", PASSWORD)).status, 401);
	assert.equal(globalThis.__bcryptCompares.length, 2, "a passkey-only account is compared too");
	assert.equal((await f.login("alice@mail.test", "wrong")).status, 401);
	assert.equal(globalThis.__bcryptCompares.length, 3);
});

test("step-up password failures spend the same per-account budget", async (t) => {
	const f = await fixture(t);
	const session = await app.createSession(f.env, "alice");
	const stepUp = (password) => app.stepUp.POST(new Request(`${ORIGIN}/api/auth/step-up`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `ep_session=${session}` },
		body: JSON.stringify({ password, action: "passkey.add" }),
	}));
	for (let index = 0; index < 10; index++) assert.equal((await stepUp(`wrong-${index}`)).status, 400);
	assert.equal((await stepUp(PASSWORD)).status, 429, "step-up is locked");
	assert.equal((await f.login("alice@mail.test", PASSWORD)).status, 429, "and so is sign-in");
});

test("step-up second-factor codes are limited per account", async (t) => {
	const f = await fixture(t);
	f.sqlite.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 1, require_second_factor = 1 WHERE id = 'alice'").run(app.generateTotpSecret());
	const session = await app.createSession(f.env, "alice");
	const stepUp = (code) => app.stepUp.POST(new Request(`${ORIGIN}/api/auth/step-up`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `ep_session=${session}` },
		body: JSON.stringify({ password: PASSWORD, code, action: "passkey.add" }),
	}));
	const statuses = [];
	for (let index = 0; index < 7; index++) statuses.push((await stepUp("000000")).status);
	assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
	assert.deepEqual(statuses.slice(5), [429, 429]);
});

test("the per-IP limiters refuse without their binding in production, and log when it fails", async (t) => {
	const request = new Request(`${ORIGIN}/api/auth/login`, { method: "POST" });
	const previous = process.env.NODE_ENV;
	t.after(() => { process.env.NODE_ENV = previous; });
	const errors = [];
	t.mock.method(console, "error", (...args) => { errors.push(args.join(" ")); });
	t.mock.method(console, "warn", (...args) => { errors.push(args.join(" ")); });

	process.env.NODE_ENV = "development";
	assert.equal(await app.allowLoginAttempt({}, request), true, "local development has no binding");

	process.env.NODE_ENV = "production";
	assert.equal(await app.allowLoginAttempt({}, request), false);
	assert.equal(await app.allowAppPasswordGuess({ DB: null }, request, "abcdefghijklmnop"), false);
	assert.ok(errors.some((line) => /LOGIN_RATE_LIMIT/.test(line)), "the missing binding is logged");

	// A binding that throws keeps sign-in available, but says so in the logs.
	errors.length = 0;
	const broken = { limit: async () => { throw new Error("limiter down"); } };
	assert.equal(await app.allowLoginAttempt({ LOGIN_RATE_LIMIT: broken }, request), true);
	assert.ok(errors.some((line) => /limiter down|unavailable/i.test(line)));
});
