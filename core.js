const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function addInquiry(inquiries, { name = "", email = "", event = "", message = "" }) {
  name = name.trim();
  email = email.trim();
  event = event.trim();
  message = message.trim();
  if (!name || !emailPattern.test(email) || !event) {
    throw new Error("Enter a name, valid email, and event description.");
  }
  return [{ id: crypto.randomUUID(), name, email, event, message, status: "New" }, ...inquiries];
}

export function setInquiryStatus(inquiries, id, status) {
  if (!["New", "Replied", "Booked"].includes(status) || !inquiries.some(inquiry => inquiry.id === id)) {
    throw new Error("Inquiry or status not found.");
  }
  return inquiries.map(inquiry => inquiry.id === id ? { ...inquiry, status } : inquiry);
}

export function addGig(gigs, inquiries, { inquiryId, start, end, venue }) {
  const inquiry = inquiries.find(item => item.id === inquiryId);
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  venue = (venue ?? "").trim();
  if (!inquiry || !venue || !start || !end || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new Error("Select an inquiry, venue, and valid start and end times.");
  }
  if (gigs.some(gig => startTime < new Date(gig.end).getTime() && endTime > new Date(gig.start).getTime())) {
    throw new Error("That time overlaps an existing gig.");
  }
  return [{ id: crypto.randomUUID(), inquiryId, title: inquiry.event, start, end, venue }, ...gigs];
}

export function cancelGig(gigs, id) {
  if (!gigs.some(gig => gig.id === id)) throw new Error("Gig not found.");
  return gigs.filter(gig => gig.id !== id);
}

const icsEscape = value => String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
const icsDate = value => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function gigToIcs(gig) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reachout//Gig Calendar//EN",
    "BEGIN:VEVENT", `UID:${icsEscape(gig.id)}@reachout.local`,
    `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(gig.start)}`, `DTEND:${icsDate(gig.end)}`,
    `SUMMARY:${icsEscape(gig.title)}`, `LOCATION:${icsEscape(gig.venue)}`,
    "END:VEVENT", "END:VCALENDAR", ""
  ].join("\r\n");
}
