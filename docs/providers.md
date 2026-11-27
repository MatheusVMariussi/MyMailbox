# Sending and receiving mail

MyMailbox keeps your mail data in your own D1 database and R2 bucket, and Cloudflare carries it over the wire:

| | Service |
|---|---|
| **Receiving** | Cloudflare Email Routing (free) |
| **Sending** | Cloudflare Email Sending (Workers Paid plan) |

Each can be turned off per domain: a domain can be **receive-only** (sending: Not selected) or **send-only** (receiving: Not selected). DNS stays on Cloudflare, and MyMailbox writes the records each service needs.

Open **Admin → Domains**, expand a domain, and use the **Setup receiving email** and **Setup sending email** sections. Each is a card with a switch. Turning the switch on selects the service and shows its setup; the icon on the left is a green check when it is fully set up and an amber triangle when it is not.

> Turning a switch on records the choice; it does not change DNS. The **Setup** button inside the card does, except that turning sending on also tries to create the sending subdomain right away.

## Choosing at add time

**New domain** asks whether Cloudflare receives the domain's mail (**Receive mail with**) and sends it (**Send mail with**), each Cloudflare or Not selected. Email Routing is only enabled on the zone, and the sending subdomain only created, for the Cloudflare choice. The same choices are available over the API as `receivingProvider` and `sendingProvider` (`cloudflare` or `none`; see [API](api.md#domain-management)).

## Receiving: Cloudflare Email Routing

Setup enables Email Routing on the zone, points the domain's MX at Cloudflare and sends every mailbox, alias and catch-all address to the MyMailbox Worker, whose `email` handler applies routing rules, stores the raw message in R2 and queues it for parsing. Reject and forward rules act on the live SMTP session, so a rejected sender gets a bounce.

Email Routing is free and needs only the `CF_TOKEN` zone permissions listed in the [deployment guide](deployment.md#step-1-create-cf_token).

## Sending: Cloudflare Email Sending

Outgoing mail goes through the Worker's `EMAIL` send_email binding. Before a domain can send:

1. **Plan.** Email Sending needs the Workers Paid plan ($5/month), which includes 3,000 emails a month; beyond that it costs $0.35 per 1,000.
2. **Token.** `CF_TOKEN` needs the account-level **Email Sending: Edit** permission (an `Entire Account` policy, separate from the zone permissions).
3. **Onboarding.** In the Cloudflare dashboard, go to **Compute → Email Service → Email Sending** and onboard the domain.

Then turn on **Cloudflare Email** under **Setup sending email** (or press **Setup** on its Email Sending row). MyMailbox creates the zone's sending subdomain, which publishes the DKIM record Cloudflare signs with; the DKIM row turns green once public DNS answers. A DMARC record can be added from **Domain setup**.

When Cloudflare refuses, the Domains page says why instead of showing Cloudflare's raw answer:

- **The token lacks "Email Sending: Edit"**: add the account-level permission to `CF_TOKEN` and press Setup again.
- **The domain is not onboarded**: onboard it under **Compute → Email Service → Email Sending** (on the Workers Paid plan) and press Setup again.
- **Another service's MX records**: Cloudflare will not create the sending subdomain while the domain's MX points elsewhere; MyMailbox lists the records and replaces them only after you confirm.

If Cloudflare shows the sending subdomain as disabled, check the domain's onboarding in the dashboard.

Cloudflare Email Sending limits the whole encoded message to 5 MiB for general recipients, so files over 3 MB, and smaller files that would push the message past the limit, go out as download links from your storage bucket (see [API](api.md#sending-email)).

## Bounces

Bounce messages returned to a mailbox feed a per-domain suppression list, which is off by default; see [deliverability.md](deliverability.md).

## MX records and switching receiving on or off

Only one service can own a domain's MX records. When Email Routing's Setup finds MX records for something else, it stops and shows them, and replaces them only after you confirm. Confirming means the previous service stops receiving mail for that domain.

Per-address routes to the MyMailbox Worker are only created for domains that receive through Cloudflare, and are recreated when you set receiving up again.

## Cleaning up

If a service you turned off still has configuration for the domain, its card shows **Clean up**:

- **Sending** deletes the zone's sending subdomain and its DNS.
- **Receiving** deletes the domain's routing rules and MX, and disables Email Routing on the zone when no other domain uses it.

You cannot clean up a service that is turned on.

## Configuration reference

| Variable | Purpose |
|---|---|
| `CF_TOKEN` | Cloudflare API token: zone permissions for DNS and Email Routing, plus the account-level "Email Sending: Edit" to send |
| `CF_EMAIL_WORKER_NAME` | Worker name Email Routing rules deliver to (default `mymailbox`) |
| `APP_URL` | Public HTTPS address, used for password reset links, read receipts and download links for large attachments |
