(() => {
  const NAMES = {
    cleaning: 'Cleaning',
    cars: 'Cars',
    jobs: 'Jobs',
    turo: 'Turo',
    kiosk: 'Kiosk',
  };
  let selected = '';
  let revision = 0;
  let voiceHome = null;
  const restoreVoice = () => {
    const box = document.querySelector('#kioskx-voice-connect');
    if (voiceHome?.isConnected && box) voiceHome.replaceWith(box);
    voiceHome = null;
  };
  let openId = '';
  let data = null;
  let applying = false;
  let savedNavigation = [];
  const restoreNavigation = () => {
    for (const [button, pressed] of savedNavigation) button.setAttribute('aria-pressed', pressed);
    savedNavigation = [];
  };
  window.kxQueue = '';

  const style = document.createElement('style');
  style.textContent = `
    html:has(.hired-desk), body:has(.hired-desk), body:has(.hired-desk) #root {
      height: 100%;
      overflow: hidden;
    }
    body .hired-desk { height: 100vh; min-height: 0; overflow: hidden; }
    body .hired-sidebar { height: 100vh; overflow: auto; }
    body .hired-workspace { height: 100vh; min-height: 0; overflow: hidden; }
    body .hired-content { min-height: 0; overflow: hidden; }
    body .hired-list, body .hired-detail { min-height: 0; overflow: auto; }
    body .kx-inbox-panel { flex: 1; min-height: 0; height: calc(100vh - 72px); display: flex; }
    body .kx-inbox-panel iframe { flex: 1; width: 100%; height: 100%; border: 0; background: #fff; }
    body.kx-auth, body.kx-auth #root,
    body.kx-auth [class*="backdrop"], body.kx-auth [class*="modal"],
    body.kx-auth [class*="content"] { background: #f4f1ea !important; box-shadow: none !important; }
    body.kx-auth { min-height: 100vh; }
    body.kx-auth [class*="fadeIn"], body.kx-auth .sdtdivd { display: none !important; }
    body.kx-auth .kx-auth-intro { width: 100%; margin: 0 0 28px; color: #1c2430; font-family: Poppins, Inter, system-ui, sans-serif; }
    body.kx-auth .kx-auth-intro .kx-brand { margin: 0 0 28px; font: 700 22px/1 Montserrat, Poppins, sans-serif; letter-spacing: -0.03em; color: #173f43; }
    body.kx-auth .kx-auth-intro h1 { margin: 0; font: 700 40px/1.15 Montserrat, Poppins, sans-serif; color: #1c2430; }
    body.kx-auth .kx-auth-intro p { margin: 8px 0 0; color: #5c6560; font-size: 16px; }
    body.kx-auth form, body.kx-auth input, body.kx-auth button { font-family: Poppins, Inter, system-ui, sans-serif; }
    body.kx-auth input { background: #fff !important; border: 1px solid #e4dcc8 !important; border-radius: 12px !important; min-height: 48px; }
    body.kx-auth button { border-radius: 12px !important; }
    body.kx-auth form button[type="submit"], body.kx-auth form button:last-of-type { background: #1e3d3a !important; color: #fff !important; min-height: 48px; }
  `;
  document.head.appendChild(style);
  const paintLogin = () => {
    const auth = location.pathname === '/welcome' || location.pathname.startsWith('/welcome/');
    document.body.classList.toggle('kx-auth', auth);
    if (!auth) return;
    const host = document.querySelector('form')?.parentElement;
    if (!host || host.querySelector('.kx-auth-intro')) return;
    const intro = document.createElement('div');
    intro.className = 'kx-auth-intro';
    const brand = document.createElement('p');
    brand.className = 'kx-brand';
    brand.textContent = 'KioskX';
    const title = document.createElement('h1');
    title.textContent = 'Welcome back';
    const lede = document.createElement('p');
    lede.textContent = 'Sign in to the inquiry desk.';
    intro.append(brand, title, lede);
    host.insertBefore(intro, host.firstChild);
  };
  paintLogin();
  new MutationObserver(paintLogin).observe(document.documentElement, { childList: true, subtree: true });
  window.kxQueueCounts = null;

  const token = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('tokenPairState') || 'null');
      return saved?.accessOrWorkspaceAgnosticToken?.token || '';
    } catch {
      return '';
    }
  };

  const load = async () => {
    const bearer = token();
    if (!bearer) return;
    const response = await fetch('/kioskx-hired-desk/queues', {
      headers: { Authorization: `Bearer ${bearer}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('unavailable');
    data = await response.json();
    revision++;
    const counts = {};
    for (const name of Object.keys(NAMES)) {
      counts[name] = data?.queues?.[name]?.rows?.length ?? 0;
    }
    window.kxQueueCounts = data?.unavailable ? null : counts;
    paint();
  };

  const paintCounts = () => {
    const counts = window.kxQueueCounts;
    if (!counts) return;
    for (const name of Object.keys(NAMES)) {
      const slot = document.querySelector(`[data-kx-count="${name}"]`);
      if (slot && slot.textContent !== String(counts[name])) {
        slot.textContent = String(counts[name]);
      }
    }
  };

  const safeActivityName = value => String(value || 'Inquiry')
    .replace(/[^\s<>()[\],;:]*@[^\s<>()[\],;:]*/g, '[contact hidden]')
    .replace(/\+?\d[\d ().-]{5,}\d/g, '[contact hidden]');
  const paintToday = () => {
    const workspace=document.querySelector('.hired-workspace');if(!workspace)return;
    let box=workspace.querySelector('.kx-today');
    if(!box){box=document.createElement('details');box.className='kx-today';box.append(document.createElement('summary'),document.createElement('div'));workspace.querySelector('.hired-toolbar')?.after(box);}
    const now=new Date(), entries=[];
    for(const [queue,q] of Object.entries(data?.queues||{}))for(const row of q.rows||[])for(const item of row.thread||[]){
      const date=new Date(item.time);
      if(date.toDateString()!==now.toDateString())continue;
      if(!(['email','sms'].includes(item.kind)&&item.status==='sent') && !(item.kind==='call'&&['sent','queued','completed'].includes(item.status)))continue;
      entries.push({queue,name:safeActivityName(row.label),kind:item.kind,status:item.status,time:date});
    }
    entries.sort((a,b)=>b.time-a.time);
    const count=kind=>entries.filter(e=>e.kind===kind).length;
    const summary=!data||data.unavailable||data.workUnavailable?'Today: activity unavailable.':!entries.length?'Today: nothing sent.':`Today: ${count('email')} emails, ${count('call')} calls, ${count('sms')} texts.`;
    const lines=entries.map(e=>`${({cleaning:'Cleaning',cars:'Cars',jobs:'Jobs',kiosk:'Kiosk'})[e.queue]||'Inquiry'} — ${e.name} — ${e.kind==='email'?'Email sent':e.kind==='sms'?'Text sent':e.status==='queued'?'Call queued':'Call completed'} — ${e.time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`);
    const stamp=JSON.stringify([summary,lines]);if(box.dataset.stamp===stamp)return;box.dataset.stamp=stamp;
    box.querySelector('summary').textContent=summary;const list=box.querySelector('div');list.replaceChildren();
    for(const line of lines){const row=document.createElement('p');row.textContent=line;list.append(row);}
  };

  const renderPanel = (panel) => {
    const queue = data?.queues?.[selected] || (selected === 'turo' ? { rows: [
      ['turo:c300','Mercedes C300'], ['turo:tesla-2023','2023 Tesla Model Y'],
      ['turo:gls450','Mercedes GLS450'], ['turo:tesla-2027','2027 Tesla Model Y'],
    ].map(([id,label]) => ({id,label,summary:'Own reminder',note:''})) } : null);
    const workUnavailable = !data || Boolean(data.workUnavailable || data.unavailable);
    const stamp = `${revision}:${selected}:${openId}:${queue?.rows?.length ?? 'x'}:${data?.unavailable ? 1 : 0}`;
    if (panel.dataset.kxStamp === stamp) return;
    panel.dataset.kxStamp = stamp;
    restoreVoice();
    panel.replaceChildren();
    const list = document.createElement('section');
    list.className = 'hired-list';
    list.setAttribute('aria-label', NAMES[selected] || 'Queue');
    const detail = document.createElement('section');
    detail.className = 'hired-detail';
    if (data?.unavailable && selected !== 'turo') {
      const note = document.createElement('p');
      note.className = 'hired-notice';
      note.setAttribute('role', 'status');
      note.textContent = 'This queue is unavailable. Try refreshing.';
      detail.appendChild(note);
    } else if (!queue || !queue.rows.length) {
      if (queue && selected !== 'turo') {
        const fresh = document.createElement('p'); fresh.className = 'hired-notice kx-new-count';
        fresh.textContent = '0 still new'; list.append(fresh);
      }
      const note = document.createElement('p');
      note.className = 'hired-notice';
      note.textContent = selected === 'turo' ? 'The fleet report is not connected.' : (queue?.empty || (queue ? 'No requests in this queue.' : 'This queue is not connected.'));
      detail.appendChild(note);
    } else {
      const fresh = document.createElement('p');
      fresh.className = 'hired-notice kx-new-count';
      const updateCount = () => { fresh.textContent = `${queue.rows.filter(r => (r.status || 'New') === 'New').length} still new`; };
      if (selected !== 'turo') { updateCount(); list.appendChild(fresh); }
      const current = queue.rows.find((item) => item.id === openId) || queue.rows[0];
      openId = current.id;
      for (const item of queue.rows) {
        const button = document.createElement('button');
        button.className = 'hired-row';
        button.type = 'button';
        button.setAttribute('aria-pressed', item.id === openId ? 'true' : 'false');
        button.addEventListener('click', () => {
          openId = item.id;
          panel.dataset.kxStamp = '';
          renderPanel(panel);
        });
        const avatar = document.createElement('span');
        avatar.className = 'hired-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = (item.label || '?').slice(0, 1).toUpperCase();
        const copy = document.createElement('span');
        copy.className = 'hired-row-copy';
        const name = document.createElement('strong');
        name.textContent = item.label;
        const sub = document.createElement('span');
        sub.textContent = item.summary || item.service || 'Inquiry';
        copy.append(name, sub);
        button.append(avatar, copy);
        list.appendChild(button);
      }
      const heading = document.createElement('div');
      heading.className = 'hired-card-heading';
      const avatar = document.createElement('span');
      avatar.className = 'hired-avatar';
      avatar.textContent = current.label.slice(0, 1).toUpperCase();
      const title = document.createElement('h2');
      title.textContent = current.label;
      heading.append(avatar, title);
      const info = document.createElement('section');
      info.className = 'hired-info';
      const fields = document.createElement('dl');
      fields.className = 'hired-fields';
      const add = (label, value) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.className = 'hired-number';
        dd.textContent = value || '—';
        fields.append(dt, dd);
      };

      if (selected !== 'turo') {
        add('Email', current.email || 'No email');
        add('Phone', current.phone || 'No phone');
        if (current.when) add('Received', new Date(current.when).toLocaleString());
      }

      info.appendChild(fields);
      detail.append(heading);
      if (selected !== 'turo') {
        const description = document.createElement('p');
        description.className = 'hired-request-description';
        description.textContent = current.description || current.service || '';
        detail.append(description, info);
      }
      const message = document.createElement('p');
      message.className = 'hired-request-message';
      message.style.whiteSpace = 'pre-wrap';
      message.style.overflowWrap = 'anywhere';
      message.textContent = current.message || 'No message was submitted.';
      if (selected !== 'turo') detail.appendChild(message);
      const controls = document.createElement('section');
      controls.className = 'hired-info kx-work';
      const feedback = document.createElement('p');
      feedback.className = 'hired-muted';
      feedback.setAttribute('role', 'status');
      if (workUnavailable) feedback.textContent = 'Work status is unavailable.';
      const button = (label, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label;
        b.className = 'hired-potential-filter';
        b.style.cssText = 'font:inherit;width:auto;display:inline-flex;padding:10px 12px;margin-right:8px';
        if (fn) b.addEventListener('click', fn);
        return b;
      };
      const savingButtons = [];
      const save = async patch => {
        const id = current.id;
        savingButtons.forEach(b => b.disabled = true);
        feedback.textContent = 'Saving…';
        try {
          const response = await fetch('/kioskx-hired-desk/queue-work', {
            method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...patch }),
          });
          if (!response.ok) throw new Error('unavailable');
          const result = await response.json();
          if (!result.saved) throw new Error('unavailable');
          Object.assign(current, result.work);
          for (const b of controls.querySelectorAll('[data-status]')) b.setAttribute('aria-pressed', b.dataset.status === current.status ? 'true' : 'false');
          updateCount();
          feedback.textContent = 'Saved.';
        } catch { feedback.textContent = 'Work status is unavailable. Your changes have not been saved.'; }
        finally { savingButtons.forEach(b => b.disabled = workUnavailable); }
      };
      if (selected !== 'turo') {
        const statuses = document.createElement('div');
        statuses.setAttribute('role', 'group'); statuses.setAttribute('aria-label', 'Next step');
        statuses.style.display = 'flex'; statuses.style.flexWrap = 'wrap';
        for (const status of ['New','Call next','Waiting','Done']) {
          const b = button(status, () => save({ status }));
          b.dataset.status = status;
          b.setAttribute('aria-pressed', (current.status || 'New') === status ? 'true' : 'false');
          statuses.append(b); savingButtons.push(b);
        }
        controls.append(statuses);
      }
      const label = document.createElement('label');
      const field = document.createElement('textarea');
      const fleetNote = selected === 'turo';
      field.id = fleetNote ? 'kx-note' : 'kx-reply';
      label.htmlFor = field.id; label.textContent = fleetNote ? 'Note' : 'Reply';
      field.value = (fleetNote ? current.note : current.draft) || '';
      field.rows = 4; field.maxLength = 10000;
      field.style.cssText = 'display:block;box-sizing:border-box;width:100%;font:inherit;color:inherit;background:transparent;border:1px solid #d9cbb5;border-radius:8px;padding:10px;margin:8px 0';
      field.disabled = workUnavailable;
      const saveButton = button(fleetNote ? 'Save note' : 'Save draft', () => save(fleetNote ? { note: field.value } : { draft: field.value }));
      savingButtons.push(saveButton);
      if(selected==='cleaning') {
        const reminderRow=document.createElement('div');
        const time=document.createElement('input');time.type='text';time.placeholder='Appointment time';time.setAttribute('aria-label','Appointment time');time.maxLength=80;
        time.style.cssText='font:inherit;color:inherit;background:transparent;border:1px solid #d9cbb5;border-radius:8px;padding:10px;max-width:100%;box-sizing:border-box';
        const reminder=button('Appointment reminder',()=>{
          const value=time.value.trim();
          field.value=value?`You have an appointment tomorrow at ${value}.`+(current.appointmentDate?` Date on the request: ${current.appointmentDate}.`:''):'Add the appointment time, then use Appointment reminder.';
          field.focus();
        });
        reminder.disabled=workUnavailable;time.disabled=workUnavailable;
        reminderRow.append(reminder,time);controls.append(reminderRow);
      }
      controls.append(label, field, saveButton, feedback);
      savingButtons.forEach(b => b.disabled = workUnavailable);
      if (fleetNote) {
        const note = document.createElement('p'); note.className = 'hired-muted';
        note.textContent = 'Your own reminder. This note is not sent to a guest.';
        controls.append(note);
        const fleetNotice = document.createElement('p'); fleetNotice.className = 'hired-muted';
        fleetNotice.textContent = 'No host booking list. Prices stay unchanged. Guest messages on Turo are not connected.';
        list.append(fleetNotice);
      } else {
        const mail = document.createElement('p'); mail.className = 'hired-muted';
        // Reuse the existing Voice script even when no Kiosk inquiry was opened first.
        const voiceSlot = document.createElement('section');
        voiceSlot.className = 'kx-voice-slot'; voiceSlot.hidden = true;
        const voiceAnchor = document.createElement('div'); voiceAnchor.className = 'hired-actions';
        voiceSlot.append(voiceAnchor);
        const openVoice = () => {
          const box = document.querySelector('#kioskx-voice-connect');
          if (box) {
            if (!voiceHome) { voiceHome = document.createElement('span'); box.before(voiceHome); }
            controls.append(box); box.hidden = false; box.tabIndex = -1;
            box.scrollIntoView({ block: 'nearest' }); box.focus();
          } else {
            voiceSlot.hidden = false;
            voiceSlot.tabIndex = -1; voiceSlot.scrollIntoView({ block: 'nearest' }); voiceSlot.focus();
          }
        };
        const thread = document.createElement('section'); thread.className='kx-thread'; thread.setAttribute('aria-label','Reply thread');
        const paintThread=()=>{thread.replaceChildren();for(const item of current.thread||[]){const row=document.createElement('p');row.style.whiteSpace='pre-wrap';row.textContent=new Date(item.time).toLocaleString()+' · '+item.message+(item.text?'\n'+item.text:'');thread.append(row);}};
        paintThread();
        let busy=false;
        const action=async kind=>{
          if(busy)return;busy=true;send.disabled=call.disabled=sms.disabled=true;
          try{
            if(kind!=='call'){await save({draft:field.value});if(current.draft!==field.value)throw Error();}
            const response=await fetch('/kioskx-hired-desk/'+(kind==='call'?'call':'queue-send'),{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify(kind==='call'?{leadId:current.id,requestId:crypto.randomUUID()}:{id:current.id,kind})});
            if(!response.ok)throw Error();const result=await response.json();feedback.textContent=result.message;current.thread=result.thread||current.thread;paintThread();paintToday();
            if(result.status==='connect')openVoice();
          }catch{feedback.textContent=kind==='email'?'Email outcome is unconfirmed. Refresh before trying again.':kind==='sms'?'Text outcome is unconfirmed. Refresh before trying again.':'Call outcome is unconfirmed. Refresh before trying again.';}
          finally{busy=false;send.disabled=workUnavailable||!data.mailEnabled;call.disabled=workUnavailable;sms.disabled=workUnavailable||!data.smsEnabled;}
        };
        const send=button('Send',()=>action('email'));send.disabled=workUnavailable||!data.mailEnabled;
        const call=button('Call',()=>action('call'));call.disabled=workUnavailable;
        const sms=button('Text',()=>action('sms'));sms.disabled=workUnavailable||!data.smsEnabled;
        const smsNote = document.createElement('p'); smsNote.textContent = data.smsEnabled ? '' : 'Text from this desk is not connected.'; smsNote.className = 'hired-muted';
        controls.append(mail, send, call, sms, smsNote, thread, voiceSlot);
      }
      detail.append(controls);
      if (current.notice) {
        const notice = document.createElement('p');
        notice.className = 'hired-notice';
        notice.textContent = current.notice;
        detail.appendChild(notice);
      }
    }
    panel.append(list, detail);
  };

  const paintKiosk = () => {
    if(selected || !data?.queues?.kiosk)return;
    const detail=document.querySelector('.hired-content:not(.kx-queue-panel) .hired-detail');
    if(!detail)return;
    const articles=[...detail.querySelectorAll('article')].filter(a=>a.querySelector('.hired-card-heading'));
    for(const [index,article] of articles.entries()) {
      if(article.querySelector('.kx-work'))continue;
      const title=article.querySelector('.hired-card-heading h2')?.textContent?.trim();
      const matches=data.queues.kiosk.rows.filter(r=>r.label===title);
      const indexed=data.queues.kiosk.rows[index];
      const current=indexed?.label===title?indexed:matches.length===1?matches[0]:null;
      if(!current)continue;
      const panel=document.createElement('div');const priorId=openId;
      selected='kiosk';openId=current.id;renderPanel(panel);selected='';openId=priorId;
      const controls=panel.querySelector('.kx-work');
      // Keep the existing Kiosk card, notes and history. Only replace its action area.
      for(const old of article.querySelectorAll('.hired-actions,.hired-compose')){old.hidden=true;old.style.display='none';}
      for(const dd of article.querySelectorAll('.hired-fields > dd')) {
        if(dd.previousElementSibling?.textContent==='Email')dd.textContent=current.email||'No email';
        if(dd.previousElementSibling?.textContent==='Phone')dd.textContent=current.phone||'No phone';
      }
      controls.querySelector('textarea').id='kx-reply-'+current.id;
      controls.querySelector('label').htmlFor='kx-reply-'+current.id;
      (article.querySelector('.hired-card-main')||article).append(controls);
    }
  };
  const paint = () => {
    if (applying) return;
    const desk = document.querySelector('.hired-desk');
    if (!desk) return;
    applying = true;
    paintCounts();
    paintToday();
    for (const name of Object.keys(NAMES)) {
      const match = [...desk.querySelectorAll('nav[aria-label="Queues"] button')].find(
        (item) => item.textContent.trim().startsWith(NAMES[name]),
      );
      if (match) {
        match.classList.remove('hired-nav');
        match.classList.add('hired-potential-filter');
        match.setAttribute('aria-pressed', selected === name ? 'true' : 'false');
      }
    }
    const all = desk.querySelector('nav[aria-label="Views"] button');
    if (all) {
      all.style.background = selected || all.getAttribute('aria-pressed') !== 'true' ? 'transparent' : '';
      if (selected) all.setAttribute('aria-pressed', 'false');
    }
    if (selected) {
      for (const filter of desk.querySelectorAll('nav[aria-label="Lead potential filters"] button')) {
        filter.setAttribute('aria-pressed', 'false');
      }
    }
    const workspace = desk.querySelector('.hired-workspace');
    ensureInbox(desk);
    const inboxButton = desk.querySelector('[data-kx-inbox]');
    if (inboxButton) {
      inboxButton.className = 'hired-potential-filter';
      inboxButton.setAttribute('aria-pressed', selected === 'inbox' ? 'true' : 'false');
    }
    const inboxPanel = workspace?.querySelector('.kx-inbox-panel');
    if (inboxPanel) inboxPanel.hidden = selected !== 'inbox';
    const today = workspace?.querySelector('.kx-today');
    if (today) today.hidden = selected === 'inbox';
    if (selected === 'inbox') {
      for (const notice of workspace?.querySelectorAll(':scope > .hired-notice') || []) {
        notice.hidden = true; notice.style.display = 'none';
      }
      const content = workspace?.querySelector('.hired-content:not(.kx-queue-panel):not(.kx-inbox-panel)');
      const title = workspace?.querySelector('.hired-toolbar h1');
      const search = workspace?.querySelector('.hired-toolbar input');
      const summary = workspace?.querySelector('.hired-toolbar .hired-count');
      if (summary) summary.hidden = true;
      if (content) { content.hidden = true; content.style.display = 'none'; }
      if (search) search.hidden = true;
      workspace?.querySelector('.kx-queue-panel')?.remove();
      if (title && title.textContent !== 'Inbox') { title.dataset.kxQueue = 'inbox'; title.textContent = 'Inbox'; }
      let frameHost = workspace?.querySelector('.kx-inbox-panel');
      if (!frameHost && workspace) {
        frameHost = document.createElement('div');
        frameHost.className = 'hired-content kx-inbox-panel';
        const frame = document.createElement('iframe');
        frame.title = 'Inbox';
        frame.src = 'https://inbox.intelli-verse-x.ai/';
        frameHost.append(frame);
        workspace.appendChild(frameHost);
      }
      if (frameHost) frameHost.hidden = false;
      applying = false;
      return;
    }
    for (const notice of workspace?.querySelectorAll(':scope > .hired-notice') || []) {
      notice.hidden = Boolean(selected); notice.style.display = selected ? 'none' : '';
    }
    const content = workspace?.querySelector('.hired-content:not(.kx-queue-panel)');
    const title = workspace?.querySelector('.hired-toolbar h1');
    const search = workspace?.querySelector('.hired-toolbar input');
    const summary = workspace?.querySelector('.hired-toolbar .hired-count');
    if (summary) summary.hidden = Boolean(selected);
    let panel = workspace?.querySelector('.kx-queue-panel');
    if (!selected) {
      if (content) { content.hidden = false; content.style.removeProperty('display'); }
      if (search) search.hidden = false;
      restoreVoice();
      if (panel) panel.remove();
      if (title?.dataset.kxQueue) {
        title.textContent = 'Inquiries';
        delete title.dataset.kxQueue;
      }
      paintKiosk();
      applying = false;
      return;
    }
    if (content) { content.hidden = true; content.style.display = 'none'; }
    if (search) search.hidden = true;
    if (title && title.textContent !== NAMES[selected]) {
      title.dataset.kxQueue = selected;
      title.textContent = NAMES[selected];
    }
    if (!panel && workspace) {
      panel = document.createElement('div');
      panel.className = 'hired-content kx-queue-panel';
      workspace.appendChild(panel);
    }
    if (panel) renderPanel(panel);
    applying = false;
  };

  const ensureInbox = (desk) => {
    if (desk.querySelector('[data-kx-inbox]')) return;
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Inbox');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.kxInbox = 'open';
    button.className = 'hired-potential-filter';
    button.textContent = 'Inbox';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.kxOpenQueue('inbox');
    });
    nav.append(button);
    const views = desk.querySelector('nav[aria-label="Views"]');
    if (views) views.before(nav);
  };

  window.kxOpenQueue = (name) => {
    const known = name === 'inbox' || Boolean(NAMES[name]);
    if (known && !selected) {
      savedNavigation = [...document.querySelectorAll('nav[aria-label="Views"] button, nav[aria-label="Lead potential filters"] button')].map(button => [button, button.getAttribute('aria-pressed') || 'false']);
    } else if (!known) restoreNavigation();
    selected = known ? name : '';
    openId = '';
    window.kxQueue = selected;
    paint();
  };

  document.addEventListener(
    'click',
    (event) => {
      const inquiry = event.target.closest(
        'nav[aria-label="Views"] button, nav[aria-label="Lead potential filters"] button, .hired-filter-chips button',
      );
      if (!inquiry || !selected) return;
      restoreNavigation();
      selected = '';
      openId = '';
      window.kxQueue = '';
      queueMicrotask(paint);
    },
    true,
  );

  const watch = new MutationObserver(() => paint());
  const start = () => {
    const desk = document.querySelector('.hired-desk');
    if (!desk) return false;
    watch.observe(desk, { childList: true, subtree: true, characterData: true });
    paint();
    load().catch(() => {
      data = { unavailable: true };
      paint();
    });
    return true;
  };
  if (!start()) {
    const boot = new MutationObserver(() => {
      if (start()) boot.disconnect();
    });
    boot.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
