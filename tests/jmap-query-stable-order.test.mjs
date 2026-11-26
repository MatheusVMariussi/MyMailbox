import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

// Email/query must page through rows with equal sort keys without repeating or skipping any, which needs a
// unique tie-breaker in the ORDER BY rather than whatever order the database happens to return.
const { app, newDatabase } = await loadApp("jmap-stable-order", `export { processRequest } from "./src/lib/jmap/processor.ts";`);

const MAILBOX = "mbx_test";
const COUNT = 300;

test("Email/query pages through equal sort values without repeats or gaps", async (t) => {
	const { env, db, sqlite } = await newDatabase(t);
	sqlite.exec(`INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('admin', 'owner@one.test', 'hash', 'Owner', 'admin', 1, 1)`);
	sqlite.exec(`INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('one', 'admin', 'one.test', 'zone-one', 'active', 1)`);
	sqlite.exec(`INSERT INTO mailboxes (id, user_id, domain_id, local_part, display_name, use_all_domains, type, disabled, created_at) VALUES ('${MAILBOX}', 'admin', 'one', 'support', 'Support', 1, 'personal', 0, 1)`);
	// Three distinct timestamps, so most rows tie with many others; ids are inserted out of order.
	const values = Array.from({ length: COUNT }, (_, i) => `('m_${String((i * 7919) % COUNT).padStart(4, "0")}', 'admin', '${MAILBOX}', 'inbound', 'a@one.test', 'support@one.test', 'received', 0, 0, ${i % 3})`);
	sqlite.exec(`INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, read, starred, created_at) VALUES ${values.join(", ")}`);

	const ctx = {
		env,
		db,
		auth: { userId: "admin", email: "owner@one.test", scopes: ["jmap"], mailboxIds: null, user: { id: "admin", email: "owner@one.test", role: "admin" } },
		accountId: "admin",
		origin: "http://test",
		createdIds: {},
	};
	const seen = [];
	for (let position = 0; position < COUNT; position += 7) {
		const res = await app.processRequest(ctx, { using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"], methodCalls: [["Email/query", { accountId: "admin", position, limit: 7 }, "q"]] });
		seen.push(...res.methodResponses[0][1].ids);
	}
	assert.equal(seen.length, COUNT);
	assert.equal(new Set(seen).size, COUNT);
});
