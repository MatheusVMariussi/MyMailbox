-- Projects: named, colored identities that own whole domains or single addresses. A message carries the
-- project of its own address (the envelope recipient for inbound mail, From otherwise), so one unified
-- inbox can show and filter mail by project. Each statement ends with a statement-breakpoint marker.
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
CREATE UNIQUE INDEX `projects_user_name_idx` ON `projects` (`user_id`,`name`);
--> statement-breakpoint
-- An empty local part owns the whole domain; an address belongs to at most one project.
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
CREATE UNIQUE INDEX `project_addresses_address_idx` ON `project_addresses` (`domain_id`,`local_part`);
--> statement-breakpoint
CREATE INDEX `project_addresses_project_idx` ON `project_addresses` (`project_id`);
--> statement-breakpoint
-- `delivered_to` is the lower-cased bare envelope recipient (inbound only). `project_id` has no foreign key on
-- purpose: an ON DELETE SET NULL action would rewrite every stamped message, firing the per-row message triggers.
ALTER TABLE `messages` ADD `delivered_to` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `project_id` text;
--> statement-breakpoint
-- The unified inbox (every accessible mailbox) pages by status and date across mailboxes; without this index
-- each page sorts the whole cross-mailbox folder. The tail columns keep the filters on the index, and the new
-- columns (physically late in the row, after the bodies) must be covered too.
CREATE INDEX `messages_unified_page_idx` ON `messages` (`status`,"created_at" desc,"id" desc,`mailbox_id`,`direction`,`read`,`thread_id`,`snoozed_until`,`user_id`,`private_draft`,`project_id`);
--> statement-breakpoint
DROP INDEX `messages_nav_cover_idx`;
--> statement-breakpoint
CREATE INDEX `messages_nav_cover_idx` ON `messages` (`mailbox_id`,`status`,"created_at" desc,"id" desc,`direction`,`read`,`thread_id`,`snoozed_until`,`user_id`,`private_draft`,`project_id`);
--> statement-breakpoint
DROP INDEX `messages_counts_cover_idx`;
--> statement-breakpoint
CREATE INDEX `messages_counts_cover_idx` ON `messages` (`mailbox_id`,`direction`,`status`,`read`,`starred`,`snoozed_until`,`user_id`,`private_draft`,`project_id`);
--> statement-breakpoint
DROP INDEX `messages_category_count_idx`;
--> statement-breakpoint
CREATE INDEX `messages_category_count_idx` ON `messages` (`mailbox_id`,`category`,`direction`,`status`,`read`,`snoozed_until`,`project_id`);
