/**
 * Self-contained test harness (no deps) for the Intelli-Verse channel contract.
 * Run: `node crm-schema/contract/contract.test.mjs`
 *
 * Proves the design works for multiple apps with different audiences
 * (quizverse, toba, intelliverse) across Tier 1/2/3 countries and all four
 * systems (Notifuse / Fonoster / OpenBSP / Telnyx), including edge cases.
 */
import {
  validateEvent,
  mapToCrm,
  evaluateOutbound,
  deriveCountry,
} from './contract.mjs';

let pass = 0;
let fail = 0;
const fails = [];
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log(`  ✗ ${name}`); }
}

// Fixed "now" so quiet-hours/window tests are deterministic.
// 2026-06-18T16:00:00Z = 16:00 UTC.
const NOW = new Date('2026-06-18T16:00:00Z');

// Helper to build a canonical event with sane defaults.
function ev(over = {}) {
  return {
    schemaVersion: '1.0',
    eventId: `evt_${Math.random().toString(36).slice(2)}`,
    appId: 'quizverse',
    source: 'telnyx',
    channel: 'sms',
    direction: 'outbound',
    type: 'message',
    occurredAt: NOW.toISOString(),
    party: { address: '+14155550123', addressType: 'phone', country: 'US', timezone: 'America/New_York', locale: 'en-US' },
    delivery: { provider: 'telnyx', registrationStatus: '10dlc', senderIdType: 'long_code' },
    consent: { status: 'opted_in', basis: 'explicit' },
    content: { body: 'hello' },
    ...over,
  };
}

console.log('\n=== 1. Country derivation (Tier 1/2/3) ===');
check('US +1', deriveCountry('+14155550123') === 'US');
check('GB +44', deriveCountry('+447700900123') === 'GB');
check('IN +91', deriveCountry('+919876543210') === 'IN');
check('BR +55', deriveCountry('+5511998765432') === 'BR');
check('NG +234', deriveCountry('+2348012345678') === 'NG');
check('ID +62', deriveCountry('+6281234567890') === 'ID');
check('unknown +99', deriveCountry('+9990000000') === null);
check('non-e164 null', deriveCountry('not-a-phone') === null);

console.log('\n=== 2. Structural validation ===');
check('valid event passes', validateEvent(ev()).ok === true);
check('missing appId fails', validateEvent(ev({ appId: undefined })).ok === false);
check('bad channel fails', validateEvent(ev({ channel: 'fax' })).ok === false);
check('non-e164 phone fails', validateEvent(ev({ party: { address: '4155550123', addressType: 'phone' } })).ok === false);
check('email channel ok', validateEvent(ev({
  appId: 'toba', source: 'notifuse', channel: 'email', type: 'email',
  party: { address: 'lead@toba.example', addressType: 'email', country: 'DE', timezone: 'Europe/Berlin' },
  delivery: { provider: 'ses' },
})).ok === true);
check('missing timezone warns', validateEvent(ev({ party: { address: '+14155550123', addressType: 'phone', country: 'US' } })).warnings.length > 0);

console.log('\n=== 3. mapToCrm scopes everything by appId ===');
{
  const m = mapToCrm(ev({ appId: 'intelliverse' }));
  check('lead scoped', m.lead.app_id === 'intelliverse');
  check('identity scoped', m.channel_identity.app_id === 'intelliverse');
  check('conversation scoped', m.conversation.app_id === 'intelliverse');
  check('interaction scoped', m.interaction.app_id === 'intelliverse');
  check('event scoped', m.channel_event.app_id === 'intelliverse');
  check('event_type composed', m.channel_event.event_type === 'sms.message.outbound');
  check('currency from country (US->USD)', m.interaction.cost_currency === 'USD');
}
{
  // WhatsApp inbound sets 24h service window
  const m = mapToCrm(ev({
    appId: 'toba', source: 'openbsp', channel: 'whatsapp', direction: 'inbound', type: 'message',
    party: { address: '+919876543210', addressType: 'phone', country: 'IN', timezone: 'Asia/Kolkata' },
    delivery: { provider: 'meta_whatsapp' },
  }));
  check('WA inbound window set', !!m.conversation.service_window_expires_at);
  check('WA lead source', m.lead.source === 'whatsapp');
  check('INR currency', m.interaction.cost_currency === 'INR');
}

