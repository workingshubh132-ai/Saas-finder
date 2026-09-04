# Launch & Operations Engine

M7. Moves the system from READY_FOR_DEPLOYMENT → REAL, GOVERNED
COMPANY OPERATION — a launch-planning pipeline built on the exact same
unmodified M2 `agentRuntimeService`/Guardian chain every prior
milestone's agents already run on, plus one genuinely new mechanism:
a real, human-only EXECUTE step for the handful of actions (deploy,
activate billing) that are irreversible and consequential enough to
need it. Full rationale in `docs/M7_ARCHITECTURE_PROPOSAL.md`; the
specific decisions this build made along the way are in
`docs/DECISIONS.md` #57 onward; the full security threat review is in
`docs/SECURITY.md`'s M7 section.

## The hard boundary this whole milestone answers to

VentureForge must never autonomously deploy to production, activate
billing, spend money, or take any other irreversible, external,
consequential action. It may plan a launch, price a product, propose
a go-to-market channel, and prepare a deployment — never execute one
itself. Every action above GREEN is split into three separable steps
that never collapse into one: an agent PLANS (zero tool calls, zero
real consequence), a human APPROVES (the exact-action-bound
ApprovalRequest this codebase has used since M1), and a **separate**,
human-actor-only service call EXECUTES — never reachable from any
agent, never gated by a Guardian permission grant, because Guardian
governs what agents may do and this step is a verified human
exercising their own authority directly (Constitution §2). See "The
mechanism, precisely" below.

## The pipeline

```
Product.READY_FOR_DEPLOYMENT (M6, unchanged)
  → launchOperationsService.planLaunch()
      → Product.LAUNCH_PLANNING
      → Launch Strategist         (DeploymentPlan: environment/strategy/rollback/budget check)
      → Pricing Agent             (PricingModel: tiers + deterministic unit economics)
      → GTM Agent                 (GoToMarketPlan: channels + landing-page SPEC + experiment specs)
      → CEO.recommendLaunchOperationsAction  (LAUNCH/DELAY_LAUNCH/REDUCE_COST/CHANGE_PRICING/...)
      → Chairman.reviewLaunch     (attacks pricing evidence, margin, channel evidence, budget, re-checks security/QA)
      → LaunchReviewMemo.compile → Product.AWAITING_LAUNCH_APPROVAL  ── HARD GATE 3 (Human Owner)
  → (human APPROVE) → deploymentPlanService.requestApproval → approvalService.decide  ── HARD GATE 4 (Human Owner, exact plan bound)
  → deploymentService.execute()  ── the EXECUTE step: DevDeploymentProvider.deploy() → Product.LIVE
  → monitoringService.checkHealth()  (on demand)
  → BusinessMetric rows (OBSERVED vs. ESTIMATED, structurally distinct)
  → CEO.recommendLaunchOperationsAction again  (a real operating recommendation from live data)
```

Billing runs the identical PLAN → APPROVE → EXECUTE shape on its own
axis: `billingPlanService.create/requestApproval/applyDecision` →
`billingActivationService.activate()` (ACTIVATE_BILLING EXECUTE,
against the DEV_FIXTURE `BillingProvider` only) → a `BillingAccount` →
a real, signed webhook delivery → a correctly-labeled `BusinessMetric`.

`launchOperationsService.planLaunch()` is the one orchestration entry
point that drives a `Product` through the entire PLANNING chain in a
single bounded call, mirroring `productFactoryService.build()`'s own
precedent (M6) exactly — deterministic orchestration CODE layered on
top of every unmodified agent service below. It never rolls back
partial work: every row already committed stays exactly as it is if a
later stage fails.

## Product lifecycle (extends M6, unchanged up through READY_FOR_DEPLOYMENT)

```
READY_FOR_DEPLOYMENT → LAUNCH_PLANNING → AWAITING_LAUNCH_APPROVAL → DEPLOYING → LIVE ⇄ PAUSED
                                                  ↑        ↓                      ↓        ↓
                                        (REQUEST_CHANGES) (REJECT→FAILED)    (human kill) (human kill)
                                                                              ARCHIVED    ARCHIVED
LAUNCH_PLANNING / AWAITING_LAUNCH_APPROVAL → FAILED → ARCHIVED (existing terminal path, unchanged)
```

