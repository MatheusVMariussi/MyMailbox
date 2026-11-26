# Deployment and configuration

This guide covers Cloudflare deployment, runtime configuration, database backups, and application updates.

## Overview

Set up MyMailbox in four steps:

1. **Create the runtime token:** a scoped Cloudflare API token the app uses as `CF_TOKEN`.
2. **Deploy the Worker:** create the queues and deploy with Wrangler, using the `mymailbox` resource names in `wrangler.jsonc`.
3. **Complete setup:** open the deployed app and follow `/setup` to check the installation and create the first admin account.
4. **Connect your domain:** add a domain managed by the same Cloudflare account and choose which service receives its mail. MyMailbox configures email routing and, when available and selected, email sending before helping you create the first mailbox. Resend is an alternative to Cloudflare for receiving and sending; see [Sending and receiving providers](providers.md).

## Step 1: Create CF_TOKEN

To configure your `CF_TOKEN` (a scoped Cloudflare API token with specific permissions), follow the steps below.

1. In your Cloudflare account, navigate to `Manage Account` → `Account API Tokens` and create a new token.
2. At the top of the Policy window, select `Specified Domains` for all domains that you plan to connect
    1. Then configure these permissions
        1. DNS & Zones > DNS > Select `Edit` Access
            1. This allows the confirmed setup flow to replace conflicting MX records
        2. DNS & Zones > Zone > Select `Read` Access
        3. DNS & Zones → Zone Settings → Select `Edit` Access
        4. Email & Messaging > Email Routing Rules > Select `Edit` Access
3. If MyMailbox will send emails through Cloudflare: Add another policy and select `Entire Account`, and configure these permissions:
    1. Email & Messaging > Email Sending > Select `Edit` Access
4. After your token is set up, go to `Compute` → `Email Service` → `Email Sending`
    1. You will need to purchase a paid workers plan if you don't already have one
    2. Select On-board domain and follow the prompts
    3. After this is done, and after you have set up MyMailbox, on the Admin > domains page, when you expand the domain you can then configure DKIM and DMARC records

Store only the token secret as `CF_TOKEN` in step 2. Do not include the word `Bearer` and do not use the token ID. The token must belong to the same Cloudflare account as the domains you connect. It is a runtime token, separate from the credentials Wrangler uses to deploy.

## Step 2: Deploy the Worker

`wrangler.jsonc` names every Cloudflare resource:

| Resource | Name |
| --- | --- |
| Worker (`name`, and `services[].service` for `WORKER_SELF_REFERENCE`) | `mymailbox` |
| D1 database (`DB`) | `mymailbox` |
| R2 bucket (`BUCKET`) | `mymailbox-raw` |
| Queues (`INBOUND_QUEUE`, `OUTBOUND_QUEUE`) | `mymailbox-inbound`, `mymailbox-outbound` |

