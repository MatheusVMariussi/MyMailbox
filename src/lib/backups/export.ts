import { listColumnNames, listTableNames, quoteIdentifier } from "@/db/introspect";
import type { BackupTableGroupId, DatabaseBackupDocument, DatabaseBackupTable, DatabaseRecord } from "./types";
import { BACKUP_TABLE_GROUPS, getSelectedBackupTables } from "./table-groups";

/** Every backed-up table, in foreign-key order: restore inserts in this order and deletes in reverse. */
export const BACKUP_TABLES: DatabaseBackupTable[] = ["users", "user_compose_preferences", "domains", "domain_tracking_hosts", "email_suppressions", "domain_deliverability", "mailboxes", "mailbox_access", "contacts", "labels", "mailbox_promotion_settings", "mailbox_sender_preferences", "api_keys", "messages", "message_labels", "message_attachments", "shared_attachment_links", "outbound_jobs", "message_tracking", "message_opens", "follow_ups", "conversation_notes", "routing_rules", "webhooks", "webhook_deliveries", "sessions", "audit_logs", "backup_settings", "backups", "app_settings", "deliverability_reports", "dmarc_daily_stats", "tls_daily_stats", "deliverability_alerts", "email_templates", "calendar_events", "calendar_event_overrides", "calendar_occurrence_responses", "calendar_invite_tombstones", "auto_reply_deliveries", "spam_token_stats", "spam_reputation", "spam_feedback", "mailbox_aliases", "password_reset_tokens", "mfa_recovery_codes", "login_challenges", "passkey_credentials", "api_key_mailboxes"];
/** The document format this release writes and restores. */
const BACKUP_FORMAT = "mymailbox-database-backup";
const BACKUP_FORMAT_VERSION = 3;
/** The format name of Mailflare, the upstream project. Its documents carry tables and columns this schema does not have, so they are refused with a clear message. */
const UPSTREAM_BACKUP_FORMAT = "mailflare-database-backup";
const INSERT_BATCH_SIZE = 50;
/**
 * Serial ids that are never backed up or restored: the row's identity is its unique key, not the id, so a
 * restore lets the database assign fresh ids.
 */
const OMITTED_COLUMNS: Partial<Record<DatabaseBackupTable, string[]>> = { dmarc_daily_stats: ["id"], tls_daily_stats: ["id"] };

export function getBackupConfigurationStatus(_env?: CloudflareEnv) {
	return { configured: true, missing: [] };
}

/**
 * Tables D1 manages itself, which are intentionally absent from BACKUP_TABLES.
 */
export const INTERNAL_TABLE_PATTERNS = ["sqlite_%", "_cf%", "messages_fts%"];
const matchesPattern = (name: string, pattern: string) => name.startsWith(pattern.replace(/%$/, ""));
/**
 * The search index is derived data: its triggers repopulate it as messages are
 * restored, so it is neither exported nor part of the coverage check.
 */
export const INTERNAL_TABLES = [
	"d1_migrations",
	// JMAP state counters, also derived: the jmap_messages_* triggers on
	// `messages` insert and bump a row per mailbox as messages are restored.
	// Exporting it would make restore fail, since the triggers recreate these
	// primary keys before the table's own rows would be inserted.
	"jmap_mailbox_revisions",
	// The JMAP change log is derived the same way (jmap_changes_* triggers);
	// after a restore clients resync because their states no longer apply.
	"jmap_changes",
	"jmap_change_floor",
	// Web-push subscriptions are saved again by each client whenever it resolves
	// its push state, and they reference sessions whose rows a restore replaces.
	"push_subscriptions",
	// WebAuthn ceremonies, step-up grants and enrolment links are short-lived,
	// single-use bearer secrets. Restoring a stale one would be useless at best
	// and dangerous at worst, so backups deliberately omit them.
	"webauthn_challenges",
	"passkey_enrollment_grants",
	"auth_step_ups",
	// Single-use undo-token consumption records. Restoring a stale claim would
	// let an already-used undo token be replayed, and the table is rewritten by
	// the installation that owns the tokens.
	"message_action_undo_claims",
];

