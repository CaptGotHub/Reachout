/**
 * ReachOut Answer — Furnished Finder Gmail bridge
 * Marker: RO-FF-GMAIL-BRIDGE-20261003-01
 *
 * Reads only Furnished Finder lead/message mail, normalizes each Gmail message
 * once, and posts it into the existing ReachOut intake webhook.
 *
 * IMPORTANT:
 * - This bridge DOES NOT auto-send customer replies.
 * - It stores both contact/reference routes when present:
 *     ff_reply_to  = Furnished Finder conversation mailbox
 *     direct_email = traveler-provided email
 * - reply_mode chooses the safest primary route for the responder.
 */

const RO_FF = Object.freeze({
  ENDPOINT_DEFAULT: 'https://reachout-respond.cptnspacetime.workers.dev/webhooks/thumbtack',
  SEARCH: '(from:messaging@leads.furnishedfinder.com OR from:no.reply@leads.furnishedfinder.com) newer_than:7d',
  PROCESSED_KEY: 'RO_FF_PROCESSED_MESSAGE_IDS',
  MAX_PROCESSED_IDS: 1000,
  LABEL_OK: 'ReachOut/FF Stored',
  LABEL_ERROR: 'ReachOut/FF Error'
});

function scanFurnishedFinder() {
  const props = PropertiesService.getScriptProperties();
  const endpoint = props.getProperty('REACHOUT_ENDPOINT') || RO_FF.ENDPOINT_DEFAULT;
  const processed = new Set(readProcessedIds_());
  const threads = GmailApp.search(RO_FF.SEARCH, 0, 50);

  const messages = [];
  threads.forEach(thread => thread.getMessages().forEach(message => {
    const from = String(message.getFrom() || '').toLowerCase();
    if (from.includes('@leads.furnishedfinder.com')) messages.push({thread, message});
  }));
  messages.sort((a, b) => a.message.getDate() - b.message.getDate());

  let stored = 0;
  let skipped = 0;
  let failed = 0;

  messages.forEach(({thread, message}) => {
    const messageId = message.getId();
    if (processed.has(messageId)) {
      skipped++;
      return;
    }

    try {
      const lead = normalizeFurnishedFinderMessage_(message);
      if (!lead) {
        markProcessed_(messageId, processed);
        skipped++;
        return;
      }

      const result = postReachOutLead_(endpoint, lead);
      if (!result.ok) throw new Error(result.error || ('ReachOut HTTP ' + result.status));

      markProcessed_(messageId, processed);
      addThreadLabel_(thread, RO_FF.LABEL_OK);
      removeThreadLabel_(thread, RO_FF.LABEL_ERROR);
      stored++;
    } catch (err) {
      addThreadLabel_(thread, RO_FF.LABEL_ERROR);
      console.error('FF bridge failed for Gmail message %s: %s', messageId, err && err.stack || err);
      failed++;
    }
  });

  writeProcessedIds_([...processed]);
  console.log(JSON.stringify({stored, skipped, failed, scanned: messages.length}));
  return {stored, skipped, failed, scanned: messages.length};
}

function installFurnishedFinderMinuteTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scanFurnishedFinder')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('scanFurnishedFinder')
    .timeBased()
    .everyMinutes(1)
    .create();

  return 'Installed one-minute Furnished Finder intake trigger.';
}

function removeFurnishedFinderTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scanFurnishedFinder')
    .forEach(t => {
      ScriptApp.deleteTrigger(t);
      removed++;
    });
  return 'Removed ' + removed + ' Furnished Finder trigger(s).';
}

function normalizeFurnishedFinderMessage_(message) {
  const subject = clean_(message.getSubject());
  const body = normalizeBody_(message.getPlainBody());
  const gmailMessageId = message.getId();
  const headers = gmailHeaders_(gmailMessageId);
  const replyTo = clean_(headers['reply-to']);
  const leadType = detectFurnishedFinderType_(subject, body);

  if (!leadType) return null;

  const directEmail = extractDirectEmail_(body);
  const phone = extractPhone_(body);
  const ffReplyTo = isFurnishedFinderConversation_(replyTo) ? replyTo : '';
  const replyMode = ffReplyTo
    ? 'furnished_finder_conversation'
    : directEmail
      ? 'direct_email'
      : 'manual_furnished_finder';

  const name = extractTravelerName_(subject, body, leadType);
  const customerMessage = extractCustomerMessage_(body);
  const rentalStart = extractDateField_(body, 'Move-in') || inferStartDate_(customerMessage, message.getDate());
  const rentalEnd = extractDateField_(body, 'Move-out');
  const property = extractProperty_(subject, body);
  const occupants = extractSimpleField_(body, 'Occupants');
  const pets = extractSimpleField_(body, 'Pets');

  return {
    event_type: 'FurnishedFinderEmailLead',
    lead_id: 'ff-gmail-' + gmailMessageId,

    source: 'Furnished Finder',
    workspace: 'Rentals',
    lead_source: 'FURNISHED FINDER · GMAIL',
    service_name: 'FURNISHED FINDER · ' + leadType,

    customer_name: name,
    email: directEmail,
    direct_email: directEmail,
    phone: phone,

    customer_message: customerMessage || body.slice(0, 4000),
    subject: subject,

    source_message_id: gmailMessageId,
    source_thread_id: message.getThread().getId(),
    received_at: message.getDate().toISOString(),

    ff_reply_to: ffReplyTo,
    reply_to: ffReplyTo,
    reply_mode: replyMode,

    rental_start: rentalStart,
    rental_end: rentalEnd,
    rental_property: property,
    occupants: occupants,
    pets: pets,

    source_excerpt: body.slice(0, 6000)
  };
}

