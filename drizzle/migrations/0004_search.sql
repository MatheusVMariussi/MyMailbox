-- Gmail-style search: the full-text index gains Bcc (bcc:), and every message stores its size (larger:/smaller:).
-- The FTS5 table cannot take a new column, so it is dropped with its triggers and rebuilt from `messages`
-- (`rebuild` re-reads every row; on an empty database it does nothing). Each statement ends with a
-- statement-breakpoint marker, never inside a trigger body.
DROP TRIGGER `messages_fts_ai`;
--> statement-breakpoint
DROP TRIGGER `messages_fts_ad`;
--> statement-breakpoint
DROP TRIGGER `messages_fts_au`;
--> statement-breakpoint
DROP TABLE `messages_fts`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `messages_fts` USING fts5(
	`subject`,
	`from_addr`,
	`to_addr`,
	`cc_addr`,
	`bcc_addr`,
	`text_body`,
	`html_body`,
	content='messages',
	content_rowid='rowid',
	tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `messages_fts_ai` AFTER INSERT ON `messages` BEGIN
	INSERT INTO `messages_fts`(`rowid`, `subject`, `from_addr`, `to_addr`, `cc_addr`, `bcc_addr`, `text_body`, `html_body`)
	VALUES (new.`rowid`, new.`subject`, new.`from_addr`, new.`to_addr`, new.`cc_addr`, new.`bcc_addr`, new.`text_body`, new.`html_body`);
END;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_ad` AFTER DELETE ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, `rowid`, `subject`, `from_addr`, `to_addr`, `cc_addr`, `bcc_addr`, `text_body`, `html_body`)
	VALUES ('delete', old.`rowid`, old.`subject`, old.`from_addr`, old.`to_addr`, old.`cc_addr`, old.`bcc_addr`, old.`text_body`, old.`html_body`);
END;
--> statement-breakpoint
CREATE TRIGGER `messages_fts_au` AFTER UPDATE OF `subject`, `from_addr`, `to_addr`, `cc_addr`, `bcc_addr`, `text_body`, `html_body` ON `messages` BEGIN
	INSERT INTO `messages_fts`(`messages_fts`, `rowid`, `subject`, `from_addr`, `to_addr`, `cc_addr`, `bcc_addr`, `text_body`, `html_body`)
	VALUES ('delete', old.`rowid`, old.`subject`, old.`from_addr`, old.`to_addr`, old.`cc_addr`, old.`bcc_addr`, old.`text_body`, old.`html_body`);
	INSERT INTO `messages_fts`(`rowid`, `subject`, `from_addr`, `to_addr`, `cc_addr`, `bcc_addr`, `text_body`, `html_body`)
	VALUES (new.`rowid`, new.`subject`, new.`from_addr`, new.`to_addr`, new.`cc_addr`, new.`bcc_addr`, new.`text_body`, new.`html_body`);
END;
--> statement-breakpoint
INSERT INTO `messages_fts`(`messages_fts`) VALUES ('rebuild');
--> statement-breakpoint
-- Bytes: the raw MIME for received and imported mail, text + HTML + attachments for sent mail. Mail stored
-- before this migration (and drafts) keep 0, which search reads as "unknown" (never smaller than anything).
ALTER TABLE `messages` ADD `size_bytes` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `messages_size_idx` ON `messages` (`mailbox_id`,`size_bytes`);
