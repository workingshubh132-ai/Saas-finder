# Company Control Plane & Operating System

M9. Unifies M1-M8 into one continuously operating, auditable,
human-governed company, rather than eight separate pipelines a human
has to stitch together by hand. Nothing here is a new kind of
authority — it is the same Guardian/permission/risk-classification/
approval/Chairman/Human-Owner chain every prior milestone already
built, now coordinated from one place. Full rationale in
`docs/M9_ARCHITECTURE_PROPOSAL.md`; the specific decisions this build
made along the way are in `docs/DECISIONS.md` #71 onward; the full
security threat review is in `docs/SECURITY.md`'s M9 section.

## The hard boundary this whole milestone answers to

**AI OPERATED, HUMAN GOVERNED — NOT AI UNCONTROLLED.** `controlPlaneService`
— the one new coordinator this milestone adds — holds no Guardian
permission and calls no execute-capable service directly; it only
reads already-persisted state and delegates every consequential step
to the exact mechanism that already gated it before M9 existed. No M9
agent role exists at all: the CEO/Chairman entry points this milestone
extends run under the same identities M4 already created. Company-wide
automation is bounded the same way every prior milestone's own
automation was bounded — explicit invocation, a real budget ceiling,
and a human who can always stop it.

## The Operating Cycle

```
CREATED -> PLANNING -> RESEARCHING -> ANALYZING -> DECIDING -> EXECUTING -> OBSERVING -> LEARNING -> COMPLETED
                                                        |
                                                        v
                                                 AWAITING_HUMAN
                                          (any stage may request it;
                                           resuming re-enters exactly
                                           that stage — never skips
                                           ahead, never restarts at
                                           CREATED)
```

Two independent axes per `OperatingCycle`: `status` reuses
`CYCLE_STATUSES`/`CYCLE_STATUS_TRANSITIONS`
(`src/domain/shared/cycle-lifecycle.ts`) verbatim — this milestone is
that table's third consumer, after `ResearchCycle` (M3) and
`DecisionCycle` (M4). `stage` is a new, linear-only progression
(`CYCLE_STAGES`) with exactly one branch: any stage may request
`AWAITING_HUMAN`, and the branch's own resume target is computed from
real `CycleStageEvent` history (`resolveResumeStage`), never
hard-coded. `schedulerService.advanceStage` is the only mechanical
mover — nothing here is a cron daemon or a background loop; something
external (an API call, a demo script, a human) must invoke it again to
make further progress (§17).

`controlPlaneService.runNextStage` is the one dispatcher that actually
does each stage's real work before advancing: `RESEARCHING`/`ANALYZING`
summarize real Company State/Portfolio reads; `DECIDING` runs the
CEO/Chairman company-level axis below and always stops for a human
before `EXECUTING` — no auto-proceed path exists, regardless of what
the CEO/Chairman concluded. `EXECUTING` is bookkeeping-only: M9 adds
**zero new execution paths** — the actual EXECUTE already happened, or
will happen, through the existing human-invoked M6/M7 services,
separately, outside the cycle machinery. `OBSERVING` resolves due
`PredictionOutcome`s and expires overdue `ApprovalRequest`s; `LEARNING`
is a close — `LearningRecord` creation already happens automatically
inside `predictionOutcomeService.resolve`.

