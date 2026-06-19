/**
 * Intelli-Verse channel contract — the single normalized envelope that every
 * system (Notifuse / Fonoster / OpenBSP / Telnyx) emits (via n8n) and that maps
 * deterministically into the App-ID-scoped CRM model (../schema.sql).
 *
 * Dependency-free (plain `node`). Exports:
 *   - enums + the CanonicalEvent shape (see README)
 *   - COUNTRIES: Firecrawl-verified regulatory table (Tier 1/2/3)
 *   - validateEvent()    : structural + channel coherence validation
 *   - mapToCrm()         : CanonicalEvent -> CRM rows (all scoped by appId)
 *   - evaluateOutbound() : compliance/exception engine (ALLOW | DEFER | BLOCK)
 */

// ---------------------------------------------------------------------------
// Enums (mirror schema.sql)
// ---------------------------------------------------------------------------
export const CHANNELS = ['email', 'sms', 'voice', 'whatsapp', 'web'];
export const SOURCES = ['notifuse', 'fonoster', 'openbsp', 'telnyx'];
export const PROVIDERS = ['telnyx', 'meta_whatsapp', 'ses', 'fonoster', 'notifuse', 'other'];
export const DIRECTIONS = ['inbound', 'outbound'];
export const TYPES = ['message', 'call', 'email', 'template', 'voicemail', 'note', 'status'];
export const WA_CATEGORIES = ['marketing', 'utility', 'authentication', 'service'];
export const SENDER_ID_TYPES = ['long_code', 'toll_free', 'short_code', 'alphanumeric'];

// Canonical source for each channel (coherence check; warn only).
const CHANNEL_SOURCE = {
  email: ['notifuse'],
  voice: ['fonoster'],
  whatsapp: ['openbsp'],
  sms: ['telnyx'],
  web: ['notifuse', 'fonoster', 'openbsp', 'telnyx'],
};

// ---------------------------------------------------------------------------
// Country regulatory table — Firecrawl-verified (2026). Keyed by ISO-3166 α2.
//   smsRegistration: registration REQUIRED to send A2P SMS
//     '10dlc' | 'toll_free' | 'dlt' | 'alpha' | 'none'
//   alphaSupported : alphanumeric sender IDs accepted (after registration)
//   quietHours     : [startHour, endHour) in recipient-local time (marketing)
//   voiceTwoWay    : Telnyx has two-way local voice coverage
// ---------------------------------------------------------------------------
export const COUNTRIES = {
  // Tier 1
  US: { tier: 1, dial: '1',   currency: 'USD', smsRegistration: ['10dlc', 'toll_free'], alphaSupported: false, consentLaw: 'TCPA',          quietHours: [21, 8], voiceTwoWay: true },
  CA: { tier: 1, dial: '1',   currency: 'CAD', smsRegistration: ['10dlc', 'toll_free'], alphaSupported: false, consentLaw: 'CASL',          quietHours: [21, 8], voiceTwoWay: true },
  GB: { tier: 1, dial: '44',  currency: 'GBP', smsRegistration: ['none'],               alphaSupported: true,  consentLaw: 'UK-GDPR/PECR',  quietHours: [21, 8], voiceTwoWay: true },
  DE: { tier: 1, dial: '49',  currency: 'EUR', smsRegistration: ['none'],               alphaSupported: true,  consentLaw: 'GDPR',          quietHours: [22, 8], voiceTwoWay: true },
  AU: { tier: 1, dial: '61',  currency: 'AUD', smsRegistration: ['alpha'],              alphaSupported: true,  consentLaw: 'SpamAct/ACMA',  quietHours: [21, 9], voiceTwoWay: true },
  // Tier 2
  BR: { tier: 2, dial: '55',  currency: 'BRL', smsRegistration: ['none'],               alphaSupported: false, consentLaw: 'LGPD',          quietHours: [21, 9], voiceTwoWay: true },
  IN: { tier: 2, dial: '91',  currency: 'INR', smsRegistration: ['dlt'],                alphaSupported: true,  consentLaw: 'DPDP/TRAI-DLT', quietHours: [21, 9], voiceTwoWay: true },
  AE: { tier: 2, dial: '971', currency: 'AED', smsRegistration: ['alpha'],              alphaSupported: true,  consentLaw: 'TDRA',          quietHours: [21, 7], voiceTwoWay: false },
  // Tier 3
  ID: { tier: 3, dial: '62',  currency: 'IDR', smsRegistration: ['alpha'],              alphaSupported: true,  consentLaw: 'PDP',           quietHours: [21, 8], voiceTwoWay: false },
  NG: { tier: 3, dial: '234', currency: 'NGN', smsRegistration: ['alpha'],              alphaSupported: true,  consentLaw: 'NDPA',          quietHours: [21, 8], voiceTwoWay: false },
};

