# Database

Mailflare stores its data in **Cloudflare D1** (SQLite). Nothing needs configuring: deploy with the `DB` binding from `wrangler.jsonc`. Raw mail, attachments and backups live in R2, not in the database.

## Migrations

Migrations are plain SQL files in `drizzle/migrations/`, recorded in the `d1_migrations` table that Wrangler also uses. They are applied by any of:

- the setup flow (`/setup`) on an empty database,
- **Update database** on the admin overview's database card (the in-app runner, `src/lib/migrations/service.ts`, which applies the bundled copy `src/lib/migrations/bundle.json`),
- `npm run db:migrate:remote` (or `npm run db:migrate:local` for the local development database).

Changing the schema (`src/db/schema/index.ts`) means adding a migration:

```bash
npm run db:generate   # drizzle-kit generate -> drizzle/migrations
npm run db:bundle     # rebuild src/lib/migrations/bundle.json (commit it)
```

Never edit a migration that has already been applied; add a new one. `tests/database-schema.test.mjs` fails when the bundle is stale or when the migrations no longer produce the schema's tables and columns.

## Search

Message search uses an FTS5 table (`messages_fts`) kept current by triggers. An administrator can rebuild it through `POST /api/admin/search-index`. `wrangler d1 export` does not work on databases with virtual tables; use **Admin → Backups** instead.
