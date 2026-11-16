const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('/tmp/sales-desk-test-tools/node_modules/jsdom');
const reach=require(process.env.BASELINE_QUEUE ? './baseline/reach' : './reach');
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
   if(sql.includes("LIKE 'reach:%'"))return {rows:[]};
   if(failWork)throw Error('Unavailable');
   if(sql.startsWith('INSERT')){const [id,status,draft,note]=args;const old=work.get(id)||{inquiry_id:id,status:'New',draft:'',note:''};const saved={...old,status:status??old.status,draft:draft??old.draft,note:note??old.note};work.set(id,saved);return {rows:[saved]};}
   return {rows:[...work.values()]};
  }
  throw Error('Unexpected query');
 }
}
class BadRequestException extends Error{}
const sandbox={exports:{},process:{env:{}},require:name=>name==='./reach'?reach:name==='pg'?{Client}:name==='@nestjs/common'?{BadRequestException}:name==='./hired-redact'?{redactContactText:s=>s}: {}};
vm.runInNewContext(fs.readFileSync(root+'/hired-desk-queues.js','utf8')+'\nexports.row=row;exports.requestMessage=requestMessage;exports.queueBoard=queueBoard;',sandbox);
const api=sandbox.exports;
const pause=()=>new Promise(r=>setTimeout(r,10));
async function mount(payload,actions){
 const dom=new JSDOM(`<main class="hired-desk"><nav aria-label="Views"><button class="hired-nav" aria-pressed="true">All inquiries</button></nav><nav aria-label="Queues">${['Cleaning','Cars','Jobs','Turo'].map(n=>`<button class="hired-nav">${n}<span data-kx-count="${n.toLowerCase()}"></span></button>`).join('')}</nav><nav aria-label="Lead potential filters"><button aria-pressed="false">High</button></nav><div class="hired-voice">Google Voice</div><div class="hired-workspace"><header class="hired-toolbar"><h1>Inquiries</h1><span class="hired-count">29 total</span><input></header><div class="hired-content"><div class="hired-row">Kiosk inquiry</div><div class="hired-actions"></div><section id="kioskx-voice-connect">Google Voice connection</section></div></div></main>`,{url:'https://desk.invalid',runScripts:'outside-only'});
 dom.window.localStorage.setItem('tokenPairState',JSON.stringify({accessOrWorkspaceAgnosticToken:{token:'test'}}));
 const observers=[];const Observer=dom.window.MutationObserver;dom.window.MutationObserver=class extends Observer { constructor(fn){super(fn);observers.push(this);} };
 const calls=[];dom.window.fetch=async(url,opts)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('queue-work')?api.saveWork(JSON.parse(opts.body)):actions&&url.endsWith('queue-send')?actions(JSON.parse(opts.body)):url.endsWith('/call')?{status:'connect',message:'Connect Google Voice to place this call.',thread:[]}:payload};};
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
test('mail enabled capability replaces old off page',async()=>{
 const m=await mount({...await api.queueBoard(),mailEnabled:true,smsEnabled:true});try{const e=await open(m,'cleaning');assert.equal(findButton(e,'Send').disabled,false);assert.equal(findButton(e,'Text').disabled,false);assert.ok(!e.textContent.includes('Mailbox send is off.'));}finally{m.close();}
});
test('Turo shows four exact names in order, no website link or price field; note survives',async()=>{
 const data=await api.queueBoard(),m=await mount(data);try{const e=await open(m,'turo');assert.deepEqual([...m.d.querySelectorAll('.kx-queue-panel .hired-row strong')].map(e=>e.textContent),['Mercedes C300','2023 Tesla Model Y','Mercedes GLS450','2027 Tesla Model Y']);assert.ok(!m.d.querySelector('.kx-queue-panel').textContent.includes('turo.com'));assert.equal(e.querySelectorAll('a,input[type=number]').length,0);assert.ok(m.d.querySelector('.hired-list').textContent.includes('No host booking list. Prices stay unchanged. Guest messages on Turo are not connected.'));e.querySelector('textarea').value='Check reminder';findButton(e,'Save note').click();await pause();assert.equal((await api.queueBoard()).queues.turo.rows[0].note,'Check reminder');}finally{m.close();}
});
test('Call without session reveals existing Google Voice box',async()=>{
 const m=await mount(await api.queueBoard());try{const original=m.d.querySelector('#kioskx-voice-connect'),e=await open(m,'cleaning');findButton(e,'Call').click();await pause();assert.ok(e.contains(original));assert.ok(e.textContent.includes('Connect Google Voice'));await open(m,'');assert.ok(m.d.querySelector('.hired-content:not(.kx-queue-panel)').contains(original));}finally{m.close();}
});
test('Inbox shows the IntelliVerse inbox inside the desk',async()=>{
 const m=await mount(await api.queueBoard());try{
  await open(m,'inbox');
  const frame=m.d.querySelector('.kx-inbox-panel iframe');
  assert.equal(frame.getAttribute('src'),'https://inbox.intelli-verse-x.ai/');
  assert.equal(frame.title,'Inbox');
  assert.equal(m.d.querySelector('.hired-content:not(.kx-inbox-panel)').hidden,true);
  assert.equal(m.d.querySelector('[data-kx-inbox]').getAttribute('aria-pressed'),'true');
  assert.equal(m.d.querySelector('.hired-toolbar h1').textContent,'Inbox');
  await open(m,'');
  assert.equal(m.d.querySelector('.kx-inbox-panel').hidden,true);
  assert.equal(m.d.querySelector('.hired-content:not(.kx-inbox-panel)').hidden,false);
 }finally{m.close();}
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
 const m=await mount(await api.queueBoard());try{m.d.querySelector('#kioskx-voice-connect').remove();m.d.querySelector('.hired-actions').remove();const e=await open(m,'jobs');const slot=e.querySelector('.kx-voice-slot');assert.equal(slot.hidden,true);findButton(e,'Call').click();await pause();assert.equal(slot.hidden,false);assert.ok(slot.querySelector('.hired-actions'));assert.ok(m.calls.some(u=>u.endsWith('/call')));}finally{m.close();}
});
test('Kiosk loading notice is hidden while working another queue and restored on return',async()=>{
 const m=await mount(await api.queueBoard());try{const notice=m.d.createElement('p');notice.className='hired-notice';notice.textContent='Loading inquiries…';m.d.querySelector('.hired-workspace').append(notice);await open(m,'jobs');assert.equal(notice.style.display,'none');await open(m,'');assert.equal(notice.hidden,false);assert.equal(notice.style.display,'');}finally{m.close();}
});

