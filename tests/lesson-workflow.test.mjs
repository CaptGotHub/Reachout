import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../workers/reachout-respond.mjs';
import {normalizeLead,serviceCode,workspaceFor,requestDetails,LESSON_FIELDS,DETAIL_FIELDS} from '../lead-model.mjs';
class KV {map=new Map();async get(k){return this.map.get(k)??null;}async put(k,v){this.map.set(k,v);}async delete(k){this.map.delete(k);}}
const env=()=>({REACHOUT_ADMIN_TOKEN:'test-token',REACHOUT_LEADS:new KV()});
async function call(e,path,method='GET',body){const r=await worker.fetch(new Request('https://test.example'+path,{method,headers:{Authorization:'Bearer test-token','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,...await r.json()};}
const payload=()=>({eventId:'test-lesson-1',data:{customer:{firstName:'Example',lastName:'Student',email:'student@example.com'},request:{category:{name:'Piano Lessons'},location:{city:'Parker',state:'CO',zipCode:'80134'},createdAt:'2026-10-29T23:40:00Z',proposedTimes:[{start:'2026-10-30T00:00:00Z'}],details:[{question:'How old is the student?',answer:'18 - 25 years old'},{question:'Timeline',answer:['Weekday evenings','Saturday/Sunday']},{question:'What is your experience?',answer:'One year in high school'},{question:'What are your goals?',answer:'Play by ear and understand theory'},{question:'Lesson length',answer:'Teacher recommends'},{question:'Travel preference',answer:'Teacher travels to me'},{question:'An additional question',answer:{text:'Keep this answer'}}]},estimate:{pricePerUnit:80,unitName:'60 minutes',total:80}}});
test('specific service codes override old workspace without misclassifying a recording studio as a rental',()=>{
 assert.equal(serviceCode({requestType:'Piano Lessons',workspace:'LIVE MUSIC'}),'PIANO_LESSON');
 assert.equal(serviceCode({requestType:'Music Lessons',workspace:'LIVE MUSIC'}),'MUSIC_LESSON');
 assert.equal(workspaceFor({requestType:'Wedding',message:'Studio recording after our event'}),'Live Music');
 assert.equal(serviceCode({requestType:'Piano performance'}),'LIVE_MUSIC');
});
test('intake maps lesson details, preserves source answers and does not turn proposed times or price into booked time or budget',async()=>{
 const e=env(),raw=payload(),receipt=await call(e,'/webhooks/thumbtack','POST',raw);
 const {lead}=await call(e,'/api/leads/'+receipt.leadId);
 assert.equal(lead.serviceCode,'PIANO_LESSON');assert.equal(lead.workspace,'Piano Lessons');
 assert.equal(lead.studentName,'Example Student');assert.equal(lead.studentAge,'18 - 25 years old');
 assert.equal(lead.lessonInstrument,'Piano');assert.equal(lead.lessonTimes,'Weekday evenings; Saturday/Sunday');
 assert.equal(lead.lessonLength,'Teacher recommends');assert.equal(lead.lessonLocation,'Parker, CO 80134');
 assert.equal(lead.travelPreference,'Teacher travels to me');assert.equal(lead.budget,null);
 assert.equal(lead.eventDate,null);assert.equal(lead.startTime,null);assert.equal(lead.estimate.pricePerUnit,80);
 assert.deepEqual(lead.sourceRequest,raw);assert.equal(requestDetails(raw).at(-1).answer,'Keep this answer');
 assert.doesNotMatch(lead.suggestedResponse,/venue|musicians|end time|event date/);
 assert.deepEqual(lead.missing,['online or in-person lesson preference']);
});
test('saved lesson fields survive readback, explicit blanks and invalid values are handled',async()=>{
 const e=env(),receipt=await call(e,'/webhooks/thumbtack','POST',payload());
 const changes=Object.fromEntries(LESSON_FIELDS.map(k=>[k,k==='lessonFormat'?'Online':'Edited '+k]));
 const edit=await call(e,'/api/leads/'+receipt.leadId,'PATCH',changes);assert.equal(edit.status,200);
 const {lead}=await call(e,'/api/leads/'+receipt.leadId);
 for(const k of LESSON_FIELDS)assert.equal(lead[k],changes[k]);
 assert.equal((await call(e,'/api/leads/'+receipt.leadId,'PATCH',{studentAge:{bad:1}})).status,400);
 const blank=await call(e,'/api/leads/'+receipt.leadId,'PATCH',{lessonNotes:''});assert.equal(blank.lead.lessonNotes,'');
});
test('read-only normalization recovers legacy lesson fields without changing stored data or unrelated contact details',()=>{
 const old={id:'legacy',workspace:'LIVE MUSIC',requestType:'Piano Lessons',notes:'Keep owner note',email:'owner-confirmed@example.com',latestRaw:payload()};
 const before=JSON.stringify(old),lead=normalizeLead(old);
 assert.equal(lead.studentAge,'18 - 25 years old');assert.equal(lead.email,old.email);assert.equal(lead.notes,old.notes);assert.equal(JSON.stringify(old),before);
});
test('live-music intake still uses event times and live-music responses',async()=>{
 const e=env(),raw=payload();raw.data.request.category.name='Music Entertainment';raw.data.request.details=[];
 const receipt=await call(e,'/webhooks/thumbtack','POST',raw),{lead}=await call(e,'/api/leads/'+receipt.leadId);
 assert.equal(lead.serviceCode,'LIVE_MUSIC');assert.ok(lead.eventDate);assert.match(lead.suggestedResponse,/per hour per musician/);assert.doesNotMatch(lead.suggestedResponse,/intro meet-and-teach/);
});
test('frontend save includes all lesson inputs and normal answer button routes lessons',()=>{
 const code=fs.readFileSync(new URL('../responder.js',import.meta.url),'utf8');
 const section=code.slice(code.indexOf('function leadChanges()'),code.indexOf('async function saveLead'));
 const values={request:'Piano Lesson',name:'Example Student',...Object.fromEntries(DETAIL_FIELDS.map(k=>[k,'value '+k]))};
 const context={v:()=>values,backendSupportsLessons:true,backendSupportsArchive:true,availability:'UNKNOWN',normalizeAvail:x=>x,selectedWorkspace:()=> 'Piano Lessons',serviceCode,DETAIL_FIELDS};vm.createContext(context);vm.runInContext(section,context);
 const changes=context.leadChanges();for(const k of DETAIL_FIELDS)assert.equal(changes[k],values[k]);assert.equal(changes.serviceCode,'PIANO_LESSON');
 assert.match(code,/if\(lessonMode\(\)\)\{document.querySelector\('#buildLessonAnswer'\).click\(\);return;\}/);
});
test('standalone worker embeds exactly the current shared mapper',()=>{
 const source=fs.readFileSync(new URL('../workers/reachout-respond.mjs',import.meta.url),'utf8');
 const model=fs.readFileSync(new URL('../lead-model.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
 assert.ok(source.includes('// BEGIN SHARED LEAD MODEL\n'+model+'// END SHARED LEAD MODEL'));
});
test('separate negotiations stay separate and message events preserve lesson edits and source history',async()=>{
 const e=env(),raw=payload();raw.data.negotiationID='neg-lesson';
 const first=await call(e,'/webhooks/thumbtack','POST',raw);
 const secondRaw=payload();secondRaw.data.negotiationID='neg-gig';secondRaw.data.request.category.name='Piano performance';
 const second=await call(e,'/webhooks/thumbtack','POST',secondRaw);assert.notEqual(first.leadId,second.leadId);
 await call(e,'/api/leads/'+first.leadId,'PATCH',{studentAge:'',lessonGoals:'Owner confirmed goals',lessonTimes:'Saturday mornings'});
 const msg={event:{eventType:'MessageCreatedV4'},eventId:'message-event',data:{negotiationID:'neg-lesson',messageID:'message-1',from:'customer',text:'Saturday works',sentAt:'2026-10-30T12:00:00Z'}};
 const receipt=await call(e,'/webhooks/thumbtack','POST',msg);assert.equal(receipt.leadId,first.leadId);
 const {lead}=await call(e,'/api/leads/'+first.leadId);assert.equal(lead.studentAge,'');assert.equal(lead.lessonGoals,'Owner confirmed goals');assert.equal(lead.lessonTimes,'Saturday mornings');assert.equal(lead.requestType,'Piano Lessons');assert.deepEqual(lead.sourceRequest,raw);assert.equal(lead.conversation[0].text,'Saturday works');
 const {lead:gig}=await call(e,'/api/leads/'+second.leadId);assert.equal(gig.serviceCode,'LIVE_MUSIC');assert.match(gig.suggestedResponse,/per hour per musician/);
});
test('OAuth routing survives and requests message scope even with configured scope overrides',async()=>{
 const e={...env(),THUMBTACK_ENV:'production',THUMBTACK_CLIENT_ID:'example-client',THUMBTACK_CLIENT_SECRET:'test-secret',THUMBTACK_SCOPES:'offline_access supply::negotiations.read'};
 const status=await call(e,'/api/admin/thumbtack','POST',{op:'status'});assert.equal(status.status,200);assert.match(status.requestedScopes,/supply::messages.write/);assert.equal(status.connected,false);
 const nonce='test-nonce-12345678901234567890';await e.REACHOUT_LEADS.put('oauth_state:'+nonce,'{}');
 const r=await worker.fetch(new Request('https://test.example/oauth/thumbtack/start?state='+nonce),e);assert.equal(r.status,302);const dest=new URL(r.headers.get('location'));assert.equal(dest.hostname,'auth.thumbtack.com');assert.ok(dest.searchParams.get('scope').split(' ').includes('supply::messages.write'));
 const denied=await worker.fetch(new Request('https://test.example/api/admin/thumbtack',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"op":"status"}'}),e);assert.equal(denied.status,401);
});
