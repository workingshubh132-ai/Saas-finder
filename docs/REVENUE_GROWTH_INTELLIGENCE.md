# Revenue & Growth Intelligence Engine

M8. Closes the loop M7 opened: a `LIVE` product now feeds real usage,
revenue, and customer data back into the same CEO/Chairman governance
chain every prior milestone already runs on — LIVE PRODUCT → REAL DATA
→ METRICS → EVIDENCE → CLAIMS → ANALYSIS → CEO → CHAIRMAN → HUMAN →
APPROVED ACTION → CONTROLLED EXECUTION → NEW DATA. No new product
lifecycle state, no new Guardian permission, no new execution surface —
M8 is read-and-reason only, plus one bounded, human-gated growth
experiment. Full rationale in `docs/M8_ARCHITECTURE_PROPOSAL.md`; the
specific decisions this build made along the way are in
`docs/DECISIONS.md` #65 onward; the full security threat review is in
`docs/SECURITY.md`'s M8 section.

## The hard boundary this whole milestone answers to

M8 agents may never spend money, change billing, deploy, delete or
refund a customer, launch a campaign, or send an external message
(brief §30, "no self-execution"). Every M8 agent only reads
already-persisted provider data and writes its own analysis —
deterministic metrics, `Anomaly` rows, a `BusinessHealth` snapshot,
`Claim` updates, a `CeoRecommendation`, a `ChairmanReview`, a
`BusinessReviewMemo` — never a status change, never a real side
effect. The one action with a real, if bounded, effect (starting a
`GrowthExperiment`) reuses M7's PLAN/APPROVE/EXECUTE mechanism exactly:
an agent proposes, a human approves, a **separate** human-actor-only
call starts it. Every number this milestone produces is also
structurally distinguished as OBSERVED, ESTIMATED, INFERRED, or
PREDICTED (`BusinessMetric.valueKind`, widened from M7's two-value
version) — an estimate can never silently become a fact, and a
forward-looking prediction is never displayed as a current one.

## The pipeline

```
Product.LIVE (M7, unchanged)
  → businessIntelligenceService.analyze()
      → Product Intelligence Agent   (activation, retention, anomalies — real usage data)
      → Revenue Analyst              (MRR/ARR/ARPU, churn, gross margin, unit economics)
      → Growth Analyst               (signup trajectory, channel cohorts, experiment results)
      → Customer Intelligence Agent  (recurring pain/requests/churn reasons, segment strength)
      → businessClaimExtractionService.upsertClaim × 6  (real claims, real Evidence, real ClaimEvidence)
      → deriveBusinessHealth()       (8 dimensions, one risk-adjusted composite, 7 named states)
      → CEO.recommendBusinessAction  (INVEST/IMPROVE_PRODUCT/RUN_EXPERIMENT/.../PREPARE_KILL_REVIEW/KILL/REQUEST_HUMAN_REVIEW)
      → Chairman.reviewBusinessAction (independently re-derives from the same underlying rows)
      → BusinessReviewMemo.compile → human decides
  → (human APPROVE on PREPARE_KILL_REVIEW/KILL) → Product.LIVE → PAUSED  (reversible, already-existing transition)
  → NEW DATA (the next analyze() run reads whatever changed)
```

Portfolio comparison runs alongside, not instead of, the per-product
pipeline:

```
portfolioService.analyzePortfolio(productIds)
  → Portfolio Analyst  (ranks already-analyzed LIVE products on Constitution §19's own verbs: SCALE/MAINTAIN/INVESTIGATE/PIVOT/PAUSE/RETIRE)
  → for every RETIRE/PIVOT: re-invoke the SAME per-product CEO → Chairman → Memo chain above
```

A `RETIRE`/`PIVOT` recommendation never itself changes anything — it
is a *trigger* for the identical governance chain every other business
decision goes through, never a second, bypassing path.

Growth experiments run their own, narrower PLAN → APPROVE → EXECUTE
lane:

```
experimentAnalystService.run()       → GrowthExperiment (DRAFT → ANALYZED, targets the highest-EIG claim)
growthExperimentService.requestApproval → ApprovalRequest (YELLOW, exact-experiment-bound)
  → (human APPROVED) → growthExperimentService.applyDecision → GrowthExperiment.APPROVED
  → growthExperimentExecutionService.approveToRun (assertHumanActor)   → RUNNING
  → growthExperimentExecutionService.completeExperiment (mechanical)  → COMPLETED, GrowthExperimentResult
      (confidence: LOW_CONFIDENCE/MODERATE/HIGH_CONFIDENCE — from sample size and effect size alone, never a fabricated p-value)
```

Its real result becomes an input the *next* Growth Analyst run reads —
`tests/integration/m8-capstone-experiment.test.ts` proves the full
loop, including that next read.

## Product lifecycle — unchanged

M8 adds no new `Product` status. `LIVE`/`PAUSED` already exist (M7);
the one M8-driven transition is the already-existing, already-reversible
`LIVE → PAUSED`, triggered only by a human `APPROVE` on a
`PREPARE_KILL_REVIEW`/`KILL` `BusinessReviewMemo`
(`businessReviewMemoService.recordHumanDecision`,
`ACTIONS_THAT_PAUSE_ON_APPROVAL`). Every other CEO business action
(`INVEST`, `IMPROVE_PRODUCT`, `RUN_EXPERIMENT`, `CHANGE_PRICING`,
`CHANGE_CHANNEL`, `INVESTIGATE_CHURN`, `REDUCE_COST`, `PAUSE_GROWTH`,
`REQUEST_HUMAN_REVIEW`) is strategic guidance a human reads and acts on
outside the system — it leaves `Product.status` untouched.

