-- Resend is no longer a provider: Cloudflare Email Routing receives and Cloudflare Email Sending sends.
-- Rows still naming Resend get the value the app now understands (DNS is left as it is; the Domains page
-- shows what still needs setting up), then the app_settings columns that only held Resend data are dropped.
-- None of them is indexed, part of a key, referenced by a foreign key or read by a trigger.
UPDATE `domains` SET `sending_provider` = 'none' WHERE `sending_provider` = 'resend';--> statement-breakpoint
UPDATE `domains` SET `receiving_provider` = 'cloudflare' WHERE `receiving_provider` = 'resend';--> statement-breakpoint
UPDATE `email_suppressions` SET `source` = 'admin' WHERE `source` = 'resend';--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `resend_api_key`;--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `resend_webhook_id`;--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `resend_webhook_secret`;--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `resend_events_webhook_id`;--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `resend_events_webhook_secret`;
