# Security notes for inbound mail

## Deleted attachments stay in the original message

Deleting an attachment removes its stored file and its row, so it can no longer be
downloaded, previewed or shared. The message's original MIME (`rawR2Key`) is a faithful
copy of what arrived and is not rewritten, so **Download original** and the JMAP raw
blob still contain the attachment bytes. Delete the whole message to remove the original.

Public shared-file links stop working as soon as the message is moved to trash or spam
or its mailbox is disabled; they also expire on their own.

## Authentication results

* Cloudflare receiving: SPF, DKIM and DMARC come from the `Authentication-Results`
  header Cloudflare writes (authserv-id `mx.cloudflare.net`). A failure in any such clause
  wins over a pass.
* Resend receiving: the verdicts SES (which Resend receives through) wrote are used.

Sender-written `Authentication-Results`, `Received-SPF` and `Received` headers are never
trusted.

## Webhooks

Webhook URLs must be `https://` on a public host. Redirects are not followed, and hooks
saved before this rule are re-checked at delivery. Mail filed as spam or trash does not
trigger `message.inbound`. A webhook copies message content to the URL, so creating one, changing its URL, adding events or switching a disabled one back on needs the same fresh proof as other sensitive changes (step-up action `webhook.change`); existing webhooks keep working, and switching one off or rotating the secret needs none.

## Forwarding loop guard

Mail Mailflare forwards carries `X-Mailflare-Forwarded`, an HMAC keyed with a server secret
(`CF_TOKEN` or `CF_API_KEY`). A sender cannot switch forwarding
off by adding the header. With none of those set the header falls back to `1`.

## Attachments

Mailflare does not run an antivirus engine. What it does instead:

* Resend (which receives through SES) drops mail SES flagged as infected.
* Every attachment is judged from its name and type: programs and scripts, macro-enabled
  Office files, double extensions such as `invoice.pdf.exe`, hidden bidi characters, and
  containers that hide other files (HTML, SVG, disk images, archives).
* ZIP files are inspected without extracting anything: the file names in the central
  directory are read with two bounded range requests (at most 1000 entries and 1 MiB of
  directory). Password-protected or unreadable archives are flagged.
* A flagged attachment shows the reasons in the viewer, and the download stays disabled
  until the user ticks "I understand the risk". The server refuses an unacknowledged
  download of a flagged file with HTTP 409, so a direct link cannot bypass it.

This stops one-click downloads of things that are dangerous by design. It does not find
malware in an ordinary-looking PDF or image; put ClamAV or a provider scan in front of the
server if you need that.

## App passwords

An app password lets a mail app sign in without your account password and without a second step, so it is treated like any other security change:

- Creating one needs a fresh confirmation (password plus authenticator code, or a passkey) that is good for that action only and can be used once. The same confirmation is required to create an API key that carries the `jmap` scope (Settings > API keys), since that key signs in the same way.
- It is 16 random characters, stored only as a SHA-256 digest, and shown once. It is limited to JMAP and to the mailboxes you pick. It cannot call the `/api` endpoints or open the web app.
- JMAP accepts an app password (or any JMAP key) as a Bearer token or as the password of HTTP Basic, never the account password. Basic shares the guess limit below but is still accepted over plain HTTP for compatibility with existing LAN clients; put it behind HTTPS so the key is not sent in the clear. Bearer is not rate limited.
- Wrong guesses are rate limited: a secret the server has not verified recently spends a per-client budget (by IP address, IPv6 by /64) before it is looked up. A request with no known IP is limited per key being guessed rather than in one shared bucket. The limiter is the platform rate-limit binding, so without one configured (`DEVICE_LOGIN_RATE_LIMIT` or `LOGIN_RATE_LIMIT`) nothing limits guesses.
- Settings > App passwords shows when each one was last used, over which protocol and from which IP address, and revokes it at once.
- Changing or resetting the password, changing two-step sign-in, an administrator resetting the account and "sign out everywhere" delete every app password and older JMAP-only key (keys created before app passwords existed whose only scope is `jmap`, the ones listed under App passwords). API keys that combine `jmap` with other scopes (send, read) are general API keys and are not revoked; revoke them under Settings > API keys.
