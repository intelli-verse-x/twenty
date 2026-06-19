/**
 * Tests the Chatwoot adapter end-to-end: webhook -> CanonicalEvent -> contract
 * validation -> App-ID-scoped CRM rows. Run:
 *   node crm-schema/integrations/chatwoot-adapter.test.mjs
 */
import { chatwootToCanonical } from './chatwoot-adapter.mjs';
import { validateEvent, mapToCrm } from '../contract/contract.mjs';

let pass = 0, fail = 0;
const fails = [];
const check = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log(`  ✗ ${n}`); } };

// One Chatwoot Account per app owner.
const ACCOUNT_TO_APP = { 1: 'quizverse', 2: 'toba', 3: 'intelliverse' };
const accountIdToAppId = (id) => ACCOUNT_TO_APP[id] ?? `account-${id}`;

function waMsg(accountId) {
  return {
    event: 'message_created',
    id: 9001,
    content: 'Hi, interested in the premium plan',
    message_type: 'incoming',
    created_at: '2026-06-18T16:00:00Z',
    account: { id: accountId },
    inbox: { id: 11, channel_type: 'Channel::Whatsapp' },
    conversation: { id: 555, account_id: accountId, labels: ['lead'], meta: { sender: { id: 77, name: 'Asha', phone_number: '+919876543210', country_code: 'IN' } } },
  };
}

function emailMsg(accountId) {
  return {
    event: 'message_created',
    id: 9002,
    content: 'Please send pricing',
    message_type: 'incoming',
    created_at: '2026-06-18T16:05:00Z',
    account: { id: accountId },
    inbox: { id: 12, channel_type: 'Channel::Email' },
    conversation: { id: 556, account_id: accountId, meta: { sender: { id: 78, name: 'Bruno', email: 'bruno@toba.example', country_code: 'BR' } } },
  };
}

console.log('\n=== Chatwoot adapter: WhatsApp inbound (quizverse) ===');
{
  const ev = chatwootToCanonical(waMsg(1), { accountIdToAppId });
  check('produces event', !!ev);
  check('appId from account', ev.appId === 'quizverse');
  check('channel whatsapp', ev.channel === 'whatsapp');
  check('provider meta_whatsapp', ev.delivery.provider === 'meta_whatsapp');
  check('phone preserved', ev.party.address === '+919876543210');
  const v = validateEvent(ev);
  check('validates ok', v.ok === true);
  const m = mapToCrm(ev);
  check('lead scoped to app', m.lead.app_id === 'quizverse');
  check('WA inbound sets 24h window', !!m.conversation.service_window_expires_at);
  check('lead source whatsapp', m.lead.source === 'whatsapp');
}

console.log('\n=== Chatwoot adapter: Email inbound (toba) ===');
{
  const ev = chatwootToCanonical(emailMsg(2), { accountIdToAppId });
  check('appId toba', ev.appId === 'toba');
  check('channel email', ev.channel === 'email');
  check('addressType email', ev.party.addressType === 'email');
  check('provider ses', ev.delivery.provider === 'ses');
  check('validates ok', validateEvent(ev).ok === true);
  check('mapped lead scoped', mapToCrm(ev).lead.app_id === 'toba');
}

console.log('\n=== Ignores non-lead events ===');
check('ignores outgoing', chatwootToCanonical({ ...waMsg(1), message_type: 'outgoing' }, { accountIdToAppId }) === null);
check('ignores non message_created', chatwootToCanonical({ event: 'conversation_resolved' }, { accountIdToAppId }) === null);

console.log('\n=== Account isolation across app owners ===');
{
  const q = chatwootToCanonical(waMsg(1), { accountIdToAppId });
  const t = chatwootToCanonical(waMsg(2), { accountIdToAppId });
  const i = chatwootToCanonical(waMsg(3), { accountIdToAppId });
  check('q->quizverse', q.appId === 'quizverse');
  check('t->toba', t.appId === 'toba');
  check('i->intelliverse', i.appId === 'intelliverse');
  check('distinct appIds', new Set([q.appId, t.appId, i.appId]).size === 3);
}

console.log('\n=== Idempotency key is stable + unique ===');
{
  const a = chatwootToCanonical(waMsg(1), { accountIdToAppId });
  const b = chatwootToCanonical(waMsg(1), { accountIdToAppId });
  check('same payload -> same eventId', a.eventId === b.eventId);
  const c = chatwootToCanonical(emailMsg(2), { accountIdToAppId });
  check('different msg -> different eventId', a.eventId !== c.eventId);
}

console.log('\n=== Requires mapping ===');
try { chatwootToCanonical(waMsg(1), {}); check('throws without mapping', false); }
catch { check('throws without mapping', true); }

console.log(`\n──────────────────────────────────────`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
console.log('✅ Chatwoot adapter wires inbound DMs/email into the App-ID contract.');
