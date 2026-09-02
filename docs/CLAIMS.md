# Claims

M4. The falsifiable unit of assertion underneath an Opportunity's
dimension-level scores. Full rationale in
`docs/M4_ARCHITECTURE_PROPOSAL.md` §3-§9.

## What a Claim is, and isn't

A `Claim` (`prisma/schema.prisma`, `src/domain/claim/claim.types.ts`)
is one specific, checkable assertion about an opportunity — "small
business owners spend hours reconciling invoices manually" is a
claim; "this opportunity scores 0.7" is not. `Opportunity.opportunityScore`
stays a single dimension-weighted number (`opportunity-scorer.ts`,
unchanged since M3); a `Claim` is the granular thing *underneath* one
dimension that can actually be validated, contradicted, or found
wanting — the gap M3's own architecture audit identified
(`M4_ARCHITECTURE_PROPOSAL.md` §1.3).

## The twelve claim types — exactly, no more

`CLAIM_TYPES` (`domain/claim/claim.types.ts`): `CUSTOMER_PROBLEM,
CUSTOMER_SEGMENT, FREQUENCY, WILLINGNESS_TO_PAY, MARKET_SIZE,
COMPETITIVE_POSITION, DIFFERENTIATION, DISTRIBUTION, RETENTION,
BUILDABILITY, TIMING, ECONOMICS`. Each maps onto exactly one thing
VentureForge already computed through real evidence-grounded reasoning
— never invented content restating what's already known (§3, §29).

## Importance — a documented, founder-revisable policy table

`CLAIM_TYPE_IMPORTANCE` assigns `CRITICAL | HIGH | MEDIUM | LOW` by
claim type alone:

| Importance | Claim types | Why |
|---|---|---|
| CRITICAL | `CUSTOMER_PROBLEM`, `WILLINGNESS_TO_PAY` | If the problem isn't real or nobody would pay, nothing else matters. |
| HIGH | `CUSTOMER_SEGMENT`, `DISTRIBUTION`, `COMPETITIVE_POSITION` | Materially changes viability without necessarily invalidating the problem. |
| MEDIUM | `FREQUENCY`, `MARKET_SIZE`, `DIFFERENTIATION`, `RETENTION`, `ECONOMICS` | Failure here usually means smaller/harder, rarely nonexistent. |
| LOW | `BUILDABILITY`, `TIMING` | `technicalDifficulty` is already weighted into kill-risk directly; timing is the most revisable dimension M3 scores. |

`CLAIM_IMPORTANCE_WEIGHT` (`1.0 / 0.7 / 0.4 / 0.2`) turns this into a
number reused directly by opportunity-confidence aggregation
(`domain/claim/opportunity-confidence.ts`) and Expected Information
Gain (`domain/claim/eig.ts`, `EXPECTED_INFORMATION_GAIN.md` — see
`DECISION_INTELLIGENCE.md`) — "how important is this claim" is defined
exactly once, consumed everywhere.

## Extraction is deterministic — no model call

`src/services/claim-extraction.service.ts`. Every statement traces to
a real field: `CUSTOMER_PROBLEM`/`CUSTOMER_SEGMENT`/`FREQUENCY`/
`WILLINGNESS_TO_PAY` come from the linked `Problem`'s own fields when
one exists, falling back to `Opportunity.problem`/`targetCustomer`
otherwise; `COMPETITIVE_POSITION` summarizes real `CompetitorObservation`
rows; `DISTRIBUTION` reads `Opportunity.metadata.distributionChannels`;
the remaining six (`MARKET_SIZE`, `DIFFERENTIATION`, `RETENTION`,
`BUILDABILITY`, `TIMING`, `ECONOMICS`) map 1:1 onto an
`OpportunityScoreDimensions` key, preferring an existing `EvidenceGap`'s
real ASSUMED-dimension reasoning when one exists, otherwise stating the
real scored value directly. `extractedFrom` records which field, in
plain text, for auditability (Part 44's "never fabricate").

Idempotent: `extractForOpportunity` returns the existing 12 claims
unchanged on a re-run rather than duplicating them
(`tests/integration/claim-extraction.test.ts`).

**Initial confidence is a prior, not a verdict** — 0.2 for an
ASSUMPTION-sourced claim, `Opportunity.confidenceScore` (or a 0.3
fallback) for a real-field-sourced one, 0 when nothing at all is
available — always superseded once a `ValidationReport` exists
(`EVIDENCE_VALIDATION.md`).

## Validation states — a complete digraph, deliberately

`CLAIM_VALIDATION_STATUSES` (`domain/claim/claim-validation.types.ts`):
`UNVERIFIED, SUPPORTED, WEAK, CONTRADICTED, CONFLICTED,
INSUFFICIENT_EVIDENCE`. Unlike every other M1-M3 state machine (all of
which have a terminal state, because they model a resource's
lifecycle), `CLAIM_VALIDATION_TRANSITIONS` is the complete digraph —
every status reaches every status, self-loops included. A Claim's
status models the current best reading of an always-open epistemic
question: new evidence can legitimately move a `SUPPORTED` claim back
to `WEAK`, or a `CONTRADICTED` claim toward `CONFLICTED`, without the
earlier evidence on either side ever being deleted. Still built on the
shared `state-machine.ts`/`assertTransition` utility for consistency
and auditability (`tests/unit/claim-transitions.test.ts` proves every
edge is legal).

## Claim ↔ Evidence: `ClaimEvidence`

A genuine relation (`SUPPORTING | CONTRADICTING | UNKNOWN`,
`domain/claim/claim-evidence.types.ts`), not metadata on either side —
see `EVIDENCE_VALIDATION.md` for how it's populated. `UNKNOWN` is a
real, storable value: evidence whose bearing on a specific claim
couldn't be confidently classified either way is recorded as such
rather than silently dropped.

## API

`GET /api/opportunities/:id/claims`, `GET /api/claims/:id`, `GET
/api/claims/:id/validation-reports`, `POST /api/claims/:id/validate`
(runs the Evidence Validator, then confidence recalculation and
evidence-gap refresh, in one call — `src/api/routes/claims.routes.ts`).
