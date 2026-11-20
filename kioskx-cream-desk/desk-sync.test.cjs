const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('/tmp/sales-desk-test-tools/node_modules/jsdom');
const store=require('./desk-sync-store'),seed=require('./desk-sync-seed.json'),{indeedSnapshot}=require('./desk-sync-run');
const pause=()=>new Promise(r=>setTimeout(r,25));
const expected=['Donald Stephens','Rick Arent','Aaron Romero','Anthony Simmons Sr.','Jasmine Black','Brandon Chandler'];
test('snapshot is the six supplied candidates, one job, four cars and exact trip',()=>{
 assert.deepEqual(store.candidates(seed.indeed).map(p=>p.label),expected);
 const fleet=store.fleet(seed.turo);assert.equal(fleet.rows.length,4);assert.equal(fleet.rows.filter(r=>r.summary==='No current trip').length,3);assert.match(fleet.rows[0].summary,/Svetozar.*15 Dec 2026 at 3:30 PM/);assert.equal(fleet.rows[0].trip.id,'63056209');assert.equal(fleet.threads.length,14);
 assert.equal(store.candidates(seed.indeed)[1].fields.find(([k])=>k==='Screener answer')[1],'2023 Kia Rio');
 assert.equal(seed.indeed.jobs.length,1);assert.equal(store.candidates(seed.indeed)[2].status,'Matched');
});
test('incremental source read preserves candidates and discovers other employer jobs',()=>{
 const newer=indeedSnapshot([{id:'new-mail',label:'Fixture applicant',service:'Warehouse associate',phone:'',email:''}],seed.indeed);
 const result=store.merge(seed.indeed,newer);assert.equal(result.candidates.length,7);assert.equal(result.jobs.length,2);
 const same=indeedSnapshot([{id:'mail-donald',label:'Donald Stephens',service:seed.indeed.jobs[0].title}],seed.indeed);
 assert.equal(store.merge(seed.indeed,same).candidates.length,6);assert.equal(same.candidates[0].interview,'Pending interview');
 assert.deepEqual(store.merge(seed.turo,{trips:[],threads:[]}),seed.turo);
});
test('failed refresh retains the exact payload and read/check timestamps in the database update',async()=>{
 const calls=[];const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.startsWith('SELECT')?[{payload:seed.turo}]:[]};}};
 await store.persist(client,'workspace_fixture','turo',null,'Refresh unavailable.');
 const update=calls.find(c=>c.sql.startsWith('UPDATE'));assert.deepEqual(update.args[2],seed.turo);assert.match(update.sql,/ELSE read_at/);assert.equal(update.args[4],false);assert.match(update.sql,/ELSE checked_at/);assert.equal(calls.at(-1).sql,'COMMIT');
});
test('storage transaction rolls back instead of losing previous evidence',async()=>{
 const calls=[];const client={query:async sql=>{calls.push(sql);if(sql.startsWith('UPDATE'))throw Error();return {rows:[{payload:seed.indeed}]};}};
 await assert.rejects(store.persist(client,'workspace_fixture','indeed',{candidates:[]}));assert.equal(calls.at(-1),'ROLLBACK');
});
async function mount(width){
 const dom=new JSDOM('<main class="hired-desk"></main>',{url:'https://desk.invalid/welcome',runScripts:'outside-only'}),w=dom.window;
 const observers=[],MO=w.MutationObserver;w.MutationObserver=class extends MO{constructor(fn){super(fn);observers.push(this);}};
 Object.defineProperty(w,'innerWidth',{value:width});w.localStorage.setItem('tokenPairState',JSON.stringify({accessOrWorkspaceAgnosticToken:{token:'fixture'}}));
 const calls=[];const snapshots={...seed.turo,readAt:'2026-11-20',error:'Refresh unavailable. Showing the last saved snapshot.'};
 const queues={jobs:{rows:[{id:'existing-form',label:'Existing form applicant',queue:'jobs',fields:[]} ,...store.candidates(seed.indeed)],snapshot:{readAt:'2026-11-20',error:'Refresh unavailable. Showing the last saved snapshot.',jobs:seed.indeed.jobs}},turo:store.fleet(snapshots),cleaning:{rows:[]},cars:{rows:[]},kiosk:{rows:[]}};
 w.fetch=async(url,options={})=>{calls.push({url,options});return {ok:true,json:async()=>String(url).endsWith('/queues')?{queues}:String(url).includes('applications?')?{applications:[]}:{conversations:[],connected:false}};};
 w.eval(fs.readFileSync(__dirname+'/kioskx-desk-queues.js','utf8'));await pause();await pause();
 const select=w.document.querySelector('[aria-label="Company"]');select.value='AniDeeBee';select.dispatchEvent(new w.Event('change'));return {w,d:w.document,calls,close:()=>{observers.forEach(o=>o.disconnect());w.close();}};
}
for(const width of [1440,390,375])test(`desk at ${width}: candidates, failed sync date, trip and inbox; no send`,async()=>{
 const m=await mount(width);try{
 m.w.kxOpenQueue('jobs');await pause();for(const name of expected)assert.ok(m.d.body.textContent.includes(name));assert.ok(m.d.body.textContent.includes('Existing form applicant'));assert.match(m.d.body.textContent,/Snapshot read 20 Nov 2026/);
 m.w.kxOpenQueue('call');await pause();assert.equal([...m.d.querySelectorAll('.sd-call-person')].filter(c=>expected.some(n=>c.textContent.includes(n))).length,6);assert.match(m.d.body.textContent,/No phone number on this application/);
 m.w.kxOpenQueue('turo');assert.equal(m.d.querySelectorAll('.sd-fleet-car').length,4);assert.match(m.d.body.textContent,/Svetozar/);assert.equal([...m.d.querySelectorAll('.sd-fleet-car')].filter(c=>c.textContent.includes('No current trip')).length,3);
 assert.equal(m.d.querySelectorAll('[aria-label="Turo inbox threads"] .sd-row').length,14);assert.match(m.d.body.textContent,/Showing the last saved snapshot/);
 m.d.querySelector('[aria-label="Turo inbox threads"] .sd-row').click();assert.match(m.d.querySelector('.sd-fleet-thread').textContent,/Anil/);assert.ok(m.d.querySelector('.sd-fleet-thread textarea'));assert.equal(m.d.querySelector('.sd-fleet-send').disabled,true);assert.equal(m.calls.filter(c=>c.options.method==='POST').length,0);
 assert.ok(!m.d.querySelector('.sd-fleet-grid').textContent.includes('Own reminder'));
 }finally{m.close();}
});

