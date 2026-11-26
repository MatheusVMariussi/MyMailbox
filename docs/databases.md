# Database

MyMailbox stores its data in **Cloudflare D1** (SQLite). Nothing needs configuring: deploy with the `DB` binding from `wrangler.jsonc`. Raw mail, attachments and backups live in R2, not in the database.

## Migrations

Migrations are plain SQL files in `drizzle/migrations/`, recorded in the `d1_migrations` table that Wrangler also uses. They are applied by any of:

- the setup flow (`/setup`) on an empty database,
- **Update database** on the admin overview's database card (the in-app runner, `src/lib/migrations/service.ts`, which applies the bundled copy `src/lib/migrations/bundle.json`),
- `npm run db:migrate:remote` (or `npm run db:migrate:local` for the local development database).

The history starts from a baseline: `0000_baseline.sql` (tables and indexes, generated from `src/db/schema/index.ts`) and `0001_triggers_and_seeds.sql` (the search index, triggers and seed rows). A new database applies both and is complete. MyMailbox databases created from the old migration history cannot be upgraded in place; move their data with a fresh install (backups from MyMailbox's older format do not restore either).

Changing the schema means adding the next migration file:

```bash
npm run db:generate   # drizzle-kit generate -> drizzle/migrations/000N_<name>.sql
npm run db:bundle     # rebuild src/lib/migrations/bundle.json (commit it)
```

A hand-written migration also needs its entry in `drizzle/migrations/meta/_journal.json`, and every statement must end with `--> statement-breakpoint` (never inside a trigger body). Never edit a migration that has already been applied; add a new one. `tests/database-schema.test.mjs` fails when the bundle or journal is stale or when the migrations no longer produce the schema's tables and columns.

## Search

Message search uses an FTS5 table (`messages_fts`) kept current by triggers. An administrator can rebuild it through `POST /api/admin/search-index`. `wrangler d1 export` does not work on databases with virtual tables; use **Admin → Backups** instead.