Getting `DECIDING` to actually reach `EXECUTING` required two real
fixes this build made along the way (`docs/DECISIONS.md` #78): the
shared status table never allowed `RUNNING -> AWAITING_HUMAN` at all,
and `runNextStage`'s own `DECIDING` handler never checked whether a
prior recommendation had already been decided before re-requesting
review — both closed, both verified end to end by
`tests/integration/m9-capstone-operating-cycle.test.ts`.

## The Human Decision Queue & Founder Attention Queue

```
PENDING ApprovalRequests  ─┐
Five memo tables (undecided)├─► founderDecisionQueueService.listPending()
Undecided CompanyRecommendations ┘         │
                                            ▼
                              attentionScoringService.scoreAll()
                        (nine stored factors — never one unexplained number)
                                            │
                                            ▼
                            founderAttentionService.refresh()/listQueue()
                          (ranked; deduplicated per underlying resource)
```

Three real, already-existing sources unioned at read time, in
application code — no sixth table duplicating any of them.
`founderDecisionQueueService`, not `decisionQueueService`: M1 already
shipped a different, still-used single-`ApprovalRequest` enrichment
view under that name (`docs/DECISIONS.md` #72). Every queue entry
scores against `computeFounderAttentionScore`'s nine weighted factors
(financial impact, urgency, risk, uncertainty, reversibility,
opportunity cost, evidence quality, strategic importance, deadline
proximity — weights sum to exactly 1.0), and `decisionCardService`
renders any entry into the same why/keyRisk/evidence/reversibility/
confidence shape regardless of which of the six source kinds it came
from.

## The company-level CEO/Chairman axis

The sixth CEO decision axis, alongside the five per-opportunity/
per-product ones M4-M8 already built:
`ceoReasoningService.recommendCompanyAction` reads Company State,
Portfolio Control, the Opportunity/Product pipelines, real Resource
Allocation consumption, and real past-decision lessons
(`decisionMemoryService.findSimilarPastDecisions`) — the widest input
summary any CEO axis in this codebase has ever received. Persists to
`CompanyRecommendation`, a new table rather than a reused
`CeoRecommendation` row, because a company-level recommendation may
legitimately target zero, one, or the whole portfolio — `CeoRecommendation`'s
own `opportunityId` FK is required (`docs/DECISIONS.md` #71).

`chairmanService.reviewCompanyAction` independently re-fetches Company
State/Portfolio rather than trusting the CEO's own summary, then calls
`resolveCeoChairmanConflict(ceoAction, chairmanDecision)` — **STOP ->
HUMAN REVIEW is the only terminal state for a real conflict**, never an
automatic pick of either side. Two CompanyRecommendations targeting the
same resource with opposing actions are separately flagged by
`concurrencyService` — a read-time check, never a lock, wired only into
this one axis (`docs/DECISIONS.md` #76). Neither a conflicted nor an
undisputed recommendation ever auto-proceeds:
`companyRecommendationService.recordHumanDecision` is the sole,
`assertHumanActor`-gated, idempotent way a `CompanyRecommendation` is
ever decided (`docs/DECISIONS.md` #73;
`tests/integration/m9-capstone-conflict.test.ts` proves the full
loop).

## Safety mechanisms

- **Emergency Stop** (§57) — a company-wide kill switch, fails closed:
  a DB-read error is treated as "active," never "inactive." Checked at
  the scheduler's own move into `EXECUTING` and at all three real
  EXECUTE call sites (deployment/billing/growth-experiment) —
  `assertHumanActor`-gated to activate or resume.
- **Stale-approval / change detection** (§38-39) — `computeResourceStateHash`
  captured at approval-request time (`ApprovalSnapshot`), recomputed and
  compared at EXECUTE time (`approvalService.assertFresh`, check-only,
  never mutating an already-`APPROVED` request). Distinct from
  `expireOverdue()`'s own PENDING-and-overdue queue-hygiene sweep
  (`docs/DECISIONS.md` #74-75).
- **Company Budget** (§50) — a rollup ABOVE the three existing ceilings
  (per-execution, per-cycle `maxCostUsd`, M7's launch budget), checked
  once per `advanceStage` call; on breach, the cycle actually `STOP`s
  rather than merely reporting the overage, and raises a
  `BUDGET_EXHAUSTED` alert.
- **Company Alerts** (§35) — one dedup+ranking mechanism
  (`alertService.raise`, same `computeFounderAttentionScore` formula an
  alert is just another kind of attention item) wired into seven real,
  already-computed sources; five more are deliberately deferred, named
  rather than silently missing (`docs/DECISIONS.md` #77).

## Institutional memory & learning

`decisionMemoryService` records what a decision expected to happen
(`recordExpectation`) against what actually happened
(`evaluateOutcome`, exactly once per outcome), and
`findSimilarPastDecisions` surfaces past decisions of the same kind
that generated a real lesson — evidentiary, never authoritative,
exactly one input line in the CEO's own prompt the Chairman may
independently contest, exactly like any other cited claim. Built
entirely from already-governed sources (`LearningRecord`/
`DecisionOutcome`) — there is no path from raw external text to an
institutional lesson that skips Claim/Evidence validation.

## The reporting layer

Every one of these is a pure read, zero new writes beyond its own
narrow bookkeeping: `companyStateService.getState()` (11 dimensions,
every health/financial one a `MetricResult` — cash position is
permanently UNKNOWN, no real payment processor exists anywhere in this
codebase); `portfolioControlService.overview()` (Constitution §19's own
six buckets, mapped from `BusinessHealth.state`);
`companyTimelineService.getTimeline()` (time-window correlation between
`Event` and `CycleStageEvent`, since `Event` carries no `cycleId` FK by
design); `briefingService.generate()` (the brief's own eleven-section
structure, every statement Zod-required to cite a real id —
`NO_ACTION_REQUIRED` is a real, valid, honest output, never a
manufactured decision to look productive);
`founderCockpitService.getCockpit()` (one screen, records a
`FounderCockpitView` so the next visit's timeline slice starts exactly
where the last one left off); `decisionQualityService.getDashboard()`
(the five existing calibration summaries plus a new prediction-accuracy-
by-source axis — never one aggregate "am I right" number).

## API layer

Every new route (`/api/control-plane`, `/api/company`, `/api/founder`,
`/api/decision-quality`, `/api/learning`, `/api/operating-cycles`,
`/api/alerts`, plus `/api/portfolio/overview`) follows the exact,
unmodified `requireAuth()`/`requireHuman()`/`validateBody(zodSchema)`/
`asyncHandler` chain every prior milestone's routes already use — no
new authentication mechanism, verified directly by
`tests/integration/api-m9.test.ts`.
