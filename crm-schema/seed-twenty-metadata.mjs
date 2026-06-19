#!/usr/bin/env node
/**
 * Seed the Intelli-Verse App-scoped CRM model into a Twenty workspace via the
 * Metadata GraphQL API. Creates custom objects, fields, SELECT options, and the
 * `app` relations that scope every record to an App-ID.
 *
 * Twenty exposes a metadata GraphQL endpoint at:  {BASE_URL}/metadata
 * and a data GraphQL/REST API at:                 {BASE_URL}/graphql  | /rest
 * Each custom object you create here immediately gets REST + GraphQL endpoints
 * and is reachable by the workspace's native MCP server (AI-agent ready).
 *
 * Usage:
 *   TWENTY_BASE_URL=https://crm.example.com \
 *   TWENTY_API_KEY=eyJ... \
 *   node crm-schema/seed-twenty-metadata.mjs
 *
 * Notes:
 * - Get the API key from Twenty > Settings > APIs & Webhooks (workspace scoped).
 * - The relation field payload shape can vary slightly between Twenty versions.
 *   This script targets the v2.x metadata API. If a mutation 400s on relations,
 *   check `createOneField` `relationCreationPayload` in your version's schema.
 * - Re-running is safe-ish: existing objects/fields throw "already exists" which
 *   we log and skip.
 */

const BASE_URL = process.env.TWENTY_BASE_URL?.replace(/\/$/, '');
const API_KEY = process.env.TWENTY_API_KEY;

if (!BASE_URL || !API_KEY) {
  console.error('Set TWENTY_BASE_URL and TWENTY_API_KEY env vars.');
  process.exit(1);
}

const META = `${BASE_URL}/metadata`;

async function gql(query, variables = {}) {
  const res = await fetch(META, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    const msg = json.errors.map((e) => e.message).join('; ');
    if (/already exists|duplicate/i.test(msg)) {
      console.log(`  ↩︎ skip (exists): ${msg}`);
      return null;
    }
    throw new Error(msg);
  }
  return json.data;
}

const sel = (opts) =>
  opts.map((o, i) => ({
    label: o.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    value: o.toUpperCase(),
    position: i,
    color: ['green', 'turquoise', 'sky', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'gray'][i % 10],
  }));

// ---------------------------------------------------------------------------
// Object definitions (singular/plural drive the auto-generated API endpoints)
// ---------------------------------------------------------------------------
const OBJECTS = [
  { ns: 'app', sn: 'App', pn: 'Apps', desc: 'App-ID boundary: a product / Fonoster application / OpenBSP org', icon: 'IconApps' },
  { ns: 'lead', sn: 'Lead', pn: 'Leads', desc: 'Prospect scoped to an App', icon: 'IconUserPlus' },
  { ns: 'channelIdentity', sn: 'Channel Identity', pn: 'Channel Identities', desc: 'Reachable address per channel for a lead', icon: 'IconAddressBook' },
  { ns: 'consent', sn: 'Consent', pn: 'Consents', desc: 'Opt-in / opt-out per channel (compliance)', icon: 'IconShieldCheck' },
  { ns: 'agent', sn: 'Agent', pn: 'Agents', desc: 'AI or human handler', icon: 'IconRobot' },
  { ns: 'campaign', sn: 'Campaign', pn: 'Campaigns', desc: 'Outreach campaign', icon: 'IconSpeakerphone' },
  { ns: 'conversation', sn: 'Conversation', pn: 'Conversations', desc: 'Thread / call on a channel', icon: 'IconMessage' },
  { ns: 'interaction', sn: 'Interaction', pn: 'Interactions', desc: 'Single message / call leg / email', icon: 'IconMessageDots' },
  { ns: 'channelEvent', sn: 'Channel Event', pn: 'Channel Events', desc: 'Raw inbound webhook event (audit + idempotency)', icon: 'IconWebhook' },
];

const CHANNELS = ['email', 'sms', 'voice', 'whatsapp', 'web'];
const PROVIDERS = ['telnyx', 'meta_whatsapp', 'ses', 'fonoster', 'notifuse', 'other'];
const DIRECTIONS = ['inbound', 'outbound'];

