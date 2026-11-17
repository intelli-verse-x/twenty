// Private, read-only sidecar beside the existing AniDeeBee application volume.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const root=process.env.DATA_DIR||'/data',uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function record(id){if(!uuid.test(id))throw Error();const fd=fs.openSync(path.join(root,id+'.json'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{if(fs.fstatSync(fd).size>50000)throw Error();const r=JSON.parse(fs.readFileSync(fd,'utf8'));if(r.id!==id||r.kind!=='job_application')throw Error();return r;}finally{fs.closeSync(fd);}}
function dto(r){return {id:r.id,name:r.name,email:r.email,phone:r.phone,role:r.service,experience:r.message,createdAt:r.createdAt,resume:r.resume?{filename:r.resume.filename}:null};}
http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');try{
 const expected=fs.readFileSync('/var/run/desk-applications/token','utf8').trim(),received=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!expected||received.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return res.writeHead(403).end();
 if(req.method!=='GET')return res.writeHead(405).end();
 const u=new URL(req.url,'http://local');
 if(u.pathname==='/applications'){const rows=[];for(const name of fs.readdirSync(root))if(uuid.test(name.slice(0,-5))&&name.endsWith('.json')){try{rows.push(dto(record(name.slice(0,-5))));}catch{}}res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({applications:rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}));}
 const id=u.pathname.match(/^\/applications\/([^/]+)\/resume$/)?.[1];const r=record(id||'');if(!r.resume||!['resume.pdf','resume.docx'].includes(r.resume.filename))throw Error();const fd=fs.openSync(path.join(root,'resumes',id+path.extname(r.resume.filename)),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes;try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>5*1024*1024||st.size!==r.resume.size)throw Error();bytes=fs.readFileSync(fd);}finally{fs.closeSync(fd);}if(crypto.createHash('sha256').update(bytes).digest('hex')!==r.resume.sha256)throw Error();res.setHeader('Content-Type',r.resume.contentType);res.setHeader('Content-Disposition','attachment; filename="'+r.resume.filename+'"');res.end(bytes);
 }catch{res.writeHead(404).end();}}).listen(8081,'0.0.0.0');