The Worker name, `services[].service` and `CF_EMAIL_WORKER_NAME` (default `mymailbox`) must agree, because Email Routing rules deliver to the Worker by name. If you rename the Worker, change all three together; see [Inbound mail is not arriving](troubleshooting.md#inbound-mail-is-not-arriving).

1. Install dependencies with Node 24 (`.nvmrc`): `npm install`.
2. Sign in to Cloudflare with `npx wrangler login`, or export `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for a scoped deployment token (permissions under [Deploy with an AI coding agent](#deploy-with-an-ai-coding-agent)).
3. Create the queues once:

   ```bash
   npx wrangler queues create mymailbox-inbound
   npx wrangler queues create mymailbox-outbound
   ```

4. Deploy with `npm run deploy`. On the first deploy, Wrangler provisions the D1 database `mymailbox` and the R2 bucket `mymailbox-raw` declared in `wrangler.jsonc`.
5. Store the runtime token as a Worker secret: `npx wrangler secret put CF_TOKEN`.
6. Set `APP_URL` to the app's public HTTPS address (for example `https://mail.example.com`) as a variable on the Worker, under **Settings → Variables and Secrets**. `keep_vars` in `wrangler.jsonc` keeps dashboard variables across deploys. Receiving through Resend needs it, and read-receipt pixels use it.

### Optional Web Push configuration

To enable background new-mail notifications, run `npm run push:keys` once and
store `VAPID_PRIVATE_KEY` as a Worker secret. Configure `VAPID_PUBLIC_KEY` and
`VAPID_SUBJECT` as Worker variables; the subject must be a `mailto:` URI or the
public HTTPS URL of the installation. The same VAPID key pair should be kept
across deployments so existing browser subscriptions remain valid.

## Step 3: Complete MyMailbox setup

1. Open the URL of the deployed `mymailbox` Worker.
2. Go to `/setup` if MyMailbox does not take you there automatically.
3. Let MyMailbox check the required Cloudflare configuration and initialize the empty D1 database.
4. Create the first admin account when prompted.

Setup applies the committed migrations through the Worker's D1 binding before creating the first admin account.

## Step 4: Connect your primary domain and create an account

1. Enter a domain that already uses Cloudflare DNS on the same account as your `CF_TOKEN`.
2. Continue while MyMailbox enables Email Routing and configures the required routing and sending DNS.
3. Choose the address for your first mailbox and finish setup.
4. Open the inbox and send a test message to the new address.

To connect more domains later, open **Admin → Domains**, select **New domain**, enter the hostname and choose the receiving service. With Cloudflare, MyMailbox configures Email Routing and Email Sending automatically. With Resend, add its API key and run its setup from the domain page; see [Sending and receiving providers](providers.md). The `CF_TOKEN` is still needed in every case, because Cloudflare manages the domain's DNS.

Resend receives mail by calling your app, so set `APP_URL` to the app's public HTTPS address before setting it up for receiving.

Your inbox is now ready to send and receive email.

---

## Deploy with an AI coding agent

Paste the prompt below into an agent with terminal access. Give it your Cloudflare account ID and **two separate scoped API tokens** through the agent's secret input. Never put them in a public chat, repository, or committed file.

- **Deployment token** (Wrangler uses it as `CLOUDFLARE_API_TOKEN`): scope it to the target account with **Workers Scripts Edit** (or **Workers Admin** if you see Cloudflare's newer roles), **D1 Edit**, **Workers R2 Storage Edit**, **Queues Edit**, and **Account Settings Read**. Add **Workers Routes Edit** for the target zone only if the agent should attach a custom domain or route. See Cloudflare's [token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/).
- **Runtime token** (stored as the Worker secret `CF_TOKEN`): use the domain permissions above. Add **Email Sending Edit** to send mail. It must cover the zones you will connect in MyMailbox.

```text
Install MyMailbox from https://github.com/MatheusVMariussi/MyMailbox in my Cloudflare account.
Ask me for my Cloudflare account ID, a scoped deployment API token, and a separate
runtime CF_TOKEN through a secret input. Never print, commit, or place either token
in a command argument or a tracked file. Use the deployment token only for Wrangler
authentication (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID).

Read README.md, docs/deployment.md, and wrangler.jsonc first. Use the names in
wrangler.jsonc: Worker mymailbox, D1 database mymailbox, R2 bucket mymailbox-raw,
and Queues mymailbox-inbound and mymailbox-outbound. Create or reuse them in the
selected account. If you need the D1 database_id, set it only in the local Wrangler
config and do not commit it. Install dependencies with Node 24, run npm run deploy,
and set the runtime CF_TOKEN as a Worker secret. Do not run remote D1 migrations
manually; the /setup flow initializes the database.

Give me the deployed URL and any remaining Cloudflare account actions, including
setting APP_URL. I will open /setup, create the first admin account, and connect
my domain there.
```

## Manual recovery

The deploy command builds with vinext and uploads the complete Worker with Wrangler. The Cloudflare Vite plugin generates `dist/server/wrangler.json` and redirects Wrangler to that build. It does not modify D1. The complete Worker is required because `worker.ts` also handles inbound email, queues, scheduled backups, and the real-time Durable Object.

Pending migrations can also be applied with Wrangler:

```bash
npm run db:migrate:remote
```

Remote migrations require the target account's `database_id` in your local `wrangler.jsonc`. Do not commit an account-specific database ID to a public repository.

## Database backups

MyMailbox exports its D1 records as JSON and stores the backup files in the R2 bucket. A cron trigger in `wrangler.jsonc` runs daily at 02:00 UTC and applies the schedule selected under **Admin → Backups**. Manual backups run the same record export directly from the admin API.

Deploy the complete Worker with `npm run deploy` whenever the cron trigger is added or changed.

Backups use the `mymailbox-database-backup` format. Restore refuses backups written by Mailflare, the upstream project, because their schema differs.

## Database migrations

Deployment and database migration are separate. After deploying a new version, open or refresh **Admin settings**. The database card shows any pending database migrations. Select **Update database** to apply them through the Worker's D1 binding. The same runner initializes a new database during setup.

If a custom deploy command contains `wrangler d1 migrations apply DB --remote`, remove that part and use `npm run deploy`.

Each migration and its `d1_migrations` history entry run in one D1 batch. If a migration fails, its changes are rolled back, the failed filename is shown, and it can be retried after the problem is corrected. Wrangler remains available as a manual recovery tool.

If mail arrives after a deploy but before its migrations are applied and the new code needs a column or table that does not exist yet, the inbound queue retries that message every 5 minutes, up to 12 times (about an hour), instead of dropping it. Applying the migrations inside that hour, from **Update database**, delivers the held mail. Mail still failing after that is lost from the queue and its raw copy in R2 is deleted by the daily sweep, so apply migrations promptly after a deploy.

New application releases must remain compatible with the previous schema until an administrator applies their migrations. Prefer additive changes, keep old columns during the transition, and avoid making authentication or the admin settings page depend immediately on a newly added column. Plan a maintenance window for an incompatible schema change.

When adding a schema change, create a new uniquely named SQL file in `drizzle/migrations` and do not edit an applied migration. Build and development commands generate the Worker migration bundle from those files. `npm run db:bundle` can generate it explicitly.