## Metrics: the OBSERVED/ESTIMATED/INFERRED/PREDICTED discipline

`BusinessMetric.valueKind` widens from M7's `OBSERVED`/`ESTIMATED` to
four values, and `assertMetricProvenance`
(`src/domain/business-metric/business-metric.types.ts`) enforces the
pairing structurally, not by convention: `OBSERVED` must come from a
real provider source; `INFERRED` must be a `DETERMINISTIC_CALCULATION`
citing at least one real `inputMetricIds` row it was computed from
(this build caught two real gaps here — `docs/DECISIONS.md` #70). The
same distinction shows up as a return type: every metric function
returns a `MetricResult` — `{status:"COMPUTED", value}` |
`{status:"UNKNOWN"}` | `{status:"INSUFFICIENT_DATA", reason}` — so
"not enough data yet" is a type a caller must handle, never a
fabricated zero.

## Kill intelligence — the same M4 scorer, real post-launch evidence

`killIntelligenceService.assess()` calls M4's own
`DeterministicKillRiskScorer` directly, unmodified (brief §27's own
explicit instruction — `docs/DECISIONS.md` #69), blending the
product's original opportunity-stage kill risk (30%) with a freshly
post-launch-scored risk (70%) — reality dominates a stale pre-launch
projection, but the original prior is never discarded outright. Only 5
of the scorer's 11 dimensions ever carry a real M8 signal; the
recalibration this made necessary is `docs/DECISIONS.md` #69 in full.

## CEO + Chairman: a fifth, distinct entry point

`ceoReasoningService.recommendBusinessAction` (a fifth axis alongside
M4's opportunity-kill, M5's customer-discovery, M6's product-build, and
M7's launch-operations) and `chairmanService.reviewBusinessAction` (a
fourth, focused review) mirror the "distinct entry point per decision
axis" precedent every prior milestone established. The CEO's own rule
order checks the kill signal and hard budget/margin/concentration/
grounding problems *before* any positive action is ever considered —
`REQUEST_HUMAN_REVIEW` is the honest fallback whenever revenue is
concentrated in one customer or grounding is too thin, never a forced
`INVEST`. The Chairman independently re-derives from the underlying
`BusinessHealth`/`Claim`/`RevenueProvider` rows rather than trusting
the CEO's own summary — the same discipline every prior Chairman
method already has.

## BusinessReviewMemo — `src/services/business-review-memo.service.ts`

Zero new model calls, same discipline as `LaunchReviewMemo`: every
field assembled from already-computed real data.
`recordHumanDecision` is the one place a decision is actually applied
— `APPROVE` on `PREPARE_KILL_REVIEW`/`KILL` moves a `LIVE` product to
`PAUSED`; every other action leaves `Product.status` untouched; a
memo can be decided exactly once.

## Structural, not just policy

- Every M8 agent (Product Intelligence, Revenue Analyst, Growth
  Analyst, Customer Intelligence, Experiment Analyst, Portfolio
  Analyst) holds **zero** Guardian permission grants — verified by a
  real test (`tests/integration/m8-security.test.ts`), not a comment.
- No M8 write path ever calls `.update` on an already-persisted
  `BusinessMetric`/`Evidence`/`Claim` row — every write is `.create`;
  an agent cannot rewrite its own prior output to flatter a later
  conclusion.
- `businessIntelligenceService.analyze()` can recommend
  `PREPARE_KILL_REVIEW` and still leave `Product.status` at `LIVE` —
  proven directly, not assumed
  (`tests/integration/m8-security.test.ts`).
- Customer feedback text reaches the Customer Intelligence Agent's
  prompt labeled as untrusted content; a structured `sentiment` field,
  never the prose, governs the real output — proven with an
  instruction-shaped excerpt that has zero effect
  (`tests/integration/m8-security.test.ts`).
- Retention/activation/churn/anomaly detection all refuse to report on
  a sample below their own documented minimum — `INSUFFICIENT_DATA`,
  never a guess dressed up as a number.

## What M8 does not claim

No `BusinessHealth`/kill/portfolio recommendation in this milestone
reflects a real customer, real revenue, or real market outcome unless
a human has independently verified that outside this system — every
provider is `DEV_FIXTURE`-only, exactly like M7's own. Backtesting
(`backtesting.service.ts`) replays only the deterministic
`computeBusinessActionPriorityScore` formula against historical
`BusinessHealth` snapshots; it never re-invokes the underlying LLM
reasoning historically (there is no way to pin a historical model
snapshot) — a real, stated limitation, not an overclaim.
Contraction/expansion MRR tracking is always `0` in this milestone's
`computeAndRecordChurn` (the dev-fixture `RevenueProvider` doesn't
model per-subscription plan-change history) — documented in the
function's own comment, never fabricated. `PredictionOutcome`
resolution refuses to fill in an observed value before its own
`targetPeriodEnd` has elapsed — no future-information leakage, checked
directly by a test.
