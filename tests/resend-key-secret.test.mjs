import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * The Resend API key: a RESEND_API_KEY Worker secret wins over the key stored in the database (and the
 * stored one cannot replace it), and changing the stored key needs a fresh step-up.
 */
const { app, newDatabase } = await loadApp("resend-key-secret", `
	export * as resendKey from "./src/app/api/admin/resend-key/route.ts";
	export { getResendKeyStatus } from "./src/lib/email/outbound-provider.ts";
	export { createSession } from "./src/lib/auth/session.ts";
	export { createStepUpGrant } from "./src/lib/auth/webauthn/grants.ts";
`);

const ORIGIN = "https://mail.test";

async function fixture(t, env = {}) {
	const database = await newDatabase(t, `
		INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('admin', 'admin@mail.test', 'hash', 'Admin', 'admin', 1, 1);
		UPDATE app_settings SET resend_api_key = 're_stored' WHERE id = 'default';
	`);
	Object.assign(database.env, { APP_URL: ORIGIN }, env);
	globalThis.__testEnv = database.env;
	t.after(() => { delete globalThis.__testEnv; });
	const fetches = [];
	t.mock.method(globalThis, "fetch", async (url) => {
		fetches.push(String(url));
		return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
	});
	const session = await app.createSession(database.env, "admin");
	const call = (method, body) => app.resendKey[method](new Request(`${ORIGIN}/api/admin/resend-key`, {
		method,
		headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: `ep_session=${session}` },
		body: body === undefined ? undefined : JSON.stringify(body),
	}));
	const grant = () => app.createStepUpGrant(database.env, { userId: "admin", sessionToken: session, action: "provider.resend_key", expectedActorSecurityVersion: 0 });
	const stored = () => database.sqlite.prepare("SELECT resend_api_key FROM app_settings WHERE id = 'default'").get().resend_api_key;
	return { ...database, call, grant, stored, fetches };
}

test("the RESEND_API_KEY secret wins over the stored key", async (t) => {
	const { env } = await fixture(t, { RESEND_API_KEY: "re_from_env" });
	const status = await app.getResendKeyStatus(env);
	assert.equal(status.apiKey, "re_from_env");
	assert.equal(status.source, "environment");
	delete env.RESEND_API_KEY;
	const fallback = await app.getResendKeyStatus(env);
	assert.equal(fallback.apiKey, "re_stored");
	assert.equal(fallback.source, "settings");
});

test("changing the stored key needs a step-up grant", async (t) => {
	const f = await fixture(t);
	const refused = await f.call("PUT", { apiKey: "re_new" });
	assert.equal(refused.status, 401);
	assert.equal(f.stored(), "re_stored");
	assert.deepEqual(f.fetches, [], "Resend is not even asked before the change is authorized");

	const saved = await f.call("PUT", { apiKey: "re_new", stepUpToken: await f.grant() });
	assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
	assert.equal(f.stored(), "re_new");

	assert.equal((await f.call("DELETE", {})).status, 401);
	assert.equal(f.stored(), "re_new");
	assert.equal((await f.call("DELETE", { stepUpToken: await f.grant() })).status, 200);
	assert.equal(f.stored(), null);
});

test("a key from the environment cannot be overwritten from the admin UI", async (t) => {
	const f = await fixture(t, { RESEND_API_KEY: "re_from_env" });
	const response = await f.call("PUT", { apiKey: "re_other", stepUpToken: await f.grant() });
	assert.equal(response.status, 409);
	assert.match((await response.json()).error, /RESEND_API_KEY/);
	assert.equal(f.stored(), "re_stored");
	const status = await (await f.call("GET")).json();
	assert.deepEqual(status, { configured: true, source: "environment" });
});
