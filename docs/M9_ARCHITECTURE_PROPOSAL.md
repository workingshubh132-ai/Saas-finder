# M9 — Company Control Plane & Operating System — Architecture Proposal

Phase 0 gate. Nothing in this document is implemented yet. Every fact
below about the current M1–M8 codebase was verified by reading the
actual source (`prisma/schema.prisma` in full — 68 models, 2526
lines — plus the actual service/domain files cited by path) during
this proposal's own audit, not recalled from memory. Every open
question the M9 brief poses is resolved to a specific decision below;
none is left "to be decided during implementation."

## 0. Mission, restated precisely

M1–M8 each built one *capability*: discover (M3), decide (M4), talk to
customers (M5), build (M6), launch (M7), measure and grow (M8). Each
capability already has its own bounded orchestrator, its own CEO/
Chairman entry point, its own human gate. **M9 adds no new capability.**
It adds the thing that was never built: a layer that can look across
all eight and answer three questions a founder actually asks — *what
is happening across all of this, what deserves my attention right now,
and what did we learn.* Concretely, M9 is:

1. **A bounded, resumable, company-level operating cycle** (never a
   background loop) that walks through PLANNING → RESEARCHING →
   ANALYZING → DECIDING → EXECUTING → OBSERVING → LEARNING once, on
   demand, and stops.
2. **A read layer** (Company State, Portfolio Control, Timeline,
   Founder Cockpit) that aggregates existing M1–M8 tables — it
   computes nothing that isn't already true, and stores nothing that
   already exists as a queryable fact elsewhere.
3. **A prioritization layer** (Founder Attention Score, the unified
   Human Decision Queue, the Weekend Briefing) that ranks what already
   exists — it never creates a decision that wouldn't otherwise exist.
4. **A governance-closing layer** (Approval Expiration, Change
   Detection, Concurrency Conflict Detection, Emergency Stop) that
   fixes three real gaps this audit found in the *existing* approval
   machinery (§37–40) — not new machinery, the missing teeth on the
   machinery M1 already built.
5. **A company-level CEO/Chairman axis** (the sixth `ceoReasoningService`
   entry point, the fifth `chairmanService` one) that asks "what
   should VentureForge do next, across everything" the same way the
   existing five axes each ask their own narrower version of that
   question — same pattern, same audit-verified reuse discipline
   (§31–34).