console.log('\n=== 4. Outbound compliance — SMS registration per country ===');
// US: 10DLC ok
check('US 10DLC allowed', evaluateOutbound(ev(), NOW).decision === 'ALLOW');
// US: unregistered blocked
check('US unregistered blocked', evaluateOutbound(ev({ delivery: { provider: 'telnyx', registrationStatus: undefined } }), NOW).decision === 'BLOCK');
// India: requires DLT; 10dlc not valid -> blocked
check('IN requires DLT (10dlc blocked)', evaluateOutbound(ev({
  party: { address: '+919876543210', addressType: 'phone', country: 'IN', timezone: 'Asia/Kolkata' },
  delivery: { provider: 'telnyx', registrationStatus: '10dlc' },
}), NOW).decision === 'BLOCK');
// India: DLT registered -> allowed (10:00 IST, not quiet)
check('IN DLT allowed', evaluateOutbound(ev({
  occurredAt: '2026-06-18T04:30:00Z', // 10:00 IST
  party: { address: '+919876543210', addressType: 'phone', country: 'IN', timezone: 'Asia/Kolkata' },
  delivery: { provider: 'telnyx', registrationStatus: 'dlt', senderIdType: 'alphanumeric' },
}), new Date('2026-06-18T04:30:00Z')).decision === 'ALLOW');
// Nigeria: alpha registration required + supported
check('NG alpha allowed', evaluateOutbound(ev({
  occurredAt: '2026-06-18T10:00:00Z', // 11:00 WAT
  party: { address: '+2348012345678', addressType: 'phone', country: 'NG', timezone: 'Africa/Lagos' },
  delivery: { provider: 'telnyx', registrationStatus: 'alpha', senderIdType: 'alphanumeric' },
}), new Date('2026-06-18T10:00:00Z')).decision === 'ALLOW');
// US: alphanumeric not supported -> blocked
check('US alpha blocked', evaluateOutbound(ev({
  delivery: { provider: 'telnyx', registrationStatus: '10dlc', senderIdType: 'alphanumeric' },
}), NOW).decision === 'BLOCK');

console.log('\n=== 5. Consent gating ===');
check('US marketing no-consent blocked', evaluateOutbound(ev({ consent: { status: 'pending' } }), NOW).decision === 'BLOCK');
check('US transactional note allowed w/o consent', evaluateOutbound(ev({ type: 'note', consent: { status: 'pending' } }), NOW).decision === 'ALLOW');
check('email opted_out blocked', evaluateOutbound(ev({
  appId: 'toba', source: 'notifuse', channel: 'email', type: 'email',
  party: { address: 'x@toba.example', addressType: 'email', country: 'DE', timezone: 'Europe/Berlin' },
  delivery: { provider: 'ses' }, consent: { status: 'opted_out' },
}), NOW).decision === 'BLOCK');

