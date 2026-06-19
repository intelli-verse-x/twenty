/**
 * Chatwoot → CanonicalEvent adapter.
 *
 * Converts a Chatwoot webhook payload (event: message_created / conversation_*)
 * into the normalized CanonicalEvent consumed by ../contract/contract.mjs, so
 * inbound DMs / email / live-chat land in Twenty as App-ID-scoped leads through
 * the SAME pipeline as Fonoster / OpenBSP / Telnyx.
 *
 * App-ID mapping: one Chatwoot ACCOUNT == one app owner == one App-ID. The
 * mapping is config (account.id -> appId), so quizverse/toba/intelliverse stay
 * isolated. Provide it via `accountIdToAppId`.
 *
 * Chatwoot channel types -> our channel enum:
 *   Channel::WebWidget        -> web
 *   Channel::Email            -> email
 *   Channel::Whatsapp         -> whatsapp
 *   Channel::FacebookPage     -> web   (DM; treat as social → web bucket)
 *   Channel::Instagram        -> web
 *   Channel::TwitterProfile   -> web
 *   Channel::Telegram/Line/Sms-> sms/web as applicable
 */

const CHANNEL_MAP = {
  'Channel::Email': 'email',
  'Channel::Whatsapp': 'whatsapp',
  'Channel::WebWidget': 'web',
  'Channel::FacebookPage': 'web',
  'Channel::Instagram': 'web',
  'Channel::TwitterProfile': 'web',
  'Channel::Sms': 'sms',
  'Channel::Api': 'web',
};

function mapChannel(chatwootChannel) {
  return CHANNEL_MAP[chatwootChannel] ?? 'web';
}

/**
 * @param {object} payload  Chatwoot webhook body
 * @param {object} opts
 * @param {(accountId:number)=>string} opts.accountIdToAppId  required mapping
 * @returns {object|null}  CanonicalEvent, or null for events we ignore
 */
export function chatwootToCanonical(payload, opts) {
  const { accountIdToAppId } = opts ?? {};
  if (typeof accountIdToAppId !== 'function') {
    throw new Error('accountIdToAppId(accountId) mapping is required');
  }

  // We only turn inbound customer messages into lead events.
  if (payload?.event !== 'message_created') return null;
  if (payload?.message_type && payload.message_type !== 'incoming') return null;

  const conv = payload.conversation ?? {};
  const meta = conv.meta ?? {};
  const contact = meta.sender ?? payload.sender ?? {};
  const inbox = payload.inbox ?? {};
  const accountId = payload.account?.id ?? conv.account_id;
  const appId = accountIdToAppId(accountId);

  const channel = mapChannel(inbox.channel_type ?? payload.channel);
  const isEmail = channel === 'email';
  const address = isEmail
    ? (contact.email ?? '')
    : (contact.phone_number ?? contact.identifier ?? contact.email ?? '');

  return {
    schemaVersion: '1.0',
    eventId: `chatwoot:${accountId}:${payload.id ?? conv.id}:${payload.created_at ?? Date.now()}`,
    appId,
    source: 'openbsp', // social/chat inbox source bucket; see note in README
    channel,
    direction: 'inbound',
    type: 'message',
    occurredAt: toIso(payload.created_at) ?? new Date().toISOString(),
    party: {
      address,
      addressType: isEmail ? 'email' : 'phone',
      displayName: contact.name ?? null,
      externalRef: contact.id ? `chatwoot:contact:${contact.id}` : undefined,
      country: contact.country_code || undefined,
      verified: false,
    },
    delivery: {
      provider: providerFor(channel),
      providerMessageId: String(payload.id ?? ''),
      status: 'received',
    },
    conversation: {
      externalRef: `chatwoot:conv:${conv.id}`,
    },
    content: { body: payload.content ?? '' },
    // Pass through so n8n can label/route and write back the Chatwoot ids.
    _chatwoot: {
      accountId,
      conversationId: conv.id,
      inboxId: inbox.id,
      labels: conv.labels ?? [],
    },
  };
}

function providerFor(channel) {
  if (channel === 'whatsapp') return 'meta_whatsapp';
  if (channel === 'email') return 'ses';
  if (channel === 'sms') return 'telnyx';
  return 'other';
}

function toIso(v) {
  if (v == null) return null;
  // Chatwoot sends epoch seconds for created_at on some events, ISO on others.
  if (typeof v === 'number') return new Date(v * 1000).toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