test('reply stays unsent until a click; double submit and failures never retry',async()=>{
 const m=await mount(1440);try{
 m.w.kxOpenQueue('turo');m.d.querySelector('[aria-label="Turo inbox threads"] .sd-row').click();
 const field=m.d.querySelector('.sd-fleet-thread textarea'),form=field.closest('form');field.value='Fixture reply';field.dispatchEvent(new m.w.Event('input'));
 assert.equal(m.calls.filter(c=>c.options.method==='POST').length,0);
 form.dispatchEvent(new m.w.Event('submit',{cancelable:true}));await pause();form.dispatchEvent(new m.w.Event('submit',{cancelable:true}));await pause();
 assert.equal(m.calls.filter(c=>c.options.method==='POST').length,1);
 const post=m.calls.find(c=>c.options.method==='POST');assert.match(post.url,/browser-reply$/);assert.equal(JSON.parse(post.options.body).source,'turo');
 }finally{m.close();}
});
const browserDesk=require('./desk-browser');
function replyDatabase(){
 const claims=new Map(),events=[];
 return {events,claims,query:async(sql,args=[])=>{
 events.push(sql);
 if(sql.includes('FROM core.workspace'))return {rows:[{databaseSchema:'workspace_fixture'}]};
 if(sql.startsWith('SELECT source'))return {rows:[{source:'turo',payload:{threads:[{id:'thread-1',name:'Fixture guest',threadUrl:'https://turo.com/us/en/host/inbox/thread-1'}]}}]};
 if(sql.startsWith('INSERT INTO')){if(claims.has(args[0]))return {rows:[]};claims.set(args[0],'unknown');return {rows:[{request_id:args[0]}]};}
 if(sql.startsWith('UPDATE'))claims.set(args[0],args[1]);
 if(sql.startsWith('SELECT status'))return {rows:[{status:claims.get(args[0])}]};
 return {rows:[]};
 }};
}
const replyInput={company:'AniDeeBee',source:'turo',id:'thread-1',text:'Fixture reply',requestId:'00000000-0000-4000-8000-000000000001'};
test('durable send claim precedes browser call; duplicate request cannot send again',async()=>{
 const db=replyDatabase();let sends=0;
 const transport=async()=>{sends++;assert.equal(db.claims.get(replyInput.requestId),'unknown');return {status:'sent',message:'Sent'};};
 assert.equal((await browserDesk.reply(db,replyInput,transport)).status,'sent');
 assert.equal((await browserDesk.reply(db,replyInput,transport)).status,'sent');assert.equal(sends,1);
});
test('ambiguous browser failure stays unknown and is never replayed',async()=>{
 const db=replyDatabase();let sends=0;const transport=async()=>{sends++;throw Error('Connection ended');};
 assert.equal((await browserDesk.reply(db,replyInput,transport)).status,'unknown');
 await browserDesk.reply(db,replyInput,transport);assert.equal(sends,1);
});
test('other company and unconnected thread cannot invoke browser send',async()=>{
 const db=replyDatabase();const transport=()=>{throw Error('Must not send');};
 await assert.rejects(browserDesk.reply(db,{...replyInput,company:'Kiosk X'},transport));
 assert.equal((await browserDesk.reply(db,{...replyInput,id:'absent'},transport)).status,'not_sent');assert.equal(db.claims.size,0);
});
test('browser is enabled by default; explicit operator pause remains configurable',async()=>{
 let reads=0;const transport=async()=>{reads++;return {ok:true,json:async()=>({jobs:[]})};};
 await browserDesk.request('read',{source:'indeed'},{},transport);assert.equal(reads,1);
 await assert.rejects(browserDesk.request('read',{source:'indeed'},{DESK_BROWSER_ENABLED:'false'},transport));assert.equal(reads,1);
});

