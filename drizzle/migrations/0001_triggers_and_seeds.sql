-- Everything drizzle-kit does not generate from src/db/schema/index.ts: the FTS5 search index, triggers and seed rows.
-- Each statement ends with a statement-breakpoint marker (never inside a trigger body): the bundle splitter
-- (scripts/generate-migration-bundle.mjs), the test helper (tests/helpers/migrate.ts) and `wrangler d1 migrations apply`
-- all read this file. Triggers keep the creation order of the migration history they replace, so they fire in the same order.
CREATE VIRTUAL TABLE `messages_fts` USING fts5(
	`subject`,
	`from_addr`,
	`to_addr`,
	`cc_addr`,
	`text_body`,
	`html_body`,
	content='messages',
	content_rowid='rowid',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- Full-text search: an external-content FTS5 index over messages, kept current by these triggers (no application code writes it).
CREATE TRIGGER `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `messages_fts`(`rowid`, `subject`, `from_addr`, `to_addr`, `cc_addr`, `text_body`, `html_body`)
	VALUES (new.`rowid`, new.`subject`, new.`from_addr`, new.`to_addr`, new.`cc_addr`, new.`text_body`, new.`html_body`);
END;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_ad` AFTER DELETE ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, `rowid`, `subject`, `from_addr`, `to_addr`, `cc_addr`, `text_body`, `html_body`)
	VALUES ('delete', old.`rowid`, old.`subject`, old.`from_addr`, old.`to_addr`, old.`cc_addr`, old.`text_body`, old.`html_body`);
END;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_au` AFTER UPDATE OF `subject`, `from_addr`, `to_addr`, `cc_addr`, `text_body`, `html_body` ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, `rowid`, `subject`, `from_addr`, `to_addr`, `cc_addr`, `text_body`, `html_body`)
	VALUES ('delete', old.`rowid`, old.`subject`, old.`from_addr`, old.`to_addr`, old.`cc_addr`, old.`text_body`, old.`html_body`);
	INSERT INTO `messages_fts`(`rowid`, `subject`, `from_addr`, `to_addr`, `cc_addr`, `text_body`, `html_body`)
	VALUES (new.`rowid`, new.`subject`, new.`from_addr`, new.`to_addr`, new.`cc_addr`, new.`text_body`, new.`html_body`);
END;
--> statement-breakpoint
-- Trash and Spam retention: trashed_at records when a message entered either status.
CREATE TRIGGER `messages_trashed_at_ai` AFTER INSERT ON `messages` WHEN new.`status` IN ('trash', 'spam') BEGIN
	UPDATE `messages` SET `trashed_at` = CAST(strftime('%s', 'now') AS integer) WHERE `rowid` = new.`rowid`;
END;
--> statement-breakpoint
CREATE TRIGGER `messages_trashed_at_au` AFTER UPDATE OF `status` ON `messages` WHEN (new.`status` IN ('trash', 'spam')) <> (old.`status` IN ('trash', 'spam')) BEGIN
	UPDATE `messages` SET `trashed_at` = CASE WHEN new.`status` IN ('trash', 'spam') THEN CAST(strftime('%s', 'now') AS integer) ELSE NULL END WHERE `rowid` = new.`rowid`;
END;
--> statement-breakpoint
-- JMAP change log (Email/changes, Mailbox/changes, Thread/changes): one row per created, updated or destroyed message, folder or mailbox.
CREATE TRIGGER `jmap_changes_messages_ai` AFTER INSERT ON `messages`
WHEN NEW.mailbox_id IS NOT NULL BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, thread_id, change)
	VALUES (NEW.mailbox_id, 'email', NEW.id, coalesce(NEW.thread_id, NEW.id), 'created');
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_messages_au` AFTER UPDATE ON `messages`
WHEN NEW.mailbox_id IS NOT NULL AND OLD.mailbox_id IS NEW.mailbox_id BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, thread_id, change)
	VALUES (NEW.mailbox_id, 'email', NEW.id, coalesce(NEW.thread_id, NEW.id), 'updated');
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_messages_au_moved` AFTER UPDATE OF mailbox_id ON `messages`
WHEN OLD.mailbox_id IS NOT NEW.mailbox_id BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, thread_id, change)
	SELECT OLD.mailbox_id, 'email', OLD.id, coalesce(OLD.thread_id, OLD.id), 'destroyed' WHERE OLD.mailbox_id IS NOT NULL;
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, thread_id, change)
	SELECT NEW.mailbox_id, 'email', NEW.id, coalesce(NEW.thread_id, NEW.id), 'created' WHERE NEW.mailbox_id IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_messages_ad` AFTER DELETE ON `messages`
