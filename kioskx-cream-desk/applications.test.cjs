const {test}=require('node:test'),assert=require('node:assert/strict');
const jobs=require('./desk-applications');
const message=(name='Fixture Person',extra={})=>({id:1,created_at:1700000000,message_type:0,content:`${name} applied to the Quality Test Engineer position posted on Indeed.\nName: ${name}`,...extra});
const full={id:1,inbox_id:3,meta:{sender:{email:'applicants@indeedemail.com'}}};
const tick=()=>new Promise(r=>setImmediate(r));
test('Explicit synthetic names and applicant messages are excluded, not job descriptions',()=>{
 for(const name of ['TTTT','Test applicant'])assert.equal(jobs.indeedRow(full,message(name)),null);
 assert.equal(jobs.indeedRow(full,message('Fixture Person',{content:'Name: Fixture Person\nPosition: Cleaner\nApplication received\nMessage: please discard'})),null);
 assert.equal(jobs.indeedRow(full,message()).service,'Quality Test Engineer');
 assert.ok(jobs.indeedRow(full,message('Fixture Person',{content:'Name: Fixture Person\nPosition: Cleaner\nApplication received\nJob description: test applicant tracking software'})));
});
test('Saved source responds independently and uses existing synthetic rule',async()=>{
 let mailboxCalls=0;
 const r=await jobs.read({company:'AniDeeBee',source:'saved'},{stored:async()=>({json:async()=>({applications:[{id:'real',name:'Fixture Person',role:'Test Engineer',experience:'I test equipment'},{name:'TTTT'},{name:'Test applicant'},{name:'Fixture',experience:'test test'}]})}),source:()=>{mailboxCalls++;throw Error();}});
 assert.deepEqual(r.applications.map(r=>r.id),['real']);assert.equal(mailboxCalls,0);
});
test('Mailbox scan is shared, publishes progress and reports failure without losing rows',async()=>{
 let release,calls=0;const pending=new Promise(r=>release=r);
 const source=jobs.createIndeedSource(async(_,progress)=>{calls++;progress([{id:'indeed:1'}]);await pending;throw Error();});
 assert.equal(source().loading,true);source();await tick();assert.equal(calls,1);assert.equal(source().applications.length,1);
 release();await tick();assert.equal(source().loading,false);assert.equal(source().unavailable,true);assert.equal(source().applications.length,1);
});
test('Successful empty source is explicitly unavailable, not a complete empty jobs board',async()=>{
 const source=jobs.createIndeedSource(async()=>[]);source();await tick();assert.equal(source().unavailable,true);assert.equal(source().loading,false);
});
test('Empty search falls back to the company mailbox and reads older application messages',async()=>{
 const calls=[];const rows=await jobs.indeed(async path=>{
  calls.push(path);
  if(path.includes('/search/'))return {payload:{conversations:[]}};
  if(path.includes('inbox_id='))return {data:{payload:path.includes('page=1')?[{id:1,inbox_id:3},{id:2,inbox_id:101}]:[]}};
  if(path.endsWith('/messages'))return {payload:Array.from({length:20},(_,i)=>({id:30+i,message_type:0,content:'Interview reminder'}))};
  if(path.includes('/messages?'))return {payload:[message()]};
  return full;
 });
 assert.equal(rows.length,1);assert.equal(rows[0].label,'Fixture Person');assert.ok(calls.some(p=>p.includes('before=30')));assert.ok(calls.every(p=>!p.includes('/conversations/2')));
});
test('A failed conversation read never certifies partial search as complete',async()=>{
 await assert.rejects(jobs.indeed(async path=>{
  if(path.includes('/search/'))return {payload:{conversations:[{id:1,inbox:{id:3}},{id:2,inbox:{id:3}}]}};
  if(path.includes('/conversations/2'))throw Error();
  if(path.endsWith('/messages'))return {payload:[message()]};return full;
 }));
});
test('Repeated messages and pages cannot duplicate an application',async()=>{
 const rows=await jobs.indeed(async path=>path.includes('/search/')?{payload:{conversations:[{id:1,inbox:{id:3}},{id:1,inbox:{id:3}}]}}:path.endsWith('/messages')?{payload:[message(),message()]}:full);
 assert.equal(rows.length,1);
});
test('Foreign company cannot start a mailbox read',async()=>{
 let calls=0;assert.deepEqual(await jobs.read({company:'Kiosk X',source:'indeed'},{source:()=>{calls++;}}),{applications:[]});assert.equal(calls,0);
});
