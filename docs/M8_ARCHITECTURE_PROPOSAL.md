# M8 Architecture Proposal — Revenue & Growth Intelligence Engine

Phase 0 gate (M8 brief, closing instruction). This document must be
complete before substantial M8 implementation begins.

## 1. M7 audit — what already exists and what M8 must not disturb

M8 is read-and-reason on top of what M7 already made real. Nothing
below requires changing M1–M7 behavior; every change is additive.

**What M7 already built that M8 consumes directly:**

- `Product.status` reaches `LIVE` (and cycles `LIVE ⇄ PAUSED`) —
  M8's entire premise (a product with real, if dev-fixture, activity)
  depends on this and nothing earlier.
- `BusinessMetric` (`productId`, `metricType`, `valueKind`
  OBSERVED\|ESTIMATED, `value`, `source`, `recordedAt`) — the exact
  "never blur real vs. projected" structural enforcement M8's own
  Section 1 demands, already half-built. M8 extends this table rather
  than inventing a parallel one (§9 below).
- `AnalyticsProvider` (`src/domain/ports/analytics-provider.ts`) — a
  single `track()` method, write-only, called only from the M7 demo.
  M8 needs to *read* usage events back out, which this port cannot do
  yet (§31).
- `BillingProvider`/`BillingAccount`/`WebhookDelivery` — M7's dev
  fixture already models subscriptions with a status and a webhook
  delivery record. This is M8's most natural revenue-data source.
- `MonitoringProvider` — on-demand health only, no metrics of its own.
- `Incident`/`SupportCase` — already real, human/monitoring-triggered
  state machines. M8's Customer Intelligence Agent reads these; it
  does not re-model them.