for(const width of [1440,390,375])test(`signed-in company first paint at ${width} contains exact candidate and trip identities`,async()=>{
 const m=await mount(width);try{
  const overview=m.d.querySelector('[aria-label="Indeed and Turo conversations"]');assert.ok(overview);
  for(const id of ['5fe434c2fb5a','2500e6671d40','95ab7507c35c','cd8dbb747410','f36cc544ea2e','47b26f49a7b9','63056209'])assert.ok(overview.querySelector(`[data-thread-id="${id}"]`));
  overview.querySelector('[data-thread-id="63056209"]').click();
  assert.equal(overview.querySelector('.sd-source-thread').dataset.threadUrl,'https://turo.com/us/en/inbox/messages/thread/63056209');
  assert.equal(m.calls.filter(c=>c.options.method==='POST').length,0);
  assert.ok(overview.querySelector('textarea'));assert.equal(overview.querySelector('.sd-fleet-send').textContent,'Send');
 }finally{m.close();}
});
test('Svetozar click reaches the exact stored URL and not_sent is never shown as sent',async()=>{
 const m=await mount(390),db=replyDatabase();let browserCalls=0;
 const query=db.query;db.query=async(sql,args)=>sql.startsWith('SELECT source')?{rows:[{source:'turo',payload:seed.turo}]}:query(sql,args);
 m.w.fetch=async(url,options)=>({ok:true,json:async()=>browserDesk.reply(db,JSON.parse(options.body),async(action,body)=>{
  browserCalls++;assert.equal(action,'send');assert.equal(body.threadUrl,'https://turo.com/us/en/inbox/messages/thread/63056209');return {status:'not_sent',message:'Source sign-in unavailable.'};
 })});
 try{
  m.d.querySelector('[data-thread-id="63056209"]').click();const section=m.d.querySelector('.sd-source-thread');
  const field=section.querySelector('textarea');field.value='Test transport only';field.dispatchEvent(new m.w.Event('input'));
  assert.equal(browserCalls,0);section.querySelector('.sd-fleet-send').click();await pause();assert.equal(browserCalls,1);
  assert.equal(section.querySelector('[data-status]').dataset.status,'not_sent');assert.match(section.textContent,/Not sent/);assert.equal(field.value,'Test transport only');
  section.querySelector('.sd-fleet-send').click();await pause();assert.equal(browserCalls,1);
 }finally{m.close();}
});
test('known person without a thread URL remains not_sent without a browser call',async()=>{
 const db=replyDatabase(),query=db.query;db.query=async(sql,args)=>sql.startsWith('SELECT source')?{rows:[{source:'turo',payload:seed.turo}]}:query(sql,args);
 let calls=0;const result=await browserDesk.reply(db,{...replyInput,id:'snapshot:7'},async()=>{calls++;return {status:'sent'};});
 assert.equal(result.status,'not_sent');assert.equal(calls,0);
});
test('confirmed seed upgrades legacy rows once, retaining other threads and read timestamps',async()=>{
 let payload=JSON.parse(JSON.stringify(seed.turo));delete payload.evidenceVersion;
 for(const row of payload.threads){if(row.legacyId){row.id=row.legacyId;delete row.threadUrl;delete row.legacyId;}}
 const calls=[];const db={query:async(sql,args)=>{calls.push(sql);if(sql.startsWith('SELECT payload'))return {rows:[{payload}]};if(sql.startsWith('UPDATE'))payload=args[2];return {rows:[]};}};
 await store.seed(db,'workspace_fixture','turo',seed.turo);
 assert.equal(payload.threads.length,14);assert.equal(payload.threads.find(r=>r.name==='Svetozar').id,'63056209');
 assert.ok(payload.threads.find(r=>r.name==='Aadil'));
 const updates=calls.filter(s=>s.startsWith('UPDATE'));assert.equal(updates.length,1);assert.ok(!updates[0].includes('read_at'));
 await store.seed(db,'workspace_fixture','turo',seed.turo);assert.equal(calls.filter(s=>s.startsWith('UPDATE')).length,1);
 const refreshed=store.merge(payload,{threads:[{id:'63056209',threadUrl:null,line:'Updated preview'}]});assert.equal(refreshed.threads.find(r=>r.id==='63056209').threadUrl,seed.turo.threads[4].threadUrl);
});
test('public desk script contains no private seed records',()=>{
 const script=fs.readFileSync(__dirname+'/kioskx-desk-queues.js','utf8');
 for(const name of [...expected,'Svetozar'])assert.ok(!script.includes(name));
 for(const row of seed.indeed.candidates)assert.ok(!script.includes(row.id));
});
test('browser worker accepts confirmed candidate pages and only exact Turo thread paths',()=>{
 const {execFileSync}=require('node:child_process');
 const code=`import ast, re\nfrom urllib.parse import urlparse, parse_qs\np=ast.parse(open('kioskx-cream-desk/desk-browser-worker.py').read())\nn=ast.Module(body=[x for x in p.body if isinstance(x,ast.FunctionDef) and x.name in ['allowed','conversation_url']],type_ignores=[])\nexec(compile(n,'worker','exec'))\nassert conversation_url('indeed','https://employers.indeed.com/candidates/view?id=5fe434c2fb5a')\nassert not conversation_url('indeed','https://employers.indeed.com/candidates/view?id=5fe434c2fb5a&listQuery=private')\nassert conversation_url('turo','https://turo.com/us/en/inbox/messages/thread/63056209')\nassert not conversation_url('turo','https://turo.com/us/en/host/vehicles')\nassert not conversation_url('turo','https://turo.com.evil.test/us/en/inbox/messages/thread/63056209')\n`;
 execFileSync('python3',['-c',code]);
});
