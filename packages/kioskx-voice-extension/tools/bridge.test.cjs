const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const built=process.env.OVERLAY_SERVER;
const {setup,lead,keys}=require('./bridge-fixture.cjs');
test('no session returns Connect and creates no call',async()=>{const {desk,rows}=setup();assert.equal((await desk.call(lead,crypto.randomUUID())).status,'connect');assert.equal(rows.size,0);});
test('office configured enables pairing by default while bot remains off; explicit false disables', async()=>{
 const s=setup();s.env.KIOSKX_VOICE_CALL='false';
 assert.equal((await s.desk.bridgeConfig()).enabled,true);
 s.env.KIOSKX_HIRED_VOICE='false';
 assert.equal((await s.desk.bridgeConfig()).enabled,false);
 assert.equal((await s.connect()).status,'unavailable');
 assert.equal((await s.desk.call(lead,crypto.randomUUID())).status,'unavailable');
 delete s.env.KIOSKX_HIRED_VOICE;delete s.env.KIOSKX_GOOGLE_VOICE_NUMBER;
 assert.equal((await s.desk.bridgeConfig()).enabled,false);
});
test('encrypted queue, one durable claim, no phone in browser payload',async()=>{const s=setup();await s.connect();assert.equal((await s.desk.call(lead,crypto.randomUUID())).status,'queued');const job=await s.desk.bridge({action:'poll',sessionId:s.sessionId});assert.equal(job.status,'claimed');assert.equal(JSON.stringify(job).includes('202555'),false);assert.equal(crypto.privateDecrypt({key:keys.privateKey,oaepHash:'sha256'},Buffer.from(job.ciphertext,'base64')).toString(),'+12025550123');assert.equal((await s.desk.bridge({action:'poll',sessionId:s.sessionId})).status,'idle');assert.equal(s.links.length,1);});
test('duplicate request is not queued twice',async()=>{const s=setup();await s.connect();const id=crypto.randomUUID();await s.desk.call(lead,id);assert.equal((await s.desk.call(lead,id)).status,'alreadySubmitted');});
test('wrong browser cannot claim',async()=>{const s=setup();await s.connect();await s.desk.call(lead,crypto.randomUUID());assert.equal((await s.desk.bridge({action:'poll',sessionId:'wrong'})).status,'connect');});
test('expired session cannot queue',async()=>{const s=setup();await s.connect();const r=s.rows.get(s.desk.bridgeNote);const body=JSON.parse(r.bodyV2.markdown);body.expires=0;r.bodyV2.markdown=JSON.stringify(body);assert.equal((await s.desk.call(lead,crypto.randomUUID())).status,'connect');});
test('expired queue is never dialed',async()=>{const s=setup();await s.connect();await s.desk.call(lead,crypto.randomUUID());const r=[...s.rows.values()].find(x=>x.title==='KioskX Google Voice queued');const p=JSON.parse(r.bodyV2.markdown);p.expires=0;r.bodyV2.markdown=JSON.stringify(p);assert.equal((await s.desk.bridge({action:'poll',sessionId:s.sessionId})).status,'idle');assert.match(r.title,/not dialed/);});
test('parallel polling hands off only once',async()=>{const s=setup();await s.connect();await s.desk.call(lead,crypto.randomUUID());const jobs=await Promise.all([1,2].map(()=>s.desk.bridge({action:'poll',sessionId:s.sessionId})));assert.equal(jobs.filter(x=>x.status==='claimed').length,1);});
test('Google tab opened is not call complete or transcript saved',async()=>{const s=setup();await s.connect();await s.desk.call(lead,crypto.randomUUID());const job=await s.desk.bridge({action:'poll',sessionId:s.sessionId});await s.desk.bridge({action:'result',sessionId:s.sessionId,operationId:job.operationId,status:'opened'});assert.match(s.rows.get(job.operationId).title,/unverified; no transcript/);});
test('actual imported transcript links to original inquiry once',async()=>{const s=setup();await s.connect();await s.desk.call(lead,crypto.randomUUID());const job=await s.desk.bridge({action:'poll',sessionId:s.sessionId});assert.equal((await s.desk.importVoiceTranscript(job.operationId,'Human: Test fixture conversation.','https://voice.google.com/test-fixture')).status,'saved');assert.equal((await s.desk.importVoiceTranscript(job.operationId,'Test fixture','https://voice.google.com/test-fixture')).status,'alreadySubmitted');assert.equal(s.links.length,2);assert.equal(s.links[1].targetPersonId,lead);});
test('unknown inquiry does not queue',async()=>{const s=setup();await s.connect();assert.equal((await s.desk.call('other',crypto.randomUUID())).status,'unavailable');});
function extension(ready){const state={};const tabs=[];const ctx={crypto:crypto.webcrypto,Uint8Array,TextEncoder,TextDecoder,URL,atob,btoa,setTimeout:fn=>{fn();},chrome:{storage:{session:{get:async key=>({[key]:state[key]}),set:async obj=>Object.assign(state,obj)}},tabs:{query:async()=>[{id:1}],create:async tab=>{tabs.push(tab);return{id:2};}},scripting:{executeScript:async()=>[{result:ready}]},runtime:{onMessage:{addListener(){}}}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),ctx);return{ctx,tabs};}
test('fake missing Google session opens no dial URL',async()=>{const {ctx,tabs}=extension(false);assert.equal((await ctx.handle({action:'dial',officeHash:'fake'})).status,'no-session');assert.equal(tabs.length,0);});
test('fake signed-in session opens only one background Google Voice deep link',async()=>{const {ctx,tabs}=extension(true);const session=await ctx.handle({action:'session',officeHash:'fake'});const ciphertext=crypto.publicEncrypt({key:session.publicKey,oaepHash:'sha256'},Buffer.from('+12025550123')).toString('base64');const message={action:'dial',operationId:crypto.randomUUID(),ciphertext,officeHash:'fake'};assert.equal((await ctx.handle(message)).status,'opened');assert.equal(tabs.length,1);assert.equal(tabs[0].active,false);assert.match(tabs[0].url,/^https:\/\/voice.google.com\/u\/0\/calls\?a=nc,%2B/);assert.equal((await ctx.handle(message)).status,'unknown');assert.equal(tabs.length,1);});
test('hired desk never invokes either forbidden dialer',()=>{const code=fs.readFileSync(path.join(built,'hired-google-voice-overlay.js'),'utf8');assert.doesNotMatch(code,/KioskxVoiceClient|fonoster_create_call|this\.voice[.!]/);});
function controller(identity,adminIds=''){
 const noop=()=>()=>{}; const common={ForbiddenException:class extends Error{},Get:noop,Post:noop,Header:noop,Req:noop,Body:noop};
 const policy={HIRED_WORKSPACE:'test',isHiredDesk:i=>i.user?.email==='support@kiosk-x.ai'};
 const box={exports:{},process:{env:{KIOSKX_VOICE_TRANSCRIPT_ADMIN_IDS:adminIds}},require:n=>n==='@nestjs/common'?common:n==='passport-jwt'?{ExtractJwt:{fromAuthHeaderAsBearerToken:()=>r=>r.token}}:policy};
 vm.runInNewContext(fs.readFileSync(path.join(built,'hired-google-voice-routes.js'),'utf8'),box);
 class Controller{async authorize(){if(!identity)throw Error('forbidden');}tokens={validateToken:async()=>identity};desk={bridgeConfig:async()=>({enabled:true}),importVoiceTranscript:async()=>({status:'saved'})};}
 box.exports.install(Controller);return new Controller();
}
test('unauthenticated bridge is rejected',async()=>{await assert.rejects(()=>controller(null).voiceConfig({}));});
test('hired account cannot import transcripts even if accidentally allowlisted',async()=>{const c=controller({user:{id:'u',email:'support@kiosk-x.ai'},workspace:{id:'test'}},'u');await assert.rejects(()=>c.voiceTranscript({token:'fake'},{}));});
test('admin import is disabled until explicitly allowlisted',async()=>{const c=controller({user:{id:'u',email:'admin@example.test'},workspace:{id:'test'}});await assert.rejects(()=>c.voiceTranscript({token:'fake'},{}));});
test('admin import requires real nonempty text and Google source reference',async()=>{const c=controller({user:{id:'u',email:'admin@example.test'},workspace:{id:'test'}},'u');const input={operationId:crypto.randomUUID(),transcript:'Fixture spoken words',source:'https://voice.google.com/fixture'};assert.equal((await c.voiceTranscript({token:'fake'},input)).status,'saved');await assert.rejects(()=>c.voiceTranscript({token:'fake'},{...input,transcript:''}));await assert.rejects(()=>c.voiceTranscript({token:'fake'},{...input,source:'javascript:alert(1)'}));});
test('account check accepts the office number only under the Voice number heading',async()=>{
 const {ctx}=extension(true);ctx.document={body:{innerText:'Account\nGoogle Voice number\n(202) 555-0100\nLinked numbers\n(202) 555-0199'}};ctx.location={origin:'https://voice.google.com',pathname:'/u/0/settings'};
 ctx.chrome.scripting.executeScript=async({func,args})=>[{result:await func(...args)}];
 const hash=crypto.createHash('sha256').update('12025550100').digest('hex');
 assert.equal((await ctx.handle({action:'session',officeHash:hash})).status,'connected');
 ctx.document.body.innerText='Account\nGoogle Voice number\n(202) 555-0199\nLinked numbers\n(202) 555-0100';
 assert.equal((await ctx.handle({action:'session',officeHash:hash})).status,'connect');
});
test('Calls settings navigates to Account before verifying; forwarding alone never connects', async()=>{
 const {ctx}=extension(true);let clicks=0;
 ctx.location={origin:'https://voice.google.com',pathname:'/u/0/settings'};
 ctx.document={body:{innerText:'Calls\nCall forwarding\n(202) 555-0100'},querySelectorAll:()=>[{
   textContent:'Account',click:()=>{clicks++;ctx.document.body.innerText='Account\nGoogle Voice number\n(202) 555-0100';}
 }]};
 ctx.chrome.scripting.executeScript=async({func,args})=>[{result:await func(...args)}];
 const hash=crypto.createHash('sha256').update('12025550100').digest('hex');
 assert.equal((await ctx.handle({action:'session',officeHash:hash})).status,'connected');
 assert.equal(clicks,1);
 ctx.document.body.innerText='Calls\nCall forwarding\n(202) 555-0100';
 ctx.document.querySelectorAll=()=>[];
 assert.equal((await ctx.handle({action:'session',officeHash:hash})).status,'connect');
});
test('overlay keeps the single entry identity and installs Connect only once',()=>{
 const front=path.resolve(built,'../../../front');
 const html=fs.readFileSync(path.join(front,'index.html'),'utf8');
 assert.equal(html.split('/assets/index-email-call-0862f92d1c3b.js').length,2);
 assert.equal(html.split('/assets/kioskx-voice-connect.js').length,2);
 assert.doesNotMatch(html,/index-gv-/);
 assert.ok(fs.existsSync(path.join(front,'assets/index-email-call-0862f92d1c3b.js')));
});
test('imported transcript renders in the admin rich-text field and repairs a missing attachment',async()=>{
 const s=setup();await s.connect();await s.desk.call(lead,crypto.randomUUID());const job=await s.desk.bridge({action:'poll',sessionId:s.sessionId});
 const args=[job.operationId,'Fixture spoken words','https://voice.google.com/fixture'];await s.desk.importVoiceTranscript(...args);
 const note=[...s.rows.values()].find(x=>x.title==='KioskX Google Voice transcript');
 assert.match(JSON.parse(note.bodyV2.blocknote)[0].content[0].text,/Fixture spoken words/);
 s.links.pop();assert.equal((await s.desk.importVoiceTranscript(...args)).status,'alreadySubmitted');assert.equal(s.links.length,2);
});
