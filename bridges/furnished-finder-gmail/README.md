# Furnished Finder Gmail bridge

Marker: `RO-FF-GMAIL-BRIDGE-20261003-01`

This is the first Gmail intake bridge for ReachOut Answer.

## What it does

Every minute, the script checks only Gmail messages from:

- `messaging@leads.furnishedfinder.com`
- `no.reply@leads.furnishedfinder.com`

Each individual Gmail **message ID** is processed only once. A normalized lead is posted to the existing ReachOut webhook and is considered complete only when the webhook returns `stored: true`.

## Two contact/reference routes

A lead can carry both:

1. `ff_reply_to` — the unique `conversation-...@leads.furnishedfinder.com` address. When present, this is the preferred reply route because it keeps the response inside the Furnished Finder conversation.
2. `direct_email` — the traveler's own email when the traveler chose to expose it.

The bridge also stores `phone` when available.

`reply_mode` is set to:

- `furnished_finder_conversation` — FF conversation route exists; use this as the primary route.
- `direct_email` — no verified FF conversation route, but traveler email exists.
- `manual_furnished_finder` — neither verified email route exists.

ReachOut stores the lead once with both references.

## Safety

This bridge **does not send any renter reply**. It only ingests and normalizes the lead. Outbound sending remains a separate step.

It also does not commit Gmail credentials or renter data to GitHub.

## Install in Google Apps Script

1. Create a Google Apps Script project under the same Google account that receives the Furnished Finder mail.
2. Paste `Code.gs`.
3. In Apps Script, add the **Gmail API** under **Services** so the script can read the original `Reply-To` header.
4. Run `scanFurnishedFinder` once and approve the requested Google permissions.
5. Check ReachOut for the stored leads.
6. Run `installFurnishedFinderMinuteTrigger` once.

The default ReachOut endpoint is:

`https://reachout-respond.cptnspacetime.workers.dev/webhooks/thumbtack`

To change it without editing code, add a Script Property:

- key: `REACHOUT_ENDPOINT`
- value: the replacement intake endpoint

## Visual Gmail labels

On successful storage, the thread gets:

`ReachOut/FF Stored`

On an ingest error:

`ReachOut/FF Error`

Deduplication is based on the individual Gmail **message ID**, not the thread label, so a later Furnished Finder message in the same Gmail thread can still be ingested normally.

## Next step

Once the canonical `reachout-respond` Worker source is recovered, add a dedicated `POST /api/intake/furnished-finder` route and point `REACHOUT_ENDPOINT` to it. Until then, this bridge leaves the deployed Worker source untouched.
