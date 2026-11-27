import assert from "node:assert/strict";
import test from "node:test";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * Backups leave out what must not outlive the installation that wrote it: sign-in sessions (a restore
 * would revive sessions that were since revoked) and provider secrets in app_settings, which an
 * operator re-enters after a restore. Restoring those backups, and older ones that still carry
 * sessions, keeps working.
 */
const { app, newDatabase } = await loadApp("backup-secrets", `
	export { exportDatabaseRecords, restoreDatabaseRecords, BACKUP_TABLES, REDACTED_APP_SETTINGS_COLUMNS } from "./src/lib/backups/export.ts";
`);

const SECRETS = {
	resend_api_key: "re_secret_key",
	resend_webhook_secret: "whsec_inbound",
	resend_events_webhook_secret: "whsec_events",
	spamhaus_dqs_key: "dqs-secret",
	abusech_auth_key: "abusech-secret",
};

const seed = `
	INSERT INTO users (id, email, password_hash, name, role, is_primary_admin, created_at) VALUES ('admin', 'admin@mail.test', 'hash', 'Admin', 'admin', 1, 1);
	INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES ('s1', 'admin', 'hash-of-a-live-session', 4102444800, 1);
	UPDATE app_settings SET app_name = 'Owner mail', resend_webhook_id = 'wh_1',
		${Object.entries(SECRETS).map(([column, value]) => `${column} = '${value}'`).join(", ")}
	WHERE id = 'default';
`;

const toBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test("a backup carries no sessions and no provider secrets", async (t) => {
	const { env } = await newDatabase(t, seed);
	const document = JSON.parse(new TextDecoder().decode(await app.exportDatabaseRecords(env.DB)));
	assert.ok(!document.includedTables.includes("sessions"));
	assert.equal(document.tables.sessions, undefined);
	assert.ok(!app.BACKUP_TABLES.includes("sessions"));
	const [settings] = document.tables.app_settings;
	for (const column of Object.keys(SECRETS)) assert.equal(settings[column], null, column);
	assert.deepEqual([...app.REDACTED_APP_SETTINGS_COLUMNS].sort(), Object.keys(SECRETS).sort());
	assert.equal(settings.app_name, "Owner mail");
	assert.equal(settings.resend_webhook_id, "wh_1");
	const text = new TextDecoder().decode(await app.exportDatabaseRecords(env.DB));
	for (const value of Object.values(SECRETS)) assert.ok(!text.includes(value), `${value} leaked into the backup`);
	assert.ok(!text.includes("hash-of-a-live-session"));
});

test("restoring such a backup works and ends every session", async (t) => {
	const { env, sqlite } = await newDatabase(t, seed);
	const backup = await app.exportDatabaseRecords(env.DB);
	await app.restoreDatabaseRecords(env.DB, toBuffer(backup));
	assert.equal(sqlite.prepare("SELECT count(*) AS count FROM users").get().count, 1);
	assert.equal(sqlite.prepare("SELECT count(*) AS count FROM sessions").get().count, 0);
	const settings = sqlite.prepare("SELECT * FROM app_settings WHERE id = 'default'").get();
	assert.equal(settings.app_name, "Owner mail");
	for (const column of Object.keys(SECRETS)) assert.equal(settings[column], null, column);
});

test("an older backup that still lists sessions restores without them", async (t) => {
	const { env, sqlite } = await newDatabase(t, seed);
	const document = JSON.parse(new TextDecoder().decode(await app.exportDatabaseRecords(env.DB)));
	document.includedTables.push("sessions");
	document.tables.sessions = [{ id: "s-old", user_id: "admin", token_hash: "stale", expires_at: 4102444800, created_at: 1 }];
	await app.restoreDatabaseRecords(env.DB, toBuffer(new TextEncoder().encode(JSON.stringify(document))));
	assert.equal(sqlite.prepare("SELECT count(*) AS count FROM users").get().count, 1);
	assert.equal(sqlite.prepare("SELECT count(*) AS count FROM sessions").get().count, 0);
});
