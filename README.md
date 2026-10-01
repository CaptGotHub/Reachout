# Reachout

A small, local-first organizer for musician gig inquiries and bookings.

## Run

Requires Node.js 20 or newer. Run `npm start` and open http://127.0.0.1:3000.
Run `npm test` for the built-in tests. No install or external service is required.

Record inquiries you receive, use **Reply by email** to draft a response in your email application, and mark them replied. Select an inquiry to book a gig; overlapping times are rejected. Browse the month calendar, cancel bookings, and download individual `.ics` events to import into your calendar. Canceling a booking here does not remove events already imported into other calendars.

Data is stored only in this browser's local storage. Other people cannot submit requests remotely, emails are not sent automatically, and clearing browser data or switching devices loses the organizer data. This app does not collect credit-card information or take payments. A shared booking system or payment integration requires a backend and a selected payment provider; never enter card details here.
