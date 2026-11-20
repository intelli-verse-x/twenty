// Only the desk's explicit Send route may invoke a browser write.
const store=require('./desk-sync-store');
async function request(action,body,env=process.env,transport=fetch){
 if(env.DESK_BROWSER_ENABLED==='false')throw Error('Browser paused');
 const response=await transport((env.DESK_BROWSER_URL||'http://browser-use:8000')+'/desk/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.DESK_BROWSER_TOKEN},body:JSON.stringify(body),signal:AbortSignal.timeout(115000)});
 if(!response.ok)throw Error('Browser unavailable');return response.json();
}
async function withClient(fn){const {Client}=require('pg');const c=new Client({connectionString:process.env.PG_DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:15000});await c.connect();try{return await fn(c);}finally{await c.end();}}
async function reply(client,input,transport=request){
 if(input?.company!=='AniDeeBee'||!['indeed','turo'].includes(input.source)||typeof input.id!=='string'||typeof input.text!=='string'||!input.text.trim()||input.text.length>5000||!/^[a-f0-9-]{36}$/i.test(input.requestId||''))throw Error('Invalid reply');
 const s=await store.setup(client),snapshots=await store.read(client,s),snapshot=snapshots[input.source];
 const row=[...(snapshot?.threads||[]),...(snapshot?.candidates||[])].find(r=>r.id===input.id);
 if(!row?.threadUrl)return {status:'not_sent',message:'Not sent. This conversation needs a fresh account connection in Unified Support.'};
 await client.query(`CREATE TABLE IF NOT EXISTS ${s}."_deskBrowserReply" (request_id text PRIMARY KEY, source text NOT NULL, thread_id text NOT NULL, body text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
 // Committed claim precedes any provider side effect. Reusing a key never replays it.
 const claim=await client.query(`INSERT INTO ${s}."_deskBrowserReply"(request_id,source,thread_id,body,status) VALUES($1,$2,$3,$4,'unknown') ON CONFLICT DO NOTHING RETURNING request_id`,[input.requestId,input.source,input.id,input.text]);
 if(!claim.rows.length){const r=await client.query(`SELECT status FROM ${s}."_deskBrowserReply" WHERE request_id=$1`,[input.requestId]);return {status:r.rows[0]?.status||'unknown',message:'This send was already recorded. It has not been repeated.'};}
 let result;
 try{result=await transport('send',{source:input.source,threadUrl:row.threadUrl,name:row.name,text:input.text});if(!['sent','not_sent','unknown'].includes(result.status))throw Error();}
 catch{result={status:'unknown',message:'Send could not be confirmed. Do not resend.'};}
 await client.query(`UPDATE ${s}."_deskBrowserReply" SET status=$2,updated_at=now() WHERE request_id=$1`,[input.requestId,result.status]);return result;
}
module.exports={request,reply,withClient};
