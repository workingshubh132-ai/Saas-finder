# Decision Intelligence

M4. The decision cycle orchestrator, Expected Information Gain, the
`KILLED` state, and the KILL/PREPARE_REVIEW/HUMAN_REVIEW wiring to the
unchanged approval infrastructure. Full rationale in
`docs/M4_ARCHITECTURE_PROPOSAL.md` §15-16, §18, §20-21, §25.

## The decision cycle — deterministic orchestration, on top of the unchanged M3 pipeline

`src/services/decision-cycle.service.ts`, the CEO-pipeline sibling of
`researchCycleService` — never a modification of it. Entry-pointed on
an existing `opportunityId` (M4 operates on what M3 already
discovered), it drives: claim extraction (idempotent) → Evidence
Validator per claim, highest-`CLAIM_IMPORTANCE_WEIGHT` first → claim
confidence recalculation → claim-level evidence-gap refresh →
opportunity confidence recalculation → research-queue population → one
CEO reasoning call. Stops at "CEO recommendation issued," mirroring
`researchCycleService`'s own scope boundary exactly — Chairman review,
Investment Memo compilation, and the approval/KILL wiring are separate,
subsequent, caller-orchestrated steps.

Same lifecycle shape as `ResearchCycle` (`domain/shared/cycle-lifecycle.ts`,
factored out once `DecisionCycle` needed the identical shape):
`SCHEDULED → RUNNING → {COMPLETED|FAILED|STOPPED|PAUSED|CANCELLED}`,
`SCHEDULED → AWAITING_HUMAN → {SCHEDULED|RUNNING|CANCELLED}`.
`AWAITING_HUMAN` fires when the Evidence Validator currently lacks
`READ_WEB` and search is requested — checked before the cycle even
starts, same discipline as M3's own research-cycle check.

## Budgets — six ceilings, checked before each stage

```
DEFAULT_DECISION_CYCLE_BUDGET = {
  maxClaims: 20, maxValidatorSearches: 10, maxModelCalls: 15,
  maxResearchTasks: 5, maxCeoPlanningSteps: 3, maxDurationMs: 180_000,
}
```

STOP, AUDIT, PRESERVE PARTIAL RESULTS on any ceiling hit — every
`ValidationReport`/`CeoRecommendation` already committed stays exactly
as written, since each stage commits its own output immediately.

## Expected Information Gain — extends, never replaces, M3's evidence-gap engine

`EvidenceGap` gained one nullable column, `claimId`. When set,
`evidence-gap.service.ts`'s `analyzeClaim` computes `impactScore` via
`domain/claim/eig.ts` instead of the original extremity-based formula;
when absent, the M3 path runs completely unchanged. The **same**
`ResearchQueueItem`/`computeQueuePriority` machinery consumes both —
no second queue.

```
EIG = 0.5 · importanceWeight + 0.3 · uncertaintyFactor − 0.2 · normalizedResearchCost

uncertaintyFactor:  UNVERIFIED, INSUFFICIENT_EVIDENCE → 1.0
                    WEAK, CONFLICTED                  → 0.7
                    SUPPORTED, CONTRADICTED            → 0.3
```

A claim-linked gap is refreshed **in place** on every re-analysis
(`evidenceGapRepository.findUnresolvedByClaimId`), never duplicated —
`researchQueueService.populateForOpportunity` was extended with the
matching idempotency guard (`researchQueueRepository.findActiveByEvidenceGapId`;
see `docs/DECISIONS.md` #38 for the real gap this closed). Claim gaps
are never auto-resolved even once `SUPPORTED` — resolution stays an
explicit human/CEO call (`docs/DECISIONS.md` #39).

## The `KILLED` state — one value added, no parallel state machine

`OPPORTUNITY_STATUSES` gained `KILLED`, reachable from every
non-terminal status alongside `ARCHIVED`; `KILLED` itself only ever
moves to `ARCHIVED`. `CHAIRMAN_REVIEW`/`HUMAN_REVIEW` were deliberately
**not** added as statuses — both are already fully represented by a
`ChairmanReview` row existing / a `PENDING` `ApprovalRequest` existing.

## KILL wiring — never auto-applied

`src/services/decision-record.service.ts`, two separate operations,
preserving the decision-record-decoupled-from-resource-mutation
pattern `approvalService` already established in M1:

1. **`requestApprovalForRecommendation`** — `KILL`/`PREPARE_REVIEW`/
   `HUMAN_REVIEW` create an `ApprovalRequest` (`KILL_OPPORTUNITY`/
   `REVIEW_INVESTMENT_MEMO`/`REVIEW_OPPORTUNITY`, risk `ORANGE`/
   `YELLOW`/`YELLOW`) through the unmodified `approvalService.requestApproval`.
   `DEPRIORITIZE`/`INVESTIGATE`/`VALIDATE_CUSTOMER` return `null` — no
   human gate needed, since none mutates irreversible state.
2. **`applyHumanDecision`** — the one operation a human calls once the
   `ApprovalRequest` is decided. Requires `assertHumanActor` on its own
   caller (defense in depth, even though the request was necessarily
   already human-decided). Only on `APPROVED` + `KILL_OPPORTUNITY`:
   calls `opportunityService.transition(..., "KILLED")` — the single
   path that ever sets this status. Always: writes one immutable
   `DecisionRecord` (accepted/rejected claim ids derived from whether
   the human approved or rejected the CEO's own citations; missing
   evidence pulled from the Chairman's own `missingEvidence` field),
   then publishes `OPPORTUNITY_DECISION_RECORDED` (reserved in M3,
   first fired here — a self-contained snapshot, not a join across
   four tables) and, when killed, `OPPORTUNITY_KILLED`. Idempotent: a
   second call against the same `ApprovalRequest` returns the existing
   `DecisionRecord` rather than re-attempting an illegal `KILLED →
   KILLED` transition.

## Calibration

`src/domain/decision/calibration.ts`, `calibrationService.summarize()`
— buckets historical `DecisionRecord`s by `confidenceAtDecision` and
reports the human-approval rate per bucket, explicitly flagging
`insufficientSampleSize` below 20 decisions. Read-only; never feeds
back into any scoring formula automatically (Part 38's "no automatic
model retraining"). `GET /api/decision-records/calibration-summary`.

## API

`POST /api/decision-cycles`, `GET /api/decision-cycles/:id`, `GET
/api/opportunities/:id/decision-cycles`, `GET /api/opportunities/:id/decision-records`,
`GET /api/decision-records/:id`, `POST /api/decision-records`
(`applyHumanDecision`, Human-Owner-only).