/**
 * Fails the backup when the database contains a table BACKUP_TABLES does not
 * list. Without this, a migration that adds a table silently produces backups
 * that omit it, and the omission only surfaces during a restore.
 */
export async function assertBackupTablesCoverDatabase(db: D1Database): Promise<Set<string>> {
	const names = [...(await listTableNames(db))].filter((name) => !INTERNAL_TABLE_PATTERNS.some((pattern) => matchesPattern(name, pattern)) && !INTERNAL_TABLES.includes(name));
	const covered = new Set<string>(BACKUP_TABLES);
	const unlisted = names.filter((name) => !covered.has(name));
	if (unlisted.length) throw new Error(`Backup aborted: ${unlisted.join(", ")} not listed in BACKUP_TABLES. Add new tables to src/lib/backups/export.ts and assign each to a group in table-groups.ts.`);
	const assigned = BACKUP_TABLE_GROUPS.flatMap((group) => group.tables);
	const ungrouped = BACKUP_TABLES.filter((table) => assigned.filter((item) => item === table).length !== 1);
	const unknown = assigned.filter((table) => !covered.has(table));
	if (ungrouped.length || unknown.length) throw new Error(`Backup aborted: table groups are out of sync (${[...ungrouped, ...unknown].join(", ")}). Update src/lib/backups/table-groups.ts.`);
	return new Set(names);
}

export async function exportDatabaseRecords(db: D1Database, excludedGroups: BackupTableGroupId[] = []): Promise<Uint8Array> {
	const databaseTables = await assertBackupTablesCoverDatabase(db);
	const selected = getSelectedBackupTables(excludedGroups);
	const includedTables = BACKUP_TABLES.filter((table) => selected.has(table));
	if (!includedTables.length) throw new Error("Select at least one backup table group");
	const tables: DatabaseBackupDocument["tables"] = {};
	for (const table of includedTables) {
		// A table whose migration is not applied yet backs up as empty.
		if (!databaseTables.has(table)) {
			tables[table] = [];
			continue;
		}
		const result = await db.prepare(`SELECT * FROM ${table}`).all<DatabaseRecord>();
		const omitted = OMITTED_COLUMNS[table];
		tables[table] = omitted ? result.results.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => !omitted.includes(column)))) : result.results;
	}
	const document: DatabaseBackupDocument = { format: BACKUP_FORMAT, version: BACKUP_FORMAT_VERSION, createdAt: new Date().toISOString(), includedTables, tables };
	return new TextEncoder().encode(JSON.stringify(document));
}

export async function restoreDatabaseRecords(db: D1Database, content: ArrayBuffer): Promise<void> {
	const document = parseDatabaseBackup(content);
	if (!BACKUP_TABLE_GROUPS.every((group) => group.tables.some((table) => document.includedTables.includes(table)))) throw new Error("This backup contains selected table groups only. Restore requires a backup that includes every table group.");
	fillMissingBackupTables(document);
	validateDatabaseBackup(document);
	// Everything that can refuse the restore is checked before the teardown below deletes anything.
	const existing = await listTableNames(db);
	const unmigrated = BACKUP_TABLES.filter((table) => !existing.has(table) && document.tables[table]?.length);
	if (unmigrated.length) throw new Error(`Apply pending database migrations before restoring ${unmigrated.join(", ")}.`);
	const restoreTables = BACKUP_TABLES.filter((table) => existing.has(table));
	// A backup from a database with newer migrations can carry columns this one lacks; those are dropped rather than failing after the teardown.
	const columns = new Map<DatabaseBackupTable, Set<string>>();
	for (const table of restoreTables) columns.set(table, await listColumnNames(db, table));
	// Mark users deleted before removing them: the passkey trigger permits the
	// cascade to remove the last credential only for an account that is being
	// purged. Deleting users first also empties the table the restore inserts
	// into last, so the rest of the teardown has no live accounts to protect.
	await db.prepare("UPDATE users SET deleted_at = ?").bind(Math.floor(Date.now() / 1000)).run();
	await db.prepare("DELETE FROM users").run();
	for (const table of [...restoreTables].reverse()) {
		if (table === "users") continue;
		await db.prepare(`DELETE FROM ${table}`).run();
	}
	for (const table of restoreTables) {
		const rows = document.tables[table] ?? [];
		for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
			const statements = rows.slice(index, index + INSERT_BATCH_SIZE).map((row) => createInsertStatement(db, table, row, columns.get(table) ?? null));
			if (statements.length > 0) await db.batch(statements);
		}
	}
}

