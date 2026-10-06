import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import worker from '../workers/reachout-respond.mjs';
const require=createRequire(import.meta.url),csv=require('../thumbtack-import.js');
class KV {
  map=new Map();
  async get(key){return this.map.get(key)??null;}
  async put(key,value){this.map.set(key,value);}
  async delete(key){this.map.delete(key);}
  async list(){return {keys:[...this.map.keys()].map(name=>({name})),list_complete:true};}
}
const fixture=(overrides={})=>({'Customer Name':'Avery Example','Phone Number':'(617) 555-0101','Date of Contact':'2025-06-02','Business Name':'Example Music','Category':'Music Entertainment','Zip Code':'03104','State':'NH','Job Status':'Not scheduled yet','Response Time (minutes)':'0','Net Cost':'$0.00','Lead Cost':'$0.00','Sales Tax':'$0.00','Refunded':'Yes','Charge State':'REFUNDED',...overrides});
const envFor=()=>({REACHOUT_ADMIN_TOKEN:'test-only-admin-token',REACHOUT_LEADS:new KV()});
async function request(env,route,method='GET',body=null,auth=true){
  const response=await worker.fetch(new Request('https://worker.example'+route,{method,headers:{...(auth?{Authorization:'Bearer '+env.REACHOUT_ADMIN_TOKEN}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
  return {status:response.status,body:await response.json()};
}
test('CSV parser preserves quoted names, multiline values, empty emails and ZIP zeros',()=>{
  const headers=Object.keys(fixture()),raw=fixture({'Customer Name':'Example, Avery','Job Status':'First line\nSecond line'});
  const quote=value=>'"'+value.replaceAll('"','""')+'"';
  const parsed=csv.parseCsv('\uFEFF'+headers.map(quote).join(',')+'\r\n'+headers.map(key=>quote(raw[key])).join(',')+'\r\n');
  assert.deepEqual(parsed,[raw]);
  const record=csv.normalizeRow(parsed[0]);
  assert.equal(record.location,'03104, NH');assert.equal(record.email,null);assert.equal(record.leadPrice,0);
  assert.throws(()=>csv.normalizeRow(fixture({'Date of Contact':'2025-02-30'})),/contact date/);
});
test('owner authentication is required for imports and private batch readback',async()=>{
  const env=envFor();
  assert.equal((await request(env,'/api/admin/import-thumbtack','POST',{rows:[fixture()]},false)).status,401);
  assert.equal((await request(env,'/api/leads?ids=private-id','GET',null,false)).status,401);
  assert.equal(env.REACHOUT_LEADS.map.size,0);
  assert.equal((await request(env,'/api/admin/import-thumbtack','POST',{rows:[fixture(),fixture({'Date of Contact':'bad-date'})]})).status,400);
  assert.equal(env.REACHOUT_LEADS.map.size,0);
});
test('import archives contacts, preserves all source fields and is repeatable',async()=>{
  const env=envFor(),raw=fixture(),repeatInquiry=fixture({'Date of Contact':'2024-01-04','Lead Cost':'$12.70'});
  const receipt=await request(env,'/api/admin/import-thumbtack','POST',{rows:[raw,repeatInquiry]});
  assert.equal(receipt.status,200);assert.equal(receipt.body.created,1);
  const id=receipt.body.receipts[0].leadId;
  const result=await request(env,'/api/leads?ids='+id),lead=result.body.leads[0];
  assert.equal(lead.archived,true);assert.equal(lead.status,'ARCHIVED');assert.equal(lead.eventDate,null);
  assert.equal(lead.contactDate,'2025-06-02');assert.equal(lead.contactHistory.length,2);assert.equal(lead.leadPrice,0);
  assert.equal(lead.suggestedResponse,'');assert.equal(csv.verifyLead(lead,csv.normalizeRow(raw)),true);
  const again=await request(env,'/api/admin/import-thumbtack','POST',{rows:[raw,repeatInquiry]});
  assert.equal(again.body.created,0);assert.equal(again.body.skipped,2);
  assert.equal((await request(env,'/api/leads')).body.count,1);
  const edit=await request(env,'/api/leads/'+id,'PATCH',{name:'Avery Updated',phone:'617-555-0111',email:'avery@example.com'});
  assert.equal(edit.body.lead.email,'avery@example.com');
  const newHistory=await request(env,'/api/admin/import-thumbtack','POST',{rows:[fixture({'Date of Contact':'2023-01-02'})]});
  assert.equal(newHistory.body.created,0);assert.equal(newHistory.body.receipts[0].leadId,id);
  assert.equal((await request(env,'/api/leads/'+id)).body.lead.email,'avery@example.com');
});
test('matching an active contact attaches history without changing current inquiry or notes',async()=>{
  const env=envFor(),raw=fixture();
  const original={id:'thumbtack-live-example',source:'THUMBTACK',workspace:'LIVE MUSIC',status:'WAITING',name:raw['Customer Name'],phone:raw['Phone Number'],email:'avery@example.com',eventDate:'2026-12-20',startTime:'18:00',endTime:'21:00',location:'Current venue',notes:'Keep this note',message:'Current inquiry',requestType:'Wedding',calendarStatus:'CONFLICT',updatedAt:'2026-10-06T00:00:00Z'};
  await env.REACHOUT_LEADS.put('lead:'+original.id,JSON.stringify(original));await env.REACHOUT_LEADS.put('index:leads',JSON.stringify([original]));
  const receipt=await request(env,'/api/admin/import-thumbtack','POST',{rows:[raw]});
  assert.equal(receipt.body.created,0);assert.equal(receipt.body.receipts[0].leadId,original.id);
  const lead=(await request(env,'/api/leads/'+original.id)).body.lead;
  for(const key of ['id','source','workspace','status','name','phone','email','eventDate','startTime','endTime','location','notes','message','requestType','calendarStatus'])assert.deepEqual(lead[key],original[key]);
  assert.equal(lead.archived,undefined);assert.equal(csv.verifyLead(lead,csv.normalizeRow(raw)),true);
});
test('missing phones stay missing and changed export rows are retained in history',async()=>{
  const env=envFor(),rows=[fixture({'Phone Number':'','Date of Contact':'2024-01-01'}),fixture({'Phone Number':'','Date of Contact':'2024-02-01'}),fixture(),fixture({'Job Status':'Completed'})];
  const records=rows.map(csv.normalizeRow),plan=csv.prepareImportPlan(records,[]);
  assert.equal(plan.ready.length,4);
  const result=await request(env,'/api/admin/import-thumbtack','POST',{rows});
  assert.equal(result.body.created,3);
  const sameContact=result.body.receipts.slice(2).map(item=>item.leadId);assert.equal(sameContact[0],sameContact[1]);
  const lead=(await request(env,'/api/leads/'+sameContact[0])).body.lead;
  assert.equal(lead.contactHistory.length,2);assert.equal(csv.verifyLead(lead,records[2]),true);assert.equal(csv.verifyLead(lead,records[3]),true);
});
test('the inbox index keeps contacts beyond the former 500-lead cutoff',async()=>{
  const env=envFor(),index=Array.from({length:520},(_,i)=>({id:'existing-'+i,source:'THUMBTACK',name:'Existing '+i,phone:'555'+String(i).padStart(7,'0'),updatedAt:'2025-01-01T00:00:00Z'}));
  await env.REACHOUT_LEADS.put('index:leads',JSON.stringify(index));
  await request(env,'/api/admin/import-thumbtack','POST',{rows:[fixture()]});
  assert.equal((await request(env,'/api/leads')).body.count,521);
  await request(env,'/webhooks/thumbtack','POST',{customerName:'New Example',phone:'617-555-0199',serviceName:'Live Music'});
  assert.equal((await request(env,'/api/leads')).body.count,522);
});
const uploadDir=process.env.REACHOUT_CSV_DIR;
test('uploaded exports pass through the actual worker and read back without duplicate inquiries',{skip:!uploadDir},async()=>{
  const env=envFor(),files=fs.readdirSync(uploadDir).filter(file=>file.endsWith('.csv'));
  const current=Array.from({length:4},(_,i)=>({id:'active-current-'+i,source:'THUMBTACK',name:'Active test '+i,phone:'999'+String(i).padStart(7,'0'),status:'NEW'}));
  await env.REACHOUT_LEADS.put('index:leads',JSON.stringify(current));
  const records=files.flatMap(file=>csv.parseCsv(fs.readFileSync(path.join(uploadDir,file),'utf8'))).map(csv.normalizeRow);
  const plan=csv.prepareImportPlan(records,[]),contactCount=new Set(plan.ready.map(csv.contactKey)).size;
  let processed=0,verified=0;
  for(let offset=0;offset<plan.ready.length;offset+=10){
    const batch=plan.ready.slice(offset,offset+10),receipt=await request(env,'/api/admin/import-thumbtack','POST',{rows:batch.map(record=>record.raw)});
    assert.equal(receipt.status,200);processed+=receipt.body.processed;
    const ids=[...new Set(receipt.body.receipts.map(item=>item.leadId))],readback=await request(env,'/api/leads?ids='+ids.join(','));
    batch.forEach((record,i)=>{assert.equal(csv.verifyLead(readback.body.leads.find(lead=>lead.id===receipt.body.receipts[i].leadId),record),true);verified++;});
  }
  const index=(await request(env,'/api/leads')).body.leads;
  assert.equal(index.length,contactCount+4);assert.equal(csv.prepareImportPlan(records,index).ready.length,0);
  const archive=(await request(env,'/api/leads?archived=1')).body,active=(await request(env,'/api/leads?archived=0')).body;
  assert.equal(archive.leads.length,contactCount);assert.equal(archive.leads.every(lead=>lead.archived===true),true);
  assert.equal(active.leads.length,4);assert.equal(active.archiveCount,contactCount);
  assert.deepEqual(JSON.parse(await env.REACHOUT_LEADS.get('index:leads')),current);
  console.log(JSON.stringify({exportFiles:files.length,sourceRows:records.length,distinctInquiries:processed,contacts:contactCount,duplicatesSkipped:plan.skipped.length,readbackVerified:verified}));
});
