# Sales desk

The Twenty front shows Cleaning, Cars, Jobs, and Turo using the Kiosk inquiry
card layout. The public name is desk.intelli-verse-x.ai; this module adds no DNS,
ingress, deployment, or new sign-in. HiredDeskBoundary remains outermost. Its
hired:true branch is untouched. Signed-out visitors retain Twenty sign-in;
other sessions reach the sales allowlist before any queue reads.

## Defaults

| Environment variable    | Default | Meaning                                                                                                                                                       |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DESK_SALES_EMAILS`     | empty   | Comma-separated signed-in email allowlist, case-insensitive. Empty/unlisted shows only “This desk is for the sales team.”                                     |
| `DESK_SALES_FIXTURES`   | off     | Only the literal `true` enables obvious fixture inquiries; no live people are created.                                                                        |
| `DESK_SALES_EMAIL`      | off     | Existing SMTP transport pattern, owned by this module; buttons remain visible while unavailable. Leave off for this task.                                     |
| `DESK_SALES_VOICE`      | off     | Calling remains off; enabling requires an existing connected sales Voice source. The hired inquiry bridge is not a sales connection. Leave off for this task. |
| `DESK_TURO_REPORT_JSON` | unset   | Turo says “The fleet report is not connected.” No Discord reader.                                                                                             |
| `DESK_SALES_EMAIL_FROM` | unset   | Explicit approved sender required along with existing `EMAIL_SMTP_*` configuration for email availability.                                                    |

Channel flags are never enabled in tests or deployment configuration. A flag is
not proof that a channel is connected. There is no sales Voice connection in
this fork, so even an enabled flag reports unavailable, never a fabricated call.
The email path follows hired-mail's awaited SMTP acceptance, TLS, no retry queue,
server-selected recipient, durable operation claim, and unknown-outcome handling.
It does not call the hired module or change its mailbox configuration. Fixture
records intentionally have no deliverable email/phone destinations.

## Sources and persistence

Searched core modules and business modules for cleaning service requests, car
rental requests, truck-driver/delivery-helper/housekeeper applications. No source
reader or provenance mapping exists for those businesses. The hired reader
loads only linked KioskX contact/newsletter notes; arbitrary People records are
not evidence of a Cleaning, Cars, or Jobs inquiry. Consequently these three
queues use the permitted fixture fallback, default off, with an honest empty
sentence. Connecting real business sources needs a verified source/provenance
mapping; this module does not fabricate one.

Each queue has an independent GET under `/sales-desk/queues/:queue`. Failed reads
return 503 without provider details. The UI retains previously loaded rows and
gives each failed queue a retry and a sentence, including on its first read.

Active Cleaning/Cars saves require both next step and due time. Follow-ups and
Jobs hiring status persist as `Sales desk follow-up` notes in the verified
Twenty workspace, keyed deterministically by workspace, queue, and record ID.
Reads use that same workspace key, including after reload/restart. A save does
not remove the inquiry. Jobs supports new, reviewing, contacted; no deal value
or sales stage. Cars explicitly says the request does not reserve a car. Turo
is read-only and has no Call or sales controls.

Turo report schema (all values below are explicit fixtures, not live numbers):

```json
{
  "cars": [
    {
      "name": "Fixture Car",
      "idleGap": "Fixture 2 days",
      "hostEarn": "Fixture USD 100",
      "paidByTuro": "Fixture USD 80"
    }
  ]
}
```

Every route validates the Twenty bearer session. Hired identities receive an
empty 403 before payload parsing or any queue access. Unlisted identities get
`allowed:false` only at session discovery and empty 403s on record routes.
Requests cannot choose a workspace or email recipient. Responses are no-store.

## Verification

Run `SalesDesk.test.tsx`, `SalesDeskBoundary.test.tsx`,
`sales-desk.service.spec.ts`, and `sales-desk.controller.spec.ts` with Jest.
Controller tests exercise actual local Nest HTTP responses, including empty
403 bodies. Tests use only fixture data and in-memory repository doubles;
no outbound messages, live records, or calls. Frontend tests render the real
sales component and the existing hired boundary with lightweight UI primitives.
The local report records the executed runner and counts. No live rollout or
live-after claim is made by this local-only change.
