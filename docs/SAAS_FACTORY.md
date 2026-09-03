# SaaS Factory

M6. Moves the system from OPPORTUNITY → VALIDATED CUSTOMER EVIDENCE
(M3-M5) to VALIDATED EVIDENCE → REAL, WORKING MVP CODE → HUMAN
GO/NO-GO DECISION — seven new agents, a real code-generation and
execution pipeline running inside an isolated workspace, and the same
unmodified M2 `agentRuntimeService`/Guardian chain every prior
milestone's agents already run on. Full rationale in
`docs/M6_ARCHITECTURE_PROPOSAL.md`; the specific decisions this build
made along the way are in `docs/DECISIONS.md` #50-56; the full
security threat review is in `docs/SECURITY.md`'s M6 section.

## The hard boundary this whole milestone answers to

VentureForge must never autonomously spend money, purchase domains,
cloud resources, or APIs, create paid accounts, deploy to production,
modify production infrastructure, accept payments, alter billing, send
sales messages, contact customers, merge into a protected branch,
delete repositories, expose secrets, or create unrestricted
credentials. It may write specs, architecture proposals, and real code
in an isolated, disposable workspace; run real tests, static analysis,
and security analysis there; produce deployment plans; and recommend
— never execute — a real deployment. This is not a policy statement
trusted to hold: see "Structural, not just policy" below.

## The pipeline

```
Opportunity/Claims (M3-M4, unchanged)
  → Product.create → Product.approve()   ── HARD GATE 1 (Human Owner)
  → Product Strategist                   (thesis + candidate features, grounded)
  → computeFeaturePriority (deterministic)
  → MVP Architect                        (tech design, MUST_HAVE/SHOULD_HAVE/DEFERRED)
  → UX Agent                             (screens mapped to real APIs only)
  → workspaceService.provision           (disposable, gitignored directory)
  → engineeringTaskService.decompose     (small, bounded, dependency-ordered tasks)
  → Engineering Agent × N                (real code, real typecheck, bounded retry)
  → Code Review Agent × N                (real findings, never a rubber stamp)
  → QA Agent × N + real Integration Test (coverage judgment + a real `vitest run`)
  → Security Review Agent × N            (real deterministic scan + judgment)
  → CEO.recommendProductBuildAction      (BUILD/CONTINUE_BUILD/CUT_SCOPE/REQUEST_CUSTOMER_RESEARCH/STOP)
  → Chairman.reviewProduct               (attacks the THESIS, not just the code)
  → ProductReviewMemo.compile → recordHumanDecision  ── HARD GATE 2 (Human Owner)
```

`productFactoryService.build()` is the one orchestration entry point
that drives a `Product` through this entire chain in a single bounded
call — deterministic orchestration CODE layered on top of every
unmodified agent service below, mirroring `decisionCycleService`'s own
M4 precedent. It never rolls back partial work: every row already
committed stays exactly as it is if a later stage fails.

## Product lifecycle

```
PROPOSED → APPROVED → SPECIFYING → ARCHITECTING → BUILDING → REVIEWING
  → TESTING → SECURITY_REVIEW → HUMAN_REVIEW → READY_FOR_DEPLOYMENT
                                              ↘ REJECTED
Any non-terminal state → FAILED (attempt-cap exceeded, never silent)
READY_FOR_DEPLOYMENT / REJECTED / FAILED → ARCHIVED
```

Deliberately no `DEPLOYED` status: M6 stops at `READY_FOR_DEPLOYMENT`
with a compiled deployment plan, never an autonomous deploy.
`REVIEWING`/`TESTING`/`SECURITY_REVIEW` each map to one pipeline stage
(Code Review / QA + Integration Test / Security) and can fall back to
`BUILDING` — but only via a **human's own** `REQUEST_CHANGES` decision
on the compiled memo, never an automatic retry loop. The one automatic,
bounded retry is `EngineeringTask`'s own typecheck failure
(`engineeringTaskService.recordAttempt`, capped at `MAX_TASK_ATTEMPTS`)
— a mechanical fact, not a judgment call.

