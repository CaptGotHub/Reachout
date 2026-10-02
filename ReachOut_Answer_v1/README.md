# ReachOut Answer v1

Upload the entire folder contents to the root of the `CaptGotHub/Reachout` repository.

## Pages
- `/` — public ReachOut Answer landing page
- `/music/` — public Live Music answer/lead page
- `/admin/` — private CRM shell (NOT SECURE YET; add authentication before real lead data)

## Architecture target
- Public site: `reachoutanswer.me`
- API/Worker alias later: `api.reachoutanswer.me`
- Thumbtack target: `/webhooks/thumbtack`

The calendar section currently creates a booking request only. It must be connected to a real calendar before times can be presented as available or confirmed.
