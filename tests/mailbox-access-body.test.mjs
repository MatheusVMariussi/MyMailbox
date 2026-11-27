import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

/** Granting shared-mailbox access answers a malformed or oversized body with 4xx instead of throwing. */
const { app, newDatabase } = await loadApp("mailbox-access-body", `
	export * as access from "./src/app/api/mailboxes/[id]/access/route.ts";
	export { createSession } from "./src/lib/auth/session.ts";
`);

async function fixture(t) {
	const { env } = await newDatabase(t, `
		INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, can_manage_users, can_manage_mailboxes, created_at) VALUES ('admin', 'admin@one.test', 'h', 'Admin', 'admin', 1, 1, 1, 1);
		INSERT INTO users (id, email, password_hash, name, role, created_by_user_id, created_at) VALUES ('member', 'member@one.test', 'h', 'Member', 'user', 'admin', 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d', 'admin', 'one.test', 'z', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, created_at) VALUES ('team', 'admin', 'd', 'team', 'shared', 1);
	`);
	globalThis.__testEnv = env;
	t.after(() => { delete globalThis.__testEnv; });
	const session = await app.createSession(env, "admin");
	return (body) => app.access.POST(new Request("https://mail.test/api/mailboxes/team/access", {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "https://mail.test", Cookie: `ep_session=${session}` },
		body,
	}), { params: Promise.resolve({ id: "team" }) });
}

test("a body that is not JSON is a 400", async (t) => {
	const post = await fixture(t);
	assert.equal((await post("{not json")).status, 400);
	assert.equal((await post("")).status, 400);
});

test("an oversized body is refused", async (t) => {
	const post = await fixture(t);
	assert.equal((await post(JSON.stringify({ userId: "member", permission: "read_only", pad: "x".repeat(64 * 1024) }))).status, 413);
});

test("a valid grant still works", async (t) => {
	const post = await fixture(t);
	const response = await post(JSON.stringify({ userId: "member", permission: "read_only" }));
	assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
});