function gmailHeaders_(messageId) {
  const data = Gmail.Users.Messages.get('me', messageId, {format: 'full'});
  const out = {};
  const headers = data && data.payload && data.payload.headers || [];
  headers.forEach(h => {
    if (h && h.name) out[String(h.name).toLowerCase()] = String(h.value || '');
  });
  return out;
}

function detectFurnishedFinderType_(subject, body) {
  const hay = (subject + '\n' + body).toLowerCase();
  if (hay.includes('new booking inquiry') || /^booking inquiry from /i.test(subject)) return 'Booking Inquiry';
  if (hay.includes('new traveler message') || /^direct message from /i.test(subject) || /^new message from /i.test(subject)) return 'Traveler Message';
  if (hay.includes('new housing request') || /^a tenant needs a place /i.test(subject)) return 'Housing Request';
  return '';
}

function extractTravelerName_(subject, body, leadType) {
  const subjectPatterns = [
    /^Direct Message from (.+?) for /i,
    /^Booking inquiry from (.+?) for /i,
    /^New Message from (.+?) for /i
  ];
  for (const re of subjectPatterns) {
    const m = subject.match(re);
    if (m) return clean_(m[1]);
  }

  if (leadType === 'Housing Request') {
    const lines = body.split('\n').map(clean_);
    const idx = lines.findIndex(x => x === 'Traveler Details');
    if (idx >= 0) {
      for (let i = idx + 1; i < Math.min(lines.length, idx + 8); i++) {
        if (lines[i] && !/^(phone number|email) verified$/i.test(lines[i])) return lines[i];
      }
    }
  }

  const interested = body.match(/\n([^\n]{2,80}) is interested in your property/i);
  return interested ? clean_(interested[1]) : '';
}

function extractDirectEmail_(body) {
  const labeled = extractSimpleField_(body, 'Email');
  if (labeled && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(labeled)) return labeled;

  const matches = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
  return matches.find(x => !/@(?:leads\.)?furnishedfinder\.com$/i.test(x)) || '';
}

function extractPhone_(body) {
  const labeled = extractSimpleField_(body, 'Phone');
  if (labeled) return labeled;
  const m = body.match(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/);
  return m ? clean_(m[0]) : '';
}

function extractProperty_(subject, body) {
  let m = subject.match(/ for (.+)$/i);
  if (m && !/^Boston/i.test(m[1])) return clean_(m[1]);

  m = body.match(/Your Matched Listing[\s\S]{0,500}?\n([^\n]{10,250})\n(?:Exact|Close|Good)/i);
  return m ? clean_(m[1]) : '';
}

function extractCustomerMessage_(body) {
  const marker = /Email verified/i;
  const m = marker.exec(body);
  if (!m) return '';

  let tail = body.slice(m.index + m[0].length).trim();
  const stops = [
    '\nStay Details',
    '\nPets:',
    '\nSpeed wins the booking',
    '\nYour Matched Listing',
    '\nReply to This Message',
    '\nReply to This Inquiry'
  ];
  let end = tail.length;
  stops.forEach(stop => {
    const i = tail.indexOf(stop);
    if (i >= 0 && i < end) end = i;
  });
  tail = tail.slice(0, end).trim();

  return tail.replace(/^(?:LinkedIn verified|Phone number verified|Email verified)\s*/gim, '').trim();
}

function extractSimpleField_(body, label) {
  const escaped = label.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp('(?:^|\\n)' + escaped + '\\s*\\n([^\\n]+)', 'i');
  const m = body.match(re);
  return m ? clean_(m[1]) : '';
}

function extractDateField_(body, label) {
  const raw = extractSimpleField_(body, label);
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function inferStartDate_(text, receivedDate) {
  const m = String(text || '').match(/\b(?:starting|start|move[- ]?in(?: on)?|from)\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?/i);
  if (!m) return '';
  const year = m[3] ? Number(m[3]) : receivedDate.getFullYear();
  const d = new Date(m[1] + ' ' + m[2] + ', ' + year);
  if (Number.isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function isFurnishedFinderConversation_(address) {
  return /^conversation-[^@\s]+@leads\.furnishedfinder\.com$/i.test(clean_(address));
}

function postReachOutLead_(endpoint, payload) {
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  let data = {};
  try { data = JSON.parse(text || '{}'); } catch (_) {}

  return {
    ok: status >= 200 && status < 300 && data && data.stored === true,
    status,
    data,
    error: data && data.error || text.slice(0, 500)
  };
}

function readProcessedIds_() {
  const raw = PropertiesService.getScriptProperties().getProperty(RO_FF.PROCESSED_KEY);
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids : [];
  } catch (_) {
    return [];
  }
}

function markProcessed_(messageId, processed) {
  processed.add(messageId);
}

function writeProcessedIds_(ids) {
  const trimmed = ids.slice(-RO_FF.MAX_PROCESSED_IDS);
  PropertiesService.getScriptProperties().setProperty(RO_FF.PROCESSED_KEY, JSON.stringify(trimmed));
}

function addThreadLabel_(thread, name) {
  const label = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  label.addToThread(thread);
}

function removeThreadLabel_(thread, name) {
  const label = GmailApp.getUserLabelByName(name);
  if (label) label.removeFromThread(thread);
}

function normalizeBody_(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clean_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}
