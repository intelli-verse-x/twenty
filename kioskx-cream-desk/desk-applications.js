const fs=require('node:fs');
// Load the production mailbox client only when an upstream read is needed.
const company={client:()=>require('./desk-company').client()};
async function stored(path='/applications',request=fetch){const token=fs.readFileSync('/var/run/desk-applications/token','utf8').trim();const r=await request('http://anideebee-desk-applications:8081'+path,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();return r;}
function application(r){return {id:r.id,label:r.name||'Applicant',queue:'jobs',summary:r.role||'Job application',service:r.role||'',email:r.email||'',phone:r.phone||'',when:r.createdAt,description:r.experience||'',fields:[['Role',r.role],['Experience',r.experience]].filter(([,v])=>v),resume:r.resume?{name:r.resume.filename,path:'application-resume?company=AniDeeBee&id='+encodeURIComponent(r.id)}:null,status:'New',draft:'',note:''};}
function indeedRow(conversation,m){
 const email=m.content_attributes?.email||{},sender=String(email.from?.[0]?.email||email.from?.email||conversation.meta?.sender?.email||'');
 const text=String(m.content||'');
 if(!/(^|@|\.)(?:indeed\.com|indeedemail\.com)$/i.test(sender)||!/(applied|application|applicant|candidate)/i.test(text))return null;
 const field=label=>text.match(new RegExp('(?:^|\\n)'+label+'\\s*[:：]\\s*([^\\n]+)','i'))?.[1]?.trim()||'';
 const name=field('(?:Applicant(?: name)?|Candidate(?: name)?|Name)')||text.match(/^(.{2,100}?)\s+(?:has )?applied\b/im)?.[1];
 if(!name)return null;
 if(isTestRecord(name,field('Experience')||field('Message')))return null;
 const role=field('(?:Role|Job(?: title)?|Position)')||text.match(/applied (?:to|for) (?:the |your )?(.+?) position posted on Indeed/i)?.[1]||text.match(/applied (?:to|for) (?:your )?([^\n]+)/i)?.[1]||'Job application';
 const r=application({id:'indeed:'+conversation.id,name,role,email:field('Email'),phone:field('Phone'),experience:field('Experience')||field('Message')||'Not provided in the application email.',createdAt:Number.isFinite(Number(m.created_at))?new Date(Number(m.created_at)*1000).toISOString():null});
 const attachment=(m.attachments||[]).find(a=>[a.data_url,a.file_name,a.filename,a.extension].some(v=>/(?:\.|^)(pdf|docx)(?:\?|$)/i.test(v||'')));
 if(attachment){try{const url=new URL(attachment.data_url);if(url.protocol==='https:')r.resume={name:'Resume',url:url.href};}catch{}}
 return r;
}
// Match the desk's explicit synthetic rule, only against applicant fields.
// A role or job description mentioning a test is not an applicant test marker.
function isTestRecord(name, message='') {
 return /synthetic|not\s+a\s+candidate|not\s+a\s+real|please\s+discard|form\s+check|test\s+applicant/i.test(`${name||''} ${message||''}`)||
  /^TTTT$/i.test(String(name||'').trim())||/^(?:test\s*)+$/i.test(String(message||'').trim());
}
async function concurrent(items, work, width=6) {
 let next=0;
 await Promise.all(Array.from({length:Math.min(width,items.length)},async()=>{
  while(next<items.length)await work(items[next++]);
 }));
}
async function indeed(api, progress=()=>{}) {
 const client=api||await company.client(), rows=new Map(), seen=new Set();
 let incomplete=false;
 async function scan(conversations) {
  await concurrent(conversations,async c=>{
   if(Number(c.inbox?.id||c.inbox_id)!==3||seen.has(c.id))return;
   seen.add(c.id);
   try {
    const path='/api/v1/accounts/1/conversations/'+c.id;
    const full=await client(path);
    if(Number(full.inbox_id)!==3)return;
    let before='', previous='';
    for(let page=0;page<200;page++) {
     const messages=await client(path+'/messages'+(before?'?before='+encodeURIComponent(before):''));
     if(!Array.isArray(messages.payload))throw Error('Indeed unavailable');
     for(const m of messages.payload) {
      if(m.private||m.message_type!==0)continue;
      const row=indeedRow(full,m);
      if(row&&!rows.has(row.id))rows.set(row.id,row);
     }
     progress([...rows.values()]);
     if(messages.payload.length<20)return;
     before=String(Math.min(...messages.payload.map(m=>Number(m.id))));
     if(!/^\d+$/.test(before)||before===previous)throw Error('Indeed pagination unavailable');
     previous=before;
    }
    incomplete=true;
   } catch { incomplete=true; }
  });
 }
 let searchComplete=false;
 try {
  for(let page=1;page<=1000;page++) {
   const data=await client('/api/v1/accounts/1/search/conversations?q=indeed&page='+page);
   const conversations=data.payload?.conversations;
   if(!Array.isArray(conversations))throw Error('Indeed search unavailable');
   await scan(conversations);
   if(conversations.length<15){searchComplete=true;break;}
  }
 } catch { /* Search may be unavailable; read the actual company inbox below. */ }
 // Search is not proof of an empty source. Walk the mailbox when it yields no
 // applications, or fails, without ever reading another company's threads.
 if(!searchComplete||!rows.size) {
  let complete=false;
  for(let page=1;page<=1000;page++) {
   const data=await client('/api/v1/accounts/1/conversations?inbox_id=3&status=all&assignee_type=all&page='+page);
   const conversations=data.data?.payload;
   if(!Array.isArray(conversations))throw Error('Indeed mailbox unavailable');
   await scan(conversations);
   if(!conversations.length){complete=true;break;}
  }
  if(!complete)incomplete=true;
 }
 if(incomplete)throw Error('Indeed read incomplete');
 return [...rows.values()];
}
// The first HTTP response never waits for a whole mailbox scan. Concurrent desk
// viewers share one bounded scan; polling receives rows as pages finish.
function createIndeedSource(load=indeed, now=Date.now) {
 let state={applications:[],loading:false,unavailable:false},until=0,pending;
 return function snapshot() {
  if(!pending&&now()>=until) {
   state={...state,loading:true,unavailable:false};
   pending=Promise.resolve().then(()=>load(undefined,rows=>{state={...state,applications:rows};}))
    .then(rows=>{state={applications:rows,loading:false,unavailable:rows.length===0};until=now()+60000;})
    .catch(()=>{state={...state,loading:false,unavailable:true};until=now()+15000;})
    .finally(()=>{pending=null;});
  }
  return {...state};
 };
}
const indeedSource=createIndeedSource();
async function read(input,deps={}) {
 if(input.company!=='AniDeeBee')return {applications:[]};
 if(input.source==='indeed')return (deps.source||indeedSource)();
 // Saved records have their own request, unaffected by mailbox latency.
 let saved=[],unavailable=false;
 try {
  const d=await (deps.stored||stored)().then(r=>r.json());
  saved=d.applications.filter(r=>!isTestRecord(r.name,r.experience)).map(application);
 } catch { unavailable=true; }
 if(input.source==='saved')return {applications:saved,unavailable};
 // Compatibility for older desk assets while the rollout replaces the client.
 let source;
 if(deps.indeed){try{source={applications:await deps.indeed()};}catch{source={applications:[],unavailable:true};}}
 else source=indeedSource();
 return {...source,applications:[...saved,...source.applications],unavailable:unavailable||!!source.unavailable};
}
module.exports={stored,application,indeedRow,indeed,read,isTestRecord,createIndeedSource};
