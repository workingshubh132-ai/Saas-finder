# Evidence Validation

M4. The Evidence Validator agent, evidence quality/independence/
freshness/source-reliability assessment, contradiction detection, and
confidence recalculation. Full rationale in
`docs/M4_ARCHITECTURE_PROPOSAL.md` §2, §6-§11.

## The Evidence Validator — genuinely adversarial, not another opportunity generator

`src/services/evidence-validator.service.ts`. A real
`agentRuntimeService`-backed agent, same substrate as every other M2/M3
agent, but its job is to **actively search for reasons a claim might
be wrong**, not summarize support for it. Per claim: reads every
`Evidence` item linked to the opportunity, optionally runs up to
`maxSearches` real counter-evidence searches through the same
`SourceSearchTool`/Guardian/rate-limit path M3's Research/Competitor
Analysts already use, then makes ONE structured-output model call
classifying each item `SUPPORTING | CONTRADICTING | UNKNOWN` for that
*specific* claim (not the opportunity in general) and forming an
overall status/confidence/reasoning/missingEvidence/recommendedResearch.
Budget: `{ maxSteps: 4, maxToolCalls: 2, maxModelCalls: 1, maxRetries:
1, maxDurationMs: 20_000 }`.

It never writes to `Claim.status` or `Opportunity.status` itself — its
entire output surface is one persisted `ValidationReport` (+ the
`ClaimEvidence` rows backing it). A separate, deterministic
confidence-recalculation step decides how that report changes the
claim's own persisted status/confidence (below).

## Seven quality factors — never collapsed to one number

`domain/claim/evidence-quality.ts`. Split by provenance:

- **Deterministic, computed and handed to the Validator as input**
  (never invented by the model): `reliability` (from `Evidence.reliability`,
  `LOW/MEDIUM/HIGH` → `0.2/0.6/1.0`); `specificity` (reuses
  `Signal.qualityScore`'s exported content-length proxy,
  `domain/signal/signal-quality.ts`); `recency` (see below);
  `directness` (a table over `EvidenceSourceType`: `CUSTOMER=1.0,
  EXPERIMENT=0.9, INTERNAL=0.7, COMPETITOR=0.5, MARKET_DATA=0.5,
  WEB=0.4, OTHER=0.3`); `independence` (see below).
- **Genuine Validator judgment, captured as explicit structured
  output:** `originality` (is a supporting item saying something new,
  or repeating another in different words?); `corroboration` (given
  the deterministic supporting-item *count*, how much should that
  corroboration actually be trusted?).

`computeQualityScore` combines all seven (weights `0.20/0.15/0.15/
0.10/0.15/0.10/0.15`) into one aggregate `qualityScore` — a
convenience for sorting/thresholds, always persisted alongside the
full breakdown on `ValidationReport.qualityAssessment`, never in place
of it.

## Freshness

`domain/claim/freshness-policy.ts`: `≤30 days → 1.0 (fresh)`, `≤180
days → 0.6 (aging)`, `>180 days → 0.3 (stale)`. Computed from the
linked `Signal.publishedAt` when one exists, else `Evidence.collectedAt`
— missing-date evidence gets the conservative `stale` bracket, never
an assumed-fresh `1.0`.

## Independence — three levels, never defaulting to certainty

`domain/claim/independence.ts`, extending M3's `Signal.sourceGroupKey`
mechanism one layer deeper: `KNOWN` (every supporting item resolves to
a `sourceGroupKey`, ≥2 distinct values present — a directly queryable
fact); `LIKELY` (different `source`/`sourceType` values but at least
one item lacks a resolvable group key — a reasonable inference, not a
proven one); `UNKNOWN` (everything else, **the fallback**, including a
single supporting item — never defaults to `KNOWN`).

## Contradiction detection

Not a separate mechanism — any evidence the Validator classifies
`CONTRADICTING` for a claim *is* a detected contradiction, surfaced in
`ValidationReport.contradictingEvidenceIds`. Three guarantees: (1)
contradicting evidence is never deleted — `ClaimEvidence`/`Evidence`
expose no delete method; (2) a contradiction always lowers confidence,
even alongside `SUPPORTED` status (the recalculation formula's penalty
term applies unconditionally); (3) `CONFLICTED` is a first-class
outcome when support and contradiction are roughly balanced, never a
forced tie-break.

## Confidence recalculation — documented, deterministic, clamped

`domain/claim/confidence-formula.ts`, `src/services/claim-confidence.service.ts`.
Two steps:

```
es = 0.30·reliability + 0.20·specificity + 0.15·recency
   + 0.15·independenceCredit + 0.20·corroborationCredit

independenceCredit:  KNOWN=1.0, LIKELY=0.6, UNKNOWN=0.2
corroborationCredit: min(supportingCount, 3) / 3   — a hard count,
                      deliberately distinct from the Validator's own
                      qualitative `corroboration` factor above

STATUS_TARGET = { SUPPORTED: 0.9, WEAK: 0.4, CONTRADICTED: 0.1,
                   CONFLICTED: 0.5, INSUFFICIENT_EVIDENCE: null,
                   UNVERIFIED: null }
contradictionPenalty = 0.2 · min(contradictingCount, 3) / 3

newConfidence = STATUS_TARGET[status] === null
  ? priorConfidence                                    // no evidence, no update
  : clamp01(STATUS_TARGET[status] · (0.5 + 0.5·es) − contradictionPenalty)
```

`INSUFFICIENT_EVIDENCE`/`UNVERIFIED` never move confidence on their
own (`tests/unit/claim-confidence.test.ts`). `claimConfidenceService.recalculateOpportunityConfidence`
then rolls every claim's confidence into a fresh, history-preserving
`OpportunityScoreRecord`, weighted by `CLAIM_IMPORTANCE_WEIGHT` — a
single CRITICAL claim collapsing moves opportunity confidence far more
than any number of LOW claims doing the same.

## Structured output — Zod-validated, never trusted raw

`validationOutputSchema` (`evidence-validator.service.ts`) — same
`completeWithValidation` pattern (one corrective retry, then a hard
failure) as every other M2/M3 structured call. A `[DEV FIXTURE]`
deterministic stand-in (`buildDevValidatorFixture`) classifies by real
reliability/confidence thresholds and a genuine negative-keyword scan
— never a static stub.