## Product Strategist — `src/services/product-strategist.service.ts`

Zero tool calls (`PRODUCT_STRATEGIST_BUDGET.maxToolCalls: 0`) —
synthesizes productThesis/targetCustomer/coreProblem/mvpBoundary/
nonGoals (never empty) from an opportunity's own already-persisted
claims and evidence. `groundedInClaimIds` is filtered against real
claim ids belonging to the opportunity before persisting — a
`ValidationError` if the filtered set is empty, never trusting a
model's own citation on faith. Proposes a small list of candidate
features, each scored on four axes (customerValue/learningValue/
implementationCost/technicalRisk) that feed `computeFeaturePriority()`
— a deterministic, weighted formula (never the model's own raw
priority judgment) producing BUILD_NOW/BUILD_LATER/EXPERIMENT_ONLY/
DEFER/REJECT with an explicit reasoning string.

## MVP Architect + UX Agent

`mvp-architect.service.ts` (zero tool calls) converts the spec's own
BUILD_NOW features into a technical design: every component tagged
MUST_HAVE/SHOULD_HAVE/DEFERRED with a real, specific justification —
never a generic platitude. Defaults to VentureForge's own proven stack
(TypeScript/Express) and an **in-process store**, not SQLite via
Prisma (`docs/DECISIONS.md` #53) — real persistence is named
explicitly as the natural SHOULD_HAVE next step, never silently
dropped. `ux-agent.service.ts` fills in exactly the `MvpArchitecture`
row's own `ux` field, once — every screen must map to a real API
surface already named in the architecture; no decorative screens.

## Workspace isolation — `src/services/workspace.service.ts`, `src/domain/workspace/`

One disposable, gitignored, filesystem-scoped directory per Product
(`factory-workspaces/<productId>/`), never a real git branch or
worktree (`docs/DECISIONS.md` #51). `resolveWorkspacePath()` is the
real, adversarially-tested containment boundary behind every write.
Placing the workspace as a filesystem descendant of the repo root
means Node's own module-resolution walk-up finds VentureForge's
already-installed dependencies without a second `npm install`
(`docs/DECISIONS.md` #52) — verified mechanically, not assumed:
`tests/integration/engineering-agent.test.ts` runs a real `tsc
--noEmit` and a real `vitest run` against generated code.

## Engineering Agent — `src/services/engineering-agent.service.ts`

The only agent in the system holding `WRITE_WORKSPACE_FILES`/
`RUN_WORKSPACE_COMMAND` (both GREEN — `docs/DECISIONS.md` #50).
Implements exactly one `EngineeringTask`: reads any already-scaffolded
file it needs for context (plain `fs`, not Guardian-gated — the same
category as reading any other repository data), proposes full file
content for new files and a deterministic import+mount splice for the
one shared scaffold file (`src/index.ts`, never a model-authored
rewrite of it), validates every proposed path against the task's own
real `allowedFiles` and every proposed import against
`checkDependencies()` (`docs/SECURITY.md`'s M6 section), writes
through the Guardian-gated tool, then self-checks with a real `tsc
--noEmit` before it may report COMPLETED. A typecheck failure is a
normal business outcome (the task moves to FAILED, retryable) — never
an exception that leaves the task stuck.

## Code Review / QA / Security Review Agents

Structurally identical shape, three different lenses, all zero tool
calls, all reading the task's own real `filesChanged`:

- **Code Review** (`code-review-agent.service.ts`) — quality/
  correctness findings (BLOCKER/HIGH/MEDIUM/LOW), `hasBlockingFinding`
  computed deterministically from severities, never trusted from the
  model's own summary.
- **QA** (`qa-agent.service.ts`) — pure coverage *judgment*: counts
  real `it(...)` blocks in the task's own real test files against its
  own real `testsRequired`, reports a genuine deficit rather than
  guessing which specific case is missing. Distinct from the
  **Integration Test** stage (`productFactoryService`'s own
  `runIntegrationTest`), which is purely mechanical — one real
  `vitest run` across the whole workspace, zero model calls, recorded
  onto every task via `EngineeringTask.integrationTestPassed`.
- **Security Review** (`security-review-agent.service.ts`) — a real
  deterministic scan (`src/domain/security-review/security-scan.ts`)
  merged with model judgment; the scan's own findings are never
  optional, so a live model can never talk its way past a
  mechanically-detected issue.

None of the three ever changes the `EngineeringTask`'s own status
(`docs/DECISIONS.md` #54) — every verdict flows through to the CEO,
the Chairman, and the compiled memo as a fact for a human to weigh.

## CEO + Chairman: two new, distinct entry points

`ceoReasoningService.recommendProductBuildAction` (a third axis
alongside M4's opportunity-kill and M5's customer-discovery
questions) and `chairmanService.reviewProduct` (a separate, focused
review rather than further extending the already-large `review()`)
mirror the exact "distinct entry point per decision axis" precedent
M5 established for the CEO. The Chairman's product review explicitly
attacks the THESIS — is the target customer/problem genuinely grounded
in real claims, is the MVP boundary genuinely minimal, does the
architecture show premature complexity — not just the code, and
independently verifies the CEO's own citations and its characterization
of the real engineering outcome before ever agreeing with it.

## ProductReviewMemo — `src/services/product-review-memo.service.ts`

Zero new model calls, same discipline as `investmentMemoService`/
`customerDiscoveryMemoService` — every field assembled from
already-computed real data: the spec's own thesis/boundary/non-goals,
the architecture's own key choices, real engineering/code-review/QA/
security summaries, the CEO's recommendation, and the Chairman's own
objections (`strongestObjection` mirrors `InvestmentMemo`'s own
precedent). `recordHumanDecision` is the one place a decision is
actually applied: APPROVE → READY_FOR_DEPLOYMENT, REJECT → REJECTED,
REQUEST_CHANGES → BUILDING, DEFER → no forcing function yet.

## Cost intelligence + deployment preparation

`src/domain/product/cost-estimate.ts` — a small, deterministic,
founder-revisable formula, never a reconciliation of real token
spend. `src/domain/product/deployment-plan.ts` — a PLAN and a
ROLLBACK PLAN only; neither function calls a hosting API or touches
production infrastructure (`docs/DECISIONS.md` #55).

## Structural, not just policy

- Real code execution is confined to `WRITE_WORKSPACE_FILES`/
  `RUN_WORKSPACE_COMMAND` — GREEN only because their blast radius is
  one disposable directory with no secrets, no network, no production
  access. `WRITE_FILES`/`EXECUTE_CODE` stay YELLOW and ungranted.
- `run_workspace_command` never shells out — a fixed three-name
  allowlist resolves to `execFile` with an explicit argv, never a
  shell string.
- `checkDependencies()` blocks `@prisma/client`/`dotenv` even though
  both are genuinely installed — a generated product has no code path
  to VentureForge's own database or `.env`.
- No route or service anywhere in M6 calls a hosting API, a payment
  API, or sends a message to a customer — the same "no such capability
  exists to expose" discipline M5 established for outreach.
- `Product` has no `DEPLOYED` status. The pipeline stops at
  `READY_FOR_DEPLOYMENT`; a human decides and acts from there.

## What M6 does not claim

No product built by this milestone has product-market fit, real
revenue, or real customers unless a human has independently verified
that outside this system. No product has been deployed to production —
`READY_FOR_DEPLOYMENT` means a human-reviewable plan exists, not that
anything is live. Every dev-fixture agent response in this milestone is
clearly labeled `[DEV FIXTURE]` and is genuinely derived from real
input data (never a static stub) — see each service's own
`buildDevXFixture` function.
