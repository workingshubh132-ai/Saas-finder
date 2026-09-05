# Autonomous Operations Audit

Phase 0 gate for "Autonomous Operations Phase A" — verified directly
against the repository on 2026-09-05, not carried over from any prior
milestone report without re-checking. Every claim below was confirmed
by reading the actual code or running a real check.

## 1. What already works, automatically, today

- **`researchCycleService.run()`** (M3): one bounded call already
  chains signal collection → clustering → problem extraction →
  competitor/market analysis → opportunity generation. This is
  deterministic orchestration code, not model-driven — the CEO
  boundary M3 already built.
- **`decisionCycleService.run()`** (M4): claim extraction → evidence
  validation → confidence recalculation → CEO reasoning, one bounded
  call.
- **`controlPlaneService.runNextStage()`** (M9): the OperatingCycle
  dispatcher — RESEARCHING/ANALYZING summarize state, DECIDING runs the
  company-level CEO→Chairman axis, OBSERVING already automatically
  calls `predictionOutcomeService.resolveAllDue()` and
  `approvalService.expireOverdue()` in one step. This is the closest
  existing thing to "the orchestrator" the brief asks for, but it
  operates at the weekly/company-recommendation cadence, not per
  opportunity/prospect/message.
- **`eventBus`** (`src/services/event-bus.ts`, built in M1): already has
  a working `subscribe()`/`publish()` fan-out — durable persistence to
  the `events` table, then synchronous in-process callbacks. **Zero
  subscribers have ever been registered** (`grep -rn "eventBus.subscribe("
  src` — no hits outside the module itself). The exact seam this phase
  needs already exists and has simply never been used.
- **Approval staleness / resource-state hashing** (M9): `computeResourceStateHash`
  + `ApprovalSnapshot` + `approvalService.assertFresh()` already
  implement exactly the "approval must bind to exact resource state,
  invalidated if it changes" requirement — for `DeploymentPlan`,
  `BillingPlan`, `GrowthExperiment` (`src/domain/approval/resource-snapshot.ts`).
  **Not yet covering `OutreachMessage`** — a real, additive gap, not a
  design flaw (M9 was built before autonomous send existed to bind to).
- **Emergency Stop** (M9): fails closed, checked at the scheduler's move
  into EXECUTING and at all three EXECUTE call sites. Unmodified,
  reused as-is.
- **Company Budget / per-cycle budgets / per-execution budgets** (M2/M3/M9):
  layered ceilings already exist at every level the brief asks for.
- **`IDENTITY_TYPES = ["HUMAN", "AGENT", "SYSTEM"]`** (M1): `SYSTEM` has
  existed as a first-class actor type since the beginning and has never
  been used anywhere. This is the correct, already-existing primitive
  for attributing orchestrator-driven actions in the audit log — no new
  actor concept needed.
- **`founderAttentionService`/`founderDecisionQueueService`/`briefingService`**
  (M9): the founder-facing "what needs you" surface already exists and
  already unions five memo tables + PENDING approvals +
  CompanyRecommendations. This is already "show only what needs a
  decision" (brief Part 17) — extending its sources, not building a
  second one.

## 2. What is human-gated (and must stay that way)

- `messageApprovalService`: DRAFT → AWAITING_HUMAN_APPROVAL →
  APPROVED_TO_CONTACT → CONTACTED. **No send capability exists anywhere
  in this codebase** — `markContacted()`'s own doc comment: "the Human
  Owner personally sends the approved text through their own channel."
  This is the one gate Phase A is explicitly asked to extend (a real
  send *may* now exist, but only reachable after this exact same
  approval).
- `DeploymentPlan`/`BillingPlan`: PLAN → HUMAN_APPROVED → EXECUTE. The
  EXECUTE call (`deploymentService.execute`/`billingActivationService.activate`)
  already exists and is already gated on approval + freshness + budget
  + Emergency Stop — but nothing currently calls EXECUTE automatically
  the moment approval lands. That manual gap is squarely what item 8's
  "automatic resumption" targets.
