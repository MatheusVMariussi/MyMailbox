import type { BackupTableGroupId, DatabaseBackupTable } from "./types";

export const BACKUP_TABLE_GROUPS: { id: BackupTableGroupId; label: string; tables: DatabaseBackupTable[] }[] = [
	{ id: "accounts", label: "Accounts and mailboxes", tables: ["users", "user_compose_preferences", "domains", "domain_tracking_hosts", "email_suppressions", "domain_deliverability", "projects", "project_addresses", "mailboxes", "mailbox_access", "mailbox_aliases", "contacts", "api_keys", "api_key_mailboxes", "sessions", "password_reset_tokens", "mfa_recovery_codes", "login_challenges", "passkey_credentials"] },
	{ id: "mail", label: "Mail and related data", tables: ["labels", "mailbox_promotion_settings", "mailbox_sender_preferences", "messages", "message_labels", "message_attachments", "shared_attachment_links", "outbound_jobs", "message_tracking", "message_opens", "follow_ups", "conversation_notes", "email_templates", "calendar_events", "calendar_event_overrides", "calendar_occurrence_responses", "calendar_invite_tombstones", "auto_reply_deliveries", "spam_token_stats", "spam_reputation", "spam_feedback"] },
	{ id: "automation", label: "Routing and webhooks", tables: ["routing_rules", "webhooks", "webhook_deliveries"] },
	{ id: "system", label: "App settings and history", tables: ["audit_logs", "backup_settings", "backups", "app_settings", "deliverability_reports", "dmarc_daily_stats", "tls_daily_stats", "deliverability_alerts"] },
];

export function getSelectedBackupTables(excludedGroups: BackupTableGroupId[]): Set<DatabaseBackupTable> {
	const excluded = new Set(excludedGroups);
	return new Set(BACKUP_TABLE_GROUPS.filter((group) => !excluded.has(group.id)).flatMap((group) => group.tables));
}

export function parseExcludedBackupTableGroups(value: string): BackupTableGroupId[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		const known = new Set(BACKUP_TABLE_GROUPS.map((group) => group.id));
		return parsed.filter((group): group is BackupTableGroupId => typeof group === "string" && known.has(group as BackupTableGroupId));
	} catch {
		return [];
	}
}
