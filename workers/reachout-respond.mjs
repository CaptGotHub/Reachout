/**
 * ReachOut Answer
 * Worker: reachout-respond
 * Version: RA-20261006-04-contacts
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({ ok: true, service: "ReachOut Answer", version: "RA-20261006-04-contacts", status: "online" });
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "ReachOut Answer", version: "RA-20261006-04-contacts", status: "ready", kvConnected: !!env.REACHOUT_LEADS, webhook: "/webhooks/thumbtack", leads: "/api/leads", csvImport: "/api/admin/import-thumbtack", csvBatchSize: 10 });
      }
      if (request.method === "POST" && url.pathname === "/webhooks/thumbtack") {
        return await receiveThumbtack(request, env);
      }
      if (url.pathname === "/api/admin/import-thumbtack") {
        if (request.method === "OPTIONS") { return new Response(null, { status: 204, headers: apiCors() }); }
        if (!checkAuth(request, env)) { return apiJson({ ok: false, error: "unauthorized" }, 401); }
        if (request.method !== "POST") { return apiJson({ ok: false, error: "method_not_allowed" }, 405); }
        return await importThumbtackContacts(request, env);
      }
      if (url.pathname === "/api/admin/reindex") {
        if (request.method === "OPTIONS") { return new Response(null, { status: 204, headers: apiCors() }); }
        if (request.method === "POST" || request.method === "GET") {
          if (request.method === "GET") {
            const token = url.searchParams.get("token");
            if (!env.REACHOUT_ADMIN_TOKEN || token !== env.REACHOUT_ADMIN_TOKEN) {
              return json({ ok: false, error: "unauthorized" }, 401);
            }
          } else {
            if (!checkAuth(request, env)) { return apiJson({ ok: false, error: "unauthorized" }, 401); }
          }
          return await reindexLeads(env);
        }
        return apiJson({ ok: false, error: "method_not_allowed" }, 405);
      }
      const isLeadsPath = url.pathname === "/api/leads" || /^\/api\/leads\/([^/]+)$/.test(url.pathname);
      if (isLeadsPath) {
        if (request.method === "OPTIONS") { return new Response(null, { status: 204, headers: apiCors() }); }
        const isLeadsList = request.method === "GET" && url.pathname === "/api/leads";
        const match = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
        const isLeadsItem = match && (request.method === "GET" || request.method === "PATCH");
        if (isLeadsList || isLeadsItem) {
          if (!checkAuth(request, env)) { return apiJson({ ok: false, error: "unauthorized" }, 401); }
          if (isLeadsList) { return await listLeads(env, url); }
          const id = decodeURIComponent(match[1]);
          if (request.method === "GET") { return await getLead(id, env); }
          if (request.method === "PATCH") { return await patchLead(id, request, env); }
        }
        return apiJson({ ok: false, error: "method_not_allowed" }, 405);
      }
      if (request.method === "OPTIONS") { return new Response(null, { status: 204, headers: corsHeaders() }); }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (error) {
      console.error("REACHOUT_ERROR", error);
      return json({ ok: false, error: "internal_error", message: String(error?.message || error) }, 500);
    }
  }
};

function checkAuth(request, env) {
  if (!env.REACHOUT_ADMIN_TOKEN) return false;
  const header = request.headers.get("Authorization") || "";
  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return false;
  const provided = parts[1];
  const expected = env.REACHOUT_ADMIN_TOKEN;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) { diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i); }
  return diff === 0;
}

async function receiveThumbtack(request, env) {
  if (!env.REACHOUT_LEADS) return json({ ok: false, error: "REACHOUT_LEADS_not_bound" }, 500);
  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const now = new Date().toISOString();
  const fields = extractFields(payload);
  const negotiationId = deepFind(payload, ["negotiation_id", "negotiationId", "negotiationID"]);
  const conversationId = deepFind(payload, ["conversation_id", "conversationId", "conversationID"]);
  const externalLeadId = deepFind(payload, ["lead_id", "leadId"]);
  const eventId = deepFind(payload, ["event_id", "eventId"]) || crypto.randomUUID();
  const customerKey = safeId(String((fields.name || "") + "|" + (fields.phone || "") + "|" + (fields.email || "")).toLowerCase());
  const leadId = customerKey ? "thumbtack-" + customerKey : "thumbtack-" + safeId(String(negotiationId || conversationId || externalLeadId || eventId));
  let lead = await readJSON(env.REACHOUT_LEADS, "lead:" + leadId);
  if (!lead) { lead = { id: leadId, source: "THUMBTACK", workspace: "LIVE MUSIC", status: "NEW", createdAt: now, eventCount: 0, eventIds: [] }; }
  lead.updatedAt = now;
  lead.eventCount = (lead.eventCount || 0) + 1;
  if (!lead.eventIds) lead.eventIds = [];
  lead.eventIds.push(String(eventId));
  lead.negotiationId = negotiationId || lead.negotiationId || null;
  lead.conversationId = conversationId || lead.conversationId || null;
  lead.name = fields.name || lead.name || null;
  lead.firstName = fields.firstName || lead.firstName || null;
  lead.email = fields.email || lead.email || null;
  lead.phone = fields.phone || lead.phone || null;
  lead.requestType = fields.requestType || lead.requestType || "Live Music";
  lead.eventDate = fields.eventDate || lead.eventDate || null;
  lead.startTime = fields.startTime || lead.startTime || null;
  lead.endTime = fields.endTime || lead.endTime || null;
  lead.location = fields.location || lead.location || null;
  lead.message = fields.message || lead.message || null;
  lead.musicians = fields.musicians || lead.musicians || null;
  lead.style = fields.style || lead.style || null;
  lead.budget = fields.budget || lead.budget || null;
  lead.guestCount = fields.guestCount || lead.guestCount || null;
  lead.eventType = fields.eventType || lead.eventType || null;
  lead.leadPrice = fields.leadPrice || lead.leadPrice || null;
  lead.estimate = fields.estimate || lead.estimate || null;
  lead.calendarStatus = lead.calendarStatus || "UNKNOWN";
  lead.latestRaw = payload;
  lead.missing = missingFields(lead);
  lead.suggestedResponse = makeResponse(lead);
  await env.REACHOUT_LEADS.put("lead:" + leadId, JSON.stringify(lead));
  await env.REACHOUT_LEADS.put("event:" + leadId + ":" + safeId(String(eventId)), JSON.stringify({ eventId, leadId, receivedAt: now, payload }));
  await updateIndex(env, lead);
  console.log("REACHOUT_LEAD_STORED", { leadId, eventCount: lead.eventCount });
  return json({ ok: true, received: true, stored: true, leadId });
}

async function listLeads(env, url) {
  if (url?.searchParams.has("ids")) {
    const ids = [...new Set(url.searchParams.get("ids").split(",").filter(Boolean))];
    if (!ids.length || ids.length > 10 || ids.some(id => !/^[a-zA-Z0-9_-]{1,160}$/.test(id))) {
      return apiJson({ ok: false, error: "invalid_lead_ids" }, 400);
    }
    const found = await Promise.all(ids.map(id => readJSON(env.REACHOUT_LEADS, "lead:" + id)));
    const leads = found.filter(Boolean);
    return apiJson({ ok: true, count: leads.length, leads, missingIds: ids.filter((id, i) => !found[i]) });
  }
  if (url?.searchParams.get("archived") === "0") {
    const active = (await readJSON(env.REACHOUT_LEADS, "index:leads") || []).filter(lead => !lead.archived);
    const archiveCount = Number(await env.REACHOUT_LEADS.get("count:archive") || 0);
    active.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return apiJson({ ok: true, count: active.length, activeCount: active.length, archiveCount, leads: active });
  }
  const index = await readLeadIndex(env);
  index.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const archiveCount = index.filter(lead => lead.archived === true).length;
  const leads = url?.searchParams.has("archived") ? index.filter(lead => (lead.archived === true) === (url.searchParams.get("archived") === "1")) : index;
  return apiJson({ ok: true, count: leads.length, activeCount: index.length - archiveCount, archiveCount, leads });
}

async function getLead(id, env) {
  const lead = await readJSON(env.REACHOUT_LEADS, "lead:" + id);
  if (!lead) return apiJson({ ok: false, error: "lead_not_found" }, 404);
  return apiJson({ ok: true, lead });
}

async function patchLead(id, request, env) {
  const lead = await readJSON(env.REACHOUT_LEADS, "lead:" + id);
  if (!lead) return apiJson({ ok: false, error: "lead_not_found" }, 404);
  let changes;
  try { changes = await request.json(); } catch { return apiJson({ ok: false, error: "invalid_json" }, 400); }
  const allowed = ["status","calendarStatus","eventDate","startTime","endTime","location","musicians","style","message","budget","guestCount","eventType","fee","deposit","notes","name","email","phone","requestType","archived"];
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return apiJson({ ok: false, error: "invalid_changes" }, 400);
  if ("archived" in changes && typeof changes.archived !== "boolean") return apiJson({ ok: false, error: "invalid_archive_state" }, 400);
  for (const field of ["name","email","phone","requestType"]) {
    if (field in changes && changes[field] !== null && (typeof changes[field] !== "string" || changes[field].length > 500)) return apiJson({ ok: false, error: "invalid_contact_field" }, 400);
  }
  for (const field of allowed) { if (field in changes) { lead[field] = changes[field]; } }
  lead.updatedAt = new Date().toISOString();
  lead.missing = missingFields(lead);
  lead.suggestedResponse = makeResponse(lead);
  await env.REACHOUT_LEADS.put("lead:" + id, JSON.stringify(lead));
  await updateIndex(env, lead);
  return apiJson({ ok: true, lead });
}

function leadSummary(lead) {
  return {
    id: lead.id, source: lead.source, workspace: lead.workspace, status: lead.status,
    name: lead.name || lead.firstName || "New Thumbtack Lead",
    phone: lead.phone || null, email: lead.email || null,
    requestType: lead.requestType, eventDate: lead.eventDate, startTime: lead.startTime, endTime: lead.endTime,
    location: lead.location, calendarStatus: lead.calendarStatus, eventCount: lead.eventCount, updatedAt: lead.updatedAt,
    musicians: lead.musicians || null, style: lead.style || null, budget: lead.budget || null,
    guestCount: lead.guestCount || null, eventType: lead.eventType || null,
    leadPrice: lead.leadPrice ?? null, estimate: lead.estimate || null,
    message: lead.message || null, missing: lead.missing || [], suggestedResponse: lead.suggestedResponse || null,
    recordType: lead.recordType || null, contactDate: lead.contactDate || null, archived: lead.archived === true,
    contactHistoryCount: (lead.contactHistory || []).length,
    contactImportKeys: (lead.contactHistory || []).map(entry => entry.key)
  };
}

async function updateIndex(env, lead) {
  const key = lead.archived ? "index:archive" : "index:leads";
  let index = await readJSON(env.REACHOUT_LEADS, key) || [];
  const summary = leadSummary(lead);
  const position = index.findIndex(item => item.id === lead.id);
  if (position >= 0) { index[position] = summary; } else { index.unshift(summary); }
  index = index.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  await env.REACHOUT_LEADS.put(key, JSON.stringify(index));
  if (lead.archived) await env.REACHOUT_LEADS.put("count:archive", String(index.length));
  const otherKey = lead.archived ? "index:leads" : "index:archive";
  const other = await readJSON(env.REACHOUT_LEADS, otherKey) || [];
  const remaining = other.filter(item => item.id !== lead.id);
  if (remaining.length !== other.length) {
    await env.REACHOUT_LEADS.put(otherKey, JSON.stringify(remaining));
    if (!lead.archived) await env.REACHOUT_LEADS.put("count:archive", String(remaining.length));
  }
}

async function readLeadIndex(env) {
  const [active, archive] = await Promise.all([readJSON(env.REACHOUT_LEADS, "index:leads"), readJSON(env.REACHOUT_LEADS, "index:archive")]);
  return [...new Map([...(active || []), ...(archive || [])].map(lead => [lead.id, lead])).values()];
}

function contactPhoneKey(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  return digits;
}

function contactNameKey(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function contactIdentity(value) {
  if (!contactPhoneKey(value.phone)) return JSON.stringify([contactNameKey(value.name), "", value.contactDate, contactNameKey(value.category || value.requestType), contactNameKey(value.raw?.["Business Name"] || value.businessName)]);
  return JSON.stringify([contactNameKey(value.name), contactPhoneKey(value.phone)]);
}

function normalizeContactRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_csv_row");
  if (Object.keys(raw).length > 40 || Object.values(raw).some(value => typeof value !== "string" || value.length > 4000)) throw new Error("invalid_csv_values");
  const value = key => String(raw[key] || "").trim();
  const name = value("Customer Name"), phone = value("Phone Number"), contactDate = value("Date of Contact"), category = value("Category");
  if (!name || !category || (phone && contactPhoneKey(phone).length < 7)) throw new Error("missing_contact_fields");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contactDate) || Number.isNaN(Date.parse(contactDate + "T12:00:00Z")) || new Date(contactDate + "T12:00:00Z").toISOString().slice(0, 10) !== contactDate) throw new Error("invalid_contact_date");
  const money = key => {
    const text = value(key).replace(/[$,]/g, "");
    if (!text) return null;
    if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error("invalid_contact_cost");
    return Number(text);
  };
  const row = { name, phone, contactDate, category, email: value("Email") || value("Email Address") || value("Customer Email") || null,
    location: [value("Zip Code"), value("State")].filter(Boolean).join(", "),
    leadPrice: money("Lead Cost"), netCost: money("Net Cost"), salesTax: money("Sales Tax"), raw: { ...raw } };
  row.key = JSON.stringify([contactNameKey(name), contactPhoneKey(phone), contactDate, contactNameKey(category), contactNameKey(value("Business Name")), Object.entries(raw).sort(([a], [b]) => a.localeCompare(b))]);
  return row;
}

async function importThumbtackContacts(request, env) {
  if (!env.REACHOUT_LEADS) return apiJson({ ok: false, error: "REACHOUT_LEADS_not_bound" }, 500);
  let body, rows;
  try {
    body = await request.json();
    if (!Array.isArray(body?.rows) || !body.rows.length || body.rows.length > 10) return apiJson({ ok: false, error: "send_1_to_10_csv_rows" }, 400);
    rows = body.rows.map(normalizeContactRow);
  } catch (error) { return apiJson({ ok: false, error: String(error.message || "invalid_json") }, 400); }
  const index = await readLeadIndex(env);
  const now = new Date().toISOString(), touched = new Map(), receipts = [];
  let created = 0, updated = 0, skipped = 0;
  for (const row of rows) {
    const identity = contactIdentity(row);
    let lead = touched.get(identity);
    if (!lead) {
      const match = index.find(item => String(item.source || "").toUpperCase() === "THUMBTACK" && (contactIdentity(item) === identity || (item.contactImportKeys || []).some(key => {
        try { return JSON.stringify(JSON.parse(key).slice(0, 2)) === identity; } catch { return false; }
      })));
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const id = match?.id || "thumbtack-import-" + hash.slice(0, 32);
      lead = await readJSON(env.REACHOUT_LEADS, "lead:" + id);
      if (!lead) {
        lead = { id, source: "THUMBTACK", workspace: "LIVE MUSIC", status: "ARCHIVED", archived: true, recordType: "THUMBTACK_CONTACT_IMPORT", name: row.name, phone: row.phone, email: row.email,
          firstName: firstWord(row.name), eventDate: null, startTime: null, endTime: null, message: null, calendarStatus: "UNKNOWN", eventCount: 0, eventIds: [], createdAt: now };
        created++;
      }
      lead.contactHistory = Array.isArray(lead.contactHistory) ? lead.contactHistory : [];
      touched.set(identity, lead);
    }
    const previous = lead.contactHistory.find(entry => entry.key === row.key);
    if (previous && JSON.stringify(previous.raw) === JSON.stringify(row.raw)) {
      skipped++;receipts.push({ key: row.key, leadId: lead.id, outcome: "skipped" });continue;
    }
    if (previous) {
      previous.raw = row.raw; previous.updatedAt = now;
    } else {
      lead.contactHistory.push({ key: row.key, contactDate: row.contactDate, category: row.category, raw: row.raw, importedAt: now });
    }
    lead.contactHistory.sort((a, b) => b.contactDate.localeCompare(a.contactDate));
    if (lead.recordType === "THUMBTACK_CONTACT_IMPORT") {
      const latest = normalizeContactRow(lead.contactHistory[0].raw);
      lead.contactDate = latest.contactDate; lead.requestType = latest.category; lead.location = latest.location;
      lead.leadPrice = latest.leadPrice; lead.netCost = latest.netCost; lead.salesTax = latest.salesTax;
      lead.businessName = latest.raw["Business Name"] || null;
      lead.sourceJobStatus = latest.raw["Job Status"] || null;
      if (!lead.email && latest.email) lead.email = latest.email;
    }
    lead.updatedAt = now;
    lead.missing = missingFields(lead); lead.suggestedResponse = makeResponse(lead);
    updated++;receipts.push({ key: row.key, leadId: lead.id, outcome: previous ? "updated" : "stored" });
  }
  // One index read/write per batch avoids competing index writes within the import.
  for (const lead of touched.values()) {
    await env.REACHOUT_LEADS.put("lead:" + lead.id, JSON.stringify(lead));
    const position = index.findIndex(item => item.id === lead.id), summary = leadSummary(lead);
    if (position >= 0) index[position] = summary; else index.push(summary);
  }
  index.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  await env.REACHOUT_LEADS.put("index:archive", JSON.stringify(index.filter(lead => lead.archived)));
  await env.REACHOUT_LEADS.put("count:archive", String(index.filter(lead => lead.archived).length));
  const activeUpdates = [...touched.values()].filter(lead => !lead.archived);
  if (activeUpdates.length) {
    const activeIndex = (await readJSON(env.REACHOUT_LEADS, "index:leads") || []).filter(lead => !lead.archived);
    for (const lead of activeUpdates) {
      const position = activeIndex.findIndex(item => item.id === lead.id);
      if (position >= 0) activeIndex[position] = leadSummary(lead); else activeIndex.push(leadSummary(lead));
    }
    await env.REACHOUT_LEADS.put("index:leads", JSON.stringify(activeIndex));
  }
  return apiJson({ ok: true, processed: rows.length, created, updated, skipped, receipts, leads: [...touched.values()].map(leadSummary) });
}

async function reindexLeads(env) {
  let allKeys = [];
  let cursor = undefined;
  do {
    const list = await env.REACHOUT_LEADS.list({ prefix: "lead:", cursor });
    allKeys.push(...list.keys);
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  const allLeads = [];
  for (const key of allKeys) {
    const lead = await readJSON(env.REACHOUT_LEADS, key.name);
    if (!lead) continue;
    if (lead.latestRaw) {
      const fields = extractFields(lead.latestRaw);
      if (!lead.name && fields.name) lead.name = fields.name;
      if (!lead.firstName && fields.firstName) lead.firstName = fields.firstName;
      if (!lead.email && fields.email) lead.email = fields.email;
      if (!lead.phone && fields.phone) lead.phone = fields.phone;
      if (!lead.eventDate && fields.eventDate) lead.eventDate = fields.eventDate;
      if (!lead.startTime && fields.startTime) lead.startTime = fields.startTime;
      if (!lead.endTime && fields.endTime) lead.endTime = fields.endTime;
      if (!lead.location && fields.location) lead.location = fields.location;
      if (!lead.message && fields.message) lead.message = fields.message;
      if (!lead.musicians && fields.musicians) lead.musicians = fields.musicians;
      if (!lead.style && fields.style) lead.style = fields.style;
      lead.budget = fields.budget || lead.budget || null;
      lead.guestCount = fields.guestCount || lead.guestCount || null;
      lead.eventType = fields.eventType || lead.eventType || null;
      lead.leadPrice = fields.leadPrice || lead.leadPrice || null;
      lead.estimate = fields.estimate || lead.estimate || null;
      lead.requestType = fields.requestType || lead.requestType || "Live Music";
    }
    allLeads.push({ key: key.name, lead });
  }
  const merged = {};
  for (const { key, lead } of allLeads) {
    const mergeKey = lead.recordType === "THUMBTACK_CONTACT_IMPORT" ? "import:" + lead.id : safeId(String(lead.name || lead.firstName || "").toLowerCase());
    if (!merged[mergeKey]) {
      merged[mergeKey] = { ...lead, _originalKeys: [key] };
    } else {
      const existing = merged[mergeKey];
      for (const field of ["eventDate","startTime","endTime","location","budget","guestCount","style","musicians","eventType","leadPrice","estimate","message","phone","email","requestType"]) {
        if (!existing[field] && lead[field]) existing[field] = lead[field];
      }
      if (lead.eventType === "NegotiationCreatedV4" && existing.eventType !== "NegotiationCreatedV4") {
        existing.eventType = "NegotiationCreatedV4";
      }
      existing.eventCount = (existing.eventCount || 0) + (lead.eventCount || 1);
      existing._originalKeys.push(key);
      if (String(lead.updatedAt || "") > String(existing.updatedAt || "")) {
        existing.updatedAt = lead.updatedAt;
      }
    }
  }
  const index = [];
  let mergedCount = 0;
  for (const [mergeKey, lead] of Object.entries(merged)) {
    const newId = lead.recordType === "THUMBTACK_CONTACT_IMPORT" ? lead.id : "thumbtack-" + mergeKey;
    lead.id = newId;
    lead.missing = missingFields(lead);
    lead.suggestedResponse = makeResponse(lead);
    const newKey = "lead:" + newId;
    await env.REACHOUT_LEADS.put(newKey, JSON.stringify(lead));
    mergedCount++;
    for (const oldKey of lead._originalKeys) {
      if (oldKey !== newKey) {
        await env.REACHOUT_LEADS.delete(oldKey);
      }
    }
    index.push(leadSummary(lead));
  }
  index.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  await env.REACHOUT_LEADS.put("index:leads", JSON.stringify(index.filter(lead => !lead.archived)));
  await env.REACHOUT_LEADS.put("index:archive", JSON.stringify(index.filter(lead => lead.archived)));
  await env.REACHOUT_LEADS.put("count:archive", String(index.filter(lead => lead.archived).length));
  return apiJson({ ok: true, reindexed: mergedCount, count: index.length, leads: index });
}

function extractFields(payload) {
  const firstName = deepFind(payload, ["first_name", "firstName"]);
  const lastName = deepFind(payload, ["last_name", "lastName"]);
  let name = deepFind(payload, ["customer_name", "customerName", "displayName"]);
  if (!name && (firstName || lastName)) { name = [firstName, lastName].filter(Boolean).join(" "); }
  const proposedTimes = deepGet(payload, ["data", "request", "proposedTimes"]);
  const details = deepGet(payload, ["data", "request", "details"]);
  const customer = deepGet(payload, ["data", "customer"]);
  if (!name && customer) {
    const cFirst = customer.firstName || customer.first_name;
    const cLast = customer.lastName || customer.last_name;
    if (cFirst || cLast) { name = [cFirst, cLast].filter(Boolean).join(" "); }
    else if (customer.displayName) { name = customer.displayName; }
  }
  let eventDate = deepFind(payload, ["event_date", "eventDate", "job_date"]);
  let startTime = deepFind(payload, ["start_time", "startTime"]);
  let endTime = deepFind(payload, ["end_time", "endTime"]);
  if (proposedTimes && Array.isArray(proposedTimes) && proposedTimes.length > 0) {
    const first = proposedTimes[0];
    if (first && first.start) {
      const startDt = new Date(first.start);
      if (!isNaN(startDt.getTime())) {
        eventDate = startDt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        startTime = startDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
      }
    }
    if (first && first.end) {
      const endDt = new Date(first.end);
      if (!isNaN(endDt.getTime())) {
        endTime = endDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
      }
    }
  }
  let location = deepFind(payload, ["location", "job_location", "jobLocation", "city"]);
  const reqLocation = deepGet(payload, ["data", "request", "location"]);
  if (!location && reqLocation) {
    const parts = [reqLocation.city, reqLocation.state, reqLocation.zipCode].filter(Boolean);
    if (parts.length) { location = parts.join(", "); }
  }
  let message = deepFind(payload, ["message", "customer_message", "customerMessage", "description", "text"]);
  let style = deepFind(payload, ["style", "genre", "music_style"]);
  let musicians = deepFind(payload, ["musicians", "number_of_musicians", "musician_count"]);
  let budget = deepFind(payload, ["budget"]);
  let guestCount = deepFind(payload, ["guest_count", "guestCount", "number_of_guests"]);
  let eventType = deepFind(payload, ["event_type", "eventType"]);
  if (details && Array.isArray(details)) {
    for (const d of details) {
      if (!d.question || !d.answer) continue;
      const q = String(d.question).toLowerCase();
      const a = String(d.answer);
      if (q.includes("genre") && !style) { style = a; }
      if (q.includes("music type") && !style) { style = a; }
      if (q.includes("musician") && !musicians) { musicians = a; }
      if (q.includes("guest") && !guestCount) { guestCount = a; }
      if (q.includes("budget") && !budget) { budget = a; }
      if (q.includes("event type") && !eventType) { eventType = a; }
      if (q.includes("scheduling") && !eventDate) {
        const dateMatch = a.match(/Date:\s*(.+)/);
        if (dateMatch) { eventDate = dateMatch[1].trim(); }
        const timeMatch = a.match(/Time:\s*(.+)/);
        if (timeMatch && !startTime) { startTime = timeMatch[1].trim(); }
      }
    }
  }
  const estimateRaw = deepGet(payload, ["data", "estimate"]);
  let estimate = null;
  if (estimateRaw) { estimate = { pricePerUnit: estimateRaw.pricePerUnit || null, unitName: estimateRaw.unitName || null, total: estimateRaw.total || null }; }
  let leadPrice = deepFind(payload, ["leadPrice", "lead_price"]);
  let requestType = deepFind(payload, ["service_name", "serviceName", "job_type", "jobType"]);
  const categoryName = deepGet(payload, ["data", "request", "category", "name"]);
  if (!requestType && categoryName) { requestType = categoryName; }
  return { name, firstName, email: deepFind(payload, ["email", "customer_email", "customerEmail"]), phone: deepFind(payload, ["phone", "phone_number", "phoneNumber"]), requestType: requestType || "Live Music", eventDate, startTime, endTime, location, message, musicians, style, budget, guestCount, eventType, leadPrice, estimate };
}

function missingFields(lead) {
  const missing = [];
  if (!lead.eventDate) missing.push("event date");
  if (!lead.startTime) missing.push("start time");
  if (!lead.endTime) missing.push("end time");
  if (!lead.location) missing.push("location / venue");
  return missing;
}

function makeResponse(lead) {
  if (lead.recordType === "THUMBTACK_CONTACT_IMPORT") return "";
  const firstName = lead.firstName || firstWord(lead.name) || "there";
  let text = "Hi " + firstName + " — thanks for reaching out";
  if (lead.requestType) { text += " about " + String(lead.requestType).toLowerCase(); }
  text += ".";
  if (lead.eventDate) { text += " I saw you're looking at " + lead.eventDate; }
  if (lead.startTime && lead.endTime) { text += " from " + lead.startTime + " to " + lead.endTime; }
  if (lead.location) { text += " in " + lead.location; }
  if (lead.eventDate || lead.startTime || lead.endTime || lead.location) { text += "."; }
  if (lead.style) { text += " " + lead.style + " sounds like a good direction."; }
  if (lead.musicians) { text += " I saw you're considering " + lead.musicians + "."; }
  if (lead.message) { text += " I also saw your note about " + lead.message + "."; }
  if (!lead.calendarStatus || lead.calendarStatus === "UNKNOWN") { text += " I still need to confirm the requested time against my calendar before promising availability."; }
  const missing = missingFields(lead);
  if (missing.length) { text += " To keep this moving, could you also send me the " + missing.join(", ") + "?"; }
  else { text += " I have the basic event details and can put together the right setup and quote."; }
  text += "\n\nNick Laudani\n617-233-2008";
  return text;
}

function deepFind(value, names) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, names);
      if (found !== null && found !== undefined && found !== "") return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(value, name) && value[name] !== null && value[name] !== undefined && value[name] !== "") {
      if (typeof value[name] !== "object") return String(value[name]);
    }
  }
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) {
      const found = deepFind(child, names);
      if (found !== null && found !== undefined && found !== "") return found;
    }
  }
  return null;
}

function deepGet(value, path) {
  let current = value;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") return null;
    current = current[key];
  }
  return current !== undefined && current !== null ? current : null;
}

async function readJSON(kv, key) {
  if (!kv) return null;
  const raw = await kv.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function firstWord(value) {
  if (!value) return null;
  return String(value).trim().split(/\s+/)[0] || null;
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160);
}

function apiCors() {
  return { "access-control-allow-origin": "https://music.reachoutanswer.me", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS", "access-control-allow-headers": "authorization, content-type" };
}

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS", "access-control-allow-headers": "content-type, authorization" };
}

function apiJson(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...apiCors() } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders() } });
}
