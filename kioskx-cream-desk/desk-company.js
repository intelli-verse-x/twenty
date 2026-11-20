// Company boundaries are enforced on the server; no upstream credentials reach the page.
const crypto = require('node:crypto');
const markdown = require('markdown-it')({html:false,linkify:true,breaks:true});
const {refreshMail} = require('./desk-mail-fetch');
const reach = require('./reach');
const DESKS = {
 'Kiosk X': {app:'kioskx',mail:'support@kiosk-x.ai',account:1,inbox:101},
 'AniDeeBee': {app:'anideebee',mail:'support@anideebee.com',account:1,inbox:3},
 'QuizVerse': {app:'quizverse',mail:'support@quizverse.world',account:1,inbox:2},
 'QuestX': {app:'questx',mail:'support@quest-x.ai',account:1,inbox:103},
 'ContentX Studio': {app:'contentx',mail:'support@content-x.ai',account:1,inbox:102},
 'IntelliVerse X': {app:'intelliverse',mail:'support@intelli-verse-x.ai',account:1,inbox:100},
 'ToBa Tech': {app:'toba',mail:'pallavi@toba-tech.ai',account:34,inbox:36}
};
const deskFor = company => Object.hasOwn(DESKS,company||'') ? DESKS[company] : null;
const mask = value => String(value||'').replace(/[^\s<>()[\],;:]+@[^\s<>()[\],;:]+/g,'[contact hidden]').replace(/\+?\d[\d ().-]{6,}\d/g,'[contact hidden]');
const safeText = (company,value) => company==='Kiosk X'?mask(value):String(value||'');
async function client(env=process.env,request=fetch) {
 const base = new URL(env.CHATWOOT_API_URL);
 if(base.protocol!=='https:'||!env.CHATWOOT_PLATFORM_TOKEN) throw Error('Unavailable');
 const user=await request(new URL('/platform/api/v1/users/1',base),{headers:{api_access_token:env.CHATWOOT_PLATFORM_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!user.ok)throw Error('Unavailable');
 const token=(await user.json()).access_token;
 if(!token)throw Error('Unavailable');
 return async(path,body)=>{
  const r=await request(new URL(path,base),{method:body?'POST':'GET',headers:{api_access_token:token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok){const error=Error('Unavailable');error.httpStatus=r.status;throw error;}
  return r.json();
 };
}
const positive = v => /^[1-9]\d{0,10}$/.test(String(v||''));
async function conversation(api,desk,id) {
 if(!positive(id))throw Error('Unavailable');
 const path=`/api/v1/accounts/${desk.account}/conversations/${id}`;
 const row=await api(path);
 if(Number(row.inbox_id)!==desk.inbox)throw Error('Unavailable');
 return {row,path};
}
function messageDTO(company,m) {
 const email=m.content_attributes?.email;
 const stored=email?.html_content?.full||email?.html_content?.reply;
 const text=String(m.content||'').replace(/^View image:\s*\((https?:\/\/[^\s)]+)\)\s*$/gm,'![Email image]($1)');
 // Kiosk inquiries retain their masked plain-text boundary. Email HTML is sanitized by the renderer.
 const html=company==='Kiosk X'?'':stored||markdown.render(text);
 return {id:m.id,html,text:safeText(company,m.content||''),direction:m.message_type===0?'received':'sent',time:m.created_at,status:m.status||'',attachments:(m.attachments||[]).length};
}
async function mailRead(input, deps={}) {
 const desk=deskFor(input.company);
 const failed={unavailable:true,message:'Mail is unavailable. Try refreshing.'};
 if(!desk)return failed;
 try {
  const api=deps.api||await client();
  if(input.conversation){
   const {row,path}=await conversation(api,desk,input.conversation);
   const before=positive(input.before)?'&before='+input.before:'';
   const data=await api(path+'/messages?'+before.slice(1));
   const source=Array.isArray(data.payload)?data.payload:[];
   return {id:row.id,status:row.status,messages:source.filter(m=>!m.private&&[0,1].includes(m.message_type)).map(m=>messageDTO(input.company,m)),older:source.length>=20?source[0]?.id:null};
  }
  const sync=input.refresh==='1'?await (deps.refresh||refreshMail)(desk,api):null;
  const page=positive(input.page)?Number(input.page):1;
  const data=await api(`/api/v1/accounts/${desk.account}/conversations?inbox_id=${desk.inbox}&status=all&assignee_type=all&page=${page}`);
  if(!Array.isArray(data.data?.payload))return failed;
  const source=data.data.payload;
  return {sync,company:input.company,mailbox:desk.mail,page,more:source.length>=20,conversations:source.filter(r=>Number(r.inbox_id)===desk.inbox).map(r=>({id:r.id,name:input.company==='Kiosk X'?'Kiosk inquiry':String(r.meta?.sender?.name||'Customer'),subject:safeText(input.company,r.additional_attributes?.mail_subject||r.messages?.[0]?.content_attributes?.email?.subject||''),sender:input.company==='Kiosk X'?'Kiosk inquiry':String(r.meta?.sender?.email||r.meta?.sender?.name||'Unknown sender'),status:r.status,preview:safeText(input.company,r.messages?.[0]?.content||'Open conversation'),time:r.last_activity_at}))};
 }catch{return failed;}
}
// Uses the existing durable work ledger. An ambiguous upstream POST is never replayed.
async function once(repo,id,body,send) {
 const key=crypto.createHash('sha256').update(JSON.stringify([id,body])).digest('hex');
 const prior=(await repo.thread(id)).find(x=>x.key===key);
 if(prior)return {status:prior.status,message:prior.message};
 if(!await repo.claim(id,key,'email',body))return {status:'pending',message:'Already submitted. Refresh before doing anything else.'};
 let result;
 try{result=await send();}catch(error){result=error.httpStatus>=400&&error.httpStatus<500&&error.httpStatus!==408?{status:'failed',message:'Reply was not sent. The mailbox rejected it; your draft is kept.'}:{status:'unknown',message:'Delivery is unconfirmed. Do not resend.'};}
 await repo.finish(key,{leadId:id,key,kind:'email',...result});
 return result;
}
async function mailReply(input,deps={}) {
 const desk=deskFor(input?.company);
 if(!desk||typeof input.text!=='string'||!input.text.trim()||input.text.length>10000)return {status:'blocked',message:'Write a reply first.'};
 try{
  const api=deps.api||await client();
  const {path}=await conversation(api,desk,input.conversation);
  const work=async repo=>once(repo,`mail:${desk.account}:${desk.inbox}:${input.conversation}`,input.text,async()=>{
   const result=await api(path+'/messages',{content:input.text,message_type:'outgoing',private:false});
   return result.status==='failed'?{status:'failed',message:'Reply was not sent. Your draft is kept.'}:result.id?{status:'accepted',message:'Reply queued in this mailbox.'}:{status:'unknown',message:'Delivery is unconfirmed. Do not resend.'};
  });
  return deps.repo?work(deps.repo):reach.withStore(work);
 }catch{return {status:'unavailable',message:'Reply was not sent. Refresh the thread and try again.'};}
}
module.exports={DESKS,mailRead,mailReply,once,client,...require('./desk-engagement')({deskFor,once})};
