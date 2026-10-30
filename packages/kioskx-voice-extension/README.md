# Google Voice inquiry calls

Connect verifies the office Google Voice account in the installed Chrome
extension, then pairs its RSA-OAEP public key with the hired desk. Call sends only
an inquiry ID and request ID. The server stores a durable claim and queues the
encrypted destination for that browser. The extension claims once, rechecks the
account, decrypts in its service worker, and opens a background Voice call link.
The inquiry stays selected. No Fonoster or IntelliVerse bot is invoked.

A queued request or opened Voice link is **not** proof that either phone rang,
that a conversation completed, or that a transcript exists. Ambiguous handoffs
are never automatically retried. No real call is part of deployment verification.

## Setup and controls

On the inquiry choose Connect Google Voice, download and unzip the extension,
then use Chrome Extensions → Developer mode → Load unpacked. Existing users
replace the unpacked files and Reload the extension, then reload the inquiry.
Connect opens the office account (`/u/0`) settings. The probe selects Account
when settings remembered Calls, and checks only the Google Voice number, never
a linked forwarding number. Missing or wrong account fails closed.

In Calls settings, select the linked phone for outgoing calls. Incoming call
forwarding alone does not establish this. Keep the office browser available.
Chrome installation and Google authentication require the office user's actions;
the webpage cannot complete them silently.

- `KIOSKX_HIRED_VOICE`: default **on when an office number exists**; literal
  `false` disables pairing and calls without a deploy.
- `KIOSKX_GOOGLE_VOICE_NUMBER`: configured office caller ID; never rendered on
  the hired desk. Only its digit-normalized SHA-256 hash reaches the extension.
- `KIOSKX_VOICE_CALL=false` stays false. There is no bot fallback.
- A paired session expires after 15 seconds; queued calls expire after 20.
- Missing extension: install help. Missing Google session: Connect. Another
  browser paired: close that desk first. Explicitly disabled: unavailable.

The office browser is trusted. The background call page is visually hidden and
clears its destination query after loading, but this is not a security boundary
against browser developer tools, history, or opening the signed-in Voice account.

## Build on the live base without breaking welcome

r5 restored setup only. Its server still gated Call on the disabled legacy bot
adapter and had no voice-config/voice-bridge routes. The absent config route
returned SPA HTML, so an installed extension could not pair.

r4 renamed the entry bundle while a surviving chunk still imported the old URL.
That initialized the application twice and registered selection IDs twice. Do
not rename only one entry or replace this live front with the older source build.

`tools/build-overlay.cjs INPUT OUTPUT` patches the pinned r5 image (arm64,
`kioskx-gv-connect-restore-20261030-r5`, digest
`sha256:d7aec09da811b03d6ea56ae6488a7defbfeef0bca240982dd883be3259e271b4`).
INPUT contains `hired-desk.service.js`, `hired-desk.controller.js`,
`hired-policy.js`, `index.html`, and `index-email-call-0862f92d1c3b.js` as `entry.js`.
Use `TYPESCRIPT_PATH` or a resolvable `typescript` package. The overlay:

- installs browser bridge methods and authenticated routes;
- preserves live email, inquiry notes, activity, and masking;
- patches the call response at its **existing entry URL**;
- includes exactly one Connect script plus the extension ZIP.

The existing entry URL is served with `max-age=0`, so reload revalidates it.
Append OUTPUT as a tar layer to the pinned image; deploy the resulting permanent
image to both CRM containers. Never copy files into running pods. Keep the
previous image until `/welcome` verification passes.

`tools/build-connect-overlay.cjs` is the prior setup-only recovery builder. It
does not enable calling and is not the bridge release builder.

## Verification

Run `OVERLAY_SERVER=<output server directory> node --test tools/bridge.test.cjs`.
Run `OVERLAY_SERVER=<output server directory> node tools/verify-connect.cjs`
with Playwright available. Optional `OVERLAY_FRONT=<output front directory>`
previews only the changed assets against the real `/welcome` module graph;
omit it for live-after. `EVIDENCE_SCREENSHOT` saves a synthetic screenshot outside
the repository.

The browser check intercepts **all** hired endpoints, uses isolated fake
repositories with the compiled bridge implementation, and runs the actual
extension content script with a fake Chrome transport. It verifies installation,
Connect, connected state, encrypted handoff, no typed destination, retained
inquiry, disconnection, explicit disable, and no welcome error. The separate
extension tests exercise account probing and one-time background link creation.
These tests do not establish real phone ringing or a real Google conversation.

## Transcripts

Consumer Voice does not supply outbound conversation transcripts here. Nothing
fabricates text or treats a microphone recording as both sides of a phone call.
An admin can import a real transcript and its Google Voice/Drive source reference
via `/kioskx-hired-desk/voice-transcript`. `KIOSKX_VOICE_TRANSCRIPT_ADMIN_IDS` is
empty by default; only explicitly allowlisted admin IDs may import. The hired
account is always denied. Import attaches an idempotent admin note to the original
inquiry; it is not automatic Google Voice transcription.