WHEN OLD.mailbox_id IS NOT NULL BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, thread_id, change)
	VALUES (OLD.mailbox_id, 'email', OLD.id, coalesce(OLD.thread_id, OLD.id), 'destroyed');
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_folders_ai` AFTER INSERT ON `folders` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change) VALUES (NEW.mailbox_id, 'mailbox', NEW.id, 'created');
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_folders_au` AFTER UPDATE ON `folders` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change)
	SELECT OLD.mailbox_id, 'mailbox', OLD.id, 'destroyed' WHERE OLD.mailbox_id IS NOT NEW.mailbox_id;
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change)
	VALUES (NEW.mailbox_id, 'mailbox', NEW.id, CASE WHEN OLD.mailbox_id IS NEW.mailbox_id THEN 'updated' ELSE 'created' END);
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_folders_ad` AFTER DELETE ON `folders` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change) VALUES (OLD.mailbox_id, 'mailbox', OLD.id, 'destroyed');
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_mailboxes_au` AFTER UPDATE ON `mailboxes` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change) VALUES (NEW.id, 'mailbox', NEW.id, 'updated');
END;
--> statement-breakpoint
-- Passkey invariants: users.passkey_count follows passkey_credentials, and an account never loses its last sign-in method.
CREATE TRIGGER `passkey_credentials_count_insert` AFTER INSERT ON `passkey_credentials`
BEGIN
	UPDATE `users` SET `passkey_count` = `passkey_count` + 1 WHERE `id` = NEW.`user_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `passkey_credentials_count_delete` AFTER DELETE ON `passkey_credentials`
BEGIN
	UPDATE `users` SET `passkey_count` = `passkey_count` - 1 WHERE `id` = OLD.`user_id`;
	UPDATE `users` SET `require_second_factor` = 0
	WHERE `id` = OLD.`user_id`
		AND `passkey_count` = 0
		AND `totp_enabled` = 0
		AND `deleted_at` IS NULL;
	SELECT RAISE(ABORT, 'last-auth-method')
	WHERE (SELECT `passkey_count` FROM `users` WHERE `id` = OLD.`user_id`) = 0
		AND (SELECT `deleted_at` FROM `users` WHERE `id` = OLD.`user_id`) IS NULL
		AND (SELECT `password_hash` FROM `users` WHERE `id` = OLD.`user_id`) = '!passkey-only';
END;
--> statement-breakpoint
CREATE TRIGGER `users_last_password_update` BEFORE UPDATE OF `password_hash` ON `users`
WHEN NEW.`password_hash` = '!passkey-only' AND NEW.`passkey_count` = 0
BEGIN
	SELECT RAISE(ABORT, 'last-auth-method');
END;
--> statement-breakpoint
CREATE TRIGGER `users_require_second_factor_update` BEFORE UPDATE OF `require_second_factor` ON `users`
WHEN NEW.`require_second_factor` = 1 AND NEW.`passkey_count` = 0 AND NEW.`totp_enabled` = 0 AND NEW.`deleted_at` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'second-factor-unavailable');
END;
--> statement-breakpoint
-- JMAP mailbox revisions: a per-mailbox counter bumped by every change to its messages, folders, aliases or settings.
CREATE TRIGGER `jmap_messages_ai` AFTER INSERT ON `messages`
WHEN NEW.mailbox_id IS NOT NULL BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_messages_au` AFTER UPDATE ON `messages`
WHEN NEW.mailbox_id IS NOT NULL BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_messages_au_old` AFTER UPDATE OF mailbox_id ON `messages`
WHEN OLD.mailbox_id IS NOT NULL AND OLD.mailbox_id IS NOT NEW.mailbox_id BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (OLD.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_messages_ad` AFTER DELETE ON `messages`
WHEN OLD.mailbox_id IS NOT NULL BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (OLD.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_folders_ai` AFTER INSERT ON `folders` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_folders_au` AFTER UPDATE ON `folders` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_folders_au_old` AFTER UPDATE OF mailbox_id ON `folders`
WHEN OLD.mailbox_id IS NOT NEW.mailbox_id BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (OLD.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_folders_ad` AFTER DELETE ON `folders` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (OLD.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_mailboxes_au` AFTER UPDATE ON `mailboxes` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_mailbox_aliases_ai` AFTER INSERT ON `mailbox_aliases` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_mailbox_aliases_au` AFTER UPDATE ON `mailbox_aliases` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_mailbox_aliases_au_old` AFTER UPDATE OF mailbox_id ON `mailbox_aliases`
WHEN OLD.mailbox_id IS NOT NEW.mailbox_id BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (OLD.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_mailbox_aliases_ad` AFTER DELETE ON `mailbox_aliases` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (OLD.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
-- Seed rows: the singleton settings rows and the JMAP change-log floor.
INSERT INTO `backup_settings` (`id`, `enabled`, `schedule_type`, `retention_enabled`, `retention_days`, `updated_at`)
VALUES ('default', false, 'daily', false, 30, unixepoch());
--> statement-breakpoint
INSERT INTO `app_settings` (`id`, `app_name`, `updated_at`)
VALUES ('default', 'Mailflare', unixepoch());
--> statement-breakpoint
INSERT INTO `jmap_change_floor` (`id`, `seq`) VALUES (1, 0);
