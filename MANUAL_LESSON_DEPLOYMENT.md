# ReachOut: separate piano lesson and live music workflows

Worker deployment is manual in Cloudflare. Do not connect the Worker to GitHub.

This update is based on the supplied production worker.mjs version RA-20261028-02-lead-fields and its supplied thumbtack.mjs module. The Thumbtack attachment was pasted as Markdown; Markdown formatting was removed to recover JavaScript, then syntax, authorization routing and OAuth redirect tests were run.

## Deployment order

1. Keep backups of both current Cloudflare files (and note the current active version).
2. In reachout-respond > Edit code, replace the contents of worker.mjs with the supplied worker-replacement.txt. Replace the contents of the existing thumbtack.mjs with thumbtack-replacement.txt. Keep the editor filenames worker.mjs and thumbtack.mjs. Do not create .txt modules, delete modules, or change bindings/secrets.
3. Deploy the two edited modules together. Check /health reports RA-20261030-01-lessons and lessonFieldsVersion: 1.
4. The frontend changes are in PR #7, CaptGotHub/Reachout. Merge the frontend/repository change only after the Worker is verified. The Worker remains manually managed; merging does not deploy it.
5. Reload /responder. Open a piano inquiry: verify Piano Lessons workspace, student fields, original answers and conversation history. Edit a lesson field, save, reopen and verify it remains. Open a live-music inquiry and verify its event fields and gig reply.

## Included

Distinct PIANO_LESSON and LIVE_MUSIC codes; separate forms and reply routing; persisted lesson fields with readback verification; original source questions and received conversation history; compatibility mapping for existing production field names. Preserves negotiation-based identity, OAuth routes, token refresh, business-phone operations, existing pricing logic, and archive imports. No data reindex or migration is required.

Adds supply::messages.write to requested OAuth scopes, including when THUMBTACK_SCOPES is configured. Existing OAuth tokens do not gain that permission automatically. Reauthorization remains required using the existing connection flow. No messages are sent by deployment.

## Validation and limits

15 automated tests pass; one existing external export-fixture test is skipped. Both Worker modules and responder JavaScript pass syntax checks. Tests use fake storage and synthetic customers, including separate negotiations, a follow-up message, owner edits, and an OAuth redirect without contacting Thumbtack.

Live Cloudflare deployment and browser UI verification remain pending. The ReachOut Send button is not wired to the messages API in this change. This update does not create invoices/estimates through Thumbtack's API. Competition and other source-only details appear when supplied; this does not scrape Thumbtack for missing fields.
