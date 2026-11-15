const crypto = require('node:crypto');
const {Client} = require('pg');
const {parsePhoneNumberFromString} = require('libphonenumber-js');
const labels = {cleaning:'Cleaning request',cars:'Cars request',jobs:'Jobs request',kiosk:'Kiosk inquiry'};
const message = {email:'Email sent',sms:'Text sent',call:'Call queued on Google Voice.'};
const failure = {email:'Email was not sent.',sms:'Text was not sent.',call:'Call was not queued.'};
const sender = () => process.env.TELNYX_FROM_NUMBER || process.env.KIOSKX_VOICE_FROM_NUMBER || '';
const capabilities = () => ({mailEnabled:process.env.KIOSKX_HIRED_EMAIL === 'true', smsEnabled:!!sender() && !!process.env.TELNYX_TOKEN});
const phone = value => parsePhoneNumberFromString(value || '', 'US');
const cookie = id => id + '.' + crypto.createHmac('sha256', process.env.EMAIL_SMTP_PASSWORD || '').update('desk-voice:'+id).digest('hex');
const browserSession = request => {
 const value = (request.headers?.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('desk_voice='))?.slice(11);
 if (!value) return '';
 const id=value.split('.')[0];const expected=cookie(id);
 return value.length===expected.length && crypto.timingSafeEqual(Buffer.from(value),Buffer.from(expected)) ? id : '';
};
function store(client,schema) {
 const table=`${schema}."_deskQueueWork"`;
 return {
  async thread(id) {const r=await client.query(`SELECT inquiry_id,draft,note,updated_at FROM ${table} WHERE inquiry_id LIKE 'reach:%' AND (CASE WHEN inquiry_id LIKE 'reach:%' THEN note::jsonb ELSE '{}'::jsonb END)->>'leadId'=$1 ORDER BY updated_at,inquiry_id`,[id]);return r.rows.map(r=>({...JSON.parse(r.note),text:r.draft,time:r.updated_at}));},
  async claim(id,key,kind,body) {
   const entry={leadId:id,key,kind,status:'pending',message:'Outcome not confirmed. Do not resend.'};
   const r=await client.query(`INSERT INTO ${table} (inquiry_id,draft,note) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING inquiry_id`,['reach:'+key,body,JSON.stringify(entry)]);
   return r.rows.length===1;
  },
  async finish(key,entry) {await client.query(`UPDATE ${table} SET note=$2,updated_at=now() WHERE inquiry_id=$1`,['reach:'+key,JSON.stringify(entry)]);},
  async draft(id) {const r=await client.query(`SELECT draft FROM ${table} WHERE inquiry_id=$1`,[id]);return r.rows[0]?.draft||'';}
 };
}
async function act({id,kind,sessionId='',requestId=''}, {repo,record,email,sms,voice,config=capabilities()}) {
 if(!['email','sms','call'].includes(kind))throw Error('Invalid action');
 const prior=await repo.thread(id);
 const result=async(message,status)=>({message,status,thread:await repo.thread(id)});
 const body=kind==='call'?'':await repo.draft(id);
 if(kind!=='call'&&!body.trim())return result('Write and save a reply first.','draft');
 const dest=phone(record.phone);
 let early='';
 if(kind==='email'&&(!config.mailEnabled||!record.email))early=failure.email;
 if(kind==='sms'&&(dest?.country==='IN'||/^\s*(?:\+|00)91/.test(record.phone||'')||/^(IN|India|91|\+91)$/i.test(record.country||'')))early='Text to India is blocked.';
 if(kind==='sms'&&!early&&!config.smsEnabled)early='Text from this desk is not connected.';
 if(kind==='sms'&&!early&&(!dest?.isValid()||dest.country!=='US'))early='Text is available for US numbers only.';
 if(kind==='call'&&!sessionId)early='Connect Google Voice to place this call.';
 // Content idempotency survives refresh and replicas. Unknown sends are never replayed.
 const key=crypto.createHash('sha256').update(JSON.stringify([id,kind,kind==='call'?prior.filter(e=>e.kind==='call'&&['expired','disconnected','refused','unavailable'].includes(e.status)).map(e=>e.key).sort():body])).digest('hex');
 const existing=prior.find(x=>x.key===key && !['blocked','connect'].includes(x.status)) || (kind==='call'&&prior.find(x=>x.kind==='call'&&['queued','pending','unknown'].includes(x.status)));
 if(existing)return result(existing.message,existing.status);
 if(early){const k=crypto.createHash('sha256').update(key+early).digest('hex');if(await repo.claim(id,k,kind,''))await repo.finish(k,{leadId:id,key:k,kind,status:kind==='call'?'connect':'blocked',message:early});return result(early,kind==='call'?'connect':'blocked');}
 if(!await repo.claim(id,key,kind,body))return result('This reply was already submitted.','duplicate');
 let status='sent',copy=message[kind];
 try {
  if(kind==='email'){const r=await email({to:record.email,subject:`${labels[record.queue]} — ${record.label}`,text:body});if(!r.accepted) {status='refused';copy=failure.email;}}
  if(kind==='sms'){const r=await sms({to:dest.number,text:body});if(!r.accepted){status='refused';copy=failure.sms;}}
  if(kind==='call'){const r=await voice({destination:dest?.number,sessionId,key,leadId:id,queue:record.queue});status=r.status;copy=status==='queued'?message.call:status==='connect'?'Connect Google Voice to place this call.':failure.call;}
 } catch(e) {status=e.definite?'refused':'unknown';copy=e.definite?failure[kind]:(kind==='email'?'Email outcome is unconfirmed. Do not resend.':kind==='sms'?'Text outcome is unconfirmed. Do not resend.':'Call outcome is unconfirmed. Do not retry.');}
 await repo.finish(key,{leadId:id,key,kind,status,message:copy});
 return result(copy,status);
}
const operationId = key => `${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
async function reconcile(repo,id,desk) {
 const thread=await repo.thread(id);
 if(!desk)return thread;
 for(const entry of thread.filter(e=>e.kind==='call'&&e.status==='queued')) {
  const note=await desk.system(async()=> (await desk.repo('note')).findOne({where:{id:operationId(entry.key)}}));
  let status,copy;
  if(note?.title==='KioskX Google Voice queued') {
   let payload={};try{payload=JSON.parse(note.bodyV2?.markdown||'{}');}catch{}
   if(payload.expires<Date.now()){status='expired';copy='Call expired before handoff. No call was placed.';}
  } else if(note?.title?.includes('expired')){status='expired';copy='Call expired before handoff. No call was placed.';}
  else if(note?.title?.includes('disconnected')){status='disconnected';copy='Google Voice disconnected. No call was placed.';}
  else if(note){status='unknown';copy=note.title.includes('opened')?'Google Voice opened the call. Outcome is not yet confirmed.':'Call handed to Google Voice. Outcome is not yet confirmed.';}
  if(status){const {text,time,...meta}=entry;await repo.finish(entry.key,{...meta,status,message:copy});}
 }
 return repo.thread(id);
}
async function transports(desk) {
 return {
  email:async ({to,subject,text})=>{
   const mail=require('nodemailer').createTransport({host:process.env.EMAIL_SMTP_HOST,port:Number(process.env.EMAIL_SMTP_PORT||587),secure:false,requireTLS:true,auth:{user:process.env.EMAIL_SMTP_USER,pass:process.env.EMAIL_SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:20000,logger:false,debug:false});
   try {const r=await mail.sendMail({from:process.env.KIOSKX_HIRED_EMAIL_FROM,to,subject,text,disableFileAccess:true,disableUrlAccess:true});return {accepted:r.accepted?.length===1};} catch(e){throw {definite:!!e.responseCode||['EAUTH','EENVELOPE','ECONNECTION'].includes(e.code)};}finally{mail.close();}
  },
  sms:async ({to,text})=>{const r=await fetch('https://api.telnyx.com/v2/messages',{method:'POST',headers:{Authorization:'Bearer '+process.env.TELNYX_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({from:sender(),to,text}),signal:AbortSignal.timeout(20000)});if(!r.ok){if(r.status<500) return {accepted:false};throw Error();}const d=await r.json();return {accepted:!!d.data?.id};},
  voice:async ({destination,sessionId,key,leadId,queue})=>desk.system(async()=>{
   const session=await desk.bridgeSession();
   if(!desk.voiceOn()||!sessionId||session.sessionId!==sessionId||session.expires<Date.now())return {status:'connect'};
   if(!destination)return {status:'unavailable'};
   const notes=await desk.repo('note');
   const id=operationId(key);
   const ciphertext=crypto.publicEncrypt({key:session.publicKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(destination)).toString('base64');
   await notes.insert({id,title:'KioskX Google Voice preparing'});
   if(queue==='kiosk') await (await desk.repo('noteTarget')).insert({noteId:id,targetPersonId:leadId});
   await notes.update(id,{title:'KioskX Google Voice queued',bodyV2:{markdown:JSON.stringify({sessionId,ciphertext,expires:Date.now()+20000}),blocknote:null}});
   return {status:'queued'};
  })
 };
}
async function withStore(fn) {
 const client=new Client({connectionString:process.env.PG_DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:10000});
 try{await client.connect();const r=await client.query('SELECT "databaseSchema" FROM core.workspace WHERE subdomain=$1',['ivx']);const schema=r.rows[0]?.databaseSchema;if(!/^workspace_[a-z0-9]+$/.test(schema||''))throw Error();return await fn(store(client,schema));}finally{await client.end();}
}
module.exports={act,reconcile,store,withStore,transports,capabilities,cookie,browserSession};