M9 introduces **zero new Guardian permissions** (§53, mirroring
`docs/DECISIONS.md` #65's own M8 finding) and **zero new state
machines** for anything that already has one (Product, ApprovalRequest,
GrowthExperiment, every memo type) — it reuses `CYCLE_STATUSES`
(`src/domain/shared/cycle-lifecycle.ts`), `PERMISSIONS`
(`src/domain/permission/permission.ts`), `DOMAIN_EVENT_TYPES`
(`src/domain/events/event.types.ts`), and every existing
Claim/Evidence/ApprovalRequest table exactly as built.

---

## Part A — The audit (M9 brief items 1–13, 40 points)

### 1. M1 audit

`Agent`/`AgentPermission`/`Task`/`ApprovalRequest`/`Evidence`/
`Opportunity`/`Memory`/`Event`/`AuditLog` — the foundation every later
milestone built on, unchanged since. Three facts this audit surfaced
that matter directly for M9:

- **`ApprovalRequest` already has `expiresAt` and an `EXPIRED` status**
  (`prisma/schema.prisma:169`, `src/domain/approval/approval.types.ts:9`,
  transition `PENDING → EXPIRED` at line 24). **No code path in M1–M8
  ever sets it or checks it.** `RequestApprovalParams.expiresAt`
  (`src/services/approval.service.ts:21`) is accepted and stored, and
  that's the entire extent of its use. This is the exact mechanism §26
  ("Approval Expiration") asks for — already half-built, never finished.
  M9 finishes it (§39).
- **`Memory`** (`prisma/schema.prisma:350`) is a generic
  `{type, subject, content, source, confidence}` table with zero
  write call anywhere in `src/services/*` — grep confirms it. It was
  scaffolded in M1 and never used again; every later milestone built
  its own typed table instead (`LearningRecord`, `DecisionRecord`,
  historized memo tables) rather than writing loosely-typed rows into
  `Memory`. M9 follows that precedent, not `Memory`'s (§26–27).
- **`AuditLog`/`Event` are both already company-wide, not per-milestone**
  — every service in every milestone writes to the same two tables.
  M9's Company Event Bus and Company Timeline (§42–43) are read layers
  over these two tables, not new ones.

### 2. M2 audit

Agent runtime (`agentRuntimeService`), Guardian (permission +
risk-level gate), Chairman (`chairmanService.review`), Identity/
`assertHumanActor`. The two load-bearing facts for M9:

- **`agentRuntimeService.callTool` throws immediately the moment a
  tool's permission resolves to `REQUIRES_APPROVAL`** — this has been
  true since M2 and is why M7 invented PLAN/APPROVE/EXECUTE
  (`docs/DECISIONS.md` #58) instead of a suspend-and-resume runtime.
  M9's operating cycle inherits the same constraint: a cycle can never
  suspend *inside* an agent execution waiting for a human — it can
  only stop *between* stages (§15) and resume by starting a fresh,
  bounded stage.
- **`assertHumanActor` is the only mechanism in this codebase that
  gates a human-only action** — never a Guardian permission grant.
  Every EXECUTE step since M7 uses it (`docs/DECISIONS.md` #58); M9's
  Emergency Stop and every operating-cycle human decision reuse it
  verbatim (§46, §57).

### 3. M3 audit

`Signal`/`SignalCluster`/`Problem`/`Competitor`/`EvidenceGap`/
`ResearchCycle`/`ResearchQueueItem`. The key structural fact:
`ResearchCycle` is the *first* bounded, budgeted orchestration
boundary (`prisma/schema.prisma:810`), and its status column already
draws from a **shared** lifecycle module,
`src/domain/shared/cycle-lifecycle.ts` — `CYCLE_STATUSES =
[SCHEDULED, RUNNING, PAUSED, STOPPED, AWAITING_HUMAN, COMPLETED,
FAILED, CANCELLED]`, whose own doc comment states it was "factored out
once a *second* cycle type needed the identical shape rather than
forked." M9's `OperatingCycle` becomes the **third** consumer of this
exact module — see §15.

**A second real finding**: `CYCLE_STATUS_TRANSITIONS` (line 31 of that
file) defines `RUNNING → PAUSED → RUNNING/STOPPED/CANCELLED` as a
legal transition — but grep across `research-cycle.service.ts` and
`decision-cycle.service.ts` finds **zero** references to `PAUSED`,
`pause`, or `resume` in either file. The `PAUSED` state has existed in
the shared lifecycle since M3 and has never once been exercised by
either cycle type that uses it. M9's operating cycle is the first
cycle type to actually implement `pause`/`resume` (§17, §57) — closing
a four-milestone-old gap in already-declared infrastructure, not
inventing new infrastructure.

### 4. M4 audit

`Claim`/`ClaimEvidence`/`ValidationReport`/`CeoRecommendation`/
`InvestmentMemo`/`DecisionRecord`/`DecisionCycle`. `DecisionCycle` is
the second `cycle-lifecycle.ts` consumer (confirming §3's finding).
`DecisionRecord` (`prisma/schema.prisma:1080`) already stores exactly
the shape M9's brief calls "Decision Memory" (§15) for one specific
decision type — opportunity-kill: `opportunityScoreAtDecision`,
`confidenceAtDecision`, `killRiskAtDecision`, `rejectedClaimIds`,
`acceptedClaimIds`, `missingEvidenceNoted`. It has no `actualOutcome`/
`lesson` field, and it exists for exactly one of what are now **five**
structurally near-identical "CEO recommends → Chairman reviews → human
decides" flows (§11 below). CEO's first entry point,
`ceoReasoningService.run` (`src/services/ceo-reasoning.service.ts:677`),
is the pattern every later axis (§9) copies.

### 5. M5 audit

`IcpProfile`/`Prospect`/`OutreachExperiment`/`OutreachMessage`/
`CustomerResponse`/`CustomerEvidence`/`CustomerDiscoveryMemo`. Two
facts:

- **M5 introduced the CEO's second entry point,
  `recommendCustomerDiscoveryAction`** (line 787) — but **did not**
  introduce a second Chairman entry point. `chairmanService` has only
  four methods total (`review`, `reviewProduct`, `reviewLaunch`,
  `reviewBusinessAction` — confirmed by grep against the full file);
  M5's CEO output is reviewed by the base `review()` method. CEO and
  Chairman are **not** symmetric across axes today — a real, working
  asymmetry, not a bug (customer-discovery is still fundamentally an
  opportunity-continuation question). M9 does not "fix" this; it notes
  it because M9 is about to add a sixth CEO axis and must decide
  whether the matching Chairman axis is new or reused (§33: it's new,
  because company-level prioritization is not a natural fit for any
  existing Chairman method's own evidence scope).
- `OutreachExperiment`/`OutreachMessage` is the *first* place this
  codebase built a PLAN → human-APPROVE flow for something with a real
  (if manual/fixture) external effect, pre-dating M7's PLAN/APPROVE/
  EXECUTE by two milestones. `ApprovalRequest.resourceType =
  "OUTREACH_MESSAGE"` is exactly the pattern M9's Human Decision Queue
  reads uniformly across five resource types (§19).

### 6. M6 audit

`Product`/`ProductSpec`/`Feature`/`MvpArchitecture`/`EngineeringTask`/
`CodeReview`/`QaReport`/`SecurityReview`/`ProductReviewMemo`. `Product`
is the single entity every later milestone (M7, M8) hangs its own
tables off of via a plain `productId` FK — never a second product-like
concept. This is the strongest possible precedent for M9's Portfolio
Control (§22): read `Product` and its already-attached M7/M8 rows,
create nothing new that represents "a product."

### 7. M7 audit

`LaunchPlan`/`DeploymentPlan`/`Deployment`/`PricingModel`/
`BillingPlan`/`BillingAccount`/`WebhookDelivery`/`GoToMarketPlan`/
`BusinessMetric`/`Incident`/`SupportCase`/`LaunchReviewMemo`. This is
where PLAN/APPROVE/EXECUTE (`docs/DECISIONS.md` #58) and
`BusinessMetric.valueKind` (OBSERVED/ESTIMATED, later widened by M8)
were introduced. **Confirmed, repeatedly, in both `LAUNCH_OPERATIONS.md`
and `docs/SECURITY.md`: "no scheduler/cron infrastructure exists
anywhere in this codebase."** This remains true after this audit — M9
does not change it (§17: a scheduler that requires an explicit call to
advance, never a background timer).

### 8. M8 audit

`ActivationDefinition`/`Cohort`/`Anomaly`/`GrowthExperiment`/
`GrowthExperimentResult`/`BusinessHealth`/`PortfolioSnapshot`/
`PredictionOutcome`/`LearningRecord`/`BusinessReviewMemo`. Three
findings, one of them a real, previously-unnoticed bug:

- **`LearningRecord`** (`prisma/schema.prisma:2473`) already stores
  exactly the M9 brief's own §18 "Learning System" shape:
  `errorDescription → rootCause → lesson → suggestedProcessChange`,
  with the same non-negotiable already enforced by its own doc
  comment — "no code path in this codebase ever reads a LearningRecord
  and edits a system prompt, permission, risk level, or formula
  constant." **M9 reuses this table directly** (§30) rather than
  building a second one; the M9 brief's own §18 root-cause list (bad
  evidence, insufficient evidence, bad assumption, bad model
  reasoning, wrong market, execution failure, external shock,
  measurement error) becomes a new, documented enum constraining
  `rootCause`'s free-text values, additive to the existing column.
- **`PredictionOutcome`** (`prisma/schema.prisma:2434`) already stores
  exactly the M9 brief's own §16 "Prediction → Outcome Loop" shape:
  `predictedValue`, `predictedAt`, `targetPeriodStart/End`,
  `observedValue`/`errorPct` (both null until resolution),
  `predictionSource`, with resolution already guarded against
  future-information leakage. **M9 reuses this table directly** (§28)
  — it is currently `productId`-scoped only; M9 adds a read-layer
  aggregation across products, never a second table.
- **A real bug, found by this audit**: `businessReviewMemoService.compile`
  (`src/services/business-review-memo.service.ts:79`) fires
  `eventBus.publish({ type: "LAUNCH_REVIEW_MEMO_CREATED", ... })` —
  the **wrong** M7 event type, copy-pasted from
  `launch-review-memo.service.ts:88` without updating the literal
  string. Compounding this, `DOMAIN_EVENT_TYPES`
  (`src/domain/events/event.types.ts`) was **never extended for M8 at
  all** — it ends at M7's own seven additions; there is no
  `BUSINESS_REVIEW_MEMO_CREATED`, `GROWTH_EXPERIMENT_COMPLETED`,
  `ANOMALY_DETECTED`, or `PORTFOLIO_ANALYZED` event anywhere in the
  system. Every M8 capability that should be visible on a company
  timeline currently is not. **M9 fixes the mislabel and adds the
  missing M8+M9 event types in the same migration** (§42) — this is
  the single most concrete "data-flow gap" this audit found and is
  fixed as part of M9, not merely documented.

### 9. Integration gaps

1. **No cross-milestone read layer exists.** Every "what's the state
   of X" question today requires querying the right one of eight
   milestones' own tables by hand. There is no single place that
   answers "what exists, what needs attention, what's waiting" (the
   brief's own framing, §1) — Company State (§21) and the Founder
   Cockpit (§44) close this.
2. **The event stream is incomplete** (§8 above) — closed as part of
   this milestone, not deferred.
3. **`ApprovalRequest.expiresAt`/`EXPIRED` is declared, unused** (§1
   above) — closed as part of this milestone (§39).
4. **`PAUSED` is declared, unused** (§3 above) — closed as part of
   this milestone (§17, §57).
5. **No cross-product query exists for "all pending decisions"** — a
   founder today must separately check `GET /api/approvals?status=PENDING`
   *and* five different "list undecided memos" endpoints. Closed by
   the Human Decision Queue (§19).

### 10. Duplicated functionality

**The real finding, stated precisely**: `InvestmentMemo` (M4),
`CustomerDiscoveryMemo` (M5), `ProductReviewMemo` (M6),
`LaunchReviewMemo` (M7), and `BusinessReviewMemo` (M8) are five
separate Prisma models with a **structurally identical shape** —
`ceoRecommendationId`, `chairmanReviewId`, `content` (JSON), a free
`recommendation` string, `confidence`, and (for the last four)
`humanDecision`/`humanReason`/`decidedAt`/`decidedByIdentityId`, each
starting `null` and filled in by exactly one later human action. This
is not an oversight — each milestone's own audit before it (M5 §22,
M6 §34, M7 §31, M8 §25) explicitly chose a **new, milestone-specific
table over a shared one**, because each memo's actual field list
differs (`InvestmentMemo.strongestArgumentAgainst`/`investmentThesis`
are opportunity-specific; `CustomerDiscoveryMemo.claimsStrengthened`/
`claimsWeakened`/`independentOrganizationCount` are experiment-specific;
etc.) and a shared table would need five sets of nullable columns.
**M9 does not unify these tables** — doing so would mean an invasive,
purely-cosmetic migration across four already-shipped, already-tested
milestones for zero new capability. Instead, M9 adds one **read-only
service function**, `decisionQueueService.listUndecidedMemos()`
(§19), that queries all five tables with `humanDecision IS NULL`,
returning a common `DecisionQueueEntry` shape the caller normalizes to
— the duplication lives in five *tables* (each independently correct)
but not in the *code that reads across them* (one function, one
place). This is the same reasoning `docs/DECISIONS.md` #67 already
used for M8's own claim-type reuse mapping: reuse where the underlying
concept is genuinely the same, add new only where it genuinely isn't.

**A second, smaller finding**: `Product.deploymentPlan`/
`Product.rollbackPlan` (`prisma/schema.prisma:1512-1513`, JSON string
columns, M6) versus the real `DeploymentPlan` table (M7). The M6
columns are a **pre-M7 planning artifact** (produced once `HUMAN_REVIEW`
is reached, per the model's own doc comment, "never executed by any
code path in this milestone" — M6's own words) that M7's real
`DeploymentPlan` table superseded. Confirmed via grep: no M7/M8/M9
code path reads `Product.deploymentPlan`. This is dead-but-harmless
data left over from M6, out of scope to remove in M9 (removing a
column is a real migration risk for zero behavior change) but named
here so a future milestone doesn't rediscover it as a mystery.

### 11. Data-flow gaps

1. The event-type gap (§8, §9.2) — fixed in this milestone.
2. **No metric exists for "how much of the founder's attention did
   VentureForge consume this week"** — the brief's own central
   concept (§5–6) genuinely has no existing analog anywhere in M1–M8.
   Wholly new in M9 (§18).
3. **No cross-product resource-contention signal exists** — two
   products can each independently request engineering/research
   capacity with no shared view of total demand. Wholly new in M9
   (§23).
4. **Prediction resolution has no automatic trigger** — `PredictionOutcome`
   rows sit unresolved forever unless something explicitly calls
   `predictionOutcomeService.resolve` (M8) for a specific outcome id.
   No scheduler exists to do this in bulk (§7's own confirmed fact).
   M9's operating cycle's OBSERVING stage is the first thing that
   calls "resolve every prediction outcome whose `targetPeriodEnd` has
   now elapsed" as a matter of course (§28) — closing this gap without
   introducing a background job.

### 12. Governance gaps

1. **Stale-approval execution is possible today.** `deploymentService.execute`
   re-verifies `approvalRequest.resourceId === plan.id` (exact-resource
   binding, `docs/DECISIONS.md` #58) but never checks whether the
   `DeploymentPlan` itself changed *after* the approval was granted, or
   whether the approval's own `expiresAt` has passed (§1, §9.3). This
   is a real, exploitable gap across **every** M7/M8 EXECUTE step
   (`deploymentService.execute`, `billingActivationService.activate`,
   `growthExperimentExecutionService.approveToRun`) — closed by §39,
   applied to all three call sites.
2. **No concurrency check exists anywhere in this codebase.** Two
   `CeoRecommendation`s for the same opportunity/product with opposite
   actions can both be created and both separately approved by two
   different human reviewers with no code path ever comparing them.
   Wholly new in M9 (§40).
3. **No conflict-resolution rule exists for CEO vs. Chairman
   disagreement stronger than "the memo records both opinions and a
   human reads them."** Today, a human who approves a memo without
   reading the Chairman's `decision` field can approve a CEO
   recommendation the Chairman explicitly rejected — nothing stops the
   API call. M9's company-level axis makes this rule structural, not
   presentational (§34), and — per the brief's own explicit instruction
   — deliberately does **not** retrofit it onto the five *existing*
   milestone-specific memo flows, which keep their current (working,
   already-capstone-tested) behavior unchanged.

### 13. Scheduling architecture, operating-cycle architecture

Covered together in the design (§15–17) since they are one mechanism
in this codebase, not two — see below.

---

## Part B — Design

### 14. The Company Control Plane

A control plane is a **coordinator**, never an **executor** — the
brief's own words, and the same boundary every milestone before it
already drew (M7's launch orchestrator plans, never deploys; M8's
business-intelligence orchestrator recommends, never spends). Concretely:
`controlPlaneService` (`src/services/control-plane.service.ts`) is a
**read+coordinate** service with exactly three kinds of methods:

- **Status reads** (`getStatus()`, `getCompanyState()`, `getTimeline()`)
  — pure aggregation over existing tables, zero writes.
- **Cycle coordination** (`startCycle`, `advanceCycle`, `pauseCycle`,
  `resumeCycle`, `cancelCycle`) — creates/advances an `OperatingCycle`
  row and calls the **existing, unmodified** orchestrators for each
  stage (§15) — it never itself calls a provider, never itself
  executes a growth experiment, never itself decides anything.
- **Emergency stop** (`activateEmergencyStop`, `resumeFromEmergencyStop`)
  — a company-wide flag checked by every cycle-advancing call (§46, §57).

It holds no new Guardian permission (§53) because it never performs an
action a Guardian permission would gate — every actual consequential
step it triggers still goes through the same PLAN/APPROVE/EXECUTE or
CEO/Chairman/human chain that step already required before M9 existed.

### 15. Company Operating Cycle — the state machine

Two fields, not one, reusing §3's finding directly:

- **`OperatingCycle.status`** — the **exact, unmodified**
  `CYCLE_STATUSES`/`CYCLE_STATUS_TRANSITIONS` from
  `src/domain/shared/cycle-lifecycle.ts` (`SCHEDULED`, `RUNNING`,
  `PAUSED`, `STOPPED`, `AWAITING_HUMAN`, `COMPLETED`, `FAILED`,
  `CANCELLED`). `OperatingCycle` becomes this module's **third**
  consumer, exactly matching its own doc comment's stated purpose.
  Zero new domain code for this half of the lifecycle.
- **`OperatingCycle.stage`** — a **new**, strictly-ordered progression,
  because "which phase of company-level work is happening" is a
  question `CYCLE_STATUSES` was never designed to answer (M3/M4's own
  `RUNNING` never distinguished "collecting signals" from "clustering
  them"). `CYCLE_STAGES = [CREATED, PLANNING, RESEARCHING, ANALYZING,
  DECIDING, AWAITING_HUMAN, EXECUTING, OBSERVING, LEARNING, COMPLETED]`
  — the brief's own literal §2 list. `CYCLE_STAGE_TRANSITIONS` is
  **linear-only** (`CREATED → PLANNING`, `PLANNING → RESEARCHING`, …,
  `LEARNING → COMPLETED`), with exactly one branch: any stage may move
  to `AWAITING_HUMAN` (a human decision is needed before this specific
  stage can complete) and `AWAITING_HUMAN` returns to the stage that
  requested it once decided — mirroring `CYCLE_STATUS_TRANSITIONS`'s
  own `AWAITING_HUMAN: [SCHEDULED, RUNNING, CANCELLED]` shape at the
  coarser level.
- A cycle whose `status` is `PAUSED`/`STOPPED`/`FAILED` retains its
  `stage` unchanged — resuming re-enters exactly that stage, never
  restarts from `CREATED`. This is what "bounded and resumable"
  concretely means (brief §2's own explicit instruction): resumability
  is a property of `stage` being preserved, not of any in-memory loop
  state, because **there is no in-memory loop** — see §17.
- Every stage transition is recorded as a `CycleStageEvent` row
  (`{cycleId, stage, enteredAt, completedAt, summary}` — the brief's
  own suggested `cycle_stages` table, §43) — this is what makes
  Observability (§56) and the Company Timeline (§43) able to show
  "current cycle, current stage" without inferring it from log lines.

### 16. Weekend-first operating model

Built as a **default cadence for `startCycle`'s own scheduling
metadata, not a hardcoded day-of-week check anywhere in application
logic** — the brief's own instruction not to assume continuous human
availability means the mechanism must work identically whether a human
reviews Saturday, Tuesday, or once a month. Concretely: `OperatingCycle`
has no field named `weekend`; instead, `startCycle` accepts an
`objective` and a `scope`, and stops **as a matter of course** at the
first `AWAITING_HUMAN` stage transition (typically after DECIDING,
where the Human Decision Queue is populated) rather than proceeding to
EXECUTING — so a human can be entirely absent for days between when a
cycle reaches `AWAITING_HUMAN` and when they next open the Founder
Cockpit, with zero decay: the queue is exactly as valid a week later as
an hour later (subject only to §39's own staleness rules). The
"weekend capstone" (§66) demonstrates this literally — Friday
observation, Saturday briefing/approval, Sunday execution, weekday
observation, next Saturday's briefing including outcomes — using
`send_later`-style explicit calls between stages, never a running
process.

### 17. Scheduler

**Not a cron daemon.** Confirmed no scheduler infrastructure exists
anywhere in this codebase (§7) and this remains true — `schedulerService`
(`src/services/scheduler.service.ts`) is a set of **bounded, explicitly-
invoked functions**, each one advancing exactly one `OperatingCycle` by
exactly one stage, then returning. "Scheduled" describes the *cycle's
own metadata* (an `objective`/`scope`/`budget`/`risk`/`deadline`/`owner`
row, per brief §4 verbatim), never a background process that decides
when to run it — something external (a human clicking "run weekend
cycle," a CI cron calling the API, this session's own `ScheduleWakeup`-
style mechanism in a *deployment* of this system) must call
`POST /api/operating-cycles` or `POST /api/operating-cycles/:id/resume`
to make anything happen. This mirrors `research-cycle.service.ts`/
`decision-cycle.service.ts` exactly — both already require an explicit
API call to start, and neither has ever run unattended. `schedulerService`
supports every category the brief names (§4): scheduled (has a
`scheduledFor` timestamp, not yet started), manual (`scheduledFor` null,
started immediately), resumed (`resumeCycle` re-enters a `PAUSED` cycle
at its preserved `stage`), retryable (a `FAILED` cycle's `retryCycle`
creates a fresh cycle referencing the failed one via `retriedFromCycleId`,
never mutates the failed row — matching `Deployment.rolledBackFromId`'s
own append-only-retry precedent, M7), cancelled (`cancelCycle`, human-
actor-gated).

### 18. Attention budget & Founder Attention Score

**Wholly new** (§11.2 — no existing analog). A `FounderAttentionItem`
row is created for every entry the Human Decision Queue (§19) surfaces,
scored by `computeFounderAttentionScore()`
(`src/domain/attention/attention-score.ts`) — a **documented, weighted
sum over stored factors**, never an opaque single number:

```
score = w1·financialImpact + w2·urgency + w3·risk + w4·uncertainty
      + w5·(1 - reversibility) + w6·opportunityCost + w7·evidenceQuality
      + w8·strategicImportance + w9·deadlineProximity
```

Every factor is `0..1`, computed from **already-real data**, never
invented:

| Factor | Derived from |
|---|---|
| `financialImpact` | `BusinessMetric` MRR delta / `PortfolioSnapshot.revenueUsd`, normalized against the portfolio's own current revenue range — `UNKNOWN` (→ 0, documented, never guessed) when no financial data exists yet for the underlying resource |
| `urgency` | Approval `expiresAt` proximity (§39) or `Incident.severity` |
| `risk` | The underlying `ApprovalRequest.riskLevel` (RED=1, ORANGE≈0.66, YELLOW≈0.33, GREEN=0) or `KillIntelligenceResult.combinedKillRiskScore` (M8, reused directly) |
| `uncertainty` | `1 - evidenceConfidence`/`confidence` already on the underlying `BusinessHealth`/`Claim`/memo row |
| `reversibility` | A small, documented lookup by resource type (a `GrowthExperiment` is HIGH reversibility; `ACTIVATE_BILLING`/`PREPARE_KILL_REVIEW` are LOW) — mirrors the Decision Card's own explicit reversibility field (§20) |
| `opportunityCost` | `computeBusinessActionPriorityScore`/`computeDecisionPriorityScore` (M4/M8, reused, never reimplemented) where the underlying resource already has one |
| `evidenceQuality` | Count of independent evidence/claim rows backing the underlying resource |
| `strategicImportance` | `Claim.importance` (CRITICAL/HIGH/MEDIUM/LOW, reused) where applicable, else a documented default |
| `deadlineProximity` | Days until any stored deadline, 0 if none |

Every factor **and** the underlying resource ids are stored on
`FounderAttentionItem`, not just the final score — the brief's own
explicit "do not reduce everything to a single unexplained magic
number… store the underlying factors" (§6). Weights (`w1..w9`) are a
documented, founder-revisable constant object, the same pattern
`HEALTH_WEIGHTS`/`BUSINESS_ACTION_PRIORITY_WEIGHTS` (M8) already
established — never hidden inside a model prompt.

### 19. Human Decision Queue

**Reuses, aggregates, creates nothing new that decides.**
`decisionQueueService.listPending()` unions exactly two real sources,
already established in §9–10:

1. `approvalRepository.listQueue()` filtered to `status = "PENDING"`
   (or `"DEFERRED"`) — covers deployment/billing/growth-experiment/
   outreach-message approvals, the brief's own §7 list items that
   already flow through `ApprovalRequest`.
2. `decisionQueueService.listUndecidedMemos()` (§10) — the five memo
   tables with `humanDecision IS NULL`, covering opportunity-investment/
   customer-discovery/product-build/launch/business-action decisions.

Each entry is normalized to one `DecisionQueueEntry` interface
(`resourceType`, `resourceId`, `summary`, `riskLevel`, `createdAt`,
`expiresAt`) before scoring (§18) — **the union happens in application
code, at read time; no new table stores a duplicate of either source.**
This is the single, unified founder queue the brief asks for (§7),
built by federation, not by a second approval system.

### 20. Decision Card

A pure **presentation** shape — `buildDecisionCard(entry)` — computed
on demand from a `DecisionQueueEntry`, never persisted (persisting it
would be a third copy of data already in `ApprovalRequest`/a memo
table). Every field in the brief's own §8 mockup maps to a real,
already-computed source:

| Card field | Source |
|---|---|
| `WHY` | The underlying `CeoRecommendation.reasoning` / `ApprovalRequest.description` |
| `KEY RISK` | The Chairman's own top objection (`ChairmanReview.objections[0]`, mirroring `InvestmentMemo.strongestArgumentAgainst`'s own precedent) |
| `EVIDENCE` | `citedClaimIds.length` / independent-source counts already on the underlying row |
| `RECOMMENDED ACTION` | The CEO's own `action` |
| `REVERSIBILITY` | The same lookup §18 uses |
| every number | Links to the real row id it came from — `provenance: {claimIds, evidenceIds, metricIds}` — never a bare figure |

`[APPROVE] [REJECT] [REVIEW]` map to the **existing** `approvalService.decide`/
memo `recordHumanDecision` calls for whichever underlying resource the
card wraps — the Decision Card is a view, not a new decision-recording
path.

### 21. Company State

`companyStateService.getState()` — a single read aggregating, per the
brief's own §9 dimension list, **only what is already computable**:

| Dimension | Computed from | If not computable |
|---|---|---|
| Cash position | *(no real payment processor exists anywhere in this codebase, M7 §59)* | `UNKNOWN` — always, structurally, never estimated |
| Revenue | `SUM(BusinessMetric WHERE metricType='MRR', valueKind='OBSERVED')` across all LIVE products | `UNKNOWN` if zero LIVE products |
| Growth | `AVG(BusinessHealth.growthHealth)` across LIVE products | `UNKNOWN` if none |
| Portfolio size | `COUNT(Product WHERE status IN (LIVE, PAUSED))` | `0`, a real count, never unknown |
| Portfolio health | `AVG(BusinessHealth.compositeScore)`, reused from M8 directly | `UNKNOWN` |
| Customer health | `AVG(BusinessHealth.customerHealth)` | `UNKNOWN` |
| Operational health | `AVG(BusinessHealth.operationalHealth)` | `UNKNOWN` |
| Risk | `AVG(KillIntelligenceResult.combinedKillRiskScore)` across live products, reused from M8 | `UNKNOWN` |
| Evidence quality | `AVG(BusinessHealth.evidenceConfidence)` | `UNKNOWN` |
| Decision backlog | `COUNT` from the Human Decision Queue (§19) | `0` |
| Execution backlog | `COUNT(OperatingCycle WHERE stage='EXECUTING')` | `0` |

**"Unknown must remain unknown"** (brief §9's own words) is enforced
the identical way M8 enforced it: every field is a `MetricResult`-
shaped value (`src/domain/shared/metric-result.ts`, reused directly,
not reimplemented) — `{status: "COMPUTED", value}` or
`{status: "UNKNOWN"}` — so a caller (API response, briefing generator)
is structurally required to handle the unknown case, never free to
default it to `0` or omit it silently.

### 22. Portfolio Control

**No new scoring system** — the brief's own explicit instruction
(§10: "do not build another portfolio-scoring system unless M8's
architecture genuinely cannot support the requirement") is satisfied
because it can: `portfolioControlService.overview()` reads
`portfolioSnapshotRepository`/`businessHealthRepository`/
`killIntelligenceService` — the **exact same three M8 reads**
`portfolioAnalystService.run` already performs
(`src/services/portfolio-analyst.service.ts`) — and groups the result
into the six WINNERS/PROMISING/UNCERTAIN/STAGNATING/DECLINING/KILL-
CANDIDATES buckets by a **direct, documented mapping** from
`BusinessHealth.state` (HEALTHY→WINNERS, PROMISING→PROMISING,
EARLY/UNKNOWN→UNCERTAIN, STAGNATING→STAGNATING, DECLINING→DECLINING,
CRITICAL→KILL CANDIDATES) — the identical mapping
`buildDevPortfolioAnalystFixture` (M8) already encodes for its own
Constitution §19 recommendation, reused as a pure function
(`mapBusinessHealthToPortfolioBucket`) rather than duplicated. This is
a read, not a new analysis pass — it does not call the Portfolio
Analyst agent, does not create a new `PortfolioSnapshot` row, and adds
zero model calls.

### 23. Resource allocation

**Wholly new** (§11.2). `ResourceAllocation` rows model exactly the
five categories the brief names — `engineering`, `marketing`,
`research`, `agentExecution`, `founderAttention` — each scoped to a
`period` (a week, matching the weekend cadence) and a `productId`
(nullable — company-wide categories like `founderAttention` have none).
`allocated`/`consumed` are both plain floats in an abstract "unit"
whose meaning is documented per category (e.g. `agentExecution` units
= `AgentExecution` row count; `founderAttention` units = sum of
`FounderAttentionScore` items actually reviewed that period) — **never
a currency amount**, because (§9's own table) no real financial data
exists in this system to allocate. "Actual financial allocation
remains behind existing human-controlled execution" (brief §11's own
closing line) is enforced structurally: `ResourceAllocation` has no
write path that touches `BusinessMetric`, `BillingAccount`, or any
EXECUTE step — it is a read+report table only, informing the CEO's
company-level reasoning (§31) and the briefing (§46), never gating or
triggering anything by itself.

### 24. Opportunity pipeline (unified view)

`companyStateService.getOpportunityPipeline()` — a pure read grouping
every `Opportunity` by its current true position, derived (never
stored twice) from existing columns: `SOURCE→SIGNAL` (`Signal.status`),
`CLUSTER` (`SignalCluster.status`), `PROBLEM` (`Problem.status`),
`OPPORTUNITY` (`Opportunity.status`/`validationLevel`), `VALIDATION`
(latest `ValidationReport`/`CustomerDiscoveryMemo`), `DECISION`
(latest `CeoRecommendation.action` + memo `humanDecision`), `PRODUCT`
(`Product.status` if one exists for this opportunity). No new column,
no new table — the brief's own instruction that "the Control Plane
should be able to see where every opportunity currently sits" (§12) is
answered by a join, not a new state field duplicating seven already-
authoritative ones.

### 25. Product pipeline (unified view)

Symmetric to §24: `companyStateService.getProductPipeline()` reads
`Product.status` directly (already the single authoritative field
spanning OPPORTUNITY→CUSTOMER DISCOVERY→APPROVED→FACTORY→QA→SECURITY→
LAUNCH→LIVE→the M8 measure/grow loop — confirmed as one continuous,
unbroken status enum across M6 and M7's own extension of it, per
`docs/LAUNCH_OPERATIONS.md`'s lifecycle diagram) plus the latest
`BusinessHealth`/`PortfolioSnapshot` for MEASURE/GROW. **Does not
duplicate the M6/M7 state machine** (brief §13's own explicit
instruction) — it is read-only against `Product.status`, never a
second status field.

### 26. Company memory

The brief's own distinction — "not merely logs" — is real, and this
audit found the codebase already agrees: `AuditLog`/`Event` (§1) are
the logs; `LearningRecord` (§8) is already the *reflective* memory
("what we learned"). M9 adds one more piece: **`CompanyMemoryService`**,
a thin read-composition over `LearningRecord` + the relevant memo's
own `content` JSON (which already stores "what we believed / what
evidence supported it," per every memo's own compiled structure since
M4) — producing the brief's own six-part shape (belief, reasoning,
evidence, decision, outcome, lesson) as a **view**, not a seventh
table. `Memory` (§1's finding — declared, unused since M1) is
formally deprecated by this proposal: M9 does not write to it, and a
DECISIONS.md entry (§67) records why, so a future milestone doesn't
resurrect a table this build deliberately bypassed.

### 27. Decision memory

Builds directly on §10 and §26: `decisionMemoryService.getHistory(resourceType, resourceId)`
composes, per decision, the brief's own §15 list —
`decision`/`alternatives`/`evidence`/`CEO reasoning`/`Chairman
objections`/`Human decision`/`expected outcome` from the relevant
existing memo + `CeoRecommendation` + `ChairmanReview` rows, and
`actual outcome`/`lesson` from a **new**, thin `DecisionOutcome` table
(`{decisionType, decisionResourceId, expectedMetricType,
expectedValue, actualValue, evaluatedAt, learningRecordId}`) —
genuinely new because nothing in M1–M8 currently records "what we
expected to happen" against "what actually happened" at the
*decision* level (as opposed to `PredictionOutcome`'s own narrower
*metric*-level tracking, §28, which this reuses as `DecisionOutcome`'s
own evidentiary backing where the decision was metric-shaped, e.g. an
INVEST recommendation). This is what answers "have we made this
mistake before?" (brief §15's own question) —
`decisionMemoryService.findSimilarPastDecisions(claimType, action)`
queries `DecisionOutcome` joined to its `LearningRecord` for the same
`decisionType`/`action` pairing.

### 28. Prediction → outcome loop

**Reused directly, not rebuilt.** `PredictionOutcome` (M8, §8's
finding) already has every field the brief's own §16 example needs.
M9 adds exactly one thing: `predictionOutcomeService.resolveAllDue()`,
called from the operating cycle's OBSERVING stage (§15, closing §11.4's
gap) — `SELECT * FROM prediction_outcomes WHERE observedValue IS NULL
AND targetPeriodEnd <= now()`, then `resolve()` (M8, unmodified) for
each. No new table, no new resolution logic — only the trigger that
was missing.

### 29. Decision quality

`decisionQualityService.getDashboard()` composes the **five existing**
`calibrationService.summarize*` methods (§0.1's confirmed list:
`summarize`, `summarizeCustomerDiscovery`, `summarizeProductBuilds`,
`summarizeLaunch`, `summarizeBusinessDecisions`) into one company-wide
view, plus a **sixth**, genuinely new axis the brief names that none
of the five cover: **prediction accuracy** — `AVG(ABS(errorPct))`
grouped by `PredictionOutcome.predictionSource`, answering "growth
prediction accuracy"/"WTP prediction accuracy"/"kill prediction
accuracy" directly from already-resolved rows (§28). The brief's own
"do not optimize solely for being right — track calibration and
uncertainty" (§17) is satisfied because `summarizeCalibration`
(`src/domain/decision/calibration.js`, reused unmodified by all six
callers) already buckets by confidence and reports the APPROVE rate
*per bucket*, not one aggregate accuracy number — a well-calibrated
CEO that says "60% confident" and is right 60% of the time already
scores correctly under this existing formula; M9 does not change it.

### 30. Learning system

`learningService.recordFromFailure(predictionOutcomeId | memoId,
rootCause)` — a thin wrapper creating a `LearningRecord` (M8, §8),
constrained to the brief's own §18 root-cause enum
(`LEARNING_ROOT_CAUSES = [BAD_EVIDENCE, INSUFFICIENT_EVIDENCE,
BAD_ASSUMPTION, BAD_MODEL_REASONING, WRONG_MARKET, EXECUTION_FAILURE,
EXTERNAL_SHOCK, MEASUREMENT_ERROR]`, additive to the existing free-text
`rootCause` column — a domain-level constraint, no schema change).
Triggered automatically, but only as a **record**, from the operating
cycle's own LEARNING stage whenever OBSERVING (§28) resolves a
prediction with `|errorPct| >= LEARNING_RECORD_ERROR_THRESHOLD`
(reusing `shouldGenerateLearningRecord`, M8, unmodified). The brief's
own non-negotiable — "do not automatically rewrite agent prompts or
code" — is unchanged from `LearningRecord`'s own existing guarantee
(§8): `suggestedProcessChange` remains free text a human reads. M9
adds zero new write paths from a `LearningRecord` to anything
executable.

### 31. CEO orchestrator — the sixth entry point

`ceoReasoningService.recommendCompanyAction(params)` — same shape as
the existing five (§0.1: zero tool calls, one bounded model call, a
Zod-validated action schema, a `RunOutcome<T>` return). Its own input
summary is the one genuinely new thing: `CompanyActionSummary` reads
**all** of Company State (§21), Portfolio Control (§22), the
Opportunity/Product pipelines (§24–25), Resource Allocation (§23), and
`decisionMemoryService.findSimilarPastDecisions` (§27, "past
mistakes") — the widest input summary any CEO entry point in this
codebase has ever received, and the reason this needs to be its own
axis rather than folded into an existing one (none of the other five
sees more than one product/opportunity at a time; this is the first
that sees the whole company).

### 32. CEO action types

Reuses existing action vocabulary wherever the concept already exists,
per `docs/DECISIONS.md` #67's own precedent:

| Brief's suggested action | Reused from |
|---|---|
| `RESEARCH` | New — no existing action means "start a new ResearchCycle" |
| `VALIDATE_CUSTOMER` | `CUSTOMER_DISCOVERY_ACTIONS.RUN_CUSTOMER_DISCOVERY`, reused |
| `BUILD` | `PRODUCT_BUILD_ACTIONS.BUILD`, reused |
| `IMPROVE_PRODUCT` | Already in `ceo_recommendations.action`'s CHECK (M7+M8), reused |
| `RUN_EXPERIMENT` | `BUSINESS_ACTIONS.RUN_EXPERIMENT`, reused |
| `GROW` | New — "prioritize growth-oriented resource allocation," no existing single-word equivalent |
| `REDUCE_COST` | Already in the CHECK (M7), reused |
| `INVEST` | `BUSINESS_ACTIONS.INVEST`, reused |
| `MAINTAIN` | New — matches `PORTFOLIO_RECOMMENDATIONS.MAINTAIN` (M8) exactly, reused from there instead |
| `PAUSE` | `PAUSE_PRODUCT`/`PAUSE_GROWTH` already exist; company-level `PAUSE` is new, distinct (pauses the *cycle's* recommended emphasis, not a specific product — a specific product pause still goes through the existing `BusinessReviewMemo`/`PortfolioSnapshot` flow) |
| `PREPARE_KILL_REVIEW` | Already in the CHECK (M8), reused |

Only `RESEARCH`, `GROW`, and company-level `PAUSE` are genuinely new
strings requiring a `ceo_recommendations.action` CHECK widening (§54).
Every company-level action is, per the brief's own §20 closing line, "a
recommendation unless an existing approved execution path exists" —
`RECOMMEND_BUILD` does not itself create a `Product`; it is read by a
human who then uses the **existing** `productService.create`/`.approve`
flow. M9 adds zero new execution paths.

### 33. Chairman as adversarial company governor — the fifth entry point

`chairmanService.reviewCompanyAction(params)` — genuinely new (§5's
finding: no existing Chairman method has the evidence scope company-
level prioritization needs). It independently re-derives from the same
five inputs §31 lists — never trusting the CEO's own `CompanyActionSummary`
at face value, the same "independently re-query the underlying rows"
discipline every prior Chairman method already has (`docs/M8_ARCHITECTURE_PROPOSAL.md`
§37.16, reaffirmed). It attacks specifically what the brief names
(§21): CEO priority ordering (did the highest-attention-score item
actually get the top recommendation, or did the CEO under-weigh a
CRITICAL-state product?), portfolio allocation (does `ResourceAllocation`
data support the recommended emphasis?), opportunity selection, kill
recommendations, and growth-assumption evidence.

### 34. Conflict resolution

A pure function, `resolveCeoChairmanConflict(ceoAction, chairmanDecision)`,
used **only** by the company-level axis (§9's own explicit choice not
to retrofit this onto the five existing, already-shipped flows):

```
CEO=INVEST,  Chairman=APPROVE            → proceed to human, unconflicted
CEO=INVEST,  Chairman=REJECT             → STOP, flagged CONFLICTED
CEO=KILL/PREPARE_KILL_REVIEW,
  Chairman=REQUEST_MORE_EVIDENCE          → STOP, flagged CONFLICTED
CEO=anything, Chairman=REQUEST_CHANGES/
  ESCALATE_TO_HUMAN                       → STOP, flagged CONFLICTED
CEO=anything, Chairman=APPROVE            → proceed to human, unconflicted
```

**"STOP → HUMAN REVIEW" is the only terminal state for a conflict** —
never an automatic pick of either side (brief §22's own explicit
"never silently choose the CEO... never silently choose the Chairman").
A `CONFLICTED` `CompanyRecommendation` is surfaced to the Human Decision
Queue (§19) with **both** the CEO's and Chairman's full reasoning
attached, at the **highest** attention-score tier regardless of its
computed factors (§18) — a disagreement between the two adversarial
reviewers is, definitionally, high-uncertainty, and the score formula
already reflects that (the `uncertainty` factor derives from
`confidence`, which a `CONFLICTED` recommendation structurally has
less of) without needing a special-cased override.

### 35. Company alerts

`Alert` rows, created by exactly the sources the brief names (§23) —
each **already a real event or a real computed condition** in this
codebase, not invented: `Anomaly` rows (M8) past a severity threshold,
`Incident` creation (M7), `BusinessHealth.state` transitioning to
`CRITICAL`/`DECLINING` between two consecutive computations, a
`RevenueProvider` or other provider call throwing (§11.4-style
provider-failure surfacing), `ApprovalRequest`/`OperatingCycle`
budget exhaustion. Ranked by the **same** `computeFounderAttentionScore`
formula (§18) an alert is just another kind of attention item — **no
second ranking system**. "Avoid alert spam" (brief's own words) is
enforced by a documented dedup rule: two alerts for the same
`(alertType, resourceType, resourceId)` within a rolling window
collapse into one, with an `occurrenceCount` incremented rather than a
new row created.

### 36. Anomaly → action

The brief's own explicit pipeline — `ANOMALY → ANALYSIS → CLAIM →
CEO → CHAIRMAN → HUMAN → ACTION` — is **already exactly M8's own
architecture**: `metricEngineService.detectAnomaliesForMetric` creates
an `Anomaly` row (never an action); `productIntelligenceService`/
`revenueAnalystService`/etc. read it into their own analysis;
`businessClaimExtractionService.upsertClaim` turns analysis into a
real `Claim`; `ceoReasoningService.recommendBusinessAction` reads the
claim; `chairmanService.reviewBusinessAction` attacks it; a human
decides via `BusinessReviewMemo`. **M9 changes nothing about this
chain** — it only adds the `Alert` row (§35) as a parallel, faster-
surfaced *notice* that this chain is running, never a shortcut around
it. No anomaly, in M8 or M9, has ever had — or will ever have — a code
path that skips straight to an action.

### 37. Failure recovery

Every failure category the brief names (§25) maps to an **existing**
mechanism, reused:

| Failure | Handled by |
|---|---|
| Agent failure | `agentRuntimeService`'s own `RunOutcome<T>` FAILED status (unmodified, M2) |
| Provider failure | Caught at the metric-engine boundary, surfaced as `INSUFFICIENT_DATA` (M8 §36, unmodified) |
| DB/network failure | Prisma's own transaction semantics; no new retry wrapper |
| Partial execution | The "never rolls back partial work, every row already committed stays intact" discipline every orchestrator since M6 already follows (`docs/DECISIONS.md`'s repeated precedent) |
| Timeout | Existing per-agent/per-cycle budget ceilings (`maxDurationMs`, unmodified) |
| Budget exhaustion | `stoppedReason`, the existing `ResearchCycle`/`DecisionCycle` pattern, extended to `OperatingCycle` |
| Duplicate execution | §41 (idempotency) |
| Stale approval | §39 |

A `FAILED` `OperatingCycle` is resumable **exactly where §15 already
describes**: `stage` is preserved, `retryCycle` (§17) creates a fresh
cycle picking up from that stage — "resumable where safe" (brief's own
qualifier) means a stage that already committed real writes (e.g.
DECIDING already created `CeoRecommendation` rows) is never re-run;
`retryCycle` resumes at the **next** stage after the last one that
fully completed, read from the `CycleStageEvent` history (§15).

### 38. Approval expiration

Finishes §1's finding. `assertApprovalNotStale(approvalRequest, now)`
(`src/domain/approval/staleness.ts`) — called at the **start** of
every EXECUTE step (`deploymentService.execute`,
`billingActivationService.activate`,
`growthExperimentExecutionService.approveToRun`, all three edited to
add one call), checks `approvalRequest.expiresAt !== null &&
approvalRequest.expiresAt < now` and, if true, transitions the request
to the **already-declared, never-used** `EXPIRED` status (§1) via the
**already-legal** `PENDING → EXPIRED` transition and throws
`StaleApprovalError` — no new status value, no new transition, only
the missing call site. A default `expiresAt` (founder-revisable,
`DEFAULT_APPROVAL_EXPIRY_DAYS = 7`, matching the weekend cadence, §16)
is set by `approvalService.requestApproval` when the caller doesn't
supply one explicitly — currently every M5/M7/M8 call site passes no
`expiresAt` at all (confirmed by grep), so this is a real behavior
change, documented in `docs/DECISIONS.md` (§67) as deliberate: an
approval with no expiry is indistinguishable from a stale approval a
human forgot about, and M9's whole premise is that a founder may be
absent for a week at a time.

### 39. Change detection

The brief's own §27, genuinely new (nothing in M1–M8 snapshots
resource state at approval-request time). `ApprovalSnapshot`
(`{approvalRequestId, resourceType, resourceId, stateHash, capturedAt}`)
— `stateHash` a deterministic hash (`sha256`, reusing the same
`node:crypto` dependency `webhook-security.ts`, M7, already uses — zero
new dependency) over a documented, per-resource-type field subset (for
`DeploymentPlan`: `environment`/`provider`/`strategy`/`artifactRef`;
for `GrowthExperiment`: `hypothesis`/`estimatedCostUsd`/`riskLevel`;
etc.) — captured by `approvalService.requestApproval` at request time
(one new, optional parameter, backward compatible with every existing
M5/M7/M8 call site that doesn't pass a snapshot). `assertApprovalNotStale`
(§38) additionally recomputes the hash against the **current** resource
row and compares; a mismatch throws the same `StaleApprovalError`,
labeled `STALE_APPROVAL` in its message to distinguish it from a
time-based expiry in logs/audit — **both share one error type and one
call site**, because both answer the same underlying question ("is
this approval still good for what's about to happen") the brief's own
§26–27 frame as one flow, not two.

### 40. Concurrency

`assertNoConflictingRecommendation(resourceType, resourceId, action)`
— called by `recommendCompanyAction` (§31) and, additively, by the
existing five CEO entry points (one new call each, no behavior change
to their own output) before a new `CeoRecommendation` is persisted:
queries for any **other**, more recent `CeoRecommendation` on the same
`resourceType`/`resourceId` whose own `ApprovalRequest` is still
`PENDING` with a **conflicting** action (a small, documented
conflict table — e.g. `INVEST` vs. `PAUSE_PRODUCT`/`KILL_PRODUCT`
conflict; `INVEST` vs. `INVEST` does not). On a real conflict, the
**older** pending approval is not silently superseded — both surface
to the Human Decision Queue (§19) tagged `CONCURRENT_CONFLICT`, at
elevated attention score (§18, same mechanism as §34's `CONFLICTED`
tag), and neither can be approved via the normal path until a human
explicitly resolves which one stands (a new `resolveConcurrentConflict`
service call that rejects the loser's `ApprovalRequest` and leaves an
audit trail naming the human's own reasoning). This is deliberately a
**read-time check with a human-visible flag**, not a database lock —
this codebase has no distributed-lock infrastructure and inventing one
for a system whose actual write concurrency (SQLite, WAL mode, one
process) is already low would be over-engineering (brief's own "smallest
correct model" precedent, `docs/DECISIONS.md` #61).

### 41. Idempotency

Every M9 write path follows the **existing, already-established**
idempotency disciplines rather than a new mechanism:

- `startCycle` with an explicit `idempotencyKey` (a new, optional
  caller-supplied string) — a second call with the same key returns
  the existing cycle, mirroring `claimExtractionService.extractForOpportunity`'s
  own "existing rows returned unchanged" precedent (M4).
- `learningService.recordFromFailure` — one `LearningRecord` per
  `(predictionOutcomeId, rootCause)` pair, checked before insert
  (mirrors `cohortRepository`'s own upsert-on-unique-key precedent, M8).
- `predictionOutcomeService.resolveAllDue` — resolving an
  already-resolved outcome (`observedValue IS NOT NULL`) is a no-op,
  not an error (matches `growthExperimentExecutionService.approveToRun`'s
  own "already applied" idempotent-return precedent, M8).
- EXECUTE steps — unchanged; §38's staleness check is additive, not a
  replacement for the exact-resource-binding check that already makes
  a second EXECUTE attempt against an already-`EXECUTED` plan fail
  (`docs/DECISIONS.md` #58).

No new "idempotency key" table or generic dedup mechanism — the brief's
own list (cycle/decision/approval/execution/learning record) maps
one-to-one onto disciplines this codebase already has for four of the
five, and the fifth (cycle) is designed to match on day one.

### 42. Company event bus

Reuses `eventBus`/`Event`/`DOMAIN_EVENT_TYPES` **directly, unmodified
in mechanism** — only the vocabulary grows, and one bug is fixed:

- **Fix**: `business-review-memo.service.ts:79`'s `LAUNCH_REVIEW_MEMO_CREATED`
  → `BUSINESS_REVIEW_MEMO_CREATED` (§8).
- **New event types**, mapped against the brief's own §30 list, reusing
  an existing name wherever one already fits (never a duplicate):

| Brief's suggested event | Resolution |
|---|---|
| `OPPORTUNITY_DISCOVERED` | Already exists, reused verbatim |
| `CUSTOMER_VALIDATED` | New — no existing event fires when a `CustomerDiscoveryMemo` is APPROVEd |
| `PRODUCT_CREATED` | New — `PRODUCT_APPROVED` exists but fires later (on human approval, not creation); genuinely distinct moment |
| `PRODUCT_LAUNCHED` | Covered by existing `PRODUCT_DEPLOYED` — reused, not duplicated |
| `REVENUE_OBSERVED` | New — no event fires when `computeAndRecordRevenueMetrics` (M8) records an OBSERVED MRR row |
| `ANOMALY_DETECTED` | New — the §8 gap |
| `EXPERIMENT_COMPLETED` | New, named `GROWTH_EXPERIMENT_COMPLETED` to stay distinct from M5's own outreach-experiment vocabulary |
| `CEO_RECOMMENDATION_CREATED` | Covered by existing `CEO_RECOMMENDATION_ISSUED` — reused |
| `CHAIRMAN_REVIEW_COMPLETED` | New — no Chairman event exists anywhere in M2–M8 at all, a genuine, pre-existing gap this audit found |
| `HUMAN_DECISION_MADE` | New — a single, cross-milestone event `decisionQueueService` fires whenever *any* of the five memo types or an `ApprovalRequest` receives a human decision, the one place M9's unification (§19) becomes real at the event layer too |
| `ACTION_EXECUTED` | New — fired by the EXECUTE steps generically, alongside their existing specific events (`PRODUCT_DEPLOYED` etc.), never replacing them |
| `OUTCOME_OBSERVED` | New — fired by `resolveAllDue` (§28) per resolved `PredictionOutcome` |
| `LESSON_CREATED` | New — fired by `learningService.recordFromFailure` (§30) |
| *(new, M9-specific, not in the brief's list)* | `PORTFOLIO_ANALYZED` (already missing for M8's own `portfolioAnalystService.run`, closed here), `OPERATING_CYCLE_STAGE_ADVANCED`, `ATTENTION_QUEUE_UPDATED`, `EMERGENCY_STOP_ACTIVATED`/`_RESUMED` |

### 43. Company timeline

`companyStateService.getTimeline(since)` — a pure read over `Event`
(now complete, §42) ordered by `occurredAt`, joined with
`CycleStageEvent` (§15) for cycle-relative context ("Saturday 18:20
Human approves" — the brief's own §31 example, reproduced exactly by
formatting `occurredAt` against the viewer's own local time, a
presentation concern, not a new data concept). No new event-storage
mechanism — `Event.payload` already carries enough to reconstruct what
happened (every publish call already includes the relevant resource
id), per §1's own confirmed fact.

### 44. Founder cockpit

One read-aggregating service, `founderCockpitService.getCockpit()`,
answering the brief's own §32 question list **directly from already-
built pieces**: "what is happening" → Company State (§21) + current
`OperatingCycle` stage; "what made/is losing money" → `BusinessMetric`
MRR trend per product, `BusinessHealth.revenueHealth` ranking; "what is
growing/dying" → Portfolio Control's WINNERS/DECLINING buckets (§22);
"what is uncertain" → `BusinessHealth.state IN (EARLY, UNKNOWN)`
products; "what does CEO/Chairman say" → the latest company-level
recommendation/review (§31/§33); "what decisions do I need to make" →
the Human Decision Queue (§19), top-N by attention score; "what
happened since my last review" → the Timeline (§43) filtered to `since
lastViewedAt` (a new, tiny `founder_cockpit_views` table recording
when a human last called this endpoint — the only genuinely new
persistent state this section needs); "what did VentureForge learn" →
recent `LearningRecord`s (§30).

### 45. Dashboard principle

Enforced by **API shape, not discipline alone**: `GET /api/company/state`
returns exactly the §21 dimension table — eleven fields, matching the
brief's own explicit five-category emphasis (ATTENTION/MONEY/RISK/
GROWTH/DECISIONS) when grouped for display — never a paginated list of
"all metrics." Any caller wanting the full `BusinessMetric` detail
behind a summary number already has M8's own `GET /api/products/:id/business-metrics`
endpoint (unchanged) — the cockpit links to it, never inlines it.

### 46. Weekend briefing

`briefingService.generate()` — the brief's own literal §34 eleven-
section structure, each section a **direct citation** of an
already-built read (Company State §21, Portfolio Control §22, revenue/
growth from the same, `alertService.listRanked()` §35 for RISKS,
`companyStateService.getOpportunityPipeline` §24 for OPPORTUNITIES,
`GrowthExperiment` status for EXPERIMENTS, the Decision Queue §19 for
DECISIONS REQUIRED, `recommendCompanyAction`'s own top items for CEO
RECOMMENDATIONS, `reviewCompanyAction`'s objections for CHAIRMAN
CONCERNS, recent `LearningRecord`s for LESSONS). "Every important
statement must be evidence-backed" (brief's own words) is enforced
structurally: `Briefing.content` is a JSON structure whose own Zod
schema requires a non-empty `citedIds: string[]` on every statement
object — a briefing section that would otherwise be empty prose
literally cannot be constructed by the type system. Persisted as a
`Briefing` row (`{id, generatedAt, periodStart, periodEnd, content,
decisionQueueSnapshot}`) so a later cycle's briefing can diff against
it for "what happened since" (§44) without recomputing history.

### 47. Decision priority (within the briefing)

The briefing's own DECISIONS REQUIRED section is **the Decision
Queue, ranked** (§18–19) — not a second ranking mechanism. "Expose why
each item is ranked" (brief §35) means the briefing's JSON includes
each item's own stored factor breakdown (§18's table), not just the
composite score — the same anti-magic-number discipline threaded
through this whole document.

### 48. No decision fatigue

`briefingService.generate()` returns `decisionsRequired: []` and a
literal `status: "NO_ACTION_REQUIRED"` field whenever the ranked queue,
after §18's scoring, has zero items above a documented minimum
attention threshold (`MIN_ATTENTION_SCORE_FOR_BRIEFING`,
founder-revisable) — **a real, valid, tested output** (brief §36's own
words), not an edge case papered over. The weekend capstone (§66)
includes a run where this is the actual result, proving the system
doesn't manufacture a decision to look productive.

### 49. Operating efficiency

`operatingEfficiencyService.getMetrics(period)` — reads counts already
recorded on existing rows, nothing new to instrument: `AgentExecution`
count/`toolCallCount`/`modelCallCount` (M2, unchanged), `OperatingCycle`
duration (`completedAt - startedAt`), `estimatedCostUsd` sums (M2's own
column, already populated), human-decision count (§19's queue, decided
vs. pending), safe-automated-action count (every write this milestone
makes that required no human decision — e.g. `resolveAllDue`),
`AgentExecution.status = 'FAILED'` count and `retryCount` sums for
failure/retry rate. A read, not a new tracking mechanism.

### 50. Cost control

`CompanyBudget` (`{period, ceilingUsd, consumedUsd}`) — one row per
period, sitting **above** the existing three ceilings the brief names
(agent execution budget — M2's `ExecutionBudget`; cycle budget —
`ResearchCycle`/`DecisionCycle`'s own `maxCostUsd`; provider budget —
M7's `checkLaunchBudget`) as a **rollup check**, not a fourth
independent one: `assertCompanyBudgetNotExceeded()` sums
`AgentExecution.estimatedCostUsd` for the current period and compares
against `CompanyBudget.ceilingUsd`, called once at `OperatingCycle`
stage-advance time (§15) — if exceeded, the cycle stops
(`stoppedReason: "COMPANY_BUDGET_EXCEEDED"`, the same `stoppedReason`
pattern `ResearchCycle`/`DecisionCycle` already use) rather than
proceeding to the next stage. "Do NOT create unrestricted financial
autonomy" (brief's own words) — there is no code path in M9, as in
M1–M8, that spends real money; this ceiling bounds **model/agent
execution cost**, the only real cost this system has ever incurred.

---

## Part C — Security, API, database, testing

### 51. Security — threat categories (full review in `docs/SECURITY.md`'s M9 section post-implementation, mirroring the M7/M8 precedent of a proposal-stage overview plus a verified, test-linked review once built)

Every category the brief names (§39) maps to a control already
designed above or an M1–M8 control reused directly:

| Threat | Mitigation |
|---|---|
| Control-plane takeover | `controlPlaneService` holds no Guardian permission and no bypass of `assertHumanActor` for any consequential step (§14) |
| Privilege escalation | Zero new permissions (§53); every M9 write is GREEN-tier persistence of already-computed analysis, the same M8 finding (`docs/DECISIONS.md` #65) extended |
| Scheduler abuse | The scheduler is stateless, bounded, explicitly-invoked (§17) — nothing to "abuse" that isn't already gated by the cycle's own budget/human gates |
| Approval replay | `WebhookDelivery`-style idempotency (§41) + staleness (§38–39) |
| Stale approvals | §38–39, closed |
| Cross-product access | §21's own per-product aggregation never joins across `productId` without an explicit, named cross-product read (mirrors M8's own `docs/DECISIONS.md` §37.9 finding) |
| Memory poisoning | §52 |
| CEO manipulation | `recommendCompanyAction` only reads already-validated rows (§31), same discipline `docs/M8_ARCHITECTURE_PROPOSAL.md` §37.13 already established |
| Chairman manipulation | `reviewCompanyAction` independently re-derives (§33) |
| Event poisoning | `Event`/`eventBus` are internal-only, no external write path (unchanged since M1) |
| Metric poisoning | `assertMetricProvenance` (M8, unchanged) still gates every `BusinessMetric` write M9 reads |
| Decision poisoning | Concurrency check (§40) surfaces rather than silently accepts a conflicting recommendation |
| Resource exhaustion | Company budget (§50) |
| Agent loops | Existing per-execution step/retry ceilings, unchanged |
| Secret exposure | No new credential anywhere in M9 (dev-fixture-only providers, unchanged from M7/M8) |
| PII exposure | M9 reads already-redacted `CustomerDataProvider` output (M8) exclusively; never raw customer text |
| Financial manipulation | No execution capability exists in M9 (§14) |
| Race conditions | §40 (read-time conflict detection) |
| Duplicate execution | §41 |

### 52. Memory security

Institutional memory (§26–27) is built entirely from **already-
governed** sources — `LearningRecord`/`DecisionOutcome`/memo `content`
— never from raw external input directly. The brief's own concern (a
malicious signal becoming "company policy" without governance) is
structurally impossible here because M9 introduces no path from
external text to a `LearningRecord`/`DecisionOutcome` row that skips
Claim/Evidence validation — every fact a `LearningRecord` cites already
passed through the M4 Evidence Validator or M8's `assertMetricProvenance`
before M9 ever reads it. `decisionMemoryService.findSimilarPastDecisions`
(§27) is explicitly documented as **evidentiary, not authoritative** —
its output is one input line in the CEO's own prompt (§31), which the
Chairman (§33) may independently contest, exactly like any other cited
claim.

### 53. Self-modification

Reaffirmed, not re-invented: M9 adds no code path that reads a
`LearningRecord`/`DecisionOutcome` and edits `PERMISSIONS`,
`RISK_POLICY`, Guardian, `APPROVAL_STATUS_TRANSITIONS`, a system
prompt, or production source — the identical guarantee
`docs/M8_ARCHITECTURE_PROPOSAL.md` §41 already established for
`LearningRecord`, now also covering `DecisionOutcome`. "M9 may
identify improvements. Humans approve changes" (brief's own words) —
`suggestedProcessChange`/`DecisionOutcome.lesson` remain free text
surfaced in the briefing (§46) for a human to read and act on outside
this system.

### 54. API

| Endpoint | Notes |
|---|---|
| `GET /api/control-plane/status` | Current cycle, stage, budget consumption (§56) |
| `GET /api/company/state` | §21 |
| `GET /api/company/timeline` | §43 |
| `GET /api/company/briefing` | Latest `Briefing` (§46); `POST` variant to force-generate |
| `GET /api/founder/attention-queue` | §18–19, ranked |
| `GET /api/founder/decisions` | Alias of the above, memo-shaped (§20 Decision Cards) |
| `GET /api/portfolio/overview` | §22 |
| `GET /api/decision-quality` | §29 |
| `GET /api/learning` | Recent `LearningRecord`/`DecisionOutcome` rows |
| `POST /api/operating-cycles` | `startCycle` |
| `GET /api/operating-cycles` / `GET /api/operating-cycles/:id` | List/detail, including `stage` history |
| `POST /api/operating-cycles/:id/pause` / `/resume` / `/cancel` | §17, human-actor-gated where consequential |
| `POST /api/control-plane/emergency-stop` / `/resume` | §57, human-actor-gated |
| `GET /api/alerts` | §35, ranked |

Every route follows the existing `requireAuth()`/`validateBody(zodSchema)`/
`asyncHandler` middleware chain (unmodified since M1) — no new
authentication mechanism.

### 55. Database

New tables, minimal, additive-only (no existing table's shape changes
beyond the two CHECK widenings §32/§42 name):

`operating_cycles`, `cycle_stage_events`, `founder_attention_items`,
`company_budgets`, `resource_allocations`, `alerts`, `briefings`,
`decision_outcomes`, `approval_snapshots`, `founder_cockpit_views`
(the last one, §44, a single-row-per-viewer timestamp table). **Not**
created, per the brief's own explicit instruction and this audit's own
findings: a second products/approvals/claims/evidence/agents/tasks/
events table (§9–10, §26, §42) — every one of those is read, never
duplicated.

### 56. Observability

`GET /api/control-plane/status` surfaces, directly, the brief's own
§44 list: current cycle + stage (§15), running `AgentExecution`s
(existing `status='RUNNING'` query, unchanged), queued work (Decision
Queue §19 count), blocked work (`AWAITING_HUMAN` cycles/stages),
failed work (`FAILED` cycles, unresolved `Incident`s), pending
approvals (§19), budget consumption (§50). "No hidden background
work" — true by construction, since §17 established there is no
background work of any kind in this system, hidden or otherwise.

### 57. Human override / emergency stop

`emergencyStopService.activate(actor)` — `assertHumanActor`-gated
(§2), sets a single, company-wide `EmergencyStop` row
(`{activatedAt, activatedBy, resumedAt, resumedBy}` — the simplest
correct model, one active-or-not row, not a table of historical stops
beyond what `AuditLog` already records for the action itself).
**Checked at exactly one place**: the start of `schedulerService`'s
own stage-advance function (§17) and every EXECUTE step (§38's own
call sites, one more check added alongside the staleness one) —
**fails closed**: if the check itself errors for any reason (DB
unreachable), the caller treats that as "stop is active" rather than
"stop is inactive," inverting the usual fail-open default deliberately,
because the brief's own words are explicit ("Emergency stop must fail
closed"). "Existing safe read-only work may finish where appropriate"
— every `GET` endpoint (§54) is entirely unaffected by an active
emergency stop; only stage-advance and EXECUTE calls check it.
`resumeFromEmergencyStop` is likewise `assertHumanActor`-gated — no
code path anywhere, including `recommendCompanyAction`, can resume the
company itself.

### 58. Testing

**Unit** — `operating-cycle.types.ts` transitions (§15), attention
scoring (§18), staleness/change-detection hashing (§38–39), conflict
detection (§40), the conflict-resolution table (§34), budget math
(§50).

**Integration + security** — mirroring `tests/integration/m8-security.test.ts`'s
own pattern: least-privilege (zero new permissions, §53), EXECUTE
steps still reject non-HUMAN actors with the staleness check now also
active, self-approval still impossible, emergency stop blocks a
concrete EXECUTE attempt, concurrency conflict surfaces rather than
silently resolving.

**The nine mandatory capstones** (brief §47–55), each a real,
end-to-end run against dev-fixture data, no mocks in the internal
decision pipeline (brief's own explicit instruction):

1. **Positive** — a full cycle, opportunity through NEXT ACTION, reusing
   `makeLiveProduct()`-style helpers from M7/M8's own test suite.
2. **Weekend** — Friday observe → Saturday briefing+approval → Sunday
   execute → weekday observe → next Saturday briefing-with-outcomes,
   state preserved across every stage transition (§15–16).
3. **Decision-quality** — seeded historical CEO/Chairman/human/outcome
   rows, asserting `decisionQualityService` computes a real accuracy
   number and `learningService` produces at least one genuine lesson.
4. **Conflict** — CEO=INVEST, Chairman=REJECT, assert zero execution
   until a human decides (§34).
5. **Stale-approval** — approve, then mutate the underlying
   `DeploymentPlan`, then attempt EXECUTE, assert `STALE_APPROVAL`
   (§39).
6. **Emergency-stop** — start a consequential execution, activate the
   stop mid-flow, assert the safe-stop boundary and that no new
   consequential action can start until a human resumes (§57).
7. **Portfolio** — seed WINNER/PROMISING/UNCERTAIN/DECLINING products
   (reusing the exact seeding patterns `m8-capstone-positive`/`-kill`/
   `-portfolio` already established), assert the CEO prioritizes
   differently and the Chairman independently challenges (§33).
8. **Memory** — decision → outcome → lesson → a later, similar decision
   retrieves the lesson via `findSimilarPastDecisions` (§27) without
   the system treating it as unquestionable (the Chairman still
   independently reviews the later decision).
9. **Full security** — fake approval, stale approval, agent
   impersonation, memory poisoning, cross-product access, duplicate
   execution, budget exhaustion, scheduler abuse, CEO/Chairman
   manipulation attempts — each asserted to fail safely, mirroring
   `tests/integration/m7-security.test.ts`/`m8-security.test.ts`'s own
   density.

### 59. Alternatives considered

- **A generic, config-driven state-machine engine for `OperatingCycle`**
  (rather than a hand-written linear `stage` progression) — rejected:
  every prior cycle type in this codebase (`ResearchCycle`,
  `DecisionCycle`) is a hand-written, explicit state machine, and a
  generic engine would be the first piece of framework-shaped
  infrastructure in a codebase that has deliberately avoided that
  shape for eight milestones (`docs/DECISIONS.md`'s own repeated
  "smallest correct model" precedent).
- **Unifying the five memo tables into one polymorphic table** (§10) —
  rejected: real migration risk across four already-shipped milestones
  for a purely cosmetic gain, when a read-layer function achieves the
  same founder-facing unification for zero risk.
- **A background scheduler daemon** (§17) — rejected outright by the
  brief itself and by seven milestones of consistent precedent; not
  seriously considered.
- **A hard database lock for concurrency** (§40) — rejected in favor
  of a read-time check with a human-visible flag, matching this
  system's actual (low) concurrency profile.

### 60. Risks

- **Attention-score weight tuning is inherently subjective** — mitigated
  by storing every underlying factor (§18), so a founder who disagrees
  with a ranking can see exactly why and the weights are a documented,
  revisable constant, not a black box.
- **Backtesting the operating cycle's own EXECUTING stage against
  real dev-fixture time deltas (a "week" in a test)** requires careful
  `Date` mocking, the same discipline `predictionOutcomeService`'s own
  premature-resolution tests already established (M8) — no new risk
  class, but real test-authoring care needed (addressed directly in
  §58's capstone #2).
- **The conflict-resolution table (§34) is a fixed, hand-written
  mapping** — a genuinely new CEO action not yet added to it would
  default to "no declared conflict," a real gap; mitigated by making
  the table exhaustive over `BUSINESS_ACTIONS ∪ CEO_DECISION_ACTIONS ∪
  {RESEARCH, GROW, PAUSE}` at write time (a unit test asserts every
  action has a row) rather than defaulting silently.

### 61. Deferred capabilities

- A real, continuously-running scheduler (a genuine cron/queue system)
  — explicitly out of scope, per the brief's own instruction and every
  prior milestone's own "no scheduler exists" finding; `OperatingCycle`
  remains externally-triggered.
- Real financial cash-position tracking — no real payment processor
  exists in this system (M7 §59); `Cash position` in Company State
  (§21) stays permanently `UNKNOWN` until a real provider is a
  deliberate, separate decision.
- A generic, pluggable attention-scoring formula (config-driven
  weights via an API) — the weights are a founder-revisable *constant*
  in this milestone, not yet a runtime-editable *setting*; editable
  weights are themselves a form of "self-modification" (§53) worth its
  own careful design later, not folded into M9 by default.
- Automatic prompt/policy rewriting from learning records — explicitly,
  permanently out of scope per §53 and Constitution §2, not merely
  deferred.

### 62. What M9 does not claim

M9 does not make VentureForge autonomous. Every consequential action
this milestone can ever recommend still terminates at an existing,
unmodified human gate (`assertHumanActor`, an `ApprovalRequest`
decision, or a memo's `recordHumanDecision`) — M9 adds visibility,
prioritization, and two closed governance gaps (staleness, conflict),
never a new way for the system to act on its own. No real cash
position, no real scheduler, no self-modifying policy. The founder
attention score is a **ranking aid**, not a decision — a human can
always open the full, unranked queue. "AI operated, human governed" is
not a slogan this document repeats; it is the literal shape of every
section above: every new mechanism either reads, coordinates, or
requires `assertHumanActor` — none executes.
