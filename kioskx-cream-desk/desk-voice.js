const fs=require('node:fs');
const crypto=require('node:crypto');
const PREFIX='/kioskx-hired-desk/voice';
const ORIGIN='https://fonoster.intelli-verse-x.ai';
const sessions=new Map();
const failure='Voice Studio could not be reached. Call +1 (773) 681-2818.';
function begin(req){
 for(const [key,s]of sessions)if(s.until<Date.now())sessions.delete(key);
 const key=crypto.randomBytes(32).toString('hex');
 sessions.set(key,{authorization:req.headers.authorization,until:Date.now()+30*60000,cookies:''});
 req.res.cookie('desk_studio',key,{httpOnly:true,secure:true,sameSite:'strict',path:PREFIX,maxAge:30*60000});
 return {url:PREFIX+'/'};
}
function session(req){const key=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('desk_studio='))?.slice(12);const s=sessions.get(key);return s&&s.until>Date.now()?s:null;}
function rewrite(text){return text.replaceAll(ORIGIN,'https://kioskx.crm.intelli-verse-x.ai'+PREFIX).replace('url:Qi,accessKeyId:', 'url:Qi+"'+PREFIX+'",accessKeyId:').replace(/(["'`])\/(assets\/)/g,'$1'+PREFIX+'/$2').replace('"basename":"/"','"basename":"'+PREFIX+'"').replace(/(href|src|action)="\/(?!\/|kioskx-hired-desk\/voice)/g,'$1="'+PREFIX+'/');}
function cookies(response,s){const values=response.headers.getSetCookie?.()||[];for(const value of values){const pair=value.split(';')[0],name=pair.split('=')[0];s.cookies=s.cookies.split('; ').filter(v=>v&&!v.startsWith(name+'=')).concat(pair).join('; ');}}
async function proxy(req,res,s,{request=fetch,read=fs.readFileSync}={}){
 try{
  if(!s.cookies){
   if(!s.login)s.login=(async()=>{
   // Projected secret files are read at request time; credentials never enter the response.
   const root=process.env.DESK_VOICE_SECRET_DIR||'/var/run/desk-fonoster';
   const email=read(root+'/APISERVER_OWNER_EMAIL','utf8').trim(),password=read(root+'/APISERVER_OWNER_PASSWORD','utf8').trim();
   const login=await request(ORIGIN+'/auth/login',{method:'POST',body:new URLSearchParams({email,password}),redirect:'manual',signal:AbortSignal.timeout(15000)});
   if(login.status!==302||login.headers.get('location')!=='/')throw Error();cookies(login,s);if(!s.cookies)throw Error();
   })().finally(()=>{s.login=null;});
   await s.login;
  }
  let path=req.originalUrl.slice(PREFIX.length)||'/';
  if(!path.startsWith('/')||path.startsWith('//')||path.startsWith('/auth/'))throw Error();
  const target=new URL(path,ORIGIN);
  if(target.pathname==='/__manifest'){
    const strip=p=>p===PREFIX?'/':p.startsWith(PREFIX+'/')?p.slice(PREFIX.length):p;
    const single=target.searchParams.getAll('p');
    target.searchParams.delete('p');
    for(const p of single)target.searchParams.append('p',strip(p));
    const joined=target.searchParams.get('paths');
    if(joined)target.searchParams.set('paths',joined.split(',').map(strip).join(','));
    path=target.pathname+target.search;
  }
  const headers={cookie:s.cookies,accept:req.headers.accept||'*/*'};
  for(const key of ['x-grpc-web','x-user-agent','grpc-timeout','token','accesskeyid'])if(req.headers[key])headers[key]=req.headers[key];
  if(req.studioAuthorization)headers.authorization=req.studioAuthorization;
  if(req.method!=='GET'&&req.method!=='HEAD'){
   if(req.headers.origin!=='https://kioskx.crm.intelli-verse-x.ai')throw Error();
   headers['Content-Type']=req.headers['content-type']||'application/json';
  }
  let body;if(!['GET','HEAD'].includes(req.method)){if(req.body===undefined){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error();chunks.push(chunk);}body=Buffer.concat(chunks);}else body=Buffer.isBuffer(req.body)?req.body:headers['Content-Type'].includes('application/x-www-form-urlencoded')?new URLSearchParams(req.body):JSON.stringify(req.body);}
  const upstream=await request(ORIGIN+path,{method:req.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(20000)});cookies(upstream,s);
  const location=upstream.headers.get('location');
  if(location){const target=new URL(location,ORIGIN);if(target.origin!==ORIGIN||target.pathname.startsWith('/auth/'))throw Error();return res.redirect(upstream.status,PREFIX+target.pathname+target.search);}
  if(!upstream.ok)throw Error();
  const type=upstream.headers.get('content-type')||'application/octet-stream';res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');for(const name of ['grpc-status','grpc-message'])if(upstream.headers.get(name))res.setHeader(name,upstream.headers.get(name));
  if(/text\/|javascript|json/.test(type)){let text=await upstream.text();if(/type=["']password["']/.test(text))throw Error();return res.send(rewrite(text));}
  return res.send(Buffer.from(await upstream.arrayBuffer()));
 }catch{ res.status(503).type('html').send('<!doctype html><html><body><p>'+failure+'</p></body></html>');}
}
module.exports={begin,session,proxy,rewrite,failure};
