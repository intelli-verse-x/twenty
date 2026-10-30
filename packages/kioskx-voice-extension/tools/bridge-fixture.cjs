// Synthetic repositories only; never connects to the CRM database.
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const built=process.env.OVERLAY_SERVER;
const fakeOffice='+12025550100';
const lead='11111111-1111-4111-a111-111111111111';
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const publicKey=keys.publicKey.export({type:'spki',format:'pem'});
function setup(){
 const rows=new Map(); const links=[];
 const notes={findOne:async({where})=>rows.get(where.id),find:async({where})=>[...rows.values()].filter(x=>x.title===where.title),
 insert:async r=>{if(rows.has(r.id))throw Error('duplicate');rows.set(r.id,{...r});},
 update:async(criteria,patch)=>{const id=typeof criteria==='string'?criteria:criteria.id;const row=rows.get(id);
 if(!row||(criteria.title&&criteria.title!==row.title))return{affected:0};Object.assign(row,patch);return{affected:1};}};
 class Desk{async system(fn){return fn();}async repo(name){return name==='note'?notes:{insert:async r=>links.push(r),find:async({where})=>links.filter(x=>x.noteId===where.noteId)};}
 async records(){return[{person:{id:lead},phone:'+12025550123'}];} destination(x){return x;}}
 const box={exports:{},require:n=>n==='node:crypto'?crypto:{HIRED_WORKSPACE:'test'},Buffer,process:{env:{KIOSKX_GOOGLE_VOICE_NUMBER:fakeOffice}},Date};
 vm.runInNewContext(fs.readFileSync(path.join(built,'hired-google-voice-overlay.js'),'utf8'),box);
 box.exports.install(Desk); const desk=new Desk();
 return{desk,rows,links,notes,env:box.process.env,connect:()=>desk.bridge({action:'connect',publicKey,sessionId:'22222222-2222-4222-a222-222222222222'}),sessionId:'22222222-2222-4222-a222-222222222222'};
}

module.exports={setup,lead,keys};
