# Intelli-Verse CRM Schema (App-ID scoped)

App-scoped, multi-channel lead-capture / outreach data model for the self-hosted stack, layered on top of **Twenty** (the AI-native open-source CRM).

```
Notifuse (email)  Fonoster (voice + AI voice)  OpenBSP (WhatsApp + AI chat)  Telnyx (SMS + SIP)
                                   │
                                 n8n  ── normalize / route / idempotency
                                   │
                              Twenty CRM  ── system of record (this schema)
```

## Why Twenty
- AI-native: every workspace ships a **native MCP server** + has a **Claude Code skill**, so AI agents can read/write the CRM in natural language.
- Custom objects are **metadata-driven** and instantly get **REST + GraphQL** endpoints.
- Modern, self-hostable (Postgres + Redis), great fit with n8n.

## The App-ID scoping principle
Every business record is scoped by an **App** — a first-class object that maps 1:1 to:
- a Fonoster **application** (`appRef`),
- an OpenBSP **organization**,
- a Notifuse **workspace / product**.

Each `Lead`, `Conversation`, `Interaction`, `Campaign`, `Consent`, `ChannelIdentity`, `Agent`, and `ChannelEvent` carries a required relation to `App`. This gives **per-App isolation** for queries, views, and (optionally) DB row-level security, while keeping **cross-App analytics** in one place.

### Two scoping strategies
| Strategy | How | When to use |
|---|---|---|
| **App-as-object** (default here) | one workspace; every record relates to `App`; per-App Twenty Views filter by App | shared ops, cross-app reporting, lighter |
| **Workspace-per-App** (Twenty native) | one Twenty workspace per App (separate Postgres schema) | hard tenant isolation, separate billing/access |

Start with App-as-object; promote a high-value App to its own workspace later if you need hard isolation.

## Objects
| Object | Purpose | Key fields |
|---|---|---|
| **App** | App-ID boundary | `appId` (unique), platform, channels, status |
| **Lead** | prospect (scoped) | stage, source, score, externalRef, → App |
| **ChannelIdentity** | reachable address per channel | channel, address (E.164/email), verified, → App/Lead |
| **Consent** | opt-in/out per channel (10DLC, WhatsApp, email) | channel, status, basis, → App/Lead |
| **Conversation** | thread/call on a channel | channel, direction, status, externalRef, `serviceWindowExpiresAt` (WhatsApp 24h), → App/Lead/Agent/Campaign |
| **Interaction** | one message/call leg/email | type, status, provider, providerMessageId, cost, duration, → App/Conversation/Lead |
| **Campaign** | outreach | channel, status, templateRef, metrics, → App |
| **Agent** | AI/human handler | type, channels, externalRef, → App |
| **ChannelEvent** | raw inbound webhook (audit + idempotency) | provider, eventType, externalId (unique), payload, → App |

## Files
- **`schema.sql`** — canonical Postgres model (source of truth; also usable as a standalone analytics/staging DB and as the OpenBSP/Fonoster alignment target). Includes optional RLS for hard per-App isolation.
- **`seed-twenty-metadata.mjs`** — creates the model inside a Twenty workspace via the Metadata GraphQL API (objects + fields + App relations). Auto-exposes REST/GraphQL + MCP.

## Apply

### Into Twenty (recommended)
```bash
TWENTY_BASE_URL=https://crm.example.com \
TWENTY_API_KEY=<workspace api key> \
node crm-schema/seed-twenty-metadata.mjs
```
Get the API key from **Twenty → Settings → APIs & Webhooks**.

### As a standalone Postgres DB
```bash
psql "$DATABASE_URL" -f crm-schema/schema.sql
```

## Stack integration (via n8n)
| Source event | Maps to |
|---|---|
| OpenBSP `messages` insert (WhatsApp) | upsert `Lead` + `ChannelIdentity(whatsapp)`, append `Interaction`, set `Conversation.serviceWindowExpiresAt = now()+24h` |
| Fonoster call (`createCall` / inbound) | `Conversation(channel=voice)`, `Interaction(type=call, duration, cost)`; `externalRef` = call ref; `agent.externalRef` = autopilot assistant |
| Telnyx SMS webhook | `Interaction(channel=sms, provider=telnyx)`, status callbacks update delivery |
| Notifuse email events | `Campaign` + `Interaction(channel=email, provider=ses/notifuse)` |
| Any provider | write `ChannelEvent` first (idempotency via unique `(provider, external_id)`), then process |

**App resolution:** n8n maps the inbound number/sender/WABA/appRef → an `App.appId`, then scopes all writes to that App.

## Compliance hooks
- Check `Consent(status=opted_in)` for the channel before any **outbound** message.
- Respect `Conversation.serviceWindowExpiresAt` for WhatsApp (outside the 24h window → template message only).
- 10DLC/A2P registration is required for SMS regardless of provider.
