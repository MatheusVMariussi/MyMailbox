-- Security hardening before the first deploy. Each statement ends with a statement-breakpoint marker.
-- Only one account can be the primary admin: first-run setup closes once it exists, so two concurrent
-- registrations must not both create one.
CREATE UNIQUE INDEX `users_one_primary_admin` ON `users` (`is_primary_admin`) WHERE "users"."is_primary_admin" = 1;
--> statement-breakpoint
