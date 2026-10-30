// Shared, pure lead classification and Thumbtack request-field mapping.
export const LESSON_FIELDS = ['studentName','studentAge','studentLevel','lessonInstrument','lessonGoals','lessonFormat','lessonLocation','lessonTimes','lessonLength','lessonFrequency','lessonRate','lessonNotes'];
export const DETAIL_FIELDS = [...LESSON_FIELDS,'travelPreference','guestAge','musicType','included','competition','sourceCreatedAt','sourceTimezone'];
const present = value => value !== undefined && value !== null && value !== '';
export function answerText(value) {
  if (!present(value)) return '';
  if (Array.isArray(value)) return value.map(answerText).filter(Boolean).join('; ');
  if (typeof value === 'object') return answerText(value.text ?? value.label ?? value.value ?? value.name ?? value.answer ?? value.answers ?? '');
  return String(value);
}
export function requestDetails(raw = {}) {
  const details = raw?.data?.request?.details ?? raw?.request?.details ?? [];
  if (!Array.isArray(details)) return [];
  return details.map(d => ({question:answerText(d.question ?? d.label),answer:answerText(d.answer ?? d.answers ?? d.value)})).filter(d=>d.question && d.answer);
}
export function serviceCode(lead = {}) {
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
export const isLesson = lead => /^(PIANO|MUSIC)_LESSON$/.test(serviceCode(lead));
export const workspaceFor = lead => ({PIANO_LESSON:'Piano Lessons',MUSIC_LESSON:'Music Lessons',LIVE_MUSIC:'Live Music',RENTAL:'Rentals',SPINSTREAM:'SpinStream / NFArtifact',OTHER:'All'}[serviceCode(lead)]);
export function normalizeLead(input = {}) {
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
