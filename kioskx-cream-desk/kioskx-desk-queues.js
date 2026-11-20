(() => {

const names={inbox:'Inbox',call:'Call',cleaning:'Cleaning',cars:'Cars',jobs:'Jobs',kiosk:'Kiosk',today:'Today',queues:'Queues',knowledge:'Knowledge base',insights:'Insights',integrations:'Integrations',companies:'Companies',calendar:'Calendar',engagement:'Engagement'};
let data=null,queue='inbox',open='',host=null,busy=false,company='Kiosk X',channel='All',search='',period=7,category='All articles',articleCompany='All',article=0,lastRequest='',drafts={},dismissed=new Set();
const desks={
 'Kiosk X':{app:'kioskx',mail:'support@kiosk-x.ai',inbox:'https://inbox.intelli-verse-x.ai/app/accounts/1/inbox/101'},
 'ToBa Tech':{app:'toba',mail:'pallavi@toba-tech.ai',inbox:'https://inbox.intelli-verse-x.ai/app/accounts/34/inbox/36'},
 'QuizVerse':{app:'quizverse',mail:'support@quizverse.world',inbox:'https://inbox.intelli-verse-x.ai/app/accounts/1/inbox/2'},
 'QuestX':{app:'questx',mail:'support@quest-x.ai',inbox:'https://inbox.intelli-verse-x.ai/app/accounts/1/inbox/103'},
 'IntelliVerse X':{app:'intelliverse',mail:'support@intelli-verse-x.ai',inbox:'https://inbox.intelli-verse-x.ai/app/accounts/1/inbox/100'},
 'ContentX Studio':{app:'contentx',mail:'support@content-x.ai',inbox:'https://inbox.intelli-verse-x.ai/app/accounts/1/inbox/102'},
 'AniDeeBee':{app:'anideebee',mail:'support@anideebee.com',inbox:'https://inbox.intelli-verse-x.ai/app/accounts/1/inbox/3'}
};
const companies=Object.keys(desks);
const appIds=Object.fromEntries(companies.map(c=>[c,desks[c].app||'Not in the app registry']));
const companyOf=r=>r.queue==='kiosk'?'KioskX':'AniDeeBee';
const statusOf=r=>r.status||'New';
const deskOf=r=>r.queue==='kiosk'?'Kiosk X':['cleaning','cars','jobs'].includes(r.queue)?'AniDeeBee':null;
const matchesCompany=r=>deskOf(r)===company;
const queueKeys=['cleaning','cars','jobs','kiosk'];
const token=()=>{try{return JSON.parse(localStorage.getItem('tokenPairState')).accessOrWorkspaceAgnosticToken.token;}catch{return '';}};
const api=async(path,body)=>{const r=await fetch('/kioskx-hired-desk/'+path,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('Unavailable');return r.json();};
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const clean=v=>String(v??'').replace(/[^\s<>()[\],;:]*@[^\s<>()[\],;:]*/g,'[contact hidden]').replace(/\+?\d[\d ().-]{6,}\d/g,'[contact hidden]');
const displayName=r=>{const raw=String(r.label||'');const value=r.queue==='kiosk'?raw.split(/\b(?:Email|Phone|City|Message|SMS)\s*(?:\(|:|\/)/i)[0].trim():raw;return clean(value||(r.queue==='kiosk'?'Kiosk inquiry':'Inquiry'));};
const rows=()=>Object.entries(data?.queues||{}).filter(([k])=>['cleaning','cars','jobs','kiosk'].includes(k)).flatMap(([k,q])=>(q.rows||[]).map(r=>({...r,queue:k})));
const time=v=>v&&!isNaN(new Date(v))?new Date(v).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
const chip=s=>el('span','sd-chip sd-'+s.toLowerCase().replace(/^\d+ /,'').replaceAll(' ','-'),s);
const button=(text,fn,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
const unavailable=()=>!data||data.unavailable||data.workUnavailable||data.queues?.[queue]?.unavailable||data.queues?.[rows().find(r=>r.id===open)?.queue]?.unavailable;
function activity(){return rows().flatMap(r=>(r.thread||[]).filter(t=>new Date(t.time).toDateString()===new Date().toDateString()&&((['email','sms'].includes(t.kind)&&t.status==='sent')||(t.kind==='call'&&['sent','queued','completed'].includes(t.status)))).map(t=>({...t,row:r}))).sort((a,b)=>new Date(b.time)-new Date(a.time));}
function today(expanded=false){const a=activity().filter(t=>matchesCompany(t.row)),box=el('details','sd-today');box.open=expanded;const n=k=>a.filter(t=>t.kind===k).length;box.append(el('summary','',unavailable()?'Today: activity unavailable.':a.length?`Today: ${n('email')} emails, ${n('call')} calls, ${n('sms')} texts.`:'Today: nothing sent.'));for(const t of a)box.append(el('p','',`${names[t.row.queue]} — ${displayName(t.row)} — ${t.kind==='email'?'Email sent':t.kind==='sms'?'Text sent':t.status==='queued'?'Call queued':'Call completed'} — ${time(t.time)}`));return box;}
function legend(){const card=el('section','sd-card sd-legend');card.append(el('h3','','STATUS MEANING'));for(const [s,d]of [['New','Not contacted'],['Call next','You still need to call'],['Waiting','Waiting on them'],['Done','Finished']]){const p=el('p');p.append(chip(s),el('span','',d));card.append(p);}card.append(el('p','sd-muted','These chips do not send anything.'));return card;}
function fields(title,pairs,cls=''){const card=el('section','sd-card '+cls);card.append(el('h3','',title));const dl=el('dl');for(const [k,v]of pairs){dl.append(el('dt','',k),el('dd','',v));}card.append(dl);return card;}
function navigate(k,id=''){if(busy)return;remember();if(queueKeys.includes(k))company=deskOf({queue:k});queue=k;open=id;if(id)lastRequest=id;search='';channel='All';window.kxQueue=k;render();if(k==='jobs')loadApplications();}
async function loadApplications(){
 try{const result=await api('applications?company=AniDeeBee');if(!data?.queues)return;const existing=data.queues.jobs?.rows||[];const merged=new Map(existing.map(r=>[r.id,r]));for(const r of result.applications||[])merged.set(r.id,{...r,...merged.get(r.id),fields:r.fields,resume:r.resume,readOnly:!merged.has(r.id)});data.queues.jobs={...data.queues.jobs,rows:[...merged.values()].sort((a,b)=>new Date(b.when)-new Date(a.when)),applicationUnavailable:result.unavailable};if(queue==='jobs'&&company==='AniDeeBee'&&!open)render();}catch{if(data?.queues?.jobs)data.queues.jobs.applicationUnavailable=true;}
}
function resumeLink(r){const link=el('a','sd-resume','Open resume');link.href=r.resume.url||'/kioskx-hired-desk/'+r.resume.path;link.target='_blank';link.rel='noopener noreferrer';if(r.resume.path)link.onclick=async e=>{e.preventDefault();try{const response=await fetch(link.href,{headers:{Authorization:'Bearer '+token()},cache:'no-store'});if(!response.ok)throw Error();const url=URL.createObjectURL(await response.blob());const a=el('a');a.href=url;a.download=r.resume.name||'resume';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch{link.textContent='Resume unavailable — try again';}};return link;}
function remember(){const field=host?.querySelector('textarea[aria-label="Reply"],textarea[aria-label="Email"]');if(open&&field)drafts[open]=field.value;}
function pills(values,selected,onchange){const wrap=el('div','sd-pills');for(const v of values){const b=button(v,()=>onchange(v));b.setAttribute('aria-pressed',String(v===selected));wrap.append(b);}return wrap;}
function companyPills(){return el('span','sd-selected-company',company);}
function rowButton(r,label){const b=button('',()=>navigate(queue==='inbox'?'inbox':r.queue,r.id),'sd-row');b.setAttribute('aria-pressed',String(r.id===open));const n=displayName(r),copy=el('span','sd-row-copy'),line=el('span');line.append(el('strong','',n),el('small','',names[r.queue]));copy.append(line,el('span','sd-preview',clean(r.summary||r.message||'Inquiry')));const end=el('span','sd-row-end');end.append(el('time','',time(r.when)),chip(statusOf(r)));if(label)end.append(el('span','',label));b.append(el('span','sd-avatar',n[0].toUpperCase()),copy,end);return b;}
function card(title,text){const c=el('section','sd-card');c.append(el('h3','',title));if(text)c.append(el('p','',text));return c;}
function kpis(items){const wrap=el('div','sd-kpis');for(const [label,value,note]of items){const c=card(label);c.prepend(el('strong','sd-number',value));if(note)c.append(el('p','sd-muted',note));wrap.append(c);}return wrap;}
function sessionName(){
 let user={};try{user=JSON.parse(localStorage.getItem('currentUserState'))||{};}catch{}
 let claims={};try{claims=JSON.parse(atob(token().split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{}
 const name=typeof user.name==='string'?user.name:[user.firstName||user.name?.firstName,user.lastName||user.name?.lastName].filter(Boolean).join(' ');
 return name?.trim()||claims.name||String(user.email||claims.email||localStorage.getItem('sd-session-email')||'').split('@')[0];
}
function logOut(){
 const native=document.querySelector('main.hired-desk .hired-signout');
 if(!native){const notice=host.querySelector('.sd-session-status');notice.textContent='Sign out is unavailable. Reload the page and try again.';return;}
 // Invoke the CRM boundary: it clears its session atom and redirects to login.
 localStorage.removeItem('sd-session-email');localStorage.removeItem('sd-session-only');sessionStorage.removeItem('sd-session-active');
 drafts={};dismissed.clear();data=null;open='';queue='inbox';company='Kiosk X';lastRequest='';window.kxQueueCounts=null;
 native.click();
}
function render(){if(!host)return;const voice=document.querySelector('#kioskx-voice-connect');if(voice){delete voice.dataset.deskRequested;if(host.contains(voice))document.querySelector('.hired-desk').append(voice);}host.replaceChildren();const all=rows().filter(matchesCompany),current=all.find(r=>r.id===open);host.classList.toggle('sd-open',!!current);host.classList.toggle('sd-inbox-open',!!current&&queue==='inbox');const rail=el('aside','sd-rail');rail.setAttribute('aria-label','Support Desk');const brand=brandMark(),mark=el('img','sd-logo');mark.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzI0XzMyKSI+CjxwYXRoIGQ9Ik0zNiAwSDEyQzUuMzcyNTggMCAwIDUuMzcyNTggMCAxMlYzNkMwIDQyLjYyNzQgNS4zNzI1OCA0OCAxMiA0OEgzNkM0Mi42Mjc0IDQ4IDQ4IDQyLjYyNzQgNDggMzZWMTJDNDggNS4zNzI1OCA0Mi42Mjc0IDAgMzYgMFoiIGZpbGw9IiMxRjNBNUYiLz4KPHBhdGggZD0iTTE1IDEyLjVWMjVDMTUgMjcuMzg2OSAxNS45NDgyIDI5LjY3NjEgMTcuNjM2IDMxLjM2NEMxOS4zMjM5IDMzLjA1MTggMjEuNjEzMSAzNCAyNCAzNEMyNi4zODY5IDM0IDI4LjY3NjEgMzMuMDUxOCAzMC4zNjQgMzEuMzY0QzMyLjA1MTggMjkuNjc2MSAzMyAyNy4zODY5IDMzIDI1VjEyLjUiIHN0cm9rZS13aWR0aD0iNC42IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI0IDIwLjZDMjUuODc3OCAyMC42IDI3LjQgMTkuMDc3OCAyNy40IDE3LjJDMjcuNCAxNS4zMjIzIDI1Ljg3NzggMTMuOCAyNCAxMy44QzIyLjEyMjIgMTMuOCAyMC42IDE1LjMyMjMgMjAuNiAxNy4yQzIwLjYgMTkuMDc3OCAyMi4xMjIyIDIwLjYgMjQgMjAuNloiIGZpbGw9IiM4RkI0RkYiLz4KPC9nPgo8ZGVmcz4KPGNsaXBQYXRoIGlkPSJjbGlwMF8yNF8zMiI+CjxyZWN0IHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgZmlsbD0id2hpdGUiLz4KPC9jbGlwUGF0aD4KPC9kZWZzPgo8L3N2Zz4K';mark.alt='';brand.querySelector('.sl-mark').replaceWith(mark);rail.append(brand,el('span','sd-sr-only','Support Desk'));
const switcher=el('label','sd-switcher');switcher.append(el('span','sd-brand','COMPANY / APP ID'));const switchLine=el('div','sd-switch-line');const dots=el('span','sd-dots');dots.setAttribute('aria-hidden','true');dots.append(el('i'),el('i'),el('i'));const select=el('select');select.setAttribute('aria-label','Company');for(const c of companies){const o=el('option','',c==='All'?'All companies':c);o.value=c;select.append(o);}select.value=company;select.onchange=()=>{remember();company=select.value;queue=queueKeys.includes(queue)?'queues':queue;open='';search='';render();};switchLine.append(dots,select);switcher.append(switchLine);rail.append(switcher);
const nav=el('nav');nav.setAttribute('aria-label','Desk');for(const k of ['inbox','call','engagement','today','queues','knowledge','insights','integrations','companies','calendar']){const b=button(names[k],()=>navigate(k));b.setAttribute('aria-pressed',String(k===queue||(k==='queues'&&queueKeys.includes(queue))));if(k==='today')b.append(el('span','',activity().filter(t=>matchesCompany(t.row)).length));nav.append(b);if(k==='queues'&&(queue==='queues'||queueKeys.includes(queue)))for(const q of queueKeys.filter(q=>matchesCompany({queue:q}))){const qb=button(names[q],()=>navigate(q),'sd-subnav');qb.append(el('span','',all.filter(r=>r.queue===q&&statusOf(r)!=='Done').length));qb.setAttribute('aria-pressed',String(q===queue));nav.append(qb);}}rail.append(nav);const assistant=card('AI assistant','Drafts replies and finds articles. Never sends by itself.');assistant.classList.add('sd-assistant');rail.append(assistant);const account=el('footer','sd-account');account.append(el('strong','sd-session-name',sessionName()),button('Log out',logOut),el('p','sd-access-status',company+' · '+appIds[company]),el('p','sd-session-status'));rail.append(account);host.append(rail);
if(queue==='inbox'||queue==='call'){renderEmbed();return;}
if(!queueKeys.includes(queue)){const page=el('section','sd-page sd-page-'+queue);page.append(el('h1','',queue==='integrations'?'Connect a company mailbox':queue==='companies'?'Companies and access':names[queue]));host.append(page);if(queue==='engagement')renderEngagement(page);if(queue==='today')renderToday(page,all);if(queue==='queues')renderQueues(page,all);if(queue==='knowledge')renderKnowledge(page);if(queue==='insights')renderInsights(page,all);if(queue==='integrations')renderIntegrations(page);if(queue==='companies')renderCompanies(page);if(queue==='calendar')renderCalendar(page);pageHeader(page);return;}
const list=el('section','sd-list');list.setAttribute('aria-label','Request list');list.append(el('h1','',names[queue]),el('p','sd-subtitle',`${company==='All'?'All companies':company} · ${all.filter(r=>statusOf(r)!=='Done').length} open`));const input=el('input','sd-search');input.placeholder='Search name, company, email, request';input.setAttribute('aria-label',input.placeholder);input.value=search;input.oninput=()=>{search=input.value;paintRows();};if(current&&queue==='inbox')list.append(input);if(current&&queue==='inbox'){list.append(companyPills(),pills(['All','Email','Phone','Text','Web'],channel,v=>{remember();channel=v;render();}));}if(queue!=='inbox'||!current)list.append(today(!current&&activity().length>0));const results=el('div');list.append(results);function paintRows(){results.replaceChildren();if(queue==='jobs'&&data?.queues?.jobs?.applicationUnavailable)results.append(el('p','sd-muted','Some applications could not be checked. Showing stored applications.'));let subset=all.filter(r=>(queue==='inbox'||(current&&queueKeys.includes(queue))||r.queue===queue)&&(!search||[displayName(r),companyOf(r),r.queue,r.queue==='kiosk'?'':r.email,r.summary,r.queue==='kiosk'?clean(r.message):r.message].join(' ').toLowerCase().includes(search.toLowerCase()))&&(channel==='All'||channel==='Web'||(r.thread||[]).some(t=>t.kind===({Email:'email',Phone:'call',Text:'sms'}[channel]))));if(data?.unavailable||data?.queues?.[queue]?.unavailable)results.append(el('p','sd-card sd-queue-unavailable','This queue is unavailable. Try refreshing.'));else if(!subset.length){results.append(el('p','sd-card',data?(queue==='jobs'?'No applications yet.':'No requests in this queue.'):'Loading requests…'));if(data)results.append(el('p','sd-instruction','Read the request. Write the reply. Then Email, Call, or Text. Nothing is sent until you press one of those.'));}for(const r of subset)results.append(rowButton(r));}paintRows();if(queue!=='inbox'||!current)list.append(legend());host.append(list);if(current)detail(current);if(current&&queue==='inbox'){const header=el('header','sd-inbox-header');header.append(list.querySelector('h1'),list.querySelector('.sd-subtitle'),input);host.append(header);}else list.querySelector('.sd-subtitle')?.remove();}
function mailBody(message){
 const body=el('div','sd-mail-body');
 if(!message.html){body.textContent=message.text||'Message with attachment';return body;}
 const parsed=new DOMParser().parseFromString(message.html,'text/html');
 const allowed=new Set('a abbr b blockquote br caption code col colgroup dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img li ol p pre s small span strong sub sup table tbody td th thead tr u ul'.split(' '));
 const drop=new Set('script style iframe object embed form input button select textarea svg math link meta base video audio source'.split(' '));
 const url=(value,image=false)=>{try{const u=new URL(value);return (image?['https:','http:']:['https:','http:','mailto:']).includes(u.protocol)?u.href:null;}catch{return null;}};
 function copy(node,parent){
  if(node.nodeType===3){parent.append(document.createTextNode(node.textContent));return;}
  if(node.nodeType!==1||drop.has(node.localName))return;
  if(!allowed.has(node.localName)){for(const child of node.childNodes)copy(child,parent);return;}
  const clean=el(node.localName);
  if(node.localName==='a'){const href=url(node.getAttribute('href'));if(href){clean.href=href;clean.target='_blank';clean.rel='noopener noreferrer';}}
  if(node.localName==='img'){const src=url(node.getAttribute('src'),true);if(!src)return;clean.src=src;clean.alt=node.getAttribute('alt')||'Email image';clean.loading='lazy';clean.referrerPolicy='no-referrer';}
  for(const attr of ['colspan','rowspan'])if(/^[1-9][0-9]?$/.test(node.getAttribute(attr)||''))clean.setAttribute(attr,node.getAttribute(attr));
  for(const child of node.childNodes)copy(child,clean);parent.append(clean);
 }
 for(const child of parsed.body.childNodes)copy(child,body);
 return body;
}
const callPending=new Set(),callResults=new Map();
const callCopy=status=>status==='queued'?'Your phone should ring now. Answer it, then their phone rings.':status==='connect'?'Connect the office phone once. Then press Call again.':['refused','disconnected','unavailable','expired','blocked'].includes(status)?'No call was placed. Please try Call again.':'The call outcome is not confirmed. Do not press Call again yet.';
function showVoiceConnect(){const box=document.querySelector('#kioskx-voice-connect');if(box){box.dataset.deskRequested='true';host.querySelector('.sd-rail').insertBefore(box,host.querySelector('.sd-assistant'));box.hidden=false;}}
async function callPerson(r){
 if(callPending.has(r.id))return null;
 callPending.add(r.id);
 try{
  const result=await api('call',{leadId:r.id,requestId:crypto.randomUUID()});
  if(result.thread){r.thread=[...(r.thread||[]).filter(t=>['inbound','incoming'].includes(t.direction)||t.id&&!t.key),...result.thread].sort((a,b)=>new Date(a.time)-new Date(b.time));const stored=data?.queues?.[r.queue]?.rows.find(x=>x.id===r.id);if(stored)stored.thread=r.thread;}
  callResults.set(r.id,result.status);return result;
 }catch(error){callResults.set(r.id,'unknown');throw error;}
 finally{callPending.delete(r.id);for(const b of host?.querySelectorAll('.sd-person-call')||[]){if(b.dataset.leadId===r.id){b.disabled=false;const feedback=b.parentElement.querySelector('.sd-feedback');feedback.textContent=callCopy(callResults.get(r.id));}}}
}
function renderCalls(page){
 const asked=company;
 page.classList.add('sd-call-page');
 page.append(el('p','sd-call-instruction','Press Call. Your phone rings. Answer it, and their phone rings from the office line.'),el('p','sd-muted',"Customers see this company's office number."));
 const people=el('section','sd-call-people');people.setAttribute('aria-label','People to call');page.append(people);
 const list=rows().filter(r=>matchesCompany(r)&&statusOf(r)!=='Done'&&!r.readOnly&&r.phone);
 const failed=!data||data.unavailable||data.workUnavailable||queueKeys.some(k=>matchesCompany({queue:k})&&data.queues?.[k]?.unavailable);
 if(failed)people.append(el('p','sd-card',data?'People could not be loaded. Refresh to try again.':'Loading people…'));
 else if(!list.length)people.append(el('p','sd-card','No one to call right now.'));
 for(const r of list){
  const row=el('article','sd-card sd-call-person'),copy=el('div','sd-call-person-copy');
  copy.append(el('h2','',r.queue==='kiosk'?'Kiosk inquiry':displayName(r)),el('p','',clean(r.summary||r.message||names[r.queue]+' request').slice(0,180)));
  const feedback=el('p','sd-feedback');feedback.setAttribute('role','status');
  const call=button('Call',async()=>{
   if(callPending.has(r.id)||call.disabled)return;
   call.disabled=true;feedback.textContent='Requesting your call…';
   try{const result=await callPerson(r);if(!result)return;feedback.dataset.status=result.status||'';feedback.textContent=callCopy(result.status);if(result.status==='connect'&&page.isConnected&&company===asked)showVoiceConnect();}
   catch{feedback.dataset.status='unknown';feedback.textContent=callCopy('unknown');}
   finally{call.disabled=failed;}
  },'sd-person-call');
  call.dataset.leadId=r.id;call.disabled=failed||callPending.has(r.id);if(callResults.has(r.id))feedback.textContent=callCopy(callResults.get(r.id));row.append(copy,call,feedback);people.append(row);
 }
 const recent=card('RECENT CALLS','Loading recent calls…');page.append(recent);
 api('quo?company='+encodeURIComponent(asked)).then(result=>{
  if(!page.isConnected||company!==asked)return;
  recent.replaceChildren(el('h3','','RECENT CALLS'));
  if(result?.connected!==true){recent.append(el('p','','Recent calls are unavailable. You can still call a person above.'));return;}
  if(!result.calls?.length)recent.append(el('p','','No recent calls.'));
  for(const item of result.calls||[]){
   const when=item.at&&!isNaN(new Date(item.at))?new Date(item.at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
   const seconds=Math.max(0,Number(item.duration)||0),status=String(item.status||'').toLowerCase();
   const outcome=['answered','completed'].includes(status)?'answered':status==='missed'?'missed':['no-answer','no_answer','unanswered','busy','failed','canceled','cancelled'].includes(status)?'no answer':'outcome not confirmed';
   recent.append(el('p','',`${item.direction==='incoming'?'They called':'You called'} · ${outcome}${seconds?' · '+Math.floor(seconds/60)+'m '+seconds%60+'s':''}${when?' · '+when:''}`));
  }
 }).catch(()=>{if(page.isConnected)recent.replaceChildren(el('h3','','RECENT CALLS'),el('p','','Recent calls are unavailable. You can still call a person above.'));});
}
function renderEmbed(){
 const asked=company,page=el('section','sd-embed sd-mail'),header=el('header','sd-embed-header');
 header.append(el('h1','',queue==='inbox'?company+' · '+desks[company].mail:'Call · '+company));page.append(header);host.append(page);
 if(queue==='call'){renderCalls(page);return;}
 const layout=el('div','sd-mail-layout'),list=el('section','sd-mail-list'),thread=el('section','sd-mail-thread');list.setAttribute('aria-label','Company conversations');thread.setAttribute('aria-label','Mail thread');layout.append(list,thread);page.append(layout);
 const live=()=>page.isConnected&&company===asked;let pageNo=1,selected=null,threadVersion=0,listBusy=false,pollThread=null;
 const notice=el('p','sd-mail-sync');notice.setAttribute('role','status');notice.hidden=true;header.append(notice);
 const emptyThread=()=>thread.replaceChildren(el('p','sd-muted','Choose a conversation to read and reply.'));emptyThread();
 const error=where=>{where.replaceChildren(el('p','sd-muted','Mail is unavailable. Try refreshing.'),button('Refresh',()=>loadList(true)));};
 async function loadList(refresh=false){
  if(listBusy)return;listBusy=true;if(refresh){notice.textContent='Checking for new mail';notice.hidden=false;}
  if(!list.children.length)list.append(el('p','sd-mail-loading','Loading mail…'));
  try{const result=await api('company-mail?company='+encodeURIComponent(asked)+'&page='+pageNo+(refresh?'&refresh=1':''));if(!live())return;
   if(result.unavailable||!Array.isArray(result.conversations))throw Error();
   list.querySelector('.sd-mail-loading')?.remove();
   const existing=new Map([...list.querySelectorAll('.sd-mail-row')].map(b=>[b.dataset.id,b]));
   list.querySelector('.sd-mail-empty')?.remove();list.querySelector('.sd-mail-paging')?.remove();
   for(const [id,b]of existing)if(!result.conversations.some(r=>String(r.id)===id))b.remove();
   notice.hidden=true;if(!result.conversations.length)list.append(el('p','sd-mail-empty',pageNo===1?'No mail for '+asked+' yet.':'No more conversations.'));
   for(const row of result.conversations){let b=existing.get(String(row.id));if(!b){b=button('',()=>openThread(row),'sd-mail-row');b.dataset.id=String(row.id);}b.replaceChildren(el('strong','',row.name),el('span','',row.preview),el('small','',row.status));list.append(b);}
   const paging=el('div','sd-mail-paging');const prev=button('Previous',()=>{pageNo--;loadList();}),next=button('Next',()=>{pageNo++;loadList();});prev.disabled=pageNo===1;next.disabled=!result.more;paging.append(prev,el('span','','Page '+pageNo),next,button('Refresh',()=>{pageNo=1;loadList(true);}));list.append(paging);
  }catch{if(live()){list.querySelector('.sd-mail-loading')?.remove();notice.textContent='Mail could not be checked. Showing stored mail.';notice.hidden=false;}}finally{listBusy=false;}
 }
 async function openThread(row){
  const version=++threadVersion;pollThread=null;selected=row.id;thread.replaceChildren(el('p','sd-muted','Loading conversation…'));
  try{const result=await api('company-mail?company='+encodeURIComponent(asked)+'&conversation='+row.id);if(!live()||version!==threadVersion)return;
   if(result.unavailable){error(thread);return;}
   thread.replaceChildren(el('h2','',row.name));const messages=el('div','sd-mail-messages');messages.setAttribute('aria-label','Messages');thread.append(messages);
   const seen=new Set();const paint=(items,prepend=false)=>{const fragment=document.createDocumentFragment();for(const m of items){if(m.id&&seen.has(m.id))continue;if(m.id)seen.add(m.id);if(m.id&&m.direction==='sent')for(const pending of messages.querySelectorAll('[data-pending-text]'))if(pending.dataset.pendingText===(m.text||''))pending.remove();const box=el('article','sd-mail-message '+m.direction);if(!m.id&&m.direction==='sent')box.dataset.pendingText=m.text||'';box.append(el('small','',m.direction==='received'?'Customer':'Reply · '+asked),mailBody(m));if(m.attachments)box.append(el('p','sd-muted',m.attachments+' attachment(s) in the original message.'));fragment.append(box);}prepend?messages.prepend(fragment):messages.append(fragment);};paint(result.messages||[]);
   let older=result.older;const earlier=button('Earlier messages',async()=>{earlier.disabled=true;try{const r=await api('company-mail?company='+encodeURIComponent(asked)+'&conversation='+row.id+'&before='+older);if(!live()||version!==threadVersion)return;if(r.unavailable)throw Error();paint(r.messages||[],true);older=r.older;earlier.hidden=!older;}catch{earlier.textContent='Retry earlier messages';}finally{earlier.disabled=false;}});earlier.hidden=!older;thread.insertBefore(earlier,messages);
   const form=el('form','sd-mail-reply'),label=el('label','','Reply from '+desks[asked].mail),field=el('textarea');field.setAttribute('aria-label','Mailbox reply');field.placeholder='Write your reply';field.maxLength=10000;label.append(field);
   const status=el('p','sd-feedback');status.setAttribute('role','status');const send=button('Send');send.type='submit';send.disabled=true;let submitted=false;field.oninput=()=>{send.disabled=submitted||!field.value.trim();};
   form.onsubmit=async event=>{event.preventDefault();if(submitted||!field.value.trim()||!live()||selected!==row.id)return;submitted=true;send.disabled=true;field.disabled=true;status.textContent='Submitting reply…';try{const r=await api('company-reply',{company:asked,conversation:row.id,text:field.value});if(!live()||version!==threadVersion)return;status.textContent=r.message||'Delivery is unconfirmed. Do not resend.';if(r.status==='accepted'){paint([{direction:'sent',text:field.value}]);field.value='';submitted=false;field.disabled=false;}if(['blocked','unavailable','failed'].includes(r.status)){submitted=false;field.disabled=false;send.disabled=!field.value.trim();}}catch{if(live())status.textContent='Delivery is unconfirmed. Do not resend.';}};
   form.append(label,send,status);thread.append(form);
   pollThread=async()=>{const r=await api('company-mail?company='+encodeURIComponent(asked)+'&conversation='+row.id);if(live()&&version===threadVersion&&!r.unavailable)paint(r.messages||[]);};
  }catch{if(live()&&version===threadVersion)error(thread);}
 }
 loadList();
 const timer=setInterval(async()=>{if(!live()){clearInterval(timer);return;}if(document.hidden)return;await loadList();try{await pollThread?.();}catch{}},15000);
}
function pageHeader(page){const header=el('header','sd-page-header');header.append(page.querySelector('h1'));const subtitle=page.querySelector('.sd-subtitle');if(subtitle)header.append(subtitle);const tools=el('div','sd-header-tools');if(queue==='knowledge'){const search=el('input','sd-article-search');search.placeholder='Search articles';search.setAttribute('aria-label','Search articles');search.oninput=()=>{for(const row of page.querySelectorAll('.sd-article'))row.hidden=!row.textContent.toLowerCase().includes(search.value.toLowerCase());};tools.append(search);}if(queue==='knowledge'||queue==='companies'){const action=page.querySelector(':scope > button');if(action)tools.append(action);}if(queue==='insights'){const periods=page.querySelector('.sd-pills');if(periods)tools.append(periods);}header.append(tools);page.prepend(header);}
function renderToday(page,all){if(company==='AniDeeBee')crewOverview(page);const a=activity().filter(t=>matchesCompany(t.row));page.append(el('p','sd-subtitle',new Date().toLocaleDateString([],{weekday:'long'})+' · '+a.length+' actions sent'),kpis([['Emails sent',a.filter(t=>t.kind==='email').length],['Calls placed',a.filter(t=>t.kind==='call').length],['Texts sent',a.filter(t=>t.kind==='sms').length]]),companyPills());const log=card('TODAY');if(unavailable())log.append(el('p','','Today: activity unavailable.'));else if(!a.length)log.append(el('p','','Today: nothing sent.'));for(const t of a){const line=el('div','sd-log-row');line.append(el('time','',time(t.time)),chip(companyOf(t.row)),el('span','',names[t.row.queue]+' — '+displayName(t.row)),chip(t.kind==='email'?'Email sent':t.kind==='sms'?'Text sent':t.status==='queued'?'Call queued':'Call placed'));log.append(line);}page.append(log,el('p','sd-muted','No email addresses or phone numbers are shown in Today.'));const todo=card('STILL TO DO TODAY');for(const r of all.filter(r=>['New','Call next'].includes(statusOf(r))))todo.append(rowButton(r));if(!todo.querySelector('.sd-row'))todo.append(el('p','','No requests need a first contact or call.'));todo.append(button('Open Queues',()=>navigate('queues')));const aside=el('aside','sd-today-aside');aside.append(todo,legend());page.append(aside);}
function renderQueues(page,all){page.append(el('p','sd-subtitle','Pick a queue to work. Counts come from real requests.'),el('h2','','Connected queues'));const grid=el('div','sd-grid');for(const [q,description]of [['cleaning','Deep cleaning requests'],['cars','Car rental requests'],['jobs','Job applications'],['kiosk','Questions about machines']]){if(!matchesCompany({queue:q}))continue;const c=card(names[q],description);c.append(el('p','sd-muted',q==='kiosk'?'KioskX':'AniDeeBee'));for(const status of ['New','Call next','Waiting','Done']){const n=all.filter(r=>r.queue===q&&statusOf(r)===status).length;if(n)c.append(chip(n+' '+status));}if(!all.some(r=>r.queue===q))c.append(chip('All clear'));if(data?.queues?.[q]?.unavailable)c.append(el('p','','This queue is unavailable. Try refreshing.'));c.append(button('Open queue →',()=>navigate(q)));grid.append(c);}page.append(grid);page.append(el('p','sd-muted','Status chips do not send anything. Nothing is sent until an agent presses Email, Call or Text.'));}
const articles=[
['Deep cleaning: what is included','Cleaning','Read the service, bedrooms, bathrooms, size, ZIP, date and laundry notes on the request. Confirm the requested scope before quoting. Do not promise extra services that the request does not include.'],
['Car for work: how a one-week request works','Cars','A request does not reserve a car. Read the vehicle, purpose, location and duration, then confirm availability and the details with the customer.'],
['Text to India is blocked','Policies','Text messages to numbers in India are blocked. Do not try another sender to bypass this. Use an available contact channel after reviewing the request.'],
['Kiosk contacts stay hidden','Kiosks','Kiosk inquiry email addresses and phone numbers stay hidden. Use Email as KioskX, Call their phone or Text their phone from the request.'],
['Appointment reminder fills the reply and does not send','Cleaning','Enter the appointment time and press Appointment reminder. Review the date on the request and the reply, then press Email or Text to send it.'],
['MVP scoping call: what to ask','Quotes','This article is not written yet.'],['Standard quote turnaround','Quotes','This article is not written yet.']];
function articleLink(i){return location.origin+'/welcome#desk-article='+i;}
function insertArticle(i,feedback){const r=rows().find(r=>r.id===(open||lastRequest));if(!r||!matchesCompany(r)){feedback.textContent='Open a request in Queues first, then insert a link.';return;}if(unavailable()||data.queues?.[r.queue]?.unavailable){feedback.textContent='This queue is unavailable. Try refreshing.';return;}remember();drafts[r.id]=[drafts[r.id]??r.draft??'',articles[i][0]+': '+articleLink(i)].filter(Boolean).join('\n\n');navigate(r.queue,r.id);}
function renderKnowledge(page){page.append(el('p','sd-subtitle','Answers agents can link in a reply'));const notice=el('p','sd-feedback');notice.setAttribute('role','status');page.append(button('New article',()=>{notice.textContent='A new article is not saved from this desk yet.';}),notice);const grid=el('div','sd-knowledge'),categories=card('CATEGORIES');for(const c of ['All articles','Getting started','Cleaning','Cars','Jobs','Kiosks','Quotes','Policies']){const b=button(c,()=>{category=c;render();});b.setAttribute('aria-pressed',String(c===category));categories.append(b);}const list=el('div','sd-article-list');list.append(pills(['All',...companies],articleCompany,v=>{articleCompany=v;render();}));let count=0;articles.forEach((a,i)=>{if((category==='All articles'||a[1]===category)&&(articleCompany==='All'||articleCompany===(i===3?'KioskX':i<5?'AniDeeBee':i<7?'ToBa Tech':'Kiosk X'))){count++;const b=button('',()=>{article=i;render();},'sd-article');b.setAttribute('aria-pressed',String(article===i));b.append(el('strong','',a[0]),el('p','sd-muted',a[1]));list.append(b);}});if(!count)list.append(el('p','','No articles in this category.'));const preview=card('PREVIEW');preview.append(chip(article===3?'KioskX':article<5?'AniDeeBee':article<7?'ToBa Tech':'Kiosk X'),el('h2','',articles[article][0]),el('p','',articles[article][2]));const feedback=el('p','sd-feedback');preview.append(button('Insert link in reply',()=>insertArticle(article,feedback)),el('p','sd-muted','Adds a link to the reply box. Does not send.'),feedback);grid.append(categories,list,preview);page.append(grid);}
function renderInsights(page,all){page.append(pills(['Today','7 days','30 days'],period===1?'Today':period+' days',v=>{period=v==='Today'?1:parseInt(v);render();}));const since=new Date();since.setHours(0,0,0,0);since.setDate(since.getDate()-period+1);const recent=all.filter(r=>r.when&&new Date(r.when)>=since),events=all.flatMap(r=>(r.thread||[]).filter(t=>new Date(t.time)>=since&&((['email','sms'].includes(t.kind)&&t.status==='sent')||(t.kind==='call'&&['sent','completed','queued'].includes(t.status)))));page.append(el('p','sd-subtitle',`Last ${period} ${period===1?'day':'days'} · ${company==='All'?'All companies':company}`),kpis([['Open requests',all.filter(r=>statusOf(r)!=='Done').length],['Avg first reply','—'],['Resolved',all.filter(r=>statusOf(r)==='Done').length],['Need attention',all.filter(r=>['Call next','Waiting'].includes(statusOf(r))).length]]));const grid=el('div','sd-grid'),byCompany=card('REQUESTS BY COMPANY'),byChannel=card('BY CHANNEL');for(const c of companies){const n=recent.filter(r=>deskOf(r)===c).length,line=el('div','sd-bar-row');line.append(el('span','',c),el('strong','',n));const bar=el('div','sd-bar');bar.style.width=(n/Math.max(1,recent.length)*100)+'%';line.append(bar);byCompany.append(line);}for(const [label,kind]of [['Email','email'],['Phone','call'],['Text','sms'],['Web form',null]]){const line=el('p','sd-log-row');line.append(el('span','',label),el('strong','',kind?events.filter(t=>t.kind===kind).length:recent.length));byChannel.append(line);}grid.append(byCompany,byChannel);page.append(grid);const needs=card('NEEDS ATTENTION');for(const r of all.filter(r=>['Call next','Waiting'].includes(statusOf(r))))needs.append(rowButton(r,'Open'));if(!needs.querySelector('.sd-row'))needs.append(el('p','','No requests need attention.'));page.append(needs);}

function renderEngagement(page){
 const asked=company,live=()=>page.isConnected&&company===asked;
 page.append(el('p','sd-subtitle',asked+' · '+appIds[asked]));
 const status=el('p','sd-feedback','Loading company tools…');page.append(status);
 api('company-engagement?company='+encodeURIComponent(asked)).then(state=>{
  if(!live())return;if(state.unavailable)throw Error();status.textContent="Nothing sends until you press that path's button.";
  const input=(parent,label,type)=>{const wrap=el('label'),f=el('input');f.type=type;f.setAttribute('aria-label',label);wrap.append(el('span','',label),f);parent.append(wrap);return f;};
  const site=card('Read their site','Reads one public page and shows a short summary. It does not save a lead, send email, or send a text.');site.classList.add('sd-lead-form');
  const website=input(site,'Lead website','url'),siteFeedback=el('p','sd-feedback',state.site?'Enter a public page to read.':'Site reading is not connected.');siteFeedback.setAttribute('role','status');let reading=false;
  const validateSite=()=>{read.disabled=reading||!state.site||!website.value||!website.validity.valid;};
  const read=button('Read their site',async()=>{validateSite();if(read.disabled||!live())return;reading=true;validateSite();siteFeedback.textContent='Reading this page…';try{const r=await api('company-site',{company:asked,website:website.value});if(live())siteFeedback.textContent=r.summary||'This site could not be read.';}catch{if(live())siteFeedback.textContent='This site could not be read.';}finally{reading=false;validateSite();}});
  website.oninput=validateSite;site.append(read,siteFeedback);page.append(site);validateSite();
  const outbound=card('Outbound lead');outbound.classList.add('sd-lead-form');
  const crm=card('Save to CRM','Saves this lead to '+asked+' in the CRM. No email or text is sent.');
  const name=input(crm,'Name','text'),email=input(crm,'Email','email'),phone=input(crm,'Phone (optional)','tel');name.maxLength=200;phone.maxLength=40;
  if(!state.lead)crm.append(el('p','','CRM save is not connected for this company.'));
  const mail=card('Email',state.mail?.message||'Mail Studio is unavailable.'),recipient=input(mail,'Email recipient','email');
  const templateWrap=el('label'),templates=el('select');templates.setAttribute('aria-label','Mail Studio template');templateWrap.append(el('span','','Mail Studio template'),templates);const placeholder=el('option','','Choose a template');placeholder.value='';templates.append(placeholder);
  for(const t of state.mail?.templates||[]){const o=el('option','',t.name+(t.available?'':' — unavailable'));o.value=t.id;o.disabled=!t.available;templates.append(o);}
  const subject=el('p','sd-template-subject');mail.append(templateWrap,subject);const consent=input(mail,'Consent to email','checkbox');
  const sms=card('Text','Texts are for US and Canada numbers with consent. India numbers are blocked.');if(!state.sms)sms.append(el('p','','Text sending is unavailable.'));
  const number=input(sms,'Text phone','tel');number.placeholder='+1';number.maxLength=40;
  const message=el('textarea');message.setAttribute('aria-label','Text message');message.maxLength=1600;sms.append(message);const smsConsent=input(sms,'Consent to SMS','checkbox');
  // The server validates US/Canada using libphonenumber before Telnyx is called.
  const outsideUSCanada=new Set(['242','246','264','268','284','340','345','441','473','649','658','664','670','671','684','721','758','767','784','787','809','829','849','868','869','876','939']);
  const northAmerica=()=>{const value=number.value.replace(/[\s().-]/g,'');return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(value)&&!outsideUSCanada.has(value.slice(2,5));};
  const validEmail=f=>!!f.value&&f.validity.valid;
  const paths=[{kind:'lead',panel:crm,label:'Save lead to CRM — no email',valid:()=>state.lead&&validEmail(email)},
   {kind:'email',panel:mail,label:'Send email',valid:()=>validEmail(recipient)&&consent.checked&&state.mail?.templates?.some(t=>t.id===templates.value&&t.available)},
   {kind:'sms',panel:sms,label:'Send text',valid:()=>state.sms&&northAmerica()&&smsConsent.checked&&message.value.trim()}];
  for(const path of paths){let submitting=false,locked=false;const feedback=el('p','sd-feedback');feedback.setAttribute('role','status');
   const validate=()=>{send.disabled=submitting||locked||!path.valid();const t=state.mail?.templates?.find(t=>t.id===templates.value);subject.textContent=t?'Subject: '+t.subject:'';};
   const send=button(path.label,async()=>{validate();if(send.disabled||!live())return;submitting=true;validate();for(const f of path.panel.querySelectorAll('input,textarea,select'))f.disabled=true;feedback.textContent='Submitting…';
    try{const r=await api('company-send',{company:asked,kind:path.kind,name:path.kind==='lead'?name.value:'',email:path.kind==='email'?recipient.value:path.kind==='lead'?email.value:'',phone:path.kind==='sms'?number.value:path.kind==='lead'?phone.value:'',text:path.kind==='sms'?message.value:'',template:path.kind==='email'?templates.value:'',emailConsent:path.kind==='email'&&consent.checked,smsConsent:path.kind==='sms'&&smsConsent.checked});if(live())feedback.textContent=r.message;locked=!['blocked','failed','unavailable'].includes(r.status);}catch{locked=true;if(live())feedback.textContent='Outcome is unconfirmed. Do not resend.';}finally{submitting=false;if(!locked)for(const f of path.panel.querySelectorAll('input,textarea,select'))f.disabled=false;validate();}
   });
   for(const f of path.panel.querySelectorAll('input,textarea,select')){f.addEventListener('input',validate);f.addEventListener('change',validate);}path.panel.append(send,feedback);outbound.append(path.panel);validate();
  }
  page.append(outbound);
  const router=state.gojiberry||{status:'not_configured',statusReason:'Router admin contract is not configured.',deliveries:[]},section=card('Gojiberry','Events received for this company. Nothing is sent from here.');
  section.append(el('p','sd-gojiberry-status',router.status==='not_provisioned'?router.statusReason:'Status: '+router.status.replaceAll('_',' ')));if(router.status!=='not_provisioned')section.append(el('p','sd-muted',router.statusReason));if(router.deliveries?.length)section.append(table(['Event','Time','Delivery status'],router.deliveries.map(r=>[r.eventType,r.time?new Date(r.time).toLocaleString():'—',r.status])));page.append(section);
 }).catch(()=>{if(live())status.textContent='Company tools are unavailable. Try refreshing.';});
}
function renderIntegrations(page){
 page.append(el('p','sd-subtitle','Integrations › Email · one mailbox per company, one App ID per company'));
 const steps=el('div','sd-stepper');['Choose company','Connect mailbox','Send a test','Set routing'].forEach((text,i)=>{const step=el('span');step.append(el('b','',String(i+1)),document.createTextNode(text));steps.append(step);});page.append(steps);
 const layout=el('div','sd-settings-grid'),left=el('div'),right=el('aside');
 const selected=company,mail=desks[selected].mail;
 const c=card('1  COMPANY');c.append(pills(companies,selected,v=>{company=v;render();}),el('p','','App ID'),el('div','sd-read-field',appIds[selected]),el('p','sd-muted','Tickets, customers and articles for this company stay under this App ID.'));
 const mailbox=card('2  MAILBOX'),providers=el('div','sd-providers');for(const name of ['Google Workspace','Microsoft 365','Other (IMAP)'])providers.append(el('span','',name));mailbox.append(providers,el('p','','Mailbox address'),el('div','sd-read-field',mail||'Not connected'),el('p','','Send replies as'),el('div','sd-read-field',mail?selected:'Not connected'),el('p','sd-muted','Shown as the sender name. Replies go out only when an agent presses Email.'));
 const feedback=el('p','sd-feedback');feedback.setAttribute('role','status');const explain=()=>{feedback.textContent='A new company mailbox is not connected from this screen.';};mailbox.append(button('Connect Google mailbox',explain),button('Send test email',explain),el('p','sd-muted','You approve access on the provider page. Passwords are never typed or stored here.'),feedback);
 const connected=card('CONNECTED MAILBOXES');for(const name of companies){const row=el('div','sd-mailbox-row'),copy=el('div');copy.append(el('strong','',name),el('p','sd-muted',desks[name].mail));row.append(copy,chip('Chatwoot inbox'));connected.append(row);}
 const how=card('HOW IT WORKS');['Incoming replies appear only where inbound mail is connected.','Form requests open in Queues; received mail opens in Inbox.','You read it, write the reply, then press Email.','Other companies never see this mailbox.'].forEach((text,i)=>how.append(el('p','sd-how-step',(i+1)+'  '+text)));
 left.append(c,mailbox,card('4  ROUTING RULES','Routing cannot be changed from this screen.'));right.append(connected,how);layout.append(left,right);page.append(layout);
}
function table(headers,records){const t=el('table'),head=el('thead'),tr=el('tr');headers.forEach(h=>tr.append(el('th','',h)));head.append(tr);const body=el('tbody');for(const record of records){const row=el('tr');record.forEach(v=>row.append(el('td','',v)));body.append(row);}t.append(head,body);const wrap=el('div','sd-card sd-table');wrap.append(t);return wrap;}
let calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1),calendarPoll;
function renderCalendar(page){
 clearInterval(calendarPoll);
 const asked=company,live=()=>page.isConnected&&company===asked&&queue==='calendar';
 const wrap=el('div','sd-calendar'),status=el('p','sd-calendar-status','Loading calendar…');status.setAttribute('role','status');page.append(wrap);
 const style=el('style');style.textContent=`.sd-calendar{font-family:Arial,sans-serif;min-width:0}.sd-calendar-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:20px 0}.sd-calendar-toolbar h2{margin:0 auto 0 0!important;font-family:inherit!important}.sd-calendar-scroll{overflow-x:auto}.sd-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-width:560px;border-top:1px solid #cbd5e1;border-left:1px solid #cbd5e1}.sd-calendar-weekday,.sd-calendar-day{padding:8px;border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1}.sd-calendar-weekday{background:#e8edf3;font-weight:600}.sd-calendar-day{min-height:112px;background:#fff;min-width:0}.sd-calendar-outside{background:#f1f5f9;color:#64748b}.sd-calendar-number{display:inline-grid;place-items:center;width:28px;height:28px;margin-bottom:6px}.sd-calendar-today .sd-calendar-number{border-radius:50%;background:#1f3a5f;color:white;font-weight:700}.sd-calendar-event{display:block;background:#e4edff;color:#173458;border-left:3px solid #42699c;border-radius:4px;padding:5px;margin:3px 0;font-size:12px;overflow-wrap:anywhere}.sd-calendar-event time{display:block;font-weight:700}.sd-calendar-status{color:#334155;line-height:1.5}.sd-calendar-toolbar button,.sd-calendar-form button{min-height:40px}.sd-calendar-form{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:0 0 12px}.sd-calendar-form input{min-height:40px;border:1px solid #cbd5e1;border-radius:6px;padding:8px}.sd-calendar-connect{margin-top:16px}`;page.append(style);
 let version=0,loading=false,editing=null,last=null;
 const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 function grid(events){
  const scroll=el('div','sd-calendar-scroll'),g=el('div','sd-calendar-grid');g.setAttribute('aria-label','Month calendar');scroll.append(g);
  for(const day of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])g.append(el('div','sd-calendar-weekday',day));
  const first=new Date(calendarMonth);first.setDate(1-first.getDay());const last=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,0),count=Math.ceil((calendarMonth.getDay()+last.getDate())/7)*7;
  for(let i=0;i<count;i++){
   const date=new Date(first);date.setDate(first.getDate()+i);const dayKey=key(date),cell=el('div','sd-calendar-day'+(date.getMonth()!==calendarMonth.getMonth()?' sd-calendar-outside':'')+(dayKey===key(new Date())?' sd-calendar-today':''));cell.dataset.date=dayKey;cell.setAttribute('aria-label',date.toLocaleDateString([],{dateStyle:'full'}));const number=el('span','sd-calendar-number',date.getDate());if(dayKey===key(new Date()))number.setAttribute('aria-current','date');cell.append(number);
   for(const event of events){
    const start=event.allDay?event.start:key(new Date(event.start)),end=event.allDay?event.end:key(new Date(new Date(event.end).getTime()-1));
    if(!start||dayKey<start||(event.allDay?dayKey>=(end||start+'z'):dayKey>(end||start)))continue;
    const chip=el('div','sd-calendar-event'),when=event.allDay?'All day':dayKey===start?new Date(event.start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'Continues';chip.append(el('time','',when),el('span','',event.title));if(event.id){const edit=button('Edit',()=>{editing=event;paint(last);});edit.setAttribute('aria-label','Edit '+event.title);chip.append(edit);}cell.append(chip);
   }g.append(cell);
  }return scroll;
 }
 function eventForm(){
  const form=el('form','sd-calendar-form'),title=el('input'),date=el('input'),start=el('input'),end=el('input'),feedback=el('p','sd-calendar-status','');
  title.setAttribute('aria-label','Event title');title.maxLength=140;title.placeholder='Event title';title.value=editing?.title&&editing.title!=='Appointment'?editing.title:'';
  date.type='date';date.setAttribute('aria-label','Event date');start.type='time';start.setAttribute('aria-label','Start time');end.type='time';end.setAttribute('aria-label','End time');
  if(editing?.start&&!editing.allDay){const s=new Date(editing.start),e=new Date(editing.end),p=n=>String(n).padStart(2,'0');date.value=`${s.getFullYear()}-${p(s.getMonth()+1)}-${p(s.getDate())}`;start.value=`${p(s.getHours())}:${p(s.getMinutes())}`;end.value=`${p(e.getHours())}:${p(e.getMinutes())}`;}
  const save=el('button','',editing?'Save event':'Add event');save.type='submit';form.append(title,date,start,end,save);
  if(editing?.id)form.append(button('Delete event',()=>write({action:'delete',id:editing.id},feedback)));
  form.onsubmit=e=>{e.preventDefault();const startAt=new Date(`${date.value}T${start.value}`),endAt=new Date(`${date.value}T${end.value}`);if(!title.value.trim()||Number.isNaN(startAt.getTime())||!(endAt>startAt)){feedback.textContent='Add a title, a start, and a later end.';return;}write({action:editing?'update':'create',id:editing?.id,title:title.value.trim(),start:startAt.toISOString(),end:endAt.toISOString()},feedback);};
  form.append(feedback);return form;
 }
 async function write(body,feedback){
  feedback.textContent=body.action==='delete'?'Deleting event…':'Saving event…';
  try{const r=await api('calendar',{company:asked,...body});if(!live())return;if(r.unavailable||r.connected===false){feedback.textContent=r.message||'The event was not saved. Try again.';return;}editing=null;load(true);}
  catch{if(live())feedback.textContent='The event was not saved. Try again.';}
 }
 function paint(result){
  last=result;wrap.replaceChildren();
  if(result.connected===false){const note=el('p','sd-calendar-status','No calendar is connected for '+asked+'.');wrap.append(note,button('Connect calendar',()=>{note.textContent='Ask your administrator to connect the Google calendar for '+asked+'. Calendar connection is managed by your administrator.';},'sd-calendar-connect'));return;}
  const toolbar=el('div','sd-calendar-toolbar');toolbar.append(el('h2','',calendarMonth.toLocaleDateString([],{month:'long',year:'numeric'})),button('Previous month',()=>move(-1)),button('Today',()=>{calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);load(true);}),button('Next month',()=>move(1)));wrap.append(toolbar,status);
  status.textContent=result.message||(result.events?.length?'Times shown in '+Intl.DateTimeFormat().resolvedOptions().timeZone+'.':'No events this month. Times shown in '+Intl.DateTimeFormat().resolvedOptions().timeZone+'.');
  if(!result.unavailable)wrap.append(eventForm());
  wrap.append(grid(result.unavailable?[]:result.events||[]));
 }
 function move(delta){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+delta,1);load(true);}
 async function load(force=false){
  if(!live()||loading&&!force)return;loading=true;const current=++version;
  if(force||!wrap.children.length){wrap.replaceChildren(status);status.textContent='Loading calendar…';}
  try{const response=await fetch('/kioskx-hired-desk/calendar?company='+encodeURIComponent(asked)+'&month='+key(calendarMonth).slice(0,7),{headers:{Authorization:'Bearer '+token()},cache:'no-store'});if(!live()||current!==version)return;if(response.status===401||response.status===403){wrap.replaceChildren(status,button('Retry',()=>load(true)));status.textContent='Sign in on the support desk to manage this calendar.';return;}if(!response.ok)throw Error();const result=await response.json();if(wrap.querySelector('.sd-calendar-form :focus'))return;paint(result);}
  catch{if(live()&&current===version){wrap.replaceChildren(status,button('Retry',()=>load(true)));status.textContent='Calendar is temporarily unavailable. Please try again.';}}
  finally{if(current===version)loading=false;}
 }
 load();calendarPoll=setInterval(()=>{if(!live()){clearInterval(calendarPoll);return;}load();},20000);
}

function renderCompanies(page){
 page.append(el('p','sd-subtitle','Each company has its own App ID, branding, mailbox and data'));
 const feedback=el('p','sd-feedback');feedback.setAttribute('role','status');const explain=()=>{feedback.textContent='A new company is not created from this screen yet.';};page.append(button('Add company',explain),feedback);
 const companyTable=table(['COMPANY','APP ID','EMAIL','PHONE','MEMBERS',''],companies.map((c,i)=>[c,appIds[c],'Chatwoot inbox','Fonoster','—','']));
 [...companyTable.querySelectorAll('tbody tr')].forEach((row,i)=>{const cells=row.children;cells[0].replaceChildren(el('span','sd-avatar',companies[i][0]),el('strong','',companies[i]));for(const n of [2,3])cells[n].replaceChildren(chip(cells[n].textContent));cells[5].append(button('Manage',()=>{company=companies[i];navigate('integrations');}));});
 page.append(companyTable);const layout=el('div','sd-settings-grid'),permissions=card('WHO CAN DO WHAT');permissions.append(table(['','Admin','Agent','Viewer'],[['Read requests','✓','✓','✓'],['Reply by email','✓','✓','—'],['Call and text','✓','✓','—'],['Private notes','✓','✓','—'],['Change routing','✓','—','—'],['Manage companies','✓','—','—'],['View insights','✓','✓','✓']]));const add=card('ADD A COMPANY IN 3 STEPS');['Name, logo and brand color.','Create its App ID. Its data stays isolated.','Connect its mailbox and, if needed, Google Voice.'].forEach((text,i)=>add.append(el('p','sd-how-step',(i+1)+'  '+text)));add.append(button('Start',explain));layout.append(permissions,add);page.append(layout);
}
function crewOverview(page){
 const c=card('WORKER HOURS AND PAYOUT REQUESTS');page.append(c);
 const load=async()=>{try{
  const d=await api('crew-jobs');if(!c.isConnected)return;if(d.unavailable)throw Error();
  c.replaceChildren(el('h3','','WORKER HOURS AND PAYOUT REQUESTS'),button('Refresh hours',load));
  if(!d.jobs.length)c.append(el('p','','No jobs assigned.'));
  const workers=new Map();for(const j of d.jobs){if(!workers.has(j.phone))workers.set(j.phone,[]);workers.get(j.phone).push(j);}
  const hours=j=>j.punch_in?Math.max(0,((j.punch_out||Date.now()/1000)-j.punch_in)/3600):0;
  for(const [phone,jobs]of workers){
   const row=el('section','sd-crew-worker');row.append(el('h4','',`${jobs[0].role||'Worker'} •••${phone.slice(-4)} · ${jobs.reduce((n,j)=>n+hours(j),0).toFixed(2)} hours`));
   for(const j of jobs)row.append(el('p','',`${j.name} · ${j.address}, ${j.city||''} · ${j.punch_out?'Punched out':j.punch_in?'On the clock':j.arrived?'At the address':j.travel==='on_the_way'?'On the way':'Not started'} · ${hours(j).toFixed(2)} hours${j.payout_requested?' · Payout requested':''}`));
   c.append(row);
  }
  c.append(el('p','','Payroll is not connected. No money moves.'));
 }catch{if(!c.isConnected)return;c.replaceChildren(el('p','','Worker hours are unavailable.'),button('Refresh hours',load));}};load();
}
function crewCard(r){
 const c=card('ASSIGN A HIRED WORKER','Assigning does not send a message. The worker sees this job after mobile verification.');c.classList.add('sd-crew-card');
 const status=el('div'),form=el('form');form.className='sd-crew-form';const inputs={};
 for(const [key,title,type] of [['phone','Worker mobile (+1)','tel'],['name','Service','text'],['address','Street address','text'],['city','City','text'],['time','Date and time at the job','datetime-local']]){
  const label=el('label','',title),input=el('input');input.type=type;input.required=true;input.name=key;input.setAttribute('aria-label',title);input.style.width='100%';if(key==='name')input.value=r.service||'';label.append(input);form.append(label);inputs[key]=input;
 }
 const role=el('select');role.setAttribute('aria-label','Worker role');for(const [v,t]of(r.queue==='cleaning'?[['cleaner','Cleaner']]:[['driver','Driver'],['rental','Rental helper']])){const o=el('option','',t);o.value=v;role.append(o);}form.append(role);
 const submit=el('button','','Assign job');submit.type='submit';form.append(submit);const feedback=el('p');
 const show=j=>{status.replaceChildren();if(!j){status.append(el('p','','Not assigned'));return;}const h=j.punch_in?Math.max(0,((j.punch_out||Date.now()/1000)-j.punch_in)/3600):0;status.append(el('p','',`${j.phone} — ${j.punch_out?'Punched out':j.punch_in?'On the clock':j.arrived?'At the address':j.travel==='on_the_way'?'On the way':'Not started'}`),el('p','',`${j.name} · ${j.address}, ${j.city} · ${j.time.replace('T',' ')}`),el('p','',`${h>0&&h<.01?'<0.01':h.toFixed(2)} hours${j.payout_requested?' · Payout requested — office review needed':''}`));if(j.arrived)status.append(el('p','','Worker marked at the address'));status.append(el('p','','Payroll is not connected. No money moves.'));};
 const load=async()=>{try{const d=await api('crew-jobs');if(!c.isConnected)return;if(d.unavailable)throw Error(d.message);show(d.jobs.find(j=>j.source_id===r.id));}catch{if(!c.isConnected)return;status.textContent='Worker status is unavailable. Refresh to try again.';}};
 form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;feedback.textContent='Saving…';try{const d=await api('crew-assign',{id:r.id,role:role.value,...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]))});feedback.textContent=d.ok?'Assigned. No message was sent.':d.message||'Assignment was not saved.';if(d.ok)await load();}catch{feedback.textContent='Assignment was not saved. Try again.';}finally{submit.disabled=false;}};
 c.append(status,button('Refresh worker status',load),form,feedback);if(unavailable()){for(const input of c.querySelectorAll('input,select,button'))input.disabled=true;status.textContent='Request unavailable. Refresh the queue.';}else load();return c;
}
function detail(r){const privateKiosk=r.queue==='kiosk',safe=v=>privateKiosk?clean(v):String(v??'');const center=el('section','sd-center');const voiceAnchor=el('div','hired-actions');voiceAnchor.hidden=true;center.append(voiceAnchor);center.setAttribute('aria-label','Open request');const heading=el('header','sd-heading');heading.append(el('h2','',displayName(r)),chip(r.status||'New'),el('span','sd-chip',queue==='inbox'?companyOf(r):names[r.queue]));center.append(heading);if(['cleaning','cars'].includes(r.queue))center.append(crewCard(r));
if(r.resume)center.append(resumeLink(r));if(r.readOnly){center.append(fields('APPLICATION',r.fields||[]),fields('CONTACT',[['Email',r.email||'Not provided'],['Phone',r.phone||'Not provided']]));host.append(center);return;}
const pairs=r.fields?.length?r.fields: [['Message',r.message||(privateKiosk?r.description:'')||'No message was submitted.']];center.append(fields('WHAT THEY ASKED',pairs.map(([k,v])=>[k,safe(v)])));if(r.queue==='cars')center.append(el('p','sd-muted','This request does not reserve a car.'));center.append(el('h3','sd-section-title','CONVERSATION'));
const conversation=el('div','sd-conversation');const bubble=(label,text,cls='',stamp='')=>{const box=el('article','sd-card sd-message '+cls);const h=el('header');h.append(el('strong','',label),el('time','',time(stamp)));box.append(h,el('p','',safe(text)));return box;};
const paintThread=()=>{conversation.replaceChildren();conversation.append(bubble(displayName(r),r.message||(privateKiosk?r.description:'')||'No message was submitted.','',r.when));for(const t of r.thread||[]){const incoming=['incoming','inbound'].includes(t.direction);const sent=t.status==='sent'||incoming;const label=incoming?(t.kind==='sms'?'Incoming · Text':'Incoming · Email'):t.kind==='email'?`You (${privateKiosk?'KioskX':'AniDeeBee'}) · Email`:t.kind==='sms'?'You · Text':t.kind==='note'?'Private note. Not sent.':'You · Call';conversation.append(bubble(label,(sent?t.text:[t.message,t.text].filter(Boolean).join('\n'))||t.message,incoming?'sd-incoming':t.kind==='note'?'sd-note':'sd-outgoing',t.time));}if(r.note)conversation.append(bubble('Private note. Not sent.',r.note,'sd-note'));};paintThread();center.append(conversation);for(const [kind,label]of [['email','mail'],['sms','texts']]){const connected=data?.queues?.[r.queue]?.[kind==='email'?'inboundMail':'inboundSms'];if(!connected)center.append(el('p','sd-muted',`Inbound ${label} ${kind==='sms'?'are':'is'} not in this desk yet.`));}
const composer=el('section','sd-card sd-composer'),tabs=el('div','sd-tabs'),field=el('textarea');field.setAttribute('aria-label','Reply');field.placeholder='Write a reply…';field.value=drafts[r.id]??r.draft??'';field.maxLength=10000;let tab='Reply',draft=field.value,note=r.note||'';const feedback=el('p','sd-feedback');feedback.setAttribute('role','status');const blocked=unavailable();
const controls=[];
if(!dismissed.has(r.id)){const ai=card('AI draft. Not sent. Review before using.');ai.classList.add('sd-ai-draft');const name=displayName(r),first=name==='Kiosk inquiry'||name==='Inquiry'?'':name.split(/\s+/)[0];const starter=`Hi${first?' '+first:''}, thanks for your ${r.queue==='kiosk'?'inquiry':r.queue==='jobs'?'application':r.queue==='cars'?'car request':'cleaning request'}. I will confirm the details shortly.`;ai.append(el('p','',starter));const use=button('Use draft',()=>{field.value=starter;draft=starter;tab='Reply';saveButton.hidden=true;field.setAttribute('aria-label','Reply');for(const b of tabs.children)b.setAttribute('aria-selected',String(b.textContent==='Reply'));lock();});const dismiss=button('Dismiss',()=>{dismissed.add(r.id);ai.remove();});controls.push(use,dismiss);ai.append(use,dismiss);if(queue==='inbox')center.append(ai);else{const draftTools=el('details','sd-draft-tools');draftTools.append(el('summary','','AI assistant'),el('p','','Drafts replies and finds articles. Never sends by itself.'),ai);host.querySelector('.sd-assistant').replaceChildren(draftTools);}}

const status=el('select','sd-chip');status.setAttribute('aria-label','Next step');for(const value of ['New','Call next','Waiting','Done']){const o=el('option','',value);o.value=value;status.append(o);}status.value=r.status||'New';status.className=chip(status.value).className;heading.querySelector('.sd-chip').replaceWith(status);controls.push(status);
status.onchange=async()=>{if(busy)return;busy=true;lock();try{await save({status:status.value});status.className=chip(status.value).className;feedback.textContent='Next step saved. Nothing sent.';for(const b of host.querySelectorAll('.sd-row'))if(b.getAttribute('aria-pressed')==='true')b.querySelector('.sd-chip').replaceWith(chip(status.value));}catch{status.value=r.status||'New';feedback.textContent='Next step has not been saved.';}finally{busy=false;lock();}};
const save=async patch=>{const result=await api('queue-work',{id:r.id,...patch});if(!result.saved)throw Error('Save failed');Object.assign(r,result.work);const original=data.queues[r.queue].rows.find(x=>x.id===r.id);Object.assign(original,result.work);};
const saveButton=button('Save private note',async()=>{if(busy)return;busy=true;lock();try{await save({note:field.value});note=field.value;feedback.textContent='Private note saved. Not sent.';paintThread();}catch{feedback.textContent='Your note has not been saved. Try again.';}finally{busy=false;lock();}});saveButton.hidden=true;
for(const t of ['Reply','Private note','Email']){const b=button(t,()=>{if(tab==='Private note')note=field.value;else draft=field.value;tab=t;field.value=t==='Private note'?note:draft;field.setAttribute('aria-label',t);saveButton.hidden=t!=='Private note';for(const x of tabs.children)x.setAttribute('aria-selected',String(x===b));lock();});b.setAttribute('role','tab');b.setAttribute('aria-selected',String(t==='Reply'));tabs.append(b);controls.push(b);}tabs.setAttribute('role','tablist');composer.append(tabs,field,saveButton);controls.push(field,saveButton);
if(r.queue==='cleaning'){const row=el('div','sd-reminder'),label=el('label','','Appointment time'),input=el('input');input.setAttribute('aria-label','Appointment time');input.placeholder='10:30 AM';input.maxLength=80;const b=button('Appointment reminder',()=>{const value=input.value.trim();if(tab==='Private note'){note=field.value;tab='Reply';saveButton.hidden=true;for(const x of tabs.children)x.setAttribute('aria-selected',String(x.textContent==='Reply'));}field.value=value?`You have an appointment tomorrow at ${value}.${r.appointmentDate?' Date on the request: '+r.appointmentDate+'.':''}`:'Add the appointment time, then use Appointment reminder.';draft=field.value;field.setAttribute('aria-label','Reply');lock();});label.append(input);row.append(label,b);composer.append(row,el('p','sd-muted','Fills the reply. Does not send.'));controls.push(input,b);}
center.append(composer,el('p','sd-instruction','Read the request. Write the reply. Then Email, Call, or Text. Nothing is sent until you press one of those.'));
const actions=el('div','sd-actions');const action=async kind=>{if(busy||blocked||tab==='Private note')return;busy=true;lock();try{if(kind!=='call')await save({draft:field.value});const result=kind==='call'?await callPerson(r):await api('queue-send',{id:r.id,kind});if(!result)return;feedback.dataset.status=result.status||'';feedback.textContent=kind==='call'?callCopy(result.status):safe(result.message);r.thread=result.thread?[...(r.thread||[]).filter(t=>['inbound','incoming'].includes(t.direction)||t.id&&!t.key),...result.thread].sort((a,b)=>new Date(a.time)-new Date(b.time)):r.thread;data.queues[r.queue].rows.find(x=>x.id===r.id).thread=r.thread;paintThread();if(result.status==='connect')showVoiceConnect();}catch{feedback.dataset.status='error';feedback.textContent=kind==='call'?callCopy('unknown'):'Outcome is unconfirmed. Refresh before trying again.';}finally{busy=false;lock();}};
const send=button(privateKiosk?'Email as KioskX':'Email as AniDeeBee',()=>action('email'));const call=button('Call their phone',()=>action('call'));const sms=button('Text their phone',()=>action('sms'));actions.append(send,call,sms);center.append(actions,el('p','sd-muted sd-action-help','Email sends the reply above. Call rings their phone from the office Google Voice after this browser is connected. Text sends the reply to a US phone. A number in India is blocked.'),feedback);
function lock(){for(const c of controls)c.disabled=blocked||busy;send.disabled=blocked||busy||tab==='Private note'||!data.mailEnabled;call.disabled=blocked||busy||tab==='Private note';sms.disabled=blocked||busy||tab==='Private note'||!data.smsEnabled;}lock();if(blocked){feedback.dataset.status='error';feedback.textContent='This queue is unavailable. Try refreshing.';}
const side=el('aside','sd-right');if(queue==='inbox')side.append(card('AI ASSIST',safe(r.message||r.summary||'No message was submitted.')));const suggested=card('SUGGESTED ARTICLES'),idx=r.queue==='cleaning'?0:r.queue==='cars'?1:r.queue==='kiosk'?3:2,insertFeedback=el('p','sd-feedback');suggested.append(el('p','',articles[idx][0]));const insert=button('Insert link in reply',()=>insertArticle(idx,insertFeedback));insert.disabled=blocked||busy;suggested.append(insert,insertFeedback);controls.push(insert);if(queue==='inbox')side.append(suggested);side.append(fields('CONTACT',[['Email',privateKiosk?'Hidden':r.email||'No email'],['Phone',privateKiosk?'Hidden':r.phone||'No phone'],['Queue',names[r.queue]],['Received',r.when?new Date(r.when).toLocaleString():'Not recorded']],'sd-contact'));const ticket=el('section','sd-card sd-ticket');ticket.append(el('h3','','TICKET (ZAMMAD'));if(r.ticket&&typeof r.ticket==='object'){ticket.append(fields('',Object.entries(r.ticket).filter(([k,v])=>['title','state','priority','group'].includes(k)&&typeof v==='string').map(([k,v])=>[k,safe(v)])));}else ticket.append(el('p','','No ticket yet.'));side.append(ticket);host.append(center,side);
}
const css=el('style');css.textContent=`
body .hired-desk > :not(#support-desk):not(#sd-workspaces){display:none!important} body .hired-desk{display:block!important;background:#f3f5f9!important} #support-desk{position:fixed;inset:0;z-index:1000;display:grid;grid-template-columns:200px minmax(0,1fr);color:#1f3a5f;background:#f3f5f9;font:13px/1.45 Inter,Arial,sans-serif;text-align:left}#support-desk *{box-sizing:border-box}#support-desk button,#support-desk input,#support-desk textarea{font:inherit;color:inherit}#support-desk button{cursor:pointer}#support-desk button:disabled{opacity:.5;cursor:default}#support-desk h1,#support-desk h2,#support-desk h3,#support-desk p{margin:0}#support-desk h1{font-size:23px;line-height:32px;margin-bottom:10px}#support-desk h3{font-size:11px;letter-spacing:1px;color:#64748b;margin-bottom:8px}#support-desk .sd-rail{background:#f8fafc;border-right:1px solid #dce2ec;padding:22px 16px;overflow:auto}#support-desk .sd-rail h2{font-size:23px;letter-spacing:-.7px}#support-desk .sd-brand{font-size:10px;color:#a8761f;letter-spacing:1.5px;font-weight:700}#support-desk nav{margin-top:25px;display:grid;gap:4px}#support-desk nav button{display:flex;justify-content:space-between;align-items:center;border:0;background:transparent;border-radius:11px;padding:9px 12px;text-align:left;font-size:14px}#support-desk nav button[aria-pressed=true]{background:#e3e9f2;font-weight:700}#support-desk nav button span{font-size:12px;color:#64748b}#support-desk .sd-list{padding:15px 16px;overflow:auto;min-width:0}#support-desk .sd-card,#support-desk .sd-today{background:white;border:1px solid #dce2ec;border-radius:15px;padding:16px}#support-desk .sd-today{border-radius:12px;padding:11px 12px;margin-bottom:10px}#support-desk summary{cursor:pointer;font-weight:700;font-size:13px}#support-desk .sd-today p{margin-top:10px;font-size:12px}#support-desk .sd-today p:before{content:'•';margin-right:8px}#support-desk .sd-row{display:flex;align-items:center;gap:12px;width:100%;background:white;border:1px solid #dce2ec;border-radius:15px;padding:12px;margin-bottom:10px;text-align:left;min-height:64px}#support-desk .sd-row[aria-pressed=true]{border-color:#1f3a5f}#support-desk .sd-avatar{width:36px;height:36px;flex:0 0 36px;border-radius:11px;display:grid;place-items:center;background:#e3e9f2;font-weight:700;font-size:14px}#support-desk .sd-row[aria-pressed=true] .sd-avatar{background:#1f3a5f;color:white}#support-desk .sd-row-copy{flex:1;min-width:0}#support-desk .sd-row-copy strong{font-size:14px;display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}#support-desk small{font-size:10px;color:#a8761f;letter-spacing:.7px;margin-left:7px;text-transform:uppercase;font-weight:700}#support-desk .sd-preview{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:#64748b}#support-desk .sd-row-end{text-align:right;flex-shrink:0;display:grid;justify-items:end;gap:3px}#support-desk time{font-size:11px;color:#64748b}#support-desk select.sd-chip{border:0;font-family:inherit;color:inherit;cursor:pointer}#support-desk .sd-chip{background:#e3e9f2;border-radius:20px;font-size:11px;line-height:21px;padding:0 10px;white-space:nowrap;display:inline-block}#support-desk .sd-new{background:#dde9f4;color:#2f5f8a}#support-desk .sd-call-next{background:#f6e8c9;color:#a8761f}#support-desk .sd-waiting{background:#e3e9f2;color:#64748b}#support-desk .sd-done{background:#dcefe2;color:#2f7a4f}#support-desk .sd-legend{padding:14px;margin-top:10px;border-radius:12px}#support-desk .sd-legend p{display:flex;align-items:center;gap:10px;margin-top:7px;font-size:12px}#support-desk .sd-muted{color:#64748b;font-size:12px}#support-desk.sd-open{grid-template-columns:200px 360px minmax(360px,1fr) 340px}#support-desk .sd-open .sd-list{border-right:1px solid #dce2ec}#support-desk .sd-center{padding:24px 28px;overflow:auto;min-width:0;border-left:1px solid #dce2ec;border-right:1px solid #dce2ec}#support-desk .sd-heading{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}#support-desk .sd-heading h2{font-size:28px;letter-spacing:-.8px;line-height:40px}#support-desk dl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px 12px;margin:0}#support-desk dt{color:#64748b}#support-desk dd{margin:0;font-weight:600;overflow-wrap:anywhere;color:#1f3a5f;background:transparent}#support-desk .sd-section-title{margin:18px 0 16px}#support-desk .sd-message{padding:14px;margin-bottom:10px;border-radius:14px}#support-desk .sd-message header{display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px}#support-desk .sd-message p{white-space:pre-wrap;overflow-wrap:anywhere}#support-desk .sd-outgoing{background:#e6eef9;border-color:#e6eef9}#support-desk .sd-note{background:#fbf2d8;border:1px dashed #ba7a00}#support-desk .sd-note strong{color:#a8761f}#support-desk .sd-composer{margin-top:18px}#support-desk .sd-tabs{display:flex;background:#f8fafc;padding:4px;border-radius:12px;gap:3px;margin-bottom:12px}#support-desk .sd-tabs button{border:1px solid transparent;background:transparent;border-radius:8px;padding:6px 14px;font-size:12px}#support-desk .sd-tabs button[aria-selected=true]{background:white;border-color:#dce2ec;font-weight:700}#support-desk textarea{width:100%;min-height:80px;resize:vertical;background:#f8fafc;border:1px solid #dce2ec;border-radius:11px;padding:12px}#support-desk .sd-reminder{display:flex;align-items:center;gap:8px;margin:12px 0 7px;flex-wrap:wrap}#support-desk .sd-reminder label{display:flex;gap:8px;align-items:center;font-size:12px}#support-desk input{background:white;border:1px solid #dce2ec;border-radius:10px;width:86px;padding:8px}#support-desk .sd-composer>button,#support-desk .sd-reminder button{background:#e3e9f2;border:0;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:600}#support-desk .sd-instruction{margin:18px 0;font-weight:600}#support-desk .sd-actions{display:flex;gap:10px}#support-desk .sd-actions button{flex:1;background:white;border:1px solid #1f3a5f;border-radius:12px;padding:11px 8px;font-size:12px;font-weight:600;white-space:nowrap}#support-desk .sd-actions button:first-child{background:#1f3a5f;color:white}#support-desk .sd-action-help{margin-top:18px;line-height:1.5}#support-desk .sd-feedback{margin-top:10px}#support-desk .sd-right{padding:17px 16px;overflow:auto}#support-desk .sd-right .sd-card{margin-bottom:14px}#support-desk .sd-right dl{grid-template-columns:150px minmax(0,1fr)}#support-desk .sd-ticket h3{text-transform:uppercase}#support-desk [hidden]{display:none!important}
@media(max-width:1200px){#support-desk.sd-open{grid-template-columns:180px 280px minmax(330px,1fr)}#support-desk .sd-right{grid-column:3}#support-desk .sd-center{grid-row:1 / span 2}#support-desk .sd-right{display:none}#support-desk .sd-center{padding:20px} }
@media(max-width:700px){#support-desk,#support-desk.sd-open{position:absolute;min-height:100vh;height:auto;grid-template-columns:1fr;overflow:auto}#support-desk .sd-rail{padding:12px}#support-desk nav{display:flex;flex-wrap:wrap;margin-top:10px}#support-desk .sd-list,#support-desk .sd-center,#support-desk .sd-right{grid-column:1;grid-row:auto;overflow:visible;display:block}#support-desk .sd-center{padding:16px}#support-desk dl{grid-template-columns:120px minmax(0,1fr)}#support-desk .sd-actions{flex-wrap:wrap}}

#support-desk .sd-call-page{overflow:auto;min-width:0;padding:24px;display:block}
#support-desk .sd-call-instruction{font-size:16px;line-height:1.6;margin:16px 0 8px}
#support-desk .sd-call-people{margin:20px 0}
#support-desk .sd-call-person{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;margin-bottom:12px;align-items:center}
#support-desk .sd-call-person-copy{min-width:0;overflow-wrap:anywhere}
#support-desk .sd-call-person h2{font-size:18px;margin:0 0 6px}
#support-desk .sd-call-person .sd-feedback{grid-column:1/-1;margin:0;overflow-wrap:anywhere}
#support-desk .sd-person-call{background:#1f3a5f;color:white;border:0;border-radius:10px;min-height:44px;min-width:70px;padding:10px 18px;cursor:pointer}
#support-desk .sd-person-call:disabled{opacity:.6;cursor:wait}
@media(max-width:700px){#support-desk .sd-call-page{padding:16px}#support-desk .sd-call-person{padding:14px}}
/* Support Desk: shared cream chrome and responsive work areas. */
#support-desk{grid-template-columns:232px minmax(0,1fr);color:#1f3a5f}
#support-desk.sd-open{grid-template-columns:232px 360px minmax(340px,1fr) 280px}
#support-desk .sd-rail{background:#f8fafc;border-color:#dce2ec;padding:24px 16px;display:flex;flex-direction:column;gap:0}
#support-desk .sd-rail h2{font-size:20px;font-weight:800;letter-spacing:-.4px}
#support-desk .sd-brand{font-size:9px;font-weight:700;color:#a8761f;letter-spacing:1.1px}
#support-desk .sd-switcher{display:block;background:white;border:1px solid #dce2ec;border-radius:12px;padding:12px;margin-top:26px}
#support-desk .sd-crew-card button{display:inline-block;background:white;color:#1f3a5f;border:1px solid #dce2ec;border-radius:10px;padding:9px 12px;margin:10px 0;font:600 12px Inter,Arial,sans-serif;cursor:pointer}
#support-desk .sd-crew-form{display:grid;gap:12px;margin-top:8px}
#support-desk .sd-crew-form label{display:grid;gap:6px;font-size:12px;color:#64748b}
#support-desk .sd-crew-form select{width:100%;padding:10px;border:1px solid #dce2ec;border-radius:10px;background:white;color:#1f3a5f;font:inherit}
#support-desk .sd-crew-form button[type=submit]{justify-self:start;background:#1f3a5f;color:white;margin:0}
#support-desk .sd-crew-card button:disabled{opacity:.5;cursor:default}
#support-desk .sd-crew-worker{padding:12px 0;border-bottom:1px solid #dce2ec}
#support-desk .sd-switch-line{display:flex;align-items:center;margin-top:6px;gap:8px}
#support-desk .sd-switcher select{min-width:0;width:100%;border:0;background:white;color:#1f3a5f;font:600 12px Inter,Arial,sans-serif}
#support-desk .sd-dots{display:flex;padding-left:4px}#support-desk .sd-dots i{width:10px;height:10px;border:1px solid white;border-radius:50%;background:#a8761f;margin-left:-4px}#support-desk .sd-dots i:nth-child(2){background:#679892}#support-desk .sd-dots i:nth-child(3){background:#a292bc}
#support-desk nav{margin:20px 0;gap:5px}#support-desk nav button[aria-pressed=true]{background:#e3e9f2}
#support-desk nav .sd-subnav{margin-left:20px;font-size:12px;padding:7px 12px}
#support-desk .sd-assistant{margin-top:auto;background:#ece7f8;padding:14px;font-size:11px}
#support-desk .sd-assistant h3{color:#5b4a9e;font-size:12px;letter-spacing:0;text-transform:none}
#support-desk .sd-card,#support-desk .sd-today,#support-desk .sd-row{border-color:#dce2ec;border-radius:12px}
#support-desk .sd-new{background:#dde9f4;color:#2f5f8a}#support-desk .sd-call-next{background:#f6e8c9;color:#a8761f}#support-desk .sd-waiting{background:#e3e9f2;color:#64748b}#support-desk .sd-done{background:#dcefe2;color:#2f7a4f}
#support-desk .sd-muted,#support-desk .sd-subtitle,#support-desk dt,#support-desk time,#support-desk .sd-preview{color:#64748b}
#support-desk small{color:#a8761f}#support-desk .sd-avatar{background:#e3e9f2}
#support-desk .sd-list{padding:28px 24px}#support-desk.sd-open .sd-list{padding:22px 14px}
#support-desk .sd-subtitle{margin-bottom:20px;font-size:12px}
#support-desk input.sd-search{width:100%;margin-bottom:16px;padding:11px 12px;border-color:#dce2ec}
#support-desk .sd-page{padding:30px 32px;overflow:auto;min-width:0}
#support-desk .sd-page>.sd-card,#support-desk .sd-page>.sd-grid,#support-desk .sd-page>.sd-muted{margin:18px 0}
#support-desk .sd-page h2{font-size:17px;margin:18px 0 12px}
#support-desk .sd-page button,#support-desk .sd-right button,#support-desk .sd-ai-draft button{background:white;border:1px solid #dce2ec;border-radius:8px;padding:8px 12px;margin:7px 5px 7px 0}
#support-desk .sd-pills{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0 14px}
#support-desk .sd-pills button{border:1px solid #dce2ec;border-radius:16px;padding:4px 9px;background:white;font-size:11px;margin:0}
#support-desk .sd-pills button[aria-pressed=true],#support-desk .sd-knowledge button[aria-pressed=true]{background:#e3e9f2}
#support-desk .sd-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:20px 0}
#support-desk .sd-number{display:block;font-size:28px;font-weight:700;margin-top:8px}
#support-desk .sd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
#support-desk .sd-grid .sd-chip{margin:10px 4px 4px 0}#support-desk .sd-grid button{display:block}
#support-desk .sd-log-row{display:flex;align-items:center;gap:18px;border-bottom:1px solid #dce2ec;padding:12px 0;flex-wrap:wrap}
#support-desk .sd-log-row>span:nth-child(3){flex:1}
#support-desk .sd-knowledge{display:grid;grid-template-columns:170px minmax(240px,1fr) minmax(250px,.8fr);gap:18px;margin-top:20px}
#support-desk .sd-knowledge>.sd-card:first-child button{display:block;width:100%;text-align:left;border:0;margin:3px 0}
#support-desk .sd-article{display:block;width:100%;text-align:left;padding:16px!important;margin:0 0 8px!important}
#support-desk .sd-knowledge p{margin:12px 0;line-height:1.7}
#support-desk .sd-bar-row{display:flex;flex-wrap:wrap;justify-content:space-between;margin:14px 0}
#support-desk .sd-bar{height:7px;background:#a8761f;margin-top:6px;border-radius:4px}
#support-desk .sd-stepper{display:flex;justify-content:space-between;gap:12px;background:white;border:1px solid #dce2ec;border-radius:12px;padding:18px;flex-wrap:wrap}
#support-desk table{width:100%;border-collapse:collapse;text-align:left}#support-desk th{font-size:10px;letter-spacing:1px;color:#64748b}#support-desk td,#support-desk th{padding:14px;border-bottom:1px solid #dce2ec}
#support-desk .sd-table{overflow:auto}#support-desk .sd-ai-draft{background:#ece7f8;margin:16px 0}#support-desk .sd-ai-draft h3{letter-spacing:0;font-size:12px;color:#5b4a9e}
#support-desk .sd-center{padding:24px 20px}#support-desk .sd-heading h2{font-size:25px}#support-desk .sd-right dl{grid-template-columns:65px minmax(0,1fr)}
#support-desk .sd-right p{overflow-wrap:anywhere}#support-desk .sd-right{padding:22px 14px}
#support-desk :focus-visible{outline:2px solid #a8761f;outline-offset:2px}
body .hired-desk>#kioskx-voice-connect{display:block!important;position:fixed;z-index:1001;right:16px;bottom:16px;max-width:360px}body .hired-desk>#kioskx-voice-connect[hidden]{display:none!important}
@media(max-width:1250px){#support-desk.sd-open{grid-template-columns:232px 300px minmax(330px,1fr);overflow:auto}#support-desk .sd-center{grid-row:auto}#support-desk .sd-right{display:block;grid-column:3;grid-row:2}#support-desk.sd-open .sd-rail,#support-desk.sd-open .sd-list{grid-row:1 / span 2}#support-desk .sd-knowledge{grid-template-columns:140px 1fr}#support-desk .sd-knowledge>.sd-card:last-child{grid-column:2}}
@media(max-width:850px){#support-desk,#support-desk.sd-open{position:fixed;display:block;overflow:auto;height:100dvh}#support-desk .sd-rail{height:auto;padding:16px}#support-desk nav{display:flex;flex-wrap:wrap;margin:10px 0}#support-desk .sd-switcher{margin-top:14px;max-width:260px}#support-desk .sd-assistant{display:none}#support-desk .sd-page,#support-desk .sd-list,#support-desk .sd-center,#support-desk .sd-right{padding:18px;overflow:visible}#support-desk .sd-knowledge{display:block}#support-desk .sd-knowledge>*{margin:14px 0}#support-desk .sd-actions{flex-wrap:wrap}#support-desk .sd-row-copy strong{font-size:13px}#support-desk .sd-row-copy small{display:block;margin-left:0}}

#support-desk .sd-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
#support-desk .sd-account{padding-top:12px;display:grid;gap:6px;font-size:12px;overflow-wrap:anywhere}
#support-desk .sd-account button{background:white;border:1px solid #1f3a5f;border-radius:10px;padding:8px 12px;text-align:left}
#support-desk .sd-session-status:empty{display:none}
#support-desk .sl-brand{display:flex;gap:10px;align-items:center;height:36px;flex-shrink:0}
#support-desk .sl-brand strong{font-size:18px;font-weight:800;letter-spacing:-.5px;white-space:nowrap}
#support-desk .sl-brand small{display:block;margin:0;font-size:9px;letter-spacing:1px;color:#a8761f}
#support-desk .sl-mark{position:relative;display:grid;place-items:center;border-radius:8px;background:#1f3a5f;color:white;width:34px;height:34px;font-size:30px;line-height:1;font-weight:800}
#support-desk .sl-mark i{position:absolute;right:8px;top:7px;width:4px;height:4px;border-radius:50%;background:white}
#support-desk .sd-rail{padding:16px}
#support-desk .sd-switcher{margin-top:4px;padding:10px 12px;border-color:#1f3a5f;min-height:63px}
#support-desk nav{margin:16px 0;gap:4px}
#support-desk nav button{height:37px;padding:9px 12px;font-weight:500}
#support-desk nav .sd-subnav{height:30px;margin-left:0;padding-left:28px}
#support-desk .sd-assistant{border:0;border-radius:12px;padding:12px;font-size:12px;line-height:17px}
#support-desk .sd-assistant h3{margin-bottom:4px}
#support-desk .sd-card{border-radius:16px}
#support-desk .sd-row{background:transparent;border-radius:14px}
#support-desk .sd-row[aria-pressed=true]{background:white}
#support-desk .sd-list{padding:16px}
#support-desk .sd-list h1{font-size:22px;line-height:28px;margin-bottom:10px;font-weight:800}
#support-desk{grid-template-rows:minmax(0,1fr)}#support-desk>.sd-page,#support-desk>.sd-rail{min-height:0}#support-desk .sd-page{padding:0 28px 28px}
#support-desk .sd-page-header{position:relative;margin:0 -28px 28px;padding:20px 28px 18px;border-bottom:1px solid #dce2ec;min-height:91px}
#support-desk .sd-page-header h1{font-size:26px;line-height:32px;font-weight:800;margin:0}
#support-desk .sd-page-header .sd-subtitle{margin:0;font-size:13px}
#support-desk .sd-header-tools{position:absolute;right:28px;top:19px}
#support-desk .sd-header-tools>button{background:#1f3a5f;color:white;border-color:#1f3a5f}
#support-desk .sd-feedback:empty{display:none}
#support-desk .sd-kpis{margin:0 0 16px;gap:14px}
#support-desk .sd-kpis .sd-card{padding:16px 18px;min-height:89px}
#support-desk .sd-number{margin:0;font-size:28px;font-weight:800}
#support-desk .sd-kpis h3{font-size:12px;font-weight:400;letter-spacing:0;text-transform:none;margin:0}
#support-desk .sd-page .sd-pills button{border:0;padding:2px 9px}
#support-desk .sd-pills button[aria-pressed=true]{background:#1f3a5f;color:white}
#support-desk .sd-knowledge{grid-template-columns:190px minmax(0,1fr) 360px;gap:20px;align-items:start;margin-top:0}
#support-desk .sd-knowledge>.sd-card:first-child{background:transparent;border:0;padding:0}
#support-desk .sd-knowledge>.sd-card:first-child button{background:transparent;height:32px;padding:6px 12px}
#support-desk .sd-knowledge button[aria-pressed=true]{background:#e3e9f2}
#support-desk .sd-article{min-height:65px;background:transparent;margin-bottom:8px!important;border-radius:14px!important;padding:14px!important}
#support-desk .sd-article p{margin:0;line-height:18px}
#support-desk .sd-article-list .sd-article:first-child{background:white;border-color:#1f3a5f}
#support-desk .sd-stepper{padding:0;border:0;background:transparent;gap:10px;margin:0 0 20px}
#support-desk .sd-stepper span{flex:1;border:1px solid #dce2ec;border-radius:14px;padding:16px 12px;background:#f8fafc}
#support-desk .sd-bar-row{display:grid;grid-template-columns:90px minmax(0,1fr) 30px;gap:12px;align-items:center}
#support-desk .sd-bar-row .sd-bar{grid-column:2;grid-row:1;margin:0;height:22px;border-radius:5px;background:#30648e}
#support-desk .sd-bar-row strong{grid-column:3;grid-row:1}
#support-desk .sd-center{padding:24px 28px}
#support-desk .sd-heading h2{font-size:28px;font-weight:800}
#support-desk .sd-right{padding:16px}
#support-desk .sd-right dl{grid-template-columns:96px minmax(0,1fr)}
#support-desk dl{grid-template-columns:124px minmax(0,1fr);gap:6px 12px}
#support-desk .sd-center>.sd-card:first-of-type{padding:18px}
#support-desk .sd-ai-draft{border:1px dashed #6951bb}
#support-desk .sd-inbox-header{position:relative;grid-column:2 / -1;grid-row:1;padding:20px 28px;border-bottom:1px solid #dce2ec}
#support-desk .sd-inbox-header h1{font-size:26px;margin:0;font-weight:800}
#support-desk .sd-inbox-header .sd-search{position:absolute;right:28px;top:26px;width:267px;margin:0}
@media(min-width:1251px){
 #support-desk.sd-open{grid-template-columns:232px 360px minmax(0,1fr) 340px}
 #support-desk.sd-open .sd-list{padding:16px}
 #support-desk.sd-inbox-open{grid-template-columns:232px 360px minmax(0,1fr) 330px;grid-template-rows:91px minmax(0,1fr)}
 #support-desk.sd-inbox-open .sd-rail{grid-row:1 / 3}
 #support-desk.sd-inbox-open .sd-list,#support-desk.sd-inbox-open .sd-center,#support-desk.sd-inbox-open .sd-right{grid-row:2}
 #support-desk.sd-inbox-open .sd-center{padding:22px 24px}
 #support-desk .sd-page-today{position:relative;padding-right:388px}
 #support-desk .sd-page-today>.sd-page-header{margin-right:-388px}
 #support-desk .sd-today-aside{position:absolute;right:28px;top:119px;width:340px}
 #support-desk .sd-today-aside .sd-row{border:0;padding:6px 0;min-height:34px;margin:0;gap:8px}
 #support-desk .sd-today-aside .sd-avatar,#support-desk .sd-today-aside .sd-preview,#support-desk .sd-today-aside time{display:none}
 #support-desk .sd-page-today>.sd-card{padding:8px}
 #support-desk .sd-page-today>.sd-card h3{display:none}
}

#support-desk .sd-settings-grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:20px;align-items:start;margin-top:20px}
#support-desk .sd-settings-grid>div>.sd-card,#support-desk .sd-settings-grid>aside>.sd-card{margin-bottom:16px;padding:20px}
#support-desk .sd-read-field{padding:10px 14px;background:#f8fafc;border:1px solid #dce2ec;border-radius:10px;margin:4px 0 8px;min-height:40px}
#support-desk .sd-settings-grid .sd-muted{margin:8px 0}
#support-desk .sd-providers{display:flex;gap:8px;margin:12px 0 16px}
#support-desk .sd-providers span{flex:1;border:1px solid #dce2ec;border-radius:10px;padding:12px;background:#f8fafc}
#support-desk .sd-settings-grid .sd-pills button{border:1px solid #dce2ec;border-radius:10px;padding:10px 14px}
#support-desk .sd-mailbox-row{display:flex;gap:12px;justify-content:space-between;align-items:center;margin:10px 0}
#support-desk .sd-mailbox-row p{margin:0!important}
#support-desk .sd-how-step{margin:12px 0!important;line-height:19px}
#support-desk .sd-stepper b{display:inline-grid;place-items:center;width:26px;height:26px;background:#e3e9f2;border-radius:50%;margin-right:10px}
#support-desk .sd-stepper span{padding:12px}
#support-desk .sd-page-companies>.sd-table{padding:8px}
#support-desk .sd-page-companies>.sd-table td{height:69px;padding:12px}
#support-desk .sd-page-companies>.sd-table td:first-child .sd-avatar{display:inline-grid;vertical-align:middle;margin-right:10px}
#support-desk .sd-page-companies .sd-settings-grid>.sd-card{padding:20px}
#support-desk .sd-page-companies .sd-settings-grid .sd-table{border:0;padding:0}
#support-desk .sd-page-companies .sd-settings-grid td,#support-desk .sd-page-companies .sd-settings-grid th{padding:8px 0}
#support-desk .sd-page-companies .sd-settings-grid th:not(:first-child),#support-desk .sd-page-companies .sd-settings-grid td:not(:first-child){width:70px;text-align:center}
#support-desk .sd-article-search{width:160px;margin-right:12px}
#support-desk .sd-article-list .sd-article{background:transparent;border-color:#dce2ec}
#support-desk .sd-article-list .sd-article[aria-pressed=true]{background:white;border-color:#1f3a5f}
#support-desk .sd-draft-tools{margin:10px 0;font-size:12px}
#support-desk .sd-draft-tools .sd-ai-draft{margin:8px 0}
#support-desk .sd-switcher .sd-brand{font-size:11px;letter-spacing:1px;color:#64748b}
#support-desk .sd-switcher select{font-size:13px}
#support-desk .sd-settings-grid button{border-color:#1f3a5f;font-weight:600}
#support-desk .sd-settings-grid button:first-of-type{background:#1f3a5f;color:white}
@media(max-width:1050px){#support-desk .sd-settings-grid{grid-template-columns:1fr}#support-desk .sd-knowledge{grid-template-columns:160px minmax(0,1fr)}#support-desk .sd-knowledge>.sd-card:last-child{grid-column:2}}

#support-desk .sd-page-queues h2{font-size:15px;line-height:18px;margin:22px 0 10px}
#support-desk .sd-page-queues .sd-grid{margin:10px 0 20px;gap:12px}
#support-desk .sd-page-queues .sd-grid .sd-card{border-color:#2f5f8a;padding:16px;min-height:120px}
#support-desk .sd-page-queues .sd-card h3{font-size:16px;letter-spacing:0;font-weight:700;color:#1f3a5f;margin-bottom:4px}
#support-desk .sd-page-queues .sd-card p{font-size:12px;color:#64748b}
#support-desk .sd-page-queues .sd-grid .sd-chip{margin:4px 4px 0 0}
#support-desk .sd-page-queues .sd-grid button{background:none;border:0;padding:0;margin:4px 0 0;font-weight:700;color:#2f5f8a}
#support-desk .sd-disconnected-queues{display:grid;grid-template-columns:repeat(2,296px);gap:12px}
#support-desk .sd-disconnected-queues .sd-card{min-height:120px;border-color:#2f7a4f}
#support-desk .sd-disconnected-queues:nth-last-of-type(1) .sd-card{border-color:#c26a1b}
#support-desk .sd-connected,#support-desk .sd-google-voice,#support-desk .sd-all-clear{background:#dcefe2;color:#2f7a4f}
#support-desk .sd-not-connected,#support-desk .sd-not-set{background:#f6e8c9;color:#a8761f}
#support-desk .sd-page-insights .sd-grid{gap:20px}
#support-desk .sd-page-insights .sd-grid .sd-card{padding:20px}
#support-desk .sd-page-insights .sd-log-row{border:0;padding:5px 0;justify-content:space-between}
#support-desk .sd-page-insights .sd-kpis .sd-card:nth-child(3) .sd-number{color:#2f7a4f}
#support-desk .sd-page-insights .sd-kpis .sd-card:nth-child(4) .sd-number{color:#b3382b}
#support-desk .sd-knowledge>.sd-card:last-child{padding:22px}
#support-desk .sd-knowledge>.sd-card:last-child h2{font-size:20px;font-weight:800;line-height:25px;margin:12px 0}
#support-desk .sd-knowledge>.sd-card:last-child button{background:#1f3a5f;color:white;border-color:#1f3a5f;font-weight:600}
#support-desk .sd-knowledge>.sd-card:first-child button[aria-pressed=true]{background:#e3e9f2;font-weight:700}
#support-desk .sd-article-list>.sd-pills{margin:0 0 8px}
#support-desk .sd-page-companies>.sd-table button{margin:0;border-color:#1f3a5f;font-weight:600;padding:10px 16px}
#support-desk .sd-page-companies>.sd-table th{padding:10px 12px}
#support-desk .sd-page-companies>.sd-table tr:last-child td{border-bottom:0}
#support-desk .sd-dots i{background:#2f5f8a}#support-desk .sd-dots i:nth-child(2){background:#2f7a4f}#support-desk .sd-dots i:nth-child(3){background:#c26a1b}
#support-desk .sd-row-copy strong{font-weight:700}#support-desk .sd-chip{font-weight:600}
#support-desk h1,#support-desk .sd-heading h2{letter-spacing:-.6px}
@media(max-width:850px){#support-desk .sd-disconnected-queues{grid-template-columns:1fr}}

#support-desk .sd-logo{width:34px;height:34px;flex-shrink:0}
#support-desk .sd-assistant .sd-draft-tools{margin:0}
#support-desk .sd-assistant summary{list-style:none;color:#5b4a9e;font-size:12px;margin-bottom:4px}
#support-desk .sd-assistant summary::-webkit-details-marker{display:none}
#support-desk .sd-assistant .sd-ai-draft{padding:8px;font-size:12px}
#support-desk.sd-inbox-open .sd-list{padding:14px}
#support-desk.sd-inbox-open .sd-list>.sd-pills{margin:0 0 8px;gap:6px}
#support-desk.sd-inbox-open .sd-list>.sd-pills button{border:0;padding:2px 9px;line-height:16px;font-size:11px}
#support-desk.sd-inbox-open .sd-list>.sd-pills:nth-of-type(2) button{background:transparent;color:#64748b;padding:2px 0;margin-right:8px;font-size:13px}
#support-desk.sd-inbox-open .sd-list>.sd-pills:nth-of-type(2) button[aria-pressed=true]{color:#1f3a5f;font-weight:700}
#support-desk.sd-inbox-open .sd-right>.sd-card:first-child{background:#ece7f8;border-color:#6951bb}

#support-desk .sd-brand,#support-desk .sl-brand small{color:#a8761f}
#support-desk label,#support-desk .sd-instruction,#support-desk .sd-legend p{color:#3b5578}
#support-desk .sd-ai-draft,#support-desk .sd-assistant{color:#5b4a9e}
#support-desk .sd-feedback{color:#3b5578}#support-desk .sd-feedback[data-status=error],#support-desk .sd-feedback[data-status=blocked],#support-desk .sd-feedback[data-status=connect]{color:#a63d2f}
body .hired-desk #kioskx-voice-connect:not([data-desk-requested]){display:none!important}
body .hired-desk #kioskx-voice-connect[data-desk-requested]{display:block!important;position:fixed;left:16px;right:auto;bottom:140px;width:200px;max-height:230px;overflow:auto;z-index:1001;padding:12px!important;border:1px solid #a8761f;border-radius:12px;background:#f6e8c9;color:#3b5578;font:12px/1.45 Inter,Arial,sans-serif!important}
body .hired-desk #kioskx-voice-connect button{color:#1f3a5f!important;border-color:#dce2ec!important;padding:8px!important;font-size:12px!important}
body .hired-desk #kioskx-voice-connect a{color:#2f5f8a}
#support-desk .sd-queue-unavailable{background:#f6ddd8;border-color:#a63d2f;color:#a63d2f;font-weight:700}
#support-desk .sd-lead-form{max-width:680px}#support-desk .sd-lead-form [hidden]{display:none!important}#support-desk .sd-lead-form select{max-width:100%;padding:10px;border:1px solid #dce2ec;border-radius:6px;background:#fff;color:#1f3a5f}#support-desk .sd-lead-form label{display:flex;gap:12px;align-items:center;margin:12px 0}#support-desk .sd-lead-form label span{min-width:145px}#support-desk .sd-lead-form input:not([type=checkbox]){flex:1;min-width:0;padding:10px;border:1px solid #dce2ec;border-radius:6px}#support-desk .sd-access-status{font-size:11px;color:#64748b}#support-desk .sd-mail{display:flex;flex-direction:column;background:#f3f5f9}
#support-desk .sd-mail-layout{display:grid;grid-template-columns:320px minmax(0,1fr);flex:1;min-height:0}
#support-desk .sd-mail-list{overflow:auto;border-right:1px solid #dce2ec;background:#f8fafc;padding:12px}
#support-desk .sd-mail-row{display:flex;flex-direction:column;text-align:left;width:100%;padding:16px;border:1px solid #dce2ec;background:white;margin-bottom:8px;gap:8px;color:#1f3a5f}
#support-desk .sd-mail-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
#support-desk .sd-mail-thread{display:flex;flex-direction:column;overflow:auto;padding:24px;min-width:0;gap:12px}
#support-desk .sd-mail-messages{flex:1;overflow:auto;min-height:120px}
#support-desk .sd-mail-message{padding:12px 16px;border:1px solid #dce2ec;background:white;border-radius:8px;margin-bottom:12px;white-space:pre-wrap;overflow-wrap:anywhere}
#support-desk .sd-mail-message.sent{background:#e8eef6}
#support-desk .sd-mail-body{white-space:normal;overflow-wrap:anywhere;line-height:1.6;background:#fff;color:#242424;padding:16px;border-radius:8px;overflow-x:auto}#support-desk .sd-mail-body img{max-width:100%;height:auto}#support-desk .sd-mail-body table{max-width:100%;border-collapse:collapse;border:0}#support-desk .sd-mail-body td,#support-desk .sd-mail-body th{padding:4px;border:0}#support-desk .sd-mail-body a{color:#245a88;text-decoration:underline}#support-desk .sd-mail-body p{white-space:normal}#support-desk .sd-mail-body pre{white-space:pre-wrap}
#support-desk .sd-mail-reply textarea{display:block;width:100%;min-height:110px;margin:8px 0}
#support-desk .sd-mail-reply > button[type=submit]{display:block;margin-left:auto;font-weight:700;min-height:44px}
#support-desk .sd-mail-paging{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
@media(max-width:760px){#support-desk .sd-mail-layout{display:flex;flex-direction:column;overflow:auto}#support-desk .sd-mail-list{flex:0 0 200px;min-height:0;max-height:200px}#support-desk .sd-mail-thread{flex:0 0 540px;min-height:540px;padding:12px}#support-desk .sd-mail-message{padding:8px}#support-desk .sd-mail-body{padding:8px}}
#support-desk .sd-embed{position:absolute;left:232px;right:0;top:0;bottom:0;display:flex;flex-direction:column;min-width:0;background:#f3f5f9;overflow:hidden;z-index:1}
#support-desk .sd-embed-header{padding:16px 24px;border-bottom:1px solid #dce2ec;flex:none}
#support-desk .sd-embed-frame{display:block;width:100%;flex:1 1 auto;min-height:0;border:0;background:#fff}
@media(max-width:850px){#support-desk .sd-embed{position:relative;left:auto;right:auto;top:auto;bottom:auto;height:calc(100dvh - 180px);min-height:520px}}
#support-desk .sd-embed-status{padding:12px 24px;flex:none;border-top:1px solid #dce2ec}
`;document.head.append(css);
window.kxQueueCounts=null;window.kxOpenQueue=k=>navigate(names[k]?k:'inbox');
function hashArticle(){const m=location.hash.match(/^#desk-article=(\d+)$/);if(m&&articles[Number(m[1])]){article=Number(m[1]);navigate('knowledge');}}window.addEventListener('hashchange',hashArticle);
function start(){if(!document.documentElement)return;const desk=document.querySelector('main.hired-desk');if(host&&!host.isConnected)host=null;if(!desk||host)return;host=el('div');host.id='support-desk';desk.append(host);hashArticle();render();api('queues').then(d=>{data=d;window.kxQueueCounts=Object.fromEntries(Object.keys(names).map(k=>[k,rows().filter(r=>r.queue===k).length]));render();chooseWorkspace();}).catch(()=>{data={unavailable:true};window.kxQueueCounts={};render();});}
new MutationObserver(start).observe(document.documentElement,{childList:true,subtree:true});start();
// Twenty authenticates directly, even before its native form has mounted.
let login=null,loginPending=false,loginTimer=null;
let justSignedIn=sessionStorage.getItem('sd-choose-workspace')==='1';
const authPath=()=>location.pathname==='/'||location.pathname==='/welcome'||location.pathname.startsWith('/welcome/');
const nativeControl=re=>[...document.querySelectorAll('button,a')].find(e=>!e.closest('#sd-login')&&re.test(e.textContent.trim()));
function loginFailure(message='Email or password is incorrect. Try again or reset your password.'){
 if(!login)return;loginPending=false;clearTimeout(loginTimer);
 const password=login.querySelector('[name=password]');password.value='';password.type='password';login.querySelector('[data-show]').setAttribute('aria-pressed','false');
 const error=login.querySelector('[role=alert]');error.textContent=message;error.hidden=false;login.querySelector('[type=submit]').disabled=false;
}
async function signIn(form){
 const controller=new AbortController();
 loginTimer=setTimeout(()=>controller.abort(),20000);
 const metadata=async(operationName,query,variables)=>{
  const response=await fetch('/metadata',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({operationName,query,variables})});
  if(!response.ok)throw Error('unavailable');
  const result=await response.json();
  if(result.errors?.length)throw Error('credentials');
  return result.data;
 };
 try{
  const email=form.querySelector('[name=email]').value.trim(),origin=location.origin;
  const user=await metadata('CheckUserExists','query CheckUserExists($email: String!) { checkUserExists(email: $email) { exists } }',{email});
  if(user?.checkUserExists?.exists!==true)throw Error('credentials');
  const credentials=await metadata('GetLoginTokenFromCredentials','mutation GetLoginTokenFromCredentials($email: String!, $password: String!, $origin: String!) { getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }',{email,password:form.querySelector('[name=password]').value,origin});
  const loginToken=credentials?.getLoginTokenFromCredentials?.loginToken?.token;
  if(typeof loginToken!=='string'||!loginToken)throw Error('credentials');
  const result=await metadata('getAuthTokensFromLoginToken','mutation getAuthTokensFromLoginToken($loginToken: String!, $origin: String!) { getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { __typename accessOrWorkspaceAgnosticToken { __typename token expiresAt } refreshToken { __typename token expiresAt } } } }',{loginToken,origin});
  const pair=result?.getAuthTokensFromLoginToken?.tokens;
  if(!pair||!['accessOrWorkspaceAgnosticToken','refreshToken'].every(k=>typeof pair[k]?.token==='string'&&pair[k].token))throw Error('credentials');
  if(controller.signal.aborted)throw Error('unavailable');
  // Store only the server-issued pair in the shape Twenty validates on boot.
  localStorage.setItem('tokenPairState',JSON.stringify(pair));
  if(form.querySelector('[type=checkbox]').checked){localStorage.removeItem('sd-session-only');sessionStorage.removeItem('sd-session-active');}
  else{localStorage.setItem('sd-session-only','1');sessionStorage.setItem('sd-session-active','1');}
  localStorage.setItem('sd-session-email',email);sessionStorage.setItem('sd-choose-workspace','1');
  form.querySelector('[name=password]').value='';clearTimeout(loginTimer);
  location.replace('/welcome');
 }catch(error){
  localStorage.removeItem('tokenPairState');sessionStorage.removeItem('sd-choose-workspace');
  loginFailure(error.message==='credentials'?undefined:'Sign-in is unavailable. Please try again.');
 }
}
function brandMark(){const b=el('div','sl-brand');b.innerHTML='<span class="sl-mark" aria-hidden="true">∪<i></i></span><span><strong>Unified Support</strong><small>CUSTOMER SUPPORT</small></span>';return b;}
function mountLogin(){
 if(login||!authPath()||document.querySelector('main.hired-desk'))return;
 login=el('main','');login.id='sd-login';
 const brand=el('section','sl-panel');brand.append(brandMark());const story=el('div','sl-story');story.append(el('h1','','Your companies. One place to help.'),el('p','','Open each company’s inbox and work its requests from its own desk.'));
 const pills=el('div','sl-pills');for(const c of companies)pills.append(el('span','','●  '+c));story.append(pills);
 const checks=el('ul');for(const t of ['Nothing is sent until you press Email, Call or Text.','AI drafts replies. You decide what goes out.','Every company has its own App ID.'])checks.append(el('li','',t));story.append(checks);brand.append(story);
 const side=el('section','sl-side'),card=el('div','sl-card');card.append(el('h2','','Welcome back'),el('p','sl-subtitle','Sign in to the support desk.'));
 const error=el('div','sl-error');error.setAttribute('role','alert');error.hidden=true;card.append(error);
 const form=el('form');form.innerHTML='<label for="sl-email">Work email</label><input id="sl-email" name="email" type="email" autocomplete="username" placeholder="name@company.com" required><div class="sl-password-label"><label for="sl-password">Password</label></div><div class="sl-password"><input id="sl-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required></div><label class="sl-remember"><input type="checkbox" checked>Keep me signed in on this device</label>';
 const password=form.querySelector('[name=password]');const show=button('Show',()=>{password.type=password.type==='password'?'text':'password';show.setAttribute('aria-pressed',String(password.type==='text'));});show.dataset.show='';show.setAttribute('aria-label','Show password');show.setAttribute('aria-pressed','false');form.querySelector('.sl-password').append(show);
 const info=el('p','sl-info');info.setAttribute('role','status');info.hidden=true;
 const explain=t=>{info.hidden=false;info.textContent=t;};
 const forgot=button('Forgot password?',()=>{const reset=nativeControl(/^Forgot (your )?password\?$/i);if(reset){login.remove();login=null;document.body.classList.remove('sd-auth');authDelegated=true;reset.click();}else explain('Password reset is not available on this desk. Ask your company admin.');});form.querySelector('.sl-password-label').append(forgot);
 const submit=button('Sign in');submit.type='submit';submit.className='sl-submit';form.append(submit);
 form.onsubmit=e=>{e.preventDefault();if(loginPending)return;error.hidden=true;info.hidden=true;loginPending=true;submit.disabled=true;signIn(form);};
 card.append(form,el('div','sl-or','or'));const google=button('Continue with Google',()=>{const native=nativeControl(/^(Continue|Sign in) with Google$/i);if(native)native.click();else explain('Google sign-in is not connected on this desk.');},'sl-google');card.append(google,info,el('p','sl-invite','No account? Ask your company admin for an invite.'));
 const legal=el('div','sl-legal');for(const [name,re] of [['Privacy',/Privacy (Policy)?/i],['Terms',/Terms (of Service)?/i]]){if(legal.childNodes.length)legal.append(document.createTextNode(' · '));const a=button(name,()=>{const link=nativeControl(re);if(link)link.click();});legal.append(a);}card.append(legal);side.append(card);login.append(brand,side);document.body.append(login);document.body.classList.add('sd-auth');
}
let authDelegated=false,delegatedAway=false;
// No alternate token is issued. Twenty still owns tokenPairState and refresh.
try{if(localStorage.getItem('sd-session-only')&&!sessionStorage.getItem('sd-session-active'))localStorage.removeItem('tokenPairState');}catch{}
function syncLogin(){
 if(authDelegated&&!authPath())delegatedAway=true;
 if(authDelegated&&delegatedAway&&authPath()){authDelegated=false;delegatedAway=false;}
 const desk=document.querySelector('main.hired-desk');
 if(!desk&&host){host.remove();host=null;data=null;}if(desk){if(login){justSignedIn=justSignedIn||loginPending;if(loginPending)localStorage.setItem('sd-session-email',login.querySelector('[name=email]').value.trim());login.remove();login=null;loginPending=false;clearTimeout(loginTimer);}document.body.classList.remove('sd-auth');return;}
 if(!authDelegated)mountLogin();
}
function chooseWorkspace(){
 if(!justSignedIn||!data||data.unavailable)return;justSignedIn=false;sessionStorage.removeItem('sd-choose-workspace');
 const connected=companies;
 const chooser=el('section','sl-workspaces');chooser.id='sd-workspaces';chooser.append(brandMark(),el('h1','','Choose a workspace'),el('p','','Choose a company desk.'));
 host.inert=true;chooser.setAttribute('role','dialog');chooser.setAttribute('aria-modal','true');chooser.setAttribute('aria-label','Choose a workspace');
 const enter=c=>{company=c;open='';host.inert=false;chooser.remove();render();};const count=c=>rows().filter(r=>(c==='All'||deskOf(r)===c)&&statusOf(r)!=='Done').length;
 const grid=el('div','sl-workspace-grid');for(const c of companies){const b=button('',()=>enter(c));b.append(el('span','sl-initial',c[0]),el('strong','',c),el('small','',appIds[c]),el('span',connected.includes(c)?'sl-role':'sl-disconnected','Chatwoot inbox'),el('span','sl-open-count',['Kiosk X','AniDeeBee'].includes(c)?count(c)+' open':'Inbox'));grid.append(b);}chooser.append(grid,el('p','sl-invite','Not seeing a company? Ask its admin to add you.'));document.querySelector('main.hired-desk').append(chooser);
}
const loginCss=el('style');loginCss.textContent=`
html:has(body.sd-auth),html:has(#sd-workspaces),body:has(#sd-workspaces){overflow:hidden!important}body.sd-auth{margin:0!important;overflow:hidden!important}body.sd-auth>:not(#sd-login){visibility:hidden!important;pointer-events:none!important}body.sd-auth>#root{display:none!important}
#sd-login,#sd-workspaces{font:14px/1.5 Inter,Arial,sans-serif;color:#1f3a5f;background:#f3f5f9;box-sizing:border-box}
#sd-login * ,#sd-workspaces *{box-sizing:border-box}#sd-login{position:fixed;inset:0;height:100dvh;overflow:hidden;display:grid;grid-template-columns:620px minmax(0,1fr);z-index:2000}
#sd-login button,#sd-workspaces button{font:inherit;cursor:pointer}#sd-login button:disabled{cursor:wait;opacity:.65}#sd-login [hidden]{display:none!important}
.sl-panel{background:#1f3a5f;color:white;padding:56px;display:flex;flex-direction:column;min-height:0}.sl-brand{display:flex;align-items:center;gap:12px}.sl-brand strong{font-size:20px;letter-spacing:-.5px}.sl-brand small{display:block;font-size:10px;font-weight:600;letter-spacing:1px}.sl-mark{position:relative;width:40px;height:40px;background:white;color:#1f3a5f;border-radius:10px;text-align:center;font:bold 36px/36px Arial}.sl-mark i{position:absolute;width:6px;height:6px;background:#1f3a5f;border-radius:50%;left:18px;top:12px}
.sl-story{margin-top:auto;padding-top:70px}.sl-story h1{font-size:40px;line-height:1.15;letter-spacing:-1px;max-width:420px;margin:0 0 22px}.sl-story p{font-size:16px;line-height:24px;color:#c9d6e8;margin:0 0 20px}.sl-pills{display:flex;flex-wrap:wrap;gap:8px}.sl-pills span{padding:6px 12px;border-radius:20px;background:#ffffff20;font-size:12px;font-weight:600}.sl-story ul{padding:0;margin:54px 0 0;list-style:none;font-size:13px}.sl-story li{position:relative;padding-left:28px;margin-top:18px}.sl-story li:before{content:'✓';position:absolute;left:0;border-radius:50%;background:#2f7a4f;width:18px;height:18px;text-align:center;font-size:11px}
.sl-side{display:flex;align-items:center;justify-content:center;padding:36px}.sl-card{background:#fff;border:1px solid #dce2ec;border-radius:20px;padding:32px 36px 34px;width:440px;max-width:100%}.sl-card h2{font-size:28px;letter-spacing:-1px;line-height:36px;margin:0 0 12px}.sl-subtitle{margin:0 0 12px;color:#64748b}.sl-card label{display:block;font-size:12px;font-weight:600}.sl-card input:not([type=checkbox]){width:100%;height:45px;border:1px solid #dce2ec;border-radius:10px;background:white;padding:12px 14px;font:14px Inter,Arial,sans-serif;color:#1f3a5f;margin-top:4px}.sl-card input::placeholder{color:#64748b}.sl-password-label{display:flex;align-items:center;justify-content:space-between;margin-top:14px}.sl-password-label button,.sl-password button,.sl-legal button{border:0;background:none;padding:0;color:#2f5f8a;font-size:12px}.sl-password{position:relative}.sl-password input{padding-right:66px!important}.sl-password button{position:absolute;right:15px;top:17px}.sl-remember{display:flex!important;align-items:center;gap:8px;font-size:13px!important;font-weight:400!important;margin:16px 0}.sl-remember input{accent-color:#1f3a5f;width:18px;height:18px;margin:0}.sl-submit,.sl-google{width:100%;height:44px;border-radius:12px;border:1px solid #dce2ec;font-weight:600!important}.sl-submit{background:#1f3a5f;color:white;border:0}.sl-google{background:white;color:#1f3a5f}.sl-or{display:flex;align-items:center;gap:10px;color:#64748b;font-size:12px;margin:16px 0}.sl-or:before,.sl-or:after{content:'';height:1px;background:#dce2ec;flex:1}.sl-invite{text-align:center;font-size:12px;color:#64748b;margin:14px 0 0}.sl-legal{text-align:center;font-size:12px}.sl-error{background:#f6ddd8;border:1px solid #a63d2f;border-radius:8px;padding:12px;color:#a63d2f;font-size:13px;margin:20px 0}.sl-info{font-size:13px}.sl-workspaces{position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:36px;overflow:auto}.sl-workspaces h1{font-size:32px;margin:24px 0 8px}.sl-workspaces>.sl-brand .sl-mark{background:#1f3a5f;color:white}.sl-workspaces>.sl-brand .sl-mark i{background:white}.sl-all{position:relative;text-align:left;width:760px;max-width:100%;background:white;border:1px solid #dce2ec;border-radius:12px;padding:20px;margin:24px 0 16px}.sl-all strong,.sl-all span{display:block}.sl-all b{position:absolute;right:24px;top:30px}.sl-workspace-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;max-width:760px;width:100%}.sl-workspace-grid button{border:1px solid #dce2ec;border-radius:12px;background:white;color:#1f3a5f;text-align:left;padding:20px}.sl-workspace-grid strong,.sl-workspace-grid small{display:block;margin:6px 0}.sl-workspace-grid span{display:block;font-size:12px}.sl-initial{font-size:20px!important;margin-bottom:16px;width:36px;height:36px;background:#e3e9f2;border-radius:8px;text-align:center;line-height:36px}.sl-workspace-grid .sl-role{display:inline-block;border-radius:12px;background:#e3e9f2;padding:2px 8px}.sl-open-count{margin-top:5px}
@media(max-width:1100px){#sd-login{grid-template-columns:46% 54%}.sl-panel{padding:36px}.sl-side{padding:24px}.sl-card{padding:28px}.sl-story h1{font-size:36px}}@media(min-width:700px) and (max-height:800px){.sl-panel{padding:32px}.sl-story{padding-top:28px}.sl-story h1{font-size:34px}.sl-story ul{margin-top:28px}.sl-side{padding:20px}.sl-card{padding:24px 28px}}@media(max-width:699px){html:has(body.sd-auth),body.sd-auth{overflow:auto!important}#sd-login{position:absolute;display:block;height:auto;min-height:100dvh;overflow:visible}.sl-panel{min-height:0;padding:28px 24px}.sl-story{padding-top:42px}.sl-story h1{font-size:32px}.sl-story ul{margin-top:28px}.sl-side{padding:24px 16px}.sl-card{padding:28px 24px}.sl-workspaces{justify-content:flex-start;padding:28px 18px}.sl-workspace-grid{grid-template-columns:repeat(2,1fr)}.sl-workspaces h1{font-size:28px}.sl-workspaces>p{text-align:center}}

.sl-brand small{color:#a8761f}.sl-panel .sl-brand small{color:#a8761f}
.sl-card label{color:#3b5578}.sl-card{min-height:540px}.sl-card:has(.sl-error:not([hidden])){min-height:620px}
.sl-card:has(.sl-error:not([hidden])) input:not([type=checkbox]){border-color:#a63d2f}
.sl-all{background:#1f3a5f;color:white;padding-left:102px;min-height:79px}
.sl-all:before{content:'●●●';position:absolute;left:20px;top:26px;color:#8fb4ff;font-size:22px;letter-spacing:-4px}
#sd-workspaces .sl-all strong,#sd-workspaces .sl-all span{color:#ffffff}
.sl-all b{background:white;color:#1f3a5f;border-radius:8px;padding:8px 18px;top:20px;font-size:12px}
.sl-workspaces>p{color:#64748b}.sl-workspace-grid button{min-height:130px}#sd-workspaces{overflow:auto;max-height:100dvh}.sl-workspace-grid{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:850px){.sl-workspace-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}.sl-workspace-grid small{color:#64748b}
@media(max-width:699px){.sl-card,.sl-card:has(.sl-error:not([hidden])){min-height:0}}
`;document.head.append(loginCss);
new MutationObserver(syncLogin).observe(document.documentElement,{childList:true,subtree:true});syncLogin();
})();
