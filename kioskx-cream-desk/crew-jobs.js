// Crew owns the job and attendance record. This adapter neither sends nor pays.
async function requestCrew(body, env=process.env, request=fetch) {
 if(!env.CREW_DESK_TOKEN) return {unavailable:true,message:'Worker assignments are not connected.'};
 try {
  const response=await request((env.CREW_API_URL||'http://crew-app:8080')+'/api/desk/jobs',{
   method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.CREW_DESK_TOKEN,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(8000)
  });
  const data=await response.json();return response.ok?data:{unavailable:true,message:data.message||'Assignment could not be saved.'};
 } catch {return {unavailable:true,message:'Worker assignments are unavailable. Try again.'};}
}
async function assign(body, board, call=requestCrew) {
 const entry=['cleaning','cars'].flatMap(q=>(board.queues?.[q]?.rows||[]).map(r=>({...r,queue:q}))).find(r=>r.id===body?.id);
 if(!entry) return {unavailable:true,message:'Open a cleaning or car request to assign work.'};
 const role=entry.queue==='cleaning'?'cleaner':body.role;
 if(!['cleaner','driver','rental'].includes(role)||entry.queue==='cars'&&role==='cleaner')return {unavailable:true,message:'Choose a driver or rental helper for a car request.'};
 return call({source_id:entry.id,phone:body.phone,name:body.name,address:body.address,city:body.city,time:body.time,role});
}
exports.requestCrew=requestCrew;exports.assign=assign;
