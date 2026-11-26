# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MyMailbox is a personal webmail (email and calendar) on Cloudflare Workers, D1 and R2. It is a hard fork of Mailflare 0.5.5 (AGPL-3.0, by Hieu Nguyen), pruned to email and calendar; `LICENSE` keeps the upstream notice unchanged. See "Naming and upstream compatibility" below before renaming anything.

> **Schema or migration change?** See "Database schema changes" in AGENTS.md and "Schema and migrations" below.

## Commands

```bash
npm run dev                    # Vite + vinext in local workerd
npm run lint                   # vp lint (Oxlint, lint.config.ts)
npm run build                  # vinext build, including the complete Worker

npm run db:generate            # drizzle-kit generate (SQLite) from src/db/schema/index.ts
npm run db:bundle              # package drizzle/migrations into src/lib/migrations/bundle.json
npm run db:migrate:local       # wrangler d1 migrations apply DB --local
npm run db:migrate:remote      # --remote (needs a concrete database_id in wrangler.jsonc)
npm run db:seed                # POST /api/seed against localhost:3000

npm run deploy                 # vinext build + wrangler deploy; migrate later from Admin settings
npm run preview                # build and preview the vinext Worker locally
npm run cf-typegen             # regenerate cloudflare-env.d.ts from wrangler.jsonc
```

There is no test script in `package.json`; the checks under `tests/` are `node:test` files run with `node --test tests/*.test.mjs` (pass the glob — on Node 24 a bare `tests/` is read as a module path). They must not need Workers bindings, so anything that reaches D1 or R2 belongs in a script under `scripts/` run against `npm run dev` instead.

`next.config.ts` sets `typescript.ignoreBuildErrors: true` and `tsconfig.json` sets `noImplicitAny: false`, so the build will not catch type errors. Run `npx tsc --noEmit` if you want real type checking.

`npm run deploy` builds with vinext and uploads with Wrangler. The Cloudflare Vite plugin generates `dist/server/wrangler.json` and redirects Wrangler to it, preserving the custom `worker.ts` entrypoint.

## Architecture

Next.js App Router APIs running on Cloudflare Workers via vinext. Drizzle ORM over D1, R2 for raw MIME, attachments, and record backups, Queues for async mail processing, a Durable Object for realtime, and a cron trigger for scheduled backups.

### worker.ts is the entrypoint

`worker.ts` wraps `vinext/server/fetch-handler` and adds handlers Next.js cannot express:

- **`fetch`** — intercepts `/api/realtime` for the WebSocket upgrade (authenticates the session cookie, then routes to `env.REALTIME.getByName(user.id)`), delegating everything else to vinext.
- **`email`** — the Cloudflare Email Routing handler. Resolves domain routing rules first (`resolveIncomingMail` in `src/lib/email/incoming.ts`) because `message.setReject()` and `message.forward()` only exist here, then applies optional account-level forwarding (loop-guarded by the `MYMAILBOX_FORWARDED_HEADER`, `X-MyMailbox-Forwarded`), writes raw MIME to R2, and enqueues to `INBOUND_QUEUE`. It never parses mail inline.
- **`queue`** — a single consumer for both queues (inbound, outbound); `isInboundQueueMessage` and `isWebhookRetryMessage` in `worker-utils.ts` discriminate inbound mail, webhook retries, and outbound payloads. Failures `retry({ delaySeconds: 10 })` until the queue's `max_retries` (inbound 12; retries are idempotent because inbound skips an already-stored `rawR2Key`); inbound mail that fails on a missing column or table (migration not applied yet) retries every 300 s instead (`settleFailedInboundMessage`, inbound `max_retries` 12, about an hour), see `docs/deployment.md`.

It also re-exports `RealtimeHub`, which must remain exported from the Worker entrypoint.

### Mail pipeline

Inbound: `email` handler → R2 → queue → `processInboundMessage` (`src/lib/email/inbound.ts`) → `resolveInboundAddress` routing decision (deliver / reject / forward) → `parseRawMime` (postal-mime) → insert message + attachments → upsert contacts → `dispatchWebhooks` → `notifyUsersOfNewMessage` over the Durable Object.

Outbound: `src/lib/email/send.ts` / `sender.ts`, composing with mimetext and sending through the `EMAIL` send_email binding, with `outbound_jobs` rows tracking queued sends. `to`, `cc` and `bcc` accept a header string or an array; `toAddr`/`ccAddr`/`bccAddr` on `messages` store the full comma-joined lists (use `splitEmailAddressList` from `src/lib/email/address.ts`, not `getEmailAddress`, when a value may be a list).

