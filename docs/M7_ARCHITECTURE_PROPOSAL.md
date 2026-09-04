# M7 Architecture Proposal — SaaS Launch & Operations Engine

Phase 0 gate, per the M7 brief's own closing instruction: no M7
implementation begins until this document is complete and reviewable.
Every section below is a real decision with real rationale, not a
restatement of the brief — where the brief leaves something open
("these are proposals, not mandatory tables," "determine the smallest
correct model"), this document makes the call and says why.

## 1. What M7 is

M6 stops at `READY_FOR_DEPLOYMENT`: a human-reviewable plan exists,
nothing is live. M7 picks up from exactly that point and adds the
governed machinery to take a human-approved, customer-validated,
technically-ready MVP through launch planning, infrastructure and
billing preparation, a real (but fixture-scoped) deployment, and
ongoing operations — monitoring, support, incidents — without ever
letting the system autonomously spend money, activate real billing,
or deploy to a real production target without a human explicitly
triggering that exact action. Every new capability in this document
is either PLANNING (an agent proposes, zero tool calls, zero real
consequence) or EXECUTION gated behind a human-only trigger that
re-verifies an exact, already-recorded approval before it runs
(§5–§6). Nothing in between exists.

## 2. M6 audit — what already exists and what M7 must not disturb

Read in full for this proposal: `docs/M6_ARCHITECTURE_PROPOSAL.md`,
`prisma/schema.prisma` (1807 lines), `src/domain/risk/risk-level.ts`,
`src/domain/permission/permission.ts`,
`src/domain/risk/permission-risk-policy.ts`,
`src/services/agent-runtime.service.ts`,
`src/services/authorization.service.ts`,
`src/services/approval.service.ts`,
`src/services/message-approval.service.ts`,
`src/services/agent.service.ts`, `src/services/product.service.ts`,
`src/services/product-factory.service.ts`,
`src/services/ceo-reasoning.service.ts`, `src/services/chairman.service.ts`,
`src/domain/product/product.types.ts`, `src/domain/product/cost-estimate.ts`,
`src/services/calibration.service.ts`, `CONSTITUTION.md`,
`docs/SECURITY.md`, `docs/DECISIONS.md`, every M1–M6 route file.

What this confirms, concretely:

- **The hook M7 starts from**: `Product.status = "READY_FOR_DEPLOYMENT"`,
  `Product.deploymentPlan`/`rollbackPlan` (single JSON-text fields,
  non-historized, no approval binding — a text plan a human reads, not
  an executable artifact), `estimatedDevelopmentCostUsd`/
  `estimatedOperatingCostUsd`. The `PRODUCT_READY_FOR_DEPLOYMENT` domain
  event already fires (`product.service.ts` `setStatus`). M7 extends
  the same `Product` row past this point rather than creating a
  parallel "launch" entity disconnected from the product it launches.
- **The CEO/Chairman "one more entry point per decision axis" pattern**,
  used three times already (`ceoReasoningService.run` for
  opportunity-kill, `.recommendCustomerDiscoveryAction`,
  `.recommendProductBuildAction`; `chairmanService.review` and
  `.reviewProduct`) — same shared `ceo_recommendations`/
  `chairman_reviews` tables regardless of which axis produced the row.
  M7 adds a fourth/third pair the same way (§28–§29).
- **The "compile with zero new model calls" memo pattern**
  (`productReviewMemoService`, `investmentMemoService`,
  `customerDiscoveryMemoService`) — every memo assembles already-computed
  real data, never asks a model to re-synthesize what's already on
  disk. M7's `LaunchReviewMemo` follows it exactly (§31).
- **The calibration-extension pattern** (`calibrationService.summarize`
  → `.summarizeCustomerDiscovery` → a third method for M6's product
  memos) — built to be extended a third/fourth time with an explicit
  `positiveDecision` parameter, never a cloned bucketing loop
  (`docs/DECISIONS.md` #49). M7 adds `.summarizeLaunch` (§42).
- **No real git/filesystem-branch manipulation, no autonomous external
  API calls anywhere in M1–M6** — the system has never, in six
  milestones, actually called an external paid service. M7 is the
  first milestone where the *temptation* to do so is real (deploy
  somewhere, bill someone), which is exactly why §7's "dev-fixture-only"
  decision matters most here.
- **Two-narrower-GREEN-permissions-instead-of-reclassifying** precedent
  (`docs/DECISIONS.md` #50) — relevant, but, as §4–§6 show, does not
  directly apply to M7's hardest problem, because M7's hardest actions
  are not YELLOW capabilities an agent needs mid-execution; they are
  RED/ORANGE actions a *human* must trigger directly.
- **The exact bug class to avoid a second time**: `docs/DECISIONS.md`
  #56 records that M6's own migration widened three tables' CHECK
  constraints but missed a fourth (`agent_permissions.permission`),
  caught only by the first real grant. M7 adds five new permission
  values (§30) — the migration that adds M7's tables must widen that
  same CHECK constraint in the same pass, and a real
  `agentService.grantPermission` test for each new value is a
  verification gate before M7 is considered done, not an afterthought.

## 3. The structural constraint that governs every design choice below

`agentRuntimeService.callTool` (`src/services/agent-runtime.service.ts`
lines 185–203): for every permission a tool requires, it calls
`authorizationService.authorize`. If that resolves to
`REQUIRES_APPROVAL`, `callTool` throws `AuthorizationDeniedError`
**immediately** — there is no mechanism anywhere in this codebase to
suspend an execution mid-run, wait for a human decision, and resume.
The comment at that exact call site is explicit: *"M2 does not
implement suspending an execution mid-run for human approval... Failing
closed is the safe default until it does."* This has held, unchanged,
through M2–M6.

`authorizationService.evaluate` (`authorization.service.ts` lines
23–54) resolves `REQUIRES_APPROVAL` for **any** permission whose
`RiskPolicy.requiresApproval` is `true` — which, per §4 below, is
every permission above GREEN: YELLOW, ORANGE, *and* RED alike.

**Consequence**: no agent tool call gated on a YELLOW, ORANGE, or RED
permission can ever complete inside a normal `agentRuntimeService.run()`
call, full stop — not because M7 chooses extra caution, but because
the runtime cannot execute that code path today. Every M7 action at
YELLOW or above (deploy, activate billing, spend money, modify
production, access production data) must therefore be structured so
that no agent ever calls a tool gated on it. This is not a policy
choice this document is making; it is a fact about the code M7 must
build on top of, and §5 is the direct answer to it.

## 4. RiskLevel is already a 4-tier system — no core change needed

`src/domain/risk/risk-level.ts` already defines
`RISK_LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"]` with a full
`RISK_POLICY` (M1/M2-era, predating this document) whose exact
semantics are precisely what M7 needs:

| Level | requiresApproval | requiresChairman | autoExecutableAfterApproval |
|---|---|---|---|
| GREEN | false | false | true |
| YELLOW | true | false | true |
| ORANGE | true | **true** | true |
| RED | true | false | **false** |

RED's `autoExecutableAfterApproval: false` is, verbatim, the
Constitution's own RED definition: *"AI may prepare everything but
cannot independently execute the action"* (`CONSTITUTION.md` §8). This
is the exact mechanism M7's Section 0 demands — it already exists,
unused above ORANGE/RED in practice (`SPEND_MONEY` is the only RED
permission ever declared, and per `docs/DECISIONS.md` it has never
been granted to any agent; `ACCESS_SECRET`/`MODIFY_CONFIGURATION` are
ORANGE, also never granted). **M7 is the first milestone to actually
exercise ORANGE and RED in a live pipeline — no new tier, no schema
change, no code change to `risk-level.ts` or `permission-risk-policy.ts`'s
shape.** This resolves what was, going into this proposal, an open
question about whether a 4th tier needed to be added; it did not.

The Constitution's own §8 examples anchor every new permission's
classification in §30 — not vibes, the literal text: YELLOW's own
examples include *"major deployment"* and *"external account
creation"*; ORANGE's include *"launching a new SaaS"* and
*"significant infrastructure changes"*; RED's include *"major
financial transfers"* and *"substantial irreversible commitments."*

## 5. The core mechanism: PLAN → APPROVE → EXECUTE

Given §3, every M7 capability above GREEN is built as three separable
steps, never one:

1. **PLAN** — an agent (zero tool calls, zero permissions, exactly
   like every M6 agent) reads already-persisted data and produces a
   structured recommendation. The orchestrating **service** — not the
   agent, not a tool call — persists it as an immutable row (no update
   method, mirroring `OutreachMessage.content`'s own immutability
   discipline exactly). This is GREEN by construction: nothing external
   happens, nothing costs money, nothing is irreversible.
2. **APPROVE** — a human calls the *existing, unmodified*
   `approvalService.requestApproval` / `.decide` (§6) to record a real
   decision bound to that exact plan row's id (`resourceType`/
   `resourceId`), through the same `ApprovalRequest` table every prior
   milestone's RED-risk action has used since M1.
3. **EXECUTE** — a second, separate, **human-actor-only** service
   method (`assertHumanActor`, not `agentRuntimeService`) re-verifies
   that an `ApprovalRequest` with status `APPROVED` exists and is
   bound to the *exact* plan row about to run, then — and only then —
   calls a Provider abstraction (§7) and persists what actually
   happened. This step is never reachable from any agent execution;
   it has no tool, no `toolId`, no Guardian permission check, because
   Guardian governs what *agents* may do, not what a verified human
   does directly with their own authority (`CONSTITUTION.md` §2: *"The
   Human Owner possesses ultimate authority... No AI component may
   prevent the Human Owner from exercising these powers"*).

```
Agent (0 tools) ──▶ PlanRow (immutable, persisted by service code)
                         │
                         ▼
Human ──▶ approvalService.requestApproval/.decide  (unmodified, §6)
                         │  APPROVED, bound to PlanRow.id
                         ▼
Human ──▶ xService.execute({ planId, actor })       (NEW in M7)
             assertHumanActor(actor)
             re-verify ApprovalRequest.status === APPROVED
               && ApprovalRequest.resourceId === planId   ← exact-action binding
             provider.doTheThing(...)                     (§7, dev-fixture only)
             persist the real outcome row
```

An approval never means "the agent may now do this class of thing
generally" — it means "this specific plan row, and only this row, may
now run," matching the brief's Section 1 principle (*Deployment Plan ≠
Deployment; Pricing Recommendation ≠ Billing Activation*) structurally,
not just by convention.

## 6. Why this is the existing mechanism, not a new one

This is not a workaround invented for M7 — it is `messageApprovalService`
(`src/services/message-approval.service.ts`), used unchanged since M5,
generalized by one new step. Its own doc comment calls
`OutreachMessage` approval *"the second hard human gate"* and is
explicit that *"Approval binds to the EXACT message row —
ApprovalRequest.resourceId is the message's own id, so 'approve
message A' can never become 'send message B.'"* `applyDecision`
re-verifies `approvalRequest.resourceId` against the message being
acted on before doing anything; `markContacted` re-verifies a second
time, requiring the message's own bound `ApprovalRequest` to still be
`APPROVED`. Both are `assertHumanActor`-gated, plain service methods,
never routed through `agentRuntimeService`.

The one genuinely new piece: M5 never needed an EXECUTE step, because
nothing in this system before M7 had a real external side effect to
perform after approval — `markContacted` only flips a status column;
*"no code path in this system ever sends anything externally"* (its
own comment). M7's EXECUTE steps do call something real: a Provider
(§7). That Provider is dev-fixture-only (§7's own justification), so
the actual blast radius of "real" stays zero — but the shape of the
code (re-verify exact approval, then act) is identical to what already
ships and is tested.

`approvalService` itself is untouched: no new status, no new
transition, no new field. `SelfApprovalError` (an agent's own actor id
cannot equal `requestedByAgentId`) continues to apply everywhere
without change.

## 7. Provider abstraction — pattern and the dev-fixture-only decision

Every external system M7 touches (deployment target, billing platform,
secrets store, analytics sink, monitoring/health endpoint) is behind a
narrow, purpose-shaped interface with **exactly one implementation
built in M7: an in-memory, zero-network, explicitly-labeled dev/fixture
provider.** No real provider (Stripe, Vercel, Render, Fly.io, anything)
is implemented in this milestone. This is a deliberate, load-bearing
decision, not a shortcut:

1. **Secrets.** A real provider needs a real credential — even a
   Stripe *test-mode* key is a real secret requiring real safe storage,
   real access boundaries, real leak-prevention (§14). M7's job is to
   prove the *governance* model (plan/approve/execute, exact-action
   binding, cost/security review) is safe and complete; adding a real
   credential surface is an orthogonal risk that belongs in a milestone
   that can give it full, dedicated attention.
2. **Attack surface.** A real provider means a real, internet-reachable
   webhook endpoint. §20 designs that endpoint's security properties
   (signature verification, replay protection, idempotency) to the
   same standard a real integration would need — but exercises it with
   a same-process fixture caller, so the design is validated without
   exposing a live endpoint this milestone has no budget to harden
   against real adversarial traffic on top of everything else M7 must
   ship.
3. **Environment reliability.** This session's outbound network is
   proxied (see environment notes); a real provider SDK's own network
   behavior, retry semantics, and error shapes are untested and
   unverifiable here. A fixture provider is deterministic and testable
   by construction.
4. **The brief's own license.** Section 7/§ Provider abstraction says
   "implement only what's required... start with a safe dev/local
   provider and **at most one** real provider **only if justified**."
   Nothing about M7's success criteria requires a real provider — the
   capstone tests (§40) explicitly ask for fixture-based verification.
   Given 1–3 above, no real provider is justified in this milestone.

This is fully reversible and cheap to extend later: every provider
interface below is designed so a real implementation is a new class
satisfying the same interface, swapped in via the same
`providers/model-provider-factory.ts`-style factory pattern this
codebase already uses for the model provider — zero changes to any
calling service. Every dev provider's output is labeled `DEV_FIXTURE`
in a real, structural column (never just prose), read the same way
`docs/SAAS_FACTORY.md` already documents for M6's own dev fixtures.

## 8. DeploymentProvider

```ts
interface DeploymentProvider {
  readonly id: string; // "DEV_FIXTURE" for the only M7 implementation
  validate(input: { environment: string; artifactRef: string }): Promise<{ valid: boolean; reason?: string }>;
  plan(input: DeployPlanInput): Promise<{ summary: string; estimatedDowntimeSeconds: number }>;
  deploy(input: DeployInput): Promise<{ status: "LIVE" | "FAILED"; providerRef: string; detail: string }>;
  status(providerRef: string): Promise<{ status: "LIVE" | "FAILED" | "UNKNOWN" }>;
  rollback(input: { providerRef: string }): Promise<{ status: "ROLLED_BACK" | "FAILED"; detail: string }>;
}
```

`DevDeploymentProvider` is an in-memory `Map`, zero network calls,
`providerRef` a generated fixture id (`dev-deploy-<cuid>`). `deploy()`
never fails for an arbitrary reason — it fails deterministically when
the input is invalid (matches the same "derived from real input, never
a static stub" discipline every prior dev fixture in this codebase
follows), so tests are reproducible.

## 9. BillingProvider

```ts
interface BillingProvider {
  readonly id: string; // "DEV_FIXTURE"
  createProduct(input: { name: string; description: string }): Promise<{ providerProductRef: string }>;
  createPrice(input: { providerProductRef: string; amountUsdCents: number; interval: "MONTH" | "YEAR" }): Promise<{ providerPriceRef: string }>;
  createCustomer(input: { email: string }): Promise<{ providerCustomerRef: string }>;
  createSubscription(input: { providerCustomerRef: string; providerPriceRef: string }): Promise<{ providerSubscriptionRef: string; status: "ACTIVE" }>;
  cancelSubscription(input: { providerSubscriptionRef: string }): Promise<{ status: "CANCELLED" }>;
  status(providerSubscriptionRef: string): Promise<{ status: string }>;
}
```

`DevBillingProvider` is the same in-memory shape. Its
`createSubscription` is what the billing capstone test (§40) exercises
to produce a labeled fixture subscription — never presented, logged,
or reported as real revenue (§45).

## 10. SecretProvider

A minimal interface only — `get(name): Promise<string | null>` /
`set(name, value): Promise<void>` — exists so a future real provider
integration has somewhere to read a real credential from without
touching calling code. M7's own dev providers need **zero** real
secrets (no API keys of any kind), so `DevSecretProvider` is a fixture
that stores only clearly-fake, clearly-labeled values and is never
wired to anything that could hold a real one. This mirrors
`createModelProvider()`'s own existing pattern
(`src/providers/model-provider-factory.ts`): a real credential, if one
is ever configured, loads from `process.env` at process start, is
never persisted to the database, and is never readable by any agent
(no tool anywhere exposes environment variables).

## 11. AnalyticsProvider

```ts
interface AnalyticsProvider {
  readonly id: string; // "DEV_FIXTURE"
  track(event: { name: string; productId: string; properties: Record<string, unknown> }): Promise<{ recorded: boolean }>;
}
```

`DevAnalyticsProvider` records events in-memory and, in the demo/tests,
is used to seed a handful of realistic `BusinessMetric` rows (§16,
§23) — every one tagged `valueKind: "ESTIMATED"` or an explicit
fixture-observed value, never presented as real user telemetry.

## 12. MonitoringProvider

```ts
interface MonitoringProvider {
  readonly id: string; // "DEV_FIXTURE"
  checkHealth(input: { deploymentId: string }): Promise<{ healthy: boolean; latencyMs: number; detail: string }>;
}
```

Called **on demand** (an API call or the demo script triggers a check),
never on a background schedule — this codebase has no scheduler/cron
infrastructure anywhere in M1–M6, and building one is out of scope for
this milestone (§45). This is a real, named limitation, not a silent
gap: `docs/SAAS_FACTORY.md`-style documentation for M7 will say so
explicitly.

## 13. Environment management

"Environment" is a plain string column (`"DEV" | "STAGING" | "PRODUCTION"`)
on `DeploymentPlan`/`Deployment` — no real environment is provisioned,
no real DNS, no real infrastructure-as-code. A `DeploymentPlan`
targeting `PRODUCTION` is exactly as fixture-scoped as one targeting
`STAGING`; the field exists so the plan, the approval, and the
Chairman's review can all reason about which environment is meant,
and so a real provider (if ever added) has a real value to route on.

## 14. Credential boundaries

Restated plainly because Section 0 of the brief treats this as
load-bearing: M7 introduces no real external credential of any kind.
If a founder later configures a real `DeploymentProvider`/
`BillingProvider`, its credential follows the exact discipline already
proven in `model-provider-factory.ts` — environment variable at
process start, never written to any table, never returned by any API
response, never readable through any tool a Guardian permission could
grant an agent. No M7 code path introduces a way for an agent to read
`process.env`.

## 15. Product lifecycle extension

Extends `PRODUCT_STATUSES`/`PRODUCT_STATUS_TRANSITIONS`
(`src/domain/product/product.types.ts`) past `READY_FOR_DEPLOYMENT`,
which stays exactly as M6 left it:

```
READY_FOR_DEPLOYMENT → LAUNCH_PLANNING → AWAITING_LAUNCH_APPROVAL → DEPLOYING → LIVE ⇄ PAUSED
                                                                                  ↘        ↙
                                                                                   ARCHIVED
LAUNCH_PLANNING / AWAITING_LAUNCH_APPROVAL / DEPLOYING → FAILED → ARCHIVED (existing terminal path, unchanged)
```

```ts
READY_FOR_DEPLOYMENT: ["LAUNCH_PLANNING", "ARCHIVED"],       // ARCHIVED unchanged from M6
LAUNCH_PLANNING: ["AWAITING_LAUNCH_APPROVAL", "FAILED"],
AWAITING_LAUNCH_APPROVAL: ["DEPLOYING", "LAUNCH_PLANNING", "FAILED"], // rejection -> rework
DEPLOYING: ["LIVE", "FAILED"],
LIVE: ["PAUSED", "ARCHIVED"],                                  // human PAUSE or human KILL
PAUSED: ["LIVE", "ARCHIVED"],                                  // human resume or human KILL
```

`LIVE`/`PAUSED` deliberately do **not** transition to `FAILED` —
`FAILED` means "this build/launch attempt failed," which doesn't
describe an already-live product; a live product's operational
problems are `Incident` rows (§26), not a Product-status regression.
`LIVE`/`PAUSED → ARCHIVED` models a human's deliberate kill of a live
product directly — `CONSTITUTION.md`: *"Final authority for high-impact
shutdown decisions remains with the Human Owner."* `setStatus` to
`DEPLOYING`/`LIVE` is called **only** from the new EXECUTE-step
services (§17), never from `productFactoryService` and never from any
agent-reachable code path — matching M6's own discipline that
`READY_FOR_DEPLOYMENT` is the factory's own terminal state.

`LIVE` is real only when a real `Deployment` row with `status: "LIVE"`
exists — never set speculatively, never set by an agent, matching
Section 45 (*"Do not create fake production states for fixtures"*)
exactly. Because M7 ships with `DevDeploymentProvider` only (§7/§8),
"LIVE" in this milestone always means *"the dev-fixture provider
reports LIVE,"* which is why every UI/API surface that reports Product
status must also surface `Deployment.provider` alongside it — a human
must never be able to read "LIVE" and reasonably conclude "real
customers can reach this."

## 16. Database changes — the smallest correct model

New tables, historized where a later human decision needs to see what
was true *at proposal time* (mirrors `OpportunityScoreRecord`/
`MvpArchitecture`'s own historization precedent), append-only/immutable
where an approval must bind to an exact, unchangeable row (mirrors
`OutreachMessage`):

- **`LaunchPlan`** — one per launch attempt (`productId`, historized).
  A thin roll-up: references to the `PricingModel`/`DeploymentPlan`/
  `GoToMarketPlan` in play, a compiled summary, `status`. This is the
  thing `LaunchReviewMemo` (§31) is compiled from — analogous to how
  `ProductSpec`+`MvpArchitecture` together fed `ProductReviewMemo`.
- **`DeploymentPlan`** — immutable once created (`productId`,
  `environment`, `provider`, `strategy`, `estimatedCostUsd`,
  `rollbackPlan`, `artifactRef`, `approvalRequestId` nullable-until-
  requested, `status`: `DRAFT → PENDING_APPROVAL → HUMAN_APPROVED →
  EXECUTED → FAILED`). Replaces relying solely on `Product.deploymentPlan`'s
  bare JSON-text field for anything that now needs real approval
  binding and a real status lifecycle; `Product.deploymentPlan`/
  `rollbackPlan` stay exactly as M6 left them (a human-readable summary
  copied at compile time), never repurposed.
- **`Deployment`** — one row per actual EXECUTE call (`deploymentPlanId`,
  `provider`, `environment`, `status`: `LIVE | FAILED | ROLLED_BACK`,
  `providerRef`, `deployedByIdentityId`, `deployedAt`, optional
  self-relation `rolledBackFromId` for rollback lineage).
- **`PricingModel`** — historized (`productId`, `tiers` JSON,
  `unitEconomics` JSON — cost-per-customer, estimated margin, all
  computed by deterministic code from real cost-estimate inputs, never
  a model's own arithmetic), `groundedInClaimIds`/
  `groundedInEvidenceIds` (same non-empty-array discipline as
  `ProductSpec`).
- **`BillingPlan`** — the `CREATE_BILLING`-tier artifact (`productId`,
  `pricingModelId`, `provider`, `status`: `DRAFT → HUMAN_APPROVED →
  ACTIVE → SUSPENDED → CANCELLED`, `approvalRequestId`).
- **`BillingAccount`** — created only by the ACTIVATE_BILLING EXECUTE
  step (§19): `billingPlanId`, `provider`, `providerProductRef`,
  `providerPriceRef`, `status`, `activatedByIdentityId`, `activatedAt`.
- **`GoToMarketPlan`** — (`productId`, `channels` JSON, `landingPageSpec`
  JSON, `experiments` JSON — each an EXPERIMENT SPEC only, never a real
  campaign; `groundedInClaimIds`).
- **`BusinessMetric`** — the structural "observed vs. estimated"
  enforcement Section 45 demands: `productId`, `metricType`
  (`REVENUE_USD | ACTIVE_SUBSCRIPTIONS | UPTIME_PCT | CONVERSION_RATE |
  ...`), `valueKind: "OBSERVED" | "ESTIMATED"` (a real column, not a
  prose label), `value`, `source` (`"DEV_FIXTURE" | "MANUAL_ENTRY" |
  ...`), `recordedAt`. Every read/report path groups or labels by
  `valueKind` — an aggregate that silently blends observed and
  estimated numbers is exactly the "fake business" failure mode
  Section 45 forbids, so it is prevented in the schema, not just in
  prose.
- **`Incident`** — (`productId`, `deploymentId` nullable,
  `severity`, `status`: `DETECTED → TRIAGED → INVESTIGATING →
  MITIGATING → RESOLVED → POSTMORTEM`, `detectedAt`, timestamps per
  transition, `postmortem` nullable text).
- **`SupportCase`** — (`productId`, `customerRef` (a label, never real
  PII beyond what a human pastes in — same privacy boundary as M5's
  `CustomerResponse.rawContent`, §36), `status`: `OPEN → TRIAGED →
  IN_PROGRESS → WAITING_FOR_CUSTOMER → RESOLVED → ESCALATED`,
  `triageRecommendation` (agent-authored, judgment only)).

Every new table follows the existing conventions without exception:
`cuid()` ids, `@map`/`@@map` snake_case, a `status` column validated
only at the domain-type layer (never a DB enum, matching every prior
milestone), indexes on `status` and the natural foreign key, and the
CHECK-constraint migration gap named in §2/§30 fixed in the same pass
that creates these tables.

## 17. Deployment abstraction + safety flow, concretely

```ts
// PLAN — agent, 0 tools, 0 permissions
launchStrategistService.proposeDeploymentPlan({ agentId, productId, startedBy })
  → reads Product/MvpArchitecture/cost-estimate, drafts environment/strategy/rollback
  → deploymentPlanRepository.create({ ...draft, status: "DRAFT" })   // immutable henceforth

// human requests approval — service, not agent
deploymentPlanService.requestApproval({ deploymentPlanId, actor })
  → assertHumanActor(actor)  // a human decides a plan is even ready to submit; mirrors Product.approve's HARD GATE shape
  → approvalService.requestApproval({ action: "DEPLOY_PRODUCTION", riskLevel: "RED",
      resourceType: "DEPLOYMENT_PLAN", resourceId: plan.id, ... })
  → deploymentPlanRepository.attachApprovalRequest(plan.id, approvalRequest.id); status → PENDING_APPROVAL

// human decides — UNMODIFIED approvalService.decide (§6)

// human applies the decision onto the plan's own status — mirrors messageApprovalService.applyDecision
deploymentPlanService.applyDecision({ approvalRequestId, actor })
  → re-verify resourceType === "DEPLOYMENT_PLAN"; idempotent if already applied
  → APPROVED → status: "HUMAN_APPROVED" ; REJECTED → status: "FAILED"

// EXECUTE — human-only, the one new kind of step M7 introduces (§6)
deploymentService.execute({ deploymentPlanId, actor })
  → assertHumanActor(actor)
  → plan = deploymentPlanRepository.getOrThrow(deploymentPlanId)
  → if plan.status !== "HUMAN_APPROVED": throw ValidationError
  → approvalRequest = approvalService.getOrThrow(plan.approvalRequestId)
  → if approvalRequest.status !== "APPROVED" || approvalRequest.resourceId !== plan.id:
      throw NotFoundError("Approved ApprovalRequest for DeploymentPlan", plan.id)   // exact-action re-verification
  → result = await deploymentProvider.deploy({ environment: plan.environment, artifactRef: plan.artifactRef })
  → deployment = deploymentRepository.create({ deploymentPlanId: plan.id, provider: deploymentProvider.id,
      status: result.status, providerRef: result.providerRef, deployedByIdentityId: actor.actorId, deployedAt: new Date() })
  → if result.status === "LIVE": productService.setStatus(plan.productId, "LIVE", actor)
  → auditService.record(...); eventBus.publish({ type: "PRODUCT_DEPLOYED", ... })
  → return deployment
```

No step above is reachable from `agentRuntimeService` — `execute` is a
plain async function, callable only from an authenticated-HUMAN route
handler, exactly like `productService.approve`.

## 18. Rollback

`deploymentService.rollback({ deploymentId, actor })` follows the
identical shape to `execute`: `assertHumanActor`, load the
`Deployment`, call `deploymentProvider.rollback({ providerRef })`,
persist a new `Deployment` row with `rolledBackFromId` set and
`status: "ROLLED_BACK"`, transition `Product` `LIVE → PAUSED` (a
rollback is never silently "fine" — a human decides whether/when to
redeploy). Rollback is **not** gated behind a fresh `ApprovalRequest`
— Section 0's own concern is unauthorized *forward* action (spending,
deploying, activating); reversing a live deployment is the safety
valve the whole design exists to make usable quickly, so the only gate
is `assertHumanActor` itself, matching how `docs/SAAS_FACTORY.md`
already treats `compileRollbackPlan` as inherently defensive rather
than a second consequential action requiring its own review.

## 19. Billing abstraction + subscription lifecycle

`BillingPlan.status`: `DRAFT → HUMAN_APPROVED → ACTIVE → SUSPENDED →
CANCELLED` — the brief's own "minimum correct state machine" instruction
taken literally; no `READY` state distinct from `DRAFT` (nothing about
a billing plan needs a separate readiness signal a human's own approval
doesn't already carry). `CREATE_BILLING` (YELLOW, §30) covers the Pricing
Agent's PLAN step producing the `PricingModel`/`BillingPlan` draft;
`ACTIVATE_BILLING` (RED, §30) covers the EXECUTE step, shaped exactly
like `deploymentService.execute` in §17: re-verify the exact approved
`BillingPlan`, then call `billingProvider.createProduct`/`.createPrice`,
persist a `BillingAccount` with `status: "ACTIVE"`. Creating an actual
customer/subscription against the fixture provider is a **separate,
explicitly-invoked** capability (`billingAccountService.recordSubscriptionFixture`,
used only by the billing capstone test and the demo script, §40/§45) —
never invoked from any agent, never invoked automatically after
activation, so "billing is active" (a real capability now exists) and
"a subscription was fixture-created" (a specific test/demo action)
stay two structurally distinct facts, matching Section 45's "observed
vs. estimated" discipline extended to "capability exists vs. capability
was exercised."

## 20. Webhook security

A `POST /api/billing-webhooks/dev-fixture` endpoint exists so the
billing capstone (§40) can exercise a real webhook code path, built to
the same standard a real provider integration would need even though
its only caller in M7 is the fixture provider/test harness:

- **Signature verification** — every delivery must carry an
  HMAC-SHA256 signature over the raw body, keyed by a per-`BillingAccount`
  secret generated at `ACTIVATE_BILLING` time (via `SecretProvider`,
  §10) and never returned by any read API. A missing/invalid signature
  is a `401`, audited as `WEBHOOK_SIGNATURE_INVALID`, never processed.
- **Replay protection** — a `WebhookDelivery` idempotency table
  (`deliveryId` unique, `receivedAt`) rejects a previously-seen
  delivery id outright, and a delivery whose signed timestamp is more
  than 5 minutes old is rejected regardless of signature validity.
- **Idempotency** — processing a delivery is itself idempotent
  (keyed on `deliveryId`, same discipline as `OutreachMessage`'s own
  once-only semantics): re-delivering the same event never double-applies
  a `BusinessMetric`/`BillingAccount` state change.
- **Source validation** — the endpoint only accepts a `provider` value
  matching a real, known `BillingAccount.provider`; an unrecognized
  provider is rejected before signature checking even runs.
- **Audit logging** — every delivery (accepted or rejected, and why)
  is a real `auditService.record` call, never silently dropped.

*"Never trust a webhook merely because it reaches the endpoint"* (the
brief's own words) is enforced by all five properties together, not by
any single one.

## 21. Pricing intelligence — Pricing Agent

Zero tool calls, same shape as every M6 agent. Reads the Product's own
`ProductSpec`/claims/`CustomerEvidence` (never re-derives evidence),
proposes tiers and cites the specific claim/evidence ids that justify
willingness-to-pay assumptions — filtered against real ids belonging
to the opportunity before persisting, `ValidationError` on an empty
filtered set, exactly matching `productStrategistService`'s own
`groundedInClaimIds` discipline. Unit economics (cost-per-customer,
estimated margin) are computed by a small, deterministic,
founder-revisable function in `src/domain/product/unit-economics.ts`
— the same "founder-revisable formula, never token-spend reconciliation"
discipline as `computeCostEstimate` (§16) — from the Product's own
`estimatedOperatingCostUsd` and the proposed tier price, never a
model-invented number.

## 22. Go-to-market planning — GTM Agent

Zero tool calls. Produces a `GoToMarketPlan`: candidate channels (each
with a stated reasoning, never a generic "social media"), a landing
page **spec** (sections, copy points, no actual HTML deploy — that
would itself be a form of publishing, YELLOW per the Constitution, and
out of scope for what M7 needs to prove), and acquisition-experiment
**specs** the CEO's `RUN_ACQUISITION_EXPERIMENT` recommendation (§28)
can point at. No code path anywhere in M7 sends a message, posts
content, or purchases an ad — continuing M5's own *"no route exists
that could send an external message"* structural guarantee
(`docs/SECURITY.md`), extended here to *"no route exists that could
publish or spend on real distribution."*

## 23. Analytics + event provenance

`AnalyticsProvider.track` (§11) is called only from within the
DEV-fixture demo/test flow, never from generated-product code and
never automatically. Every `BusinessMetric` row records `source`
(§16) so a report can always answer "where did this number come
from" — the structural core of Section 45's "no fake business":
`valueKind`/`source` together make it impossible to render a metric
that looks observed but is actually estimated, or vice versa, without
an explicit, visible label.

## 24. Monitoring / operations

`MonitoringProvider.checkHealth` (§12) backs a `POST
/api/deployments/:id/health-check` endpoint — on-demand only (§12's
own limitation, stated plainly, not hidden). A health check result
that reports unhealthy is exactly the kind of fact that should prompt
a human (or an `Incident`, §26) to act; it never auto-triggers a
rollback — Section 1's planning/execution boundary applies to
*reacting* to monitoring data just as much as to the original deploy.

## 25. Support operations

`SupportCase` rows are created by a human pasting in a real support
request (mirrors `CustomerResponse.rawContent`'s own "human-pasted,
no connector built for a single implementer" precedent, M5
`docs/DECISIONS.md`). A Support Agent (zero tool calls) reads the case
and proposes a `triageRecommendation` (severity, suggested response) —
judgment only, never auto-replies, never changes `SupportCase.status`
itself (mirrors M6's Code Review/QA/Security discipline of never
mutating the thing being reviewed, `docs/DECISIONS.md` #54). A human
moves the case through its own lifecycle.

## 26. Incident management

`Incident.severity`/`status` (§16) — created either by a human directly
or by a failed/unhealthy `MonitoringProvider.checkHealth` result
surfaced through the API (never auto-created silently in the
background, since nothing in M7 runs a background scheduler, §12/§45).
`deploymentId` links an incident back to the specific `Deployment` a
rollback (§18) would target — the API surface for "roll this back" is
one click away from the incident that motivated it, without the two
being structurally coupled (a human can roll back without an incident,
or record an incident without rolling back).

## 27. Cost controls + budget enforcement

Extends `computeCostEstimate` (§16, unchanged) with a `LaunchBudget`
concept: `estimatedMonthlyCostUsd` (from `PricingModel`'s own unit
economics, §21) checked, at PLAN time, against a founder-configured
ceiling (a constant today, mirroring every other budget in this
codebase — `DEFAULT_EXECUTION_BUDGET`, `DEFAULT_DECISION_CYCLE_BUDGET`
— never a database-editable value in this milestone). A plan whose
estimate exceeds the ceiling does not block creation (a human should
still be able to *see* an over-budget plan) — it forces
`DeploymentPlan.status` to require a `budgetExceeded: true` flag
surfaced to the CEO (§28, `REDUCE_COST`) and the Chairman (§29) before
a human can approve it. This is deterministic domain code
(`src/domain/product/launch-budget.ts`), not a Guardian permission —
the same "deterministic input factor, judgment layered on top" split
this codebase has used since the Evidence Validator.

## 28. CEO integration — Launch & Operations actions

A fourth `recommendX` entry point,
`ceoReasoningService.recommendLaunchOperationsAction`, same
zero-tool-call/zero-permission/bounded-budget shape as the three that
exist, storing into the same `ceo_recommendations` table
(`opportunityId` resolved via `Product.opportunityId`, mirroring
`recommendProductBuildAction`'s own resolution exactly). New action
set, `LAUNCH_OPERATIONS_ACTIONS`
(`src/domain/decision/launch-operations-action.types.ts`):

```
LAUNCH | DELAY_LAUNCH | REDUCE_COST | CHANGE_PRICING |
RUN_ACQUISITION_EXPERIMENT | REQUEST_CUSTOMER_RESEARCH |
IMPROVE_PRODUCT | PAUSE_PRODUCT | KILL_PRODUCT | REQUEST_HUMAN_REVIEW
```

`REQUEST_HUMAN_REVIEW` is added beyond the brief's own list for
consistency — every one of the three existing action sets ends with an
honest-escalation option (`HUMAN_REVIEW`/`REQUEST_HUMAN_REVIEW` ×2);
omitting it here would be the one action set in the whole system where
the CEO has no way to say "I can't confidently resolve this," which
this document treats as an oversight to fix, not a deliberate
narrowing to preserve. Every recommendation still must cite real
claim/evidence ids, same validation-before-persist discipline as
`recommendProductBuildAction`. `LAUNCH`/`KILL_PRODUCT` are, as
`docs/SAAS_FACTORY.md` says of every prior CEO action, **recommendations,
not execution permissions** — `LAUNCH` never itself creates a
`DeploymentPlan`, `KILL_PRODUCT` never itself archives the `Product`;
a human reads the recommendation on the compiled `LaunchReviewMemo`
(§31) and acts through the ordinary PLAN/APPROVE/EXECUTE or
`productService`-level paths.

## 29. Chairman integration — attacking the launch thesis

`chairmanService.reviewLaunch({ productId, reviewedBy })`, the third
`reviewX` entry point (`review` → `reviewProduct` → `reviewLaunch`),
identical shape to `reviewProduct`: independently verifies citations,
independently re-derives its own view before weighing the CEO's
recommendation, never returns zero objections. Its system prompt (and
dev fixture, deterministic and derived from the real
`PricingModel`/`GoToMarketPlan`/`LaunchBudget` inputs, never a static
stub) is instructed to explicitly attack, mirroring the brief's own
verbatim examples as the dev fixture's own rule triggers:

- Launch thesis vs. actual customer evidence (a `PricingModel` with no
  `groundedInEvidenceIds` triggers *"You have customer interest but no
  demonstrated willingness to pay."*).
- Unit economics vs. measured cost (an operating-cost estimate with no
  real usage data behind it triggers *"Projected gross margin depends
  on an API cost that has never been measured."*).
- Distribution assumptions (a `GoToMarketPlan` channel with no cited
  claim triggers *"The launch channel is an assumption rather than
  evidence."*).
- Infrastructure cost vs. `LaunchBudget` (§27's `budgetExceeded` flag,
  if set, is always surfaced as a required objection, never optional).
- Technical readiness (re-checks the same `CodeReview`/`QaReport`/
  `SecurityReview` verdicts `reviewProduct` already checks — a launch
  built on a build with a FAIL security verdict is rejected regardless
  of how strong the pricing/GTM case looks).
- Operational risk (no `Incident` history exists yet for a first
  launch, so this axis mainly matters for a *re*-launch after a prior
  `PAUSED`/rollback — checked when `Deployment` history is non-empty).

## 30. Guardian integration — new permissions

Added to `PERMISSIONS` (`src/domain/permission/permission.ts`) and
classified in `PERMISSION_RISK_LEVEL`
(`src/domain/risk/permission-risk-policy.ts`), each justified against
`CONSTITUTION.md` §8's own examples (§4):

| Permission | Level | Constitution anchor | Rationale |
|---|---|---|---|
| `DEPLOY_PRODUCTION` | **RED** | "substantial irreversible commitments" / RED | Deliberately more conservative than the existing, still-untouched `DEPLOY_APPLICATION` (YELLOW, matches "major deployment"): first-time production launch of a new product is closer to "launching a new SaaS" (ORANGE) crossed with genuine irreversibility (real customer exposure begins) than a routine redeploy. Section 0 explicitly licenses the conservative reading absent a specific, Founder-approved narrower mechanism — none is proposed here. |
| `CREATE_BILLING` | YELLOW | "significant pricing changes" / "external account creation" | Preparing billing configuration against a provider (even the dev fixture) — no money moves yet. |
| `ACTIVATE_BILLING` | **RED** | "major financial transfers" / "legally binding commitments" | The moment real payment collection becomes possible. |
| `SPEND_MONEY` | RED (unchanged, existing) | "major financial transfers" | Reused as-is; M7 never actually grants or exercises it (§7 — no real spend exists to make), but the vocabulary is available the moment a human wants to record a real spend decision. |
| `CREATE_EXTERNAL_ACCOUNT` | YELLOW (unchanged, existing) | "external account creation" | Reused as-is; same never-exercised-in-M7 status as above. |
| `MODIFY_PRODUCTION` | **RED** | "high-impact actions with significant external consequences" | Mutating a *live* product's configuration/infrastructure post-launch. |
| `ACCESS_PRODUCTION_DATA` | ORANGE | matches `ACCESS_SECRET`'s existing ORANGE reasoning | A read is reversible by nature (unlike a mutation), so it sits with `ACCESS_SECRET`/`MODIFY_CONFIGURATION` rather than at RED; still requires Chairman-level governance (`requiresChairman: true`). |

**None of these permissions is ever granted to any agent in M7,
matching `SEND_EXTERNAL_MESSAGE`'s own "declared but never granted"
precedent (M5) and `WRITE_FILES`/`EXECUTE_CODE`'s own precedent (M1,
reaffirmed M6).** Every new M7 agent (Launch Strategist, Pricing,
GTM, Infrastructure, Support) holds **zero** permissions — continuing
M6's own established pattern exactly (Product Strategist/MVP
Architect/UX/Code Review/QA/Security Agent all hold zero). This table
exists for classification, `ApprovalRequest.riskLevel` values, and
Chairman/CEO reasoning references — never for a Guardian tool-call
grant, because (§3) no agent tool call gated above GREEN could ever
complete anyway.

The migration adding these five values must widen
`agent_permissions.permission`'s CHECK constraint in the same pass
(§2's named risk), verified by a real `grantPermission` test for each
new value before this milestone is considered done.

## 31. Human approval architecture — Launch Approval Gate, named

§5–§6, §17, §19 all implement the same named pattern, used four times
in M7 (deployment, billing activation, and — where a plan itself
represents a strategic ORANGE decision like "launch this product at
all" — the `LaunchPlan`'s own human sign-off): **PLAN is an immutable
row a service persists from an agent's zero-tool-call output; APPROVE
is the unmodified `approvalService`; EXECUTE is a human-actor-only
service method that re-verifies the exact approval before acting.**
`LaunchReviewMemo` compiles the same way `ProductReviewMemo` does
(§2) — zero new model calls, assembled from the `LaunchPlan`'s own
already-computed `PricingModel`/`GoToMarketPlan`/`DeploymentPlan`
summaries, the CEO's `LAUNCH` recommendation, and the Chairman's
`reviewLaunch` objections — and its own `recordHumanDecision` is where
a human's `APPROVE` sets `Product.status → LAUNCH_PLANNING`'s exit
into `AWAITING_LAUNCH_APPROVAL`, exactly mirroring
`productReviewMemoService.recordHumanDecision`'s existing
APPROVE/REJECT/REQUEST_CHANGES/DEFER shape.

## 32. Provider abstraction summary

| Provider | M7 implementation | Real implementation |
|---|---|---|
| `DeploymentProvider` | `DevDeploymentProvider` (in-memory) | none — deferred (§7, §45) |
| `BillingProvider` | `DevBillingProvider` (in-memory) | none — deferred |
| `SecretProvider` | `DevSecretProvider` (fixture values only) | none — deferred |
| `AnalyticsProvider` | `DevAnalyticsProvider` (in-memory) | none — deferred |
| `MonitoringProvider` | `DevMonitoringProvider` (deterministic fixture) | none — deferred |

Each selected via a small factory (`src/providers/deployment-provider-factory.ts`
etc.), mirroring `model-provider-factory.ts` exactly, so a future real
provider is additive.

## 33. Database changes — summary

Ten new tables (§16): `LaunchPlan`, `DeploymentPlan`, `Deployment`,
`PricingModel`, `BillingPlan`, `BillingAccount`, `GoToMarketPlan`,
`BusinessMetric`, `Incident`, `SupportCase`, plus a `WebhookDelivery`
idempotency table (§20) and a `LaunchReviewMemo` table (§31, same
shape as `ProductReviewMemo`) — twelve total. Every one an addition;
zero changes to any M1–M6 table's columns (only `PRODUCT_STATUSES`'
domain-layer array grows, §15 — no schema column changes needed there
either, since `status` has always been a plain validated string).

## 34. API layer

New route files, following the existing one-file-per-resource
convention (`src/api/routes/`): `launch-plans.routes.ts`,
`deployment-plans.routes.ts`, `deployments.routes.ts`,
`pricing-models.routes.ts`, `billing-plans.routes.ts`,
`billing-accounts.routes.ts`, `billing-webhooks.routes.ts` (§20, the
one genuinely public-shaped endpoint — signature-verified, never
auth-token-gated the normal way, since an external caller by
definition has no VentureForge identity), `go-to-market-plans.routes.ts`,
`business-metrics.routes.ts`, `incidents.routes.ts`,
`support-cases.routes.ts`, `launch-review-memos.routes.ts`. Every
non-webhook route requires the existing bearer-token auth middleware
unchanged; EXECUTE-shaped endpoints (`POST .../execute`,
`POST .../activate`, `POST .../rollback`) additionally require the
authenticated identity to resolve to `actorType: "HUMAN"`, enforced by
`assertHumanActor` inside the service layer (not just the route),
matching every existing HARD GATE in this codebase.

## 35. Security — the 20-item threat review

Addressed structurally, not just in prose, each tied to a concrete
mechanism above:

1. **Credential theft** — no real credentials exist in M7 (§7, §14).
2. **Secret leakage** — `SecretProvider` fixture values only; no tool
   exposes `process.env` (§10, §14).
3. **Production access** — no agent ever holds `DEPLOY_PRODUCTION`/
   `MODIFY_PRODUCTION`/`ACCESS_PRODUCTION_DATA` (§30); EXECUTE steps
   are human-actor-only (§5).
4. **Deployment abuse** — exact-action approval binding (§5–§6, §17);
   `DevDeploymentProvider` cannot reach anything real (§7–§8).
5. **Supply-chain attacks** — M7 adds zero new npm dependencies (same
   discipline as M1–M6, verified in §41).
6. **Dependency attacks** — N/A at the provider layer (no real
   provider SDK is added, §7); generated-product `checkDependencies()`
   (M6, unchanged) still applies to anything the Engineering Agent
   touches.
7. **Billing abuse** — `ACTIVATE_BILLING` is RED, human-execute-only,
   exact-action bound (§19); `DevBillingProvider` moves no real money.
8. **Financial loss** — impossible by construction: no real payment
   processor is ever called (§7, §9).
9. **SSRF** — `DevDeploymentProvider`/`DevBillingProvider`/
   `DevMonitoringProvider` make zero outbound network calls; the one
   real inbound surface (`billing-webhooks.routes.ts`) never triggers
   an outbound fetch from untrusted input.
10. **Privilege escalation** — Guardian's agent-permission model is
    unchanged; `assertHumanActor` cannot be satisfied by an agent
    identity by construction (`identity.type` is set at creation,
    never mutated by any API, per M2's identity model).
11. **IDOR** — every EXECUTE/decision endpoint re-verifies the exact
    resource id bound to the `ApprovalRequest` server-side (§5–§6),
    never trusting a client-supplied id/plan pairing.
12. **Data leakage** — `BusinessMetric.valueKind`/`source` (§16, §23)
    prevent an estimated number from being reported as observed fact,
    which is itself a leakage-of-false-confidence vector as much as a
    "fake business" one.
13. **Customer-data exposure** — `SupportCase.customerRef` follows
    M5's `CustomerResponse` privacy boundary exactly (§25, §36): no
    connector, human-pasted only, never enriched.
14. **Prompt injection** — every M7 agent input assembly follows the
    same "untrusted external/analytical content is explicitly labeled
    in the prompt and never followed as instruction" discipline
    established in `chairman.service.ts`'s own CEO-recommendation
    handling and M5's customer-response handling; support-case text
    and webhook payload bodies are both external/untrusted inputs and
    are labeled as such wherever an agent (Support Agent) reads them.
15. **Malicious support tickets** — Support Agent has zero tool calls
    and zero permissions (§25); its `triageRecommendation` is
    judgment text a human reads, never code that executes or a status
    it can mutate itself.
16. **Malicious analytics input** — `AnalyticsProvider.track` is never
    called with unvalidated external input in M7 (§23 — demo/test-only
    caller); a future real analytics ingestion endpoint is out of
    scope (§45).
17. **Webhook forgery** — §20's five properties (signature, replay,
    idempotency, source validation, audit) directly.
18. **Rollback abuse** — `assertHumanActor`-gated (§18); no
    `ApprovalRequest` overhead specifically so this safety valve stays
    fast, but still fully audited and only reachable by a real human
    identity.
19. **Audit manipulation** — every new state transition uses the
    existing, unmodified `auditService.record` (§37) — no new audit
    mechanism, no new bypass surface.
20. **Cost runaway** — `LaunchBudget` (§27) forces visibility before
    approval; no EXECUTE step can ever run without a human's own,
    already-approved plan, and no plan can loop or retry itself into
    repeated spend (nothing in M7 auto-retries an EXECUTE step — a
    failed deploy/activation is a terminal fact a human must act on
    again explicitly).

## 36. Privacy

`SupportCase.customerRef`/case text: same boundary M5 established for
`Prospect`/`CustomerResponse` — human-entered, never scraped, never
enriched from a third-party data broker, no connector built for a
single implementer. `BillingAccount`/subscription-fixture data holds
no real PII (fixture email/customer refs only, generated, never a real
person's data) — consistent with never claiming real customers exist
(§45).

## 37. Auditability

Every new mutating operation — PLAN persistence, APPROVE (unchanged
`approvalService`), EXECUTE, rollback, incident/support-case
transitions — calls `auditService.record` with real
`actorType`/`actorId`, matching the unbroken discipline from M1
onward. `Deployment`/`BillingAccount` rows themselves are the durable,
queryable record of "what actually happened," so an audit trail never
depends solely on the append-only audit log for launch-critical facts.

## 38. Deployment safety

Covered in full by §17 (the EXECUTE flow), §18 (rollback), §20
(webhook integrity), and §27 (budget visibility before approval) —
cross-referenced rather than restated.

## 39. Failure handling

Mechanical failures get bounded, automatic handling; judgment
failures always escalate to a human — the exact split M6 established
(`docs/DECISIONS.md` #54). `DevDeploymentProvider.deploy()` failing
(a mechanical, deterministic outcome, §8) sets `Deployment.status:
"FAILED"` and leaves `Product.status` at `DEPLOYING`, never silently
retried — a human decides whether to re-EXECUTE the same approved
plan (idempotent — re-running EXECUTE against an already-`HUMAN_APPROVED`
plan is safe and expected after a transient fixture failure) or start
over with a new plan. No M7 code path retries an EXECUTE step
automatically, unlike `EngineeringTask`'s own bounded typecheck retry
— an EXECUTE failure is never "the code doesn't compile," it's
"something external didn't work," which is always a judgment call
about whether to try again.

## 40. Testing — three mandatory capstone categories

1. **Positive end-to-end**: `READY_FOR_DEPLOYMENT` Product → Launch
   Strategist/Pricing/GTM agents (PLAN) → `LaunchReviewMemo` → CEO
   `LAUNCH` → Chairman `reviewLaunch` (no blocking objection) → human
   approves `DeploymentPlan` → EXECUTE against `DevDeploymentProvider`
   → `Product.status = "LIVE"` → `MonitoringProvider.checkHealth` →
   `BusinessMetric` rows recorded (`valueKind` mixed
   OBSERVED/ESTIMATED, both correctly labeled) → CEO
   `recommendLaunchOperationsAction` produces an operating
   recommendation from the live product's own real (fixture) data. No
   step in the assertions claims real revenue, real customers, or real
   uptime — every assertion checks for the correct fixture label.
2. **Negative capstone A** (cost/economics): a `PricingModel` whose
   unit economics exceed `LaunchBudget` → `budgetExceeded: true` →
   Chairman's `reviewLaunch` cites it as a required objection → CEO
   recommends `REDUCE_COST` → human `DELAY_LAUNCH`s via the memo's own
   decision recording. Mirrors the M6 capstone's own
   cost→Guardian→CEO→Chairman→human-DELAY shape, extended one level.
3. **Negative capstone B** (security-blocks-launch): a Product whose
   underlying `SecurityReview` (M6, unchanged) has a `FAIL` verdict →
   `reviewLaunch` rejects regardless of pricing/GTM strength → Product
   never reaches `LIVE`.
4. **Billing capstone** (M7-specific, required by the brief by name):
   `PricingModel`/`BillingPlan` → human approval → `ACTIVATE_BILLING`
   EXECUTE against `DevBillingProvider` → a fixture subscription
   created (§19) → a fixture webhook delivered to
   `billing-webhooks.routes.ts` with a real, valid HMAC signature
   (§20) → signature/replay/idempotency all asserted → a
   `BusinessMetric` (`REVENUE_USD`, `valueKind: "OBSERVED"`, `source:
   "DEV_FIXTURE"`) recorded from the webhook. The test asserts the
   metric's `source` field explicitly — this test is exactly where a
   silent "fake revenue" regression would first appear, so its
   assertion is the direct enforcement of Section 45.

## 41. `npm run demo:m7`

Mirrors `demo:m3`–`demo:m6` exactly: a single narrated script running
the positive capstone path end-to-end against real (Prisma-backed,
migrated) state, printing `[DEV FIXTURE]`/`PLANNING ONLY` labels at
every step where a real provider integration isn't configured — which,
per §7, is every step. No new dependency; reuses `tsx` exactly as the
existing five demo scripts do.

## 42. Calibration extension

`calibrationService.summarizeLaunch()` — fifth call, same
`summarizeCalibration(records, positiveDecision)` shared function
(`docs/DECISIONS.md` #49's own extension point, built for exactly
this), fed from `LaunchReviewMemo.confidence`/`humanDecision`, filtering
out `humanDecision: null` exactly like `summarizeCustomerDiscovery`/
the M6 equivalent already do. No new bucketing logic.

## 43. Alternatives considered

- **Mid-execution approval suspension** (let `agentRuntimeService`
  actually pause on `REQUIRES_APPROVAL` and resume after a human
  decides) — rejected for M7. It would be the more "elegant" long-term
  runtime feature, but it's a change to the shared execution engine
  every prior milestone's agents also run on, with real risk of
  regressing M1–M6 behavior for a capability M7 doesn't strictly need:
  the PLAN/APPROVE/EXECUTE split (§5) achieves the same safety property
  with zero changes to `agent-runtime.service.ts`. Worth reconsidering
  in a future milestone if enough consequential actions accumulate
  that the split pattern itself becomes the bottleneck — not yet.
- **A new 4th RiskLevel tier** — moot; §4 found the 4-tier system
  already exists and already has exactly the right semantics.
- **Reusing `DEPLOY_APPLICATION` instead of adding `DEPLOY_PRODUCTION`**
  — rejected (§30): the existing permission is YELLOW and unused;
  reusing it for M7's specifically-first-production-launch action
  would either loosen what M7 needs (RED) or retroactively redefine an
  M1 permission's settled meaning. A new, narrower, purpose-named
  permission is the same call M6 made for
  `WRITE_WORKSPACE_FILES`/`RUN_WORKSPACE_COMMAND`.
- **A real Stripe/deployment-provider integration** — rejected for
  this milestone; full reasoning in §7. Deferred, not abandoned — the
  provider interfaces are built so it's additive later.
- **Continuous background monitoring (a scheduler/cron)** — rejected;
  no such infrastructure exists anywhere in M1–M6, and building
  general-purpose background scheduling is a bigger, separate
  architectural decision than M7's own scope justifies. On-demand
  health checks (§12/§24) cover the capstone/demo needs honestly.

## 44. Risks

- **A compromised or careless human credential** could trigger a real
  EXECUTE step. Out of scope to fully mitigate here (identity/auth
  hardening is M2's domain, unchanged) — mitigated in effect by every
  EXECUTE step being dev-fixture-only in this milestone (§7), so the
  worst case today is a confusing fixture state, not a real-world
  consequence.
- **A future real-provider implementation** could be added without
  someone re-reading this document's safety reasoning, and wire a real
  credential through `SecretProvider` without the same scrutiny this
  proposal gives dev fixtures. Mitigation: `docs/SECURITY.md`'s M7
  section (§ Docs) states explicitly that adding a real provider is a
  Founder-approval-requiring change per Section 0, not a routine
  extension.
- **`valueKind`/`source` mislabeling by a future careless edit** could
  reintroduce a "fake business" reporting bug even with the schema
  support in place — a schema column enforces *presence* of a label,
  not that every code path sets it correctly. Mitigated by the billing
  capstone's explicit `source`/`valueKind` assertions (§40) acting as
  a regression guard.

## 45. Deferred functionality — "What M7 Is Not," restated as scope

Explicitly out of scope for this milestone, matching the brief's own
list: any real provider integration (deployment, billing, secrets,
analytics, monitoring — §7); unlimited or unbounded autonomous
spending (no code path spends real money at all, §7/§9); unrestricted
production access (every RED/ORANGE action is human-execute-only,
§5/§30); autonomous financial management (CEO recommendations only,
never executions, §28); mass marketing or autonomous sales (GTM Agent
produces specs only, never sends anything, §22); self-modifying agents
(no such capability exists anywhere in this codebase); unbounded
infrastructure creation (only the one dev-fixture "deployment" concept
exists, never real resource provisioning); continuous background
monitoring/scheduling (§12, §24, §43).

## 46. Success criteria, restated as verification gates

M7 is done when: the positive capstone (§40.1) runs end-to-end against
real Prisma-backed state and prints only `[DEV FIXTURE]`/`PLANNING
ONLY`-labeled outcomes; both negative capstones (§40.2–3) correctly
block `LIVE`; the billing capstone (§40.4) proves a real webhook
signature/replay/idempotency path against a labeled fixture
subscription; every new permission is grantable (a real test, closing
§2/§30's named risk) and held by zero agents; `npm run demo:m7`
(§41) runs clean; typecheck/lint/build/full test suite are all clean;
and no reviewer reading `docs/SECURITY.md`'s new M7 section or this
document can find a code path where an agent — not a human — is the
actor that deploys, bills, or spends.
