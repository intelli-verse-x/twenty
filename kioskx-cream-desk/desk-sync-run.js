const fs=require('node:fs');
const store=require('./desk-sync-store');
const seed=require('./desk-sync-seed.json');
function indeedSnapshot(rows,old){
 const candidates=rows.map(r=>{
  const prior=(old.candidates||[]).find(p=>p.name===r.label&&p.role===r.service);
  return {...prior,id:prior?.id||r.id,name:r.label,role:r.service,phone:r.phone||prior?.phone||'',email:r.email||prior?.email||'',when:r.when,jobId:prior?.jobId||'mail:'+r.service};
 });
 const jobs=[...new Map(candidates.filter(r=>r.role).map(r=>[r.jobId,{id:r.jobId,title:r.role}])).values()];
 return {candidates,jobs};
}
async function run(client,{loadIndeed,loadTuro,loadBrowser,seedOnly=false}={}){
 const s=await store.setup(client);
 for(const [source,payload]of Object.entries(seed))await store.seed(client,s,source,payload);
 if(seedOnly)return;
 // One lock across manual runs and the scheduled job, released on disconnect.
 const lock=await client.query('SELECT pg_try_advisory_lock(20481120) AS locked');
 if(!lock.rows[0].locked)return;
 try{
  for(const source of ['indeed','turo']){
   try{
    const previous=await store.read(client,s);
    const next=loadBrowser?await loadBrowser(source):(source==='indeed'?indeedSnapshot(await loadIndeed(),previous.indeed):await loadTuro());
    if(next.error)throw Error('Source unavailable');
    if(source==='turo'){
     // Cancellation changes only the exact trip, never a same-name guest.
     for(const t of next.threads||[])if(t.tripId&&t.line?.startsWith('Cancelled')){
      const p=(next.trips||[]).find(p=>p.id===t.tripId)||(previous.turo.trips||[]).find(p=>p.id===t.tripId);
      if(p)next.trips.push({...p,current:false});
     }
    }
    await store.persist(client,s,source,next);
    console.log(source+': source evidence saved');
   }catch{await store.persist(client,s,source,null,'Refresh unavailable. Showing the last saved snapshot.');console.log(source+': refresh unavailable; snapshot retained');}
  }
 }finally{await client.query('SELECT pg_advisory_unlock(20481120)');}
}
if(require.main===module){
 const {Client}=require('pg');const c=new Client({connectionString:process.env.PG_DATABASE_URL,connectionTimeoutMillis:10000,query_timeout:15000});
 c.connect().then(()=>run(c,{seedOnly:process.argv.includes('--seed-only'),loadBrowser:source=>require('./desk-browser').request('read',{source})})).catch(()=>{console.error('Desk sync unavailable; retained snapshot');process.exitCode=1;}).finally(()=>c.end());
}
module.exports={run,indeedSnapshot};
