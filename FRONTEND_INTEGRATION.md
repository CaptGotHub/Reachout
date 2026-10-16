# Responder frontend integration

Connects the existing responder, public intake and CSV importer to `https://api.reachoutanswer.me`.
Targets the supplied `RA-20261016-02-field-lifecycle` Worker contract. No Worker or DNS changes are included.

The existing quote/proposal builder, Word/PDF controls, rental and SpinStream worksheets, archive queues, authentication and contact-history tools remain in place. The added adapter maps existing form names to the new API names. Custom select options are retained; unchanged arrays, zero and false retain their source types; explicitly cleared fields and response drafts are sent and checked against the PATCH response.

Music instrumentation maps to `instrumentation`, not `genres`. Genres/style map to `genres` and its legacy `style` companion. Contact fields map separately to customer, owner notification, platform reply and secondary contact. Lesson fields map to the Worker-supported student and lesson fields. Meeting method is separate from address and meeting link. Introductory price/duration are only used in the lesson draft when the owner checks the introductory-offer box.

## Validation

- `node --check responder.js` and `node --check responder-fields.js`
- `node --test tests/thumbtack-import.test.mjs`: six passing, one fixture-dependent skip.
- `npm install --no-save jsdom`, then `REACHOUT_WORKER=/absolute/path/to/worker.mjs node tests/responder-integration.test.cjs`
- Integration test passed against both supplied Worker sources: the latest Cloudflare package and the user-attached Worker. Uses actual frontend JavaScript, jsdom DOM, actual Worker fetch handlers and in-memory KV. Covers save/reopen, custom selections, array travel options, zero, false, clears, saved drafts, introductory offer text, proposal rendering and retained workspace controls.
- No live customer records were written. Full browser visual verification was unavailable because the Chromium download failed.

## Backend boundaries

The supplied Worker does not persist every older worksheet control. Rental/SpinStream worksheets, proposal options, setup rows, custom production details, lesson instrument/format/location/frequency/notes, food/drinks and sound-provider fields retain their previous session-only behavior. The UI explains this; affected individual lesson/production fields are labelled Session only. Do not claim those fields are stored until the backend contract is expanded.

The supplied package's own test suite has a separate student-age extraction failure. This frontend can display, edit and persist student age, but it does not fix incoming webhook extraction.

Merge deploys the GitHub-backed frontend according to the existing Pages configuration. No Worker deployment is required for this frontend-only PR if the supplied Worker contract is active.