function rig(overrides={}) {
 const entries=new Map();let draft='Please confirm a time.';
 const sent={email:0,sms:0,call:0,sockets:0,requests:0};
 const repo={thread:async()=>[...entries.values()],draft:async()=>draft,
 claim:async(id,key,kind,text)=>{if(entries.has(key))return false;entries.set(key,{leadId:id,key,kind,text,status:'pending',message:'Outcome not confirmed. Do not resend.',time:new Date().toISOString()});return true;},
 finish:async(key,x)=>entries.set(key,{...entries.get(key),...x})};
 const deps={repo,record:{queue:'cleaning',label:'Customer',email:'fixture@example.invalid',phone:'+12025550100'},config:{mailEnabled:true,smsEnabled:true},
 email:async()=>{sent.email++;return {accepted:true};},sms:async()=>{sent.sms++;return {accepted:true};},voice:async()=>{sent.call++;return {status:'queued'};},...overrides};
 return {sent,deps,run:(kind,extra={})=>reach.act({id:'fixture',kind,requestId:'attempt',...extra},deps)};
}
test('fake email accepts once, same text stays once after refresh, zero sockets',async()=>{const r=rig();const first=await r.run('email');assert.equal(first.message,'Email sent');assert.equal(first.thread[0].text,'Please confirm a time.');assert.equal(first.thread[0].message,'Email sent');await r.run('email');assert.equal(r.sent.email,1);assert.equal(r.sent.sockets,0);});
test('concurrent duplicate email claims one side effect',async()=>{const r=rig();await Promise.all([r.run('email'),r.run('email')]);assert.equal(r.sent.email,1);});
test('refused SMTP keeps draft and says not sent',async()=>{const r=rig({email:async()=>({accepted:false})});assert.equal((await r.run('email')).message,'Email was not sent.');assert.equal(await r.deps.repo.draft(),'Please confirm a time.');});
test('ambiguous SMTP never replays',async()=>{let sends=0;const r=rig({email:async()=>{sends++;throw Error();}});await r.run('email');await r.run('email');assert.equal(sends,1);});
test('no browser session connects and never queues number',async()=>{const r=rig();assert.equal((await r.run('call')).message,'Connect Google Voice to place this call.');assert.equal(r.sent.call,0);});
test('connected browser queues once even with a fresh click ID',async()=>{const r=rig();assert.equal((await r.run('call',{sessionId:'session'})).message,'Call queued on Google Voice.');await r.run('call',{sessionId:'session',requestId:'another'});assert.equal(r.sent.call,1);});
test('India destination blocked before SMS transport',async()=>{const r=rig();r.deps.record.phone='+919876543210';assert.equal((await r.run('sms')).message,'Text to India is blocked.');assert.equal(r.sent.sms,0);});
test('no from number disables Text and never calls SMS',async()=>{const r=rig();r.deps.config.smsEnabled=false;assert.equal((await r.run('sms')).message,'Text from this desk is not connected.');assert.equal(r.sent.sms,0);const m=await mount({...await api.queueBoard(),smsEnabled:false});try{const e=await open(m,'cleaning');assert.equal(findButton(e,'Text').disabled,true);findButton(e,'Text').click();assert.ok(!m.calls.some(x=>x.endsWith('queue-send')));}finally{m.close();}});
test('sender available records one fake SMS with thread and zero live requests',async()=>{const r=rig();const out=await r.run('sms');assert.equal(out.message,'Text sent');assert.equal(out.thread[0].message,'Text sent');await r.run('sms');assert.equal(r.sent.sms,1);assert.equal(r.sent.requests,0);});
test('thread rendered newest last with original reply and time',async()=>{const d=await api.queueBoard();d.queues.cleaning.rows[0].thread=[{time:'2026-11-15T10:00:00Z',message:'Email sent',text:'First reply'},{time:'2026-11-15T10:01:00Z',message:'Text sent',text:'Second reply'}];const m=await mount(d);try{const e=await open(m,'cleaning');const text=e.querySelector('.kx-thread').textContent;assert.ok(text.includes('Email sent'));assert.ok(text.indexOf('First reply')<text.indexOf('Second reply'));}finally{m.close();}});
test('production SMTP adapter fake acceptance uses exact saved body and no socket',async()=>{
 let mails=0,sockets=0;const fakeEnv={KIOSKX_HIRED_EMAIL_FROM:'desk@example.invalid',EMAIL_SMTP_PORT:'587'};
 const s={module:{exports:{}},process:{env:fakeEnv},Buffer,AbortSignal,require:n=>n==='nodemailer'?{createTransport:config=>{assert.equal(config.requireTLS,true);return {sendMail:async m=>{mails++;assert.equal(m.text,'Only this body');assert.equal(m.subject,'Cleaning request — Customer');assert.equal(m.from,fakeEnv.KIOSKX_HIRED_EMAIL_FROM);return {accepted:[true]};},close(){}};}}:require(n)};
 vm.runInNewContext(fs.readFileSync(__dirname+'/reach.js','utf8'),s);const t=await s.module.exports.transports({});assert.equal((await t.email({to:'fixture@example.invalid',subject:'Cleaning request — Customer',text:'Only this body'})).accepted,true);assert.equal(mails,1);assert.equal(sockets,0);
});
test('production SMS adapter fake HTTP acceptance, no live fetch',async()=>{
 let fake=0;const s={module:{exports:{}},process:{env:{KIOSKX_VOICE_FROM_NUMBER:'fixture',TELNYX_TOKEN:'fake'}},Buffer,AbortSignal,require,fetch:async(u,o)=>{fake++;assert.equal(JSON.parse(o.body).text,'Only this body');return {ok:true,json:async()=>({data:{id:'fake'}})};}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/reach.js','utf8'),s);const t=await s.module.exports.transports({});assert.equal((await t.sms({to:'fixture',text:'Only this body'})).accepted,true);assert.equal(fake,1);
});
test('Voice adapter checks this browser against live session before inserting, encrypted once',async()=>{
 const {generateKeyPairSync}=require('node:crypto');const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});let inserted=0;
 const desk={system:fn=>fn(),voiceOn:()=>true,bridgeSession:async()=>({sessionId:'browser',expires:Date.now()+15000,publicKey:publicKey.export({type:'spki',format:'pem'})}),repo:async()=>({insert:async n=>{inserted++;assert.equal(n.title,'KioskX Google Voice preparing');},update:async(id,n)=>{assert.equal(n.title,'KioskX Google Voice queued');const p=JSON.parse(n.bodyV2.markdown);assert.ok(p.ciphertext);assert.ok(!n.bodyV2.markdown.includes('+12025550100'));}})};
 const t=await reach.transports(desk);assert.equal((await t.voice({destination:'+12025550100',sessionId:'other',key:'a'.repeat(64)})).status,'connect');assert.equal(inserted,0);assert.equal((await t.voice({destination:'+12025550100',sessionId:'browser',key:'a'.repeat(64)})).status,'queued');assert.equal(inserted,1);
});

