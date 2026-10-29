# Hired inquiry desk

Only the verified KioskX support identity is captured. Other sessions retain full Twenty. Inquiries are limited to people linked to `KioskX contact form` or `KioskX newsletter` notes. Contact values remain server-side. The UI receives redacted names, company, inquiry, masked Email/Phone rows and redacted sent-message history.

## Email

Default off. Enable `KIOSKX_HIRED_EMAIL=true` with `KIOSKX_HIRED_EMAIL_FROM` set to the approved KioskX workspace mailbox, plus existing `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT` (default 587), and SMTP credentials where required. TLS is required. Do not configure a personal sender. No sender or SMTP credential reaches the browser.

`POST /kioskx-hired-desk/email` accepts only `{ leadId, requestId, body }`. A linked durable note claims the operation before SMTP. The service awaits acceptance, then titles the note `KioskX hired email`. Failures after claiming retain the pending note and body for admin reconciliation. Never automatically replay an ambiguous delivery. The desk keeps the sent body on the card and reloads saved sent notes; it does not imply inbound email synchronization. Missing configuration returns unavailable with no send attempt.

## Google Voice: currently unavailable

`KIOSKX_HIRED_VOICE=true` and a nonempty `KIOSKX_GOOGLE_VOICE_NUMBER` are necessary, but are **not sufficient** to place a call. No verified Google Voice call-control/recording adapter is installed. This repository has no Google Voice authentication or supported dialing endpoint. Forwarding a line to a phone does not provide a server API to bridge that phone to a lead. Call therefore remains visibly disabled even if only the two variables are added. Do not call this working voice or deploy an adapter placeholder as a transport.

The existing injection hook is `HIRED_GOOGLE_VOICE` / `HiredGoogleVoice.conversation({ destination, operationId })`. A real adapter must authenticate to the provisioned Google Voice service, verify the configured line and forwarding, dial once using the durable operation ID, and return real nonempty transcript text only after the conversation ends. The service saves it under `KioskX hired call` linked to the person before reporting completion. Provider errors and transcripts are never returned to the hired user. An empty transcript retains the claim for reconciliation, with no success assertion.

There is **no inbound webhook route** because no Google Voice recording/transcript webhook capability has been verified. Do not send unauthenticated text to an invented hook. If an actual adapter supplies authenticated recordings/transcripts, its integration must verify signatures, deduplicate provider event IDs, resolve the person server-side and save a linked `KioskX hired inbound` note only for real nonempty text. No inbound note is currently generated. No Fonoster, Telnyx or `KIOSKX_VOICE_*` transport is used.

## Release

Apply this directory and the frontend desk overlay onto official `twenty/v2.18.5`; never build the thin fork as the release. Preserve `FRONT_AUTO_BASE_URL=true`. Deploy the resulting arm64 image to both server and worker through the approved GitHub Actions pipeline. Do not apply the stale deployment manifest. Verify both CRM health endpoints and authenticated hired/admin browser paths after rollout. Tests use fake transports; never send customer email or dial customers for validation.
