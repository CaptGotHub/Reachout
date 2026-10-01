import test from "node:test";
import assert from "node:assert/strict";
import { addInquiry, addGig, cancelGig, setInquiryStatus, gigToIcs } from "./core.js";

test("inquiries validate contact details and can be updated", () => {
  assert.throws(() => addInquiry([], { name: " ", email: "bad", event: "" }), /valid email/);
  const inquiries = addInquiry([], { name: "  Alex ", email: "alex@example.com ", event: " Show ", message: "Hi" });
  assert.equal(inquiries[0].name, "Alex");
  assert.equal(inquiries[0].email, "alex@example.com");
  assert.equal(setInquiryStatus(inquiries, inquiries[0].id, "Replied")[0].status, "Replied");
  assert.equal(inquiries[0].status, "New");
  assert.throws(() => setInquiryStatus(inquiries, "missing", "Booked"), /not found/);
});

test("gigs require an inquiry, valid time range, venue, and no overlap", () => {
  const inquiries = addInquiry([], { name: "Alex", email: "alex@example.com", event: "Show", message: "" });
  const fields = { inquiryId: inquiries[0].id, venue: " Club ", start: "2026-10-03T19:00", end: "2026-10-03T21:00" };
  const gigs = addGig([], inquiries, fields);
  assert.equal(gigs[0].venue, "Club");
  assert.throws(() => addGig(gigs, inquiries, { ...fields, start: "2026-10-03T20:00" }), /overlaps/);
  assert.throws(() => addGig(gigs, inquiries, { ...fields, end: fields.start }), /valid start/);
  assert.throws(() => addGig([], inquiries, { ...fields, inquiryId: "missing" }), /Select an inquiry/);
  assert.equal(addGig(gigs, inquiries, { ...fields, start: "2026-10-03T21:00", end: "2026-10-03T22:00" }).length, 2);
  assert.deepEqual(cancelGig(gigs, gigs[0].id), []);
  assert.throws(() => cancelGig(gigs, "missing"), /not found/);
});

test("calendar export escapes text and includes event dates", () => {
  const ics = gigToIcs({
    id: "abc", title: "Show, live; tonight\nSecond line", venue: "The \\ Club",
    start: "2026-10-03T19:00:00.000Z", end: "2026-10-03T21:00:00.000Z"
  });
  assert.match(ics, /DTSTART:20261003T190000Z\r\nDTEND:20261003T210000Z/);
  assert.match(ics, /SUMMARY:Show\\, live\\; tonight\\nSecond line/);
  assert.match(ics, /LOCATION:The \\\\ Club/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});
