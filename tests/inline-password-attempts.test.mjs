import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * Every place a signed-in user re-enters the password (inline confirmation of a security change, or the
 * current password when changing it) spends the same per-account budget as sign-in, so a stolen
 * session cannot be turned into an unlimited password oracle.
 */
const { app, newDatabase } = await loadApp("inline-password-attempts", `
	export { authorizeSecurityChange } from "./src/lib/auth/webauthn/authorize.ts";
	export * as passwordRoute from "./src/app/api/settings/password/route.ts";
	export * as login from "./src/app/api/auth/login/route.ts";
	export { createSession } from "./src/lib/auth/session.ts";
`, {
	mocks: {
		"next/headers": "export async function cookies(){ return { get: () => undefined }; }",
		bcryptjs: `
			const hashSync = (password) => "$2mock$" + password;
			const compareSync = (password, hash) => hash === "$2mock$" + password;
			export default { hashSync, compareSync };
			export { hashSync, compareSync };
		`,
	},
});

const PASSWORD = "the-right-password";
const ORIGIN = "https://mail.test";

async function fixture(t) {
	const database = await newDatabase(t);
	database.sqlite.prepare("INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('alice', 'alice@mail.test', ?, 'Alice', 'admin', 1)").run(`$2mock$${PASSWORD}`);
	database.env.APP_URL = ORIGIN;
	globalThis.__testEnv = database.env;
	t.after(() => { delete globalThis.__testEnv; });
	const session = await app.createSession(database.env, "alice");
	const request = (path, body, method = "POST") => new Request(`${ORIGIN}${path}`, {
		method,
		headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `ep_session=${session}` },
		body: JSON.stringify(body),
	});
	const user = () => database.sqlite.prepare("SELECT id, password_hash AS passwordHash, require_second_factor AS requireSecondFactor, totp_secret AS totpSecret, totp_enabled AS totpEnabled FROM users WHERE id = 'alice'").get();
	const signIn = () => app.login.POST(request("/api/auth/login", { email: "alice@mail.test", password: PASSWORD }));
	return { ...database, request, user, signIn };
}

test("inline password confirmations spend the sign-in budget", async (t) => {
	const f = await fixture(t);
	const confirm = (password) => app.authorizeSecurityChange(f.env, f.user(), f.request("/api/webhooks", { password }), { password }, "webhook.change");
	for (let index = 0; index < 10; index++) assert.equal(await confirm(`wrong-${index}`), false);
	assert.equal(await confirm(PASSWORD), false, "the right password is refused once the budget is spent");
	// Sign-in is locked too, answered like a wrong password so the lockout does not reveal the account.
	assert.equal((await f.signIn()).status, 401, "and sign-in is locked too");
});

test("a right inline password still works and does not count", async (t) => {
	const f = await fixture(t);
	const confirm = (password) => app.authorizeSecurityChange(f.env, f.user(), f.request("/api/webhooks", { password }), { password }, "webhook.change");
	assert.equal(await confirm("wrong"), false);
	assert.equal(await confirm(PASSWORD), true);
	assert.equal(f.sqlite.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'auth.password_failed'").get().count, 1);
});

test("the current password on a password change spends the sign-in budget", async (t) => {
	const f = await fixture(t);
	const change = (currentPassword) => app.passwordRoute.PATCH(f.request("/api/settings/password", { currentPassword, newPassword: "a-brand-new-password" }, "PATCH"));
	for (let index = 0; index < 10; index++) assert.equal((await change(`wrong-${index}`)).status, 400);
	assert.equal((await change(PASSWORD)).status, 429);
	assert.equal((await f.signIn()).status, 401);
});
