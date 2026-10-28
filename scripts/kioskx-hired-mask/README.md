# KioskX hired contact mask

Scope: existing workspace `243e9c93-f7f9-47cc-ab7d-6a7dd6659774` and existing
`KioskX Inbound Desk` role `15d0420a-c8aa-49a8-8ab1-1acd4eda31e7` only.
No user creation, password changes, Apple workspace changes, deployments, or merges.

## Permission barrier

`python3 scripts/kioskx-hired-mask/run.py` runs a deny-only metadata migration and
read-only audit inside the existing server. Credentials stay inside that server;
only allowlisted status messages leave it. It denies People `emails`, `phones`,
`searchVector` (and legacy `phone` if present), and denies configurable raw objects
and existing custom projections. It **never grants People read or any new read**.
It preserves other roles and asserts the People object permission is unchanged.

Twenty rejects object and field permission mutations on system objects. Its ORM
also returns early for system objects. Consequently the branch includes two
narrow server changes: deny these objects in the permission cache, and reject the
same workspace/user-role at the ORM boundary before that early return. Notes are
hidden as a whole; no Enterprise/row-level permission API or license check changes.

The audit exits **2** if data is still readable through the unchanged live image.
On 28 October the live role could still query timeline activities and workflow
runs. Field denials alone do not close those system-object routes. Do not interpret
an applied field permission as full live acceptance. Do not grant live People
read while the host still runs the shared image. Nothing in this directory ships
an image or changes an ingress/deployment.

## Contact and replies

`kioskxDeskContact(personId)` is a dedicated read-only GraphQL object for the desk.
It exposes booleans and redacted inquiry/reply text only. It reads real linked
contact-form notes and inbound message bodies on the server; no fabricated copy,
participant headers, attachments, raw rich-text JSON, or call notes are returned.
Admin/Member receive null from this desk-specific query and keep their normal UI.
The UI uses no-cache queries and polls for replies every 30 seconds, with the latest
50 replies/inquiries. Long contact-like number sequences are conservatively removed.

`kioskxDeskAction(input)` accepts a person ID, request UUID, action and email content.
It resolves the destination on the server and returns only `{ ok, status }`.
The default shared sender is the existing active `support@kiosk-x.ai` connected
account; `KIOSKX_HIRED_EMAIL_ACCOUNT_ID` optionally selects another existing account
in this same workspace. Missing/disconnected sender shows an unavailable state.
No existing Send Email behavior or permissions are changed for other roles.

A durable, unique Note claim is inserted **before** external effects. Reusing a
request UUID never sends/dials again, even after an ambiguous failure or restart.
Claim Notes contain status only and are denied to the desk. Ambiguous delivery
asks an admin to check; the UI does not automatically retry a mutation.

`KIOSKX_VOICE_CALL` defaults off. `true` also requires a
`KIOSKX_HIRED_CALL_TRANSPORT` provider implementing `KioskxHiredCallTransport.start`.
The separate `feat/kioskx-person-call` owner supplies that adapter and owns the
Voice Studio client and `KioskX call` transcript storage. There is no second voice
client or dependency on that worktree here. Without the adapter, Call remains
visibly unavailable even if the toggle is true. A missing phone/email removes its
chip. No calls, emails, transcripts or contact data are sent to Discord here.

## Focused tests

Use an isolated dependency directory; do not change this repository's lockfile:

```sh
mkdir -p /tmp/kioskx-mask-test
npm install --prefix /tmp/kioskx-mask-test --no-audit --no-fund \
  typescript@5.9 react@19 react-dom@19 @apollo/client@4 \
  @nestjs/common@11 @nestjs/graphql@13 @nestjs/typeorm@11 \
  class-validator typeorm graphql rxjs reflect-metadata html-to-text@9 \
  @types/react@19 @types/react-dom@19 @types/node@24 @types/html-to-text@9 esbuild
MASK_TEST_DEPS=/tmp/kioskx-mask-test node --test scripts/kioskx-hired-mask/test.cjs
MASK_TEST_DEPS=/tmp/kioskx-mask-test python3 scripts/kioskx-hired-mask/browser.py
```

The browser check requires Python Playwright and Chrome. It uses a locally fulfilled
HTTPS origin and fake Apollo responses/transports, never the live CRM. Generated
bundles and screenshots stay in `MASK_TEST_DEPS`, outside the repository.

The Node tests execute the actual service, redactor, React component, permission
calculator and ORM guard. Infrastructure repositories/decorators are isolated
fakes; these are **not** a full Nest/DB integration suite. All transport tests are
fake. `MASK_TEST_BASELINE=1` reads the two original permission files from
`815d4dc5` without changing the worktree: the two new system-object regression tests
must fail there. Native workspace typechecks/integration suites also need a full
Twenty dependency install and test databases.

Release acceptance remains separate: build and validate the actual server/front,
connect the existing voice adapter, verify authenticated hired/Admin GraphQL and
REST plus the real People page on a test image, and only then separately authorize
a live image swap and People read. This job authorizes none of those live grants
or deployment steps.
