// Adapters only: existing Mail Studio, Router, Firecrawl, n8n and Telnyx flows.
const crypto=require('node:crypto');
const dns=require('node:dns/promises');
const net=require('node:net');
const {parsePhoneNumberFromString}=require('libphonenumber-js');
const reach=require('./reach');
const REGISTRY=new Set(['quizverse','questx','intelliverse','toba','contentx','foundrly','kioskx']);
const emailOK=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value||'');
const redacted=value=>String(value||'').replace(/https?:\/\/\S+/gi,'[link hidden]').replace(/[^\s<>]+@[^\s<>]+/g,'[contact hidden]').replace(/\+?\d[\d ().-]{6,}\d/g,'[contact hidden]').slice(0,240);
const phoneFor=value=>parsePhoneNumberFromString(String(value||''),'US');
const allowedPhone=value=>{const p=phoneFor(value);return !!p?.isValid()&&['US','CA'].includes(p.country);};
async function jsonRequest(url,options,request){const r=await request(url,{redirect:'error',signal:AbortSignal.timeout(8000),...options});if(!r.ok){const e=Error('Service rejected request');e.httpStatus=r.status;throw e;}return r.json();}
async function mailCatalog(desk,deps={}){
 const env=deps.env||process.env,request=deps.request||fetch;
 const unavailable=message=>({templates:[],message});
 if(!env.DESK_MAIL_API_TOKEN)return unavailable('Mail Studio is not connected for this company.');
 const workspace=env.DESK_MAIL_WORKSPACE||'intelliversex';
 const base=env.DESK_MAIL_API_BASE||'http://notifuse.intelliverse-x.svc.cluster.local';
 const read=path=>jsonRequest(base+'/api/'+path,{headers:{Authorization:'Bearer '+env.DESK_MAIL_API_TOKEN}},request);
 try{
  const [raw,listed,definitions]=await Promise.all([read('workspaces.get?id='+encodeURIComponent(workspace)),read('templates.list?workspace_id='+encodeURIComponent(workspace)),read('transactional.list?workspace_id='+encodeURIComponent(workspace))]);
  const w=raw.workspace||raw;
  // Transactional sends use the workspace's configured transactional provider.
  const provider=(w.integrations||[]).find(i=>i.id===w.settings?.transactional_email_provider_id);
  const senders=new Set((provider?.email_provider?.senders||[]).filter(s=>String(s.email).toLowerCase()===desk.mail.toLowerCase()).map(s=>s.id));
  if(!senders.size)return unavailable('Mail Studio has no sender for '+desk.mail+'. Email is unavailable.');
  const templates=(listed.templates||[]).filter(t=>t.channel==='email'&&senders.has(t.email?.sender_id)).map(t=>{
   const notification=(definitions.notifications||[]).find(n=>n.channels?.email?.template_id===t.id);
   return {id:t.id,name:String(t.name||t.id).slice(0,160),subject:String(t.email?.subject||'').slice(0,240),notification:notification?.id||null,version:t.version,available:!!notification,reason:notification?'':'This template has no single-recipient send configured in Mail Studio.'};
  });
  return {workspace,templates,message:templates.length?'Email sends from '+desk.mail+'.':'Mail Studio has no templates for this company.'};
 }catch{return unavailable('Mail Studio could not load templates for this company. No email has been sent.');}
}
async function gojiberry(desk,company,deps={}){
 if(!REGISTRY.has(desk.app))return {status:'not_provisioned',statusReason:'Gojiberry is not provisioned for '+company+'.',deliveries:[]};
 const env=deps.env||process.env,request=deps.request||fetch;
 const fallback={status:'not_configured',statusReason:'Router admin contract is not configured.',deliveries:[]};
 const token=env.ROUTER_ADMIN_SERVICE_TOKEN,base=env.ROUTER_GOJIBERRY_ADMIN_API_BASE,origin=env.ADMIN_PORTAL_PUBLIC_ORIGIN;
 if(!token||token.length<32||base!=='https://router.intelli-verse-x.ai/api/admin/integrations/gojiberry'||origin!=='https://admin.intelli-verse-x.ai')return fallback;
 const url=new URL(base);url.searchParams.set('experienceId',desk.app);
 const timestamp=String(Math.floor(Date.now()/1000)),requestId=crypto.randomUUID(),actor=(env.KIOSKX_HIRED_EMAIL||'support@kiosk-x.ai').trim().toLowerCase();
 const canonical=[timestamp,'GET',url.pathname,actor,desk.app,requestId,'',crypto.createHash('sha256').update('').digest('hex'),origin].join('\n');
 try{
  const r=await request(url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json',Authorization:'Bearer '+token,'X-Portal-Actor':actor,'X-Portal-Experience':desk.app,'X-Portal-Origin':origin,'X-Portal-Timestamp':timestamp,'X-Portal-Signature':'v1='+crypto.createHmac('sha256',token).update(canonical).digest('hex'),'X-Contract-Version':'2026-07-18','X-Request-Id':requestId}});
  if([404,501,503].includes(r.status))return {...fallback,statusReason:'Setup required: Router access or Experience scope is not provisioned.'};
  if(!r.ok)return {...fallback,status:'degraded',statusReason:'Router status is temporarily unavailable. No setup state was changed.'};
  const d=await r.json();
  return {status:['not_configured','waiting_provider_test','ready','receiving','degraded','disabled'].includes(d.status)?d.status:'not_configured',statusReason:redacted(d.statusReason||fallback.statusReason),deliveries:(Array.isArray(d.deliveries)?d.deliveries:[]).slice(0,50).map(r=>({eventType:['contact.created','lead.created','reply.received'].includes(r.eventType)?r.eventType:'unknown',time:Number.isFinite(Date.parse(r.receivedAt))?new Date(r.receivedAt).toISOString():null,status:['accepted','processing','delivered','failed','dead_letter','quarantined','deleted'].includes(r.status)?r.status:'unknown'}))};
 }catch{return {...fallback,status:'degraded',statusReason:'Router status is temporarily unavailable. No setup state was changed.'};}
}
async function readSite(input,deps={}){
 const env=deps.env||process.env;
 if(!env.DESK_FIRECRAWL_TOKEN)return {unavailable:true,message:'Site reading is not connected.'};
 try{
  const url=new URL(input.website);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||net.isIP(url.hostname)||/\[|localhost|\.(local|internal|test|invalid)$/i.test(url.hostname))throw Error();
  const addresses=await (deps.lookup||dns.lookup)(url.hostname,{all:true});
  if(!addresses.length||addresses.some(({address:a})=>a.includes(':')?!/^[23]/.test(a):/^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])|198\.(18|19)|22[4-9]|23\d|24\d|25[0-5])\./.test(a)))throw Error();
  const d=await jsonRequest((env.DESK_FIRECRAWL_BASE||'https://api.firecrawl.dev')+'/v1/scrape',{method:'POST',headers:{Authorization:'Bearer '+env.DESK_FIRECRAWL_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({url:url.href,formats:['markdown'],onlyMainContent:true}),signal:AbortSignal.timeout(15000)},deps.request||fetch);
  const summary=String(d.data?.markdown||'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[#*_`>|]/g,'').replace(/\s+/g,' ').trim().slice(0,700);
  return summary?{summary:input.company==='Kiosk X'?redacted(summary):summary,message:'Summary from this page only.'}:{unavailable:true,message:'No readable page content was returned.'};
 }catch{return {unavailable:true,message:'This site could not be read. Use a public website address and try again.'};}
}
module.exports=({deskFor,once})=>{
 function validateLead(input){
  const desk=deskFor(input?.company);if(!desk)return 'Choose a company.';
  if(!['lead','email','sms'].includes(input.kind))return 'Choose an action.';
  if(input.kind==='lead'&&desk.app==='contentx')return 'ContentX has no app mapping in the live n8n lead workflow.';
  if(['lead','email'].includes(input.kind)&&!emailOK(input.email))return 'Enter a valid email.';
  if(input.kind==='email'&&(!input.emailConsent||typeof input.template!=='string'||!input.template))return 'Choose a template and confirm consent to email.';
  if(input.kind==='sms'&&(!allowedPhone(input.phone)||!input.smsConsent))return 'A valid US or Canada number and consent to SMS are required. India numbers are blocked.';
  if(input.kind==='sms'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>1600))return 'Write a text message, up to 1600 characters.';
  if(String(input.name||'').length>200||String(input.phone||'').length>40)return 'Contact details are too long.';
  return '';
 }
 async function engagementState(company,deps={}){const desk=deskFor(company);if(!desk)return {unavailable:true};const env=deps.env||process.env;const [mail,router]=await Promise.all([mailCatalog(desk,deps),gojiberry(desk,company,deps)]);return {app:desk.app,lead:desk.app!=='contentx',sms:!!env.TELNYX_TOKEN,mail:{message:mail.message,templates:mail.templates.map(({notification,version,...t})=>t)},gojiberry:router,site:!!env.DESK_FIRECRAWL_TOKEN};}
 async function engagementSend(input,deps={}){
  const error=validateLead(input);if(error)return {status:'blocked',message:error};
  const desk=deskFor(input.company),env=deps.env||process.env,request=deps.request||fetch;
  let url,headers={'Content-Type':'application/json'},payload;
  if(input.kind==='email'){
   const catalog=await mailCatalog(desk,deps),template=catalog.templates.find(t=>t.id===input.template&&t.available);
   if(!template)return {status:'blocked',message:catalog.message+' Choose an available template; no email was sent.'};
   url=(env.DESK_MAIL_API_BASE||'http://notifuse.intelliverse-x.svc.cluster.local')+'/api/transactional.send';headers.Authorization='Bearer '+env.DESK_MAIL_API_TOKEN;
   payload={workspace_id:catalog.workspace,notification:{id:template.notification,contact:{email:input.email,first_name:input.name||''},channels:['email'],data:{name:input.name||''}}};
  }else if(input.kind==='sms'){
   if(!env.TELNYX_TOKEN)return {status:'unavailable',message:'Text sending is unavailable.'};
   url='https://api.telnyx.com/v2/messages';headers.Authorization='Bearer '+env.TELNYX_TOKEN;
   payload={from:'+18337512480',to:phoneFor(input.phone).number,text:input.company+': '+input.text};
  }else{
   url='https://n8n.intelli-verse-x.ai/webhook/hello-app-id';payload={app_id:desk.app,name:input.name||'',email:input.email,phone:input.phone||'',consent:{email:false,sms:false},source:'support-desk'};
  }
  const work=repo=>once(repo,`engagement:${desk.app}:${input.kind}`,JSON.stringify(payload),async()=>{
   const result=await jsonRequest(url,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)},request);
   if(input.kind==='sms')return result.data?.id?{status:'accepted',message:'Text accepted by Telnyx. Delivery is pending.'}:{status:'unknown',message:'Text delivery is unconfirmed. Do not resend.'};
   if(input.kind==='email')return result.success===true||result.id||result.message_id?{status:'accepted',message:'Email accepted by Mail Studio. Delivery is pending.'}:{status:'unknown',message:'Email delivery is unconfirmed. Do not resend.'};
   return result.ok&&result.twenty?.person_id?{status:'accepted',message:'Lead saved to this company’s CRM through n8n. No email was sent.'}:{status:'unknown',message:'Lead submission is unconfirmed. Do not resend.'};
  });
  try{const result=deps.repo?await work(deps.repo):await reach.withStore(work);return result.status==='failed'?{...result,message:'The service rejected this submission. Nothing was sent.'}:result;}catch{return {status:'unavailable',message:'Submission is unavailable. Refresh before trying again.'};}
 }
 return {engagementState,engagementSend,validateLead,readSite:async(input,deps)=>deskFor(input?.company)?readSite(input,deps):{unavailable:true,message:'Choose a company.'}};
};
module.exports.mailCatalog=mailCatalog;module.exports.gojiberry=gojiberry;
