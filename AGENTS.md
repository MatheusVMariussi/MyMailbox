# Repository agent instructions

## Database schema changes

The database is Cloudflare D1 (SQLite). `drizzle/migrations/` starts from a squashed baseline: `0000_baseline.sql` (generated from `src/db/schema/index.ts`) and `0001_triggers_and_seeds.sql` (hand-written FTS5 table, triggers and seed rows). Any change to the schema (table, column, index, default) **must ship a new migration in the same change**:

1. Add `drizzle/migrations/000N_<name>.sql`: run `npm run db:generate`, or hand-write the SQL in the generated style and add a matching entry to `drizzle/migrations/meta/_journal.json` (next `idx`, `tag` = file name without `.sql`, `breakpoints: true`).
2. End every statement with `--> statement-breakpoint`, never inside a trigger body (the bundle splitter, `tests/helpers/migrate.ts` and `wrangler d1 migrations apply` all read the file).
3. `npm run db:bundle` to refresh `src/lib/migrations/bundle.json` (commit it).
4. Run `node --test tests/*.test.mjs` (`tests/database-schema.test.mjs` fails if the bundle or journal is stale or the migrations no longer produce exactly the schema's tables and columns).

Never edit an already-applied migration; add a new one.

## Database backup and restore

- Whenever a migration creates, renames, or removes a persisted table, update the backup and restore table lists in the same change, even if the feature is unrelated to backups. Review `BACKUP_TABLES` and `INTERNAL_TABLES` in `src/lib/backups/export.ts`, `BACKUP_TABLE_GROUPS` in `src/lib/backups/table-groups.ts`, and `DatabaseBackupTable` in `src/lib/backups/types.d.ts`.
- Put every backed-up table in exactly one group. Keep `BACKUP_TABLES` in foreign-key dependency order so restore inserts parents before children and deletes them in reverse order. Exclude a table only when its contents are derived or internally managed, and document why.
- When adding a table or column, check backup and restore behavior both before and after its migration is applied (restore drops columns the target lacks and refuses rows for a table it lacks). Keep backup documents of the current format (version 3) restorable.
