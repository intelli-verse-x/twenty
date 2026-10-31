// Real /welcome assets, synthetic hired identity, isolated bridge repositories.
// Every hired endpoint is intercepted. No customer dial, email, or database write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { setup, lead, keys } = require('./bridge-fixture.cjs');
const origin = 'https://kioskx.crm.intelli-verse-x.ai';
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixture = setup();
    let ready = false, calls = 0, handoffs = 0, errors = 0;
    const statuses = [];
    await page.exposeFunction('__voiceMessage', async message => {
      if (message.action === 'setup') { ready = true; return { status: 'setup' }; }
      if (message.action === 'session') return ready ? {
        status: 'connected', sessionId: fixture.sessionId,
        publicKey: keys.publicKey.export({type:'spki',format:'pem'}),
      } : { status: 'connect' };
      if (message.action === 'dial') {
        // Decrypt only the reserved fictional destination. Never open Google.
        assert.equal(crypto.privateDecrypt({key:keys.privateKey,oaepHash:'sha256'},
          Buffer.from(message.ciphertext,'base64')).toString(), '+12025550123');
        handoffs++;
        return { status: 'opened' };
      }
      throw Error('Unexpected extension action');
    });
    await page.addInitScript(() => {
      localStorage.setItem('tokenPairState', JSON.stringify({
        accessOrWorkspaceAgnosticToken: { token: 'fake-session', expiresAt: new Date(Date.now() + 3600000).toISOString() },
        refreshToken: { token: 'fake-refresh', expiresAt: new Date(Date.now() + 3600000).toISOString() },
      }));
      window.chrome ||= {};
      window.chrome.runtime = { sendMessage: message => window.__voiceMessage(message) };
    });
    await page.route('**/kioskx-hired-desk/**', async r => {
      const endpoint = new URL(r.request().url()).pathname.split('/').pop();
      const body = r.request().method() === 'POST' ? r.request().postDataJSON() : {};
      let json;
      if (endpoint === 'session') json = { hired: true };
      else if (endpoint === 'leads') json = { leads: [{
        id: lead, label: 'Test inquiry', company: 'Fixture company', inquiry: 'Fixture inquiry',
        email: '••••@••••', phone: '••• ••• ••••', canCall: true, messages: [], potential: 'Unrated', callNotes: [],
      }] };
      else if (endpoint === 'activity') json = { status: 'recorded' };
      else if (endpoint === 'voice-config') json = await fixture.desk.bridgeConfig();
      else if (endpoint === 'voice-bridge') json = await fixture.desk.bridge(body);
      else if (endpoint === 'call') {
        assert.deepEqual(Object.keys(body).sort(), ['leadId', 'requestId']);
        calls++;json = await fixture.desk.call(body.leadId, body.requestId);statuses.push(json.status);
      } else throw Error('Unexpected hired request');
      await r.fulfill({json});
    });
    if (process.env.OVERLAY_FRONT) {
      const front = process.env.OVERLAY_FRONT;
      await page.route(origin + '/welcome', r => r.fulfill({path:path.join(front,'index.html'),contentType:'text/html'}));
      for (const name of ['index-email-call-0862f92d1c3b.js','kioskx-voice-connect.js'])
        await page.route(origin + '/assets/' + name, r => r.fulfill({path:path.join(front,'assets',name),contentType:'application/javascript'}));
    }
    page.on('pageerror', error => { errors++; console.log('Page error:', error.message); });
    page.on('popup', () => { throw Error('Inquiry opened another page'); });
    await page.goto(origin + '/welcome', { waitUntil: 'domcontentloaded', timeout: 180000 });
    const connect = page.getByRole('button', { name: 'Connect Google Voice', exact: true });
    const call = page.getByRole('button', { name: 'Call', exact: true });
    await connect.waitFor({timeout:120000});
    console.log('Welcome and Connect rendered');
    await connect.click();
    await page.getByRole('link', {name:'Download extension'}).waitFor();
    console.log('Install help rendered');
    // Execute the actual extension polling code, with only Chrome's external side mocked.
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../desk.js'),'utf8')});
    await connect.waitFor();
    console.log('Extension content script active');
    await call.click();
    await page.getByText('Use Connect Google Voice, then try Call again.', {exact:true}).waitFor();
    assert.equal(await call.isEnabled(),true);
    console.log('No-session Call returns Connect');
    await connect.click();
    await page.getByText(/^Google Voice account connected\./).waitFor().catch(async e => { console.log('Pairing diagnostic:', await page.evaluate(() => ({state:document.documentElement.dataset.kioskxVoice,bridge:!!window.chrome?.runtime?.sendMessage,desk:!!document.querySelector('.hired-desk')}))); throw e; });
    console.log('Verified session connected');
    await call.click();
    await page.getByText(/^Sent to Google Voice\./).waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.kioskxVoice === 'connected');
    const deadline=Date.now()+10000;
    while (handoffs===0 && Date.now()<deadline) await page.waitForTimeout(200);
    assert.equal(handoffs,1);
    assert.deepEqual(statuses,['connect','queued']);
    assert.equal(calls,2);
    assert.equal(await page.locator('.hired-desk').count(),1);
    assert.equal(await page.getByRole('heading',{name:'Test inquiry',exact:true}).isVisible(),true);
    assert.equal(await page.locator('iframe,a[href^="tel:"],input[type="tel"]').count(),0);
    assert.doesNotMatch(await page.locator('body').innerText(),/Sorry, something went wrong|2025550123|202\) 555/);
    for (const [width,height] of [[390,844],[375,667],[1280,720],[1920,1080]]) {
      await page.setViewportSize({width,height});
      assert.equal(await page.locator('.hired-desk').isVisible(),true);
    }
    await page.setViewportSize({width:1440,height:900});
    if (process.env.EVIDENCE_SCREENSHOT) await page.screenshot({path:process.env.EVIDENCE_SCREENSHOT,fullPage:true});
    ready=false;
    await connect.waitFor({timeout:20000});
    fixture.env.KIOSKX_HIRED_VOICE='false';
    await page.getByText('Calling is disabled or the office account is not configured. Contact your admin.',{exact:true}).waitFor();
    assert.equal(errors,0);
    console.log(JSON.stringify({inquiryDesk:true,connectedThenDisconnected:true,encryptedHandoffs:handoffs,
      errorScreen:false,pageErrors:errors,mockedCalls:calls,realCalls:0}));
  } finally { await browser.close(); }
})().catch(error => { console.error('Connect verification failed:', error.name, error.message); process.exitCode = 1; });
