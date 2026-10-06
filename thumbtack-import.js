(function(root){
  'use strict';
  const API='https://reachout-respond.cptnspacetime.workers.dev';
  const IMPORT_RECORD='THUMBTACK_CONTACT_IMPORT';
  const REQUIRED=['Customer Name','Phone Number','Date of Contact','Category','Zip Code','State'];
  function parseCsv(text){
    const records=[];let row=[],cell='',quoted=false,closed=false;
    text=String(text).replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
        else if(ch==='"'){quoted=false;closed=true;}
        else cell+=ch;
      }else if(ch==='"'){
        if(cell||closed)throw new Error('Unexpected quote in CSV. Export the file again.');
        quoted=true;
      }else if(ch===','){row.push(cell);cell='';closed=false;}
      else if(ch==='\r'||ch==='\n'){
        if(ch==='\r'&&text[i+1]==='\n')i++;
        row.push(cell);if(row.some(value=>value.trim()))records.push(row);
        row=[];cell='';closed=false;
      }else{
        if(closed){if(/\s/.test(ch))continue;throw new Error('Unexpected text after a quoted CSV value.');}
        cell+=ch;
      }
    }
    if(quoted)throw new Error('An unfinished quoted value was found in the CSV.');
    row.push(cell);if(row.some(value=>value.trim()))records.push(row);
    if(records.length<2)throw new Error('The CSV needs a header and at least one contact.');
    const headers=records.shift().map(value=>value.trim());
    if(new Set(headers).size!==headers.length)throw new Error('The CSV has repeated column names.');
    const missing=REQUIRED.filter(name=>!headers.includes(name));
    if(missing.length)throw new Error('Missing columns: '+missing.join(', '));
    return records.map((values,index)=>{
      if(values.length!==headers.length)throw new Error('CSV row '+(index+2)+' has the wrong number of columns.');
      return Object.fromEntries(headers.map((name,i)=>[name,values[i]]));
    });
  }
  function money(value){
    const text=String(value??'').trim();if(!text)return null;
    const clean=text.replace(/[$,]/g,'');
    if(!/^-?\d+(\.\d{1,2})?$/.test(clean))throw new Error('Invalid money value: '+text);
    return Number(clean);
  }
  function phoneKey(value){
    let digits=String(value||'').replace(/\D/g,'');
    if(digits.length===11&&digits[0]==='1')digits=digits.slice(1);
    return digits;
  }
  const nameKey=value=>String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  const contactKey=record=>phoneKey(record.phone)?JSON.stringify([nameKey(record.name),phoneKey(record.phone)]):JSON.stringify([nameKey(record.name),'',record.contactDate,nameKey(record.category),nameKey(record.raw?.['Business Name'])]);
  function normalizeRow(raw,index=0){
    const get=name=>String(raw[name]??'').trim();
    const name=get('Customer Name'),phone=get('Phone Number'),contactDate=get('Date of Contact'),category=get('Category');
    if(!name||!category)throw new Error('Row '+(index+2)+': name and category are required.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(contactDate)||Number.isNaN(Date.parse(contactDate+'T12:00:00Z'))||new Date(contactDate+'T12:00:00Z').toISOString().slice(0,10)!==contactDate)throw new Error('Row '+(index+2)+': invalid contact date.');
    if(phone&&phoneKey(phone).length<7)throw new Error('Row '+(index+2)+': incomplete phone number.');
    const email=get('Email')||get('Email Address')||get('Customer Email')||null;
    const result={name,phone,email,contactDate,category,location:[get('Zip Code'),get('State')].filter(Boolean).join(', '),leadPrice:money(get('Lead Cost')),raw:{...raw}};
    result.key=JSON.stringify([nameKey(name),phoneKey(phone),contactDate,nameKey(category),nameKey(get('Business Name')),Object.entries(raw).sort(([a],[b])=>a.localeCompare(b))]);return result;
  }
  function prepareImportPlan(records,existing=[]){
    const seen=new Set(),ready=[],skipped=[],known=new Map(existing.flatMap(lead=>(lead.contactImportKeys||[]).map(key=>[key,lead.id])));
    for(const record of records){
      if(seen.has(record.key)){skipped.push({record,reason:'Repeated in this file'});continue;}
      seen.add(record.key);
      if(known.has(record.key)){skipped.push({record,reason:'Already imported',id:known.get(record.key)});continue;}
      ready.push(record);
    }
    return {ready,skipped};
  }
  function historicalMeta(lead){
    if(lead?.contactHistory?.length){const latest=lead.contactHistory[0];return {historical:lead.recordType===IMPORT_RECORD,contactDate:latest.contactDate,raw:latest.raw,history:lead.contactHistory};}
    if(lead?.recordType===IMPORT_RECORD)return {historical:true,contactDate:lead.contactDate,raw:{},history:[]};
    return null;
  }
  function verifyLead(lead,record){
    const entry=lead?.contactHistory?.find(item=>item.key===record.key);
    return !!entry&&entry.contactDate===record.contactDate&&Object.entries(record.raw).every(([key,value])=>entry.raw?.[key]===value);
  }
  const exports={API,IMPORT_RECORD,parseCsv,money,phoneKey,nameKey,contactKey,normalizeRow,prepareImportPlan,historicalMeta,verifyLead};
  if(typeof module!=='undefined'&&module.exports)module.exports=exports;
  else root.ReachoutThumbtackCsv=exports;
})(typeof globalThis!=='undefined'?globalThis:this);