Composer: `src/components/compose/rich-text-editor.tsx` is a contentEditable HTML editor; the body is one HTML string and the text/plain part is derived with `htmlToPlainText` (`rich-text-utils.ts`). Quoted/forwarded content is wrapped by `wrapQuotedHtml` (`<div class="mymailbox-quote" data-mymailbox-quote="1">`) and folded by both the composer and the reader (`splitQuotedHtml`, which also folds the wrapper upstream Mailflare writes). Forward copies the source's attachments onto the draft (`copyMessageAttachments`); `/api/send` with `draftId` sends them.

Threading: `resolveThreadId` in `src/lib/email/threading.ts` files an inbound or imported message under the thread of the stored message its `In-Reply-To`/`References` name (matched against `providerMessageId` in the same mailbox); otherwise its own Message-ID seeds a new thread. Outbound replies carry `inReplyTo`/`references`/`threadId` from the draft, and a fresh send is keyed by the Message-ID Cloudflare returns. `/api/messages/[id]/thread` returns the conversation. Lists pass `group=thread` (the "conversation view" toggle, `use-conversation-view.ts`) to get one row per thread plus `threadMessageIds`, which row actions and bulk actions expand to.

### Sending and receiving providers are per domain

`domains.sending_provider` (`none | cloudflare | resend`) and `domains.receiving_provider` (`none | cloudflare | resend`, default `cloudflare`) are chosen independently on the Domains page; DNS stays on Cloudflare either way. They record intent: switching a provider never touches DNS, each provider's own Setup does, and a **Clean up** button removes the config of an unselected provider.

- **Sending** goes through `sendThroughProvider` (`src/lib/email/outbound-provider.ts`), which `deliverEmail` and `sendSystemEmail` call after `getOutboundProviderConfig(env, from)` resolves the provider from the From domain (`none` throws). Cloudflare keeps its 5 MiB link fallback; Resend takes attachments directly. Resend can return a different Message-ID than we send, so `providerMessageId` stores the one replies will carry.
- **Receiving** from a non-Cloudflare provider enters through `intakeProviderMail` (`src/lib/email/provider-intake.ts`) and then the same `intakeIncomingMail` as everything else, once per recipient on a known domain. Providers cannot be rejected to after accepting, so reject and size limits drop the message, and `forward` is unavailable. Inbound endpoints are public and authenticate themselves: `/api/inbound/resend` verifies the Svix signature (`svix.ts`) with the secret Resend returned when `ensureWebhook` created the hook (`app_settings.resend_webhook_secret`), then fetches the raw MIME from `raw.download_url`. Resend receives through SES, so `readSesTrace` (`provider-trace.ts`) reads the verdicts and connecting IP from the leading SES-written headers.
- **Only one MX owner per domain.** `publishMx` (`receiving-dns.ts`) refuses with `MxConflictError` (HTTP 409 `MX_CONFLICT`) when other MX records exist; the UI confirms and retries with `replaceMx`. Cloudflare Worker routes (`ensureMailboxDomainRouting`) are created only for domains whose receiving provider is `cloudflare`.
- **Resend** keeps one key (`app_settings.resend_api_key`, or `RESEND_API_KEY`) and one Resend domain per hostname carrying both capabilities, so sending cleanup disables only `sending` when the domain still receives through Resend and vice versa. Apex MX values matching `inbound-smtp.*.amazonaws.com` are receiving records; everything else is sending.

### Bounces and complaints feed a per-domain suppression list

`src/lib/deliverability/` (details in `docs/deliverability.md`). `app_settings.suppression_mode` (`off` default, `record`, `enforce`; read through `getSuppressionMode`, which treats a missing column as `off`) gates everything. Verified events from `/api/provider-events/resend` (Svix, own secret) and DSNs found in `processInboundMessage` (`recordDsnBounces`, trusted only for a Message-ID we sent from that mailbox), go through `recordSuppression` into `email_suppressions` keyed `(domain_id, email)`. Only `confirmed` rows are enforced (`findSuppressed`): signed provider events and manual entries are confirmed, a DSN (forgeable by a co-recipient) or a Resend event naming several recipients is stored unconfirmed until a second DSN for a different original message arrives or an admin confirms it. In `enforce`, `sendEmail` throws `SuppressedRecipientError` before storing anything (routes map it to 422, JMAP to `invalidRecipients`, auto-replies swallow it) and `deliverEmail` drops recipients that were suppressed while queued.

### DMARC aggregate reports bypass mailboxes

