const fs=require('node:fs');
const company=require('./desk-company');
async function stored(path='/applications',request=fetch){const token=fs.readFileSync('/var/run/desk-applications/token','utf8').trim();const r=await request('http://anideebee-desk-applications:8081'+path,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();return r;}
function application(r){return {id:r.id,label:r.name||'Applicant',queue:'jobs',summary:r.role||'Job application',service:r.role||'',email:r.email||'',phone:r.phone||'',when:r.createdAt,description:r.experience||'',fields:[['Role',r.role],['Experience',r.experience]].filter(([,v])=>v),resume:r.resume?{name:r.resume.filename,path:'application-resume?company=AniDeeBee&id='+encodeURIComponent(r.id)}:null,status:'New',draft:'',note:''};}
function indeedRow(conversation,m){
 const email=m.content_attributes?.email||{},sender=String(email.from?.[0]?.email||email.from?.email||conversation.meta?.sender?.email||'');
 const text=String(m.content||'');
 if(!/(^|@|\.)(?:indeed\.com|indeedemail\.com)$/i.test(sender)||!/(applied|application|applicant|candidate)/i.test(text))return null;
 const field=label=>text.match(new RegExp('(?:^|\\n)'+label+'\\s*[:：]\\s*([^\\n]+)','i'))?.[1]?.trim()||'';
 const name=field('(?:Applicant(?: name)?|Candidate(?: name)?|Name)')||text.match(/^(.{2,100}?)\s+(?:has )?applied\b/im)?.[1];
 if(!name)return null;
 const role=field('(?:Role|Job(?: title)?|Position)')||text.match(/applied (?:to|for) (?:the |your )?(.+?) position posted on Indeed/i)?.[1]||text.match(/applied (?:to|for) (?:your )?([^\n]+)/i)?.[1]||'Job application';
 const r=application({id:'indeed:'+conversation.id,name,role,email:field('Email'),phone:field('Phone'),experience:field('Experience')||field('Message')||'Not provided in the application email.',createdAt:new Date(Number(m.created_at)*1000).toISOString()});
 const attachment=(m.attachments||[]).find(a=>[a.data_url,a.file_name,a.filename,a.extension].some(v=>/(?:\.|^)(pdf|docx)(?:\?|$)/i.test(v||'')));
 if(attachment){try{const url=new URL(attachment.data_url);if(url.protocol==='https:')r.resume={name:'Resume',url:url.href};}catch{}}
 return r;
}
let cached=null,until=0;
async function indeed(api){if(!api&&cached&&until>Date.now())return cached;const client=api||await company.client();const rows=[];
 for(let page=1;page<=100;page++){
  const data=await client('/api/v1/accounts/1/search/conversations?q=indeed&page='+page);const conversations=data.payload?.conversations;if(!Array.isArray(conversations))throw Error();
  for(const c of conversations){if(Number(c.inbox?.id)!==3)continue;
   const full=await client('/api/v1/accounts/1/conversations/'+c.id);if(Number(full.inbox_id)!==3)continue;
   const messages=await client('/api/v1/accounts/1/conversations/'+c.id+'/messages');for(const m of messages.payload||[]){if(m.private||m.message_type!==0)continue;const row=indeedRow(full,m);if(row&&!rows.some(r=>r.id===row.id))rows.push(row);}}
  if(conversations.length<15)break;
 }

 if(!api){cached=rows;until=Date.now()+60000;}return rows;
}
async function read(input,deps={}){if(input.company!=='AniDeeBee')return {applications:[]};const results=await Promise.allSettled([(deps.stored||stored)().then(r=>r.json()).then(d=>d.applications.filter(r=>!(/synthetic|not\s+a\s+candidate|not\s+a\s+real|please\s+discard|form\s+check|test\s+applicant/i.test((r.name||'')+' '+(r.experience||''))||/^TTTT$/i.test(r.name||'')||/^(?:test\s*)+$/i.test((r.experience||'').trim()))).map(application)),(deps.indeed||indeed)()]);return {applications:results.flatMap(r=>r.status==='fulfilled'?r.value:[]),unavailable:results.some(r=>r.status==='rejected')};}
module.exports={stored,application,indeedRow,indeed,read};