// Longest-prefix dial-code resolution across operating countries.
const DIAL_TO_COUNTRY = Object.entries(COUNTRIES)
  .map(([cc, c]) => [c.dial, cc])
  .sort((a, b) => b[0].length - a[0].length);

export function deriveCountry(phoneE164) {
  if (typeof phoneE164 !== 'string' || !phoneE164.startsWith('+')) return null;
  const digits = phoneE164.slice(1);
  // +1 is shared (US/CA); default to US unless explicitly provided as CA.
  for (const [dial, cc] of DIAL_TO_COUNTRY) {
    if (digits.startsWith(dial)) return cc;
  }
  return null;
}

const E164 = /^\+[1-9]\d{6,14}$/;
export const isE164 = (s) => typeof s === 'string' && E164.test(s);

// ---------------------------------------------------------------------------
// validateEvent: structural validation -> { ok, errors[], warnings[] }
// ---------------------------------------------------------------------------
export function validateEvent(e) {
  const errors = [];
  const warnings = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };

  req(e.schemaVersion, 'schemaVersion required');
  req(e.eventId, 'eventId required (idempotency)');
  req(e.appId, 'appId required (App-ID scope)');
  req(e.occurredAt && !Number.isNaN(Date.parse(e.occurredAt)), 'occurredAt must be ISO-8601');
  req(SOURCES.includes(e.source), `source must be one of ${SOURCES}`);
  req(CHANNELS.includes(e.channel), `channel must be one of ${CHANNELS}`);
  req(DIRECTIONS.includes(e.direction), `direction must be one of ${DIRECTIONS}`);
  req(TYPES.includes(e.type), `type must be one of ${TYPES}`);
  req(e.party?.address, 'party.address required');
  req(['phone', 'email'].includes(e.party?.addressType), 'party.addressType must be phone|email');
  req(PROVIDERS.includes(e.delivery?.provider), `delivery.provider must be one of ${PROVIDERS}`);

  if (e.party?.addressType === 'phone' && e.party?.address && !isE164(e.party.address)) {
    errors.push(`party.address must be E.164 (got "${e.party.address}")`);
  }
  if (e.party?.addressType === 'email' && e.channel !== 'email') {
    warnings.push('email address on non-email channel');
  }
  if (CHANNEL_SOURCE[e.channel] && !CHANNEL_SOURCE[e.channel].includes(e.source)) {
    warnings.push(`source "${e.source}" is unusual for channel "${e.channel}"`);
  }
  // i18n completeness
  if (!e.party?.country) warnings.push('party.country missing (will derive from phone)');
  if (!e.party?.locale) warnings.push('party.locale missing (i18n/RTL/template default)');
  if (!e.party?.timezone) warnings.push('party.timezone missing (quiet-hours cannot be enforced)');

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// mapToCrm: CanonicalEvent -> CRM rows (every row scoped by appId)
// ---------------------------------------------------------------------------
export function mapToCrm(e) {
  const country = e.party?.country || deriveCountry(e.party?.address) || null;
  const lead = {
    app_id: e.appId,
    display_name: e.party?.displayName ?? null,
    source: sourceToLeadSource(e),
    external_ref: e.party?.externalRef ?? e.party?.address,
  };
  const channel_identity = {
    app_id: e.appId,
    channel: e.channel,
    address: e.party?.address,
    provider: e.delivery?.provider,
    verified: !!e.party?.verified,
  };
  const consent = e.consent
    ? { app_id: e.appId, channel: e.channel, status: e.consent.status, basis: e.consent.basis ?? 'explicit', captured_at: e.consent.capturedAt ?? null }
    : null;
  const conversation = {
    app_id: e.appId,
    channel: e.channel,
    direction: e.direction,
    external_ref: e.conversation?.externalRef ?? null,
    service_window_expires_at:
      e.conversation?.serviceWindowExpiresAt ??
      (e.channel === 'whatsapp' && e.direction === 'inbound' ? plus24h(e.occurredAt) : null),
  };
  const interaction = {
    app_id: e.appId,
    channel: e.channel,
    direction: e.direction,
    type: e.type,
    status: e.delivery?.status ?? 'received',
    provider: e.delivery?.provider,
    provider_message_id: e.delivery?.providerMessageId ?? null,
    body: e.content?.body ?? null,
    duration_seconds: e.delivery?.durationSeconds ?? null,
    cost: e.delivery?.cost?.amount ?? null,
    cost_currency: e.delivery?.cost?.currency ?? (country ? COUNTRIES[country]?.currency : null),
    occurred_at: e.occurredAt,
  };
  const channel_event = {
    app_id: e.appId,
    provider: e.delivery?.provider,
    event_type: `${e.channel}.${e.type}.${e.direction}`,
    external_id: e.eventId,
  };
  return { lead, channel_identity, consent, conversation, interaction, channel_event, country };
}

