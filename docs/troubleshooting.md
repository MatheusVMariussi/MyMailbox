# Troubleshooting

## Cloudflare error 9109: Invalid access token

The credentials Wrangler deploys with are not exposed to MyMailbox at runtime. Create a separate Cloudflare API token and set it as the `CF_TOKEN` Worker secret.

Verify the token:

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer <CF_TOKEN>"
```

The response should report `success: true` and an active status. Check that:

- `CF_TOKEN` contains the token secret, not its ID.
- The value does not include the word `Bearer`.
- The token is currently valid and its IP restrictions allow the Worker.
- You redeployed after changing Cloudflare variables or secrets.

If you use a legacy Global API Key, set `CF_EMAIL` and `CF_API_KEY` instead of placing it in `CF_TOKEN`.

## Cloudflare error 10000 on Email Routing

Update the token so it can read the zone and manage its DNS, Email Routing settings, and Email Routing rules. The recommended scoped permissions are listed in the [deployment guide](deployment.md#step-1-create-cf_token).

## Cloudflare error 2008 for existing MX records

Cloudflare Email Routing cannot be enabled while another mail provider's MX records are present. MyMailbox shows a confirmation before replacing them. Continuing deletes the existing MX records and points incoming mail to Cloudflare Email Routing, so the previous provider will stop receiving mail. The `CF_TOKEN` needs **DNS Edit** permission for this action.

## Cloudflare Email Sending cannot be set up

The Domains page names the cause when Cloudflare refuses to create the domain's sending subdomain:

- **The API token needs "Email Sending: Edit".** Edit `CF_TOKEN` in the Cloudflare dashboard (My Profile → API Tokens) and add an `Entire Account` policy with Email & Messaging → Email Sending → `Edit`; the zone permissions alone are not enough. Then press **Setup** again; the token secret does not change, so nothing needs redeploying.
- **Email Sending is not active for the domain.** In the Cloudflare dashboard, go to **Compute → Email Service → Email Sending** and onboard the domain. This needs the Workers Paid plan. Then press **Setup** again.

If the sending subdomain exists but shows as disabled, the onboarding is not finished on Cloudflare's side. You can also add a domain with **Send mail with** set to Not selected and turn sending on later.

## "This domain has MX records for another mail service"

Only one service can own a domain's MX records. Setting up Cloudflare receiving, or Cloudflare sending, shows the records it would replace and waits for your confirmation; confirming means the previous service stops receiving mail for that domain.

## D1 error 7404: Database could not be found

D1 database IDs belong to a specific Cloudflare account. This error commonly means `wrangler.jsonc` contains an ID copied from another account.

Keep only `database_name` in the committed `wrangler.jsonc`. Wrangler then provisions or binds the `mymailbox` database in the target account on deploy.

For remote migrations after the first deployment:

1. Open the Worker's **Settings → Bindings** page in Cloudflare.
2. Open the `DB` D1 binding and copy its database ID.
3. Add that ID to your local `wrangler.jsonc`.
4. Run `npm run db:migrate:remote`.

Do not commit that account-specific ID to a public repository.

## Scheduled backups are not running

Deploy the complete Worker with `npm run deploy`. A local Next.js server or a source-only update does not provision the cron trigger declared in `wrangler.jsonc`.

Also confirm that automatic backups are enabled under **Admin → Backups** and that the Worker has its `DB` and `BUCKET` bindings.

## Inbound mail is not arriving

Confirm that:

- The deployed Worker is named `mymailbox`.
- `services[].service` in `wrangler.jsonc` is also `mymailbox`, and `CF_EMAIL_WORKER_NAME`, if set, matches the Worker name. If you renamed the Worker, re-save the mailboxes and the catch-all so their Email Routing rules point at the new name.
- Email Routing is enabled for the domain in Cloudflare.
- The mailbox has an Email Routing rule pointing to the Worker.
- Receiving is turned on for the domain under **Admin → Domains** and its MX records point at Cloudflare (`*.mx.cloudflare.net`). A domain that used to receive elsewhere keeps the old MX until you run its Setup.

## The password-reset email never arrives

The reset form always answers success, so it cannot tell you why no mail was sent. Check the Worker logs for one of these lines:

- `Password reset skipped: account has no recovery email` — set the recovery email on the account first.
- `Password reset requested but no domain can send mail` — turn on Cloudflare sending, and finish its setup, on a domain with an active mailbox owned by an enabled user.
- `Password reset request failed` — the sending provider rejected the message; the error follows.
