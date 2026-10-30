// Embed the shared mapper in the manually deployed Worker (thumbtack.mjs remains a separate module). Run after editing lead-model.mjs.
import fs from 'node:fs';
const path=new URL('./workers/reachout-respond.mjs',import.meta.url);
const start='// BEGIN SHARED LEAD MODEL',end='// END SHARED LEAD MODEL';
const model=fs.readFileSync(new URL('./lead-model.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
let worker=fs.readFileSync(path,'utf8');
if(worker.includes(start))worker=worker.slice(0,worker.indexOf(start))+worker.slice(worker.indexOf(end)+end.length).trimStart();
fs.writeFileSync(path,`${start}\n${model}${end}\n${worker}`);
