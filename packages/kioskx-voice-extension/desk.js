(() => {
  let busy = false;
  let session;
  let config;
  const request = async (path, body) => {
    const pair = JSON.parse(localStorage.getItem('tokenPairState') || 'null');
    const token = pair?.accessOrWorkspaceAgnosticToken?.token;
    if (!token) throw new Error('Sign in');
    const result = await fetch('/kioskx-hired-desk/' + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!result.ok) throw new Error('Unavailable');
    return result.json();
  };
  function status(value) {
    document.documentElement.dataset.kioskxVoice = value;
    document.documentElement.dataset.kioskxVoiceUpdated = String(Date.now());
  }
  // Setup is the only action that opens a foreground tab. Calls never leave the inquiry.
  document.addEventListener('click', event => {
    if (event.target.closest('[data-kioskx-voice-connect]')) {
      chrome.runtime.sendMessage({ action: 'setup' }).catch(() => status('connect'));
    }
  });
  async function tick() {
    if (busy || !document.querySelector('.hired-desk')) return;
    status(document.documentElement.dataset.kioskxVoice || 'connect');
    busy = true;
    try {
      config = await request('voice-config');
      if (!config.enabled) { status('unavailable'); return; }
      session = await chrome.runtime.sendMessage({ action: 'session', officeHash: config.officeHash });
      if (session.status !== 'connected') { status('connect'); return; }
      const connected = await request('voice-bridge', { action: 'connect',
        sessionId: session.sessionId, publicKey: session.publicKey });
      if (connected.status !== 'connected') { status(connected.status === 'busy' ? 'busy' : 'connect'); return; }
      status('connected');
      const job = await request('voice-bridge', { action: 'poll', sessionId: session.sessionId });
      if (job.status === 'claimed') {
        const result = await chrome.runtime.sendMessage({ action: 'dial', officeHash: config.officeHash,
          operationId: job.operationId, ciphertext: job.ciphertext });
        await request('voice-bridge', { action: 'result', sessionId: session.sessionId,
          operationId: job.operationId, status: result.status });
        if (result.status === 'no-session') status('connect');
      }
    } catch { status('connect'); }
    finally { busy = false; }
  }
  setInterval(tick, 3000);
  void tick();
})();
