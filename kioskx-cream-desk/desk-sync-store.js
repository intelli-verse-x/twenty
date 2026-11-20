// Durable, company-scoped source evidence. Failed reads never replace good data.
const TABLE='"_deskSourceSnapshot"';
const SCHEMA=/^workspace_[a-z0-9]+$/;
async function schema(client){const r=await client.query('SELECT "databaseSchema" FROM core.workspace WHERE subdomain=$1',['ivx']);const s=r.rows[0]?.databaseSchema;if(!SCHEMA.test(s||''))throw Error('Workspace unavailable');return s;}
async function setup(client){const s=await schema(client);await client.query(`CREATE TABLE IF NOT EXISTS ${s}.${TABLE} (company text NOT NULL, source text NOT NULL, payload jsonb NOT NULL, read_at timestamptz, attempted_at timestamptz, checked_at timestamptz, error text, PRIMARY KEY(company,source))`);return s;}
async function read(client,s){if(!SCHEMA.test(s))throw Error('Workspace unavailable');const r=await client.query(`SELECT source,payload,read_at,attempted_at,checked_at,error FROM ${s}.${TABLE} WHERE company=$1`,['anideebee']);return Object.fromEntries(r.rows.map(r=>[r.source,{...r.payload,readAt:r.read_at,attemptedAt:r.attempted_at,checkedAt:r.checked_at,error:r.error}]));}
async function seed(client,s,source,payload){
 await client.query('BEGIN');
 try{
  await client.query(`INSERT INTO ${s}.${TABLE}(company,source,payload,read_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,['anideebee',source,payload,'2026-11-20']);
  const found=await client.query(`SELECT payload FROM ${s}.${TABLE} WHERE company=$1 AND source=$2 FOR UPDATE`,['anideebee',source]);
  const old=found.rows[0].payload;
  // Apply this confirmed evidence once. Later scheduled reads retain their own dates and values.
  if((old.evidenceVersion||0)<payload.evidenceVersion){
   const next=merge(old,payload);next.evidenceVersion=payload.evidenceVersion;
   await client.query(`UPDATE ${s}.${TABLE} SET payload=$3 WHERE company=$1 AND source=$2`,['anideebee',source,next]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}
}
function mergeRows(oldRows,newRows){
 const rows=[...oldRows];
 for(const r of newRows){
  if(!r.id)throw Error('Missing identity');
  const index=rows.findIndex(p=>p.id===r.id||(r.legacyId&&p.id===r.legacyId)||(p.legacyId&&p.legacyId===r.id)||(r.threadUrl&&p.threadUrl===r.threadUrl));
  if(index<0){rows.push(r);continue;}
  const prior=rows[index],next={...prior,...r};
  // An incomplete refresh cannot erase a confirmed conversation address or downgrade its identity.
  if(!r.threadUrl&&prior.threadUrl){next.threadUrl=prior.threadUrl;next.id=prior.id;}
  rows[index]=next;
 }
 return rows;
}
function merge(old,next){
 const out={...old};
 for(const key of ['jobs','candidates','cars','trips','threads'])if(next[key]){
  if(!Array.isArray(next[key]))throw Error('Invalid source');
  const incoming=key==='candidates'?next[key].map(r=>{
   const matches=(old[key]||[]).filter(p=>p.name===r.name&&p.role===r.role);
   const prior=matches.length===1?matches[0]:null;
   return prior&&!r.threadUrl?{...r,id:prior.id}:r;
  }):next[key];
  out[key]=mergeRows(old[key]||[],incoming);
 }
 return out;
}
async function persist(client,s,source,next,error=null){
 await client.query('BEGIN');
 try{const r=await client.query(`SELECT payload FROM ${s}.${TABLE} WHERE company=$1 AND source=$2 FOR UPDATE`,['anideebee',source]);if(!r.rows.length)throw Error('Snapshot missing');
 const payload=error?r.rows[0].payload:merge(r.rows[0].payload,next);
 await client.query(`UPDATE ${s}.${TABLE} SET payload=$3,attempted_at=now(),read_at=CASE WHEN $5::boolean AND $4::text IS NULL THEN now() ELSE read_at END,checked_at=CASE WHEN $4::text IS NULL THEN now() ELSE checked_at END,error=$4 WHERE company=$1 AND source=$2`,['anideebee',source,payload,error,!!next?.browserRead]);await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}
}
function candidates(snapshot){return (snapshot?.candidates||[]).map(r=>({id:r.id,label:r.name,queue:'jobs',applicationSource:'indeed',summary:r.role,service:r.role,phone:r.phone||'',email:r.email||'',readOnly:true,browserThreadId:r.id,threadUrl:r.threadUrl,messages:r.messages||[],status:r.status||r.match||'New',fields:[['Job',r.role],['City',r.city],['Indeed status',r.status],['Match',r.match],['Interview',r.interview],['Screener answer',r.screener],['Applied',r.appliedAt],['Last activity',r.lastActivity]].filter(([,v])=>v),when:r.when||null}));}
function fleet(snapshot){return {rows:(snapshot?.cars||[]).map(car=>{const trip=(snapshot.trips||[]).find(t=>t.carId===car.id&&t.current);return {id:'turo:'+car.id,label:car.name,summary:trip?`${trip.guest} · ${trip.vehicle} · ends ${trip.endLabel}`:'No current trip',trip:trip||null,status:trip?'On trip':'No current trip',readOnly:true};}),threads:snapshot?.threads||[],readAt:snapshot?.readAt,checkedAt:snapshot?.checkedAt,error:snapshot?.error};}
module.exports={setup,schema,read,seed,persist,merge,candidates,fleet};