function parseDatabaseBackup(content: ArrayBuffer): DatabaseBackupDocument {
	let value: unknown;
	try { value = JSON.parse(new TextDecoder().decode(content)); } catch { throw new Error("The selected file is not a valid MyMailbox backup"); }
	const format = (value as { format?: unknown } | null)?.format;
	if (format === UPSTREAM_BACKUP_FORMAT) throw new Error("This backup was written by Mailflare and cannot be restored into MyMailbox.");
	const version = format === BACKUP_FORMAT ? (value as { version?: unknown }).version : undefined;
	if (typeof version === "number" && version < BACKUP_FORMAT_VERSION) throw new Error("This backup was written by an older MyMailbox release and cannot be restored into this database.");
	if (!isDatabaseBackupDocument(value)) throw new Error("The selected file is not a valid MyMailbox backup");
	return value;
}

function isDatabaseBackupDocument(value: unknown): value is DatabaseBackupDocument {
	if (!value || typeof value !== "object") return false;
	const document = value as Partial<DatabaseBackupDocument>;
	if (document.format !== BACKUP_FORMAT || document.version !== BACKUP_FORMAT_VERSION || !document.tables || typeof document.tables !== "object") return false;
	if (!Array.isArray(document.includedTables) || !document.includedTables.length || new Set(document.includedTables).size !== document.includedTables.length) return false;
	if (!document.includedTables.every((table) => BACKUP_TABLES.includes(table) && Array.isArray(document.tables?.[table]))) return false;
	return BACKUP_TABLES.every((table) => {
		const rows = document.tables?.[table];
		return rows === undefined || Array.isArray(rows);
	});
}

function createInsertStatement(db: D1Database, table: DatabaseBackupTable, row: DatabaseRecord, availableColumns: Set<string> | null) {
	const omitted = OMITTED_COLUMNS[table] ?? [];
	const columns = Object.keys(row).filter((column) => !omitted.includes(column) && (!availableColumns || availableColumns.has(column)));
	if (columns.length === 0) throw new Error(`Backup contains an invalid ${table} record`);
	const placeholders = columns.map(() => "?").join(", ");
	const identifiers = columns.map((column) => quoteIdentifier(column)).join(", ");
	return db.prepare(`INSERT INTO ${table} (${identifiers}) VALUES (${placeholders})`).bind(...columns.map((column) => row[column]));
}

/** Tables a document does not carry restore as empty. */
function fillMissingBackupTables(document: DatabaseBackupDocument): void {
	for (const table of BACKUP_TABLES) {
		if (!document.tables[table]) document.tables[table] = [];
	}
	// The passkey triggers recount credentials as the table is restored.
	// Resetting avoids counting the exported value twice.
	for (const row of document.tables.users ?? []) row.passkey_count = 0;
}

function validateDatabaseBackup(document: DatabaseBackupDocument): void {
	for (const table of BACKUP_TABLES) {
		for (const row of document.tables[table] ?? []) {
			if (!row || typeof row !== "object" || Array.isArray(row)) {
				throw new Error(`Backup contains an invalid ${table} record`);
			}
		}
	}
}
