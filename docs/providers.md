# Sending and receiving providers

Mailflare keeps your mail data in your own D1 database and R2 bucket (or SQLite and local files when self-hosted). What carries mail over the wire is a choice you make **per domain**, separately for receiving and for sending:

| | Cloudflare | Resend |
|---|---|---|
| **Receiving** | Email Routing (the default) | `email.received` webhook |
| **Sending** | Cloudflare Email Sending | Resend API |

DNS stays on Cloudflare for every combination: Mailflare writes the records for whichever provider you pick. A domain can also be **receive-only** (sending: Not selected) or **send-only** (receiving: Not selected).

Open **Admin → Domains**, expand a domain, and use the **Setup receiving email** and **Setup sending email** sections. Each provider is a card with a switch. Turning a switch on selects that provider and shows its setup; the icon on the left is a green check when it is fully set up and an amber triangle when it is not.

> Selecting a provider does not change DNS. The Setup button inside the provider's card does. This lets you prepare a new provider while the old one keeps working.

## Choosing at add time

**New domain** asks which service receives the domain's mail (**Receive mail with**) and which sends it (**Send mail with**), each a dropdown of Cloudflare, Resend or Not selected. Cloudflare Email Routing and the Cloudflare sending subdomain are only enabled on the zone for the Cloudflare choice. For Resend the domain is added without touching either; finish from the domain page once the API key is in. The same choices are available over the API as `receivingProvider` and `sendingProvider` (see [API](api.md#domain-management)).

## Resend

Resend uses one **API key**, shared by every domain that uses it. Create it at [resend.com/api-keys](https://resend.com/api-keys).

- A **full-access** key lets Mailflare add the domain to Resend, write its DNS records to the Cloudflare zone, verify it, and (for receiving) register the webhook.
- A **sending-only** key can send, but Resend refuses it for domain and webhook management, so you add the domain at [resend.com/domains](https://resend.com/domains), create its records yourself, and use **Send test email** to confirm. Mailflare says so in the card instead of failing.

The key is checked against Resend when you save it. It can also come from the `RESEND_API_KEY` secret, which is used when no key is saved in the app. Only the primary administrator can change it.

A service with a Resend-compatible API works the same way: set `RESEND_BASE_URL` to its API address and use its key. Every Resend call (sending, domains, webhooks, received mail) goes to that address. If the service refuses a custom `Message-ID` header, set `RESEND_CUSTOM_MESSAGE_ID=false`: Mailflare then sends without it and threads replies on the Message-ID the service reports for the sent email (`message_id` from `GET /emails/{id}`), falling back to its own when none is reported yet. If it refuses other headers Mailflare sets, such as `Auto-Submitted` on system mail and auto-replies, list them in `RESEND_OMIT_HEADERS` (comma-separated) and they are left out of every send.

**Sending.** Setup creates the domain in Resend, publishes its DKIM and SPF records, and asks Resend to verify. Verification is Resend's own status: it can stay `pending` for a few minutes after the DNS is added, and **Check status** re-asks Resend without creating anything new. Replies thread correctly because Mailflare sets its own `Message-ID`.

**Receiving.** Setup enables the receiving capability on the domain, points the apex MX at Resend, and registers one webhook for `email.received` at `/api/inbound/resend`. The webhook is authenticated with the Svix signing secret Resend returns when it is created; Mailflare stores that secret, which is why a webhook it did not create itself is replaced. For each event Mailflare fetches the message, downloads the raw MIME and runs it through the normal inbound pipeline. Resend must be able to reach your app, so `APP_URL` has to be a public HTTPS address.

## Bounces and complaints

Resend can report permanent bounces and spam complaints back to Mailflare, which keeps a per-domain suppression list. It is off by default; see [deliverability.md](deliverability.md).

## MX records and switching receiving provider

Only one service can own a domain's MX records. When a provider's Setup finds MX records for something else (including Cloudflare Email Routing's), it stops and shows them, and replaces them only after you confirm. Confirming means the previous service stops receiving mail for that domain.

Per-address routes to the Mailflare Worker are only created for domains that receive through Cloudflare, and are recreated when you set Cloudflare up again.

## Cleaning up the provider you left

If a provider you are not using still has configuration for the domain, its card shows **Clean up**:

- **Cloudflare sending** deletes the zone's sending subdomain and its DNS.
- **Cloudflare receiving** deletes the domain's routing rules and MX, and disables Email Routing on the zone when no other domain uses it.
- **Resend** deletes the domain from Resend and its DNS records. If the domain still receives (or sends) through Resend, only the capability you are leaving is switched off.

You cannot clean up the provider that is currently selected.

## Behavior that differs from Cloudflare

- **Routing rules.** Reject and forward rules need to act on the live SMTP session, which only Cloudflare's email handler can do. For mail received through Resend, a reject rule drops the message and forward rules are not applied. Store and categorize rules, mailbox rules, spam handling and webhooks work as usual.
- **Attachments.** Cloudflare sends large files as download links from your storage bucket to stay under its 5 MiB limit. Resend sends attachments directly, within the administrator's outgoing limit; past 20 MB they too go as download links, which keeps the encoded message under what most receiving servers accept (the limit can be raised to 50 MB on Node/Docker; Workers stay at 25 MB).
- **Size.** Inbound mail from any provider is capped at 25 MiB and the same attachment limits apply; larger messages are dropped.

## Configuration reference

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend key used when none is saved in the app |
| `RESEND_BASE_URL` | Base URL of the Resend API (default `https://api.resend.com`); point it at a Resend-compatible service to send and receive through that instead |
| `RESEND_CUSTOM_MESSAGE_ID` | `false` stops sending Mailflare's own `Message-ID` header, for compatible services that refuse it (default: sent) |
| `RESEND_OMIT_HEADERS` | Comma-separated headers left out of every Resend send, for compatible services that refuse them (default: none) |
| `APP_URL` | Public HTTPS address; required for Resend receiving, because Resend calls this app |

Settings saved in the app take precedence over these variables. Keys saved in the app are stored as plain text in the `app_settings` table (as the AI provider key already is), so protect database backups accordingly.
