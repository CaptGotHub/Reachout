const API='https://reachout-respond.cptnspacetime.workers.dev';
const TOKEN_KEY='REACHOUT_ADMIN_TOKEN';
const TOKEN_EXPIRY_KEY='REACHOUT_ADMIN_TOKEN_EXPIRES';
const TRUST_MS=8*60*60*1000;
function setSecurityStatus(msg){const el=document.querySelector('#securityStatus');if(el)el.textContent=msg}
function adminToken(){
  const legacy=sessionStorage.getItem(TOKEN_KEY); if(legacy && !localStorage.getItem(TOKEN_KEY)){localStorage.setItem(TOKEN_KEY,legacy);localStorage.setItem(TOKEN_EXPIRY_KEY,String(Date.now()+TRUST_MS));sessionStorage.removeItem(TOKEN_KEY);}
  const exp=Number(localStorage.getItem(TOKEN_EXPIRY_KEY)||0);
  if(!exp || Date.now()>exp){
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    return '';
  }
  return localStorage.getItem(TOKEN_KEY)||'';
}
function apiHeaders(extra={}){const t=adminToken();return {...extra,...(t?{Authorization:'Bearer '+t}:{})}}
async function apiFetch(url,opts={}){
  opts={...opts,headers:apiHeaders(opts.headers||{})};
  return fetch(url,opts);
}const f=document.querySelector('#fastLead'),out=document.querySelector('#fastAnswer'),badge=document.querySelector('#availBadge'),missingBox=document.querySelector('#missing');let availability='UNKNOWN',activeHub='ALL',activeQueue='ACTIVE',backendSupportsArchive=false,workerContractChecked=false,activeArchivedContact=false,allLeads=[],activeLeadId=null,activeReplyTo='',activeDirectEmail='',activeReplyMode='';
function setAuthButtons(unlocked){
  const unlock=document.querySelector('#unlockInbox'),lock=document.querySelector('#lockInbox');
  if(unlock) unlock.hidden=unlocked;
  if(lock) lock.hidden=!unlocked;
}
async function unlockInbox(){document.querySelector('#ownerAccessDialog').showModal();}
document.querySelector('#ownerAccessForm').addEventListener('submit',async event=>{
  event.preventDefault();const input=document.querySelector('#ownerAccessToken'),entered=input.value.trim();if(!entered)return;
  localStorage.setItem(TOKEN_KEY,entered);localStorage.setItem(TOKEN_EXPIRY_KEY,String(Date.now()+TRUST_MS));
  document.querySelector('#ownerAccessForm').reset();document.querySelector('#ownerAccessDialog').close();await loadLeads();
});
document.querySelector('#cancelOwnerAccess').onclick=()=>{document.querySelector('#ownerAccessForm').reset();document.querySelector('#ownerAccessDialog').close();};
function lockInbox(){
  localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_EXPIRY_KEY);
  allLeads=[]; activeLeadId=null; loadedLeadId=null; activeArchivedContact=false; f.reset();out.value='';document.querySelector('#contactHistoryPanel').hidden=true;document.querySelector('#documentPreview').classList.add('hidden');
  setAuthButtons(false);
  setSecurityStatus('LEAD API PROTECTED · Private inbox locked.');
  const list=document.querySelector('#sourceLeadList');
  if(list) list.innerHTML='<p class="muted">Inbox locked. Click Unlock inbox to enter your private token.</p>';
  const count=document.querySelector('#leadCount'); if(count) count.textContent='0';
}const v=()=>Object.fromEntries(new FormData(f).entries());const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));function niceDate(x){return x?new Date(x+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):''}function niceTime(x){if(!x)return'';let [h,m]=String(x).split(':').map(Number);if(Number.isNaN(h))return x;return new Date(2000,0,1,h,m||0).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}function canonicalSource(raw){
  const s=String(raw||'').trim(),u=s.toUpperCase();
  if(u.includes('FURNISH'))return 'Furnished Finder';
  if(u.includes('THUMBTACK'))return 'Thumbtack';
  if(u.includes('WEBSITE')||u==='WEB')return 'Website';
  if(u.includes('EMAIL')||u.includes('GMAIL'))return 'Email';
  if(['THUMBTACK','WEBSITE','EMAIL','FURNISHED FINDER','OTHER'].includes(u))return u==='FURNISHED FINDER'?'Furnished Finder':u.charAt(0)+u.slice(1).toLowerCase();
  return 'Other';
}
function inferSource(L={}){
  return canonicalSource(L.source||L.leadSource||L.lead_source||L.channel||L.origin||L.sourceName||'');
}
function inferWorkspace(L={}){
  const explicit=String(L.workspace||L.workspaceName||L.business||'').toLowerCase();
  if(explicit.includes('rent')||explicit.includes('furnish'))return 'Rentals';
  if(explicit.includes('spin')||explicit.includes('nfartifact'))return 'SpinStream / NFArtifact';
  if(explicit.includes('music')||explicit.includes('lesson'))return 'Live Music';
  const hay=[L.requestType,L.serviceName,L.service_name,L.message,L.customerMessage,L.subject,inferSource(L)].filter(Boolean).join(' ').toLowerCase();
  if(/furnish|rental|tenant|housing|lease|studio|apartment/.test(hay))return 'Rentals';
  if(/spinstream|nfartifact|ain-|spin-|proof|dossier|mint/.test(hay))return 'SpinStream / NFArtifact';
  if(/music|wedding|cocktail|party|piano|lesson|band|musician|event/.test(hay))return 'Live Music';
  return 'All';
}
function leadMatchesHub(L,hub){
  if(hub==='ALL')return true;
  if(hub==='SPINSTREAM / NFARTIFACT')return inferWorkspace(L)==='SpinStream / NFArtifact';
  if(hub==='FURNISHED FINDER')return inferSource(L)==='Furnished Finder'||inferWorkspace(L)==='Rentals';
  return inferSource(L).toUpperCase()===hub;
}
function setField(name,value){
  const el=f.elements[name]; if(!el||value===undefined||value===null)return; el.value=String(value);
}
function selectedWorkspace(){return document.querySelector('#workspace')?.value||'All'}
function selectedSource(){return document.querySelector('#source')?.value||'Other'}
function syncContextLabels(){
  const src=selectedSource(),label=document.querySelector('#sourceSendLabel'),state=document.querySelector('#sourceSendState');
  if(label)label.textContent=src+' conversation';
  if(!state)return;
  if(src==='Thumbtack'){state.textContent='outbound API not connected yet';return}
  if(src==='Furnished Finder'){
    if(activeReplyMode==='furnished_finder_conversation'){
      state.textContent='primary: Furnished Finder conversation'+(activeDirectEmail?' · direct traveler email also stored':'');
    }else if(activeReplyMode==='direct_email'){
      state.textContent='no FF conversation reply route · direct traveler email available';
    }else{
      state.textContent='no verified email route · manual Furnished Finder reply required';
    }
    return;
  }
  state.textContent='outbound connection not connected yet';
}
function applyLeadContext(L){
  const workspace=inferWorkspace(L),source=inferSource(L);
  const w=document.querySelector('#workspace'),s=document.querySelector('#source');
  if(w&&[...w.options].some(o=>o.value===workspace))w.value=workspace;
  if(s&&[...s.options].some(o=>o.value===source))s.value=source;
  syncContextLabels(); toggleLeadMode();
}
async function loadLeads(){const list=document.querySelector('#sourceLeadList');if(!adminToken()){setAuthButtons(false);setSecurityStatus('LEAD API PROTECTED · Private inbox locked.');list.innerHTML='<p class="muted">Inbox locked. Click Unlock inbox to enter your private token.</p>';return;}setSecurityStatus('LEAD API PROTECTED · Checking private access…');list.innerHTML='<p class="muted">Loading live leads…</p>';const requestedQueue=activeQueue;try{if(!workerContractChecked){const health=await apiFetch(API+'/health',{cache:'no-store'}),contract=await health.json();backendSupportsArchive=contract.csvImport==='/api/admin/import-thumbtack';workerContractChecked=true;}const r=await apiFetch(API+'/api/leads'+(backendSupportsArchive?'?archived='+(activeQueue==='ARCHIVE'?'1':'0'):''),{cache:'no-store'}),d=await r.json();if(requestedQueue!==activeQueue||!adminToken())return;if(!r.ok){if(r.status===401){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(TOKEN_EXPIRY_KEY);sessionStorage.removeItem(TOKEN_KEY);allLeads=[];setAuthButtons(false);setSecurityStatus('PRIVATE INBOX LOCKED · Token not accepted.');}throw new Error(r.status===401?'Unauthorized — click Unlock inbox and enter the current raw admin token.':(d.error||'API error'))}allLeads=d.leads||[];document.querySelector('#activeQueueCount').textContent=d.activeCount??allLeads.filter(x=>!x.archived).length;document.querySelector('#archiveQueueCount').textContent=d.archiveCount??allLeads.filter(x=>x.archived).length;setAuthButtons(true);setSecurityStatus('PRIVATE INBOX CONNECTED · Lead API authenticated.');renderHub()}catch(e){list.innerHTML='<p class="api-error">Could not load ReachOut inbox: '+esc(e.message)+'</p>'}}function renderHub(){
  const rows=allLeads.filter(x=>(x.archived===true)===(activeQueue==='ARCHIVE')&&leadMatchesHub(x,activeHub));
  const archived=allLeads.filter(x=>x.archived);const withEmail=archived.filter(x=>x.email).length;document.querySelector('#archiveToolbar').hidden=activeQueue!=='ARCHIVE';document.querySelector('#archiveCoverage').textContent=backendSupportsArchive?archived.length+' archived contacts · '+withEmail+' with email. Save an email on any contact to make it available here.':'The archive worker update is needed before contacts can be imported.';
  document.querySelector('#hubTitle').textContent=(activeQueue==='ARCHIVE'?'Archive':'Active inbox')+(activeHub==='ALL'?'':' · '+activeHub);
  document.querySelector('#leadCount').textContent=rows.length;
  document.querySelector('#sourceLeadList').innerHTML=rows.map(x=>{
    const src=inferSource(x),workspace=inferWorkspace(x);
    return '<button class="lead-row '+(x.id===activeLeadId?'selected':'')+'" data-id="'+esc(x.id)+'"><span class="lead-source">'+esc(src)+' · '+esc(workspace)+'</span><b>'+esc(x.name||'New lead')+'</b><small>'+esc([x.requestType,niceDate(x.archived?x.contactDate:(x.eventDate||x.rentalStart||x.startDate)),x.location||x.property].filter(Boolean).join(' · '))+'</small><em>'+esc(x.status||'NEW')+' · '+esc(x.archived?(x.contactHistoryCount||1)+' source records':(x.calendarStatus||'UNKNOWN'))+'</em></button>';
  }).join('')||'<p class="muted">No contacts in this queue yet.</p>';
  document.querySelectorAll('.lead-row[data-id]').forEach(b=>b.onclick=()=>openLead(b.dataset.id));
}
let loadedLeadId=null;
async function openLead(id){
  loadedLeadId=null;
  activeLeadId=id; renderHub();
  const r=await apiFetch(API+'/api/leads/'+encodeURIComponent(id),{cache:'no-store'}),d=await r.json(); if(!r.ok)return;
  if(activeLeadId!==id)return;
  const L=d.lead||{};
  activeArchivedContact=L.archived===true;
  f.reset();
  document.querySelector('#documentPreview').classList.add('hidden');
  activeReplyTo=L.ffReplyTo||L.ff_reply_to||L.replyTo||L.reply_to||L.replyRecipient||L.reply_recipient||'';
  activeDirectEmail=L.directEmail||L.direct_email||L.email||'';
  activeReplyMode=L.replyMode||L.reply_mode||(activeReplyTo&&/@leads\.furnishedfinder\.com$/i.test(activeReplyTo)?'furnished_finder_conversation':(activeDirectEmail?'direct_email':'manual_furnished_finder'));
  setField('name',L.name||L.firstName||L.customerName||'');
  setField('email',L.email||''); setField('phone',L.phone||''); setField('venueContact',L.venueContact||'');
  setField('guestCount',L.guestCount??''); setField('guestAge',L.guestAge||''); setField('musicType',L.musicType||'');
  setField('budget',L.budget??''); setField('travelPreference',L.travelPreference||''); setField('thumbtackPrice',formatEstimate(L.estimate)||L.thumbtackPrice||'');
  setField('leadCost',L.leadPrice??L.leadCost??''); setField('competition',L.competition||''); setField('included',L.included||'');
  setField('eventType',L.eventType??''); setField('fee',L.fee??''); setField('deposit',L.deposit??''); setField('notes',L.notes??'');
  setSelect('request',L.requestType||L.request||'');
  setField('date',toDateInput(L.eventDate||L.date||'')); setField('location',typeof L.location==='string'?L.location:(L.property||''));
  setField('start',toTimeInput(L.startTime||'')); setField('end',toTimeInput(L.endTime||'')); setSelect('musicians',L.musicians);
  setField('style',L.style||''); setField('message',L.message||L.customerMessage||'');
  setField('rentalStart',toDateInput(L.rentalStart||L.rental_start||L.startDate||L.moveIn||L.move_in||L.requestedStart||''));
  setField('rentalEnd',toDateInput(L.rentalEnd||L.rental_end||L.endDate||L.moveOut||L.move_out||L.requestedEnd||''));
  setField('rentalProperty',L.rentalProperty||L.rental_property||L.property||L.listing||''); setField('occupants',L.occupants||L.occupantCount||'');
  setField('pets',L.pets||L.petInfo||''); setField('rentalBudget',L.rentalBudget||L.monthlyBudget||L.rateQuestion||'');
  setField('rentalCall',L.rentalCall||L.wantsCall||'TBD'); setField('ffReplyTo',activeReplyTo); setField('directEmail',activeDirectEmail); setField('rentalReplyFocus',L.rentalReplyFocus||'Auto-detect'); setField('rentalQuestions',L.rentalQuestions||L.questions||'');
  setField('spinTopic',L.spinTopic||L.topic||'TBD'); setField('spinAIN',L.ain||L.AIN||''); setField('spinMintId',L.mintId||L.mint_id||'');
  setField('spinTier',L.tier||L.productTier||''); setField('spinQuestion',L.spinQuestion||L.question||'');
  availability=L.calendarStatus||'UNKNOWN'; setAvailability(availability); out.value=L.suggestedResponse||'';
  missingBox.innerHTML=(L.missing&&L.missing.length)?'<b>Still useful to ask:</b> '+L.missing.map(esc).join(' · '):'<b>Lead loaded. Review only what this customer actually needs.</b>';
  applyLeadContext(L);
  renderContactHistory(L);
  loadedLeadId=id;
}
function formatEstimate(estimate){
  if(estimate===null||estimate===undefined)return '';
  if(typeof estimate!=='object')return String(estimate);
  const parts=[];
  if(estimate.pricePerUnit!==null&&estimate.pricePerUnit!==undefined)parts.push(String(estimate.pricePerUnit)+(estimate.unitName?' / '+estimate.unitName:''));
  if(estimate.total!==null&&estimate.total!==undefined)parts.push('Total: '+estimate.total);
  return parts.join(' · ');
}
function setSelect(name,value){
  const el=f.elements[name];
  el.querySelectorAll('option[data-source-value]').forEach(o=>o.remove());
  if(value===null||value===undefined||value===''){el.selectedIndex=0;return}
  const text=String(value);
  for(const o of el.options){if(o.value.toLowerCase()===text.toLowerCase()){el.value=o.value;return}}
  const option=document.createElement('option');
  option.value=text; option.textContent=text; option.dataset.sourceValue='true';
  el.appendChild(option); el.value=text;
}
function toDateInput(x){if(!x)return'';const m=String(x).match(/\d{4}-\d{2}-\d{2}/);return m?m[0]:''}
function toTimeInput(x){
  if(!x)return '';
  const m=String(x).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if(!m)return '';
  let hour=Number(m[1]); const minute=Number(m[2]),period=m[3]?.toUpperCase();
  if(minute>59||hour>(period?12:23)||(period&&hour<1))return '';
  if(period)hour=hour%12+(period==='PM'?12:0);
  return String(hour).padStart(2,'0')+':'+m[2];
}
function setAvailability(val){availability=val;document.querySelectorAll('[data-avail]').forEach(b=>b.classList.toggle('selected',normalizeAvail(b.dataset.avail)===normalizeAvail(val)));badge.textContent=val;badge.className='status '+String(val).toLowerCase().replaceAll(' ','-').replaceAll('/','-')}function normalizeAvail(x){return String(x).replaceAll(' / ','_').replaceAll(' ','_').toUpperCase()}
function rentalLeadText(d){return [d.message,d.rentalQuestions,d.rentalBudget,d.rentalProperty].filter(Boolean).join(' ').toLowerCase()}
function detectRentalReplyFocus(d){
  const explicit=String(d.rentalReplyFocus||'Auto-detect');
  if(explicit && explicit!=='Auto-detect')return explicit;
  const hay=rentalLeadText(d);
  if(d.rentalCall==='Yes'||/\b(call|phone|talk|speak)\b/.test(hay))return 'Call request';
  if(/deposit|move[- ]?in cost|move[- ]?in fee|security|prorat|first month|last month|fees?/.test(hay))return 'Move-in costs / deposits';
  if(/flexib|budget|monthly rate|rate\b|price|\b1900\b/.test(hay))return 'Rate / budget';
  if(/available|availability|still available|would .* possible|is .* possible|move[- ]?in|move[- ]?out|start date|end date|dates?/.test(hay))return 'Dates / availability';
  if(/pet.?friendly|pets? allowed|cat.?ok|dog.?ok|okay with .*pet|allow .*pet/.test(hay))return 'Pets';
  if(d.rentalStart||d.rentalEnd)return 'Dates / availability';
  return 'General';
}
function buildRentalQuickAnswer(d){
  const name=d.name||'there',start=d.rentalStart||d.date,end=d.rentalEnd,focus=detectRentalReplyFocus(d),missing=[];
  if(!start)missing.push('requested start date');
  if(!end)missing.push('intended end date');
  let s='Hi '+name+' — thanks for reaching out.';
  if(start&&end)s+=' I have your requested stay as '+niceDate(start)+' through '+niceDate(end)+'.';
  else if(start)s+=' I have your requested start as '+niceDate(start)+'.';
  if(d.occupants)s+=' I noted '+d.occupants+' occupant'+(String(d.occupants)==='1'?'':'s')+'.';
  if(d.pets)s+=' I noted the pet information as '+d.pets+'.';
  if(focus==='Call request'){
    s+=' I’d be glad to talk it through. Send me a couple of times that work for a quick call.';
  }else if(focus==='Rate / budget'){
    s+=' I saw your question about the monthly rate or budget. If you have a monthly budget in mind, send it over and I can review it with the dates and details.';
  }else if(focus==='Move-in costs / deposits'){
    s+=' I saw your question about move-in costs, deposits, fees, or proration. I want to verify the exact terms before quoting anything, so I’ll confirm those details separately.';
  }else if(focus==='Pets'){
    s+=' Thanks for including the pet information. I’ll review that along with the dates and the rest of the rental details.';
  }else if(focus==='Dates / availability'){
    if(start&&end)s+=' I’m checking those dates before confirming availability.';
    else s+=' I’m checking the timing, and I just need the missing date information before I can confirm anything.';
  }else{
    s+=' I’m reviewing the dates and details now.';
  }
  if(missing.length){
    s+=(focus==='Call request'?' Also, could you send me the ':' Could you send me the ')+missing.join(' and ')+'?';
  }
  if((d.rentalCall==='Yes'||d.offerCall==='Yes') && focus!=='Call request'){
    s+=' If a call is easier, send me a couple of times that work.';
  }
  s+='\n\nNick Laudani\n617-233-2008';
  return {text:s,focus,missing};
}document.querySelectorAll('[data-avail]').forEach(b=>b.onclick=()=>setAvailability(b.dataset.avail));f.onsubmit=e=>{
  e.preventDefault(); const d=v(),workspace=selectedWorkspace();
  if(activeArchivedContact){out.value=archiveFollowup(d);updateArchiveContactLinks();missingBox.textContent='Archive follow-up draft. Review before sending.';return;}
  if(workspace==='Rentals'){
    const rental=buildRentalQuickAnswer(d);
    missingBox.innerHTML=(rental.missing.length?'<b>Still useful to ask:</b> '+rental.missing.join(' · '):'<b>Quick-answer focus:</b> '+rental.focus);
    out.value=rental.text;
    return;
  }
  if(workspace==='SpinStream / NFArtifact'){
    const topic=d.spinTopic&&d.spinTopic!=='TBD'?d.spinTopic:'your SpinStream / NFArtifact question';
    let s='Hi '+(d.name||'there')+' — thanks for reaching out about '+topic+'.';
    if(d.spinAIN)s+=' I have the AIN as '+d.spinAIN+'.';
    if(d.spinMintId)s+=' I have the Mint ID as '+d.spinMintId+'.';
    if(d.spinTier)s+=' I noted '+d.spinTier+' as the tier or product involved.';
    s+=' I received your question and can use those details to look at the right record or issue.';
    if(d.offerCall==='Yes')s+=' If a call would be easier, send me a couple of times that work.';
    s+='\n\nNick Laudani'; out.value=s; missingBox.innerHTML='<b>SpinStream workflow:</b> identify the record, tier and exact question before answering'; return;
  }
  const miss=[]; if(!d.date)miss.push('date'); if(!d.location)miss.push('location / venue'); if(!d.start||!d.end)miss.push('event start / end time'); if(d.musicians==='Not sure')miss.push('musician setup');
  missingBox.innerHTML=miss.length?'<b>Still useful to ask:</b> '+miss.join(' · '):'<b>Core event details present.</b>';
  let s='Hi '+(d.name||'there')+' — thanks for reaching out about your '+d.request.toLowerCase()+'.';
  if(d.date)s+=' I have '+niceDate(d.date); if(d.start&&d.end)s+=' from '+niceTime(d.start)+' to '+niceTime(d.end); if(d.location)s+=' in '+d.location; s+='.';
  if(d.style)s+=' '+d.style+' sounds like a good direction.'; if(d.musicians&&d.musicians!=='Not sure')s+=' I see you are considering '+d.musicians.toLowerCase()+'.';
  if(d.message)s+=' I also saw your note about '+d.message.trim()+'.';
  if(availability==='OPEN')s+=' That requested time currently appears open on my calendar.';
  else if(availability==='CONFLICT')s+=' I do have a calendar conflict during that requested time, so I would want to see whether there is any flexibility before promising availability.';
  else if(normalizeAvail(availability).includes('TRAVEL'))s+=' The date may be possible, but I need to check travel and setup timing before confirming it.';
  else s+=' I still need to confirm the requested time against my calendar before promising availability.';
  if(miss.length)s+=' To put the right setup together, could you also send me the '+miss.join(', ')+'?'; else s+=' I have the basic event details and can put together the right setup and quote.';
  if(d.offerCall==='Yes')s+=' If you would like to talk it through, '+(d.callTime?'I can also try '+d.callTime+'.':'we can find a good time for a quick call.');
  if(d.fee)s+=' The fee I am quoting is $'+d.fee+'.'; if(d.deposit)s+=' The deposit would be '+d.deposit+'.';
  s+='\n\nNick Laudani\n617-233-2008'; out.value=s;
};
function leadChanges(){
  const d=v();
  return {...(backendSupportsArchive?{name:d.name,email:d.email,phone:d.phone,requestType:d.request}:{}),calendarStatus:normalizeAvail(availability),eventDate:d.date,startTime:d.start,endTime:d.end,location:d.location,musicians:d.musicians,style:d.style,message:d.message,budget:d.budget,guestCount:d.guestCount,eventType:d.eventType,fee:d.fee||null,deposit:d.deposit||null,notes:d.notes};
}
async function saveLead(markWaiting=false){
  const button=document.querySelector(markWaiting?'#markSent':'#saveLead');
  if(!activeLeadId){button.textContent='No lead selected';return}
  if(loadedLeadId!==activeLeadId){button.textContent='Load lead before saving';return}
  const changes=leadChanges(); if(markWaiting)changes.status='WAITING';
  try{
    const r=await apiFetch(API+'/api/leads/'+encodeURIComponent(activeLeadId),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(changes)});
    button.textContent=r.ok?(markWaiting?'Marked waiting':'Lead saved'):'Update failed';
    if(r.ok)await loadLeads();
  }catch{button.textContent='Update failed'}
}
document.querySelector('#copyFast').onclick=async()=>{await navigator.clipboard.writeText(out.value);document.querySelector('#copyFast').textContent='Copied'};
document.querySelector('#markSent').onclick=()=>saveLead(true);
document.querySelector('#saveLead').onclick=()=>saveLead();
['thumbtackPrice','leadCost'].forEach(name=>{f.elements[name].readOnly=true});
document.querySelectorAll('[data-hub]').forEach(b=>b.onclick=()=>{activeHub=b.dataset.hub;document.querySelectorAll('[data-hub]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderHub()});document.querySelector('#unlockInbox')?.addEventListener('click',unlockInbox);document.querySelector('#lockInbox')?.addEventListener('click',lockInbox);loadLeads();setInterval(()=>{if(!adminToken()){if(allLeads.length)lockInbox();return;}if(activeQueue==='ACTIVE')loadLeads()},5000);window.addEventListener('focus',()=>{if(adminToken())loadLeads()});
let setupCount=0;
function addSetup(){
 setupCount++;
 const row=document.createElement('div');
 row.className='setup-card';
 row.innerHTML='<b>SETUP '+setupCount+'</b><div class="grid"><label>Phase / purpose<input data-setup="purpose" placeholder="Ceremony / cocktail / reception"></label><label>Location<input data-setup="location"></label><label>Start<input data-setup="start" type="time"></label><label>End<input data-setup="end" type="time"></label><label>Musicians<input data-setup="musicians" placeholder="Solo / Duo / Trio / 4+"></label><label>Move / reset time<input data-setup="reset" placeholder="15 min / 30 min"></label></div><label>Setup notes<input data-setup="notes"></label><button type="button" class="remove-setup">Remove setup</button>';
 row.querySelector('.remove-setup').onclick=()=>row.remove();
 document.querySelector('#setupList').appendChild(row);
}
document.querySelector('#addSetup').onclick=addSetup; addSetup();
function getSetups(){return [...document.querySelectorAll('.setup-card')].map(card=>Object.fromEntries([...card.querySelectorAll('[data-setup]')].map(el=>[el.dataset.setup,el.value]))).filter(x=>Object.values(x).some(Boolean))}
function hrs(a,b){if(!a||!b)return 0;let A=a.split(':').map(Number),B=b.split(':').map(Number),m=(B[0]*60+B[1])-(A[0]*60+A[1]);if(m<0)m+=1440;return m/60}
function dollars(n){return '$'+Math.round(Number(n||0))}
function buildDocument(mode){
 const d=v(), ss=getSetups(), match=String(d.musicians||'').match(/\d+/), musicians=match?Number(match[0]):1, hours=hrs(d.start,d.end), travel=200, extras=Number(d.gas||0);
 const performance=(musicians*(hours>0?(250+Math.max(0,hours-1)*125):0)),calc=performance+travel+extras,fee=Number(d.fee||calc),dep=Number(d.deposit||0),balance=Math.max(0,fee-dep),altHours=hours?hours+1:3,altPerformance=musicians*(250+Math.max(0,altHours-1)*125),alt=altPerformance+travel+extras;
 let quote='<h3>QUOTE</h3><p><b>Pricing basis:</b> $250 for the first hour per musician + $125 for each additional performance hour per musician, plus only the travel/setup or other expenses entered for this job.</p><div class="quote-options"><div><b>Option A</b><br>'+musicians+' musician(s) · '+(hours||'—')+' hour(s)<br>Performance: '+dollars(performance)+'<br>Travel/setup: '+dollars(travel)+'<br><strong>'+dollars(fee)+'</strong></div><div><b>Option B</b><br>'+musicians+' musician(s) · '+altHours+' hour(s)<br>Performance: '+dollars(altPerformance)+'<br>Travel/setup: '+dollars(travel)+'<br><strong>'+dollars(alt)+'</strong></div></div>';
 let proposal='<h3>PROPOSAL</h3><p><b>Client:</b> '+esc(d.name||'—')+'<br><b>Date:</b> '+esc(d.date||'—')+'<br><b>Venue:</b> '+esc(d.location||'—')+'<br><b>Load-in:</b> '+esc(d.loadIn||'—')+'<br><b>Start / Finish:</b> '+esc(d.start||'—')+' / '+esc(d.end||'—')+'</p><p><b>Performance structure:</b> approximately 45 minutes music / 15 minute break per set.</p><p><b>Dress:</b> '+esc(d.dressCode||'TBD')+'<br><b>Food / drinks:</b> '+esc(d.foodDrink||'TBD')+'<br><b>Sound needed:</b> '+esc(d.soundNeeded||'TBD')+'<br><b>Sound provider:</b> '+esc(d.soundProvider||'TBD')+'<br><b>Microphones:</b> '+esc(d.microphones||'TBD')+'<br><b>Power:</b> '+esc(d.power||'TBD')+'<br><b>Parking / load-in:</b> '+esc(d.parking||'TBD')+'<br><b>Special instructions:</b> '+esc(d.specialInstructions||'TBD')+'<br><b>Special songs:</b> '+esc(d.specialSongs||'TBD')+'</p>';
 proposal+=ss.map((x,i)=>'<p><b>Setup '+(i+1)+': '+esc(x.purpose||'TBD')+'</b><br>'+esc(x.location||'Location TBD')+' · '+esc(x.start||'—')+'–'+esc(x.end||'—')+' · '+esc(x.musicians||'Musicians TBD')+(x.reset?'<br>Move/reset: '+esc(x.reset):'')+(x.notes?'<br>'+esc(x.notes):'')+'</p>').join('');
 proposal+='<p><b>Fee:</b> '+dollars(fee)+'<br><b>Deposit:</b> '+dollars(dep)+'<br><b>Balance:</b> '+dollars(balance)+'</p>';
 const box=document.querySelector('#documentPreview');box.innerHTML=mode==='quote'?quote:mode==='proposal'?proposal:quote+proposal;box.classList.remove('hidden');box.scrollIntoView({behavior:'smooth'});
}
document.querySelector('#createQuote').onclick=()=>buildDocument('quote');
document.querySelector('#createProposal').onclick=()=>buildDocument('proposal');
document.querySelector('#createBoth').onclick=()=>buildDocument('both');

function proposalChoice(prefix){const g=id=>Number(document.querySelector('#'+prefix+id)?.value||0),mus=g('Musicians')||1,h=g('Hours')||0,travel=g('Travel'),extras=g('Extras'),override=g('Override'),performance=mus*(h>0?(250+Math.max(0,h-1)*125):0),calc=performance+travel+extras;return{musicians:mus,hours:h,travel,extras,performance,fee:override||calc}}
function choiceHTML(label,x){return '<div class="customer-choice"><h4>'+label+'</h4><p>'+x.musicians+' musician(s) · '+x.hours+' performance hour(s)<br>Performance pricing: '+dollars(x.performance)+'<br>Travel/setup: '+dollars(x.travel)+(x.extras?'<br>Other expenses: '+dollars(x.extras):'')+'</p><strong>'+dollars(x.fee)+'</strong></div>'}
function syncCustomerEmailFromLead(){if(!activeLeadId)return;apiFetch(API+'/api/leads/'+encodeURIComponent(activeLeadId),{cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.lead?.email)document.querySelector('#customerEmail').value=d.lead.email}).catch(()=>{})}
const oldOpenLead=openLead;openLead=async function(id){await oldOpenLead(id);syncCustomerEmailFromLead()}
const oldBuildDocument=buildDocument;buildDocument=function(mode){oldBuildDocument(mode);const box=document.querySelector('#documentPreview'),a=proposalChoice('a'),b=proposalChoice('b'),choices='<h3>PROPOSAL CHOICES</h3><div class="quote-options">'+choiceHTML('OPTION A',a)+choiceHTML('OPTION B',b)+'</div>';box.innerHTML=choices+box.innerHTML}
document.querySelector('#copyPackage').onclick=async()=>{
  const preview=document.querySelector('#documentPreview').innerText.trim(),answer=document.querySelector('#fastAnswer').value.trim(),email=document.querySelector('#customerEmail').value.trim();
  const packageText=['REACHOUT ANSWER — COMPLETE CUSTOMER PACKAGE','','Workspace: '+selectedWorkspace(),'Source: '+selectedSource(),activeReplyMode?'Reply mode: '+activeReplyMode:'',activeReplyTo?'Furnished Finder route: '+activeReplyTo:'',activeDirectEmail?'Direct traveler email: '+activeDirectEmail:'','',answer,'',preview,'','DISTRIBUTION','Source outbound: connection dependent','Nick copy: studio@spinstream.xyz','Customer email: '+(email||'TBD')].filter(x=>x!==null&&x!==undefined).join('\n');
  await navigator.clipboard.writeText(packageText); document.querySelector('#copyPackage').textContent='Complete Package Copied';
}

function completeRecordHTML(d){const show=(label,val)=>'<div class="record-line"><b>'+label+'</b><span>'+esc(val||'TBD')+'</span></div>';return '<h3>COMPLETE EVENT RECORD</h3><div class="record-summary">'+show('Customer',d.name)+show('Email',d.email)+show('Phone',d.phone)+show('Contact at venue',d.venueContact)+show('Event',d.request)+show('Date',d.date)+show('Venue / address',d.location)+show('Load-in',d.loadIn)+show('Start',d.start)+show('Finish',d.end)+show('Guest count',d.guestCount)+show('Guest age',d.guestAge)+show('Musicians',d.musicians)+show('Music type',d.musicType)+show('Genres / style',d.style)+show('Budget',d.budget)+show('Travel preference',d.travelPreference)+show('Thumbtack base / estimated price',d.thumbtackPrice)+show('Thumbtack lead cost',d.leadCost)+show('Competition',d.competition)+show("What's included",d.included)+show('Dress code',d.dressCode)+show('Food / drinks',d.foodDrink)+show('Sound needed',d.soundNeeded)+show('Sound provider',d.soundProvider)+show('Microphones',d.microphones)+show('Power',d.power)+show('Parking / load-in',d.parking)+show('Special instructions',d.specialInstructions)+show('Special songs',d.specialSongs)+'</div>'}
const previousBuildDocument=buildDocument;buildDocument=function(mode){previousBuildDocument(mode);const box=document.querySelector('#documentPreview');box.innerHTML=completeRecordHTML(v())+box.innerHTML}

const defaultProDetails=['Load-in / arrival','Dress code','Food / drinks','Sound system','Sound provider','Microphones','Power near setup','Parking / load-in','Indoor / outdoor','Keyboard / piano at venue','Gear Nick brings','Venue contact','Special songs','Musical cues','Special instructions','Second setup / location','Move / reset time','Gas / tolls / parking'];
function addProDetail(label='',status='TBD',answer=''){const row=document.createElement('div');row.className='pro-detail-row';row.innerHTML='<input class="detail-label" value="'+esc(label)+'" placeholder="Detail"><select class="detail-status"><option>TBD</option><option>Confirmed</option><option>Not needed</option><option>Not discussed</option></select><input class="detail-answer" value="'+esc(answer)+'" placeholder="Type or change the answer"><button type="button" class="remove-detail">×</button>';row.querySelector('.detail-status').value=status;row.querySelector('.remove-detail').onclick=()=>row.remove();document.querySelector('#proDetailRows').appendChild(row)}
defaultProDetails.forEach(x=>addProDetail(x));document.querySelector('#addCustomDetail').onclick=()=>addProDetail();
function proDetails(){return [...document.querySelectorAll('.pro-detail-row')].map(r=>({label:r.querySelector('.detail-label').value||'Detail',status:r.querySelector('.detail-status').value,answer:r.querySelector('.detail-answer').value}))}
function proDetailsHTML(){return '<h3>DETAILS FOR THE PRO TO COMPLETE</h3><p class="muted">The customer does not need to complete these unless they want to.</p><div class="record-summary">'+proDetails().map(x=>'<div class="record-line"><b>'+esc(x.label)+'</b><span>'+esc(x.status)+(x.answer?' — '+esc(x.answer):'')+'</span></div>').join('')+'</div>'}
const buildBeforePro=buildDocument;buildDocument=function(mode){buildBeforePro(mode);const box=document.querySelector('#documentPreview');box.innerHTML=box.innerHTML+proDetailsHTML()}


function lessonMode(){const val=String(f.elements.request?.value||'').toLowerCase();return val.includes('lesson')}
function rentalMode(){const req=String(f.elements.request?.value||'').toLowerCase();return selectedWorkspace()==='Rentals'||selectedSource()==='Furnished Finder'||req.includes('rental')}
function spinMode(){const req=String(f.elements.request?.value||'').toLowerCase();return selectedWorkspace()==='SpinStream / NFArtifact'||req.includes('spinstream')}
function toggleLeadMode(){
  const rental=rentalMode(),spin=spinMode(),lesson=!rental&&!spin&&lessonMode(),event=!rental&&!spin&&!lesson;
  document.querySelector('#eventRequestFields')?.classList.toggle('hidden',rental||spin);
  document.querySelector('#rentalSheet')?.classList.toggle('hidden',!rental);
  document.querySelector('#spinSheet')?.classList.toggle('hidden',!spin);
  document.querySelector('#lessonSheet')?.classList.toggle('hidden',!lesson);
  document.querySelector('#eventSheet')?.classList.toggle('hidden',!event);
  document.querySelector('.proposal-choices')?.classList.toggle('hidden',!event);
  document.querySelector('.quote-actions')?.classList.toggle('hidden',!event);
  syncContextLabels();
}
f.elements.request?.addEventListener('change',toggleLeadMode);
document.querySelector('#workspace')?.addEventListener('change',toggleLeadMode);
document.querySelector('#source')?.addEventListener('change',e=>{if(e.target.value==='Furnished Finder')document.querySelector('#workspace').value='Rentals';toggleLeadMode()});
toggleLeadMode();
document.querySelector('#buildLessonAnswer').onclick=()=>{const d=v(),name=d.name||'there';let s='Hi '+name+' — thanks for reaching out about lessons. I’d be glad to learn a little about what you want to work on and see what kind of lesson setup makes the most sense.';if(d.lessonInstrument)s+=' I saw that you are interested in '+d.lessonInstrument+' lessons.';if(d.lessonFormat&&d.lessonFormat!=='TBD')s+=' '+d.lessonFormat+' can work as the lesson format.';if(d.lessonFrequency&&d.lessonFrequency!=='TBD')s+=' You indicated '+d.lessonFrequency.toLowerCase()+'.';if(d.studentLevel&&d.studentLevel!=='TBD')s+=' Your '+d.studentLevel.toLowerCase()+' level is helpful to know.';if(d.lessonGoals)s+=' I also saw that you would like to work on '+d.lessonGoals+'.';const missing=[];if(!d.lessonTimes||d.lessonTimes==='TBD')missing.push('days/times that work best');if(!d.lessonFormat||d.lessonFormat==='TBD')missing.push('whether you prefer in-person or online');if(missing.length)s+=' To figure out a good first lesson, let me know '+missing.join(' and ')+'.';else s+=' I can use those details to work out a good first lesson time.';s+='\n\nNick Laudani\n617-233-2008';out.value=s;missingBox.innerHTML='<b>Lesson workflow:</b> availability and first-lesson scheduling';out.scrollIntoView({behavior:'smooth'})};

function proposalTextLines(){const d=v(),a=proposalChoice('a'),b=proposalChoice('b');return[
'Nicholas Laudani — Live Music',
'Proposal for '+(d.name||'Customer'),
'',
'Event: '+(d.request||'TBD'),
'Date: '+(d.date||'TBD'),
'Venue: '+(d.location||'TBD'),
'Load-in: '+(d.loadIn||'TBD'),
'Start: '+(d.start||'TBD'),
'Finish: '+(d.end||'TBD'),
'',
'OPTION A',
a.musicians+' musician(s) · '+a.hours+' hour(s)',
'Fee: '+dollars(a.fee),
'',
'OPTION B',
b.musicians+' musician(s) · '+b.hours+' hour(s)',
'Fee: '+dollars(b.fee),
'',
'Event Details',
...proDetails().map(x=>x.label+': '+x.status+(x.answer?' — '+x.answer:'')),
'',
'Nick Laudani',
'617-233-2008',
'studio@spinstream.xyz'
]}
async function downloadDocx(){buildDocument('both');if(!window.docx){alert('Word generator did not load. Refresh the page and try again.');return}const {Document,Packer,Paragraph,HeadingLevel}=window.docx;const lines=proposalTextLines();const children=lines.map((line,i)=>new Paragraph({text:line,heading:i===0?HeadingLevel.TITLE:(line==='OPTION A'||line==='OPTION B'||line==='Event Details')?HeadingLevel.HEADING_2:undefined,spacing:{after:100}}));const doc=new Document({sections:[{properties:{},children}]});const blob=await Packer.toBlob(doc);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Nicholas-Laudani-Proposal-'+String(v().name||'Customer').replace(/[^a-z0-9]+/gi,'-')+'.docx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
document.querySelector('#wordProposal').onclick=downloadDocx;
document.querySelector('#printPdf').onclick=()=>{buildDocument('both');const content=document.querySelector('#documentPreview').innerHTML,w=window.open('','_blank');w.document.write('<!doctype html><html><head><title>Nicholas Laudani Proposal</title><style>body{font:16px Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#111}h3{border-bottom:1px solid #bbb;padding-bottom:8px}.quote-options{display:grid;grid-template-columns:1fr 1fr;gap:20px}.record-summary{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}.record-line{padding:5px 0;border-bottom:1px solid #ddd}.record-line b{display:block}@media print{button{display:none}}</style></head><body>'+content+'<script>window.onload=()=>window.print()<\/script></body></html>');w.document.close()};

function proposalNo(d){if(d.proposalNumber)return d.proposalNumber;if(!d.date)return 'TBD';const m=String(d.date).match(/(\d{4})-(\d{2})-(\d{2})/);return m?m[2]+m[3]+m[1].slice(2):'TBD'}
function customerProposalHTML(){const d=v(),a=proposalChoice('a'),b=proposalChoice('b'),fee=Number(d.fee||a.fee||0),dep=Number(d.deposit||0),bal=d.balance!==''&&d.balance!=null?Number(d.balance):Math.max(0,fee-dep);const details=proDetails();const get=label=>{const x=details.find(z=>z.label===label);return x?(x.answer||x.status):'TBD'};return '<div class="formal-proposal"><div class="proposal-letterhead"><h2>Nicholas Laudani</h2><p>29 Beech Glen Street · Boston, MA 02119</p><p>studio@spinstream.xyz · 617-233-2008</p></div><div class="proposal-customer"><p><b>Proposal #'+esc(proposalNo(d))+'</b></p><p><b>To:</b> '+esc(d.name||'TBD')+'</p><p><b>Email:</b> '+esc(d.email||'TBD')+' &nbsp; <b>Phone:</b> '+esc(d.phone||'TBD')+'</p></div><h3>FEE &nbsp; '+dollars(fee)+'</h3><p><b>FOR PROFESSIONAL SERVICES</b> · Musicians / Live Music</p><div class="proposal-facts"><p><b>Date of Service:</b> '+esc(d.date||'TBD')+'</p><p><b>Location:</b> '+esc(d.location||'TBD')+'</p><p><b>Arrive / Load-in:</b> '+esc(d.loadIn||'TBD')+'</p><p><b>Start / Finish:</b> '+esc(d.start||'TBD')+' – '+esc(d.end||'TBD')+'</p><p><b>Musicians:</b> '+esc(d.musicians||'TBD')+'</p><p><b>Music / Style:</b> '+esc(d.style||'TBD')+'</p><p><b>Sound system:</b> '+esc(get('Sound system'))+'</p><p><b>Dress code:</b> '+esc(get('Dress code'))+'</p><p><b>Food / drinks:</b> '+esc(get('Food / drinks'))+'</p><p><b>Special songs / cues:</b> '+esc(d.specialSongs||get('Special songs'))+'</p><p><b>Special instructions:</b> '+esc(d.specialInstructions||get('Special instructions'))+'</p></div><div class="proposal-money"><p><b>Deposit:</b> '+dollars(dep)+'</p><p><b>Balance:</b> '+dollars(bal)+'</p></div><p class="proposal-signoff">Nicholas Laudani · 617-233-2008 · studio@spinstream.xyz</p></div>'}
function syncMoneyFields(){const d=v(),fee=Number(d.fee||0),dep=Number(d.deposit||0);if(f.elements.balance&&!f.elements.balance.dataset.manual)f.elements.balance.value=fee?Math.max(0,fee-dep):'';if(f.elements.proposalNumber&&!f.elements.proposalNumber.value&&d.date)f.elements.proposalNumber.value=proposalNo(d)}
f.elements.fee?.addEventListener('input',syncMoneyFields);f.elements.deposit?.addEventListener('input',syncMoneyFields);f.elements.date?.addEventListener('change',syncMoneyFields);f.elements.balance?.addEventListener('input',()=>f.elements.balance.dataset.manual='1');
const beforeFormalBuild=buildDocument;buildDocument=function(mode){beforeFormalBuild(mode);const box=document.querySelector('#documentPreview');box.innerHTML=customerProposalHTML()+(mode==='both'?'<h3 class="choice-heading">PERFORMANCE OPTIONS</h3>'+box.innerHTML:'')};


function archiveFollowup(d){
  const first=String(d.name||'there').trim().split(/\s+/)[0],lesson=/lesson/i.test(d.request||'');
  return 'Hi '+first+' — Nick Laudani here. We connected through Thumbtack about '+(lesson?'piano lessons':'live music')+'. If you are looking for '+(lesson?'lessons':'music for an upcoming event')+', I would be glad to hear what you have in mind. Send me a couple of times that work for a quick call.\n\nNick Laudani\n617-233-2008';
}
function updateArchiveContactLinks(){
  const d=v(),phone=String(d.phone||'').trim(),email=String(d.email||'').trim(),call=document.querySelector('#archiveCall'),draft=document.querySelector('#archiveEmailDraft');
  call.hidden=!phone;if(phone)call.href='tel:'+phone.replace(/[^+0-9]/g,'');
  draft.hidden=!email||!f.elements.email.checkValidity();
  if(!draft.hidden)draft.href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent('A note from Nick Laudani')+'&body='+encodeURIComponent(out.value||archiveFollowup(d));
}
function renderContactHistory(L){
  const entries=L.contactHistory||[],panel=document.querySelector('#contactHistoryPanel');panel.hidden=!entries.length;
  document.querySelector('#contactHistorySummary').textContent=entries.length+' original export records'+(L.archived?' · archived contact':' · attached to this active lead');
  document.querySelector('#contactHistoryRows').innerHTML=entries.map(entry=>{const raw=entry.raw||{};return '<tr>'+[niceDate(entry.contactDate),raw.Category,[raw['Zip Code'],raw.State].filter(Boolean).join(', '),raw['Job Status'],raw['Lead Cost']||'Not supplied'].map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>';}).join('');
  updateArchiveContactLinks();
}
['email','phone','name'].forEach(name=>f.elements[name].addEventListener('input',updateArchiveContactLinks));out.addEventListener('input',updateArchiveContactLinks);
document.querySelectorAll('[data-queue]').forEach(button=>button.addEventListener('click',()=>{
  activeQueue=button.dataset.queue;activeLeadId=null;loadedLeadId=null;activeArchivedContact=false;
  f.reset();out.value='';document.querySelector('#contactHistoryPanel').hidden=true;document.querySelector('#documentPreview').classList.add('hidden');
  document.querySelectorAll('[data-queue]').forEach(item=>item.classList.toggle('active',item===button));loadLeads();
}));
document.querySelector('#refreshArchive').onclick=()=>{workerContractChecked=false;loadLeads();};
document.querySelector('#exportArchiveEmails').onclick=()=>{
  const contacts=allLeads.filter(lead=>lead.archived&&String(lead.email||'').trim());
  if(!contacts.length){document.querySelector('#archiveExportStatus').textContent='No email addresses saved yet. Open a contact, add their email and choose Save lead.';return;}
  const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  const rows=[['Customer Name','Email','Phone','Source','Last Contact Date'],...contacts.map(lead=>[lead.name,lead.email,lead.phone,lead.source,lead.contactDate])];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download='reachout-archive-email-contacts.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  document.querySelector('#archiveExportStatus').textContent=contacts.length+' email contacts exported. No messages were sent.';
};
