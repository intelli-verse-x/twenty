// One additive SQL table in the existing workspace; no Twenty migrations.
const {Client}=require('pg');
(async()=>{
 const c=new Client({connectionString:process.env.PG_DATABASE_URL,connectionTimeoutMillis:5000});
 try {
  await c.connect();
  const w=await c.query('SELECT "databaseSchema" FROM core.workspace WHERE subdomain=$1',['ivx']);
  const schema=w.rows[0]?.databaseSchema;
  if(!/^workspace_[a-z0-9]+$/.test(schema||''))throw Error();
  await c.query(`CREATE TABLE IF NOT EXISTS ${schema}."_deskQueueWork" (
   inquiry_id text PRIMARY KEY,
   status text NOT NULL DEFAULT 'New' CHECK (status IN ('New','Call next','Waiting','Done')),
   draft text NOT NULL DEFAULT '' CHECK (length(draft)<=10000),
   note text NOT NULL DEFAULT '' CHECK (length(note)<=10000),
   updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  console.log('Workspace work table ready; mailbox flag unset:',!process.env.DESK_QUEUE_MAIL,'migrations disabled:',process.env.DISABLE_DB_MIGRATIONS==='true');
 } finally {await c.end();}
})().catch(()=>{console.error('Work table unavailable; requests remain readable.');process.exit(1)});
