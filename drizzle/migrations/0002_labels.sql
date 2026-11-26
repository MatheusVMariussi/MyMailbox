-- Labels replace folders: `folders` becomes `labels`, and messages carry any number of labels through `message_labels`
-- instead of one `folder_id`. A label never takes a message out of the inbox; status alone decides Inbox, Archive, Trash.
-- Each statement ends with a statement-breakpoint marker (never inside a trigger body).
--
-- `messages.folder_id` stays as an always-null column: SQLite cannot drop a column named by a table-level foreign key,
-- and rebuilding `messages` on D1 (where foreign keys cannot be switched off inside a migration) would cascade-delete
-- its attachments, notes and other children. `messages_folder_idx` stays too, so deleting a label (whose ON DELETE
-- SET NULL action looks the column up) does not scan every message.
--
-- The folder triggers are dropped before the rename and recreated under label names afterwards, so the rename never
-- has to rewrite a trigger body.
DROP TRIGGER `jmap_changes_folders_ai`;
--> statement-breakpoint
DROP TRIGGER `jmap_changes_folders_au`;
--> statement-breakpoint
DROP TRIGGER `jmap_changes_folders_ad`;
--> statement-breakpoint
DROP TRIGGER `jmap_folders_ai`;
--> statement-breakpoint
DROP TRIGGER `jmap_folders_au`;
--> statement-breakpoint
DROP TRIGGER `jmap_folders_au_old`;
--> statement-breakpoint
DROP TRIGGER `jmap_folders_ad`;
--> statement-breakpoint
ALTER TABLE `folders` RENAME TO `labels`;
--> statement-breakpoint
DROP INDEX `folders_mailbox_name_idx`;
--> statement-breakpoint
DROP INDEX `folders_user_idx`;
--> statement-breakpoint
DROP INDEX `folders_mailbox_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_mailbox_name_idx` ON `labels` (`mailbox_id`,`name`);
--> statement-breakpoint
CREATE INDEX `labels_user_idx` ON `labels` (`user_id`);
--> statement-breakpoint
CREATE INDEX `labels_mailbox_idx` ON `labels` (`mailbox_id`);
--> statement-breakpoint
CREATE TABLE `message_labels` (
	`message_id` text NOT NULL,
	`label_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_labels_message_label_idx` ON `message_labels` (`message_id`,`label_id`);
--> statement-breakpoint
CREATE INDEX `message_labels_label_message_idx` ON `message_labels` (`label_id`,`message_id`);
--> statement-breakpoint
-- Existing folder memberships become labels. A filed message left the inbox, so filed mail that still reads `received`
-- is archived, and sent mail that a folder move rewrote to `received` goes back to `sent` (private drafts never do).
INSERT INTO `message_labels` (`message_id`, `label_id`)
SELECT `id`, `folder_id` FROM `messages` WHERE `folder_id` IS NOT NULL AND `mailbox_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `messages`
SET `status` = CASE WHEN `direction` = 'outbound' AND `private_draft` = 0 THEN 'sent' ELSE 'archived' END
WHERE `folder_id` IS NOT NULL AND `status` = 'received';
--> statement-breakpoint
UPDATE `messages` SET `folder_id` = NULL WHERE `folder_id` IS NOT NULL;
--> statement-breakpoint
DROP INDEX `messages_inbox_page_idx`;
--> statement-breakpoint
DROP INDEX `messages_thread_key_idx`;
--> statement-breakpoint
DROP INDEX `messages_nav_cover_idx`;
--> statement-breakpoint
DROP INDEX `messages_counts_cover_idx`;
--> statement-breakpoint
DROP INDEX `messages_category_page_idx`;
--> statement-breakpoint
DROP INDEX `messages_category_count_idx`;
--> statement-breakpoint
CREATE INDEX `messages_inbox_page_idx` ON `messages` (`mailbox_id`,`status`,"created_at" desc,"id" desc);
--> statement-breakpoint
CREATE INDEX `messages_thread_key_idx` ON `messages` (`mailbox_id`,`status`,coalesce(`thread_id`, `id`),`created_at`);
--> statement-breakpoint
CREATE INDEX `messages_nav_cover_idx` ON `messages` (`mailbox_id`,`status`,"created_at" desc,"id" desc,`direction`,`read`,`thread_id`,`snoozed_until`,`user_id`,`private_draft`);
--> statement-breakpoint
CREATE INDEX `messages_counts_cover_idx` ON `messages` (`mailbox_id`,`direction`,`status`,`read`,`starred`,`snoozed_until`,`user_id`,`private_draft`);
--> statement-breakpoint
CREATE INDEX `messages_category_page_idx` ON `messages` (`mailbox_id`,`category`,`status`,"created_at" desc,"id" desc);
--> statement-breakpoint
CREATE INDEX `messages_category_count_idx` ON `messages` (`mailbox_id`,`category`,`direction`,`status`,`read`,`snoozed_until`);
--> statement-breakpoint
-- Mailbox rules: a store rule names a label, and `skip_inbox` archives what it matches.
ALTER TABLE `routing_rules` RENAME COLUMN `folder_id` TO `label_id`;
--> statement-breakpoint
DROP INDEX `routing_rules_folder_idx`;
--> statement-breakpoint
CREATE INDEX `routing_rules_label_idx` ON `routing_rules` (`label_id`);
--> statement-breakpoint
ALTER TABLE `routing_rules` ADD `skip_inbox` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- JMAP change log and mailbox revisions for labels (the former folder triggers, renamed).
CREATE TRIGGER `jmap_changes_labels_ai` AFTER INSERT ON `labels` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change) VALUES (NEW.mailbox_id, 'mailbox', NEW.id, 'created');
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_labels_au` AFTER UPDATE ON `labels` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change)
	SELECT OLD.mailbox_id, 'mailbox', OLD.id, 'destroyed' WHERE OLD.mailbox_id IS NOT NEW.mailbox_id;
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change)
	VALUES (NEW.mailbox_id, 'mailbox', NEW.id, CASE WHEN OLD.mailbox_id IS NEW.mailbox_id THEN 'updated' ELSE 'created' END);
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_labels_ad` AFTER DELETE ON `labels` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, change) VALUES (OLD.mailbox_id, 'mailbox', OLD.id, 'destroyed');
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_labels_ai` AFTER INSERT ON `labels` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_labels_au` AFTER UPDATE ON `labels` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (NEW.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_labels_au_old` AFTER UPDATE OF mailbox_id ON `labels`
WHEN OLD.mailbox_id IS NOT NEW.mailbox_id BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (OLD.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_labels_ad` AFTER DELETE ON `labels` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision) VALUES (OLD.mailbox_id, 1)
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
-- A label and its message always share a mailbox; the service checks first, this keeps every other writer honest.
CREATE TRIGGER `message_labels_same_mailbox_bi` BEFORE INSERT ON `message_labels`
WHEN (SELECT mailbox_id FROM labels WHERE id = NEW.label_id) IS NOT (SELECT mailbox_id FROM messages WHERE id = NEW.message_id) BEGIN
	SELECT RAISE(ABORT, 'label-mailbox-mismatch');
END;
--> statement-breakpoint
-- Adding or removing a label updates the Email (its mailboxIds change) and bumps its mailbox revision, which also wakes
-- the realtime heartbeat. A membership removed because its message is being deleted finds no message row and writes
-- nothing: the message's own delete trigger already reported it destroyed.
CREATE TRIGGER `jmap_changes_message_labels_ai` AFTER INSERT ON `message_labels` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, thread_id, change)
	SELECT mailbox_id, 'email', id, coalesce(thread_id, id), 'updated' FROM messages WHERE id = NEW.message_id AND mailbox_id IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_changes_message_labels_ad` AFTER DELETE ON `message_labels` BEGIN
	INSERT INTO jmap_changes (mailbox_id, object_type, object_id, thread_id, change)
	SELECT mailbox_id, 'email', id, coalesce(thread_id, id), 'updated' FROM messages WHERE id = OLD.message_id AND mailbox_id IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_message_labels_ai` AFTER INSERT ON `message_labels` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision)
	SELECT mailbox_id, 1 FROM messages WHERE id = NEW.message_id AND mailbox_id IS NOT NULL
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `jmap_message_labels_ad` AFTER DELETE ON `message_labels` BEGIN
	INSERT INTO jmap_mailbox_revisions (mailbox_id, revision)
	SELECT mailbox_id, 1 FROM messages WHERE id = OLD.message_id AND mailbox_id IS NOT NULL
	ON CONFLICT(mailbox_id) DO UPDATE SET revision = revision + 1;
END;
