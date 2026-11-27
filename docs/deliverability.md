# Bounce suppression list

MyMailbox can remember addresses that bounced permanently, per sending domain, and optionally stop sending to them. It is **off by default**, on upgrades and on new installations. Nothing changes until the primary administrator picks a mode under **Admin → Email → Deliverability**.

## Modes

| Mode | Returned bounces | Sending |
|---|---|---|
| Off (default) | Not parsed, not recorded | Unchanged |
| Record only | Stored in the list | Unchanged |
| Skip suppressed recipients | Stored in the list | Refused or filtered, see below |

The mode applies to the whole installation. The list itself is per sending domain: a bounce of mail from `a.example` does not block the same person on `b.example`.

## Where entries come from

Cloudflare Email Sending has no bounce or complaint event feed, so the list is built from **returned bounce messages**: a delivery status notification that reaches a mailbox is read only if it names a `Message-ID` of a message sent from that mailbox in the last 30 days, only for recipients that message was addressed to (To, Cc, Bcc), and only for permanent failures (`5.x.x`). The message itself stays in the mailbox. At most 50 distinct addresses are taken from one message.

A returned message alone is **not enforced**. A co-recipient of a message you sent knows its `Message-ID` and the other addresses, so it can forge a bounce for them. These entries are stored **unconfirmed** and start to count once a second returned message names the same address for a *different* original message, or an administrator confirms the entry. A person who received two of your messages could still forge both, so use this source as a hint and review the list.

Entries recorded from Resend's bounce and complaint events, before Resend was removed, are kept as administrator entries (source **Administrator**), still confirmed.

## What "skip suppressed recipients" does

- The composer and `POST /api/send` / `POST /api/v1/send` answer `422` with `{ "code": "SUPPRESSED_RECIPIENT", "addresses": [...] }` before anything is stored.
- JMAP `EmailSubmission/set` returns `notCreated` with type `invalidRecipients`.
- Scheduled and undo-send messages are checked again at delivery. Suppressed recipients are dropped and the drop is written to the audit log (`email.suppressed_recipients_dropped`). If no To recipient is left the message fails.
- Calendar invitations created with `POST /api/calendar/events` are checked before the event is saved and answer the same `422`, so a refused invitation leaves nothing behind and a retry creates no duplicate.
- Auto-replies to a suppressed address are skipped.
- Only **confirmed** entries are enforced; unconfirmed ones (see below) never block a send.
- The stored message keeps every recipient you wrote (history). Recipients dropped at delivery appear only in the `email.suppressed_recipients_dropped` audit entry, with the addresses in its metadata.
- System mail (password reset and similar) is not affected.

## Managing the list

The Deliverability page lists a domain's entries (address, reason, source, event count, last event), with search and a reason filter. **Remove** deletes an entry, after which the next message to that address is attempted again; removals are audit-logged (`deliverability.suppression_removed`). If the same address bounces again it returns to the list.

Unconfirmed entries show an **Unconfirmed** badge. **Confirm** makes one enforceable (audit-logged as `deliverability.suppression_confirmed`); **Remove** deletes it. Administrator entries are confirmed from the start, and a later confirmed event confirms an unconfirmed entry. An unconfirmed event never changes an entry that is already confirmed.

An address that complained stays a complaint; a later bounce does not downgrade it.

## Data

Table `email_suppressions` (address, reason, source `dsn` or `admin`, `confirmed`, the `Message-ID` that first reported it (`evidence_ref`, used to tell a second DSN from a repeat of the first), a diagnostic text truncated to 300 characters, counters and times). It is included in backups. The mode lives in `app_settings.suppression_mode`.