- `CompanyRecommendation`/`CeoRecommendation` KILL/PREPARE_REVIEW/HUMAN_REVIEW
  actions: `decisionRecordService.requestApprovalForRecommendation()`
  must currently be called manually after a CEO recommendation is
  issued — a real, closeable gap.
- `OutreachExperiment.approve`, `assertHumanActor` on every
  human-decision entrypoint: unchanged, reused as-is.

## 3. What is fixture-only

Per `docs/M10_REAL_WORLD_AUDIT.md` (unchanged since M10): the model
provider (no `ANTHROPIC_API_KEY`), the two research sources (network-
blocked in this container), and all eight M7/M8 provider ports
(deployment/billing/secrets/monitoring/analytics/revenue/product-usage/
customer-data) — `DEV_FIXTURE` only, no live branch. **No outbound
message provider exists at all yet** — not even a fixture. This phase
adds the interface + a `DevOutboundMessageProvider`, mirroring the
established M7 provider pattern exactly.

## 4. What needs real provider integration (and can't get it here)

Same environment constraint as M10: this container's egress proxy
blocks all external HTTPS domains. A real `OutboundMessageProvider`
(email/SMTP, a forum API, etc.) cannot be exercised here regardless of
how well it's built. The interface + dev fixture + full governance
wrapper (rate limit, budget, approval-freshness, idempotency) are still
worth building now — they're real, complete, and provider-agnostic;
only the live network call is blocked.

## 5. What can be reused as-is (must not be duplicated)

Guardian/permissions, the approval engine, Chairman, the CEO reasoning
role (both per-opportunity and company-level axes — there is exactly
one CEO reasoning role today, `ceoReasoningService`, and it stays one),
`emergencyStopService`, `companyBudgetService`, `auditService`,
`eventBus` itself, `schedulerService`/`controlPlaneService`,
`decisionMemoryService`/`learningService`, every M3-M9 domain state
machine, `resource-snapshot.ts`'s hashing pattern (extended, not
replaced).

## 6. What this phase actually adds

1. `src/domain/ports/outbound-message-provider.ts` + `DevOutboundMessageProvider` +
   factory (mirrors `deployment-provider-factory.ts` exactly).
2. `hashOutreachMessage()` in `resource-snapshot.ts` (additive).
3. `autonomousOperationsService` — a deterministic eligibility-checker +
   dispatcher, registered as `eventBus` subscribers at process startup.
   Holds no Guardian permission itself and calls no service it isn't
   already permitted to call; every consequential step still goes
   through the exact service that already gated it.
4. A handful of missing event types the existing vocabulary doesn't
   already cover (checked against `DOMAIN_EVENT_TYPES` — most of the
   brief's example events already have a same-meaning existing type:
   `OPPORTUNITY_DISCOVERED`, `CUSTOMER_VALIDATED`, `CUSTOMER_RESPONSE_RECORDED`,
   `PRODUCT_READY_FOR_DEPLOYMENT`, `PRODUCT_DEPLOYED`, `REVENUE_OBSERVED`,
   `ANOMALY_DETECTED`, `HUMAN_DECISION_MADE`, `APPROVAL_APPROVED` all
   already exist and are reused verbatim, per M9's own "reuse an
   existing name wherever one already fits" precedent).
5. Two or three genuinely new event-publish call sites where a real
   moment currently publishes nothing (e.g. `signalService.ingest`),
   only where an autonomous handler actually needs to react to it.

## 7. What must NOT change

The CEO reasoning role stays singular. No new approval mechanism, no
new risk-level scheme, no new scheduler class, no new agent hierarchy,
no new database, no new memory system. `controlPlaneService`/
`OperatingCycle` stays the company-level weekly rhythm;
`autonomousOperationsService` is the finer-grained, event-triggered
layer underneath it — complementary, not a replacement.
