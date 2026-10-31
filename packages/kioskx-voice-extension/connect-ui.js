(() => {
  function render() {
    const inquiry = document.querySelector('.hired-actions');
    if (!inquiry) return;
    let panel = document.querySelector('#kioskx-voice-connect');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'kioskx-voice-connect'; panel.setAttribute('aria-label', 'Google Voice connection');
      panel.style.cssText = 'padding:12px 0;font:inherit';
      inquiry.insertAdjacentElement('afterend', panel);
    }
    const updated = Number(document.documentElement.dataset.kioskxVoiceUpdated || 0);
    const stale = updated && Date.now() - updated > 15000;
    const state = stale ? 'install' : document.documentElement.dataset.kioskxVoice || 'install';
    if (panel.dataset.state === state) return;
    panel.dataset.state = state;
    panel.replaceChildren();
    const text = document.createElement('p');
    text.textContent = state === 'connected' ? 'Google Voice account connected. Call sends this inquiry to the office account; answer your linked phone if it rings.' :
      state === 'unavailable' ? 'Calling is disabled or the office account is not configured. Contact your admin.' :
      state === 'busy' ? 'Another office browser is connected. Close that inquiry desk, then connect here.' :
      'Connect the office Google Voice account once to call from this inquiry.';
    panel.append(text);
    if (state !== 'connected') {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Connect Google Voice';
      button.style.cssText = 'border:1px solid #d9cbb5;border-radius:8px;padding:10px 16px;background:#fff;color:#173f43;font:inherit;cursor:pointer';
      button.dataset.kioskxVoiceConnect = '';
      button.onclick = () => {
        if (state !== 'install') return;
        const info = document.createElement('p');
        info.textContent = 'Install the KioskX inquiry calls extension: download, unzip, open chrome://extensions, enable Developer mode and choose Load unpacked. If already installed, reload the extension and this inquiry. Then Connect the office account. In Voice settings, open Account; in Calls, select your linked phone for outgoing calls. Incoming call forwarding alone does not select the outgoing phone.';
        const download = document.createElement('a');
        download.href = '/assets/kioskx-voice-extension.zip'; download.download = 'kioskx-voice-extension.zip';
        download.textContent = 'Download extension';
        panel.replaceChildren(text, info, download);
      };
      panel.append(button);
    }
  }
  setInterval(render, 1000); render();
})();