// Scalar / select fields per object (relations handled separately, see RELATIONS)
const FIELDS = {
  app: [
    ['appId', 'App ID', 'TEXT'],
    ['platform', 'Platform', 'SELECT', PROVIDERS],
    ['status', 'Status', 'SELECT', ['active', 'paused', 'archived']],
    ['channels', 'Channels', 'MULTI_SELECT', CHANNELS],
    ['description', 'Description', 'TEXT'],
  ],
  lead: [
    ['stage', 'Stage', 'SELECT', ['new', 'contacted', 'qualified', 'nurturing', 'converted', 'lost']],
    ['source', 'Source', 'SELECT', ['whatsapp', 'voice_inbound', 'voice_outbound', 'sms', 'email', 'web_form', 'import', 'referral', 'other']],
    ['score', 'Score', 'NUMBER'],
    ['companyName', 'Company Name', 'TEXT'],
    ['externalRef', 'External Ref', 'TEXT'],
    ['lastContactedAt', 'Last Contacted At', 'DATE_TIME'],
  ],
  channelIdentity: [
    ['channel', 'Channel', 'SELECT', CHANNELS],
    ['address', 'Address', 'TEXT'],
    ['provider', 'Provider', 'SELECT', PROVIDERS],
    ['isPrimary', 'Is Primary', 'BOOLEAN'],
    ['verified', 'Verified', 'BOOLEAN'],
  ],
  consent: [
    ['channel', 'Channel', 'SELECT', CHANNELS],
    ['status', 'Status', 'SELECT', ['opted_in', 'opted_out', 'pending']],
    ['basis', 'Basis', 'SELECT', ['explicit', 'implied', 'import']],
    ['source', 'Source', 'TEXT'],
    ['capturedAt', 'Captured At', 'DATE_TIME'],
  ],
  agent: [
    ['type', 'Type', 'SELECT', ['ai', 'human']],
    ['channels', 'Channels', 'MULTI_SELECT', CHANNELS],
    ['externalRef', 'External Ref', 'TEXT'],
  ],
  campaign: [
    ['channel', 'Channel', 'SELECT', CHANNELS],
    ['status', 'Status', 'SELECT', ['draft', 'scheduled', 'running', 'paused', 'completed']],
    ['templateRef', 'Template Ref', 'TEXT'],
    ['scheduledAt', 'Scheduled At', 'DATE_TIME'],
    ['metrics', 'Metrics', 'RAW_JSON'],
  ],
  conversation: [
    ['channel', 'Channel', 'SELECT', CHANNELS],
    ['direction', 'Direction', 'SELECT', DIRECTIONS],
    ['status', 'Status', 'SELECT', ['open', 'closed', 'snoozed']],
    ['externalRef', 'External Ref', 'TEXT'],
    ['lastMessageAt', 'Last Message At', 'DATE_TIME'],
    ['serviceWindowExpiresAt', 'Service Window Expires At', 'DATE_TIME'],
  ],
  interaction: [
    ['channel', 'Channel', 'SELECT', CHANNELS],
    ['direction', 'Direction', 'SELECT', DIRECTIONS],
    ['type', 'Type', 'SELECT', ['message', 'call', 'email', 'template', 'voicemail', 'note']],
    ['status', 'Status', 'SELECT', ['queued', 'sent', 'delivered', 'read', 'failed', 'answered', 'no_answer', 'received']],
    ['provider', 'Provider', 'SELECT', PROVIDERS],
    ['providerMessageId', 'Provider Message ID', 'TEXT'],
    ['body', 'Body', 'RICH_TEXT'],
    ['durationSeconds', 'Duration Seconds', 'NUMBER'],
    ['occurredAt', 'Occurred At', 'DATE_TIME'],
  ],
  channelEvent: [
    ['provider', 'Provider', 'SELECT', PROVIDERS],
    ['eventType', 'Event Type', 'TEXT'],
    ['externalId', 'External ID', 'TEXT'],
    ['payload', 'Payload', 'RAW_JSON'],
    ['processedAt', 'Processed At', 'DATE_TIME'],
  ],
};

