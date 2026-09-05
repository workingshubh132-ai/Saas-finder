# Autonomous Operations Phase A — Real-World Capstone Attempt

Mirrors M10's own honest-block discipline (`docs/M10_REAL_WORLD_AUDIT.md`,
`docs/M10_REAL_WORLD_BOUNDARY.md`): attempt the real thing, report exactly
what happened, never substitute a fixture result for a real one.

## What this capstone actually checked

Phase A's one new real-world capability is `outboundMessageService.send()` —
the governed path that would turn an already human-approved `OutreachMessage`
into a real, transmitted message. M10 (`scripts/m10-customer-discovery.ts`)
left exactly one such message sitting at `APPROVED_TO_CONTACT`, human-approved,
in the real (non-test) database — stopped there deliberately because no send
capability existed yet. That message is this capstone's real subject.

**1. Confirmed the message is still exactly where M10 left it** (read-only
query against `prisma/dev.db`, the real application database, not the test
database):

```json
{
  "id": "cmtnyrlv4001jy9ug7efwto0g",
  "status": "APPROVED_TO_CONTACT",
  "approvalRequestId": "cmtnyrlvo001qy9ughh2xkimx",
  "prospectId": "cmtnyrltl0012y9ugl6t9pord",
  "contentPreview": "[DEV FIXTURE] Hi — we're researching how [dev fixture] small business teams refe..."
}
```

Zero `OutreachMessageDelivery` rows exist anywhere in `dev.db`. This is the
real "weekend disappearance" scenario (brief item 35) in miniature: a real,
human-approved action has been waiting, untouched, since M10 ran — because
until this phase, nothing was watching for it.

**2. Checked the environment for a real outbound-message provider** (the
same discipline as `docs/M10_REAL_WORLD_AUDIT.md`'s own provider-credential
check, item 219): no `SENDGRID_*`, `TWILIO_*`, `SMTP_*`, `MAILGUN_*`,
`POSTMARK_*`, `SES_*`, `WEBHOOK_URL`, `SLACK_*`, or comparable credential
exists anywhere in this environment's configuration. A direct reachability
check against a real provider endpoint (`api.sendgrid.com`) timed out —
this container has no outbound network path to any real messaging API,
identical in kind to M10's own finding for a real search/model provider.
`createOutboundMessageProvider()` (`src/providers/outbound-message-provider-factory.ts`)
accordingly returns only `DevOutboundMessageProvider` — the one provider
that exists in this codebase.

## Result: BLOCKED — PROVIDER NOT CONFIGURED

**This capstone deliberately did not call `outboundMessageService.send()`
against the real M10 message.** Doing so would have "succeeded" — the
DEV_FIXTURE provider always returns `SENT` — but that would mark a real,
human-approved customer-facing record as sent when nothing real was
transmitted (`DevOutboundMessageProvider`'s own `detail` string says as
much: "No real message was transmitted — this container has no reachable
outbound provider"). Reporting that as a working send would be exactly the
faked success the brief's own item 27 forbids. The honest fact is narrower
and more useful: the governed send path is fully built, fully tested end to
end against DEV_FIXTURE (`tests/integration/autonomous-operations.test.ts`),
and is the correct integration point for a real provider — but no real
provider can be configured or reached from this environment, so the one
real customer-facing action this phase adds cannot be exercised for real
here.

## What is proven versus what remains blocked

| Claim | Status | Evidence |
|---|---|---|
| The full auto-chain (approve → applyDecision → send) works correctly against a real, persisted message | **Proven** | `tests/integration/autonomous-operations.test.ts`, "OUTREACH_MESSAGE" scenario — a message built exactly like M10's own, approved, auto-sent, auto-marked CONTACTED |
| Governance (staleness, Emergency Stop, Company Budget, bounded retry, rate limit) all correctly block a send | **Proven** | Same test file, "outboundMessageService.send() governance" scenarios (6 tests) |
| A real message reaches a real human being | **Blocked — provider not configured** | No credential, no reachable endpoint, from this environment |
| The real M10 message is left exactly as it was | **Confirmed** | Read-only query above; this capstone made no writes to `dev.db` |

## What would need to change for this to run for real

Exactly what M10 already named for the model/search side: a deployment
environment with actual outbound network access and a real provider
credential (e.g. a real email or SMS API key), wired to a new
`OutboundMessageProvider` implementation registered in
`outbound-message-provider-factory.ts` alongside `DevOutboundMessageProvider`
— no other code in `outboundMessageService` or `autonomousOperationsService`
would need to change; the provider seam (`src/domain/ports/outbound-message-provider.ts`)
was built exactly so that swap is the only thing a real deployment needs.
