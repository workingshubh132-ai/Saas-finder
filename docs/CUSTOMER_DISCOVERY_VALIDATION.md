# Customer Discovery + Validation layer

Turns real problem evidence into a deterministic, evidence-backed
opportunity-validation decision — reusing almost everything M5 already
built (ICP, Prospect, OutreachExperiment, Message, CustomerResponse,
CustomerEvidence, signal-type routing, independence classification, CEO
and Chairman customer-discovery integration) rather than duplicating it.

## What already existed (M5), and what this adds

Before writing any code, the existing M5 implementation was mapped in
full. It already had: prospect discovery/qualification, a human-gated
outreach-experiment/message pipeline reusing `outboundMessageService`
unchanged, `CustomerResponse` + `CustomerEvidence` with a safety-critical
signal-type routing table (`CUSTOMER_SIGNAL_ELIGIBLE_CLAIM_TYPES` —
INTEREST can never validate a WILLINGNESS_TO_PAY claim), independence
classification (`classifyIndependence`, KNOWN/LIKELY/UNKNOWN), and CEO
(`recommendCustomerDiscoveryAction`) / Chairman integration that already
flags concentrated-organization corroboration.

Four things were genuinely missing, and are all this layer adds:

1. **A way to record a real interaction not tied to a message
   VentureForge itself sent.** `CustomerResponse.outreachMessageId` is a
   required foreign key — an interview, a phone call, or a reply to a
   message sent manually outside the governed outbound path (exactly
   what happened when 5 real prospective businesses were researched and
   draft messages prepared for a human to send by hand) has no such
   message to point to.
2. **An explicit OBSERVED / INFERRED / UNKNOWN axis.** The closest
   existing concept, `CustomerEvidenceDirectness` (DIRECT/INFERRED), has
   no third state for "not yet established," and grades one already-
   extracted claim's interpretive distance rather than whether a
   structured finding was established at all.
3. **A discrete evidence-sufficiency validation ladder.**
   `Opportunity.validationLevel` (`LEVEL_0`..`LEVEL_8`) already exists,
   but it's a broader, opportunity-lifecycle-wide ladder spanning every
   evidence type — not specific to customer-discovery sufficiency, and
   not wired to M5 at all (`CUSTOMER_VALIDATED`, published when a
   `CustomerDiscoveryMemo` is approved, has zero subscribers anywhere in
   the codebase).
4. **An explicit, evidence-backed WTP classifier** (WEAK/MEDIUM/STRONG/
   VERY_STRONG), which didn't exist as a named concept anywhere.

## Data model

Two new tables, plus one small, deliberate extension to an existing one:

- **`CustomerDiscoveryInteraction`** — generalizes `CustomerResponse`:
  `opportunityId`, `prospectId`, an *optional* `outreachMessageId` (set
  only when this interaction really is a reply to a message this system
  sent), `interactionType` (`EMAIL_REPLY | INTERVIEW | CALL |
  FORM_RESPONSE | OTHER`), `interactionDate`, `channel`,
  `participantRole`, immutable `rawNotes`, `reality` +
  `provenanceNote` (see below), and `interactionOutcome` — a small
  controlled vocabulary (`PROBLEM_CONFIRMED | PROBLEM_NOT_PRESENT |
  ALREADY_SOLVED_ADEQUATELY | INCONCLUSIVE`), mirroring
  `RESPONSE_CLASSIFICATIONS`'s own discipline of forcing a structured
  outcome rather than parsing free text — this is the *one* deterministic
  signal the validation engine reads to detect disqualifying evidence.
- **`DiscoveryFinding`** — one row per structured finding, each
  independently tagged `provenance: OBSERVED | INFERRED | UNKNOWN`
  (`field`, `value`, optional `evidenceQuote`). **Only `OBSERVED`
  findings that map to a `CustomerSignalType` are ever promoted to a
  real `Evidence` + `CustomerEvidence` pair** — the concrete mechanism
  that makes "never let an inferred value masquerade as observed
  evidence" true by construction, not convention: an `INFERRED` or
  `UNKNOWN` finding simply has no code path that turns it into Evidence.
- **`CustomerEvidence.responseId` is now nullable**, with a new
  optional `discoveryInteractionId` sibling FK (exactly one of the two
  is ever set, enforced in `customerEvidenceService.create`). This lets
  interaction-sourced evidence reuse the *exact same* signal-routing
  table, independence machinery, and Chairman/CEO/memo logic that
  response-sourced evidence already gets — rather than building a
  second, parallel, weaker pipeline. All 13 pre-existing `CustomerEvidence`
  rows in this repository's history kept their `responseId` unchanged;
  the migration is a straight SQLite table rebuild with no data loss.

