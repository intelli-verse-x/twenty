const DESK = 'https://kioskx.crm.intelli-verse-x.ai';
const SETTINGS = 'https://voice.google.com/u/0/settings';
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const base64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
let running = false;

async function keys() {
  let { bridge } = await chrome.storage.session.get('bridge');
  if (!bridge) {
    const key = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    bridge = { sessionId: crypto.randomUUID(),
      publicKey: `-----BEGIN PUBLIC KEY-----\n${base64(await crypto.subtle.exportKey('spki', key.publicKey))}\n-----END PUBLIC KEY-----`,
      privateKey: await crypto.subtle.exportKey('jwk', key.privateKey) };
    await chrome.storage.session.set({ bridge });
  }
  return bridge;
}
async function officeSession(officeHash) {
  const tabs = await chrome.tabs.query({ url: SETTINGS + '*' });
  let tab = tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: SETTINGS, active: false });
  // Fail closed if Google redirects to sign-in or changes its settings DOM.
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const [probe] = await chrome.scripting.executeScript({ target: { tabId: tab.id },
        func: async expected => {
          if (location.origin !== 'https://voice.google.com' || !location.pathname.endsWith('/settings')) return false;
          const text = document.body.innerText;
          const heading = /(?:Your )?Google Voice number/i.exec(text);
          if (!heading) {
            // Settings remembers the Calls tab. Probe Account, never a forwarding
            // number in Calls; this navigation cannot place a call.
            const accountTab = [...document.querySelectorAll('button, a, [role="tab"]')]
              .find(node => node.textContent.trim() === 'Account');
            accountTab?.click();
            return false;
          }
          // Do not confuse a linked forwarding phone with this account's caller ID.
          const account = text.slice(heading.index + heading[0].length, heading.index + heading[0].length + 400).split(/Linked numbers/i)[0];
          const numbers = account.match(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/g) || [];
          for (const raw of numbers) {
            let number = raw.replace(/\D/g, '');
            if (number.length === 10) number = '1' + number;
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(number));
            if ([...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('') === expected) return true;
          }
          return false;
        }, args: [officeHash] });
      if (probe?.result === true) return true;
    } catch { return false; }
  }
  return false;
}
async function handle(message) {
  if (message.action === 'setup') {
    await chrome.tabs.create({ url: SETTINGS, active: true });
    return { status: 'setup' };
  }
  if (message.action === 'session') {
    if (!await officeSession(message.officeHash)) return { status: 'connect' };
    const { sessionId, publicKey } = await keys();
    return { status: 'connected', sessionId, publicKey };
  }
  if (message.action === 'dial') {
    if (running) return { status: 'unknown' };
    running = true;
    try {
      if (!await officeSession(message.officeHash)) return { status: 'no-session' };
      const bridge = await keys();
      // Persist before the external side effect, including across worker restarts.
      const { consumed = [] } = await chrome.storage.session.get('consumed');
      if (consumed.includes(message.operationId)) return { status: 'unknown' };
      await chrome.storage.session.set({ consumed: [...consumed, message.operationId].slice(-500) });
      const key = await crypto.subtle.importKey('jwk', bridge.privateKey,
        { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
      const destination = new TextDecoder().decode(await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' }, key, bytes(message.ciphertext)));
      if (!/^\+[1-9]\d{7,14}$/.test(destination)) return { status: 'unknown' };
      await chrome.tabs.create({ url: 'https://voice.google.com/u/0/calls?a=nc,' + encodeURIComponent(destination), active: false });
      return { status: 'opened' }; // This does NOT assert ringing, connection or a transcript.
    } finally { running = false; }
  }
  return { status: 'unavailable' };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || new URL(sender.tab.url).origin !== DESK) return false;
  handle(message).then(respond).catch(() => respond({ status: 'unavailable' }));
  return true;
});