// ---------------------------------------------------------------------------
// evaluateOutbound: compliance + exception engine.
//   -> { decision: 'ALLOW' | 'DEFER' | 'BLOCK', reasons[] }
// ---------------------------------------------------------------------------
export function evaluateOutbound(e, now = new Date()) {
  const reasons = [];
  let decision = 'ALLOW';
  const block = (r) => { decision = 'BLOCK'; reasons.push(r); };
  const defer = (r) => { if (decision !== 'BLOCK') decision = 'DEFER'; reasons.push(r); };

  if (e.direction !== 'outbound') return { decision: 'ALLOW', reasons: ['inbound: no outbound gating'] };

  const cc = e.party?.country || deriveCountry(e.party?.address);
  const country = cc ? COUNTRIES[cc] : null;
  if (!country) block(`UNSUPPORTED_COUNTRY: cannot resolve country for ${e.party?.address}`);

  if (e.party?.addressType === 'phone' && !isE164(e.party.address)) block('INVALID_ADDRESS: phone not E.164');

  const isMarketing = e.channel === 'whatsapp' ? e.delivery?.waCategory === 'marketing' : e.type !== 'note';
  const consentOk = e.consent?.status === 'opted_in';

  // SMS
  if (e.channel === 'sms' && country) {
    const reg = e.delivery?.registrationStatus; // '10dlc'|'toll_free'|'dlt'|'alpha'
    const required = country.smsRegistration;
    if (!required.includes('none') && !required.includes(reg)) {
      block(`SENDER_NOT_REGISTERED: ${cc} requires ${required.join('|')} (got ${reg ?? 'none'})`);
    }
    if (e.delivery?.senderIdType === 'alphanumeric' && !country.alphaSupported) {
      block(`ALPHA_NOT_SUPPORTED: ${cc} rejects alphanumeric sender IDs`);
    }
    if (!consentOk && isMarketing) block(`NO_CONSENT: ${country.consentLaw} requires opt-in for marketing SMS`);
  }

  // WhatsApp
  if (e.channel === 'whatsapp') {
    const expires = e.conversation?.serviceWindowExpiresAt ? Date.parse(e.conversation.serviceWindowExpiresAt) : 0;
    const insideWindow = expires > now.getTime();
    if (!insideWindow && e.type !== 'template') {
      block('OUTSIDE_24H_WINDOW: free-form WhatsApp blocked outside service window — use an approved template');
    }
    if (e.delivery?.waCategory === 'marketing' && !consentOk) {
      block('NO_CONSENT: WhatsApp marketing requires opt-in');
    }
  }

  // Email
  if (e.channel === 'email' && isMarketing && e.consent?.status === 'opted_out') {
    block('UNSUBSCRIBED: recipient opted out of email');
  }

  // Voice coverage
  if (e.channel === 'voice' && country && !country.voiceTwoWay) {
    defer(`VOICE_COVERAGE_LIMITED: ${cc} has no two-way local voice (use intl origination / verify reachability)`);
  }

  // Quiet hours (marketing only), recipient-local
  if (isMarketing && country && e.party?.timezone) {
    const hour = localHour(now, e.party.timezone);
    if (hour != null) {
      const [start, end] = country.quietHours;
      const quiet = start > end ? hour >= start || hour < end : hour >= start && hour < end;
      if (quiet) defer(`QUIET_HOURS: ${cc} local hour ${hour} within ${start}:00–${end}:00 — schedule for later`);
    }
  }

  if (decision === 'ALLOW') reasons.push('ok');
  return { decision, reasons };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function plus24h(iso) { return new Date(Date.parse(iso) + 24 * 3600 * 1000).toISOString(); }

function localHour(date, tz) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(date)) % 24;
  } catch { return null; }
}

function sourceToLeadSource(e) {
  if (e.direction === 'inbound') {
    if (e.channel === 'whatsapp') return 'whatsapp';
    if (e.channel === 'voice') return 'voice_inbound';
    if (e.channel === 'sms') return 'sms';
    if (e.channel === 'email') return 'email';
    if (e.channel === 'web') return 'web_form';
  }
  if (e.channel === 'voice') return 'voice_outbound';
  return e.channel;
}
