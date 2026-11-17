// Enqueue Chatwoot's existing IMAP job via Sidekiq's public JSON job protocol.
// Never read/write its application tables or create a mail channel.
const crypto=require('node:crypto');
const inflight=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function refreshMail(desk,api,deps={}) {
 const key=`${desk.account}:${desk.inbox}`;
 if(inflight.has(key))return inflight.get(key);
 const run=perform(desk,api,deps).finally(()=>inflight.delete(key));inflight.set(key,run);return run;
}
async function perform(desk,api,{redis:provided,wait=sleep,timeout=40000}={}) {
 let redis;
 try{
  const path=`/api/v1/accounts/${desk.account}/inboxes/${desk.inbox}`;
  const inbox=await api(path);
  if(inbox.channel_type!=='Channel::Email'||!inbox.imap_enabled)return {status:'unavailable',message:'Direct mail fetch is unavailable for this mailbox. Showing stored mail.'};
  if(inbox.reauthorization_required)return {status:'reconnect',message:'Gmail needs to be reconnected for '+desk.mail+'. New mail cannot be fetched yet. Showing stored mail.'};
  if(!Number.isSafeInteger(inbox.channel_id)||inbox.channel_id<1)throw Error();
  const Redis=require('ioredis');
  redis=provided||new Redis(process.env.DESK_CHATWOOT_REDIS_URL||'redis://chatwoot-redis.aicart.svc.cluster.local:6379',{connectTimeout:3000,maxRetriesPerRequest:1,retryStrategy:()=>null});
  redis.on?.('error',()=>{});
  const jid=crypto.randomBytes(12).toString('hex'),now=new Date().toISOString();
  const job={class:'ActiveJob::QueueAdapters::SidekiqAdapter::JobWrapper',wrapped:'Inboxes::FetchImapEmailsJob',queue:'scheduled_jobs',retry:true,jid,created_at:Date.now()/1000,enqueued_at:Date.now()/1000,args:[{job_class:'Inboxes::FetchImapEmailsJob',job_id:crypto.randomUUID(),provider_job_id:null,queue_name:'scheduled_jobs',priority:null,arguments:[{_aj_globalid:`gid://chatwoot/Channel::Email/${inbox.channel_id}`},7],executions:0,exception_executions:{},locale:'en',timezone:'UTC',enqueued_at:now,scheduled_at:null}]};
  // Standard Sidekiq client enqueue; the job owns deduplication and the mailbox mutex.
  await redis.multi().sadd('queues','scheduled_jobs').lpush('queue:scheduled_jobs',JSON.stringify(job)).exec();
  const started=Date.now();let absent=0;
  while(Date.now()-started<timeout){
   await wait(1000);
   const queued=(await redis.lrange('queue:scheduled_jobs',0,-1)).some(raw=>raw.includes(jid));
   const processes=await redis.smembers('processes');
   const work=await Promise.all(processes.map(id=>redis.hvals(id+':work')));
   const active=work.flat().some(raw=>raw.includes(jid));
   absent=queued||active?0:absent+1;
   // Sidekiq work heartbeat is periodic: allow it to publish before treating absence as completion.
   if(absent>=6){
    const fresh=await api(path);
    if(fresh.reauthorization_required)return {status:'reconnect',message:'Gmail needs to be reconnected. New mail could not be fetched. Showing stored mail.'};
    return {status:'requested',message:'Gmail fetch requested; the latest stored mail is shown below. Refresh again if mail is still arriving.'};
   }
  }
  return {status:'pending',message:'Gmail fetch is still running. Refresh shortly to load arriving mail.'};
 }catch{return {status:'unavailable',message:'New mail could not be fetched. Showing stored mail; try Refresh again.'};}
 finally{if(redis&&!provided)redis.disconnect();}
}
module.exports={refreshMail};
