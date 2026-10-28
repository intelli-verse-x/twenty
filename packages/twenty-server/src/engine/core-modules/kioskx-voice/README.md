# KioskX person calling

Default off. Only the literal `KIOSKX_VOICE_CALL=true` enables the API for workspace
`243e9c93-f7f9-47cc-ab7d-6a7dd6659774`. The header additionally requires the exact
browser hostname `kioskx.crm.intelli-verse-x.ai` and a saved, usable person phone.
No caller phone or destination is accepted from the browser.

Server and queue worker configuration (secrets stay outside this repository):

- `KIOSKX_VOICE_CALL`: default unset/off.
- `FONOSTER_MCP_URL`: defaults to the existing cluster service `http://fonoster-mcp:3030`.
- `FONOSTER_MCP_TOKEN`: existing KioskX Fonoster workspace credentials.
- `KIOSKX_VOICE_APP_REF`: explicitly select the existing company Voice Studio application.
- `KIOSKX_VOICE_FROM_NUMBER`: explicitly configure its existing provisioned caller number.

The transport reuses `fonoster_create_call` (`from`, `to`, `appRef`) and
`fonoster_get_call` (`ref`), as used by kiosk-x's voice connector. No new account,
operator handset, or alternate dialing link is involved. Missing configuration
returns a short record-level failure without a network call.

A Redis claim precedes the external create. The existing messaging worker polls
the returned call reference, independently of the browser, for up to 20 minutes.
Read and database retries never replay create-call. Note and person association
are saved in one transaction, with a stable server-generated note ID. An ended
call with nonblank transcript creates `KioskX call`; missing transcript or a
rejected/ambiguous create never creates a transcript note. No provider errors,
numbers, credentials, or transcript text are logged by this module.

An ambiguous or failed operation keeps the Call control disabled with a reason;
an administrator must reconcile the call in Voice Studio before releasing that
person's Redis operation. Do not clear a claim or replay a POST as a retry. A
successfully completed operation permits an explicit new call. Redis persistence
and the Twenty messaging worker are required. The application must set a suitable
call duration limit; timing out transcript collection does not hang up a call.

Deployment prerequisite found during read-only inspection: the current MCP
container's published Fonoster SDK proto lacks transcript fields. Voice Studio's
newer dashboard reader includes them. Until the selected MCP endpoint exposes
`transcript` in `fonoster_get_call`, this adapter correctly reports no transcript;
it cannot manufacture one. This PR does not patch Fonoster or replace the shared
live Twenty image. Keep the flag off until the deployment and transcript-capable
endpoint are deliberately prepared and tested separately.

Tests use a fake voice client and synthetic records. Never run a real dial as a
smoke test. No Enterprise checks, roles, or row-level predicates are changed.
