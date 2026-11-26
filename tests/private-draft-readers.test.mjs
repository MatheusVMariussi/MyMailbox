import assert from "node:assert/strict";
import test from "node:test";
import { loadApp, sharedMailboxSeed } from "./helpers/real-db.mjs";

// Another user's draft that its author filed under Archive or a folder is still private: the
// thread view and the list's conversation counts must both leave it out, for everyone but its author.
const mocks = {
	"@/lib/cloudflare": "export function getEnv(){return globalThis.prEnv}",
	"@/lib/auth/cookies": "export async function getCurrentUser(){return globalThis.prUser} export async function requireUser(){return globalThis.prUser}",
};
const { app, newDatabase } = await loadApp("private-draft-readers", `
	export { getMessageThreadForUser } from "./src/lib/email/thread-view.ts";
	export * as list from "./src/app/api/messages/route.ts";
`, { mocks });

const seed = `${sharedMailboxSeed("send_on_behalf")}
	INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, text_body, status, private_draft, thread_id, created_at) VALUES
		('in-1', 'admin', 'mb-team', 'inbound', 'x@example.net', 'team@example.com', 'Hello', 'visible question', 'received', 0, 'th', 2),
		('d-arch', 'author', 'mb-team', 'outbound', 'team@example.com', 'x@example.net', 'Re: Hello', 'SECRET-DRAFT', 'archived', 1, 'th', 3);
	INSERT INTO message_attachments (id, message_id, filename, content_type, size, disposition, r2_key, created_at) VALUES
		('att-d', 'd-arch', 'secret.pdf', 'application/pdf', 1, 'attachment', 'k1', 1),
		('att-v', 'in-1', 'ok.pdf', 'application/pdf', 1, 'attachment', 'k2', 1);
`;
const user = (id) => ({ id, email: `${id}@example.com`, role: "user" });
async function setup(t, who) {
	const fixture = await newDatabase(t, seed);
	globalThis.prEnv = fixture.env;
	globalThis.prUser = user(who);
	return fixture;
}

test("the thread view leaves out another user's archived draft", async (t) => {
	const { env } = await setup(t, "delegate");
	const ids = (await app.getMessageThreadForUser(env, user("delegate"), "in-1")).messages.map((m) => m.id);
	assert.deepEqual(ids, ["in-1"]);
	// The filter must not hide the author's own rows.
	const own = await app.getMessageThreadForUser(env, user("author"), "in-1");
	assert.ok(own.messages.some((m) => m.id === "in-1"));
});

test("conversation counts in the list exclude another user's archived draft", async (t) => {
	await setup(t, "delegate");
	const body = await (await app.list.GET(new Request("http://localhost/api/messages?mailboxId=mb-team&status=received"))).json();
	assert.equal(body.messages.find((m) => m.id === "in-1").threadCount, 1);
	globalThis.prUser = user("author");
	const mine = await (await app.list.GET(new Request("http://localhost/api/messages?mailboxId=mb-team&status=received"))).json();
	assert.equal(mine.messages.find((m) => m.id === "in-1").threadCount, 2);
});