`mymailbox-reports@<domain>` (`REPORT_ADDRESS_LOCAL_PART` in `src/lib/deliverability/report-address.ts`) is a reserved address, never a mailbox, active only for a domain with a `domain_deliverability.reports_enabled` row (off by default; details in `docs/dmarc-reports.md`). `resolveIncomingMail` returns `{ action: "report" }` for it, so no reject or forward rule applies and neither the Worker nor `intakeIncomingMail` forwards it (rule or account forwarding), and `processInboundMessage` hands the queued mail to `ingestReportMail` before `resolveInboundAddress`. `isReportAddressReserved` stops a mailbox or alias taking the local part while reports are on. Report mail is attacker-controlled: `report-parse.ts` caps compressed and decompressed bytes (a counter on the stream, plus a 1000x ratio; the 8 MiB absolute cap is the real bound, the ratio only stops small inputs from expanding to it), allows one non-encrypted `.xml` zip entry, rejects `<!DOCTYPE`/`<!ENTITY`, reads XML with an `indexOf` scanner (regex XML parsing goes quadratic on hostile input) and requires the policy domain to be the configured domain or a subdomain. `ingest.ts` counts the mail against the daily caps, commits a `processing` row (under the raw object key), parses, then completes the row under the report key (unique on domain + key, so a redelivery stops there), and records unreadable reports as `rejected`/`failed` instead of throwing. Only a *verified reporter* (the mail passed DMARC per `readTrustedDmarcResult` AND its From organisation equals the organisation of the report's contact email, `org-domain.ts`) writes aggregates, at most 500 rows per report with `db.batch` in chunks of 50, within 5,000 rows/domain/day and 1,000/reporter/day; every other report is only a row (`unverified`). Report and row keys include the verified reporter, and alerts are evaluated per reporter. `runDeliverabilityDaily` (02:00 UTC) raises alerts and purges rows older than 180 days.

### TLS-RPT reports share the report address; MTA-STS is served from a guarded host

`mymailbox-reports@<domain>` also receives TLS-RPT (RFC 8460) reports: `ingestReportMail` tells JSON from XML by content (`deliverability_reports.kind`) and applies the same caps, verified-reporter rule and row budgets; `parseTlsRptJson` (`report-parse.ts`) bounds JSON nesting, policies, failure details, counts and dates, and only verified reporters write `tls_daily_stats` (one row per day, reporter, policy, mail server and result type, integer counts). TLS reports need DMARC reports on (`updateTlsRpt`, `updateReports` refuse the other order). MTA-STS (off by default, `mta-sts-admin.ts`) stores mode, MX list, `max_age` and a policy id on `domain_deliverability`, writes the row before the `_mta-sts` TXT id announces it (restoring it if DNS fails), never overwrites a foreign `_mta-sts` record, starts in testing and needs an acknowledgement for enforce; turning off serves `mode: none` until `retire_after`, then the daily job deletes the record. `/.well-known/mta-sts.txt` (`mta-sts-serve.ts`) answers only for `mta-sts.<managed domain with a policy>`, and `guardMtaStsHost` (`worker.ts` fetch) keeps every other path and method on an `mta-sts.*` host away from the app; the admin attaches that host by hand (Workers Custom Domain or reverse proxy). Details in `docs/mta-sts.md`. A backup restore drops columns the target database lacks and refuses rows for a table it lacks, before deleting anything (`src/lib/backups/export.ts`).

### Routing rules have two scopes

`routing_rules.scope` splits two genuinely different mechanisms, and mixing them up is the easy mistake:

- **`domain`** — evaluated by `resolveInboundAddress` (`src/lib/email/routing.ts`) *while resolving the address*, in three phases: `reject` rules first (so a sender can be blocked even when the recipient is a real mailbox), then exact mailbox and alias lookup, then `forward`/`store` catch-all fallbacks. Ordered by descending `priority`, then oldest first. This phase split is what stops a `*` catch-all from shadowing real mailboxes — preserve it.
- **`mailbox`** — evaluated by `resolveInboxRuleDestination` *after* delivery: every matching `store` rule adds its `label_id` and any `skip_inbox` archives, while the first matching spam/trash rule is terminal (no labels). `processInboundMessage` adds the labels after storing the message and never loses mail over them.

Both queries filter on `scope`, so any new rule must set it explicitly. `forward` and `reject` are actioned in `worker.ts`, never in the queue consumer.

### Webhook retries ride the outbound queue

`src/lib/email/webhooks.ts` records every attempt (status, error snippet, duration, `nextRetryAt`) on `webhook_deliveries` and re-enqueues failures onto `OUTBOUND_QUEUE` with a `delaySeconds` backoff rather than adding a third queue binding. `env.d.ts` widens `OUTBOUND_QUEUE` to the union of both payload types accordingly. `runDelivery` is shared by the retry queue and the manual retry endpoint.

### Cloudflare is a live dependency, not just a host

Domain and mailbox management call the Cloudflare API at runtime (`src/lib/cloudflare-api.ts`, `src/lib/domains/`). Adding a domain enables Email Routing DNS and sending subdomains on the zone; creating a mailbox creates a Cloudflare Email Routing rule targeting `CF_EMAIL_WORKER_NAME`; removing a domain cleans those up (`src/lib/domains/cloudflare-cleanup.ts`).

Consequence: `CF_EMAIL_WORKER_NAME` (default `mymailbox`), the deployed Worker `name`, and `services[].service` for `WORKER_SELF_REFERENCE` in `wrangler.jsonc` must all agree. Cloudflare service bindings need a literal name and cannot reference the top-level `name`. Changing the Worker name on an install whose Email Routing rules already target the old name means those rules are no longer recognised: recreate them (re-save the mailboxes and catch-all) or point them at the new Worker in the Cloudflare dashboard. The other resources in `wrangler.jsonc` are the D1 database `mymailbox`, the R2 bucket `mymailbox-raw` and the queues `mymailbox-inbound`/`mymailbox-outbound`.

Auth is `CF_TOKEN` (preferred) or the legacy `CF_EMAIL` + `CF_API_KEY` pair.

### The database is D1

`docs/databases.md` is the user-facing reference. There is one database, the `DB` D1 binding (SQLite); tests stand in for it with better-sqlite3 behind the same API (`tests/helpers/sqlite-database.ts`).

- **Schema.** `src/db/schema/index.ts` is written against a small column kit (`schema/kits.ts`: `table`, `text`, `integer`, `bool`, `timestamp`, `autoId`, `index`, `uniqueIndex`, `desc`, `nowSeconds`) over drizzle's `sqlite-core`. Timestamps are whole seconds in an integer, booleans are 0/1 integers.
- **SQL helpers.** Shared fragments live in `src/db/sql.ts` (`insensitiveLike`, `containsLike`, `excluded`, `greatest`, `charIndex`, `concatText`, `matchNothing`, `escapeLike`) and raw-SQL introspection in `src/db/introspect.ts` (`listTableNames`, `listColumnNames`, `quoteIdentifier`); use them rather than inlining. Error text matching (missing table or column, unique violations) goes through `src/lib/database-errors.ts`.

### Schema and migrations

Schema lives in one file: `src/db/schema/index.ts`. Migrations are SQL files in `drizzle/migrations/`, listed in `meta/_journal.json` and recorded in the `d1_migrations` ledger (the table Wrangler uses). The history starts from a squashed baseline:

- `0000_baseline.sql` is generated by drizzle-kit from the schema (tables, columns, indexes, foreign keys). drizzle-kit mangles expression index keys, so the three `coalesce(thread_id, id)` indexes on `messages` are hand-corrected in it.
- `0001_triggers_and_seeds.sql` is hand-written: the `messages_fts` FTS5 table, the 30 triggers (search index, `trashed_at`, JMAP change log and mailbox revisions, passkey invariants) and the seed rows (`app_settings`, `backup_settings`, `jmap_change_floor`).

Every database starts from the baseline, so application code assumes every table and column in it exists: do not add `isMissingTableError`/`isMissingColumnError` fallbacks for them. A new migration may still be pending between a deploy and the admin applying it; only the inbound queue tolerates that (`settleFailedInboundMessage`), and a feature that must keep working before its own migration needs its own guard.

**Adding a migration:** change the schema, then add the next file (`0002_<name>.sql`, ...). Prefer `npm run db:generate` (it diffs against the latest snapshot in `meta/`); otherwise hand-write the SQL in the generated style and add a matching entry to `meta/_journal.json` (next `idx`, the file name without `.sql` as `tag`, `breakpoints: true`). End every statement with `--> statement-breakpoint` (never inside a trigger body): the bundle splitter (`scripts/generate-migration-bundle.mjs`), the test helper (`tests/helpers/migrate.ts`) and `wrangler d1 migrations apply` all read these files. Then run `npm run db:bundle` and commit the refreshed `src/lib/migrations/bundle.json`. Never edit a migration that has been applied. Triggers on `messages`, `labels`, `message_labels`, `mailboxes` or `mailbox_aliases` must be recreated if a table rebuild drops them. `tests/database-schema.test.mjs` fails when the bundle or journal is stale, or the migrations stop producing exactly the schema's tables and columns.

`/api/setup/prepare` and the admin migration endpoint use the shared runner in `src/lib/migrations/service.ts`, which applies each pending migration as one D1 batch. Build, deploy, preview, and development scripts generate the bundle before loading application code.

The setup path only ever initializes an empty database — it refuses to touch one that already has tables.

### Object storage is `env.BUCKET` (R2)

Every blob (raw MIME, attachments, avatars, branding icon, JMAP uploads, backups) goes through the `BUCKET` R2 binding. `GET/POST /api/v1/storage` (admin scope `storage`) reports and tests it.

### One runtime: Cloudflare Workers

The app reaches every platform service through `getEnv()` (`src/lib/cloudflare.ts`), which on Workers is the native `cloudflare:workers` env. There is no other runtime. Tests bundle app modules with esbuild and alias `cloudflare:workers` to `tests/helpers/cloudflare-workers.ts`, whose `env` forwards to `globalThis.__testEnv` (a test sets it to the bindings it needs and deletes it afterwards); `tests/helpers/sqlite-database.ts` (the D1 API over better-sqlite3), `tests/helpers/migrate.ts` (applies `drizzle/migrations` in journal order, as Wrangler does) and `tests/helpers/file-bucket.ts` (the R2 API over a directory) stand in for the bindings.

### JMAP lives in `src/lib/jmap/`

`handleJmapRequest` (`src/lib/jmap/handler.ts`) owns `/jmap/*` and `/.well-known/jmap`; the Next routes under `src/app/jmap/[[...segments]]` and `src/app/.well-known/jmap` only delegate to it, and it is framework-free so it could be mounted from `worker.ts` too. Auth is an API key with the `jmap` scope via `authenticateApiRequest` (`src/lib/api/key-auth.ts`, the Next-free core that `src/lib/api/auth.ts` now wraps). JMAP Mailbox ids encode `mailboxId`, `mailboxId~role` or `mailboxId~f~labelId` (`ids.ts`; an Email is in its status mailbox plus one Mailbox per label); `email-query.ts` maps filters onto `messages` columns, `email-objects.ts` builds Email objects from stored rows (no MIME parsing).

`processRequest` memoizes the accessible mailboxes and the change scope on `ctx.memo` across read-only calls of one request; write methods run with `memo: null` because they read `oldState` and `newState` in the same call.

States are positions in a change log (`changes.ts`): the `jmap_changes_*` triggers (`drizzle/migrations/0001_triggers_and_seeds.sql`) write a row per created, updated or destroyed message, per label added to or removed from a message (an `updated` Email), and per label or mailbox change into `jmap_changes`, so `Email/changes`, `Mailbox/changes` and `Thread/changes` return real deltas (`Email/queryChanges` still answers `cannotCalculateChanges`). A state is `c1:<seq>:<access fingerprint>`; a sharing change alters the fingerprint, and the daily cron prunes rows older than 30 days and raises `jmap_change_floor`, and either makes older states answer `cannotCalculateChanges`. Like `jmap_mailbox_revisions`, these tables are derived and excluded from backups. Never write to them from application code.

`Email/set` create and `Email/import` share one insert (`insertDraft` in `emails.ts`) and one target rule (`resolveDraftsMailbox` in `email-import-utils.ts`): a new message goes into exactly one Drafts mailbox, never Inbox or a label, because delivered mail is the inbound pipeline's job. `Email/import` parses the uploaded blob with `parseRawMime`, stores the `Message-ID` in `providerMessageId` with its angle brackets (as inbound rows do) and keeps the uploaded bytes at `drafts/<messageId>.eml` in `rawR2Key`, so `readBlob` serves the client's own MIME back instead of the rebuilt minimal message; `Email/import` deletes the `jmap-uploads/` object once claimed, while `Email/set` create leaves it, and the daily raw-mail sweep (`raw-sweeper.ts`) removes `jmap-uploads/` objects older than 7 days. `Email/copy` and `Email/parse` are still `emailUnsupported`.

`email-query.ts` answers the `header` filter from columns — `Message-ID` from `providerMessageId` (compared with and without angle brackets, since inbound rows store them and outbound rows do not), `In-Reply-To` from `inReplyTo`, `References` by a padded `LIKE` on the space-joined chain. Any other header name throws `unsupportedFilter` (RFC 8620 §5.5). Filter conditions must never be silently dropped: a client that de-duplicates with `header` would otherwise match every message in the mailbox.

### Password reset and MFA

`reset_email` on `users` is the destination for reset links (`src/lib/auth/password-reset.ts`); links are hashed, single-use, 30 minutes, and redeeming one revokes every session. Reset mail is sent by `sendSystemEmail` (`src/lib/email/system-mail.ts`), which writes straight to the send binding from the first admin mailbox on a sending-enabled domain, so nothing lands in Sent and no webhooks fire. If no domain can send, the request still returns 200 and a warning is logged. TOTP lives in `src/lib/auth/totp.ts` (RFC 6238 over Web Crypto, no dependency); the secret is stored on `users` at enrolment but only counts once `totp_enabled` is set by a verified code. `users.totp_last_step` holds the last accepted time step; `verifySecondFactor` claims a step with a conditional UPDATE, so a code works once (every TOTP check must go through it, never `matchTotpStep` directly). A login with MFA returns `{ mfaRequired, challengeToken }` (`login_challenges`, 5 minutes) instead of a session, and `/api/auth/mfa/verify` finishes it with a TOTP or recovery code. Password changes and admin resets call `deleteUserSessions`.

### Read receipts are an opt-in pixel

The composer's eye toggle (`use-track-opens.ts`) starts from the account default in `user_compose_preferences` (Settings → Inbox → Compose, `/api/settings/compose`, off by default) and sends `trackOpens`; toggling it changes only that message. The same table holds `undo_send_seconds` (0/5/10/15/30, default 15), which `sendEmail` reads for `undoSend` requests; 0 delivers at once. `deliverEmail` creates the `message_tracking` token at actual delivery, so a cancelled undo-send or reschedule leaves none, and injects the pixel only into the HTML handed to the provider: the stored Sent copy never contains it. The pixel is `GET /api/i/<token>.gif` (public, always the same GIF); `classifyOpen` (`src/lib/tracking/open-tracking-utils.ts`) names the client and device, drops device and location for proxies (Gmail, Yahoo, Apple), and flags Apple Mail Privacy Protection (Apple ASNs) and fetches within 10 s of delivery as `automated`, which `open_count` excludes. Pixel origin is the sender domain's own host from `domain_tracking_hosts` (set on the Domains page, must be the domain or a subdomain and attached to the Worker as a custom domain), else `APP_URL`, else the composer request's origin; with neither, or when adding the pixel fails, mail goes out untracked rather than failing. One pixel per message, so opens are not attributed to a recipient.

### Spam scoring adds up signals

`analyzeSpam` (`src/lib/spam/engine.ts`) sums scored signals from the analyzers in `src/lib/spam/analyzers/`, contact relationships, per-mailbox reputation and the Bayesian classifier, then applies `SPAM_THRESHOLDS` (`weights.ts`; the spam cut-off follows the user's `spam_strictness`, 55/70/85). Authentication passes count in full only for established senders (saved or written-to contact, good reputation, or an address seen twice with no spam reports) and at `unknownSenderPassScale` for a first contact, and `analyzeSolicitation` flags first-contact SEO pitches. Authentication is trusted only from the receiving side: verdicts SES computed for Resend intake (the leading `X-SES-*`/`Authentication-Results: amazonses.com` block, read by `readSesTrace`) ride the queue message as `verdicts`, and otherwise only a Cloudflare-written `Authentication-Results` header counts. `ExternalSpamIntelligenceProvider` adds Spamhaus DQS (ZEN, DBL), abuse.ch URLhaus and RDAP domain age; each lookup is optional, time-limited, cached in memory and under `spam-cache/` in `env.BUCKET` (the Cache API does nothing on workers.dev), and a failure adds no signal. Spamhaus' public mirrors refuse queries from public resolvers such as our DoH endpoint, so only DQS keys work. Keys, the domain-age switch and installation-specific brands live in `app_settings` (admin Spam filter page, `src/lib/spam/settings.ts`), falling back to the `SPAMHAUS_DQS_KEY`, `ABUSECH_AUTH_KEY` and `SPAM_DOMAIN_AGE_CHECK` env vars. Keep regional brands out of the built-in list in `impersonation.ts`.

### Promotions are a column, not a label

`messages.category` is `'promotions'`, `'primary'` (the user moved it to Inbox on purpose) or null; every predicate means "promotions" or "anything else", never "non-null". It is orthogonal to `status` and to labels. `detectBulkMail` (`src/lib/email/bulk-mail.ts`) is the one shared header detector; the routing-rule condition and the classifier both call it. The mode per mailbox lives in `mailbox_promotion_settings` (a missing row means `off`, and `off` must change nothing visible: the Promotions list and reader navigation scope to mailboxes whose mode is not off via `categoryScopeCondition`; the nav entry, row actions, chip and reader Move item read `counts.promotionModes` on the client; JMAP `$promotion` (keyword and `hasKeyword`) exists only for such mailboxes). Sender overrides and Trash-all are bounded writes (last 90 days, 500 rows, chunked under D1's 100 bound parameters) because each row fires the change-log and `trashed_at` triggers. The backfill (`runPromotionsBackfill`, five-minute cron) only classifies rows with a null category, reads 25 rows per run and at most 2,000 a day for the whole installation (about 6 D1 row writes each; counted in `backfill_day_rows`), and fails after three consecutive no-progress takeovers. A mode save keeps `updated_at` (the running job's fence) unless the mode goes to or from off or the job restarts. User docs: `docs/promotions.md`.

### Follow-up reminders surface unanswered sends

The composer's bell (`FollowUpMenu`) sends `followUpDays`; `deliverEmail` arms a `follow_ups` row once the message is actually out, so cancelled undo-sends leave none. The five-minute cron (`runFollowUpReminders` in `src/lib/follow-ups/service.ts`) moves due rows to `due`, or to `replied` when an inbound message joined the same thread in the same mailbox after the send; listing and reading re-check that, so a late reply closes a reminder too. Due reminders are not inbox rows: `DueFollowUps` pins them above the first inbox page, linking to the Sent message, with snooze and done. Reminders belong to the user who armed them.

### Calendar reminders are Web Push from the five-minute cron

`calendar_events.reminder_minutes` (null = none, 0-10080) is set in the event editor. `runCalendarReminders` (`src/lib/calendar/reminders.ts`, in `worker.ts` `scheduled()`) expands each event with `expandToolEvents` and pushes every occurrence whose start minus the offset has passed and that has not started. `last_reminded_start` is claimed with a conditional update before sending, so overlapping runs never notify twice; editing an event resets it. Delivery is `sendPushContent` (`src/lib/push/server.ts`), the generic form that `sendPushNotifications` wraps. Web Push is the only push channel.

### Search is an FTS5 index kept by triggers

`messages_fts` is an external-content FTS5 table over `messages`; three triggers (all in `0001_triggers_and_seeds.sql`) keep it in sync on insert, update and delete, so no application code touches the index. `buildSearchConditions` in `src/lib/search/conditions.ts` turns the Gmail-style grammar (`src/lib/search/query-utils.ts`) into a `rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)` predicate plus plain column filters. Two consequences: the migration bundle splitter (`scripts/generate-migration-bundle.mjs`) keeps trigger bodies whole; and the backup coverage check skips `messages_fts%`, since the shadow tables are derived and repopulate on restore. `wrangler d1 export` does not work on databases with virtual tables; the app's own JSON backup is unaffected.

### Access control

Two independent auth surfaces:

- **Session cookie** (`ep_session`) — `getCurrentUser` / `requireUser` in `src/lib/auth/cookies.ts`, backed by `src/lib/auth/session.ts`. Used by dashboard/admin API routes. `requireUser` *throws*, which Next surfaces as a 500; prefer `requireSessionUser` from `src/lib/api/auth.ts`, which returns a proper 401 response. Most older routes still use `requireUser` and 500 on unauthenticated requests.
- **API key bearer token** — `authenticateApiKey` + `requireScope` in `src/lib/api/auth.ts`, used by the public `/api/v1/*` surface.

Mailbox content authorization goes through `src/lib/mailboxes/access.ts` (`getMailboxAccessLevel`, `listAccessibleMailboxes`, `listAccessibleMailboxIds`), which accounts for ownership and the `mailbox_access` sharing table. Message queries scope by accessible mailbox IDs, not by `userId` — see `src/app/api/messages/route.ts` for the canonical pattern. Mailbox details, aliases and avatars use `getMailboxSettingsAccess` in `src/lib/mailboxes/settings-access.ts`: the primary admin can configure other accounts' mailboxes, and admins with user-management permission can configure ordinary users' mailboxes. This does not grant access to their messages or sending identities. Primary mailbox names and avatars follow the mailbox owner's account identity.

### Projects stamp mail by its own address

`projects` (per user) own domains or addresses through `project_addresses` (unique per domain and local part; an empty local part owns the whole domain). Because a `use_all_domains` mailbox receives `localPart@` every active domain of its owner, a project can never be derived from the mailbox: `processInboundMessage` keeps the envelope recipient in `messages.delivered_to` and stamps `messages.project_id` from it, and sends and drafts stamp it from their From (`resolveProjectSafely` in `src/lib/projects/service.ts`, which never blocks mail). `project_id` has no foreign key on purpose (a SET NULL cascade would rewrite every stamped row through the message triggers); a deleted project's id stays until `restampMessages`, which recomputes rows in bounded pages per mailbox by rowid. The web lists, counts and reader navigation follow `ListScopeProvider` (every accessible mailbox by default, or one, plus an optional project), which is separate from `useSelectedMailbox` (settings and compose); the composer keeps its own sender and must never write the global selection. The unified inbox pages on `messages_unified_page_idx` (status first), and the counts GROUP BY includes `user_id, private_draft` so it stays in `messages_counts_cover_idx` order.

### Folders are statuses; labels are a table

`messages.status` is a free-text column driving the folder views: `received` (inbox), `sent`, `draft`, `spam`, `trash`, `archived`. Orthogonal to that are `starred`, `snoozedUntil`, and labels: `labels` (per mailbox) and `message_labels` (many per message), written only through `src/lib/labels/service.ts` (chunks of 45 pairs, bounded label deletion, since each membership row fires the change-log triggers). A label never takes mail out of the inbox: Inbox is `direction = 'inbound' AND status = 'received'`, not snoozed; archive, trash and spam change the status and keep labels; a label view (`labelId`) lists every message with the label except Trash and Spam; "Move to" adds a label and archives inbox mail. `messages.folder_id` (`legacyFolderId`) is a dead, always-null column: SQLite cannot drop a column a table-level foreign key names, and rebuilding `messages` on D1 would cascade-delete its children; never read or write it, and keep it out of responses. A "folder" route under `src/app/(dashboard)/` is usually a status filter, not a table. Drafts are private to their author: `draftsVisibleTo` / `isOthersDraft` (`src/lib/email/draft-access.ts`) must gate every reader query. `messages.private_draft` is set when a row is created as a draft (and when a message is moved back to Drafts) and stays set wherever the row goes, so a trashed or archived draft stays private; it is cleared only by a real send or an explicit "sent" (`privateDraftForStatus`); a JMAP label move is never a send, so `targetFromMailboxIds` keeps a private row off status `sent`. Thread views and conversation counts apply the same predicate. `messages_nav_cover_idx` and `messages_counts_cover_idx` end with `user_id, private_draft` so the predicate stays on the index. Any select feeding `isOthersDraft` must include `privateDraft` (a missing value counts as private). `draftsVisibleTo` binds one parameter (`DRAFT_FILTER_PARAMS`): size D1 batches as 100 minus the query's fixed parameters, including it.

### Database migrations

The admin overview's database card (`src/components/admin-migrations-card.tsx`) reports and applies pending D1 migrations through the Worker binding via `/api/admin/migrations` (primary admin only).

### Naming and upstream compatibility

The product, the Worker resources and the internal identifiers are named MyMailbox / `mymailbox`: storage keys, `mymailbox:*` window events, the `mymailbox-locale` cookie, `X-MyMailbox-*` headers, `MYMAILBOX_*` env vars, the `mymailbox-reports` address and the `mymailbox-database-backup` format. Anything written into mail or calendar data must stay readable when it comes back in mail from an upstream Mailflare install, so those readers accept both names:

- Calendar UIDs are written as `<event id>@mymailbox` (`eventUid` in `src/lib/calendar/ics.ts`); `ownEventIdFromUid` also accepts `@mailflare`.
- Composer markers (`data-mymailbox-quote`, `data-mymailbox-signature`, the `mymailbox-quote` wrapper) and editor placeholders (`data-mymailbox-src` and siblings) are written with the new name; `splitQuotedHtml` and `src/lib/email/html.ts` also read the `mailflare` forms.
- `classifyOpen` names both the `MyMailbox-Remote-Images` and the `Mailflare-Remote-Images` proxy.
- Restore refuses an upstream `mailflare-database-backup` document with its own message.

Other mentions of Mailflare are the credits line (`navigation.credits`), the fork notice and attribution in the README and docs, `LICENSE` and the historical notes under `docs/notes/`.

## Conventions

- Tabs for indentation. `@/*` maps to `src/*`.
- Types and pure helpers are split out of components and modules into sibling `*-types.d.ts` and `*-utils.ts` files (more than 90 of each). Follow this when adding anything non-trivial.
- Server code reaches bindings through `getEnv()` / `getEnvAsync()` in `src/lib/cloudflare.ts`, then `getDb(env)` from `src/db`. Keep binding access centralized here.
- API routes return `NextResponse.json({ error: "..." }, { status })` for failures; there is no shared error envelope helper.
- UI is Tailwind v4 + shadcn/Radix primitives in `src/components/ui/`. `DialogContent` sets no max height, so a tall dialog overflows the viewport with an unreachable submit button — add `max-h-[calc(100vh-4rem)] overflow-y-auto` on any dialog with more than a few fields.
- `cloudflare-env.d.ts` is generated (500KB) — regenerate with `cf-typegen`, never hand-edit.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