`LIVE`/`PAUSED` deliberately never transition to `FAILED` — a live
product's operational problems are `Incident` rows, not a
Product-status regression. A failed EXECUTE attempt reverts
`DEPLOYING → AWAITING_LAUNCH_APPROVAL`, never straight to `FAILED`:
the same already-approved `DeploymentPlan` stays retriable without a
fresh approval, and every retry is its own fully human-triggered call
— no automatic loop exists anywhere in this milestone.
`LIVE`/`PAUSED → ARCHIVED` models a human's deliberate kill of a live
product directly (`CONSTITUTION.md`: "Final authority for high-impact
shutdown decisions remains with the Human Owner"). `LIVE` is real only
when a real `Deployment` row with `status: "LIVE"` exists — never set
speculatively, never set by an agent.

## The mechanism, precisely — PLAN / APPROVE / EXECUTE

`agentRuntimeService.callTool` throws immediately the moment a tool's
permission resolves to `REQUIRES_APPROVAL` — no mechanism exists
anywhere in this codebase to suspend an execution mid-run for a human
decision and resume it. That is true for every permission above
GREEN: YELLOW, ORANGE, and RED alike. So no M7 agent ever calls a tool
gated on `DEPLOY_PRODUCTION`/`ACTIVATE_BILLING`/`CREATE_BILLING`/
`MODIFY_PRODUCTION`/`ACCESS_PRODUCTION_DATA` — every M7 agent holds
**zero** permissions, continuing M6's own established pattern exactly.

Instead, every consequential action above GREEN is three separable
steps:

1. **PLAN** — an agent (zero tool calls) produces a structured
   recommendation; the orchestrating *service* — never the agent —
   persists it as an immutable row (`DeploymentPlan`/`BillingPlan`, no
   update method beyond a status transition, mirroring
   `OutreachMessage.content`'s own immutability discipline). GREEN by
   construction: nothing external happens, nothing costs money.
2. **APPROVE** — a human calls the *existing, unmodified*
   `approvalService.requestApproval`/`.decide` — the same
   `ApprovalRequest` table every RED-risk action has used since M1 —
   bound to the exact plan row's id.
3. **EXECUTE** — a second, separate, human-actor-only service method
   (`assertHumanActor`, never `agentRuntimeService`) re-verifies that
   an `APPROVED` `ApprovalRequest` exists and is bound to the *exact*
   plan about to run, then — only then — calls a Provider abstraction
   and persists what actually happened.

This is not a workaround invented for M7 — it is
`messageApprovalService` (M5), used unchanged, generalized by one new
step: `deploymentPlanService`/`billingPlanService` mirror
`requestApproval`/`applyDecision` exactly; `deploymentService.execute`/
`billingActivationService.activate` are the one genuinely new kind of
step M7 introduces, because M5 never had a real external side effect
to perform after approval and M7 does (a dev-fixture one, §7).

## Provider abstraction — dev-fixture only

`DeploymentProvider`/`BillingProvider`/`SecretProvider`/
`AnalyticsProvider`/`MonitoringProvider` each have exactly one
implementation in this milestone: an in-memory, zero-network,
`DEV_FIXTURE`-labeled class. No real provider (Stripe, Vercel, any
other) is implemented — a deliberate, load-bearing decision (secrets
management, a real public webhook attack surface, and this session's
own proxied network are all orthogonal risks this milestone's actual
job — proving the governance model — doesn't require taking on). Every
factory (`src/providers/*-provider-factory.ts`) is a single seam a
real implementation could be dropped behind later without touching any
calling code, mirroring `createModelProvider()`'s own precedent (M2).

## Webhook security — `POST /api/billing-webhooks/dev-fixture`

The one genuinely public-shaped endpoint in this milestone — no
bearer-token auth, mounted with `express.raw()` ahead of the app's
global `express.json()` so HMAC verification runs against the real
raw bytes. Built to the standard a real provider integration would
need even though its only caller here is the dev-fixture provider/test
harness: source validation before signature checking, a real HMAC-SHA256
signature (`src/domain/webhook/webhook-security.ts`), a 5-minute replay
window, delivery-id idempotency (`WebhookDelivery`, unique per
provider), and `auditService.record` on every branch — accepted or
rejected.

## Cost controls

`checkLaunchBudget()` (`src/domain/product/launch-budget.ts`) — a
small, deterministic, founder-revisable ceiling ($200/month by
default), checked at PLAN time and stored as a real
`DeploymentPlan.budgetExceeded` column, never a prose note. An
over-budget plan is never blocked from being *created* — the Chairman
and CEO must see it to weigh it — but the Chairman's `reviewLaunch`
treats it as a required objection, and the CEO's dev fixture always
recommends `REDUCE_COST` for it.

## CEO + Chairman: a fourth and third distinct entry point

`ceoReasoningService.recommendLaunchOperationsAction` (a fourth axis
alongside M4's opportunity-kill, M5's customer-discovery, and M6's
product-build) and `chairmanService.reviewLaunch` (a third, focused
review) mirror the exact "distinct entry point per decision axis"
precedent every prior milestone established for the CEO/Chairman. The
Chairman's launch review explicitly attacks the launch thesis —
willingness-to-pay evidence, unmeasured cost vs. projected margin,
channel evidence, budget — *and* re-checks the same
`CodeReview`/`QaReport`/`SecurityReview` verdicts `reviewProduct`
already checked, never taking an earlier human override on faith.

## LaunchReviewMemo — `src/services/launch-review-memo.service.ts`

Zero new model calls, same discipline as `productReviewMemoService`:
every field assembled from already-computed real data.
`recordHumanDecision` is the one place a decision is actually applied:
`APPROVE` leaves `Product` at `AWAITING_LAUNCH_APPROVAL` (a human
separately requests the `DeploymentPlan`'s own RED-tier approval next
— this decision alone never deploys anything), `REJECT → FAILED`,
`REQUEST_CHANGES → LAUNCH_PLANNING` (a bounded rework pass), `DEFER`
leaves Product unchanged.

## Structural, not just policy

- Every M7 agent (Launch Strategist, Pricing, GTM, Support) holds
  **zero** Guardian permission grants — verified by a real test
  (`tests/integration/m7-security.test.ts`), not a comment.
- `DEPLOY_PRODUCTION`/`ACTIVATE_BILLING`/`MODIFY_PRODUCTION` are RED;
  `ACCESS_PRODUCTION_DATA` is ORANGE; `CREATE_BILLING` is YELLOW — each
  classified against `CONSTITUTION.md` §8's own examples, never vibes.
  None is ever granted to an agent; the vocabulary exists for
  `ApprovalRequest.riskLevel` values and CEO/Chairman reasoning.
- No code path anywhere in M7 calls a real hosting API, a real payment
  API, or sends a message to a customer — the GTM Agent produces a
  plan and a spec only.
- `BusinessMetric.valueKind` (`OBSERVED`/`ESTIMATED`) and `.source`
  (`DEV_FIXTURE`/`MANUAL_ENTRY`/`COMPUTED_ESTIMATE`) are real,
  non-optional columns — an aggregate that blends observed and
  estimated numbers without a label is exactly the "fake business"
  failure mode Section 45 of the brief forbids, prevented in the
  schema, not just in prose.
- No scheduler/cron infrastructure exists anywhere in this codebase —
  `monitoringService.checkHealth` is on-demand only, a stated
  limitation, not a silent gap.

## What M7 does not claim

No product launched by this milestone has real customers, real
revenue, or real uptime unless a human has independently verified that
outside this system. `LIVE` means the `DEV_FIXTURE` `DeploymentProvider`
reports live — never that real traffic can reach anything. Every
subscription/webhook/business-metric fixture in this milestone is
clearly labeled `DEV_FIXTURE`/`ESTIMATED` and is genuinely derived from
real input data, never a static stub — see each service's own
`buildDev*Fixture` function and `tests/integration/m7-capstone-billing.test.ts`'s
own explicit `source`/`valueKind` assertions.
