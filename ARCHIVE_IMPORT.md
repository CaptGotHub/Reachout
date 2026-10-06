# Thumbtack contact archive

The owner inbox has an Active inbox queue and an Archive queue. CSV imports add earlier contacts to Archive and preserve every unique source row in each contact's history. If a source contact matches an active Thumbtack lead by normalized name and phone, history is added to that active lead; its current request, message, status and notes are retained.

All CSV columns remain in the history. Contact dates do not become performance dates. Emails and unrevealed phones stay empty. Contacts without a phone are kept separately by name, contact date, category and business because a name alone is insufficient to identify a person. Repeated exports are safe to resume: exact rows are skipped, and differing source rows are retained.

## Deployment

Pages deploys the frontend from this repository's `main` branch. The Worker remains a manual deployment.

1. In Cloudflare, open **reachout-respond**, then **Edit code**.
2. Replace the Worker source with `workers/reachout-respond.mjs` and deploy.
3. Preserve the existing **REACHOUT_LEADS** KV binding and **REACHOUT_ADMIN_TOKEN** secret. No new binding, secret or webhook configuration is required.
4. `/health` should show `RA-20261006-04-contacts` and `csvImport: /api/admin/import-thumbtack`.
5. Open `/import-thumbtack.html` on the music site. Unlock the owner inbox in the same browser, choose the CSV files, review the preview, then import.

The import page checks the worker capability before enabling import. The old worker can continue serving the active inbox while the update is pending.

## Worker and frontend contract

- `POST /api/admin/import-thumbtack`: owner bearer authentication; accepts 1–10 original CSV rows in `{rows:[...]}`. Returns per-row receipts and summaries.
- `GET /api/leads?ids=<comma-separated IDs>`: authenticated full records for up to 10 contacts, used for independent readback after every batch.
- `GET /api/leads?archived=0`: active inbox and queue counts.
- `GET /api/leads?archived=1`: archived contacts and queue counts.
- `GET /api/leads`: both queues, used to check import overlap.
- `PATCH /api/leads/:id`: existing saved fields plus name, phone, email and request type.
- Imported records use `archived:true`, `status:ARCHIVED`, `recordType:THUMBTACK_CONTACT_IMPORT`, and `contactHistory:[{key,contactDate,category,raw,importedAt}]`.
- Active and archive summaries use separate `index:leads` and `index:archive` keys in the existing KV namespace. The archive has no 500-contact truncation. Viewing the active inbox does not download the archive.

CSV imports do not invoke the Thumbtack webhook, send customer messages, change the provider connection or invoke the existing administrative reindex operation. The normal Thumbtack intake remains in place.

## Contact email tools

Open an archived contact, add an email in the contact fields and choose **Save lead**. **Open email draft** prepares an unsent draft in the device's email application. **Export email contacts** downloads only archived contacts with saved emails. No mass sender or external email service is connected by this change.

## Validation

Run `node --test tests/thumbtack-import.test.mjs`. To validate private exports locally, set `REACHOUT_CSV_DIR` to their local directory before running the tests. Private CSV data is never included in the repository.

The five supplied exports yielded 703 rows, 637 unique export rows, 66 duplicate rows and 621 contact records in an isolated worker test. All 637 records were read back and checked, four simulated active leads were preserved, and all seven contract checks passed. This test verifies the prepared code; live import remains a separate operation.