test('Send and Text clicks save reply, accept fake transport once and paint persistent thread',async()=>{
 for(const kind of ['email','sms']) {
  const r=rig();r.deps.repo.draft=async()=>work.get(records[0].id)?.draft||'';
  const data={...await api.queueBoard(),mailEnabled:true,smsEnabled:true};
  const m=await mount(data,body=>reach.act(body,r.deps));
  try{const e=await open(m,'cleaning');e.querySelector('textarea').value='Exact saved reply';const b=findButton(e,kind==='email'?'Send':'Text');b.click();await pause();await pause();assert.equal(r.sent[kind],1);assert.ok(e.querySelector('.kx-thread').textContent.includes(kind==='email'?'Email sent':'Text sent'));assert.ok(e.querySelector('.kx-thread').textContent.includes('Exact saved reply'));b.click();await pause();await pause();assert.equal(r.sent[kind],1);}
  finally{m.close();}
  const refreshed={...await api.queueBoard(),mailEnabled:true,smsEnabled:true};refreshed.queues.cleaning.rows[0].thread=await r.deps.repo.thread();
  const next=await mount(refreshed);try{const e=await open(next,'cleaning');assert.ok(e.querySelector('.kx-thread').textContent.includes('Exact saved reply'));}finally{next.close();}
 }
});

