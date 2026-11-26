# Repository agent instructions

## Database schema changes

The database is Cloudflare D1 (SQLite). Any change to `src/db/schema/index.ts` (table, column, index, default) **must ship a migration in the same change**:

1. Add the migration to `drizzle/migrations/` (`npm run db:generate`, or a hand-written SQL file in the generated style when drizzle-kit prompts).
2. `npm run db:bundle` to refresh `src/lib/migrations/bundle.json` (commit it).
3. Run `node --test tests/*.test.mjs` (`tests/database-schema.test.mjs` fails if the bundle is stale or the migrations no longer produce the schema).

Never edit an already-applied migration; add a new one.

## Database backup and restore

- Whenever a migration creates, renames, or removes a persisted table, update the backup and restore table lists in the same change, even if the feature is unrelated to backups. Review `BACKUP_TABLES` and `INTERNAL_TABLES` in `src/lib/backups/export.ts`, `BACKUP_TABLE_GROUPS` in `src/lib/backups/table-groups.ts`, and `DatabaseBackupTable` in `src/lib/backups/types.d.ts`.
- Put every backed-up table in exactly one group. Keep `BACKUP_TABLES` in foreign-key dependency order so restore inserts parents before children and deletes them in reverse order. Exclude a table only when its contents are derived or internally managed, and document why.
- When adding a table, check backup and restore behavior both before and after its migration is applied. Keep older full backup documents restorable.
