import { addInquiry, setInquiryStatus, addGig, cancelGig, gigToIcs } from "./core.js";

const key = "reachout-gigs-v1";
const notice = document.querySelector("#notice");
let state = { inquiries: [], gigs: [] };
let storageReady = true;
let displayedMonth = new Date();
displayedMonth.setDate(1);

try {
  const saved = JSON.parse(localStorage.getItem(key));
  if (saved !== null) {
    if (!Array.isArray(saved.inquiries) || !Array.isArray(saved.gigs)) throw new Error("Invalid saved data");
    state = saved;
  }
} catch {
  storageReady = false;
  notice.textContent = "Saved data could not be read. New changes will not overwrite it; check browser storage.";
  document.querySelectorAll("form button").forEach(button => button.disabled = true);
}

function save(next) {
  if (!storageReady) return false;
  try {
    localStorage.setItem(key, JSON.stringify(next));
    state = next;
    notice.textContent = "Saved in this browser.";
    render();
    return true;
  } catch {
    notice.textContent = "Could not save. Check that browser storage is enabled and has space.";
    return false;
  }
}

function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function button(label, action) {
  const node = text("button", label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function render() {
  const inquiries = document.querySelector("#inquiries");
  const select = document.querySelector("#inquiry-select");
  inquiries.replaceChildren();
  select.replaceChildren();
  select.append(text("option", "Select an inquiry"));
  select.firstChild.value = "";
  if (!state.inquiries.length) inquiries.append(text("li", "No inquiries yet."));
  for (const inquiry of state.inquiries) {
    const item = document.createElement("li");
    item.append(text("strong", `${inquiry.name} — ${inquiry.event}`), text("p", `${inquiry.email} · ${inquiry.status}`));
    if (inquiry.message) item.append(text("p", inquiry.message));
    const reply = document.createElement("a");
    reply.href = `mailto:${encodeURIComponent(inquiry.email)}?subject=${encodeURIComponent(`Re: ${inquiry.event}`)}&body=${encodeURIComponent(`Hi ${inquiry.name},\n\nThanks for reaching out about ${inquiry.event}.\n\n`)}`;
    reply.textContent = "Reply by email";
    item.append(reply);
    if (inquiry.status === "New") item.append(button("Mark replied", () => {
      try { save({ ...state, inquiries: setInquiryStatus(state.inquiries, inquiry.id, "Replied") }); }
      catch (error) { notice.textContent = error.message; }
    }));
    inquiries.append(item);
    const option = text("option", `${inquiry.name} — ${inquiry.event}`);
    option.value = inquiry.id;
    select.append(option);
  }

  const gigs = document.querySelector("#gigs");
  gigs.replaceChildren();
  const sorted = [...state.gigs].sort((a, b) => new Date(a.start) - new Date(b.start));
  if (!sorted.length) gigs.append(text("li", "No gigs booked yet."));
  for (const gig of sorted) {
    const item = document.createElement("li");
    item.append(text("strong", gig.title), text("p", `${new Date(gig.start).toLocaleString()} – ${new Date(gig.end).toLocaleString()} · ${gig.venue}`));
    item.append(button("Download calendar event", () => {
      const url = URL.createObjectURL(new Blob([gigToIcs(gig)], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "reachout-gig.ics";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    item.append(button("Cancel gig", () => {
      const remaining = cancelGig(state.gigs, gig.id);
      const inquiries = remaining.some(other => other.inquiryId === gig.inquiryId)
        ? state.inquiries
        : setInquiryStatus(state.inquiries, gig.inquiryId, "Replied");
      save({ inquiries, gigs: remaining });
    }));
    gigs.append(item);
  }
  renderCalendar(sorted);
}

function renderCalendar(gigs) {
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();
  document.querySelector("#month-label").textContent = displayedMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const calendar = document.querySelector("#calendar");
  calendar.replaceChildren();
  for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) calendar.append(text("strong", day));
  const first = new Date(year, month, 1).getDay();
  for (let blank = 0; blank < first; blank++) calendar.append(document.createElement("div"));
  const last = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= last; day++) {
    const cell = document.createElement("div");
    cell.append(text("strong", String(day)));
    for (const gig of gigs) {
      const start = new Date(gig.start);
      if (start.getFullYear() === year && start.getMonth() === month && start.getDate() === day) {
        cell.append(text("small", `${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${gig.title}`));
      }
    }
    calendar.append(cell);
  }
}

document.querySelector("#inquiry-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    if (save({ ...state, inquiries: addInquiry(state.inquiries, Object.fromEntries(new FormData(form))) })) form.reset();
  } catch (error) { notice.textContent = error.message; }
});

document.querySelector("#gig-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const fields = Object.fromEntries(new FormData(form));
    const gigs = addGig(state.gigs, state.inquiries, fields);
    const inquiries = setInquiryStatus(state.inquiries, fields.inquiryId, "Booked");
    if (save({ inquiries, gigs })) {
      displayedMonth = new Date(new Date(fields.start).getFullYear(), new Date(fields.start).getMonth(), 1);
      render();
      form.reset();
    }
  } catch (error) { notice.textContent = error.message; }
});

document.querySelector("#previous-month").addEventListener("click", () => {
  displayedMonth.setMonth(displayedMonth.getMonth() - 1);
  render();
});
document.querySelector("#next-month").addEventListener("click", () => {
  displayedMonth.setMonth(displayedMonth.getMonth() + 1);
  render();
});

render();
