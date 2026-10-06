(function(){
  'use strict';
  const csv=ReachoutThumbtackCsv,$=id=>document.getElementById(id);
  const TOKEN_KEY='REACHOUT_ADMIN_TOKEN',EXPIRY_KEY='REACHOUT_ADMIN_TOKEN_EXPIRES';
  let records=[],existing=[],authenticated=false,busy=false,preflightNeeded=true;
  function token(){
    const expiry=Number(localStorage.getItem(EXPIRY_KEY)||0);
    return expiry>Date.now()?(localStorage.getItem(TOKEN_KEY)||''):'';
  }
  async function api(path,options={}){
    const t=token();if(!t)throw new Error('Open the owner inbox and unlock it first. Keep this import tab open.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch(csv.API+path,{...options,cache:'no-store',signal:controller.signal,headers:{...options.headers,Authorization:'Bearer '+t}});
      const body=await response.json();
      if(!response.ok)throw new Error(response.status===401?'Owner access was not accepted. Unlock the inbox with the current token.':(body.error||'Worker returned '+response.status));
      if(body.ok!==true)throw new Error(body.error||'The worker did not confirm the request.');
      return body;
    }catch(error){
      if(error.name==='AbortError')throw new Error('The worker request timed out. Check access again before retrying.');
      if(error instanceof TypeError)throw new Error('Could not reach the worker. Check the connection and try again.');
      throw error;
    }finally{clearTimeout(timer);}
  }
  function renderPlan(){
    const plan=csv.prepareImportPlan(records,existing);
    const known=plan.skipped.filter(item=>item.reason==='Already imported');
    $('importContacts').disabled=busy||!authenticated||(!plan.ready.length&&!known.length)||preflightNeeded;
    $('importContacts').textContent=busy?'Importing…':plan.ready.length?'Archive '+plan.ready.length+' source rows':known.length?'Verify '+known.length+' imported rows':'Archive contacts';
    $('planSummary').textContent=records.length?(authenticated?plan.ready.length+' ready · '+plan.skipped.length+' already imported or repeated rows will be skipped.':records.length+' source rows previewed. Unlock the owner inbox to check the archive and import.'):'Choose CSV files to see the contacts.';
    return plan;
  }
  function previewRows(rawRows){
    $('csvError').textContent='';
    try{
      records=rawRows.map(csv.normalizeRow);
      if(records.length>5000)throw new Error('Please split this export into files of 5,000 inquiry rows or fewer.');
      const contacts=new Map(records.map(record=>[csv.contactKey(record),record]));
      $('contactCount').textContent=contacts.size;
      $('inquiryCount').textContent=new Set(records.map(record=>record.key)).size;
      $('phoneCount').textContent=[...contacts.values()].filter(record=>record.phone).length;
      $('emailCount').textContent=[...contacts.values()].filter(record=>record.email).length;
      const dates=records.map(record=>record.contactDate).sort();
      $('dateRange').textContent=dates[0]+' – '+dates[dates.length-1];
      $('contactsBody').replaceChildren();
      for(const record of records){
        const tr=document.createElement('tr');
        for(const value of [record.name,record.phone||'Not supplied',record.email||'Not supplied',record.contactDate,record.category,record.location,record.raw['Job Status']||'Not supplied']){
          const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
        }
        $('contactsBody').appendChild(tr);
      }
      renderPlan();
    }catch(error){records=[];$('contactsBody').replaceChildren();['contactCount','inquiryCount','phoneCount','emailCount'].forEach(id=>$(id).textContent='0');$('dateRange').textContent='—';$('csvError').textContent=error.message;renderPlan();}
  }
  async function checkAccess(){
    if(busy)return;
    authenticated=false;preflightNeeded=true;renderPlan();
    if(!token()){$('accessStatus').textContent='Owner inbox is locked. Open the inbox to unlock, then return here and choose Check access again.';return;}
    $('accessStatus').textContent='Checking owner access and existing contacts…';
    try{
      const health=await api('/health');
      if(health.csvImport!=='/api/admin/import-thumbtack')throw new Error('The archive worker update is needed before importing. Your active inbox can still be used.');
      const result=await api('/api/leads');
      if(!Array.isArray(result.leads))throw new Error('The worker lead list did not match the expected format.');
      existing=result.leads;authenticated=true;preflightNeeded=false;
      $('accessStatus').textContent='Owner access connected · '+existing.filter(lead=>!lead.archived).length+' active leads · '+existing.filter(lead=>lead.archived).length+' archived contacts checked.';
      renderPlan();
    }catch(error){$('accessStatus').textContent=error.message;}
  }
  async function runImport(){
    if(busy||!records.length)return;
    await checkAccess();if(!authenticated)return;
    const plan=renderPlan(),known=plan.skipped.filter(item=>item.reason==='Already imported');if(!plan.ready.length&&!known.length)return;
    busy=true;renderPlan();$('csvFile').disabled=true;$('previewCsv').disabled=true;$('checkAccess').disabled=true;$('csvText').disabled=true;
    let stored=0,verified=0,created=0,skipped=plan.skipped.length;const importedIds=new Set();
    try{
      for(let offset=0;offset<known.length;offset+=10){
        const batch=known.slice(offset,offset+10),ids=[...new Set(batch.map(item=>item.id))];
        $('importResult').textContent='Verifying earlier imported rows '+(offset+1)+'–'+(offset+batch.length)+' of '+known.length+'…';
        const readback=await api('/api/leads?ids='+encodeURIComponent(ids.join(',')));
        for(const item of batch){if(!csv.verifyLead(readback.leads.find(lead=>lead.id===item.id),item.record))throw new Error('An earlier imported row needs review.');verified++;importedIds.add(item.id);}
      }
      for(let offset=0;offset<plan.ready.length;offset+=10){
        const batch=plan.ready.slice(offset,offset+10);
        $('importResult').textContent='Archiving inquiry rows '+(offset+1)+'–'+(offset+batch.length)+' of '+plan.ready.length+'…\n'+stored+' stored · '+verified+' verified · '+skipped+' skipped';
        const receipt=await api('/api/admin/import-thumbtack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:batch.map(record=>record.raw)})});
        if(!Array.isArray(receipt.receipts)||receipt.receipts.length!==batch.length||receipt.receipts.some((item,index)=>item.key!==batch[index].key||!item.leadId))throw new Error('The worker receipt did not match this batch. Import stopped.');
        stored+=receipt.updated;created+=receipt.created;skipped+=receipt.skipped;
        const ids=[...new Set(receipt.receipts.map(item=>item.leadId))];
        ids.forEach(id=>importedIds.add(id));
        const readback=await api('/api/leads?ids='+encodeURIComponent(ids.join(',')));
        for(let index=0;index<batch.length;index++){
          const lead=readback.leads.find(item=>item.id===receipt.receipts[index].leadId);
          if(!csv.verifyLead(lead,batch[index]))throw new Error('A saved inquiry did not match its CSV row. Import stopped for review.');
          verified++;
        }
        for(const lead of receipt.leads||[]){const index=existing.findIndex(item=>item.id===lead.id);if(index<0)existing.push(lead);else existing[index]=lead;}
      }
      const inbox=await api('/api/leads');
      const listed=[...importedIds].filter(id=>inbox.leads.some(lead=>lead.id===id)).length;
      existing=inbox.leads;
      $('importResult').textContent=stored+' inquiry rows saved · '+verified+' verified · '+skipped+' skipped · '+created+' new archive contacts.\n'+(listed===importedIds.size?'All affected contacts are listed in ReachOut.':'The inbox list is still updating: '+listed+' of '+importedIds.size+' affected contacts listed. The individual records were verified.');
      $('viewInbox').hidden=false;
    }catch(error){
      preflightNeeded=true;authenticated=false;
      $('importResult').textContent=stored+' inquiry rows saved · '+verified+' verified · '+skipped+' skipped.\n'+error.message+'\nCheck access again before continuing; earlier confirmed inquiries will be skipped.';
    }finally{
      busy=false;$('csvFile').disabled=false;$('previewCsv').disabled=false;$('checkAccess').disabled=false;$('csvText').disabled=false;renderPlan();
    }
  }
  $('previewCsv').addEventListener('click',()=>{try{previewRows(csv.parseCsv($('csvText').value));}catch(error){$('csvError').textContent=error.message;}});
  $('csvFile').addEventListener('change',async event=>{
    const files=[...event.target.files];if(!files.length)return;
    if(files.some(file=>file.size>4*1024*1024)){$('csvError').textContent='Please choose CSV files smaller than 4 MB.';return;}
    try{const texts=await Promise.all(files.map(file=>file.text()));previewRows(texts.flatMap(csv.parseCsv));}catch(error){$('csvError').textContent=error.message;}
  });
  $('checkAccess').addEventListener('click',checkAccess);
  $('importContacts').addEventListener('click',runImport);
  window.addEventListener('focus',()=>{if(!busy&&token())checkAccess();});
  checkAccess();
})();
