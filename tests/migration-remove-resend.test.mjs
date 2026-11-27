import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadApp } from "./helpers/real-db.mjs";

/**
 * 0002_remove_resend runs on live databases: rows that still name Resend get values the app understands
 * (sending off, receiving through Cloudflare, an administrator's suppression entry) before the Resend
 * columns of app_settings are dropped.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "drizzle", "migrations");
const MIGRATION = "0002_remove_resend.sql";
const { app } = await loadApp("migration-remove-resend", "");

test("the migration rewrites Resend values and drops the Resend columns", async (t) => {
	const database = new app.SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	const db = database.db;
	// Hold the migration back so the database looks like one created from the baseline.
	db.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
	db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(MIGRATION);
	await app.applyMigrations(database, migrationsDir);
	db.exec(`
		INSERT INTO users (id, email, password_hash, name, created_at) VALUES ('u', 'u@x.test', 'h', 'U', 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, sending_provider, receiving_provider, created_at) VALUES
			('resend', 'u', 'resend.test', 'z1', 'resend', 'resend', 1),
			('cf', 'u', 'cf.test', 'z2', 'cloudflare', 'cloudflare', 1),
			('off', 'u', 'off.test', 'z3', 'none', 'none', 1);
		INSERT INTO email_suppressions (id, domain_id, email, reason, source, first_event_at, last_event_at) VALUES
			('s1', 'resend', 'a@x.org', 'complaint', 'resend', 1, 1),
			('s2', 'resend', 'b@x.org', 'hard_bounce', 'dsn', 1, 1);
		UPDATE app_settings SET resend_api_key = 're_x', resend_webhook_secret = 'whsec_x' WHERE id = 'default';
	`);

	db.prepare("DELETE FROM d1_migrations WHERE name = ?").run(MIGRATION);
	assert.deepEqual(await app.applyMigrations(database, migrationsDir), [MIGRATION]);

	const providers = db.prepare("SELECT id, sending_provider AS sending, receiving_provider AS receiving FROM domains ORDER BY id").all().map((row) => ({ ...row }));
	assert.deepEqual(providers, [
		{ id: "cf", sending: "cloudflare", receiving: "cloudflare" },
		{ id: "off", sending: "none", receiving: "none" },
		{ id: "resend", sending: "none", receiving: "cloudflare" },
	]);
	const sources = db.prepare("SELECT id, source FROM email_suppressions ORDER BY id").all().map((row) => [row.id, row.source]);
	assert.deepEqual(sources, [["s1", "admin"], ["s2", "dsn"]]);
	const columns = db.prepare("SELECT name FROM pragma_table_info('app_settings')").all().map((row) => row.name);
	assert.deepEqual(columns.filter((name) => name.startsWith("resend_")), []);
	assert.equal(db.prepare("SELECT app_name FROM app_settings WHERE id = 'default'").get().app_name, "MyMailbox");
});