- The PLAN → APPROVE → EXECUTE mechanism (docs/DECISIONS.md #58) and
  every RED/ORANGE permission it gates (`DEPLOY_PRODUCTION`,
  `ACTIVATE_BILLING`, `MODIFY_PRODUCTION`, `ACCESS_PRODUCTION_DATA`,
  `CREATE_BILLING`) — M8 never touches any of these. See §24.

**What M4 already built that M8 extends rather than re-invents:**

- `Claim`/`ClaimEvidence`/`ClaimType`/`ClaimImportance` — the
  falsifiable-assertion architecture, 12 claim types, deterministic
  importance weights, confidence recalculation
  (`recalculateClaimConfidence`), and a validation-status complete
  digraph (`CLAIM_VALIDATION_TRANSITIONS`) that already allows a
  SUPPORTED claim to move back to WEAK as new evidence arrives — this
  is exactly the "new data can change yesterday's conclusion" behavior
  M8 needs, already built and already tested.
- `DeterministicKillRiskScorer` — an 11-dimension, weighted,
  reason-generating scorer, opportunity-scoped. M8 reuses it directly
  (§27); no second kill-score system.
- `computeExpectedInformationGain` (`src/domain/claim/eig.ts`) — "how
  much would resolving this uncertainty actually matter," already
  built for the evidence-gap engine. The Experiment Analyst's
  hypothesis-prioritization reuses this rather than inventing a
  second uncertainty formula (§26).
- `calibrationService` — four existing methods
  (`summarize`/`summarizeCustomerDiscovery`/`summarizeProductBuilds`/
  `summarizeLaunch`), one shared `summarizeCalibration` function, all
  comparing *decision confidence* against *human decision*. M8 adds a
  fifth (§38) — and also needs a **structurally different** mechanism
  (§38): comparing a *predicted metric value* against an *observed
  metric value*, which no existing method does.

**A load-bearing structural fact, confirmed by reading
`prisma/schema.prisma` directly:** `Product.opportunityId` is
`@unique` — every Product has exactly one, permanent, originating
Opportunity. `Claim.opportunityId` is a mandatory FK. This means M8
needs **no new foreign key** to attach a business claim to a live
product — `claim.opportunityId` already resolves back to exactly one
Product via that 1:1 relation, the same way every M5/M6/M7 claim
reference already works. See §21.

**Constitution sections the M8 brief itself is a direct extension
of** (found by reading `CONSTITUTION.md` in full, not assumed):

- **§19 Portfolio Management** — "VentureForge may operate multiple
  SaaS businesses simultaneously... should continuously evaluate:
  SCALE, MAINTAIN, INVESTIGATE, PIVOT, PAUSE, RETIRE... AI may
  recommend shutting down an underperforming product. Final authority
  for high-impact shutdown decisions remains with the Human Owner."
  This is the Portfolio Analyst's action vocabulary, verbatim,
  founder-ratified before this milestone was ever specified. See §28.
- **§22 Learning From Failure** — `PREDICTION → ACTUAL RESULT →
  ERROR → ROOT CAUSE → LESSON → POLICY/MODEL/PROCESS UPDATE`. The
  M8 brief's own §41 "structured learning record" is this pipeline,
  restated. See §38.
- **§23 Prediction Tracking** — names exactly the predictions M8
  must track (expected conversion, MRR, CAC, retention, demand,
  profitability) *before* outcomes are known. See §38.
- **§20 Economic Principle** — "Activity is not success... distinguish
  TASKS, OUTPUT, CUSTOMERS, REVENUE, PROFIT." Directly grounds why
  business health (§18-19) cannot collapse to one number.

No core Guardian, risk, approval-engine, or agent-runtime code needs
to change for M8 — confirmed in §24.

## 2. M8 architecture — the loop, concretely

```
LIVE PRODUCT (M7)
    │
    ▼
PROVIDERS (dev-fixture, read side added this milestone)
 RevenueProvider · ProductUsageProvider · CustomerDataProvider · AnalyticsProvider(read)
    │
    ▼
DETERMINISTIC METRIC ENGINE  (no model calls — §9, §35)
 retention · cohorts · churn · revenue · cost · unit economics · anomalies
    │
    ▼
BusinessMetric rows (extended, §9)  +  Anomaly rows (§19)
    │
    ▼
EVIDENCE  (Evidence, sourceType="BUSINESS_METRIC"|"BUSINESS_ANALYSIS")
    │
    ▼
CLAIM  (existing M4 Claim, opportunityId — §21)
    │
    ▼
FIVE REASONING AGENTS (zero tool calls each, like every M5-M7 agent)
 Product Intelligence · Revenue Analyst · Growth Analyst ·
 Customer Intelligence · (Experiment Analyst, separate trigger, §26)
    │
    ▼
BusinessHealth (multi-dimensional, §18)
    │
    ▼
CEO.recommendBusinessAction()  (5th CEO axis — §22)
    │
    ▼
Chairman.reviewBusinessAction()  (independently re-derives from evidence — §23)
    │
    ▼
BusinessReviewMemo → HUMAN DECISION
    │
    ▼
[If APPROVE and action requires execution] → existing M4/M7 mechanism (§25)
    │
    ▼
NEW DATA (↺ back to the top)


SEPARATELY, cross-product (§28):

ALL LIVE PRODUCTS' BusinessHealth + metrics
    │
    ▼
Portfolio Analyst  →  PortfolioSnapshot (one row per product per run)
    │
    ▼
PortfolioRecommendation per product: SCALE|MAINTAIN|INVESTIGATE|PIVOT|PAUSE|RETIRE
    │
    ▼
RETIRE/PIVOT-worthy signal → triggers CEO.recommendBusinessAction() for
that product (never bypasses the CEO → Chairman → Human pipeline)
```

Two orchestrator services, not a new "Cycle" abstraction (§34):
`businessIntelligenceService.analyze({productId})` (single product,
mirrors `launchOperationsService.planLaunch()` exactly) and
`portfolioService.analyzePortfolio()` (cross-product). Both are
human/API-triggered, bounded, budgeted (§35) — there is still no
scheduler anywhere in this codebase, and M8 does not add one.

## 3. Product Intelligence

**Product Intelligence Agent** (`src/services/product-intelligence.service.ts`)
reads: `ProductUsageProvider` events (signup, activation-candidate
actions, feature-usage, session activity) + the deterministic metric
engine's retention/activation output. Produces a structured summary:
strengths, weaknesses, bottlenecks (named drop-off points), anomalies
(from §19's detector), opportunities — each item citing the specific
`BusinessMetric`/`Anomaly` id it's grounded in. Zero tool calls, same
shape as every M5-M7 reasoning agent (`AgentRuntimeService.run` with a
structured-output schema and a dev fixture derived from real input).

## 4. Activation

`Product` gains **no new required field**. Activation is
product-*defined*, not framework-assumed, so it is stored as one new
lightweight table: `ActivationDefinition` (`productId`, `eventName`,
`definedAt`, `definedBy`) — set once, human or Product-Strategist
authored (reusing the M6 Product Strategist's own product-specific
judgment precedent, not a new agent). `computeActivationRate` (pure
function, `src/domain/product-intelligence/activation.ts`) reads
`ProductUsageProvider` events matching that `eventName` against total
signups in a window and returns
`{ activationRate, sampleSize, timeWindow, source }` or
`INSUFFICIENT_DATA` (§5's sentinel, reused) when `sampleSize` is below
a documented floor (`MIN_ACTIVATION_SAMPLE = 5`, matching the brief's
own "do not manufacture values from insufficient observations").

## 5. Retention

`computeRetention` (`src/domain/product-intelligence/retention.ts`),
pure, deterministic. Input: a cohort's signup timestamps + a stream of
"active" events from `ProductUsageProvider`. Output per window
(D1/D7/D14/D30):
`{ window, retainedCount, cohortSize, retentionRate } | { window, status: "INSUFFICIENT_DATA" }`.
`INSUFFICIENT_DATA` fires whenever `cohortSize < MIN_RETENTION_COHORT`
(documented constant, default 5) **or** the window hasn't elapsed yet
relative to `now` (a D30 retention number for a cohort that signed up
12 days ago is not a low number — it is not a number). This second
condition is the concrete fix for "do not manufacture retention values
when insufficient observations exist" that a naive implementation
would miss.

## 6. Cohort analysis

New, lean `Cohort` table (§32): `dimension` (`SIGNUP_DATE` \|
`ACQUISITION_EXPERIMENT` \| `ACQUISITION_CHANNEL` \| `PRICING_PLAN` \|
`PRODUCT_VERSION`), `dimensionValue`, `productId`, `definedAt`. A
Cohort is a *label*, not a metric — actual numbers (its retention, its
revenue) are `BusinessMetric` rows with a nullable `cohortId` FK
(§9). `buildCohorts` (pure function) only ever creates cohorts along
dimensions the available data actually supports — e.g. it never
proposes an `ACQUISITION_EXPERIMENT` cohort split for a product with
no `GrowthExperiment` rows. Determinism requirement satisfied by
construction: cohort membership is a pure function of already-recorded
timestamps/tags, no model call anywhere in the path.

## 7. Churn

Four **separately** computed, separately stored metrics — the brief's
own "do not confuse them" instruction, enforced by giving each its own
`BusinessMetricType` rather than one generic `CHURN_RATE` reused four
ways (which M7's original 6-type enum would otherwise tempt):

| Metric | `BusinessMetricType` | Definition |
|---|---|---|
| Logo churn | `LOGO_CHURN_RATE` | cancelled subscriptions ÷ active subscriptions at period start |
| Revenue churn | `REVENUE_CHURN_RATE` | lost MRR ÷ starting MRR |
| Gross revenue retention | `GROSS_REVENUE_RETENTION` | (starting MRR − churned − contracted) ÷ starting MRR |
| Net revenue retention | `NET_REVENUE_RETENTION` | (starting MRR − churned − contracted + expansion) ÷ starting MRR |

`computeChurn` (`src/domain/revenue-intelligence/churn.ts`), pure,
reads a period's subscription-status deltas from `RevenueProvider`.
Any metric whose denominator is 0 or whose sample is below
`MIN_CHURN_SAMPLE` returns `INSUFFICIENT_DATA`, never a fabricated 0%
or divide-by-zero.

## 8. Revenue Intelligence

**Revenue Analyst** (`src/services/revenue-analyst.service.ts`) reads
the deterministic revenue-metric engine's output (§16) — MRR, ARR,
ARPU, new/expansion/contraction/churned revenue, refunds, gross
margin — and produces grounded prose plus one or more `BUSINESS`-typed
Claims. It never computes a number itself; computation is 100%
`src/domain/revenue-intelligence/*.ts` pure functions (§35 — prefer
deterministic calculation, reserve the model call for judgment).

## 9. Metric model, provenance, and the four-way value kind

**Reuse, not a parallel table.** `BusinessMetric` (M7) already has
exactly the shape a `metric_observations` table would have. M8 widens
it rather than adding a second table the brief's own candidate list
suggests:

```
model BusinessMetric {
  ...existing fields, unchanged...
  periodStart DateTime?   // null for point-in-time metrics (UPTIME_PCT); required for windowed ones (30-day retention)
  periodEnd   DateTime?
  cohortId    String?     // nullable FK -> Cohort (§6)
  inputMetricIds String?  // JSON string[] — which other BusinessMetric rows this one was derived from (provenance chain, §39)
}
```

`BUSINESS_METRIC_TYPES` (`src/domain/business-metric/business-metric.types.ts`)
widens from 6 values to the full M8 vocabulary — MRR, ARR, ARPU,
ACTIVATION_RATE, RETENTION_D1/D7/D14/D30, LOGO_CHURN_RATE,
REVENUE_CHURN_RATE, GROSS_REVENUE_RETENTION, NET_REVENUE_RETENTION,
CAC, LTV, LTV_TO_CAC, PAYBACK_PERIOD_MONTHS, GROSS_MARGIN_PCT, plus the
6 M7 values, unchanged. Every one of these is additive to an existing,
already-tested CHECK-constrained column (§32's migration approach).

**`BusinessMetricValueKind` widens from 2 to 4** — the brief's Section
1 non-negotiable, and the single most load-bearing type change in this
milestone:

```
OBSERVED   — read directly from a provider, no computation beyond unit conversion
ESTIMATED  — a human or agent supplied a number without full provider backing (M7's existing meaning, unchanged)
INFERRED   — deterministically computed from other OBSERVED/INFERRED metrics (e.g. NRR inferred from four OBSERVED revenue deltas)
PREDICTED  — a forward-looking number attached to a not-yet-elapsed period (feeds §38's PredictionOutcome, never displayed as a current fact)
```

`BUSINESS_METRIC_SOURCES` widens to add `REVENUE_PROVIDER`,
`PRODUCT_USAGE_PROVIDER`, `CUSTOMER_DATA_PROVIDER`,
`DETERMINISTIC_CALCULATION` alongside the existing `DEV_FIXTURE`/
`MANUAL_ENTRY`/`COMPUTED_ESTIMATE`. A hard domain-level invariant
(enforced in the one function that ever constructs a `BusinessMetric`
input, `assertMetricProvenance`, not by convention): `valueKind:
"OBSERVED"` may only pair with a provider source, never
`MANUAL_ENTRY`/`COMPUTED_ESTIMATE`/`DETERMINISTIC_CALCULATION` — this
is the concrete rule that makes "MRR = ₹50,000" always answerable as
"observed, estimated, inferred, or predicted, and from where."

## 10. Metric provenance

Every `BusinessMetric` row already carries `source`; M8 adds
`inputMetricIds` (§9) so an `INFERRED` metric's own inputs are
queryable, not just labeled. `GET /api/business-metrics/:id/provenance`
(§33) walks this chain and returns it as an ordered list — the
concrete implementation of §39's Auditability diagram's first three
steps (SOURCE → RAW OBSERVATION → METRIC).

## 11. Observed vs. estimated vs. inferred vs. predicted

Covered fully in §9. The type-level guarantee: nothing in this
codebase can construct a `BusinessMetric` without picking one of the
four `BusinessMetricValueKind` values — there is no default, no
optional field, matching the exact discipline `docs/DECISIONS.md` #57
and #59-64 already established for M7's OBSERVED/ESTIMATED pair.

## 12. Time-series handling

`periodStart`/`periodEnd` (§9) are the entire mechanism — no separate
time-series store, no new charting infrastructure. A metric's "current
value" is simply its latest row by `recordedAt` for a given
`(productId, metricType, cohortId)` triple; a trend is the ordered set
of rows for that triple across periods. `metricSnapshotRepository`
(§32) exposes exactly this query, paginated, never an unbounded
`SELECT *`.

## 13. Cohort analysis

Covered in §6. Restated once more here only because the brief numbers
it separately: the `Cohort` table plus `BusinessMetric.cohortId` is
the complete mechanism; no second cohort-storage concept exists
anywhere else in the schema.

## 14. Retention

Covered fully in §5.

## 15. Churn

Covered fully in §7.

## 16. Revenue metrics

`computeRevenueMetrics` (`src/domain/revenue-intelligence/revenue-metrics.ts`),
pure. Reads a period's `BillingAccount`/subscription-fixture data via
the new `RevenueProvider` port (§31) — MRR (sum of active monthly-
normalized subscription values), ARR (MRR × 12), ARPU (MRR ÷ active
subscription count), new/expansion/contraction/churned revenue
(period-over-period subscription deltas), refunds (from
`RevenueProvider.listRefunds`). Every output value is `OBSERVED` when
it's a direct sum of real fixture subscriptions, `INFERRED` when it's
a ratio derived from two `OBSERVED` numbers (ARPU, growth rate).

## 17. Cost metrics

`computeCostBreakdown` (`src/domain/revenue-intelligence/cost-metrics.ts`),
extends M7's `launch-budget.ts` concept from "one estimated ceiling" to
"a real breakdown": infrastructure, AI/model usage, third-party APIs,
email, storage, database, monitoring, support, other — each tagged
`FIXED`\|`VARIABLE` and `OBSERVED`\|`ESTIMATED` independently (a
2×2, both axes real columns, not conflated). Infrastructure/monitoring
costs come from `MonitoringProvider`-adjacent dev-fixture data
(`OBSERVED`); AI/model usage cost is computed from this codebase's own
real `AgentExecution`/`ToolExecution` rows already recorded by M2's
agent runtime (genuinely `OBSERVED` — VentureForge's own operating
cost is not a fixture, it is the one real cost this whole system
already meters) — a deliberate, notable exception to "dev-fixture
only," justified because this data is real and already collected for
audit purposes; using it is additive, not a new attack surface.

## 18. Unit economics

`computeUnitEconomics2` (M8's own module,
`src/domain/revenue-intelligence/unit-economics.ts` — a **new**
function, not M7's `computeUnitEconomics` in
`src/domain/pricing-model/unit-economics.ts`, which answers a
different question: M7's version projects margin from a *proposed*
price before any customer exists; M8's measures margin from *observed*
revenue and cost after launch. Reusing the same function for both
would silently blend a pre-launch estimate with a post-launch
observation — exactly the failure mode Section 1 forbids. Both are
kept, cross-referenced in each file's own docstring, never merged):

```
ARPU            — §16, OBSERVED/INFERRED
grossMarginPct  — (revenue - variable cost) / revenue, INFERRED
contributionMarginPct — same, minus allocated fixed cost, INFERRED
CAC             — total acquisition spend / new customers in period, OBSERVED if spend is tracked, else "UNKNOWN" (literal string, not 0 or null)
LTV             — requires >= MIN_LTV_HISTORY_MONTHS (default 3) of retention history, else "INSUFFICIENT_DATA"
LTV:CAC         — computed only if both sides are real numbers, else "UNKNOWN" or "INSUFFICIENT_DATA" propagates
paybackPeriodMonths — CAC / (ARPU × grossMarginPct), same propagation rule
```

`"UNKNOWN"` and `"INSUFFICIENT_DATA"` are real members of a
discriminated-union return type
(`{ status: "COMPUTED"; value: number } | { status: "UNKNOWN" } |
{ status: "INSUFFICIENT_DATA"; reason: string }`), never a sentinel
number (`-1`, `0`) a caller could accidentally treat as real. This is
the direct, type-level enforcement of "never fabricate CAC or LTV."

## 19. Anomaly detection

`detectAnomalies` (`src/domain/anomaly/anomaly-detector.ts`), pure,
deterministic, **no model call** (§35) — a documented
rolling-baseline-and-threshold approach: for each `BusinessMetricType`
being monitored, compare the latest period's value against the mean
and standard deviation of the trailing N periods (default N=6,
`MIN_BASELINE_PERIODS = 3` below which no anomaly is ever declared —
"insufficient history" is itself the honest answer, not silence).
`Math.abs(zScore) >= ANOMALY_Z_THRESHOLD` (default 2.0, documented,
founder-revisable constant, same pattern as `HIGH_RISK_THRESHOLD` in
`kill-risk-scorer.ts`) flags an `Anomaly` row: `productId`,
`metricType`, `observedValue`, `baselineMean`, `baselineStdDev`,
`zScore`, `direction` (`SPIKE`\|`DROP`), `detectedAt`. Covers revenue
drops, conversion drops, traffic spikes, error spikes (from
`Incident`/`SupportCase` volume), churn spikes, cost spikes, usage
changes — all through the *same* one detector function parameterized
by metric type, not seven bespoke detectors.

## 20. Evidence generation

Every metric-derived conclusion that feeds a Claim first becomes a
real `Evidence` row (M1's existing table, unchanged shape):
`claim` (free text describing the observation), `source` = the metric
engine module name, `sourceType` = `"BUSINESS_METRIC"` (new value,
alongside M3's `"WEB"`/`"API"`, M5's `"CUSTOMER"`), `sourceReference` =
the `BusinessMetric.id` (or `Anomaly.id`), `collectedByAgentId` = the
producing agent, `reliability` derived deterministically from the
metric's own `valueKind` (`OBSERVED` → `HIGH`, `INFERRED` → `MEDIUM`,
`ESTIMATED`/`PREDICTED` → `LOW` — never a free judgment call),
`confidence` from sample size (retention/cohort metrics) or 1.0 for
direct provider reads. This is what makes §39's Auditability chain
real rather than aspirational: every Claim this milestone creates has
a real `ClaimEvidence` row pointing at a real `Evidence` row pointing
at a real `BusinessMetric.id`.

## 21. Claim generation

**No duplicate claim system.** M8 claims are ordinary M4 `Claim` rows
attached to `claim.opportunityId` = the live product's own originating
Opportunity (§1's 1:1 finding). Of the M8 brief's seven example
conclusions, five already have a matching `ClaimType`:

| Brief's conclusion | Existing `ClaimType` used |
|---|---|
| CUSTOMERS_ARE_WILLING_TO_PAY | `WILLINGNESS_TO_PAY` |
| RETENTION_IS_HEALTHY | `RETENTION` |
| CHANNEL_IS_EFFECTIVE | `DISTRIBUTION` |
| MARGIN_IS_SUSTAINABLE | `ECONOMICS` |
| CUSTOMER_SEGMENT_IS_STRONG | `CUSTOMER_SEGMENT` |

`PRODUCT_IS_GROWING`/`PRODUCT_IS_DECLINING` have no existing home —
both are the *same dimension* (overall trajectory) in opposite
directions, exactly like every existing type already carries either
polarity in its free-text `statement` field (a `RETENTION` claim can
say "healthy" or "weak" under one type). Adding two near-duplicate
types for opposite directions of one dimension would break "every
claim type appears exactly once" in `CLAIM_TYPE_IMPORTANCE`. **One**
new type is added: `GROWTH_TRAJECTORY` (importance: `HIGH` — a
declining product materially changes viability without necessarily
invalidating the original problem, the same reasoning
`CLAIM_TYPE_IMPORTANCE`'s own docstring already uses for its HIGH
tier). This is the only new `ClaimType` M8 adds; `CLAIM_TYPES` grows
from 12 to 13.

## 22. CEO integration

A **fifth** CEO decision axis (`CEO_DECISION_ACTIONS` is axis 1/M4,
`CUSTOMER_DISCOVERY_ACTIONS` axis 2/M5, `PRODUCT_BUILD_ACTIONS` axis
3/M6, `LAUNCH_OPERATIONS_ACTIONS` axis 4/M7), same shape as every
prior one:

```
src/domain/decision/business-action.types.ts
BUSINESS_ACTIONS = [
  "INVEST", "IMPROVE_PRODUCT", "RUN_EXPERIMENT", "CHANGE_PRICING",
  "CHANGE_CHANNEL", "INVESTIGATE_CHURN", "REDUCE_COST", "PAUSE_GROWTH",
  "PREPARE_KILL_REVIEW", "KILL", "REQUEST_HUMAN_REVIEW",
] as const;
```

The brief's own list, verbatim, plus the same trailing
`REQUEST_HUMAN_REVIEW` escalation every prior axis ends with
(`docs/M7_ARCHITECTURE_PROPOSAL.md`'s own precedent, cited directly in
`launch-operations-action.types.ts`'s docstring). `ceoReasoningService.recommendBusinessAction({agentId, productId, startedBy})`
— identical parameter shape to `recommendLaunchOperationsAction`.

**Prioritization formula** (documented, not vibes, per the brief's own
"must be deterministic/documented where appropriate"): a weighted
composite over `BusinessHealth`'s own dimensions (§18's health model)
—

```
priorityScore =
  0.25 * revenueHealthScore +
  0.20 * growthHealthScore +
  0.20 * retentionHealthScore (customer health) +
  0.15 * marginHealthScore +
  0.10 * evidenceConfidence +
  0.10 * (1 - riskScore)
```

weights documented as founder-revisable constants
(`BUSINESS_ACTION_PRIORITY_WEIGHTS`), same pattern as
`DIMENSION_WEIGHTS` in `kill-risk-scorer.ts` and
`CLAIM_IMPORTANCE_WEIGHT`. This is explicitly **not** "sort by
revenue" or "sort by score" (the brief's own two forbidden shortcuts)
— it feeds the CEO's *reasoning* (dev-fixture rule order, mirroring
every prior CEO fixture: budget/margin/evidence gates checked first,
then this score breaks ties among what's left), not a bare ranking
presented as a decision.

## 23. Chairman integration

A **third** new Chairman entry point (`review` is opportunity-scoped/
M1-M4, `reviewProduct` is M6, `reviewLaunch` is M7):
`chairmanService.reviewBusinessAction({productId, reviewedBy})`,
identical shape to `reviewLaunch`. It independently re-derives from
the underlying `BusinessMetric`/`Claim`/`Evidence` rows — never simply
re-reads the CEO's own conclusion — checking specifically:

- **Concentration risk**: does one customer/cohort account for
  disproportionate revenue? (`REVENUE_CONCENTRATION_THRESHOLD`, default
  0.5 — mirrors the brief's own "revenue increased, but one customer
  is 90%" example)
- **Small-sample retention**: is a "healthy retention" claim grounded
  in a cohort at or near `MIN_RETENTION_COHORT`?
- **Growth-margin divergence**: did growth increase while
  `GROSS_MARGIN_PCT` decreased in the same period?
- **Evidence-recommendation mismatch**: does the CEO's action
  contradict a `CONTRADICTED`-status Claim it cited?
- Every item the brief lists (revenue/retention/growth/customer
  evidence/unit-economics/experiment/portfolio/kill interpretation)

Fixture rule order (dev mode): concentration risk OR small-sample
retention → `REQUEST_MORE_EVIDENCE`; budget/margin breach or a cited
`CONTRADICTED` CRITICAL-adjacent claim → `REJECT`; growth-margin
divergence or an unresolved `Incident` → `REQUEST_CHANGES`; else →
`APPROVE`. Same five-verdict vocabulary every Chairman method already
uses (`APPROVE`/`REQUEST_CHANGES`/`REJECT`/`REQUEST_MORE_EVIDENCE`/
`DEFER`) — no new verdict type invented for M8.

## 24. Guardian integration

**Zero new permissions.** This is a real finding, not an omission:
every M8 agent only reads provider data and calls
`READ_DATABASE`/`WRITE_DATABASE` (already GREEN since M1) to persist
its own analysis. The one action with a real consequence — a human
moving a `GrowthExperiment` from `APPROVED` to `RUNNING` — is gated by
`assertHumanActor` directly (§26), the exact same "Guardian is never
consulted for a verified human's own action" precedent
`docs/DECISIONS.md` #58 already established for M7's EXECUTE step, not
a new Guardian grant. No M8 agent tool call is ever gated above GREEN,
so (per `docs/DECISIONS.md` #58's own finding that `callTool` throws
on any `REQUIRES_APPROVAL` resolution) there is nothing above GREEN
for an M8 agent to get stuck on in the first place. `PERMISSIONS`
(`src/domain/permission/permission.ts`) is unchanged by this
milestone.

## 25. Human approval

Two distinct human gates, not one, matching the brief's own two-gate
capstones (§26 experiment lifecycle vs. §29 business decision):

1. **`GrowthExperiment` APPROVED → RUNNING** — direct
   `assertHumanActor`-gated service call
   (`growthExperimentService.approveToRun`), mirroring
   `deploymentPlanService.applyDecision`'s shape but simpler (no
   provider EXECUTE call — running an experiment in this milestone's
   dev-fixture world is a status flag plus a bounded observation
   window, not an external side effect).
2. **`BusinessReviewMemo` human decision** — identical mechanism to
   `LaunchReviewMemo`/`ProductReviewMemo`/`CustomerDiscoveryMemo`:
   `recordHumanDecision({memoId, decision, reason, actor})`,
   `assertHumanActor`, APPROVE/REQUEST_CHANGES/REJECT/DEFER.

Neither gate invents new approval machinery; both call the same
`approvalService.requestApproval`/`.decide` M1 already built.

## 26. Experiment lifecycle

New model `GrowthExperiment` (named distinctly from M5's
`OutreachExperiment` — that model tests *outbound messaging* to
prospects; this one tests *product/pricing/onboarding* changes against
already-live traffic, a different kind of thing entirely, and reusing
the name would collide two unrelated concepts under one word).

```
DRAFT -> ANALYZED -> AWAITING_APPROVAL -> APPROVED -> RUNNING -> COMPLETED -> ANALYZED
                                        \-> REJECTED
                              (any of DRAFT..RUNNING) -> CANCELLED
                                          RUNNING -> FAILED
```

Fields: `productId`, `claimId` (Restrict FK — "which claim this tests,"
mirroring `OutreachExperiment.claimId` exactly), `hypothesis`,
`interventionDescription`, `controlDescription`, `targetMetricType`,
`successCriteria`, `failureCriteria`, `estimatedCostUsd`, `riskLevel`
(LOW/MEDIUM/HIGH, free classification for human review, not a Guardian
`RiskLevel`), `durationDays`, `status`.

**Experiment Analyst** (`src/services/experiment-analyst.service.ts`)
proposes `GrowthExperiment` drafts, prioritized by
`computeExpectedInformationGain` (§1 — reused, not reinvented) applied
to the lowest-confidence, highest-importance open Claim for that
product. "Turn uncertainty into controlled experiments" is literally
"find the Claim EIG ranks highest, propose an experiment that would
move it."

`GrowthExperimentResult`: `experimentId`, `baselineValue`,
`experimentValue`, `sampleSize`, `observedChangePct`, `confidence`
(`LOW_CONFIDENCE` literal status when `sampleSize < MIN_EXPERIMENT_SAMPLE`,
never a fabricated p-value — this codebase has no statistics library
and will not hand-roll significance testing; "the change was
observed, sample size N, treat accordingly" is the honest ceiling),
`limitations` (free text), `decision`. Completing an experiment writes
a new `Evidence`/`Claim` update (§20-21), which is what feeds the next
`recommendBusinessAction` cycle (§48's capstone).

## 27. Action recommendations

Covered fully in §22 (per-product) and §28 (portfolio). No third
action vocabulary exists anywhere in M8.

## 28. Portfolio allocation

**Portfolio Analyst** (`src/services/portfolio-analyst.service.ts`) —
a third agent-like role, distinct from CEO and Chairman (the brief
names it separately; it is not a sixth CEO axis). Runs across every
`LIVE`/`PAUSED` product, producing one `PortfolioSnapshot` row per
product per run (a comparison snapshot: revenue, growth rate,
retention, margin, evidence confidence, `killRiskScore`) and one
`PortfolioRecommendation` per product using **Constitution §19's own
literal vocabulary** — `SCALE`, `MAINTAIN`, `INVESTIGATE`, `PIVOT`,
`PAUSE`, `RETIRE` — the founder-ratified portfolio-decision axis,
predating this milestone's own spec. The brief's own suggested labels
(ALLOCATE_MORE_ATTENTION/ALLOCATE_MORE_ENGINEERING/
ALLOCATE_MORE_MARKETING/MAINTAIN/REDUCE_RESOURCES/PREPARE_KILL_REVIEW)
map onto it directly (documented in `docs/DECISIONS.md`, mirroring how
M7 §60 anchored every new permission to a literal Constitution
example) rather than existing as a second, competing enum:

| Brief's suggested label | Constitution §19 verb |
|---|---|
| ALLOCATE_MORE_ENGINEERING / ALLOCATE_MORE_MARKETING | `SCALE` |
| MAINTAIN | `MAINTAIN` |
| (uncertain signal, more data needed) | `INVESTIGATE` |
| (strategy needs to change, not just intensity) | `PIVOT` |
| REDUCE_RESOURCES | `PAUSE` |
| PREPARE_KILL_REVIEW | `RETIRE` |

Deterministic ranking (`rankPortfolio`, pure function): sorts by the
same `priorityScore` formula (§22), never a raw revenue sort. **No
autonomous execution**: a `RETIRE` or `PIVOT` recommendation for a
specific product is a *trigger* that calls
`ceoReasoningService.recommendBusinessAction` for that product — it
never bypasses the CEO → Chairman → Human pipeline directly, keeping
exactly one governance path (§39's own diagram names "CEO
RECOMMENDATION" as the step before Chairman; a portfolio-level
observation that skipped straight to Chairman would violate that
diagram). §49's capstone proves this ranking changes when the
underlying data changes — not a static fixture.

## 29. Data privacy

Covered fully in §38 (calibration/learning) is unrelated; privacy is
its own concern, detailed in §37 below (kept adjacent to security per
the brief's own numbering, cross-referenced here to avoid duplication).

## 30. Security

Full review in §37 (this document keeps the brief's own point numbers
as section anchors; content is placed once, cross-referenced from
each point the brief lists separately, to avoid three copies of the
same threat table drifting apart).

## 31. Provider abstractions

**`AnalyticsProvider` gains a read side** — the one genuine interface
change to an existing M7 port (everything else is purely additive):

```
interface AnalyticsProvider {
  readonly id: string;
  track(event: AnalyticsTrackInput): Promise<AnalyticsTrackResult>;   // unchanged
  query(input: AnalyticsQueryInput): Promise<AnalyticsQueryResult>;    // NEW — bounded, paginated, time-windowed
}
```

`AnalyticsQueryInput` requires `productId`, `eventName?`,
`periodStart`, `periodEnd`, `limit` (capped, default 500, hard max
2000 — §34's bounded-ingestion requirement enforced at the type level,
not just by convention), optional `cursor`. `DevAnalyticsProvider`
gains the matching in-memory filter/paginate implementation.
`query` is additive to the interface — every existing M7 caller of
`track()` is unaffected; this is not a breaking change.

**Three new ports**, all in-memory dev-fixture-only (extending, never
replacing, M7's established `Dev*Provider` + factory-singleton
pattern — §59 of the M7 proposal's own reasoning applies unchanged: a
real integration would mean a real credential and a real attack
surface neither justified nor required to prove the mechanism):

- `RevenueProvider` — `listSubscriptions(period)`,
  `listRefunds(period)`. Backed, in the dev fixture, by the same
  `BillingAccount`/subscription-fixture rows M7's `DevBillingProvider`
  already creates — not a second, disconnected fixture universe.
- `ProductUsageProvider` — `listEvents(query)` (signup, activation,
  feature-usage, session). Backed by `DevAnalyticsProvider`'s now-
  queryable event store (the same events `track()` already records).
- `CustomerDataProvider` — `listFeedback(productId)`,
  `listCancellationReasons(productId)`. Backed by `SupportCase`/
  `Incident` rows already in the M7 schema, plus a small dev-seeded
  feedback fixture.

Each factory is a module-level singleton (`*-provider-factory.ts`),
matching M7's five factories exactly.

## 32. Database — the minimum required tables

Reused, unchanged in shape: `Claim`, `ClaimEvidence`, `Evidence`,
`CeoRecommendation`, `ChairmanReview`, `ApprovalRequest`,
`BusinessMetric` (widened, §9), `Incident`, `SupportCase`.

New (nine tables, smaller than M7's twelve — most of the brief's own
candidate list turned out to already exist):

| Table | Purpose |
|---|---|
| `ActivationDefinition` | §4 — one product-specific activation event |
| `Cohort` | §6 — a dimension/value label, not a metric itself |
| `Anomaly` | §19 — deterministic detector output |
| `GrowthExperiment` | §26 — hypothesis through lifecycle |
| `GrowthExperimentResult` | §26 — observed outcome, honest confidence |
| `BusinessHealth` | §18 — multi-dimensional snapshot, explainable state |
| `PortfolioSnapshot` | §28 — one comparison row per product per run |
| `PredictionOutcome` | §38 — predicted vs. observed, Constitution §23 |
| `LearningRecord` | §38/41 — Constitution §22's pipeline, stored |
| `BusinessReviewMemo` | §23/25 — the human-decision artifact |

`PortfolioRecommendation` is **not** a separate table — it is three
columns (`recommendation`, `reasoning`, `citedMetricIds`) directly on
`PortfolioSnapshot`, matching §61's own M7 precedent (`LaunchPlan` has
no independent status column; don't add a table where a few columns
on an already-necessary row suffice).

Every new enum-like column gets a hand-added CHECK constraint in the
migration (unbroken discipline since `docs/DECISIONS.md` #37); every
widened existing column (`BusinessMetric.value_kind`,
`BusinessMetric.metric_type`, `Claim.claim_type`) gets a
RedefineTables block, mirroring M7's four exactly.

## 33. APIs

New route files, all authenticated (existing bearer-token middleware,
unchanged), all read-mostly: `business-metrics` (extended, already
exists), `cohorts`, `retention`, `churn`, `revenue-metrics`,
`cost-metrics`, `unit-economics`, `anomalies`, `growth-experiments`,
`growth-experiment-results`, `business-health`,
`portfolio-snapshots`, `business-review-memos`,
`prediction-outcomes`, `learning-records`. Product sub-routes gain
`POST /:id/analyze-business` (triggers
`businessIntelligenceService.analyze`) and `GET /:id/business-health`.
A new top-level `POST /portfolio/analyze` triggers
`portfolioService.analyzePortfolio()`.

## 34. Background processing

No scheduler is added — none exists anywhere in this codebase today
(confirmed by the `Incident` model's own comment: "never auto-created
silently in the background... no scheduler exists anywhere in this
codebase"), and M8 does not break that invariant. "Continuously
evaluate" (Constitution §19) is implemented as *cheap to re-trigger*,
not *automatically re-triggered* — a human or an API caller invokes
`analyze`/`analyzePortfolio` as often as they want; nothing invokes
itself. This matches M7's own orchestrator pattern exactly (no Cycle
wrapper), chosen over reviving the heavier M3/M4 `ResearchCycle`/
`DecisionCycle` machinery, which exists for *multi-step, tool-calling*
agent work — M8's agents are single-shot structured-output calls, the
same shape M7's agents already are, so M7's lighter pattern is the
correct precedent to follow, not M3/M4's.

## 35. Idempotency

Re-running `analyze({productId})` for the same product and period is
always safe: every write is a new, historized row (never an edit) —
identical discipline to every prior milestone's memo/claim/metric
tables. A second `BusinessMetric` row for the same
`(productId, metricType, periodStart, periodEnd)` is not an error; it
is a legitimate re-observation, and "latest by `recordedAt`" (§12)
always resolves which one is current. `GrowthExperiment` transitions
are guarded by `assertTransition` exactly like every other state
machine in this codebase — calling `approveToRun` twice on an already-
`RUNNING` experiment throws `InvalidTransitionError`, the same
double-action prevention `docs/DECISIONS.md` #64 fixed for M7's
`rollback`.

## 36. Failure handling

`businessIntelligenceService.analyze` and `portfolioService.analyzePortfolio`
both use the same `fail()`-on-incomplete-stage pattern as
`launchOperationsService.planLaunch`/`productFactoryService.build`:
any agent stage that doesn't complete stops the pipeline and records
why, without rolling back whatever earlier stages already
legitimately wrote (partial metrics computed before a later stage
failed remain valid, real observations — discarding them would itself
be a data-integrity bug). Provider failures (a `RevenueProvider` call
throwing) are caught at the metric-engine boundary and surfaced as a
`DATA_QUALITY` issue (§32 concept, folded into `Anomaly`'s reasoning
text via a `dataQualityFlag` field) rather than crashing the whole
analysis — one missing input degrades gracefully to
`INSUFFICIENT_DATA` for the metrics that depended on it, not a hard
failure of every metric.

## 37. Security — the full review

**Threats addressed, one by one** (mirroring `docs/SECURITY.md`'s
existing M1-M7 structure exactly; this becomes that file's M8
section, §189):

1. **Customer data exposure** — `CustomerDataProvider` returns
   aggregated/redacted feedback by default; raw PII never enters a
   model prompt (§38 privacy detail below).
2. **Financial data exposure** — `RevenueProvider` output is scoped
   by `productId`; no cross-product query exists at the repository
   layer (§37.10).
3. **Analytics poisoning** — a malicious `ProductUsageProvider` event
   (in a real integration) cannot retroactively change an already-
   written `BusinessMetric` row; metrics are computed once from a
   bounded window and stored, never live-recalculated from a mutable
   source at read time.
4. **Malicious customer input** — `CustomerDataProvider.listFeedback`
   text is passed to the Customer Intelligence Agent's prompt with the
   exact same "untrusted content, never an instruction" system-prompt
   discipline `support-agent.service.ts` (M7) already established,
   reused verbatim.
5. **Prompt injection** — same mitigation as #4; every M8 agent's
   system prompt explicitly labels provider-sourced text as data.
6. **Support-ticket injection** — `SupportCase`/`Incident` free-text
   fields feed Customer Intelligence the same way; same mitigation.
7. **Metric manipulation** — §24's own finding closes this: no M8
   agent holds `WRITE_DATABASE` in a way that lets it edit an
   *already-written* `BusinessMetric`/`Evidence`/`Claim` row — every
   write path is `create`, never `update`, on these tables (append-
   only, matching `ClaimEvidence`'s own existing "never erase
   contradicting evidence" discipline). An agent literally cannot
   rewrite its own inputs to flatter its own conclusion, because no
   code path exposes an update.
8. **Webhook spoofing** — no new webhook endpoint in M8; M7's existing
   HMAC-verified `billing-webhooks` route is unchanged and untouched.
9. **Provider compromise** — dev-fixture only (§31); not a real
   external dependency this milestone introduces.
10. **Cross-product data leakage** — every repository method here
    takes `productId` as a required, non-optional parameter (§37 data
    isolation below); no "list all metrics" endpoint without it.
11. **Tenant isolation** — VentureForge is single-tenant at the
    infrastructure level (one Postgres/SQLite instance); "tenant" here
    means *product*, enforced at the repository layer per #10, not
    assumed from a prompt.
12. **Credential exposure** — no new credential anywhere in M8 (dev-
    fixture providers hold none).
13. **PII exposure** — §38.
14. **Financial manipulation** — no execution capability exists in M8
    at all (§24); nothing to manipulate into moving money.
15. **CEO manipulation** — `recommendBusinessAction` only reads
    already-validated `Claim`/`BusinessMetric` rows with real
    provenance; a manipulated *input* (e.g. poisoned customer
    feedback, #4) is mitigated at the point it enters evidence, not
    trusted implicitly downstream.
16. **Chairman manipulation** — `reviewBusinessAction` independently
    re-queries the underlying rows (§23) rather than trusting the
    CEO's own citations at face value — the same "independently
    inspect the underlying evidence" discipline every prior Chairman
    method already has, verified by a real test (§187) that feeds
    Chairman a case where the CEO's summary and the underlying data
    disagree.
17. **Audit manipulation** — every M8 write flows through the same
    `AuditLog`/`Event` mechanism M1 already built; no M8 code path
    bypasses it.

**Data isolation** (brief's own separate §37, addressed here): every
M8 repository method's first parameter is `productId`; there is no
method anywhere in `src/db/repositories/*` this milestone adds that
can return rows for more than one product in a single call except
`portfolioSnapshotRepository.listLatestForAllLiveProducts()` — which
is the Portfolio Analyst's own explicit, single, named cross-product
read, not an accidental one. Enforced at the repository/service layer
per the brief's own instruction, never "the prompt says not to."

## 38. Privacy, calibration, learning, and backtesting

**Privacy** (brief §38): `CustomerDataProvider.listFeedback` returns
pre-aggregated counts and redacted excerpts by default
(`includeRawText` defaults `false`; a caller must opt in explicitly,
and even then individual customer identifiers are replaced with an
opaque `respondentRef`). The Customer Intelligence Agent's prompt
receives aggregates first, raw text only when a specific claim
genuinely needs a quote — mirroring the brief's own "the model rarely
needs raw customer PII."

**Calibration** extends `calibrationService` with a sixth method,
`summarizeBusinessDecisions()`, identical shape to the existing five
(`BusinessReviewMemo.confidence` vs. `humanDecision`). This is the
*decision-confidence* axis, unchanged mechanism.

**Prediction tracking / backtesting** is a **structurally new**
mechanism (Constitution §23 names it separately from calibration, and
correctly — it compares a *predicted metric value* to an *observed*
one, not a decision's confidence to a human's verdict): `PredictionOutcome`
(`metricType`, `productId`, `predictedValue`, `predictedAt`,
`targetPeriodStart/End`, `observedValue` nullable until the period
elapses, `errorPct` computed once both exist, `predictionSource` = the
agent/formula that made the prediction). `recordPredictionOutcome`
writes the prediction *before* the period elapses (Constitution §23:
"recorded before outcomes become known" — enforced by rejecting a
prediction whose `targetPeriodEnd` is already in the past).
`resolvePredictionOutcome` fills in `observedValue` once real data
exists for that period, never earlier (the concrete backtesting-
integrity rule: **no future-information leakage**, checked directly by
a test that attempts to resolve a prediction using data timestamped
after the prediction but asserts the resolution only reads data
`<= targetPeriodEnd`).

**Learning records** implement Constitution §22's pipeline exactly:
`LearningRecord` (`predictionOutcomeId?` or `decisionRecordId?/
businessReviewMemoId?` — one of these, `errorDescription`,
`rootCause`, `lesson`, `suggestedProcessChange?`). Written by a
deterministic comparison function
(`buildLearningRecord(predictionOutcome)`) when `Math.abs(errorPct) >
LEARNING_RECORD_THRESHOLD` (default 0.25) — never by an agent
free-associating a lesson. `suggestedProcessChange` is free text a
human reads; **nothing in this codebase ever applies it
automatically** — no code path exists that reads `LearningRecord` and
edits a system prompt, a permission, a risk level, or a formula
constant. That would require the existing governance process and
explicit human action, exactly as the brief's §41 demands, and this
milestone builds no such path at all (not "gated," *absent*).

**Backtesting** (`backtestingService.evaluate({productId, asOfDate})`):
re-runs `recommendBusinessAction`'s *pure* prioritization formula
(§22) against `BusinessMetric` rows filtered to `recordedAt <=
asOfDate`, and separately against the full current dataset, returning
both so a human can compare "what would the CEO have recommended with
what it knew then" against "what do we know now." The underlying LLM
reasoning call itself is not literally re-invoked historically (that
would require a real historical model snapshot this codebase has no
way to pin) — the deterministic scoring layer is what's backtested,
documented as this exact scope limitation rather than overclaimed.

## 39. Observability

No new logging infrastructure — `AuditLog`/`Event` (M1) already
capture every service-layer action. Observability here means the API
surface (§33) is sufficient to answer §53's own success-criterion
questions without a database console: `GET /products/:id/business-health`,
`GET /business-metrics/:id/provenance` (§10), and the demo (§50)
narrate the full SOURCE → ... → HUMAN DECISION chain on screen.

## 40. Alternatives considered

- **A single `MetricObservation` table separate from `BusinessMetric`** —
  rejected; would fork the "observed vs. estimated" enforcement across
  two tables with two CHECK constraints that could drift, for no
  benefit over widening the one table that already exists (§9).
- **A new Guardian permission for "read production business data"** —
  considered, then rejected once §24's audit established that every
  M8 read already flows through already-GREEN `READ_DATABASE`, and
  `ACCESS_PRODUCTION_DATA` (M7, ORANGE) already covers the one case
  that would matter (an agent reading a *live infra* system directly)
  — M8 agents never do that; they read VentureForge's own already-
  ingested `BusinessMetric` rows.
- **Real statistical significance testing for experiment results** —
  rejected for this milestone; no statistics dependency exists in
  `package.json` and adding one to hand-roll a t-test is exactly the
  kind of scope creep the brief's own "no fabricated statistical
  significance" instruction warns against. `LOW_CONFIDENCE` honesty
  beats a false-precision p-value from an under-tested implementation.
  Deferred (§42).
- **A unified "Intelligence Cycle" wrapper reusing `ResearchCycle`/
  `DecisionCycle`'s machinery** — rejected in favor of M7's simpler
  orchestrator-service pattern (§34); M8's agents don't need
  multi-step tool-calling budgets the way M3's Research Agent does.
- **Merging M7's `computeUnitEconomics` (pre-launch) with M8's new
  post-launch version** — rejected (§18); different questions, same
  merge risk the brief's Section 1 exists to prevent.

## 41. Risks

- **Metric-type sprawl**: `BUSINESS_METRIC_TYPES` grows from 6 to ~20.
  Mitigated by grouping in the domain file with clear section comments
  and a CHECK constraint that makes an invalid type a hard migration-
  level error, not a silent typo.
- **The Portfolio Analyst under-triggering real kill review**: if
  `rankPortfolio`'s formula never actually surfaces `RETIRE` for a
  genuinely failing product because one dimension compensates for
  another, a bad business could coast. Mitigated by the kill capstone
  (§47) using data deliberately shaped to force `RETIRE`, and by
  keeping `killRiskScore` (reused from M4, §1) as one explicit,
  separately-visible `PortfolioSnapshot` column, never buried only
  inside the composite score.
- **Backtesting scope-limitation being misread as "full historical
  replay"**: mitigated by the explicit documentation in §38 stating
  exactly what is and is not replayed.
- **Dev-fixture revenue/usage data being mistaken for real traction**:
  mitigated identically to M7 (§45 "No Fake Business") — every
  provider `id` is `DEV_FIXTURE`-prefixed, every demo section is
  loudly labeled, `valueKind`/`source` are structural columns, and the
  final report (§55) states plainly that no real customer, revenue, or
  traffic data exists anywhere in this codebase.

## 42. Deferred functionality — "What M8 Is Not," restated as scope

Per the brief's own §54, restated as concrete absences this milestone
does not build: no unlimited autonomous growth actions (every
`GrowthExperiment` requires human approval to run, §26); no autonomous
spending (§24's zero-new-permissions finding); no autonomous
advertising (`CHANGE_CHANNEL` is a recommendation only); no autonomous
pricing changes (`CHANGE_PRICING` routes through the exact same M7
`billingPlanService`/`ACTIVATE_BILLING` human-EXECUTE gate, unchanged,
never a new autonomous path); no autonomous production changes (§24);
no self-modifying agents (§38's explicit "no code path reads
`LearningRecord` and edits anything" finding); no unrestricted
customer-data access (§37/38's redaction-by-default); no autonomous
killing of businesses (`RETIRE`/`PREPARE_KILL_REVIEW`/`KILL` are all
recommendations that reach a `BusinessReviewMemo` and a human decision,
never an autonomous status change — M8 builds no code path that moves
a `Product` to a terminal/killed state without
`assertHumanActor`-gated, memo-recorded human input). Real
statistical-significance testing for experiments is deferred (§40).
A real `RevenueProvider`/`ProductUsageProvider` integration (Stripe
webhooks read side, a real analytics SDK) is deferred to whenever a
founder decision authorizes a real credential, exactly matching
`docs/DECISIONS.md` #59's own M7 reasoning, unchanged.