console.log('\n=== 6. WhatsApp 24h window ===');
check('WA free-form outside window blocked', evaluateOutbound(ev({
  appId: 'intelliverse', source: 'openbsp', channel: 'whatsapp', type: 'message',
  party: { address: '+5511998765432', addressType: 'phone', country: 'BR', timezone: 'America/Sao_Paulo' },
  delivery: { provider: 'meta_whatsapp', waCategory: 'service' },
  conversation: { serviceWindowExpiresAt: '2026-06-18T15:00:00Z' }, // expired (NOW=16:00Z)
}), NOW).decision === 'BLOCK');
check('WA template outside window allowed', evaluateOutbound(ev({
  appId: 'intelliverse', source: 'openbsp', channel: 'whatsapp', type: 'template',
  party: { address: '+5511998765432', addressType: 'phone', country: 'BR', timezone: 'America/Sao_Paulo' },
  delivery: { provider: 'meta_whatsapp', waCategory: 'utility' },
  consent: { status: 'opted_in' },
  conversation: { serviceWindowExpiresAt: '2026-06-18T15:00:00Z' },
}), NOW).decision === 'ALLOW');
check('WA free-form inside window allowed', evaluateOutbound(ev({
  appId: 'intelliverse', source: 'openbsp', channel: 'whatsapp', type: 'message',
  party: { address: '+5511998765432', addressType: 'phone', country: 'BR', timezone: 'America/Sao_Paulo' },
  delivery: { provider: 'meta_whatsapp', waCategory: 'service' },
  conversation: { serviceWindowExpiresAt: '2026-06-18T17:00:00Z' }, // future
}), NOW).decision === 'ALLOW');

console.log('\n=== 7. Voice coverage (Tier 3 limited) ===');
check('voice ID deferred (no two-way)', evaluateOutbound(ev({
  appId: 'toba', source: 'fonoster', channel: 'voice', type: 'call',
  occurredAt: '2026-06-18T08:00:00Z', // 15:00 WIB, not quiet
  party: { address: '+6281234567890', addressType: 'phone', country: 'ID', timezone: 'Asia/Jakarta' },
  delivery: { provider: 'fonoster' },
}), new Date('2026-06-18T08:00:00Z')).decision === 'DEFER');
check('voice US allowed', evaluateOutbound(ev({
  appId: 'toba', source: 'fonoster', channel: 'voice', type: 'call',
  party: { address: '+14155550123', addressType: 'phone', country: 'US', timezone: 'America/New_York' },
  delivery: { provider: 'fonoster' },
}), NOW).decision === 'ALLOW');

console.log('\n=== 8. Quiet hours (recipient-local, marketing) ===');
// 23:00 in New York is quiet (US quiet 21-08). NOW=16:00Z -> 12:00 NY (not quiet) so craft a late time.
check('US 23:00 local deferred', evaluateOutbound(ev({
  occurredAt: '2026-06-19T03:00:00Z', // 23:00 EDT previous day
}), new Date('2026-06-19T03:00:00Z')).decision === 'DEFER');
check('US 12:00 local allowed', evaluateOutbound(ev(), NOW).decision === 'ALLOW');

console.log('\n=== 9. Multi-app / multi-audience smoke (quizverse, toba, intelliverse) ===');
for (const appId of ['quizverse', 'toba', 'intelliverse']) {
  for (const [src, channel, type, provider, addr, cc, tz] of [
    ['notifuse', 'email', 'email', 'ses', 'a@x.example', 'GB', 'Europe/London'],
    ['fonoster', 'voice', 'call', 'fonoster', '+14155550123', 'US', 'America/New_York'],
    ['openbsp', 'whatsapp', 'template', 'meta_whatsapp', '+919876543210', 'IN', 'Asia/Kolkata'],
    ['telnyx', 'sms', 'message', 'telnyx', '+5511998765432', 'BR', 'America/Sao_Paulo'],
  ]) {
    const e = ev({
      appId, source: src, channel, type, direction: 'inbound',
      party: { address: addr, addressType: addr.includes('@') ? 'email' : 'phone', country: cc, timezone: tz },
      delivery: { provider },
      consent: undefined,
    });
    const v = validateEvent(e);
    const m = mapToCrm(e);
    check(`${appId}/${channel} validates`, v.ok === true);
    check(`${appId}/${channel} scoped to app`, m.lead.app_id === appId && m.interaction.app_id === appId);
  }
}

console.log('\n=== 10. Idempotency key flows through ===');
{
  const e = ev({ eventId: 'evt_fixed_123' });
  check('event external_id = eventId', mapToCrm(e).channel_event.external_id === 'evt_fixed_123');
}

console.log(`\n──────────────────────────────────────`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
console.log('✅ All contract tests passed — design works across apps, channels, and Tier 1/2/3 countries.');