// MANY_TO_ONE relations: [fromObject, toObject, fieldName]
// The `app` relation on every object is the App-ID scope.
const RELATIONS = [
  ['lead', 'app', 'app'],
  ['channelIdentity', 'app', 'app'],
  ['channelIdentity', 'lead', 'lead'],
  ['consent', 'app', 'app'],
  ['consent', 'lead', 'lead'],
  ['agent', 'app', 'app'],
  ['campaign', 'app', 'app'],
  ['conversation', 'app', 'app'],
  ['conversation', 'lead', 'lead'],
  ['conversation', 'agent', 'agent'],
  ['conversation', 'campaign', 'campaign'],
  ['interaction', 'app', 'app'],
  ['interaction', 'conversation', 'conversation'],
  ['interaction', 'lead', 'lead'],
  ['channelEvent', 'app', 'app'],
];

const idMap = {}; // ns -> objectMetadataId

async function createObjects() {
  console.log('\n▶ Creating objects…');
  for (const o of OBJECTS) {
    const data = await gql(
      `mutation ($input: CreateOneObjectInput!) {
         createOneObject(input: $input) { id nameSingular }
       }`,
      {
        input: {
          object: {
            nameSingular: o.ns,
            namePlural: o.pn.toLowerCase().replace(/\s+/g, ''),
            labelSingular: o.sn,
            labelPlural: o.pn,
            description: o.desc,
            icon: o.icon,
            isLabelSyncedWithName: false,
          },
        },
      },
    );
    if (data?.createOneObject?.id) {
      idMap[o.ns] = data.createOneObject.id;
      console.log(`  ✓ ${o.sn}`);
    }
  }
  // Backfill ids for objects that already existed
  const all = await gql(`query { objects(paging: { first: 200 }) { edges { node { id nameSingular } } } }`);
  for (const e of all?.objects?.edges ?? []) idMap[e.node.nameSingular] = e.node.id;
}

async function createFields() {
  console.log('\n▶ Creating scalar/select fields…');
  for (const [ns, fields] of Object.entries(FIELDS)) {
    const objectMetadataId = idMap[ns];
    if (!objectMetadataId) { console.log(`  ! missing object ${ns}`); continue; }
    for (const [name, label, type, opts] of fields) {
      const field = {
        name, label, type, objectMetadataId,
        ...(opts ? { options: sel(opts) } : {}),
      };
      await gql(
        `mutation ($input: CreateOneFieldMetadataInput!) {
           createOneField(input: $input) { id name }
         }`,
        { input: { field } },
      );
      console.log(`  ✓ ${ns}.${name}`);
    }
  }
}

async function createRelations() {
  console.log('\n▶ Creating relations (App-ID scope + links)…');
  for (const [from, to, fieldName] of RELATIONS) {
    const objectMetadataId = idMap[from];
    const targetObjectMetadataId = idMap[to];
    if (!objectMetadataId || !targetObjectMetadataId) { console.log(`  ! missing ${from}->${to}`); continue; }
    await gql(
      `mutation ($input: CreateOneFieldMetadataInput!) {
         createOneField(input: $input) { id name }
       }`,
      {
        input: {
          field: {
            name: fieldName,
            label: fieldName.replace(/\b\w/g, (c) => c.toUpperCase()),
            type: 'RELATION',
            objectMetadataId,
            relationCreationPayload: {
              type: 'MANY_TO_ONE',
              targetObjectMetadataId,
              targetFieldLabel: from.replace(/\b\w/g, (c) => c.toUpperCase()),
              targetFieldIcon: 'IconRelationManyToOne',
            },
          },
        },
      },
    );
    console.log(`  ✓ ${from}.${fieldName} → ${to}`);
  }
}

(async () => {
  console.log(`Seeding CRM metadata into ${BASE_URL}`);
  await createObjects();
  await createFields();
  await createRelations();
  console.log('\n✅ Done. Objects now have REST/GraphQL endpoints and are MCP-accessible.');
  console.log('   Per-App views: filter any object by its `App` relation.');
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