test('concurrent Call clicks with different request IDs queue only once',async()=>{const r=rig();await Promise.all([r.run('call',{sessionId:'session',requestId:'first'}),r.run('call',{sessionId:'session',requestId:'second'})]);assert.equal(r.sent.call,1);});

test('native Kiosk cards keep existing notes and masked list, get reply actions',async()=>{
 const payload={...await api.queueBoard(),mailEnabled:true,smsEnabled:true};payload.queues.kiosk={rows:[{id:records[0].id,label:'Kiosk customer',email:records[0].email,phone:records[0].phone,draft:'',status:'New'}]};
 const m=await mount(payload);try{
  const content=m.d.querySelector('.hired-content');content.innerHTML='<section class="hired-list"><div class="hired-row">Kiosk customer ***@****</div></section><section class="hired-detail"><div><article><div class="hired-card-heading"><h2>Kiosk customer</h2></div><div class="hired-card-main"><div class="hired-actions">Old actions</div></div><section class="existing-notes">Keep these notes</section></article></div></section>';
  await pause();const card=content.querySelector('article');assert.equal(card.querySelectorAll('.kx-work').length,1);assert.ok(card.querySelector('.existing-notes'));assert.equal(findButton(card,'Send').disabled,false);assert.equal(findButton(card,'Text').disabled,false);assert.ok(!content.querySelector('.hired-list').textContent.includes(records[0].email));
 }finally{m.close();}
});

test('explicit India country blocks national-format number too',async()=>{const r=rig();r.deps.record.country='IN';r.deps.record.phone='2025550100';assert.equal((await r.run('sms')).message,'Text to India is blocked.');assert.equal(r.sent.sms,0);});

