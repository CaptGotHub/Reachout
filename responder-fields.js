/* Frontend adapter for RA-20261016-02-field-lifecycle. No Worker deployment. */
(function(root){
const fields={"name": "name", "email": "customerEmail", "phone": "customerPhone", "venueContact": "secondaryContact", "request": "requestType", "date": "eventDate", "start": "startTime", "end": "endTime", "musicType": "instrumentation", "style": "genres", "travelPreference": "travelOptions", "studentLevel": "studentExperience", "lessonGoals": "studentGoals", "lessonTimes": "preferredDays", "lessonLength": "lessonDuration", "lessonRate": "regularPrice", "specialInstructions": "instructions", "soundNeeded": "sound", "location": "location", "address": "address", "guestCount": "guestCount", "guestAge": "guestAge", "musicians": "musicians", "musicianCount": "musicianCount", "budget": "budget", "thumbtackPrice": "thumbtackPrice", "leadCost": "leadCost", "competition": "competition", "included": "included", "eventType": "eventType", "fee": "fee", "deposit": "deposit", "notes": "notes", "message": "message", "platformReplyAddress": "platformReplyAddress", "ownerNotificationAddress": "ownerNotificationAddress", "meetingMethod": "meetingMethod", "meetingLink": "meetingLink", "loadIn": "loadIn", "microphones": "microphones", "power": "power", "parking": "parking", "dressCode": "dressCode", "specialSongs": "specialSongs", "studentAge": "studentAge", "readsMusic": "readsMusic", "hasPiano": "hasPiano", "teacherRecommends": "teacherRecommends", "introOffer": "introOffer", "introPrice": "introPrice", "introDuration": "introDuration"};
const originals=new WeakMap();
const aliases={budget:['customerBudget'],secondaryContact:['venueContact'],instrumentation:['musicType'],genres:['style'],travelOptions:['travelPreference'],customerEmail:['email'],customerPhone:['phone'],studentExperience:['studentLevel'],studentGoals:['lessonGoals'],preferredDays:['lessonTimes'],lessonDuration:['lessonLength'],regularPrice:['lessonRate'],instructions:['specialInstructions'],sound:['soundNeeded']};
function populate(form,lead,setField){
 const snapshot={}; originals.set(form,snapshot);
 for(const [name,key] of Object.entries(fields)){
  const el=form.elements[name];if(!el)continue;
  let value=lead[key];
  if(value===undefined||value===null)for(const alias of aliases[key]||[]){if(lead[alias]!==undefined&&lead[alias]!==null){value=lead[alias];break;}}
  if(value===undefined||value===null)continue;
  const raw=value;
  if(el.type==='checkbox')el.checked=value===true||value==='true';
  else {
   if(el.type==='date')value=String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0]||'';
   if(el.type==='time'&&typeof toTimeInput==='function')value=toTimeInput(value);
   setField(name,Array.isArray(value)?value.join('; '):String(value));
  }
  snapshot[key]={raw,display:el.type==='checkbox'?el.checked:el.value};
 }
}
function collect(form){const result={};for(const [name,key] of Object.entries(fields)){
 const el=form.elements[name];if(!el)continue;
 const value=el.type==='checkbox'?el.checked:el.value;
 const prior=originals.get(form)?.[key];
 result[key]=prior&&prior.display===value?prior.raw:value;
}result.style=result.genres;return result;}
function mismatches(sent,received){return Object.keys(sent).filter(k=>!received||JSON.stringify(sent[k])!==JSON.stringify(received[k]));}
root.ReachOutFields={fields,populate,collect,mismatches};
})(typeof window==='undefined'?globalThis:window);
