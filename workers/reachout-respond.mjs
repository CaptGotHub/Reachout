// BEGIN SHARED LEAD MODEL
// Shared, pure lead classification and Thumbtack request-field mapping.
const LESSON_FIELDS = ['studentName','studentAge','studentLevel','lessonInstrument','lessonGoals','lessonFormat','lessonLocation','lessonTimes','lessonLength','lessonFrequency','lessonRate','lessonNotes'];
const DETAIL_FIELDS = [...LESSON_FIELDS,'travelPreference','guestAge','musicType','included','competition','sourceCreatedAt','sourceTimezone'];
const present = value => value !== undefined && value !== null && value !== '';
function answerText(value) {
  if (!present(value)) return '';
  if (Array.isArray(value)) return value.map(answerText).filter(Boolean).join('; ');
  if (typeof value === 'object') return answerText(value.text ?? value.label ?? value.value ?? value.name ?? value.answer ?? value.answers ?? '');
  return String(value);
}
function requestDetails(raw = {}) {
  const details = raw?.data?.request?.details ?? raw?.request?.details ?? [];
  if (!Array.isArray(details)) return [];
  return details.map(d => ({question:answerText(d.question ?? d.label),answer:answerText(d.answer ?? d.answers ?? d.value)})).filter(d=>d.question && d.answer);
}
function serviceCode(lead = {}) {
  const raw = lead.sourceRequest || lead.latestRaw || {};
  const category = answerText(raw?.data?.request?.category?.name ?? raw?.request?.category?.name);
  const type = [lead.requestType,lead.request,lead.serviceName,lead.service_name,(lead.detailOverrides||[]).includes('requestType')?'':category].filter(Boolean).join(' ');
  // Specific lesson categories win over the old blanket LIVE MUSIC workspace.
  if (/piano\s*lessons?|keyboard\s*lessons?/i.test(type)) return 'PIANO_LESSON';
  if (/lessons?/i.test(type)) return 'MUSIC_LESSON';
  if (/rental|furnished finder/i.test(type+' '+(lead.workspace||'')+' '+(lead.source||''))) return 'RENTAL';
  if (/spinstream|nfartifact/i.test(type+' '+(lead.workspace||''))) return 'SPINSTREAM';
  if (/music|wedding|cocktail|party|band|musician|event|piano|performance/i.test(type)) return 'LIVE_MUSIC';
  if (['PIANO_LESSON','MUSIC_LESSON','LIVE_MUSIC','RENTAL','SPINSTREAM','OTHER'].includes(lead.serviceCode)) return lead.serviceCode;
  return /lesson/i.test(lead.workspace||'')?'MUSIC_LESSON':/music/i.test(lead.workspace||'')?'LIVE_MUSIC':'OTHER';
}
const isLesson = lead => /^(PIANO|MUSIC)_LESSON$/.test(serviceCode(lead));
const workspaceFor = lead => ({PIANO_LESSON:'Piano Lessons',MUSIC_LESSON:'Music Lessons',LIVE_MUSIC:'Live Music',RENTAL:'Rentals',SPINSTREAM:'SpinStream / NFArtifact',OTHER:'All'}[serviceCode(lead)]);
function normalizeLead(input = {}) {
  const lead = {...input};
  const raw = lead.sourceRequest || lead.latestRaw || {};
  const req = raw?.data?.request ?? raw?.request ?? {};
  const customer = raw?.data?.customer ?? raw?.customer ?? {};
  const put = (key,value) => {if (!(lead.detailOverrides||[]).includes(key) && !present(lead[key]) && present(value)) lead[key]=answerText(value);};
  if (!(lead.detailOverrides||[]).includes('requestType') && (!lead.requestType || lead.requestType==='Live Music') && req.category?.name) lead.requestType=req.category.name;
  put('name',customer.displayName || [customer.firstName,customer.lastName].filter(Boolean).join(' '));
  put('email',customer.email);put('phone',customer.phoneNumber || customer.phone);
  put('sourceCreatedAt',req.createdAt || raw?.data?.createdAt);
  put('sourceTimezone',req.timeZone || req.timezone);
  if (req.location && typeof req.location==='object') put('location',[req.location.city,req.location.state,req.location.zipCode].filter(Boolean).join(', '));
  lead.serviceCode=serviceCode(lead);
  if(isLesson(lead)||!lead.workspace)lead.workspace=workspaceFor(lead);
  const lesson=isLesson(lead);
  for(const [field,legacy] of Object.entries({studentLevel:'studentExperience',lessonTimes:'preferredDays',lessonLength:'lessonDuration',lessonFormat:'meetingMethod',lessonGoals:'studentGoals',travelPreference:'travelOptions',musicType:'genres',venueContact:'secondaryContact'}))put(field,lead[legacy]);
  if (lesson) {
    put('studentName',lead.name);put('studentAge',lead.guestAge);put('lessonLocation',lead.location);
    if(lead.serviceCode==='PIANO_LESSON')put('lessonInstrument','Piano');
  }
  for(const {question,answer} of requestDetails(raw)) {
    const q=question.toLowerCase();
    if(/travel/.test(q))put('travelPreference',answer);
    if(/included/.test(q))put('included',answer);
    if(lesson){
      if(/age|how old/.test(q))put('studentAge',answer);
      else if(/experience|level|taken.*lesson/.test(q))put('studentLevel',answer);
      else if(/instrument/.test(q))put('lessonInstrument',answer);
      else if(/goal|learn|interest/.test(q))put('lessonGoals',answer);
      else if(/length|duration/.test(q))put('lessonLength',answer);
      else if(/frequency|how often/.test(q))put('lessonFrequency',answer);
      else if(/timeline|availability|scheduling|days|times|when/.test(q))put('lessonTimes',answer);
      else if(/format|online|remote|in.person/.test(q))put('lessonFormat',answer);
      else if(/location|where/.test(q))put('lessonLocation',answer);
    }else{
      if(/guest.*age|age.*guest/.test(q))put('guestAge',answer);
      if(/music type|instrumentation/.test(q))put('musicType',answer);
    }
  }
  if(lesson)put('lessonGoals',lead.message || lead.customerMessage);
  // A request's proposed times are not a booked lesson, and an estimate is not a budget.
  return lead;
}
// END SHARED LEAD MODEL
import { handleThumbtack } from "./thumbtack.mjs";
/**
 * ReachOut Answer
 * Worker: reachout-respond
 * Version: RA-20261030-01-lessons
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/oauth/thumbtack/") || url.pathname === "/api/admin/thumbtack" || url.pathname.startsWith("/api/admin/thumbtack/")) {
        return await handleThumbtack(request, env, url, { checkAuth, apiJson, apiCors, json, receiveThumbtack });
      }
      if (request.method === "GET" && url.pathname === "/") {
        return json({ ok: true, service: "ReachOut Answer", version: "RA-20261030-01-lessons", status: "online" });
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "ReachOut Answer", version: "RA-20261030-01-lessons", status: "ready", kvConnected: !!env.REACHOUT_LEADS, webhook: "/webhooks/thumbtack", leads: "/api/leads", csvImport: "/api/admin/import-thumbtack", csvBatchSize: 10, lessonFieldsVersion: 1 });
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

const LEGACY_FIELD_MAP = { venueContact: "secondaryContact", musicType: "genres", travelPreference: "travelOptions" };

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
  const legacyLeadId = customerKey ? "thumbtack-" + customerKey : "thumbtack-" + safeId(String(negotiationId || conversationId || externalLeadId || eventId));
  const leadId = await resolveLeadId(env, negotiationId, legacyLeadId);
  let lead = await readJSON(env.REACHOUT_LEADS, "lead:" + leadId);
  if (!lead) { lead = { id: leadId, source: "THUMBTACK", workspace: "LIVE MUSIC", status: "NEW", createdAt: now, eventCount: 0, eventIds: [] }; }
  lead.updatedAt = now;
  lead.eventCount = (lead.eventCount || 0) + 1;
  if (!lead.eventIds) lead.eventIds = [];
  lead.eventIds.push(String(eventId));
  lead.negotiationId = negotiationId || lead.negotiationId || null;
  lead.conversationId = conversationId || lead.conversationId || null;
  if (!lead.originalInquiry) { lead.originalInquiry = { name: fields.name, message: fields.message, requestType: fields.requestType, eventDate: fields.eventDate, location: fields.location, raw: payload }; }
  lead.name = fields.name || lead.name || null;
  lead.firstName = fields.firstName || lead.firstName || null;
  lead.email = fields.email || lead.email || null;
  lead.phone = fields.phone || lead.phone || null;
  if (!(lead.detailOverrides||[]).includes("requestType")) lead.requestType = fields.requestType || lead.requestType || "Other";
  if (payload.data?.request || payload.request) lead.sourceRequest = payload;
  for (const field of DETAIL_FIELDS) { if (!(lead.detailOverrides||[]).includes(field) && fields[field] !== undefined && fields[field] !== null && fields[field] !== "") lead[field] = fields[field]; }
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
  lead.customerEmail = fields.customerEmail || lead.customerEmail || null;
  lead.customerPhone = fields.customerPhone || lead.customerPhone || null;
  lead.platformReplyAddress = fields.platformReplyAddress || lead.platformReplyAddress || null;
  lead.ownerNotificationAddress = fields.ownerNotificationAddress || lead.ownerNotificationAddress || null;
  lead.secondaryContact = fields.secondaryContact || lead.secondaryContact || null;
  if (!(lead.detailOverrides||[]).includes("studentAge")) lead.studentAge = fields.studentAge || lead.studentAge || null;
  lead.studentExperience = fields.studentExperience || lead.studentExperience || null;
  lead.readsMusic = fields.readsMusic || lead.readsMusic || null;
  lead.hasPiano = fields.hasPiano || lead.hasPiano || null;
  lead.preferredDays = fields.preferredDays || lead.preferredDays || null;
  lead.lessonDuration = fields.lessonDuration || lead.lessonDuration || null;
  lead.meetingMethod = fields.meetingMethod || lead.meetingMethod || null;
  lead.meetingLink = fields.meetingLink || lead.meetingLink || null;
  lead.travelOptions = fields.travelOptions || lead.travelOptions || null;
  lead.genres = fields.genres || lead.genres || null;
  lead.instrumentation = fields.instrumentation || lead.instrumentation || null;
  lead.musicianCount = fields.musicianCount || lead.musicianCount || null;
  lead.regularPrice = fields.regularPrice || lead.regularPrice || null;
  lead.studentGoals = fields.studentGoals || lead.studentGoals || null;
  lead.teacherRecommends = fields.teacherRecommends || lead.teacherRecommends || null;
  lead.loadIn = fields.loadIn || lead.loadIn || null;
  lead.sound = fields.sound || lead.sound || null;
  lead.microphones = fields.microphones || lead.microphones || null;
  lead.power = fields.power || lead.power || null;
  lead.parking = fields.parking || lead.parking || null;
  lead.dressCode = fields.dressCode || lead.dressCode || null;
  lead.specialSongs = fields.specialSongs || lead.specialSongs || null;
  lead.instructions = fields.instructions || lead.instructions || null;
  if (!(lead.detailOverrides||[]).includes("guestAge")) lead.guestAge = fields.guestAge || lead.guestAge || null;
  if (!(lead.detailOverrides||[]).includes("competition")) lead.competition = fields.competition || lead.competition || null;
  if (!(lead.detailOverrides||[]).includes("included")) lead.included = fields.included || lead.included || null;
  lead.customerBudget = fields.customerBudget || lead.customerBudget || null;
  lead.leadCost = fields.leadCost || lead.leadCost || null;
  lead.thumbtackPrice = fields.thumbtackPrice || lead.thumbtackPrice || null;
  lead.calendarStatus = lead.calendarStatus || "UNKNOWN";
  applyThumbtackEvent(lead, payload, fields, now);
  Object.assign(lead,normalizeLead(lead));
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
  return apiJson({ ok: true, lead: normalizeLead(lead) });
}

async function patchLead(id, request, env) {
  const lead = await readJSON(env.REACHOUT_LEADS, "lead:" + id);
  if (!lead) return apiJson({ ok: false, error: "lead_not_found" }, 404);
  let changes;
  try { changes = await request.json(); } catch { return apiJson({ ok: false, error: "invalid_json" }, 400); }
  const allowed = ["status","calendarStatus","archived","name","firstName","customerEmail","customerPhone","platformReplyAddress","ownerNotificationAddress","secondaryContact","requestType","eventType","message","originalInquiry","eventDate","startTime","endTime","location","address","guestCount","guestAge","meetingMethod","meetingLink","travelOptions","instrumentation","musicianCount","genres","musicians","style","loadIn","sound","microphones","power","parking","dressCode","specialSongs","instructions","studentAge","studentExperience","readsMusic","hasPiano","preferredDays","lessonDuration","studentGoals","teacherRecommends","regularPrice","introOffer","introPrice","introDuration","customerBudget","leadPrice","leadCost","thumbtackPrice","estimate","fee","deposit","budget","competition","included","responseDraft","notes","email","phone","serviceCode","workspace",...DETAIL_FIELDS];
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return apiJson({ ok: false, error: "invalid_changes" }, 400);
  if ("archived" in changes && typeof changes.archived !== "boolean") return apiJson({ ok: false, error: "invalid_archive_state" }, 400);
  for (const field of ["name","email","phone","requestType"]) {
    if (field in changes && changes[field] !== null && (typeof changes[field] !== "string" || changes[field].length > 500)) return apiJson({ ok: false, error: "invalid_contact_field" }, 400);
  }
  for (const [legacy, modern] of Object.entries(LEGACY_FIELD_MAP)) { if (legacy in changes && !(modern in changes)) { changes[modern] = changes[legacy]; } }
  for (const field of [...DETAIL_FIELDS,"serviceCode","workspace"]) {
    if (field in changes && changes[field] !== null && (typeof changes[field] !== "string" || changes[field].length > 12000)) return apiJson({ok:false,error:"invalid_detail_field",field},400);
  }
  for (const field of allowed) { if (field in changes) { lead[field] = changes[field]; } }
  if ("status" in changes && !("archived" in changes)) { if (changes.status === "archived") lead.archived = true; else if (lead.archived === true) lead.archived = false; }
  lead.detailOverrides=[...new Set([...(lead.detailOverrides||[]),...[...DETAIL_FIELDS,"requestType"].filter(field=>field in changes)])];
  lead.serviceCode = serviceCode(lead); lead.workspace = workspaceFor(lead);
  lead.updatedAt = new Date().toISOString();
  lead.missing = missingFields(lead);
  lead.suggestedResponse = makeResponse(lead);
  if ("customerEmail" in changes) lead.email = changes.customerEmail;
  if ("customerPhone" in changes) lead.phone = changes.customerPhone;
  if ("email" in changes && !("customerEmail" in changes)) lead.customerEmail = changes.email;
  if ("phone" in changes && !("customerPhone" in changes)) lead.customerPhone = changes.phone;
  await env.REACHOUT_LEADS.put("lead:" + id, JSON.stringify(lead));
  await updateIndex(env, lead);
  return apiJson({ ok: true, lead: normalizeLead(lead) });
}

function leadSummary(lead) {
  lead = normalizeLead(lead);
  return {
    serviceCode:lead.serviceCode,
    id: lead.id, source: lead.source, workspace: lead.workspace, status: lead.status,
    name: lead.name || lead.firstName || "New Thumbtack Lead",
    customerPhone: lead.customerPhone || lead.phone || null, customerEmail: lead.customerEmail || lead.email || null,
    phone: lead.customerPhone || lead.phone || null, email: lead.customerEmail || lead.email || null,
    platformReplyAddress: lead.platformReplyAddress || null, ownerNotificationAddress: lead.ownerNotificationAddress || null,
    secondaryContact: lead.secondaryContact || lead.venueContact || null,
    requestType: lead.requestType, eventDate: lead.eventDate, startTime: lead.startTime, endTime: lead.endTime,
    location: lead.location, address: lead.address || null, calendarStatus: lead.calendarStatus,
    eventCount: lead.eventCount, updatedAt: lead.updatedAt,
    musicians: lead.musicians || null, style: lead.style || null, budget: lead.budget || null,
    guestCount: lead.guestCount || null, guestAge: lead.guestAge || null, eventType: lead.eventType || null,
    meetingMethod: lead.meetingMethod || null, meetingLink: lead.meetingLink || null, travelOptions: lead.travelOptions || lead.travelPreference || null,
    instrumentation: lead.instrumentation || null, musicianCount: lead.musicianCount || null, genres: lead.genres || lead.musicType || null,
    loadIn: lead.loadIn || null, sound: lead.sound || null, microphones: lead.microphones || null,
    power: lead.power || null, parking: lead.parking || null, dressCode: lead.dressCode || null,
    specialSongs: lead.specialSongs || null, instructions: lead.instructions || null,
    studentAge: lead.studentAge || null, studentExperience: lead.studentExperience || null,
    readsMusic: lead.readsMusic || null, hasPiano: lead.hasPiano || null,
    preferredDays: lead.preferredDays || null, lessonDuration: lead.lessonDuration || null,
    studentGoals: lead.studentGoals || null, teacherRecommends: lead.teacherRecommends || null,
    regularPrice: lead.regularPrice ?? null, introOffer: lead.introOffer ?? null,
    introPrice: lead.introPrice ?? null, introDuration: lead.introDuration ?? null,
    customerBudget: lead.customerBudget ?? null, leadPrice: lead.leadPrice ?? null,
    leadCost: lead.leadCost ?? null, thumbtackPrice: lead.thumbtackPrice ?? null,
    estimate: lead.estimate || null, fee: lead.fee ?? null, deposit: lead.deposit ?? null,
    competition: lead.competition || null, included: lead.included || null,
    message: lead.message || null, missing: lead.missing || [],
    suggestedResponse: lead.suggestedResponse || null, responseDraft: lead.responseDraft || null,
    recordType: lead.recordType || null, contactDate: lead.contactDate || null,
    inquiryKind: inquiryKind(lead), zip: lead.zip || null, travelRange: lead.travelRange || null, venue: lead.venue || null,
    instrumentAtHome: lead.instrumentAtHome || null, schedulingNote: lead.schedulingNote || null,
    conversationCount: (lead.conversation || []).length, lastCustomerMessage: lead.lastCustomerMessage || null, lastCustomerMessageAt: lead.lastCustomerMessageAt || null,
    archived: lead.archived === true,
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
      if (!(lead.detailOverrides||[]).includes("requestType")) lead.requestType = fields.requestType || lead.requestType || "Other";
  if (payload.data?.request || payload.request) lead.sourceRequest = payload;
  for (const field of DETAIL_FIELDS) { if (fields[field] !== undefined && fields[field] !== null && fields[field] !== "") lead[field] = fields[field]; }
      if (!lead.customerEmail && fields.customerEmail) lead.customerEmail = fields.customerEmail;
      if (!lead.customerPhone && fields.customerPhone) lead.customerPhone = fields.customerPhone;
      if (!lead.studentAge && fields.studentAge) lead.studentAge = fields.studentAge;
      if (!lead.studentExperience && fields.studentExperience) lead.studentExperience = fields.studentExperience;
      if (!lead.readsMusic && fields.readsMusic) lead.readsMusic = fields.readsMusic;
      if (!lead.hasPiano && fields.hasPiano) lead.hasPiano = fields.hasPiano;
      if (!lead.preferredDays && fields.preferredDays) lead.preferredDays = fields.preferredDays;
      if (!lead.lessonDuration && fields.lessonDuration) lead.lessonDuration = fields.lessonDuration;
      if (!lead.meetingMethod && fields.meetingMethod) lead.meetingMethod = fields.meetingMethod;
      if (!lead.travelOptions && fields.travelOptions) lead.travelOptions = fields.travelOptions;
      if (!lead.genres && fields.genres) lead.genres = fields.genres;
      if (!lead.instrumentation && fields.instrumentation) lead.instrumentation = fields.instrumentation;
      if (!lead.regularPrice && fields.regularPrice) lead.regularPrice = fields.regularPrice;
      if (!lead.studentGoals && fields.studentGoals) lead.studentGoals = fields.studentGoals;
      if (!lead.teacherRecommends && fields.teacherRecommends) lead.teacherRecommends = fields.teacherRecommends;
      if (!lead.guestAge && fields.guestAge) lead.guestAge = fields.guestAge;
      if (!lead.competition && fields.competition) lead.competition = fields.competition;
      if (!lead.included && fields.included) lead.included = fields.included;
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

function extractFieldsLegacy(payload) {
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
  const category = deepGet(payload,["data","request","category","name"]) || deepFind(payload,["service_name","serviceName","job_type","jobType"]);
  const lesson = isLesson({requestType:category});
  if (!lesson && proposedTimes && Array.isArray(proposedTimes) && proposedTimes.length > 0) {
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
  if (reqLocation && typeof reqLocation === 'object') {
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
      if (!d.question || d.answer===undefined || d.answer===null) continue;
      const q = String(d.question).toLowerCase();
      const a = answerText(d.answer);
      if (q.includes("genre") && !style) { style = a; }
      if (q.includes("music type") && !style) { style = a; }
      if (q.includes("musician") && !musicians) { musicians = a; }
      if (q.includes("guest") && !q.includes("age") && !guestCount) { guestCount = a; }
      if (q.includes("budget") && !budget) { budget = a; }
      if (q.includes("event type") && !eventType) { eventType = a; }
      if (!lesson && q.includes("scheduling") && !eventDate) {
        const dateMatch = a.match(/Date:\s*(.+)/);
        if (dateMatch) { eventDate = dateMatch[1].trim(); }
        const timeMatch = a.match(/Time:\s*(.+)/);
        if (timeMatch && !startTime) { startTime = timeMatch[1].trim(); }
      }
    }
  }
  const estimateRaw = deepGet(payload, ["data", "estimate"]);
  let estimate = null;
  if (estimateRaw) { estimate = { pricePerUnit: estimateRaw.pricePerUnit ?? null, unitName: estimateRaw.unitName ?? null, total: estimateRaw.total ?? null, duration: estimateRaw.duration ?? null, included: estimateRaw.included ?? null }; }
  let leadPrice = deepFind(payload, ["leadPrice", "lead_price"]);
  let requestType = deepFind(payload, ["service_name", "serviceName", "job_type", "jobType"]);
  const categoryName = deepGet(payload, ["data", "request", "category", "name"]);
  if (!requestType && categoryName) { requestType = categoryName; }
  // --- Piano-lesson & extended fields from Thumbtack details Q&A ---
  // 'details' is already declared above; reuse it
  let studentAge=null,studentExperience=null,readsMusic=null,hasPiano=null,preferredDays=null;
  let lessonDuration=null,meetingMethod=null,travelOptions=null,regularPrice=null;
  let teacherRecommends=null,studentGoals=null,genres=null,instrumentation=null;
  let loadIn=null,sound=null,microphones=null,power=null,parking=null,dressCode=null,specialSongs=null,instructions=null;
  let guestAge=null,competition=null,included=null;
  if (details && Array.isArray(details)) {
    for (const d of details) {
      if (!d.question || !d.answer) continue;
      const q = String(d.question).toLowerCase(); const a = answerText(d.answer);
      if (q.includes("age") && !studentAge) { studentAge = a; guestAge = a; }
      if ((q.includes("experience")||q.includes("training")) && !studentExperience) studentExperience = a;
      if ((q.includes("read")&&q.includes("music"))||q.includes("reads music")) readsMusic = normalizeReadsMusic(a);
      if (q.includes("piano")&&(q.includes("own")||q.includes("have")||q.includes("keyboard"))) hasPiano = normalizeHasPiano(a);
      if ((q.includes("day")||q.includes("time")||q.includes("schedule")||q.includes("availability")) && !preferredDays) preferredDays = a;
      if (q.includes("duration")||q.includes("minute")||q.includes("length")) lessonDuration = a;
      if (q.includes("virtual")||q.includes("remote")||q.includes("zoom")||q.includes("in person")||q.includes("in-person")||q.includes("online")||q.includes("meeting")||q.includes("lesson method")) { meetingMethod = normalizeMeetingMethod(a); travelOptions = a; }
      if (q.includes("travel")||q.includes("location preference")||q.includes("come to")) travelOptions = travelOptions || a;
      if (q.includes("price")||q.includes("rate")||q.includes("cost")) { if (!regularPrice) regularPrice = a; }
      if (q.includes("teacher recommend")||q.includes("style preference")||q.includes("musical style")) { teacherRecommends = a; if (!genres) genres = a; }
      if (q.includes("goal")||q.includes("want to learn")||q.includes("looking to")) studentGoals = a;
      if (q.includes("load")&&q.includes("in")) loadIn = a;
      if (q.includes("sound")&&!q.includes("sound system")) sound = a;
      if (q.includes("microphone")||q.includes("mic ")) microphones = a;
      if (q.includes("power")||q.includes("outlet")||q.includes("electric")) power = a;
      if (q.includes("parking")) parking = a;
      if (q.includes("dress")||q.includes("attire")) dressCode = a;
      if (q.includes("song")&&(q.includes("special")||q.includes("request")||q.includes("first dance"))) specialSongs = a;
      if (q.includes("instruction")||q.includes("note")||q.includes("anything else")) instructions = a;
      if (q.includes("competition")||q.includes("other quotes")||q.includes("other vendor")) competition = a;
      if (q.includes("included")||q.includes("what is included")||q.includes("package")) included = a;
    }
  }
  return { name, firstName, customerEmail: extractCustomerEmail(payload), customerPhone: extractCustomerPhone(payload), email: extractCustomerEmail(payload), phone: extractCustomerPhone(payload), platformReplyAddress: deepGet(payload,["data","conversation","replyTo"]) || deepFind(payload,["reply_to","replyTo"]) || null, ownerNotificationAddress: detectOwnerNotification(payload), secondaryContact: null, requestType: requestType || "Live Music", eventDate, startTime, endTime, location, address: null, message, musicians, style, budget, guestCount, guestAge, eventType, meetingMethod, meetingLink: null, travelOptions, instrumentation, musicianCount: null, genres, loadIn, sound, microphones, power, parking, dressCode, specialSongs, instructions, studentAge, studentExperience, readsMusic, hasPiano, preferredDays, lessonDuration, studentGoals, teacherRecommends, regularPrice, leadPrice, leadCost: null, thumbtackPrice: null, competition, included, estimate };
}

function isLessonInquiry(lead) { return isLesson(lead); }

function extractCustomerEmail(payload) {
  const explicit = deepGet(payload, ["data","customer","email"]) || deepGet(payload, ["data","customer","customerEmail"]) || deepGet(payload, ["data","customer","customer_email"]) || deepGet(payload, ["customer","email"]) || deepGet(payload, ["customer","customerEmail"]) || deepGet(payload, ["customerEmail"]) || deepGet(payload, ["customer_email"]) || deepGet(payload, ["email"]);
  if (explicit && !isLikelyNotificationAddress(explicit)) return String(explicit);
  const customer = deepGet(payload, ["data","customer"]) || deepGet(payload, ["customer"]);
  if (customer && typeof customer === "object") { for (const key of ["email","customerEmail","customer_email","emailAddress"]) { if (customer[key] && !isLikelyNotificationAddress(customer[key])) return String(customer[key]); } }
  return null;
}
function extractCustomerPhone(payload) {
  const explicit = deepGet(payload, ["data","customer","phone"]) || deepGet(payload, ["data","customer","customerPhone"]) || deepGet(payload, ["data","customer","phone_number"]) || deepGet(payload, ["customer","phone"]) || deepGet(payload, ["customerPhone"]) || deepGet(payload, ["customer_phone"]) || deepGet(payload, ["phone"]) || deepGet(payload, ["phone_number"]) || deepGet(payload, ["phoneNumber"]);
  if (explicit) return String(explicit);
  const customer = deepGet(payload, ["data","customer"]) || deepGet(payload, ["customer"]);
  if (customer && typeof customer === "object") { for (const key of ["phone","customerPhone","customer_phone","phoneNumber","phone_number"]) { if (customer[key]) return String(customer[key]); } }
  return null;
}
function isLikelyNotificationAddress(email) {
  if (!email || typeof email !== "string") return false;
  const lower = email.toLowerCase();
  if (lower.match(/^(studio|notifications?|noreply|no-reply|info|admin|support|alerts?|leads?|inbound)/)) return true;
  if (lower.includes("spinstream.xyz")) return true;
  if (lower.includes("reachoutanswer.me")) return true;
  return false;
}
function detectOwnerNotification(payload) {
  const candidates = [deepGet(payload,["data","notificationEmail"]),deepGet(payload,["data","ownerEmail"]),deepGet(payload,["data","studioEmail"]),deepGet(payload,["notificationEmail"]),deepGet(payload,["ownerEmail"])].filter(Boolean);
  for (const c of candidates) { if (isLikelyNotificationAddress(c)) return String(c); }
  const allEmails = findAllEmails(payload);
  for (const e of allEmails) { if (isLikelyNotificationAddress(e)) return e; }
  return null;
}
function findAllEmails(obj) {
  const emails = [];
  function scan(val) { if (!val) return; if (typeof val === "string") { const m = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g); if (m) emails.push(...m); } else if (Array.isArray(val)) { for (const item of val) scan(item); } else if (typeof val === "object") { for (const v of Object.values(val)) scan(v); } }
  scan(obj);
  return [...new Set(emails)];
}
function normalizeReadsMusic(answer) {
  const a = String(answer || "").toLowerCase().trim();
  if (a.includes("yes") || a.includes("can read")) return "Yes";
  if (a.includes("some") || a.includes("little") || a.includes("basic")) return "Some";
  if (a.includes("no") || a.includes("cannot") || a.includes("can't")) return "No";
  return "Unknown";
}
function normalizeHasPiano(answer) {
  const a = String(answer || "").toLowerCase().trim();
  if (a.includes("piano") && !a.includes("keyboard")) return "Piano";
  if (a.includes("keyboard") && !a.includes("piano")) return "Keyboard";
  if (a.includes("both")) return "Piano";
  if (a.includes("neither") || a.includes("no") || a.includes("don't have") || a.includes("dont have")) return "Neither";
  return "Unknown";
}
function normalizeMeetingMethod(answer) {
  const a = String(answer || "").toLowerCase().trim();
  if (a.includes("zoom")) return "Zoom";
  if (a.includes("whatsapp")) return "WhatsApp";
  if (a.includes("phone")) return "Phone";
  if (a.includes("in person") || a.includes("in-person")) { if (a.includes("customer") || a.includes("their") || a.includes("your")) return "In person at customer's location"; if (a.includes("my") || a.includes("studio") || a.includes("teacher")) return "In person at my location"; return "In person at customer's location"; }
  if (a.includes("remote") || a.includes("virtual") || a.includes("online")) return "Zoom";
  if (a.includes("not decided") || a.includes("unsure") || a.includes("flexible")) return "Not decided";
  return null;
}
function missingFields(lead) {
  if(isLesson(lead)){lead=normalizeLead(lead);return [["lessonTimes","preferred days / times"],["lessonFormat","online or in-person lesson preference"]].filter(([field])=>!lead[field]||lead[field]==="TBD").map(([,label])=>label);}
  const missing = [];
  if (isLessonInquiry(lead)) {
    if (!lead.studentAge && !lead.guestAge) missing.push("student age");
    if (!lead.studentExperience) missing.push("experience level");
    if (!lead.readsMusic) missing.push("reads music status");
    if (!lead.hasPiano) missing.push("has piano/keyboard");
    if (!lead.preferredDays) missing.push("preferred days/times");
    if (!lead.lessonDuration) missing.push("lesson duration");
    if (!lead.meetingMethod) missing.push("meeting method");
    if (!lead.customerEmail && !lead.email) missing.push("email");
    if (!lead.customerPhone && !lead.phone) missing.push("phone");
  } else {
    if (!lead.eventDate) missing.push("event date");
    if (!lead.startTime) missing.push("start time");
    if (!lead.endTime) missing.push("end time");
    if (!lead.location) missing.push("location / venue");
    if (!lead.customerEmail && !lead.email) missing.push("email");
    if (!lead.customerPhone && !lead.phone) missing.push("phone");
  }
  return missing;
}

function makeResponseLegacy(lead) {
  if (lead.recordType === "THUMBTACK_CONTACT_IMPORT") return "";
  if (lead.responseDraft) return lead.responseDraft;
  const firstName = lead.firstName || firstWord(lead.name) || "there";
  if (isLessonInquiry(lead)) return makeLessonResponse(lead, firstName);
  let text = "Hi " + firstName + " — thanks for reaching out";
  if (lead.requestType) { text += " about " + String(lead.requestType).toLowerCase(); }
  text += ".";
  if (lead.eventDate) { text += " I saw you're looking at " + lead.eventDate; }
  if (lead.startTime && lead.endTime) { text += " from " + lead.startTime + " to " + lead.endTime; }
  if (lead.location) { text += " in " + lead.location; }
  if (lead.eventDate || lead.startTime || lead.endTime || lead.location) { text += "."; }
  if (lead.style) { text += " " + lead.style + " sounds like a good direction."; }
  if (lead.musicians) { text += " I saw you're considering " + lead.musicians + "."; }
  if (lead.instrumentation) { text += " Instrumentation: " + lead.instrumentation + "."; }
  if (lead.message) { text += " I also saw your note about " + lead.message + "."; }
  if (!lead.calendarStatus || lead.calendarStatus === "UNKNOWN") { text += " I still need to confirm the requested time against my calendar before promising availability."; }
  const missing = missingFields(lead);
  if (missing.length) { text += " To keep this moving, could you also send me the " + missing.join(", ") + "?"; }
  else { text += " I have the basic event details and can put together the right setup and quote."; }
  text += "\n\nNick Laudani\n617-233-2008";
  return text;
}
function makeLessonResponse(lead, firstName) {
  let text = "Hi " + firstName + " — thanks for your interest in piano lessons!\n\n";
  if (lead.studentAge || lead.guestAge) { text += "I see you're looking for lessons for someone aged " + (lead.studentAge || lead.guestAge) + ". "; }
  if (lead.studentExperience) { text += "Your current experience: " + lead.studentExperience + ". "; }
  if (lead.readsMusic && lead.readsMusic !== "Unknown") { text += "Reading music: " + lead.readsMusic + ". "; }
  if (lead.hasPiano && lead.hasPiano !== "Unknown") { text += "Instrument: " + lead.hasPiano + ". "; }
  text = text.trim() + "\n\n";
  if (lead.regularPrice) { text += "My rate is " + lead.regularPrice + " per lesson. "; }
  if (lead.introOffer) { text += "I offer an introductory lesson" + (lead.introPrice ? " at " + lead.introPrice : "") + (lead.introDuration ? " (" + lead.introDuration + ")" : "") + ". "; }
  text = text.trim() + "\n\n";
  const questions = [];
  if (!lead.preferredDays) questions.push("- What days and times work best for you?");
  if (!lead.meetingMethod) questions.push("- Would you prefer in-person or remote (Zoom) lessons?");
  if (!lead.studentGoals) questions.push("- What are your goals — what would you like to learn or improve?");
  if (lead.teacherRecommends) questions.push("- You mentioned a style preference — I can tailor lessons to that.");
  if (questions.length) { text += "A few quick questions to get started:\n" + questions.join("\n") + "\n\n"; }
  text += "Looking forward to hearing from you!\n\nNick Laudani\n617-233-2008";
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


// ---- RA-20261028-02 field fixes, conversation threading and reply drafts ----

function extractFields(payload) {
  const f = extractFieldsLegacy(payload);
  const type = String(deepGet(payload, ["event", "eventType"]) || "");
  const isMsg = /^MessageCreated/i.test(type);
  if (f.eventType && (f.eventType === type || isWebhookLabel(f.eventType))) f.eventType = null;
  const c = deepGet(payload, ["data", "customer"]) || {};
  const first = c.firstName || c.first_name || null;
  const last = c.lastName || c.last_name || null;
  const custName = [first, last].filter(Boolean).join(" ") || c.displayName || null;
  if (custName) { f.name = String(custName); f.firstName = first ? String(first) : firstWord(custName); }
  const category = deepGet(payload, ["data", "request", "category", "name"]);
  f.requestType = category || deepFind(payload, ["service_name", "serviceName", "job_type", "jobType"]) || null;
  if (isMsg) {
    f.message = null;
  } else {
    const desc = deepGet(payload, ["data", "request", "description"]);
    if (desc) f.message = String(desc);
  }
  const loc = deepGet(payload, ["data", "request", "location"]);
  if (loc && typeof loc === "object") {
    const cityLine = [loc.city, [loc.state, loc.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    if (cityLine) f.location = cityLine;
    const street = [loc.address1, loc.address2].filter(Boolean).join(" ");
    if (street) f.address = [street, cityLine].filter(Boolean).join(", ");
    if (loc.zipCode) f.zip = String(loc.zipCode);
  }
  const details = deepGet(payload, ["data", "request", "details"]);
  if (Array.isArray(details)) {
    f.details = details.filter(x => x && x.question).slice(0, 60).map(x => ({ question: String(x.question).slice(0, 200), answer: answerText(x.answer ?? x.answers).slice(0, 2000) }));
    const lesson = isLesson(f);
    for (const item of f.details) {
      const q = item.question.toLowerCase().trim(), a = item.answer;
      if (!a) continue;
      if (q === "student age") { f.studentAge = a; f.guestAge = null; }
      else if (/age of guests|guest age/.test(q)) { f.guestAge = a; if (!lesson) f.studentAge = null; }
      if (/instrument (type|access)/.test(q)) { f.instrumentAtHome = a; f.hasPiano = normalizeHasPiano(a); }
      if (q === "lesson length") f.lessonDuration = a;
      if (/student experience|experience level/.test(q)) f.studentExperience = a;
      if (q === "scheduling") { f.schedulingNote = a; if (lesson) f.preferredDays = a; }
      if (/travel pref/.test(q)) { f.travelOptions = a; f.meetingMethod = summarizeTravel(a); }
      if (/travel range/.test(q)) f.travelRange = a;
      if (/music(al)? (style|types?|genres?)/.test(q)) { f.style = a; f.genres = a; }
      if (/instruments wanted/.test(q)) f.instrumentation = a;
      if (q === "venue") f.venue = a;
      if (/musicians needed/.test(q)) f.musicians = a;
      if (q === "category") f.subcategory = a;
      if (/anything else/.test(q)) f.instructions = a;
      if (/^budget/.test(q)) f.budget = a;
      if (q === "event type") f.eventType = a;
      if (q === "number of guests") f.guestCount = a;
    }
  }
  return normalizeLead({...f,sourceRequest:payload});
}

function isWebhookLabel(v) { return /^[A-Za-z]+(Created|Updated|Deleted)V\d+$/.test(String(v || "")); }

function summarizeTravel(answer) {
  const a = String(answer || "").toLowerCase();
  const opts = [];
  if (a.includes("pro's location") || a.includes("pro’s location")) opts.push("at my location");
  if (a.includes("my home") || a.includes("customer")) opts.push("at your place");
  if (a.includes("remote") || a.includes("online") || a.includes("phone or internet")) opts.push("online");
  if (!opts.length) return normalizeMeetingMethod(answer);
  return opts.length === 1 ? "In person " + opts[0] : "Flexible: " + opts.join(", ");
}

async function resolveLeadId(env, negotiationId, legacyId) {
  if (!negotiationId) return legacyId;
  const mapKey = "negotiation:" + safeId(String(negotiationId));
  const mapped = await env.REACHOUT_LEADS.get(mapKey);
  if (mapped && await env.REACHOUT_LEADS.get("lead:" + mapped)) return mapped;
  const legacy = legacyId ? await readJSON(env.REACHOUT_LEADS, "lead:" + legacyId) : null;
  const id = legacy && String(legacy.negotiationId || "") === String(negotiationId) ? legacyId : "thumbtack-neg-" + safeId(String(negotiationId));
  await env.REACHOUT_LEADS.put(mapKey, id);
  return id;
}

function applyThumbtackEvent(lead, payload, fields, now) {
  const type = String(deepGet(payload, ["event", "eventType"]) || "");
  const isMsg = /^MessageCreated/i.test(type);
  if (!isMsg || !lead.latestRaw) lead.latestRaw = payload;
  if (isMsg) {
    const d = deepGet(payload, ["data"]) || {};
    lead.conversation = Array.isArray(lead.conversation) ? lead.conversation : [];
    const messageID = d.messageID ? String(d.messageID) : null;
    if (!messageID || !lead.conversation.some(m => m.messageID === messageID)) {
      lead.conversation.push({ messageID, from: d.from ? String(d.from) : null, text: d.text ? String(d.text).slice(0, 4000) : null, sentAt: d.sentAt ? String(d.sentAt) : now });
      lead.conversation.sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));
      if (lead.conversation.length > 200) lead.conversation = lead.conversation.slice(-200);
    }
    if (String(d.from || "").toLowerCase() === "customer" && d.text) { lead.lastCustomerMessage = String(d.text).slice(0, 4000); lead.lastCustomerMessageAt = d.sentAt ? String(d.sentAt) : now; }
  }
  for (const k of ["details", "address", "zip", "travelRange", "venue", "instrumentAtHome", "schedulingNote", "subcategory"]) {
    if (fields[k]) lead[k] = fields[k];
  }
}

// ---- reply drafts ----
const PIANO_RATES = { 30: 45, 45: 60, 60: 80 };
const PIANO_INTRO_PRICE = 25;
const LIVE_FIRST_HOUR = 250;
const LIVE_PER_HOUR_PER_MUSICIAN = 100;
const LIVE_GAS_FEE = 50;
const LESSON_WORDS = ["piano", "lesson", "teacher", "student", "instruction", "tutor"];
const LIVE_WORDS = ["live music", "band", "wedding", "party", "event", "gig", "ceremony", "cocktail", "reception", "performance", "entertainment", "musician", "pianist", "jazz", "duo", "trio", "singer", "concert", "celebration", "corporate"];

function inquiryKind(lead) {
  const code=serviceCode(lead);
  return isLesson(lead)?"lesson":code==="LIVE_MUSIC"?"live":"generic";
}

function joinList(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}
function lowerFirst(s) { s = String(s || "").trim(); return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function lessonMinutes(text) { const m = String(text || "").match(/(\d{2,3})\s*min/i); if (m) return Number(m[1]); if (/1\s*hour|one hour|60/i.test(String(text || ""))) return 60; return null; }
function clockMinutes(t) {
  const m = String(t || "").match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i);
  if (!m) return null;
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === "p") h += 12;
  return h * 60 + Number(m[2] || 0);
}
function musicianCount(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  if (/solo|just one|\bone\b|^1\b/.test(t)) return 1;
  if (/duo|\btwo\b/.test(t)) return 2;
  if (/trio|\bthree\b/.test(t)) return 3;
  if (/quartet|\bfour\b/.test(t)) return 4;
  const d = t.match(/\d+/);
  return d ? Number(d[0]) : null;
}
function prettyDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso ? String(iso) : null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[Number(m[2]) - 1] + " " + Number(m[3]);
}
function cityOnly(loc) { return loc ? String(loc).split(",")[0].trim() : null; }

function makeResponse(lead) {
  if (lead.recordType === "THUMBTACK_CONTACT_IMPORT") return "";
  if (lead.responseDraft) return lead.responseDraft;
  const firstName = lead.firstName || firstWord(lead.name) || "there";
  const kind = inquiryKind(lead);
  const paras = ["Hi " + firstName + ", thanks so much for reaching out, and for picking me! Hopefully I was your first choice, but either way, this sounds like a great fit."];
  let hasEstimate = false;
  if (kind === "lesson") { paras.push(lessonParagraph(lead)); hasEstimate = true; }
  else if (kind === "live") { paras.push(liveParagraph(lead)); hasEstimate = true; }
  let close = "I just want to make sure I've got the right email and phone number for you, so send those my way when you get a chance. Then we can hop on a quick call or keep texting, whatever's easier.";
  if (!hasEstimate) close += " I'll follow up with a quick estimate if you'd like to get started.";
  paras.push(close);
  return paras.filter(Boolean).join("\n\n") + "\n\nNick Laudani";
}

function lessonParagraph(lead) {
  lead=normalizeLead(lead);
  const bits = [];
  const mins = lessonMinutes(lead.lessonLength);
  const days = lead.lessonTimes ? lowerFirst(lead.lessonTimes) : null;
  if (mins) bits.push("you're looking for " + mins + "-minute lessons" + (days ? " on " + days : ""));
  else if (days) bits.push("you're thinking " + days);
  if (lead.hasPiano === "Piano") bits.push("you've got a piano at home");
  else if (lead.hasPiano === "Keyboard") bits.push("you've got a keyboard at home");
  let text = bits.length ? "From what you shared, " + joinList(bits) + "." : "";
  if (/no formal|never|beginner|none/i.test(String(lead.studentExperience || ""))) text += (text ? " " : "") + "Starting with no formal training is a great place to begin.";
  const price = mins && PIANO_RATES[mins] ? "Lessons are $" + PIANO_RATES[mins] + " for " + mins + " minutes." : "My rate is $80 an hour ($60 for 45 minutes, $45 for 30 minutes).";
  text += (text ? " " : "") + price + " I usually start with an intro meet-and-teach session for $" + PIANO_INTRO_PRICE + " to see if we're a good fit, and after that we can create a schedule and a program that fits you.";
  return text;
}

function liveParagraph(lead) {
  const ev = lead.eventType && !isWebhookLabel(lead.eventType) ? lowerFirst(lead.eventType) : null;
  const what = ev ? (/^[aeiou]/i.test(ev) ? "an " : "a ") + ev : "an event";
  const date = prettyDate(lead.eventDate);
  const times = lead.startTime && lead.endTime ? lead.startTime + " to " + lead.endTime : null;
  const city = cityOnly(lead.location);
  let text = (ev || date || times || city) ? "From what you shared, you're planning " + what + (date ? " on " + date : "") + (times ? ", " + times : "") + (city ? ", in " + city : "") + "." : "";
  if (date) text += " Let me double-check my calendar for that date.";
  text = text.trim();
  const sep = () => (text ? " " : "");
  const start = clockMinutes(lead.startTime), end = clockMinutes(lead.endTime);
  let hours = null;
  if (start !== null && end !== null) { let span = end - start; if (span <= 0) span += 1440; hours = Math.round(span / 30) / 2; }
  const n = musicianCount(lead.musicians || lead.musicianCount);
  if (hours && hours >= 1 && hours <= 12 && n && n >= 1 && n <= 10) {
    const total = LIVE_FIRST_HOUR + Math.max(0, hours - 1) * LIVE_PER_HOUR_PER_MUSICIAN * n;
    const who = n === 1 ? "just me" : n === 2 ? "a duo" : n === 3 ? "a trio" : n + " musicians";
    text += sep() + "For a rough estimate, " + hours + " hours with " + who + " comes to about $" + Math.round(total).toLocaleString("en-US") + ", including travel and setup. I'll firm that up once we nail down the details.";
  } else {
    text += sep() + "My rate starts at $" + LIVE_FIRST_HOUR + " for the first hour, which covers travel, setup, and the first hour of music, then $" + LIVE_PER_HOUR_PER_MUSICIAN + " per hour per musician after that. I'll put together a more exact estimate once we nail down the details.";
  }
  return text + " If the drive is more than an hour each way, I add a $" + LIVE_GAS_FEE + " gas fee.";
}

export { LEGACY_FIELD_MAP, extractFields, makeResponse, missingFields, isLessonInquiry, leadSummary, normalizeMeetingMethod, normalizeReadsMusic, normalizeHasPiano, isLikelyNotificationAddress, extractCustomerEmail, extractCustomerPhone, checkAuth };
