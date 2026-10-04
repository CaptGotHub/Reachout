# ReachOut Answer — Multichannel Intake Contract

## Goal

ReachOut is one response system with many doors in. The responder should not depend on Thumbtack-specific fields or outbound access.

Core flow:

`source -> intake -> normalized lead -> ReachOut inbox -> safe first answer -> source-specific outbound`

## Normalized lead envelope

Every intake should preserve the original/raw message while also providing these common fields when available:

- `id`
- `source`: `Thumbtack | Website | Email | Furnished Finder | Other`
- `workspace`: `Live Music | Rentals | SpinStream / NFArtifact | All`
- `status`
- `name`
- `email`
- `phone`
- `requestType`
- `message`
- `sourceMessageId`
- `replyTo` — source-specific reply route when one exists
- `receivedAt`
- `raw`

Workspace-specific fields can live beside the common envelope.

## Furnished Finder

### Official path

Furnished Finder currently documents IPM/custom API integrations, including messaging/conversation APIs. Treat this as an approval/integration path, not as a dependency for ReachOut.

### Email bridge ("email as webhook")

Furnished Finder sends required email notifications for new messages/direct booking inquiries. Current message notifications contain a per-conversation Reply-To mailbox, and Furnished Finder documents that replying to the notification email from the account email sends the response into the Furnished Finder conversation.

Proposed bridge:

1. Furnished Finder notification reaches Nick's account email.
2. An email forwarding/ingest rule sends a copy to a ReachOut inbound email processor.
3. The processor extracts:
   - traveler name
   - property/listing
   - requested start/end
   - occupants/pets when present
   - phone/email when present
   - customer message
   - original Gmail/message ID
   - Furnished Finder Reply-To conversation address
4. Store as:
   - `source = Furnished Finder`
   - `workspace = Rentals`
5. ReachOut prepares a short safe reply immediately.
6. Outbound is sent through either:
   - the authenticated Furnished Finder account email, preserving the Reply-To conversation route, or
   - the official Furnished Finder messaging API once authorized.

Do not auto-send to generic/no-reply Housing Request notices unless there is a verified reply route.

### Rental safety rule

Never automatically promise or change:

- availability
- price
- proration
- deposits
- lease terms
- access instructions

The instant response may acknowledge known dates/details and ask for missing information or call times.

## SpinStream / NFArtifact

SpinStream should use the same normalized intake instead of a separate CRM.

Suggested fields:

- `spinTopic`: pricing/tier, minting, proof/dossier, rights/licensing, troubleshooting, consultation, other
- `ain`
- `mintId`
- `tier`
- `question`

Store as:

- `workspace = SpinStream / NFArtifact`
- `source = Website | Email | Other`

Website/support forms can post directly to the ReachOut Worker once the canonical Worker source is recovered and a generic public intake route is added.

## Website / landing pages

The public music landing page can stay music-centric. It is only one door into ReachOut.

Different forms/pages can submit the same normalized envelope with different `workspace` and `source` values. No need to build three separate CRMs.

Recommended future Worker routes:

- `POST /api/intake` — generic normalized intake
- or source aliases such as:
  - `POST /api/intake/website`
  - `POST /api/intake/email`
  - `POST /api/intake/furnished-finder`

All aliases should normalize into the same KV lead record.

## Current constraint

The canonical deployed `reachout-respond` Worker source is not presently in this repository. Do not replace it from memory.

Before adding new Worker routes, recover the exact deployed Worker source, preserve:

- Thumbtack webhook
- `REACHOUT_LEADS` storage
- protected GET lead API
- protected PATCH lead API
- admin token behavior
- existing normalization

Then add the generic intake/email bridge to that exact source.
