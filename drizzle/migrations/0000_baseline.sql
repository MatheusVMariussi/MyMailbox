CREATE TABLE `api_key_mailboxes` (
	`key_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	FOREIGN KEY (`key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_mailbox_idx` ON `api_key_mailboxes` (`key_id`,`mailbox_id`);--> statement-breakpoint
CREATE INDEX `api_key_mailboxes_mailbox_idx` ON `api_key_mailboxes` (`mailbox_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'legacy' NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_sha256` text,
	`scopes` text NOT NULL,
	`mailbox_scope_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`last_used_protocol` text,
	`last_used_ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_sha256_idx` ON `api_keys` (`key_sha256`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_prefix` ON `api_keys` (`prefix`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`app_name` text DEFAULT 'MyMailbox' NOT NULL,
	`outbound_attachment_max_mb` integer DEFAULT 25 NOT NULL,
	`resend_api_key` text,
	`resend_webhook_id` text,
	`resend_webhook_secret` text,
	`icon_key` text,
	`spamhaus_dqs_key` text,
	`abusech_auth_key` text,
	`spam_domain_age_check` integer DEFAULT true NOT NULL,
	`spam_brands` text,
	`suppression_mode` text DEFAULT 'off' NOT NULL,
	`resend_events_webhook_id` text,
	`resend_events_webhook_secret` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`target_user_id` text,
	`mailbox_id` text,
	`message_id` text,
	`action` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_mailbox_idx` ON `audit_logs` (`mailbox_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_message_id_idx` ON `audit_logs` (`message_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_target_user_idx` ON `audit_logs` (`target_user_id`);--> statement-breakpoint
CREATE TABLE `auth_step_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_hash` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`target_user_id` text,
	`security_version` integer DEFAULT 0 NOT NULL,
	`actor_security_version` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_step_ups_token_hash_unique` ON `auth_step_ups` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_step_ups_user_idx` ON `auth_step_ups` (`user_id`);--> statement-breakpoint
CREATE TABLE `auto_reply_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`recipient` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auto_reply_deliveries_mailbox_recipient_idx` ON `auto_reply_deliveries` (`mailbox_id`,`recipient`);--> statement-breakpoint
CREATE INDEX `auto_reply_deliveries_sent_idx` ON `auto_reply_deliveries` (`sent_at`);--> statement-breakpoint
CREATE TABLE `backup_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`schedule_type` text DEFAULT 'daily' NOT NULL,
	`schedule_value` integer,
	`retention_enabled` integer DEFAULT false NOT NULL,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`excluded_table_groups` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger` text NOT NULL,
	`r2_key` text,
	`filename` text,
	`size` integer,
	`error` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backups_created_idx` ON `backups` (`created_at`);--> statement-breakpoint
CREATE INDEX `backups_status_idx` ON `backups` (`status`);--> statement-breakpoint
CREATE INDEX `backups_created_by_idx` ON `backups` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `calendar_event_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`occurrence_ms` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`title` text,
	`description` text,
	`location` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_overrides_event_occurrence_idx` ON `calendar_event_overrides` (`event_id`,`occurrence_ms`);--> statement-breakpoint
CREATE INDEX `calendar_event_overrides_event_idx` ON `calendar_event_overrides` (`event_id`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`attendees` text DEFAULT '[]' NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`repeat` text DEFAULT 'none' NOT NULL,
	`repeat_days` text DEFAULT '[]' NOT NULL,
	`repeat_anchor_day` integer,
	`repeat_until` integer,
	`repeat_interval` integer DEFAULT 1 NOT NULL,
	`repeat_weekday` integer,
	`repeat_week` integer,
	`excluded_occurrences` text DEFAULT '[]' NOT NULL,
	`time_zone` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`reminder_minutes` integer,
	`last_reminded_start` integer,
	`response_status` text,
	`invite_message_id` text,
	`invite_sender` text,
	`invite_sequence` integer,
	`event_sequence` integer DEFAULT 0 NOT NULL,
	`attendee_responses` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `calendar_events_user_starts_idx` ON `calendar_events` (`user_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `calendar_events_mailbox_idx` ON `calendar_events` (`mailbox_id`);--> statement-breakpoint
CREATE TABLE `calendar_invite_tombstones` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`invite_sequence` integer DEFAULT 0 NOT NULL,
	`invite_sender` text DEFAULT '' NOT NULL,
	`cancelled_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_invite_tombstones_user_idx` ON `calendar_invite_tombstones` (`user_id`);--> statement-breakpoint
CREATE TABLE `calendar_occurrence_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`occurrence_ms` integer NOT NULL,
	`guest` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_occurrence_responses_event_occurrence_guest_idx` ON `calendar_occurrence_responses` (`event_id`,`occurrence_ms`,`guest`);--> statement-breakpoint
CREATE INDEX `calendar_occurrence_responses_event_idx` ON `calendar_occurrence_responses` (`event_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`avatar_key` text,
	`source` text DEFAULT 'inbound' NOT NULL,
	`blocked` integer DEFAULT false NOT NULL,
	`remote_content_allowed` integer DEFAULT false NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_email_idx` ON `contacts` (`user_id`,`email`);--> statement-breakpoint
CREATE INDEX `contacts_user_idx` ON `contacts` (`user_id`);--> statement-breakpoint
CREATE TABLE `conversation_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`thread_key` text NOT NULL,
	`message_id` text,
	`html` text NOT NULL,
	`author_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_notes_mailbox_thread_idx` ON `conversation_notes` (`mailbox_id`,`thread_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `conversation_notes_message_idx` ON `conversation_notes` (`message_id`);--> statement-breakpoint
CREATE INDEX `conversation_notes_author_idx` ON `conversation_notes` (`author_user_id`);--> statement-breakpoint
CREATE TABLE `deliverability_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`kind` text NOT NULL,
	`day` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by_user_id` text,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliverability_alerts_domain_kind_day_idx` ON `deliverability_alerts` (`domain_id`,`kind`,`day`);--> statement-breakpoint
CREATE INDEX `deliverability_alerts_ack_user_idx` ON `deliverability_alerts` (`acknowledged_by_user_id`);--> statement-breakpoint
CREATE TABLE `deliverability_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`kind` text DEFAULT 'dmarc' NOT NULL,
	`report_key` text NOT NULL,
	`reporter_org` text,
	`reporter_email` text,
	`external_report_id` text,
	`date_begin` integer,
	`date_end` integer,
	`policy_p` text,
	`policy_pct` integer,
	`record_count` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`authenticated` integer DEFAULT false NOT NULL,
	`sender_domain` text,
	`verified_reporter` integer DEFAULT false NOT NULL,
	`stats_rows` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliverability_reports_domain_key_idx` ON `deliverability_reports` (`domain_id`,`report_key`);--> statement-breakpoint
CREATE INDEX `deliverability_reports_domain_received_idx` ON `deliverability_reports` (`domain_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `deliverability_reports_received_idx` ON `deliverability_reports` (`received_at`);--> statement-breakpoint
CREATE TABLE `dmarc_daily_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain_id` text NOT NULL,
	`day` text NOT NULL,
	`row_key` text NOT NULL,
	`source_ip` text NOT NULL,
	`source_host` text,
	`reporter_org` text NOT NULL,
	`header_from` text NOT NULL,
	`disposition` text NOT NULL,
	`dkim_aligned` integer NOT NULL,
	`spf_aligned` integer NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dmarc_daily_stats_domain_day_key_idx` ON `dmarc_daily_stats` (`domain_id`,`day`,`row_key`);--> statement-breakpoint
CREATE INDEX `dmarc_daily_stats_day_idx` ON `dmarc_daily_stats` (`day`);--> statement-breakpoint
CREATE TABLE `domain_deliverability` (
	`domain_id` text PRIMARY KEY NOT NULL,
	`reports_enabled` integer DEFAULT false NOT NULL,
	`reports_enabled_at` integer,
	`alert_email` integer DEFAULT false NOT NULL,
	`last_report_at` integer,
	`updated_at` integer NOT NULL,
	`dmarc_created_record` text,
	`tls_rpt_enabled` integer DEFAULT false NOT NULL,
	`mta_sts_mode` text DEFAULT 'none' NOT NULL,
	`mta_sts_policy_id` text,
	`mta_sts_mx` text,
	`mta_sts_max_age` integer DEFAULT 604800 NOT NULL,
	`mta_sts_served_max_age` integer,
	`mta_sts_verified_at` integer,
	`mta_sts_retire_after` integer,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `domain_tracking_hosts` (
	`domain_id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_tracking_hosts_hostname_idx` ON `domain_tracking_hosts` (`hostname`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hostname` text NOT NULL,
	`zone_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`routing_status` text,
	`sending_subdomain_tag` text,
	`sending_provider` text DEFAULT 'none' NOT NULL,
	`receiving_provider` text DEFAULT 'cloudflare' NOT NULL,
	`sending_requested` integer DEFAULT false NOT NULL,
	`sending_enabled` integer DEFAULT false NOT NULL,
	`routing_enabled` integer DEFAULT false NOT NULL,
	`dns_skipped` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_idx` ON `domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `domains_user_idx` ON `domains` (`user_id`);--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_id` text NOT NULL,
	`email` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`detail` text,
	`confirmed` integer DEFAULT true NOT NULL,
	`evidence_ref` text,
	`event_count` integer DEFAULT 1 NOT NULL,
	`first_event_at` integer NOT NULL,
	`last_event_at` integer NOT NULL,
	`created_by_user_id` text,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_suppressions_domain_email_idx` ON `email_suppressions` (`domain_id`,`email`);--> statement-breakpoint
CREATE INDEX `email_suppressions_created_by_idx` ON `email_suppressions` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`text_body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_templates_user_idx` ON `email_templates` (`user_id`);--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_ups_message_idx` ON `follow_ups` (`message_id`);--> statement-breakpoint
CREATE INDEX `follow_ups_status_due_idx` ON `follow_ups` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `follow_ups_user_status_idx` ON `follow_ups` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `jmap_change_floor` (
	`id` integer PRIMARY KEY NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jmap_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mailbox_id` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`thread_id` text,
	`change` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jmap_changes_mailbox_seq_idx` ON `jmap_changes` (`mailbox_id`,`seq`);--> statement-breakpoint
CREATE TABLE `jmap_mailbox_revisions` (
	`mailbox_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#2563eb' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_mailbox_name_idx` ON `labels` (`mailbox_id`,`name`);--> statement-breakpoint
CREATE INDEX `labels_user_idx` ON `labels` (`user_id`);--> statement-breakpoint
CREATE INDEX `labels_mailbox_idx` ON `labels` (`mailbox_id`);--> statement-breakpoint
CREATE TABLE `login_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_challenges_token_hash_unique` ON `login_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `login_challenges_user_idx` ON `login_challenges` (`user_id`);--> statement-breakpoint
CREATE TABLE `mailbox_access` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission` text DEFAULT 'read_only' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_access_mailbox_user_idx` ON `mailbox_access` (`mailbox_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `mailbox_access_user_idx` ON `mailbox_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `mailbox_access_mailbox_idx` ON `mailbox_access` (`mailbox_id`);--> statement-breakpoint
CREATE INDEX `mailbox_access_created_by_idx` ON `mailbox_access` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `mailbox_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`local_part` text NOT NULL,
	`label` text,
	`enabled` integer DEFAULT true NOT NULL,
	`masked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_aliases_address_idx` ON `mailbox_aliases` (`domain_id`,`local_part`);--> statement-breakpoint
CREATE INDEX `mailbox_aliases_mailbox_idx` ON `mailbox_aliases` (`mailbox_id`);--> statement-breakpoint
CREATE TABLE `mailbox_promotion_settings` (
	`mailbox_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'off' NOT NULL,
	`backfill_status` text DEFAULT 'idle' NOT NULL,
	`backfill_cursor` text,
	`backfill_stalls` integer DEFAULT 0 NOT NULL,
	`backfill_error` text,
	`backfill_day` integer DEFAULT 0 NOT NULL,
	`backfill_day_rows` integer DEFAULT 0 NOT NULL,
	`backfill_scanned` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mailbox_promotion_settings_backfill_idx` ON `mailbox_promotion_settings` (`backfill_status`);--> statement-breakpoint
CREATE TABLE `mailbox_sender_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`sender_address` text NOT NULL,
	`category_override` text,
	`unsubscribed_at` integer,
	`updated_by_user_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_sender_preferences_mailbox_sender_idx` ON `mailbox_sender_preferences` (`mailbox_id`,`sender_address`);--> statement-breakpoint
CREATE INDEX `mailbox_sender_preferences_updated_by_idx` ON `mailbox_sender_preferences` (`updated_by_user_id`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`local_part` text NOT NULL,
	`display_name` text,
	`signature` text,
	`auto_reply_enabled` integer DEFAULT false NOT NULL,
	`auto_reply_subject` text DEFAULT 'Out of office' NOT NULL,
	`auto_reply_body` text DEFAULT '' NOT NULL,
	`avatar_key` text,
	`type` text DEFAULT 'personal' NOT NULL,
	`use_all_domains` integer DEFAULT true NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_address_idx` ON `mailboxes` (`domain_id`,`local_part`);--> statement-breakpoint
CREATE INDEX `mailboxes_user_idx` ON `mailboxes` (`user_id`);--> statement-breakpoint
CREATE TABLE `message_action_undo_claims` (
	`nonce` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_action_undo_claims_expires_idx` ON `message_action_undo_claims` (`expires_at`);--> statement-breakpoint
CREATE TABLE `message_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`disposition` text DEFAULT 'attachment' NOT NULL,
	`content_id` text,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_attachments_r2_key_unique` ON `message_attachments` (`r2_key`);--> statement-breakpoint
CREATE INDEX `message_attachments_message_idx` ON `message_attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `message_labels` (
	`message_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_labels_message_label_idx` ON `message_labels` (`message_id`,`label_id`);--> statement-breakpoint
CREATE INDEX `message_labels_label_message_idx` ON `message_labels` (`label_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `message_opens` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`opened_at` integer NOT NULL,
	`client` text,
	`device` text,
	`country` text,
	`city` text,
	`automated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`token`) REFERENCES `message_tracking`(`token`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_opens_token_idx` ON `message_opens` (`token`,`opened_at`);--> statement-breakpoint
CREATE TABLE `message_tracking` (
	`token` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`open_count` integer DEFAULT 0 NOT NULL,
	`first_opened_at` integer,
	`last_opened_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_tracking_message_idx` ON `message_tracking` (`message_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text,
	`direction` text NOT NULL,
	`provider_message_id` text,
	`from_addr` text NOT NULL,
	`to_addr` text NOT NULL,
	`cc_addr` text,
	`bcc_addr` text,
	`reply_to` text,
	`subject` text,
	`snippet` text,
	`text_body` text,
	`html_body` text,
	`raw_r2_key` text,
	`status` text DEFAULT 'received' NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`private_draft` integer DEFAULT false NOT NULL,
	`snoozed_until` integer,
	`thread_id` text,
	`in_reply_to` text,
	`references_header` text,
	`has_unsubscribe` integer DEFAULT false NOT NULL,
	`invite_response` text,
	`spam_score` integer,
	`spam_verdict` text,
	`spam_signals` text,
	`spam_analyzed_at` integer,
	`spam_analysis_error` text,
	`trashed_at` integer,
	`category` text,
	`sender_address` text,
	`delivered_to` text,
	`project_id` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `messages_user_created_idx` ON `messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_mailbox_idx` ON `messages` (`mailbox_id`);--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`mailbox_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `messages_provider_message_idx` ON `messages` (`mailbox_id`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `messages_raw_r2_key_idx` ON `messages` (`raw_r2_key`);--> statement-breakpoint
CREATE INDEX `messages_trashed_at_idx` ON `messages` (`trashed_at`);--> statement-breakpoint
CREATE INDEX `messages_category_page_idx` ON `messages` (`mailbox_id`,`category`,`status`,"created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `messages_category_count_idx` ON `messages` (`mailbox_id`,`category`,`direction`,`status`,`read`,`snoozed_until`,`project_id`);--> statement-breakpoint
CREATE INDEX `messages_sender_idx` ON `messages` (`mailbox_id`,`sender_address`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_size_idx` ON `messages` (`mailbox_id`,`size_bytes`);--> statement-breakpoint
CREATE INDEX `messages_inbox_page_idx` ON `messages` (`mailbox_id`,`status`,"created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `messages_thread_key_idx` ON `messages` (`mailbox_id`,`status`,coalesce(`thread_id`, `id`),`created_at`);--> statement-breakpoint
CREATE INDEX `messages_mailbox_thread_key_idx` ON `messages` (`mailbox_id`,coalesce(`thread_id`, `id`));--> statement-breakpoint
CREATE INDEX `messages_nav_cover_idx` ON `messages` (`mailbox_id`,`status`,"created_at" desc,"id" desc,`direction`,`read`,`thread_id`,`snoozed_until`,`user_id`,`private_draft`,`project_id`);--> statement-breakpoint
CREATE INDEX `messages_unified_page_idx` ON `messages` (`status`,"created_at" desc,"id" desc,`mailbox_id`,`direction`,`read`,`thread_id`,`snoozed_until`,`user_id`,`private_draft`,`project_id`);--> statement-breakpoint
CREATE INDEX `messages_counts_cover_idx` ON `messages` (`mailbox_id`,`direction`,`status`,`read`,`starred`,`snoozed_until`,`user_id`,`private_draft`,`project_id`);--> statement-breakpoint
CREATE INDEX `messages_conv_cover_idx` ON `messages` (`mailbox_id`,`status`,coalesce(`thread_id`, `id`),`created_at`,`id`,`snoozed_until`);--> statement-breakpoint
CREATE TABLE `mfa_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mfa_recovery_codes_code_hash_unique` ON `mfa_recovery_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `mfa_recovery_codes_user_idx` ON `mfa_recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `outbound_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`error` text,
	`scheduled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `outbound_jobs_user_idx` ON `outbound_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `outbound_jobs_message_idx` ON `outbound_jobs` (`message_id`);--> statement-breakpoint
CREATE TABLE `passkey_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`credential_hash` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT false NOT NULL,
	`aaguid` text,
	`name` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credentials_credential_hash_unique` ON `passkey_credentials` (`credential_hash`);--> statement-breakpoint
CREATE INDEX `passkey_credentials_user_idx` ON `passkey_credentials` (`user_id`);--> statement-breakpoint
CREATE TABLE `passkey_enrollment_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`created_by_user_id` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_enrollment_grants_token_hash_unique` ON `passkey_enrollment_grants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `passkey_enrollment_grants_user_idx` ON `passkey_enrollment_grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`local_part` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_addresses_address_idx` ON `project_addresses` (`domain_id`,`local_part`);--> statement-breakpoint
CREATE INDEX `project_addresses_project_idx` ON `project_addresses` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#4f8cff' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_user_name_idx` ON `projects` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_idx` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_session_idx` ON `push_subscriptions` (`session_id`);--> statement-breakpoint
CREATE TABLE `routing_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`scope` text DEFAULT 'mailbox' NOT NULL,
	`name` text,
	`enabled` integer DEFAULT true NOT NULL,
	`pattern` text NOT NULL,
	`match_field` text DEFAULT 'email' NOT NULL,
	`match_operator` text DEFAULT 'contains' NOT NULL,
	`match_value` text DEFAULT '' NOT NULL,
	`mailbox_id` text,
	`label_id` text,
	`skip_inbox` integer DEFAULT false NOT NULL,
	`action` text DEFAULT 'store' NOT NULL,
	`forward_to` text,
	`keep_copy` integer DEFAULT false NOT NULL,
	`reject_reason` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`last_matched_at` integer,
	`match_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `routing_rules_domain_scope_idx` ON `routing_rules` (`domain_id`,`scope`,`enabled`);--> statement-breakpoint
CREATE INDEX `routing_rules_mailbox_idx` ON `routing_rules` (`mailbox_id`);--> statement-breakpoint
CREATE INDEX `routing_rules_priority_idx` ON `routing_rules` (`priority`);--> statement-breakpoint
CREATE INDEX `routing_rules_user_idx` ON `routing_rules` (`user_id`);--> statement-breakpoint
CREATE INDEX `routing_rules_label_idx` ON `routing_rules` (`label_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `shared_attachment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`attachment_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `message_attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_attachment_links_attachment_id_unique` ON `shared_attachment_links` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `spam_feedback` (
	`message_id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`actor_user_id` text,
	`classification` text NOT NULL,
	`training_tokens` text NOT NULL,
	`reputation_keys` text NOT NULL,
	`tokenizer_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `spam_feedback_mailbox_idx` ON `spam_feedback` (`mailbox_id`);--> statement-breakpoint
CREATE INDEX `spam_feedback_actor_user_idx` ON `spam_feedback` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `spam_reputation` (
	`mailbox_id` text NOT NULL,
	`type` text NOT NULL,
	`key` text NOT NULL,
	`messages_seen` integer DEFAULT 0 NOT NULL,
	`spam_count` integer DEFAULT 0 NOT NULL,
	`ham_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spam_reputation_mailbox_type_key_idx` ON `spam_reputation` (`mailbox_id`,`type`,`key`);--> statement-breakpoint
CREATE INDEX `spam_reputation_mailbox_idx` ON `spam_reputation` (`mailbox_id`);--> statement-breakpoint
CREATE TABLE `spam_token_stats` (
	`mailbox_id` text NOT NULL,
	`token` text NOT NULL,
	`spam_count` integer DEFAULT 0 NOT NULL,
	`ham_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spam_token_stats_mailbox_token_idx` ON `spam_token_stats` (`mailbox_id`,`token`);--> statement-breakpoint
CREATE INDEX `spam_token_stats_mailbox_idx` ON `spam_token_stats` (`mailbox_id`);--> statement-breakpoint
CREATE TABLE `tls_daily_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain_id` text NOT NULL,
	`day` text NOT NULL,
	`row_key` text NOT NULL,
	`reporter_org` text NOT NULL,
	`policy_type` text NOT NULL,
	`mx_host` text,
	`result_type` text NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tls_daily_stats_domain_day_key_idx` ON `tls_daily_stats` (`domain_id`,`day`,`row_key`);--> statement-breakpoint
CREATE INDEX `tls_daily_stats_day_idx` ON `tls_daily_stats` (`day`);--> statement-breakpoint
CREATE TABLE `user_compose_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`track_opens_default` integer DEFAULT false NOT NULL,
	`undo_send_seconds` integer DEFAULT 15 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`reset_email` text,
	`forwarding_email` text,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`time_zone` text,
	`avatar_key` text,
	`role` text DEFAULT 'user' NOT NULL,
	`is_primary_admin` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`can_manage_mailboxes` integer DEFAULT false NOT NULL,
	`can_manage_domains` integer DEFAULT false NOT NULL,
	`can_manage_users` integer DEFAULT false NOT NULL,
	`calendar_enabled` integer DEFAULT true NOT NULL,
	`keyboard_shortcuts_enabled` integer DEFAULT true NOT NULL,
	`spam_protection_enabled` integer DEFAULT true NOT NULL,
	`spam_strictness` text DEFAULT 'strict' NOT NULL,
	`trash_retention_days` integer,
	`show_full_recipient_addresses` integer DEFAULT false NOT NULL,
	`remote_content_mode` text DEFAULT 'allow' NOT NULL,
	`totp_secret` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`totp_confirmed_at` integer,
	`totp_last_step` integer,
	`require_second_factor` integer DEFAULT false NOT NULL,
	`passkey_count` integer DEFAULT 0 NOT NULL,
	`security_version` integer DEFAULT 0 NOT NULL,
	`last_sign_in_at` integer,
	`deleted_at` integer,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_created_by_idx` ON `users` (`created_by_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_one_primary_admin` ON `users` (`is_primary_admin`) WHERE "users"."is_primary_admin" = 1;--> statement-breakpoint
CREATE TABLE `webauthn_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`ceremony_hash` text NOT NULL,
	`challenge` text NOT NULL,
	`purpose` text NOT NULL,
	`user_id` text,
	`binding_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webauthn_challenges_ceremony_hash_unique` ON `webauthn_challenges` (`ceremony_hash`);--> statement-breakpoint
CREATE INDEX `webauthn_challenges_user_idx` ON `webauthn_challenges` (`user_id`);--> statement-breakpoint
CREATE INDEX `webauthn_challenges_expires_idx` ON `webauthn_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`error` text,
	`duration_ms` integer,
	`last_attempt_at` integer,
	`next_retry_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_status_idx` ON `webhook_deliveries` (`status`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`description` text,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_user_idx` ON `webhooks` (`user_id`);