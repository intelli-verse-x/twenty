# Kioskx inbound desk preflight — blocked, not a working desk

This is the reproducible permission setup and live prerequisite probe for workspace
`243e9c93-f7f9-47cc-ab7d-6a7dd6659774` (`kioskx`) on the existing Twenty v2.18.5 image.
It does **not** install a replacement website, service, hostname, image or ingress.
It does not alter the Apple workspace or `TWENTY_API_KEY`.

## Observed blockers

On 28 October 2026, the supported `upsertRowLevelPermissionPredicates` mutation
returned `FORBIDDEN: Row level permission predicate feature is disabled`. This
server requires a valid Enterprise plan for that API. No Enterprise key or
validity token was configured. Field and object restriction mutations work.
A view filter is not sufficient: the hired person could remove it or query the
People API. The setup therefore grants **no People read access**.

The stock frontend's `useSettingsNavigationItems` and `SettingsRoutes` always
expose personal Profile and Experience. Tool flags can block Accounts and
workspace settings, but metadata alone cannot meet the literal requirement
that the hired person cannot open Settings. The job prohibits replacing images.
No frontend or server patch has been applied to running containers.

There are four non-deleted People with `jobTitle = KioskX contact form` and zero
connected accounts in this workspace. The linked notes exist, but no inquiry
projection or live desk has been shipped. No contact buttons, mailto/tel fallback,
sample lead, support identity or customer contact details have been added.
Google Voice calling and support-mailbox sending have not been implemented or
claimed to work. A future channel integration must default its workspace
`emailEnabled` and `callEnabled` settings to off and verify the connection before
exposing an action; changing a setting alone must never advertise a fake action.
These settings are requirements, **not implemented toggles**.

## Run

Requires Python 3, `kubectl` access to the existing `aicart/twenty-server`, and the
container's installed Node, pg, bcrypt, jsonwebtoken and ioredis modules.

```sh
node --test scripts/kioskx-inbound/policy.test.cjs
python3 scripts/kioskx-inbound/run.py
```

The launcher creates a mode-0600 credential file at
`/Users/macairm3/astra-work/twenty-kioskx-inbound-LOGIN.txt`, or reuses that file.
It never prints its contents. Keep it for reruns; deleting it does not authorize
creating a second hired identity. The existing role's assignee check prevents that.
Tokens are generated and used only inside the existing server process launched
by `kubectl exec`; no API key is exported, changed or printed. Credentials travel
over stdin, not arguments. No container files are installed.

The setup uses the existing metadata API to create/reset `KioskX Inbound Desk`,
deny all non-system object reads and writes, remove all tool/settings flags, and
explicitly restrict `emails`, `phones`, and `searchVector`. It probes the RLS API
without bypassing its entitlement check. It reserves one disabled, non-admin
member in a transaction, with no invitation email. Only the named Kioskx role
may be reused; an unrelated existing user or assignee stops the operation.

The live tests briefly enable that closed-role identity to make seven
hired-principal API queries, then disable it in `finally`. No customer email,
call or other external side effect is attempted. Cache invalidation is limited
to the named workspace's membership/role entries and the reserved user's status.
The `disabled` database flag is not a substitute for authorization; the inspected
authentication code does not enforce it as a sign-in barrier. The verified closed
role is the record-access boundary. Do not hand over credentials as a usable desk.

Exit **2** means the closed-role checks completed but **the desk is not ready**;
exit 1 is an unexpected setup/test failure. The script never enables People
read access or leaves the hired account enabled, even if RLS becomes available.
This is a prerequisite probe, not an automatic go-live switch.

## Verification limits and next work

Local tests cover field restrictions, standard object denials, flag denials,
missing private-field failure, and accidental permission widening. Live checks
verify the persisted role and field restrictions, and real denied GraphQL
requests with no contact URIs. They do not prove a working lead payload or desk:
all record responses are denied. No baseline suite failure is claimed.

To deliver the requested product: provide a valid Enterprise entitlement (or
agree on another supported server-side isolation mechanism), resolve how the
existing image can prevent personal Settings navigation, implement and test the
inquiry display from the linked source notes, then add identity-hiding contact
actions only when their providers are connected. Re-test direct APIs, browser
network responses, desktop and phone sign-in before enabling the reserved user.
Do not call the current state complete or hand it to the hire as a usable desk.
