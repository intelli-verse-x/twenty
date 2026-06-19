-- =============================================================================
-- Intelli-Verse CRM — canonical data model (App-ID scoped)
-- =============================================================================
-- Multi-channel lead capture / outreach CRM for the self-hosted stack:
--   Notifuse (email) · Fonoster (voice + AI voice agents) · OpenBSP (WhatsApp)
--   Telnyx (SMS + SIP trunk) · n8n (routing brain) · Twenty (system of record)
--
-- SCOPING PRINCIPLE
-- Every business record is scoped by `app_id` (the App-ID boundary). An "App"
-- maps 1:1 to a product / Fonoster application (appRef) / OpenBSP organization.
-- This gives per-App isolation for queries + RLS while keeping cross-App
-- analytics in a single database.
--
-- This file is the portable, canonical model. It is useful as:
--   (a) the source of truth for the Twenty metadata seed (seed-twenty-metadata.mjs)
--   (b) a standalone analytics / staging DB
--   (c) the alignment target for OpenBSP (organization) and Fonoster (appRef)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS crm;
SET search_path TO crm, public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE channel_type     AS ENUM ('email', 'sms', 'voice', 'whatsapp', 'web');
CREATE TYPE provider_type    AS ENUM ('telnyx', 'meta_whatsapp', 'ses', 'fonoster', 'notifuse', 'other');
CREATE TYPE direction_type   AS ENUM ('inbound', 'outbound');
CREATE TYPE app_status       AS ENUM ('active', 'paused', 'archived');
CREATE TYPE lead_stage       AS ENUM ('new', 'contacted', 'qualified', 'nurturing', 'converted', 'lost');
CREATE TYPE lead_source      AS ENUM ('whatsapp', 'voice_inbound', 'voice_outbound', 'sms', 'email', 'web_form', 'import', 'referral', 'other');
CREATE TYPE consent_status   AS ENUM ('opted_in', 'opted_out', 'pending');
CREATE TYPE consent_basis    AS ENUM ('explicit', 'implied', 'import');
CREATE TYPE conversation_status AS ENUM ('open', 'closed', 'snoozed');
CREATE TYPE interaction_type AS ENUM ('message', 'call', 'email', 'template', 'voicemail', 'note');
CREATE TYPE interaction_status AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'answered', 'no_answer', 'received');
CREATE TYPE campaign_status  AS ENUM ('draft', 'scheduled', 'running', 'paused', 'completed');
CREATE TYPE agent_type       AS ENUM ('ai', 'human');