function mailRig(fail) {
 const messages=[];let closed=0;
 const env={KIOSKX_HIRED_EMAIL_FROM:'support@kiosk-x.ai'};
 const s={module:{exports:{}},process:{env},Buffer,AbortSignal,require:n=>n==='nodemailer'?{createTransport:()=>({sendMail:async m=>{messages.push(m);if(fail)await fail(messages.length);return {accepted:[true]};},close(){closed++;}})}:require(n)};
 vm.runInNewContext(fs.readFileSync(root+'/reach.js','utf8'),s);
 return {messages,transport:async()=>(await s.module.exports.transports({})).email,closed:()=>closed};
}
test('AniDeeBee queues use branded From and preserve queue subject through production adapter',async()=>{
 for(const queue of ['cleaning','cars','jobs','kiosk']){
  const m=mailRig(),r=rig({email:await m.transport()});r.deps.record.queue=queue;
  const result=await r.run('email');assert.equal(result.status,'sent');
  assert.ok(m.messages[0].from===(queue==='kiosk'?'support@kiosk-x.ai':'AniDeeBee <support@anideebee.com>'),'correct sender identity');
  assert.equal(m.messages[0].subject,({cleaning:'Cleaning request',cars:'Cars request',jobs:'Jobs request',kiosk:'Kiosk inquiry'})[queue]+' — Customer');
 }
});
test('definite sender refusal falls back once and persists fallback sentence across repeated reply',async()=>{
 const m=mailRig(n=>{if(n===1)throw {responseCode:550,command:'MAIL FROM',response:'sender refused'};});
 const r=rig({email:await m.transport()});const result=await r.run('email');
 assert.ok(result.message==='Sent as support@kiosk-x.ai. AniDeeBee mail was refused.','fallback sentence');
 assert.equal(m.messages.length,2);assert.ok(m.messages[1].from==='support@kiosk-x.ai','fallback identity');
 await r.run('email');assert.equal(m.messages.length,2);assert.equal(result.thread[0].message,result.message);
});
test('recipient rejection, auth rejection and uncertain delivery never fallback',async()=>{
 for(const error of [{responseCode:550,command:'RCPT TO'},{responseCode:535,command:'AUTH'},{code:'ETIMEDOUT'},{responseCode:451,command:'MAIL FROM'}]){
  const m=mailRig(()=>{throw error;});const r=rig({email:await m.transport()});await r.run('email');await r.run('email');assert.equal(m.messages.length,1);
 }
});
test('rejected fallback remains terminal and does not retry refused sender',async()=>{
 const m=mailRig(()=>{throw {responseCode:550,command:'MAIL FROM'};});const r=rig({email:await m.transport()});assert.equal((await r.run('email')).status,'refused');await r.run('email');assert.equal(m.messages.length,2);
});
test('cleaning reminder fills dated sentence or empty-time instruction and never calls mail',async()=>{
 let mails=0;const m=await mount(await api.queueBoard(),()=>{mails++;});
 try{const e=await open(m,'cleaning'),reminder=findButton(e,'Appointment reminder');assert.ok(reminder,'reminder exists');
 const time=e.querySelector('[aria-label="Appointment time"]');time.value='10:30 AM';reminder.click();await pause();
 assert.equal(e.querySelector('textarea').value,'You have an appointment tomorrow at 10:30 AM. Date on the request: 2026-12-01.');
 time.value='';reminder.click();assert.equal(e.querySelector('textarea').value,'Add the appointment time, then use Appointment reminder.');
 assert.equal(mails,0);assert.ok(!m.calls.some(u=>/queue-send|queue-work|\/call$/.test(u)));
 }finally{m.close();}
});
test('reminder without date has no invented date; Cars Jobs and Turo have no reminder',async()=>{
 const payload=await api.queueBoard();payload.queues.cleaning.rows[0].appointmentDate='';const m=await mount(payload);
 try{const e=await open(m,'cleaning');const b=findButton(e,'Appointment reminder');assert.ok(b);e.querySelector('[aria-label="Appointment time"]').value='2 PM';b.click();assert.equal(e.querySelector('textarea').value,'You have an appointment tomorrow at 2 PM.');for(const q of ['cars','jobs','turo'])assert.equal(findButton(await open(m,q),'Appointment reminder'),undefined);}finally{m.close();}
});
test('Today reads two stored email results and one call, sanitizes name, excludes yesterday and failures',async()=>{
 const r=rig();await r.run('email');await r.deps.repo.claim('fixture','second','email','second');await r.deps.repo.finish('second',{kind:'email',status:'sent'});await r.run('call',{sessionId:'fixture'});
 const payload=await api.queueBoard();payload.queues.cleaning.rows[0].label='Customer contact@example.invalid +1 (202) 555-0100';
 payload.queues.cleaning.rows[0].thread=[...await r.deps.repo.thread(),{kind:'email',status:'sent',time:new Date(Date.now()-86400000).toISOString()},{kind:'sms',status:'refused',time:new Date().toISOString()}];
 const m=await mount(payload);try{const box=m.d.querySelector('.kx-today');assert.ok(box);assert.ok(box.textContent.includes('2 emails'));assert.ok(box.textContent.includes('1 call'));assert.ok(!box.textContent.includes('@'));assert.ok(!/\d[\d ().-]{6,}\d/.test(box.textContent));assert.ok(box.textContent.includes('Cleaning — Customer'));assert.ok(box.textContent.includes('Email sent'));assert.ok(box.textContent.includes('Call queued'));box.open=true;assert.equal(box.open,true);}finally{m.close();}
});
test('Today zero and unavailable states are honest',async()=>{
 for(const [payload,copy] of [[{queues:{}},'Today: nothing sent.'],[{queues:{},workUnavailable:true},'Today: activity unavailable.']]){const m=await mount(payload);try{assert.equal(m.d.querySelector('.kx-today summary')?.textContent,copy);}finally{m.close();}}
});