The finding-field vocabulary (`DISCOVERY_FINDING_FIELDS`,
`src/domain/customer-discovery/discovery-interaction.types.ts`) is the
brief's 12 categories, **plus one deliberate addition**:
`WILLINGNESS_TO_PAY` — the WTP classifier needs a concrete field to
classify an explicit payment statement from, and folding it into
`EXISTING_SPEND` or `CONSEQUENCE` would misrepresent what was actually
said. Five new `CustomerSignalType` values were added for promotion
(`WORKFLOW`, `VOLUME`, `TIME_COST`, `CONSEQUENCE`, `AUTOMATION_ATTEMPT`)
— purely additive, no existing signal type's meaning or routing changed.

## REAL vs DEV_FIXTURE

Every interaction carries the unmodified M10 `RealityLabel`
(`REAL | DEV_FIXTURE | HUMAN_ACTION | SIMULATED`,
`src/domain/real-world/reality.types.ts`) and a `provenanceNote`;
`buildRealWorldTag()` is reused verbatim for its one real enforcement
(a `REAL`/`HUMAN_ACTION` tag requires a non-empty note — never a "trust
me"). When a finding is promoted to Evidence, the interaction's own
reality tag is carried onto the new `Evidence.metadata` — the identical
mechanism M10 already proved survives `signalService.ingest()`
unmodified — so a reviewer can always trace whether a piece of evidence
came from a real conversation or a fixture. **A `DEV_FIXTURE` interaction's
evidence is never silently relabeled `REAL`, and vice versa** — the tag
travels with the row, it is never re-derived.

## WTP levels

`src/domain/customer-discovery/wtp.ts`, `classifyWtp()` — deterministic,
no model call, and **only ever reads `OBSERVED` findings**:

| Level | Backed by |
|---|---|
| `NONE` | No relevant OBSERVED finding |
| `WEAK` | An OBSERVED `PROBLEM_CONFIRMED` finding — general agreement the problem exists |
| `MEDIUM` | An OBSERVED `FREQUENCY` or `VOLUME` finding — a specific recurring cadence |
| `STRONG` | An OBSERVED `EXISTING_SPEND`, `TIME_COST`, or `CONSEQUENCE` finding — real allocated cost |
| `VERY_STRONG` | An OBSERVED `WILLINGNESS_TO_PAY` finding — an explicit stated willingness, ideally with an amount |

The result always names the single highest level any real finding
actually supports, with the exact finding value quoted in `reasons` —
never a level "because an analyst thinks they'd probably pay."

## Validation ladder

`src/domain/customer-discovery/validation-status.ts`,
`evaluateCustomerValidation()` — pure, deterministic, explicit named
thresholds (`CUSTOMER_VALIDATION_THRESHOLDS`), never magic numbers:

- **`UNVALIDATED`** — zero independent businesses confirm the problem. Insufficient evidence, stated as such.
- **`INTERESTING`** — at least one confirms, but below `MIN_BUSINESSES_FOR_STRONG` (2), or recurring/measurable pain isn't established yet.
- **`STRONG`** — `MIN_BUSINESSES_FOR_STRONG` (2) independent businesses confirm *and* recurring or measurable pain (an OBSERVED FREQUENCY, VOLUME, or TIME_COST finding) is established.
- **`BUILD_CANDIDATE`** — STRONG, plus WTP reaches `MIN_WTP_LEVEL_FOR_BUILD_CANDIDATE` (`STRONG`) or higher.
- **`REJECTED`** — checked *first*, overriding every other signal: `MIN_BUSINESSES_FOR_STRONG` (2) or more independent businesses recorded `PROBLEM_NOT_PRESENT` or `ALREADY_SOLVED_ADEQUATELY`.

Every branch's `evidenceGaps` names exactly which threshold wasn't met —
never a bare status with no explanation.

**Scope, stated honestly:** `customerValidationService.evaluate()` reads
`CustomerDiscoveryInteraction` + `DiscoveryFinding` as its source of
truth. Pre-existing `CustomerResponse`/`CustomerEvidence` data recorded
through the original M5 outreach-reply path is not automatically folded
into the count — a deliberate scope boundary, not a silent gap:
`CustomerEvidence` was extended to accept evidence from either source
specifically so a future pass could unify the two counts without
another schema migration.

## Independence — counting businesses, not messages

`src/domain/customer-discovery/business-independence.ts`,
`countIndependentBusinesses()` — a plain distinct-count over
`Prospect.organization`, dropping null/empty values rather than counting
them as a business. Three emails from the same company, or two
employees of the same company, collapse to one. This is a different
question from `classifyIndependence` (`src/domain/claim/independence.ts`,
already used elsewhere in M5/M4 for KNOWN/LIKELY/UNKNOWN evidence-quality
grading) — that answers "how confident are we independence holds";
this answers "how many distinct businesses does this represent," which
is what the validation ladder's thresholds are actually counting.

## Human governance

- `customerDiscoveryInteractionService.record()` and `.setOutcome()` are
  human-only (`assertHumanActor`) — manually transcribed from a real
  external channel this system has no programmatic access to, exactly
  `customerResponseService.record()`'s own precedent.
- `attachFinding()` never creates an `ApprovalRequest`, never sends
  anything, and never marks an opportunity validated — it only ever
  writes a `DiscoveryFinding` and, for `OBSERVED` findings, an
  `Evidence`/`CustomerEvidence` pair. `customerValidationService.evaluate`/
  `.summarize` are pure reads.
- Nothing in this layer imports `outboundMessageService` or
  `messageApprovalService` — outreach sending is unchanged and untouched;
  this layer only prepares/records/analyzes, per the brief's own AI-may /
  AI-may-not boundary. Verified by governance tests that count
  `ApprovalRequest`/`OutreachMessage` rows before and after every new
  operation.
- No model call anywhere in this layer — `classifyWtp()` and
  `evaluateCustomerValidation()` are pure functions; the system works
  identically whether `MODEL_PROVIDER_MODE` is `development` or
  `anthropic`.

## Evidence traceability

Every validation conclusion is walkable: `Opportunity` →
`customerEvidenceService.listForOpportunity()` → `CustomerEvidence.prospectId`
/ `.discoveryInteractionId` → `CustomerDiscoveryInteraction` →
`DiscoveryFinding.promotedToEvidenceId` → the exact `Evidence` row the
validation decision counted. Nothing is ever concluded without a
citable row behind it.

## Worked example (documentation/tests only — nothing below was inserted into the live database)

The payment-reconciliation opportunity currently has exactly one
`REAL` signal, from one Reddit thread (`independentSourceCount: 1`).
Suppose two of the five real Indian businesses researched during
customer discovery (`docs/` prospect research, not repeated here) are
actually called, and both confirm:

```
Business A (Acme Bookkeeping): interactionOutcome=PROBLEM_CONFIRMED
  PROBLEM_CONFIRMED (OBSERVED): "Yes, this happens every reconciliation cycle."
  FREQUENCY (OBSERVED): "Every month at close."
  EXISTING_SPEND (OBSERVED): "We pay a part-time bookkeeper partly for this."

Business B (Widgets Inc): interactionOutcome=PROBLEM_CONFIRMED
  PROBLEM_CONFIRMED (OBSERVED): "Yes, same issue."
  TIME_COST (OBSERVED): "About 6 hours a month."
```

`customerValidationService.summarize(opportunityId)` would report:
`businessesConfirmingProblem: 2`, `recurringPain: CONFIRMED`,
`measuredTimeOrCost: CONFIRMED`, `existingSpend: CONFIRMED`,
`wtp: STRONG` (from the EXISTING_SPEND finding — no explicit WTP
statement was made), `validation: STRONG` — one threshold short of
`BUILD_CANDIDATE`, which needs an explicit `WILLINGNESS_TO_PAY` finding
or an equivalent VERY_STRONG signal. This exact scenario is asserted in
`tests/integration/customer-validation.test.ts` — no fabricated
customer evidence exists in `dev.db` or `test.db` from this example.

## Files

- `src/domain/customer-discovery/` — provenance, finding fields, WTP, validation-status, business-independence (all new).
- `src/domain/customer-evidence/customer-signal.types.ts`, `signal-routing.ts` — additive extension only (5 new signal types + routing entries).
- `src/services/customer-discovery-interaction.service.ts`, `src/services/customer-validation.service.ts` (new).
- `src/services/customer-evidence.service.ts` — additive extension (accepts either `responseId` or `discoveryInteractionId`).
- `src/db/repositories/customer-discovery-interaction.repository.ts`, `discovery-finding.repository.ts` (new).
- `src/api/routes/customer-discovery-interactions.routes.ts`, `customer-validation.routes.ts` (new), mounted in `src/api/app.ts`.
- `prisma/migrations/20260905183623_customer_discovery_validation/`, `20260905190000_customer_discovery_event_type/`.
- Tests: `tests/unit/customer-discovery-domain.test.ts`, `tests/integration/customer-discovery-interaction.test.ts`, `tests/integration/customer-validation.test.ts`, `tests/integration/customer-discovery-governance.test.ts`.

## Exact next commands for an operator

```
# Record a real interaction (human bearer token required):
POST /api/customer-discovery-interactions
# Attach a structured finding (agent-attributed):
POST /api/customer-discovery-interactions/:id/findings
# Set the deterministic outcome once a call is analyzed:
POST /api/customer-discovery-interactions/:id/outcome
# Read the deterministic opportunity summary:
GET /api/customer-validation/:opportunityId
```