-- ---------------------------------------------------------------------------
-- App: the App-ID boundary (tenant within the CRM)
-- ---------------------------------------------------------------------------
CREATE TABLE app (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id        text NOT NULL UNIQUE,          -- external key: Fonoster appRef / product id
    name          text NOT NULL,
    platform      provider_type NOT NULL DEFAULT 'other',
    channels      channel_type[] NOT NULL DEFAULT '{}',
    status        app_status NOT NULL DEFAULT 'active',
    description   text,
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Lead: a prospect, always scoped to an App
-- ---------------------------------------------------------------------------
CREATE TABLE lead (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id           uuid NOT NULL REFERENCES app(id) ON DELETE CASCADE,
    display_name     text,
    first_name       text,
    last_name        text,
    company_name     text,
    stage            lead_stage  NOT NULL DEFAULT 'new',
    source           lead_source NOT NULL DEFAULT 'other',
    score            integer     NOT NULL DEFAULT 0,
    owner_ref        text,                         -- workspace member / user id
    tags             text[]      NOT NULL DEFAULT '{}',
    external_ref     text,                         -- id in the source system
    last_contacted_at timestamptz,
    metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (app_id, external_ref)
);
CREATE INDEX idx_lead_app        ON lead(app_id);
CREATE INDEX idx_lead_app_stage  ON lead(app_id, stage);

-- ---------------------------------------------------------------------------
-- ChannelIdentity: a reachable address per channel for a lead
-- (mirrors OpenBSP contacts_addresses)
-- ---------------------------------------------------------------------------
CREATE TABLE channel_identity (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id      uuid NOT NULL REFERENCES app(id)  ON DELETE CASCADE,
    lead_id     uuid NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
    channel     channel_type  NOT NULL,
    address     text NOT NULL,                     -- E.164 phone or email
    provider    provider_type,
    is_primary  boolean NOT NULL DEFAULT false,
    verified    boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (app_id, channel, address)
);
CREATE INDEX idx_identity_lead ON channel_identity(lead_id);
CREATE INDEX idx_identity_addr ON channel_identity(app_id, channel, address);

-- ---------------------------------------------------------------------------
-- Consent: opt-in / opt-out per channel (10DLC, WhatsApp opt-in, email unsub)
-- ---------------------------------------------------------------------------
CREATE TABLE consent (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id       uuid NOT NULL REFERENCES app(id)  ON DELETE CASCADE,
    lead_id      uuid NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
    channel      channel_type   NOT NULL,
    status       consent_status NOT NULL DEFAULT 'pending',
    basis        consent_basis  NOT NULL DEFAULT 'explicit',
    source       text,
    proof_url    text,
    captured_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (app_id, lead_id, channel)
);
CREATE INDEX idx_consent_lead ON consent(lead_id);

-- ---------------------------------------------------------------------------
-- Agent: AI or human handler, scoped to App
-- ---------------------------------------------------------------------------
CREATE TABLE agent (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id        uuid NOT NULL REFERENCES app(id) ON DELETE CASCADE,
    name          text NOT NULL,
    type          agent_type NOT NULL DEFAULT 'ai',
    channels      channel_type[] NOT NULL DEFAULT '{}',
    external_ref  text,                            -- Fonoster autopilot assistant id / OpenBSP agent id
    member_ref    text,                            -- workspace member id (humans)
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_app ON agent(app_id);

-- ---------------------------------------------------------------------------
-- Campaign: outreach campaign, scoped to App
-- ---------------------------------------------------------------------------
CREATE TABLE campaign (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id        uuid NOT NULL REFERENCES app(id) ON DELETE CASCADE,
    name          text NOT NULL,
    channel       channel_type NOT NULL,
    status        campaign_status NOT NULL DEFAULT 'draft',
    template_ref  text,                            -- Notifuse template / WhatsApp template / autopilot assistant
    scheduled_at  timestamptz,
    metrics       jsonb NOT NULL DEFAULT '{}'::jsonb, -- sent/delivered/replied/converted
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaign_app ON campaign(app_id);

-- ---------------------------------------------------------------------------
-- Conversation: a thread / call on a channel
-- ---------------------------------------------------------------------------
CREATE TABLE conversation (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id          uuid NOT NULL REFERENCES app(id)   ON DELETE CASCADE,
    lead_id         uuid NOT NULL REFERENCES lead(id)  ON DELETE CASCADE,
    agent_id        uuid REFERENCES agent(id)          ON DELETE SET NULL,
    campaign_id     uuid REFERENCES campaign(id)       ON DELETE SET NULL,
    channel         channel_type        NOT NULL,
    direction       direction_type      NOT NULL,
    status          conversation_status NOT NULL DEFAULT 'open',
    external_ref    text,                            -- Fonoster call ref / OpenBSP conversation id
    started_at      timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz,
    -- WhatsApp 24h customer-service window expiry; null for other channels
    service_window_expires_at timestamptz,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (app_id, channel, external_ref)
);
CREATE INDEX idx_conv_app_lead ON conversation(app_id, lead_id);
CREATE INDEX idx_conv_status   ON conversation(app_id, status);

-- ---------------------------------------------------------------------------
-- Interaction: a single message / call leg / email
-- ---------------------------------------------------------------------------
CREATE TABLE interaction (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id              uuid NOT NULL REFERENCES app(id)          ON DELETE CASCADE,
    conversation_id     uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    lead_id             uuid NOT NULL REFERENCES lead(id)         ON DELETE CASCADE,
    channel             channel_type     NOT NULL,
    direction           direction_type   NOT NULL,
    type                interaction_type NOT NULL DEFAULT 'message',
    status              interaction_status NOT NULL DEFAULT 'queued',
    provider            provider_type,
    provider_message_id text,                        -- Telnyx sid / Meta wamid / SES id
    body                text,                         -- message body / call transcript
    duration_seconds    integer,                      -- voice calls
    cost                numeric(12,5),                -- per-message / per-minute cost
    occurred_at         timestamptz NOT NULL DEFAULT now(),
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (app_id, provider, provider_message_id)
);
CREATE INDEX idx_inter_conv ON interaction(conversation_id);
CREATE INDEX idx_inter_app  ON interaction(app_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- ChannelEvent: raw inbound webhook events from n8n (audit + idempotency)
-- ---------------------------------------------------------------------------
CREATE TABLE channel_event (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id        uuid REFERENCES app(id) ON DELETE CASCADE,
    provider      provider_type NOT NULL,
    event_type    text NOT NULL,
    external_id   text,                              -- idempotency key from provider
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    processed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, external_id)
);
CREATE INDEX idx_event_app ON channel_event(app_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_app_updated      BEFORE UPDATE ON app      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_lead_updated     BEFORE UPDATE ON lead     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_campaign_updated BEFORE UPDATE ON campaign FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Optional: row-level security to hard-isolate per App at the DB layer.
-- Set `SET app.current_app_id = '<uuid>'` per connection/request (e.g. from n8n).
-- ---------------------------------------------------------------------------
-- ALTER TABLE lead         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE conversation ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE interaction  ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY lead_app_isolation ON lead
--     USING (app_id = current_setting('app.current_app_id', true)::uuid);
-- (repeat per table)
