const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('/tmp/sales-desk-test-tools/node_modules/jsdom');
const root=process.env.BASELINE_QUEUE ? __dirname+'/baseline' : __dirname;
const records=[
 {id:'11111111-1111-4111-8111-111111111111',name:'Customer',kind:'cleaning_request',requestedService:'Home cleaning',email:'fixture@example.invalid',phone:'2025550100',requestDetailsMarkdown:JSON.stringify({bedrooms:3,bathrooms:2,size:'Large',zip:'00000',frequency:'Weekly',date:'2026-12-01',laundryNotes:'Fold towels',consent:'private boilerplate',message:'Please clean upstairs.'})},
 {id:'22222222-2222-4222-8222-222222222222',name:'Applicant',kind:'job_application',requestedService:'Cleaner',requestDetailsMarkdown:JSON.stringify({message:'Available weekends.'})},
 {id:'33333333-3333-4333-8333-333333333333',name:'Driver',kind:'car_request',requestDetailsMarkdown:JSON.stringify({vehicle:'Car',purpose:'Work',location:'City',duration:'One week',endDate:'Friday',company:'Company',equipment:'Tools',message:'Please advise.'})},
 ...['TTTT','Form Check','Test Applicant'].map((name,i)=>({id:'hidden'+i,name,kind:'job_application'}))
];
const work=new Map();let failWork=false,failQueue=false;
class Client {
 async connect(){} async end(){}
 async query(sql,args){
  if(sql.includes('core.workspace'))return {rows:[{databaseSchema:'workspace_test'}]};
  if(sql.includes('_anideebeeInquiry')){if(failQueue)throw Error('Unavailable');return {rows:sql.includes('WHERE id =')?records.filter(r=>r.id===args[0]):records};}
  if(sql.includes('_deskQueueWork')){
   if(failWork)throw Error('Unavailable');
   if(sql.startsWith('INSERT')){const [id,status,draft,note]=args;const old=work.get(id)||{inquiry_id:id,status:'New',draft:'',note:''};const saved={...old,status:status??old.status,draft:draft??old.draft,note:note??old.note};work.set(id,saved);return {rows:[saved]};}
   return {rows:[...work.values()]};
  }
  throw Error('Unexpected query');
 }
}
class BadRequestException extends Error{}
const sandbox={exports:{},process:{env:{}},require:name=>name==='pg'?{Client}:name==='@nestjs/common'?{BadRequestException}:name==='./hired-redact'?{redactContactText:s=>s}: {}};
vm.runInNewContext(fs.readFileSync(root+'/hired-desk-queues.js','utf8')+'\nexports.row=row;exports.requestMessage=requestMessage;exports.queueBoard=queueBoard;',sandbox);
const api=sandbox.exports;
const pause=()=>new Promise(r=>setTimeout(r,10));
async function mount(payload){
 const dom=new JSDOM(`<main class="hired-desk"><nav aria-label="Views"><button class="hired-nav" aria-pressed="true">All inquiries</button></nav><nav aria-label="Queues">${['Cleaning','Cars','Jobs','Turo'].map(n=>`<button class="hired-nav">${n}<span data-kx-count="${n.toLowerCase()}"></span></button>`).join('')}</nav><nav aria-label="Lead potential filters"><button aria-pressed="false">High</button></nav><div class="hired-voice">Google Voice</div><div class="hired-workspace"><header class="hired-toolbar"><h1>Inquiries</h1><span class="hired-count">29 total</span><input></header><div class="hired-content"><div class="hired-row">Kiosk inquiry</div><div class="hired-actions"></div><section id="kioskx-voice-connect">Google Voice connection</section></div></div></main>`,{url:'https://desk.invalid',runScripts:'outside-only'});
 dom.window.localStorage.setItem('tokenPairState',JSON.stringify({accessOrWorkspaceAgnosticToken:{token:'test'}}));
 const observers=[];const Observer=dom.window.MutationObserver;dom.window.MutationObserver=class extends Observer { constructor(fn){super(fn);observers.push(this);} };
 const calls=[];dom.window.fetch=async(url,opts)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('queue-work')?api.saveWork(JSON.parse(opts.body)):payload};};
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 dom.window.eval(fs.readFileSync(root+'/kioskx-desk-queues.js','utf8'));await pause();
 return {dom,w:dom.window,d:dom.window.document,calls,close:()=>{observers.forEach(o=>o.disconnect());dom.window.close();}};
}
const open=async(m,key)=>{m.w.kxOpenQueue(key);await pause();return m.d.querySelector('.kx-queue-panel .hired-detail');};
const findButton=(e,label)=>[...e.querySelectorAll('button')].find(b=>b.textContent===label);
test('cleaning detail reads submitted bedroom count, without JSON or consent',async()=>{
 const m=await mount(await api.queueBoard());try{const e=await open(m,'cleaning');assert.ok(e.textContent.includes('3 bedrooms'));assert.ok(e.textContent.includes('2 bathrooms'));assert.ok(!e.textContent.includes('{'));assert.ok(!e.textContent.includes('private boilerplate'));}finally{m.close();}
});
test('submitted contacts are available only in AniDeeBee queue projection',()=>{
 const r=api.row(records[0],'cleaning');assert.ok(r.email===records[0].email);assert.ok(r.phone===records[0].phone);
});
test('synthetic names and messages are excluded before truncation',async()=>{
 for(const flag of ['synthetic','not a candidate','not a real','please discard','Form Check','Test Applicant']){
  assert.equal(api.row({name:flag},'jobs'),null);
  assert.equal(api.row({name:'Applicant',requestDetailsMarkdown:JSON.stringify({message:'x'.repeat(600)+flag})},'jobs'),null);
 }
 for(const name of ['TTTT','tttt'])assert.equal(api.row({name},'jobs'),null);
 for(const message of ['test','test test TEST','test\ntest'])assert.equal(api.row({name:'Applicant',requestDetailsMarkdown:JSON.stringify({message})},'jobs'),null);
 const m=await mount(await api.queueBoard());try{await open(m,'jobs');assert.ok(!/TTTT|Form Check|Test Applicant/.test(m.d.querySelector('.kx-queue-panel').textContent));}finally{m.close();}
});
test('JSON double encoding, missing and malformed messages stay human readable',()=>{
 for(const raw of [JSON.stringify({message:'Hello.'}),JSON.stringify(JSON.stringify({message:'Hello.'})),'Hello.'])assert.equal(api.requestMessage(raw),'Hello.');
 for(const raw of ['{bad',{}, {message:{}},{message:['one']},'[{"message":"one"}]'])assert.equal(api.requestMessage(raw),'');
 assert.ok(api.row({requestedService:'Cleaner'},'jobs').description.includes('No message was submitted.'));
});
test('car description includes purpose and all supplied details with no-reservation notice',()=>{
 const r=api.row(records[2],'cars');for(const word of ['Car for Work','City','One week','through Friday','Company: Company','Equipment: Tools'])assert.ok(r.description?.includes(word));assert.equal(r.notice,'This request does not reserve a car.');
});
test('status and draft survive next board read, partial writes preserve each other',async()=>{
 const id=records[0].id;await api.saveWork({id,status:'Waiting'});await api.saveWork({id,draft:'Please confirm a time.'});
 const item=(await api.queueBoard()).queues.cleaning.rows[0];assert.equal(item.status,'Waiting');assert.equal(item.draft,'Please confirm a time.');
 await api.saveWork({id,status:'New',draft:''});
});
test('UI saves next step and reply then remount reads them',async()=>{
 const m=await mount(await api.queueBoard());try{const e=await open(m,'cleaning');findButton(e,'Call next').click();await pause();e.querySelector('textarea').value='Saved fixture draft';findButton(e,'Save draft').click();await pause();}finally{m.close();}
 const next=await mount(await api.queueBoard());try{const e=await open(next,'cleaning');assert.equal(findButton(e,'Call next').getAttribute('aria-pressed'),'true');assert.equal(e.querySelector('textarea').value,'Saved fixture draft');assert.equal(next.d.querySelector('.kx-new-count').textContent,'0 still new');}finally{next.close();await api.saveWork({id:records[0].id,status:'New',draft:''});}
});
test('mail function is never called with DESK_QUEUE_MAIL unset',async()=>{
 delete sandbox.process.env.DESK_QUEUE_MAIL;let sent=0;const r=await api.guardedSend(()=>{sent++;});assert.equal(sent,0);assert.equal(r.sent,false);
 const m=await mount(await api.queueBoard());try{const e=await open(m,'jobs');assert.equal(findButton(e,'Send').disabled,true);findButton(e,'Send').click();assert.ok(!m.calls.some(u=>/send|email/.test(u)));assert.equal(findButton(e,'Text').disabled,true);assert.ok(e.textContent.includes('Text from this desk is not connected.'));}finally{m.close();}
});
test('Turo shows four exact names in order, no website link or price field; note survives',async()=>{
 const data=await api.queueBoard(),m=await mount(data);try{const e=await open(m,'turo');assert.deepEqual([...m.d.querySelectorAll('.kx-queue-panel .hired-row strong')].map(e=>e.textContent),['Mercedes C300','2023 Tesla Model Y','Mercedes GLS450','2027 Tesla Model Y']);assert.ok(!m.d.querySelector('.kx-queue-panel').textContent.includes('turo.com'));assert.equal(e.querySelectorAll('a,input[type=number]').length,0);assert.ok(m.d.querySelector('.hired-list').textContent.includes('No host booking list. Prices stay unchanged. Guest messages on Turo are not connected.'));e.querySelector('textarea').value='Check reminder';findButton(e,'Save note').click();await pause();assert.equal((await api.queueBoard()).queues.turo.rows[0].note,'Check reminder');}finally{m.close();}
});
test('Call only reveals existing Google Voice box; no call API or navigation',async()=>{
 const m=await mount(await api.queueBoard());try{const original=m.d.querySelector('#kioskx-voice-connect'),e=await open(m,'cleaning');findButton(e,'Call').click();assert.ok(e.contains(original));assert.ok(!m.calls.some(u=>/call|voice-bridge/.test(u)));await open(m,'');assert.ok(m.d.querySelector('.hired-content:not(.kx-queue-panel)').contains(original));}finally{m.close();}
});
test('only open queue is selected and queue rows never use hired-nav; original list retained',async()=>{
 const m=await mount(await api.queueBoard());try{const original=m.d.querySelector('.hired-content');await open(m,'jobs');assert.equal(m.d.querySelectorAll('nav[aria-label="Queues"] .hired-nav').length,0);assert.equal(m.d.querySelectorAll('nav[aria-label="Queues"] .hired-potential-filter').length,4);assert.equal(m.d.querySelectorAll('nav button[aria-pressed="true"]').length,1);await open(m,'');assert.equal(m.d.querySelector('.hired-content'),original);assert.equal(original.hidden,false);}finally{m.close();}
});
test('failed queue has unavailable message and no status controls; empty queue stays explicit',async()=>{
 for(const [data,expected] of [[{unavailable:true},'This queue is unavailable. Try refreshing.'],[{queues:{jobs:{rows:[]}}},'No requests in this queue.']]){
  const m=await mount(data);try{const e=await open(m,'jobs');assert.ok(e.textContent.includes(expected));assert.equal(e.querySelectorAll('[data-status]').length,0);}finally{m.close();}
 }
});
test('work table failure preserves requests and disables work controls',async()=>{
 failWork=true;try{const data=await api.queueBoard();assert.equal(data.workUnavailable,true);const m=await mount(data);try{const e=await open(m,'cleaning');assert.ok(e.textContent.includes('3 bedrooms'));assert.ok(e.textContent.includes('Work status is unavailable.'));assert.equal(findButton(e,'Save draft').disabled,true);}finally{m.close();}}finally{failWork=false;}
});
test('fleet remains four cars when inquiry DB fails',async()=>{failQueue=true;try{const data=await api.queueBoard();assert.equal(data.queues.turo.rows.length,4);const m=await mount(data);try{await open(m,'turo');assert.equal(m.d.querySelectorAll('.kx-queue-panel .hired-row').length,4);}finally{m.close();}}finally{failQueue=false;}});
test('reject status injection, unknown ID and fleet draft writes',async()=>{
 for(const patch of [{id:records[0].id,status:'Other'},{id:'bad',draft:'x'},{id:'turo:c300',draft:'x'},{id:records[0].id,note:'x'}])await assert.rejects(()=>api.saveWork(patch));
});
test('existing Kiosk inquiry redactor keeps fixture email masked when list restored',async()=>{
 const red={exports:{},require:()=>({convert:s=>s})};vm.runInNewContext(fs.readFileSync(__dirname+'/baseline/hired-redact.js','utf8'),red);
 const email=records[0].email;const masked=red.exports.inquiryText({markdown:`Please reply to ${email}`});assert.ok(!masked.includes(email));assert.ok(masked.includes('[email removed]'));
 const m=await mount(await api.queueBoard());try{const original=m.d.querySelector('.hired-content');original.querySelector('.hired-row').textContent=masked;await open(m,'cleaning');await open(m,'');assert.ok(!original.textContent.includes(email));}finally{m.close();}
});
test('empty queue displays zero still new',async()=>{const m=await mount({queues:{jobs:{rows:[]}}});try{await open(m,'jobs');assert.equal(m.d.querySelector('.kx-new-count').textContent,'0 still new');}finally{m.close();}});
test('all new queue endpoints authorize before accessing data',async()=>{
 const decorators=new Proxy({},{get:()=>()=>()=>{}});
 const isolated={exports:{},process:{env:{}},require:name=>name==='@nestjs/common'?decorators:name==='pg'?{Client}: {}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/hired-desk-queues.js','utf8'),isolated);
 class Controller {async authorize(){throw Error('Denied');}}
 isolated.exports.install(Controller);const c=new Controller();
 for(const name of ['queues','queueWork','queueSend'])await assert.rejects(()=>c[name]({},{}),/Denied/);
});
test('failed HTTP queue request still leaves all four fleet reminders visible but disabled',async()=>{
 const m=await mount({unavailable:true});try{const e=await open(m,'turo');assert.equal(m.d.querySelectorAll('.kx-queue-panel .hired-row').length,4);assert.equal(findButton(e,'Save note').disabled,true);assert.ok(e.textContent.includes('Work status is unavailable.'));}finally{m.close();}
});
test('Call exposes a renderer anchor when no Kiosk inquiry has created the Voice box',async()=>{
 const m=await mount(await api.queueBoard());try{m.d.querySelector('#kioskx-voice-connect').remove();m.d.querySelector('.hired-actions').remove();const e=await open(m,'jobs');const slot=e.querySelector('.kx-voice-slot');assert.equal(slot.hidden,true);findButton(e,'Call').click();assert.equal(slot.hidden,false);assert.ok(slot.querySelector('.hired-actions'));assert.ok(!m.calls.some(u=>/call|voice-bridge/.test(u)));}finally{m.close();}
});
test('Kiosk loading notice is hidden while working another queue and restored on return',async()=>{
 const m=await mount(await api.queueBoard());try{const notice=m.d.createElement('p');notice.className='hired-notice';notice.textContent='Loading inquiries…';m.d.querySelector('.hired-workspace').append(notice);await open(m,'jobs');assert.equal(notice.style.display,'none');await open(m,'');assert.equal(notice.hidden,false);assert.equal(notice.style.display,'');}finally{m.close();}
});
