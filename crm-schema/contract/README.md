# Channel Contract — unified envelope + international edge cases

One normalized envelope every system emits (via n8n) and that maps deterministically into the App-ID-scoped CRM (`../schema.sql`). Works for any app (quizverse, toba, intelliverse…) with different audiences, across **Tier 1/2/3** countries.

## CanonicalEvent (the contract)
```jsonc
{
  "schemaVersion": "1.0",
  "eventId": "evt_...",            // idempotency key (unique per provider event)
  "appId": "quizverse",            // REQUIRED — the App-ID scope (Fonoster appRef / OpenBSP org / product)
  "source": "telnyx",              // notifuse | fonoster | openbsp | telnyx
  "channel": "sms",                // email | sms | voice | whatsapp | web
  "direction": "outbound",         // inbound | outbound
  "type": "message",               // message | call | email | template | voicemail | note | status
  "occurredAt": "2026-06-18T16:00:00Z",
  "party": {
    "address": "+14155550123",     // E.164 phone or email
    "addressType": "phone",        // phone | email
    "displayName": "Jane",
    "country": "US",               // ISO-3166 α2 (derived from phone if omitted)
    "locale": "en-US",             // i18n / RTL / template language
    "timezone": "America/New_York",// REQUIRED to enforce quiet hours
    "externalRef": "crm-123",
    "verified": true
  },
  "delivery": {
    "provider": "telnyx",          // telnyx | meta_whatsapp | ses | fonoster | notifuse | other
    "providerMessageId": "SM...",
    "status": "delivered",
    "cost": { "amount": 0.0045, "currency": "USD" },
    "durationSeconds": 42,         // voice
    "registrationStatus": "10dlc", // SMS: 10dlc | toll_free | dlt | alpha
    "senderIdType": "long_code",   // long_code | toll_free | short_code | alphanumeric
    "waCategory": "marketing"      // WhatsApp: marketing | utility | authentication | service
  },
  "consent": { "status": "opted_in", "basis": "explicit", "capturedAt": "..." },
  "conversation": { "externalRef": "...", "serviceWindowExpiresAt": "..." },
  "content": { "body": "..." }
}
```

Three pure functions enforce it: `validateEvent` (structure), `mapToCrm` (→ App-scoped rows), `evaluateOutbound` (compliance gate → `ALLOW | DEFER | BLOCK`).

## Why this works for every app
`appId` is mandatory and flows into **every** CRM row, so quizverse / toba / intelliverse share one engine and DB while staying isolated. Different audiences = different `party.country` / `locale` / `timezone`, handled by data, not code branches.

## International edge cases handled (Firecrawl-verified, 2026)

| Edge case | Rule in `evaluateOutbound` |
|---|---|
| **US/CA SMS** need 10DLC or toll-free registration | BLOCK if `registrationStatus` not in `[10dlc, toll_free]` |
| **India SMS** needs TRAI **DLT** registration + approved template | BLOCK if not `dlt` |
| **Nigeria / Indonesia / UAE / Australia** require **alphanumeric sender ID registration** | BLOCK if alpha used where unsupported; require registration |
| **US rejects alphanumeric** sender IDs | BLOCK alpha → US |
| **WhatsApp 24h service window** | free-form BLOCKED outside window → must use approved **template** |
| **WhatsApp marketing** needs opt-in | BLOCK marketing without `opted_in` |
| **Consent laws** (TCPA, GDPR, LGPD, DPDP, CASL, PECR, NDPA…) | BLOCK marketing without opt-in; BLOCK email to `opted_out` |
| **Quiet hours** per country, recipient-local | DEFER (reschedule) if within local quiet window |
| **Tier-3 voice gaps** (ID/NG/AE no two-way local) | DEFER with reason → use intl origination / verify reachability |
| **Unknown / unsupported country** | BLOCK (`UNSUPPORTED_COUNTRY`) |
| **Malformed phone** (not E.164) | BLOCK (`INVALID_ADDRESS`) + validation error |
| **Currency per country** | `interaction.cost_currency` defaults from country (USD/INR/BRL/NGN…) |
| **Duplicate provider events** | idempotency via `eventId` → `channel_event.external_id` unique |

`DEFER` = retry later (quiet hours / coverage); `BLOCK` = do not send (compliance/validity); `ALLOW` = send.

## Country table (`COUNTRIES` in `contract.mjs`)
Tier 1: US, CA, GB, DE, AU · Tier 2: BR, IN, AE · Tier 3: ID, NG.
Each row: dial code, currency, required SMS registration, alphanumeric support, consent law, quiet hours, two-way voice coverage. **Extend this table** to add countries — no code changes needed.

## Test
```bash
node crm-schema/contract/contract.test.mjs
# RESULT: 65 passed, 0 failed
```
Covers country derivation, validation, App-scoping, per-country SMS registration, consent gating, the WhatsApp 24h window, Tier-3 voice deferral, quiet hours, multi-app/multi-channel smoke, and idempotency.

## How each system plugs in (via n8n)
- **Notifuse** → email events → `source:notifuse, channel:email, provider:ses`
- **Fonoster** → call events → `source:fonoster, channel:voice` (`durationSeconds`, transcript in `content.body`)
- **OpenBSP** → WhatsApp → `source:openbsp, channel:whatsapp, provider:meta_whatsapp` (sets/reads `serviceWindowExpiresAt`)
- **Telnyx** → SMS → `source:telnyx, channel:sms` (`registrationStatus`, `senderIdType`)

n8n resolves the inbound number/sender/WABA/appRef → `appId`, wraps the provider payload into a CanonicalEvent, calls `validateEvent`; for outbound it calls `evaluateOutbound` before dispatch and writes the result + rows into the CRM.
