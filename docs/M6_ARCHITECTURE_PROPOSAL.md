# M6 Architecture Proposal — The SaaS Factory

Phase 0 gate (brief §1). Nothing in this document authorizes writing
implementation code yet — this is the design that implementation must
follow, produced after reading the existing M1-M5 system, not before.

## 1. M5 audit

What M6 inherits, verified directly rather than assumed:

- **`agentRuntimeService`** (`src/services/agent-runtime.service.ts`) is
  the one execution engine every M1-M5 agent already runs on:
  `startExecution` persists an `AgentExecution` row, `run(executionId,
  program, budgetOverrides)` drives `program` through an
  `ExecutionHandle` (`step()`, `callModel()`, `callTool()`,
  `transition()`), enforcing `maxSteps`/`maxModelCalls`/`maxToolCalls`/
  `maxRetries`/`maxDurationMs` and writing `ToolExecution`/audit rows
  itself. A business-shaped failure (budget/tool/model/authorization)
  lands as a normal `FAILED` terminal state, never an unhandled
  exception. **M6 adds zero new execution engines** — every new agent
  is one more `program` passed to this exact function.
- **The permission vocabulary already contains what M6 needs, unused
  until now.** `PERMISSIONS` (`src/domain/permission/permission.ts`)
  has held `WRITE_FILES`, `EXECUTE_CODE`, `READ_DATABASE`,
  `WRITE_DATABASE`, `DEPLOY_APPLICATION`, `SPEND_MONEY`,
  `ACCESS_SECRET`, `MODIFY_CONFIGURATION` since M1 — none ever granted
  to any M1-M5 agent (every agent so far held only `READ_WEB` or
  nothing). M6's Engineering Agent is the **first** agent in the system
  that genuinely needs to write files and execute commands.
- **A load-bearing constraint this audit surfaced, not assumed:**
  `RISK_POLICY` (`src/domain/risk/risk-level.ts`) marks `GREEN` as the
  only level with `requiresApproval: false`. Inside a running
  execution, `agentRuntimeService`'s own `callTool` throws
  `AuthorizationDeniedError` the instant a tool's required permission
  resolves to `REQUIRES_APPROVAL` — the code comment says exactly why:
  *"M2 does not implement suspending an execution mid-run for human
  approval... Failing closed is the safe default."* `WRITE_FILES`/
  `EXECUTE_CODE` are pinned `YELLOW` (`permission-risk-policy.ts`,
  documented as *"a conservative default... pending founder review"*).
  **Consequence:** a tool gated on `WRITE_FILES`/`EXECUTE_CODE` as they
  exist today can never complete inside `agentRuntimeService.run` —
  not a policy choice M6 can route around, a structural fact about the
  runtime every prior milestone already relies on. §8/§28/§29 below is
  the direct result of taking this seriously instead of quietly
  reclassifying two permissions whose conservatism was a deliberate M1
  decision.
- **The `Tool` interface** (`src/tools/tool.ts`) is narrow on purpose:
  `id`/`name`/`description`/`riskLevel`/`requiredPermissions`/
  `inputSchema`/`outputSchema`/`execute()`. Every M1-M5 tool
  (`SourceSearchTool`) is `GREEN`. `toolRegistry.register` is the only
  registration path (`register-tools.ts`).
  `MODEL_PROVIDER_MODE`/`RESEARCH_TOOL_MODE` govern whether a *model
  call* or *research source* is real or a labeled dev fixture — neither
  governs whether a *tool call itself* executes; a tool's `execute()`
  always runs for real once authorized. This matters directly: M6's
  workspace tools (§11) always genuinely write files and genuinely run
  `npm test`, in every mode — there is no "fake" version of running a
  real test suite, only a genuinely small, cheap, disposable one.
- **Every prior milestone's dev-fixture discipline** (`buildDev*Fixture`
  functions across `icp-analyst.service.ts`, `evidence-validator.service.ts`,
  `chairman.service.ts`, etc.): deterministic, genuinely derived from
  real input, labeled `[DEV FIXTURE]`, never a static stub. M6's
  Engineering Agent dev fixture must meet the same bar for *generated
  source code*, not just structured JSON.
- **Historized-not-overwritten artifacts** (`IcpProfile`,
  `OpportunityScoreRecord`, `ValidationReport`) vs. **append-only
  decision logs** (`CeoRecommendation`, `ChairmanReview`,
  `DecisionRecord`, `CustomerDiscoveryMemo`) are the two recurring
  shapes every M2-M5 table takes. M6's own new tables (§32) pick from
  these two shapes, never a third.
- **Compile-with-zero-new-model-calls memos** (`investmentMemoService.compile`,
  `customerDiscoveryMemoService.compile`) pull every field from
  already-persisted rows. M6's Product/MVP Review Memo (§21 of the
  brief) follows the identical discipline.
- **`calibrationService`** (`src/domain/decision/calibration.ts` +
  `src/services/calibration.service.ts`) was generalized once already,
  in M5, to take an explicit `positiveDecision` label rather than
  hardcode M4's `"APPROVED"`. It is built to be extended a third time.
- **No git-branch-manipulation precedent exists anywhere in M1-M5.**
  Every "isolation" concept so far has been a database scope
  (`opportunityId` on every row) or a bounded execution, never a real
  git branch/worktree. This repository's own git state — the actual
  branch this session commits to — is not something any M1-M5 agent
  has ever touched programmatically. §8 explains why M6 keeps it that
  way.
- **Directory/config conventions:** `.gitignore` already excludes
  `*.db`/`dist/`/`node_modules/` as disposable, regeneratable content;
  `scripts/demo-m*.ts` each spin up an isolated demo SQLite database
  and tear it down on the next run. M6's workspace directories follow
  the identical "disposable, gitignored, recreated on demand" pattern
  (§8).

## 2. SaaS Factory architecture

One new bounded orchestrator, `productFactoryService`, in the same
shape as `researchCycleService`/`decisionCycleService`: a single entry
point that drives an already-`APPROVED` opportunity through a fixed
pipeline, checking a budget before each stage, persisting every
transition, and stopping cleanly (never rolling back committed work) on
any ceiling hit.

```
M5 CUSTOMER-VALIDATED OPPORTUNITY
        |
   HUMAN APPROVAL  (creates Product: PROPOSED -> APPROVED)
        |
   Product Strategist        -> ProductSpec (thesis + non-goals)
        |
   Feature Prioritization    -> BUILD_NOW/BUILD_LATER/EXPERIMENT_ONLY/DEFER/REJECT
        |
   MVP Architect              -> MvpArchitecture (MUST/SHOULD/DEFERRED)
        |
   UX Agent                   -> UX section of MvpArchitecture
        |
   Engineering Task Decomposition  -> EngineeringTask rows
        |
   [ per task, sequentially ]
     Engineering Agent  -> workspace files + tests
        |
     Code Review Agent  -> CodeReview (BLOCKER/HIGH/MEDIUM/LOW)
        |
     QA Agent            -> QaReport
        |
     Security Agent      -> SecurityReview (PASS/PASS_WITH_WARNINGS/FAIL)
        |
     Integration Test    -> real `npm test`/`build` in the workspace
        |
   [ all tasks done ]
        |
   Chairman (attacks the thesis)   -> chairman_reviews row
        |
   CEO (recommends)                -> ceo_recommendations row
        |
   ProductReviewMemo.compile        (zero new model calls)
        |
   HUMAN REVIEW  -> APPROVE / REQUEST_CHANGES / REJECT / DEFER
        |
   READY_FOR_DEPLOYMENT (or REJECTED/FAILED, never DEPLOYED)
```

Every arrow is a separate, callable service method — `productFactoryService`
sequences them and enforces the budget; nothing about Product
Strategist/MVP Architect/Engineering Agent/etc. requires being called
through the orchestrator, exactly like `decisionCycleService` never
required `evidenceValidatorService`/`ceoReasoningService` to be called
only through it. The two mandatory capstone tests (§36-38) exercise the
pipeline stage-by-stage, the same way `m5-end-to-end.test.ts` does.

## 3. Product definition

A `Product` is **one build attempt at one opportunity**, not a
versioned family of attempts. `Opportunity` already carries the
identity; `Product` is a new lifecycle laid on top, 1:1 with the
opportunity it builds (`Product.opportunityId`, unique). If a rejected
product needs a genuinely new attempt later, that is a new `Product`
row referencing the same `opportunityId` — mirrors `OutreachExperiment`'s
own "a new attempt is a new row" precedent, not an in-place restart.

Its child artifacts — `ProductSpec` and `MvpArchitecture` — are
**historized**, exactly like `IcpProfile`: a `REQUEST_CHANGES` verdict
produces a *new* spec/architecture row, never an edit of the old one,
so the full history of what was proposed and rejected stays queryable
(the same reasoning `docs/DECISIONS.md` already gives for never
overwriting a score or a targeting decision).

## 4. MVP philosophy

*Smallest technically credible product capable of testing the
validated business thesis* — operationalized as three hard rules, not
just a stated intent:

1. **Every feature must cite a claim or piece of evidence** (§6) — a
   feature with no citation is structurally unable to reach
   `BUILD_NOW`.
2. **Non-goals are a required field, not an afterthought** — `ProductSpec.nonGoals`
   is `NOT NULL`; the compiler that builds a spec from the Product
   Strategist's output refuses to persist one with an empty list,
   mirroring the honesty-gate discipline `docs/OPPORTUNITY_INTELLIGENCE.md`
   already documents for M3's promotion bar.
3. **Task decomposition only ever expands `MUST_HAVE` architecture
   components** (§10) — a `SHOULD_HAVE`/`DEFERRED` component never
   becomes an `EngineeringTask` in the same build.

## 5. Product thesis

The Product Strategist (§3 of the brief) is a zero-tool-call reasoning
agent — same shape as the CEO/ICP Analyst — over already-persisted M3-M5
data: the opportunity, its claims and their validation reports, customer
evidence, customer responses, the M4 `DecisionRecord`, the M5
`CustomerDiscoveryMemo`, and the CEO/Chairman/Human decisions that led
to `APPROVED`. Output schema (persisted as `ProductSpec.thesisJson`):

```
{
  productThesis: string,
  targetCustomer: string,
  coreProblem: string,
  coreJobToBeDone: string,
  proposedSolution: string,
  primaryWorkflow: string,
  successMetric: string,
  mvpBoundary: string,
  nonGoals: string[],          // non-empty, enforced
  knownRisks: string[],
  unknowns: string[],
  groundedInClaimIds: string[],   // non-empty, enforced — mirrors icp-field-grounding.ts
  groundedInEvidenceIds: string[],
}
```

Grounding is enforced the same way `icpAnalystService`'s
`fieldGrounding` is: the compiling service rejects a thesis whose
`groundedInClaimIds`/`groundedInEvidenceIds` don't resolve to real rows
belonging to this opportunity — never trusting the model's own
citation on faith, the same discipline the Chairman's own
`unverifiableCitations` check already applies to a CEO recommendation.

## 6. Feature prioritization

A pure, deterministic function (`domain/product/feature-priority.ts`),
not a model call — the same "explainable, founder-revisable constants"
discipline as `domain/decision/priority.ts`'s `computeDecisionPriority`:

```
score = 0.30*customerValue + 0.25*claimImportance + 0.20*learningValue
      - 0.15*implementationCost - 0.10*technicalRisk
      (each factor 0..1; claimImportance derived from the cited claim's
       own CLAIM_IMPORTANCE_WEIGHT, never asked of the model)

REJECT          — no claim/evidence citation at all
EXPERIMENT_ONLY — learningValue high, customerValue low/unproven
BUILD_NOW       — score >= 0.6 and implementationCost <= 0.5
BUILD_LATER     — score >= 0.4, otherwise
DEFER           — score < 0.4
```

Every `Feature` row records `problemAddressed`, `claimId`, `evidenceIds`,
`expectedLearning`, `implementationCost`, `technicalRisk`, the computed
`score`, and the resulting bucket — an explainable table, never a bare
LLM score, matching the brief's explicit prohibition.

## 7. Product Specification

`ProductSpec` (one row per historized version) carries exactly the
brief's own field list (name, customer, problem, core workflow, MVP
features — the `BUILD_NOW` bucket only, explicit non-goals, success
metrics, customer evidence references, claims tested, open questions).
This is the literal contract §6 of the brief calls it: **the MVP
Architect, UX Agent, and every EngineeringTask trace back to this one
row's id** — nothing downstream is allowed to invent a feature that
isn't in it.

## 8. Architecture generation — the MVP Architect

Zero tool calls, same shape as the Product Strategist. Input: the
`ProductSpec`. Output (`MvpArchitecture.designJson`): frontend, backend,
database, authentication, authorization, external dependencies, APIs,
core entities, data flows, error handling, testing strategy, security
strategy, deployment strategy — each component tagged `MUST_HAVE`/
`SHOULD_HAVE`/`DEFERRED`, and **every `MUST_HAVE` component carries a
required `justification` string** answering "why this database/
framework/dependency/infrastructure" (schema-enforced: `justification.length
>= 1`, the same non-empty-string discipline `docs/EVIDENCE_VALIDATION.md`
already applies to `reasoning` fields throughout M4).

**The default stack, absent a contrary requirement in the spec, is
VentureForge's own stack** — TypeScript, Express, Prisma/SQLite, Zod,
Vitest. This isn't a hardcoded rule; it's what "smallest justified
choice" produces by construction once the dev fixture is asked to
justify a database and the honest answer for a tiny CRUD MVP is
"a single-file SQLite database needs no separate server, matches the
product's own trivial data volume, and is the same engine this very
system already trusts." A product whose actual `ProductSpec` needs
something else (e.g. a spec explicitly citing real-time multi-user
collaboration) can justify a different choice — the fixture is
deterministic over the *spec's own content*, never a static "always
Express" stub.

## 9. No premature complexity

Structural, not just instructional: the dev-fixture architecture
generator has no code path that emits `MUST_HAVE` for microservices,
Kubernetes, a message queue, an event bus, a distributed worker pool,
or a vector database — those only ever appear (labeled `DEFERRED`, with
a reason) when the spec's own workflow text contains a genuine signal
for them (e.g. "process very large files asynchronously" might
`DEFER` a queue rather than reject the concept outright). Task
decomposition (§10) only expands `MUST_HAVE` components, so an
un-justified complex component can never produce engineering work
regardless of what a compromised model call might otherwise prefer.

## 10. Repository/workspace isolation

**The single most consequential decision in this document**, so stated
plainly: M6 does **not** issue real `git branch`/`git checkout`/`git
worktree` commands against this repository from inside any agent
execution. The brief's own diagram (`protected branch -> factory branch
-> task branch/workspace`) is real as a *lifecycle concept*, implemented
without real git:

```
factory-workspaces/<product-id>/            (gitignored, disposable)
  package.json, src/, tests/, prisma/, .env  (a genuinely separate,
                                               self-contained Node project —
                                               never a subtree of VentureForge's
                                               own src/)
```

- `Product.workspacePath` records the directory. `EngineeringTask.allowedFiles`
  (a JSON array of paths *relative to that workspace root*) is the real,
  enforced permission boundary (§13 below) — not a database field alone,
  a check inside the write tool's own `execute()`.
- A lightweight, real audit trail substitutes for git commit history:
  every file the Engineering Agent writes is recorded as one
  `EngineeringTaskFile` — wait, no new table for this; see §32 — a
  JSON `filesChanged: string[]` on `EngineeringTask` plus the actual
  file bytes on disk are sufficient for Code Review/QA/Security to
  inspect, and the directory itself *is* the artifact, exactly like a
  demo script's SQLite file is the artifact rather than a migration
  log.
- **Why not real git:** this session is itself running inside a live
  checkout of `claude/ventureforge-constitution-s1jj35` — the branch
  these very words are committed to. Any code path that lets an
  agent (even a fully deterministic dev-fixture one) invoke `git
  checkout`/`git branch` creates a real, non-hypothetical risk of that
  operation running against *this* repository's *actual* working tree
  mid-session, discarding uncommitted work or switching this session's
  own branch out from under it. A disposable, gitignored directory
  carries none of that risk — deleting it is always safe, and it is
  never `git add`-able by accident (§10's own directory sits outside
  every `git add` invocation this repository's own workflow uses).
  **Considered:** a real git worktree per product, cleaned up on
  completion. **Rejected:** the blast radius of a bug in that cleanup
  path (a stray `git worktree remove` or `checkout` against the wrong
  ref) is categorically worse than the cost of not having real git
  history for generated-product code that is disposable by design
  anyway. Deferred to a human-supervised `git init`/`gh pr create` step
  outside M6's own autonomy, if a product is ever promoted beyond a
  demo (§39 deferred functionality, and the brief's own hard boundary:
  "MUST NOT merge directly into the protected production branch").

## 11. Coding agent model

The Engineering Agent processes **exactly one `EngineeringTask` per
execution**, sequentially — never two tasks in parallel against the
same workspace (avoids write races without needing file locking, and
matches "tasks must be small enough to review" from the brief). Same
`agentRuntimeService.run` shape as every other agent; its budget is the
tightest in the system (§28) precisely because its tool calls are the
first ones in five milestones that touch a real filesystem/subprocess.

## 12. Task decomposition

`engineeringTaskService.decomposeFromArchitecture` walks
`MvpArchitecture`'s `MUST_HAVE` components and produces one
`EngineeringTask` per component (title, purpose, `dependsOnTaskIds`,
`productSpecId`+`mvpArchitectureId` as inputs, `allowedFiles`,
`acceptanceCriteria`, `testsRequired`, `riskLevel`, the exact two
permissions from §29). Deliberately **not** one task per file or one
task per line of a checklist — coarse enough to be a coherent unit of
review, fine enough that a single failure never threatens the whole
build. For the demo/capstone-scale product (§40 of the brief: keep the
first product intentionally tiny) this is realistically 2-4 tasks
(e.g. "health/status endpoint," "the one core resource's CRUD API,"
"persistence + migration").

## 13. Engineering execution

Two new tools, both `GREEN` risk, gated by two new, narrowly-scoped
permissions (full reasoning in §1's audit finding and §28-29):

```
write_workspace_file   requires WRITE_WORKSPACE_FILES
  input: { workspacePath, relativePath, content }
  execute(): rejects any relativePath that resolves (via path.resolve,
    checked against the real absolute workspace root) outside the
    workspace directory, or outside EngineeringTask.allowedFiles —
    a real containment check, not a convention.

run_workspace_command   requires RUN_WORKSPACE_COMMAND
  input: { workspacePath, command }  // command drawn from a fixed allowlist:
    "npm install" | "npm test" | "npm run build" | "npm run typecheck" | "npm run lint"
  execute(): spawns via child_process.execFile (never a shell string),
    cwd pinned to the workspace directory, real stdout/stderr/exit code
    returned — this is a genuinely real subprocess in every
    MODEL_PROVIDER_MODE, exactly as real as `researchCycleService`'s
    own SQLite writes always are.
```

The Engineering Agent's own *model call* (deciding what file content to
write for a given task) follows the standard dev-fixture discipline:
deterministic, derived from the task's own `acceptanceCriteria`/`title`,
labeled `[DEV FIXTURE]` in code comments and generated file headers,
genuinely produces a small, runnable Express handler + a matching real
test file — never a static, one-size-fits-all stub. It cannot redefine
the product: it holds no service method that writes to `ProductSpec`/
`MvpArchitecture`, only to its own `EngineeringTask.filesChanged`/
`implementationSummary`/`knownLimitations`.

## 14. Code review

`codeReviewService.review(task)` — zero tool calls, reads the real file
contents the Engineering Agent just wrote (via the same workspace-root
containment check, read-only) plus the task's own acceptance criteria,
and produces `CodeReview` findings tagged `BLOCKER`/`HIGH`/`MEDIUM`/`LOW`
across correctness, architecture compliance, scope, maintainability,
security, error handling, tests, regressions, unnecessary complexity,
dependency additions. **Structurally never the same agent row as the
Engineering Agent** — `codeReviewService` is called with a distinct
`Agent` (its own zero-grant identity), and no code path lets the
Engineering Agent's own execution mark a `CodeReview` row as passed.

## 15. QA

`qaService.run(task)` — reasoning, not re-execution: it inspects the
real implementation and the real test file(s) the Engineering Agent
wrote and judges coverage against the brief's own checklist (happy
path, empty state, invalid input, boundary values, auth/authz, failure
paths, concurrency where relevant, persistence, API failures,
frontend/backend mismatch), producing a `QaReport` that explicitly lists
**missing** test cases, not just a pass/fail on what exists — matching
"QA must not merely run existing tests" precisely. Whether the tests
that *do* exist actually pass is a separate, mechanical fact — the
Integration Test stage (§2's pipeline), which runs `run_workspace_command`
for real.

## 16. Security review

`securityReviewService.run(task)` combines, like `evidenceValidatorService`
already does, **deterministic factors** (a real, cheap static scan of
the workspace's own file text for hardcoded-looking secrets, `eval(`/
`Function(` construction, disabled TLS verification, string-concatenated
SQL) with **model judgment** over auth/authz/session/input-validation/
SQLi/XSS/CSRF/SSRF/IDOR/secret-exposure/logging/uploads/external-APIs/
dependency-vulnerabilities/rate-limiting/privilege-escalation/data-leakage,
producing `PASS`/`PASS_WITH_WARNINGS`/`FAIL` with the specific evidence
(file + line + reason) behind each finding — never a bare verdict.

## 17. Dependency management

Every `package.json` dependency the Engineering Agent's fixture adds is
recorded as a `DependencyRecord` JSON entry on the owning
`EngineeringTask` (name, version, purpose, licenseConsideration,
securityStatus, alternativesConsidered, reasonForInclusion). Default
policy: **zero new dependencies** beyond the minimal generated stack's
own runtime (`express`) and dev/test tooling (already present via the
workspace's generated `package.json`) — Code Review's own "dependency
additions" check (§14) is where an unjustified new dependency gets
flagged `HIGH`.

## 18. Secrets handling

No M6 agent — Product Strategist, MVP Architect, UX, Engineering, Code
Review, QA, Security — ever holds `ACCESS_SECRET`. The workspace's own
`.env` (if `MvpArchitecture` calls for one) contains only placeholder
dev values the Engineering Agent's own fixture writes (`DATABASE_URL=file:./dev.db`
style) — never a value read from VentureForge's real `.env`, which the
Engineering Agent's execution context has no path to reach at all (its
tools only ever see the paths it's explicitly handed).

## 19. Database management

**VentureForge's own database** (`prisma/dev.db`, the M1-M5 governance
schema) gains the M6 tables listed in §32 and nothing else — no
product-specific table is ever added to it. **A product's own
database** is a workspace-local SQLite file inside
`factory-workspaces/<product-id>/`, created by the product's own
generated `prisma/schema.prisma`, migrated via `run_workspace_command`
(`npx prisma migrate dev`, scoped to the workspace's own `DATABASE_URL`)
— a completely separate Prisma project, never sharing a schema, a
migration history, or a connection string with VentureForge's own.

## 20. Migrations

Product migrations live at `factory-workspaces/<product-id>/prisma/migrations/`,
generated and applied entirely inside the workspace by
`run_workspace_command`, following the exact same "CHECK-constrained
SQLite" discipline this repository's own migrations already use (the
Engineering Agent's fixture reuses the pattern, not a new one) — but
they are workspace artifacts, never committed to VentureForge's own
`prisma/migrations/`.

## 21. Test environments

`npm install` then `npm test`, both real, both `run_workspace_command`
calls scoped to the workspace's `cwd`. No product test ever touches
VentureForge's own `test.db` or the real `tests/` directory.

## 22. Build artifacts

`npm run build`'s output stays inside `factory-workspaces/<product-id>/dist/`
— never copied into, or referenced from, VentureForge's own `dist/`.

## 23. Human approval boundaries

Exactly two, mirroring M5's own two-hard-gate discipline:

1. **Product creation.** A `Product` starts `PROPOSED` the moment the
   factory is asked to build a given opportunity; only a verified HUMAN
   actor can move it to `APPROVED` (`assertHumanActor`, unmodified) —
   nothing before this point (Strategist, prioritization, spec, even a
   dry-run architecture) requires human approval, since nothing before
   it writes a single line of code or touches a workspace.
2. **Human Review of the compiled memo.** `APPROVE`/`REQUEST_CHANGES`/
   `REJECT`/`DEFER`, Human-Owner-only, idempotent — the only path to
   `READY_FOR_DEPLOYMENT`.

Deployment itself needs a **third**, separate approval this milestone
does not implement the auto-executable side of at all (§23/§30 of the
brief: M6 produces a deployment plan, never deploys) — there is no
`DEPLOYED` state in this milestone's lifecycle (§21 of the brief says
so explicitly).

## 24. Branch/merge policy

No real branch or merge of the VentureForge repository ever happens
autonomously (§10 above). A "PR / review artifact" is a persisted,
human-readable diff-and-summary document generated from the workspace's
own file contents — never an actual `git push`/pull-request creation
against any real remote. Promoting a reviewed workspace into a real
repository, on a real branch, through a real PR is explicitly **out of
M6's autonomous scope** (§39 deferred functionality) — it is exactly
the kind of "merge into protected production branch" the brief's hard
boundary forbids automating.

## 25. Deployment preparation

`DeploymentPlan` (persisted as JSON on `Product`, no new table —
smallest correct model): environment requirements, migration plan
(reusing §20's own real migration files), a rollback plan (§27), a
monitoring checklist (§26), and a cost estimate (§28's own
`estimatedOperatingCostUsd`, clearly labeled ESTIMATE). Produced once
the product reaches `HUMAN_REVIEW`; never executed by any code path in
this milestone.

## 26. Observability

Specified as part of `MvpArchitecture.designJson` (application logs,
error tracking approach, the small number of metrics from §26 of the
brief, health checks, audit events) — for the demo-scale product, the
Engineering Agent's own fixture genuinely generates one real
`GET /health` endpoint (cheap, concrete, matches "small + correct" over
"large + impressive"), rather than only ever describing observability
in prose.

## 27. Rollback

Recorded, not executed: previous workspace state (the directory itself,
untouched until the next task — no in-place destructive rewrite), the
migration's own down-migration or "recreate from a fresh `prisma
migrate deploy`" strategy, configuration rollback (revert the `.env` the
Engineering Agent wrote), failure detection (QA/Security verdicts +
Integration Test result), and manual recovery steps — all as a
`RollbackPlan` JSON field alongside the deployment plan.

## 28. Failure handling

`EngineeringTask.attemptCount`, capped at `MAX_TASK_ATTEMPTS = 2`
(founder-revisable constant, like every other threshold in this
codebase). A failed attempt is captured (the real error, the real
partial workspace state) and classified; `productFactoryService`
decides whether a second attempt is warranted (same failure class as
last time -> no, retry a different failure class once). A second
failure moves the `Product` to `HUMAN_REVIEW` directly — never an
unbounded `while (failed) retry` loop, mirroring `withBoundedRetry`'s
own existing, unmodified transport-level retry discipline one layer up.

## 29. Cost controls

Every new agent (Product Strategist, MVP Architect, UX, Engineering,
Code Review, QA, Security) declares its own `Partial<ExecutionBudget>`,
same mechanism, no new budget type. The Engineering Agent's budget is
the tightest — `maxToolCalls` bounded to roughly the number of files a
single small task should touch (single digits), `maxDurationMs` bounded
low enough that a real `npm install` for a two-dependency project
comfortably finishes inside it. `Product.estimatedDevelopmentCostUsd`/
`estimatedOperatingCostUsd` are honestly labeled `ESTIMATE`, carrying
forward the same `estimatedCostUsd`-not-yet-real gap `docs/DECISIONS.md`
already documents for M2-M5 — M6 does not solve real cost metering
either.

## 30. Agent permissions

| Agent | Tool calls | Permissions |
|---|---|---|
| Product Strategist | 0 | none |
| MVP Architect | 0 | none |
| UX Agent | 0 | none |
| Engineering Agent | bounded, small | `WRITE_WORKSPACE_FILES`, `RUN_WORKSPACE_COMMAND` (both new, `GREEN`) |
| Code Review Agent | 0 | none |
| QA Agent | 0 | none |
| Security Agent | 0 | none |

None of the seven ever holds `READ_WEB`, `WRITE_FILES`, `EXECUTE_CODE`,
`ACCESS_SECRET`, `DEPLOY_APPLICATION`, `SPEND_MONEY`,
`CREATE_EXTERNAL_ACCOUNT`, or `MODIFY_CONFIGURATION` — the same
"exactly what the job needs, confirmed by `makeFullAgentSet()`-style
test helpers holding no extra grants" discipline every M1-M5 agent
roster already follows.

## 31. Guardian integration

Unmodified `authorizationService.authorize`, called exactly the way
`agentRuntimeService.callTool` already calls it for every tool. The two
new permissions are declared in the same `PERMISSIONS`/`PERMISSION_RISK_LEVEL`
tables every existing permission lives in — not a parallel permission
system. `GET`-only, read-heavy: nothing about M6 changes how
`authorizationService` itself decides `ALLOWED`/`DENIED`/`REQUIRES_APPROVAL`.

## 32. CEO integration

A third CEO entry point, `ceoReasoningService.recommendProductBuildAction`,
alongside M4's `run` and M5's `recommendCustomerDiscoveryAction` — same
zero-tool-call budget, same `ceo_recommendations` table (one more action
set, `PRODUCT_BUILD_ACTIONS`: `BUILD`/`CONTINUE_BUILD`/`CUT_SCOPE`/
`REQUEST_CUSTOMER_RESEARCH`/`STOP`/`REQUEST_HUMAN_REVIEW`), every
recommendation citing claim/evidence/QA/Security-report ids. It cannot
bypass Guardian for the same reason no M1-M5 CEO call ever could: it
holds zero tool-call budget and zero grants.

## 33. Chairman integration

A third extension of `chairmanService.review` (after M4's claims
context and M5's customer-discovery context): when a `Product` exists
for the opportunity, the prompt and dev fixture additionally receive
the `ProductSpec`/`MvpArchitecture`/QA/Security verdicts and ask the
brief's own seven questions (did we build the actual validated problem;
did engineering drift from customer evidence; did we overbuild; are we
testing the right claim; does the MVP prove anything; working-demo-vs-PMF
confusion; what could make this fail). Output `APPROVE`/
`REQUEST_CHANGES`/`REJECT`, same `chairman_reviews` table. The Chairman
still never approves deployment — it feeds the Human Review memo,
exactly like every prior milestone's Chairman output.

## 34. Database changes

Eight new tables — the smallest correct model, each justified against
folding it into an existing one:

| Table | Shape | Why not folded elsewhere |
|---|---|---|
| `Product` | one row per opportunity build attempt | needs its own lifecycle state machine distinct from `Opportunity.status` |
| `ProductSpec` | historized | strategy is revised repeatedly; folding into `Product` would lose history exactly like folding `IcpProfile` into `Opportunity` would |
| `MvpArchitecture` | historized | same reasoning, one level down |
| `Feature` | child of `ProductSpec` | one row per prioritized feature; a JSON blob on `ProductSpec` would make the prioritization table (§6) unqueryable |
| `EngineeringTask` | child of `MvpArchitecture` | the actual unit of bounded work; needs its own status/attempt count |
| `CodeReview` | child of `EngineeringTask` | independent reviewer output, never merged into the task row it reviews |
| `QaReport` | child of `EngineeringTask` | same reasoning |
| `SecurityReview` | child of `EngineeringTask` | same reasoning |

`ProductReviewMemo` is deliberately **not** a ninth table — it reuses
the exact compiled-JSON-content pattern `InvestmentMemo`/
`CustomerDiscoveryMemo` already established, but since `chairman_reviews`/
`ceo_recommendations` are already shared, reused tables (§32-33), the
memo itself is one more row on a **new**, ninth table after all,
mirroring `CustomerDiscoveryMemo`'s own precedent exactly (a
compiled-memo table is its own thing, not folded into `Product`) — nine
total, named `ProductReviewMemo`.

## 35. APIs

`products`, `product-specs`, `mvp-architectures`, `engineering-tasks`,
`code-reviews`, `qa-reports`, `security-reviews`, `product-review-memos`
— same `requireAuth()`/`requireHuman()`/`asyncHandler`/`validateBody`
convention as every M1-M5 router; `opportunities.routes.ts` gains a
`GET /:id/products` sub-resource. No route ever exposes a capability to
deploy, spend money, or write outside a workspace — mirrors M5's own
"no route exposes a send capability" discipline, confirmed the same way
(a dedicated API test asserting every privileged M6 endpoint 403s for
an `AGENT` credential, and that no endpoint exists that could trigger
`run_workspace_command`/`write_workspace_file` outside a real
`EngineeringTask`'s own bounded execution).

## 36. Security threat model

Nine properties, each provable by a real test, not a documentation
claim (brief §35):

1. **No production secrets in agent context** — the Engineering Agent's
   execution never receives VentureForge's real `.env`; test:
   fixture-write a workspace file and assert its content contains none
   of the real `.env`'s own values.
2. **Cannot modify the protected branch** — no tool in the Engineering
   Agent's registry can invoke git at all; test: assert the tool
   registry's entries available to it have no `execute()` path that
   shells out to `git`.
3. **Cannot deploy without approval** — no `DEPLOY_APPLICATION` grant,
   ever; no tool exists that deploys anything; test mirrors M5's
   `SEND_EXTERNAL_MESSAGE` grep-for-zero-grants pattern.
4. **Cannot spend money** — no `SPEND_MONEY` grant, ever; same pattern.
5. **Cannot change its own permissions** — `agentService.grantPermission`
   requires a `HUMAN` actor (unmodified since M1); test: an Engineering
   Agent execution attempting to call it directly has no such method
   reachable from its `ExecutionHandle`.
6. **Cannot change Guardian rules** — `PERMISSION_RISK_LEVEL`/`RISK_POLICY`
   are compile-time constants, not database rows; no service method
   writes to them.
7. **Cannot modify audit history** — `auditService` exposes `record`/`list`
   only (unmodified); no update/delete path exists anywhere in the
   codebase.
8. **Cannot approve its own high-risk action** — `SelfApprovalError`
   (unmodified since M1) plus the same `assertHumanActor` defense in
   depth every M2-M5 apply-decision service already carries.
9. **Cannot escape workspace boundaries** — the concrete, new test:
   assert `write_workspace_file` rejects `relativePath` values
   containing `..` or resolving (via `path.resolve`) outside the
   workspace root, including absolute-path attempts and symlink-style
   traversal strings.

## 37. Testing

Full coverage per brief §41's own bucket list (Product Strategy/MVP/
Architecture/Engineering/Review/Governance/Security), plus the three
mandatory capstones (§38 below) with real seeded evidence — no
hardcoded "everything passed" shortcut, matching the exact discipline
`tests/integration/m5-end-to-end.test.ts` already set.

## 38. Calibration

A third extension of `calibrationService`/`summarizeCalibration` — no
new bucketing mechanism. Tracks `EngineeringTask`'s own predicted risk
level against its actual review/QA/security/human-feedback outcome
(the same "prediction vs. eventual verdict" shape M4/M5 calibration
already uses, with a fourth explicit `positiveDecision` label passed
in, exactly like M5's own extension pattern). Read-only; no automatic
prompt rewriting, no agent self-modification, no self-modifying code —
restated because §33 of the brief calls it out as its own requirement,
not because the mechanism differs from M4/M5's.

## 39. Alternatives considered

- **Real git branch/worktree per product.** Rejected — §10 above; the
  blast radius of a git-manipulation bug against this session's own
  live checkout outweighs the benefit of real commit history for
  disposable, workspace-scoped generated code.
- **Reusing `WRITE_FILES`/`EXECUTE_CODE` directly.** Rejected — §1's own
  audit finding: both are `YELLOW`, and `YELLOW` fails closed inside a
  running execution by construction (no mid-run approval suspension
  exists), so no tool gated on them could ever complete. Two new,
  narrowly-scoped, `GREEN` permissions (confined to a disposable
  workspace, no secrets, no network, no production) are the correct
  match for their genuinely smaller blast radius — not a loosening of
  the original two, which stay exactly as conservative as M1 left them.
- **QA Agent re-running tests itself as an agentic loop.** Rejected in
  favor of splitting judgment (QA: are the right things tested) from
  mechanical execution (the Integration Test stage: do the existing
  tests pass) — mirrors this codebase's own recurring split between a
  reasoning agent's *deterministic input factors* and its *model
  judgment* (Evidence Validator, Security Review).
  Concentrates real subprocess risk (the actual `npm test` run) in one
  auditable stage instead of duplicating it inside a review agent too.
- **One giant `BUILD_ENTIRE_MVP` engineering task.** Rejected — the
  brief itself forbids it (§10); also would make Code
  Review/QA/Security's own findings unreviewably broad, the same
  "keep it small enough to actually challenge" reasoning that already
  shaped M5's per-message (not per-experiment) approval gate.
- **Containerized (Docker) workspace sandboxing.** Deferred, not
  rejected outright — real value for defense in depth, but adds a new
  infrastructure dependency this milestone's own "no premature
  complexity" principle (§9) argues against introducing before a
  plain-directory-plus-path-containment model has even shipped once.

## 40. Risks

- **Workspace path-traversal bug** in `write_workspace_file` would be
  the single most severe possible M6 defect — mitigated by a dedicated,
  adversarial test (§36.9), not review alone.
- **Unbounded engineering retry** if the attempt-count cap were ever
  bypassed — mitigated by capping at the runtime layer
  (`EngineeringTask.attemptCount`), not just in the orchestrator's own
  loop logic.
- **Dependency bloat** in generated products — mitigated by the default
  zero-new-dependency policy (§17) and Code Review's own dedicated
  check.
- **Product database habits leaking into VentureForge's own schema** —
  mitigated by the hard separation in §19; a future contributor adding
  a product-specific column to a VentureForge table would be a real
  regression, worth a dedicated lint/review note in `docs/DECISIONS.md`
  once implementation lands.
- **A generated product accidentally containing a real-looking secret**
  (e.g. a plausible-but-fake API key string in a fixture) being
  mistaken for a real leak, or vice versa — mitigated by the Security
  Agent's own deterministic scan plus explicit `[DEV FIXTURE]` labeling
  in every generated file's own header comment.
- **Human mistaking a working MVP for product-market fit** — mitigated
  structurally: the Product Review Memo's own template (brief §42)
  never contains a revenue/customer-count/production-deployment field
  unless one is actually populated from a real prior milestone's data,
  and `docs/DECISIONS.md`/the final report keep "product validation"
  and "technical completion" in explicitly separate sections (brief
  §44).

## 41. Deferred functionality

Explicitly out of M6's scope, not silently missing: real git
branch/PR creation against an actual remote; real production
deployment of any kind; multi-product parallel builds (this milestone
processes one product's tasks strictly sequentially); real, metered
API/hosting cost tracking (stays an honest `ESTIMATE`, same gap
M2-M5 already carry); containerized workspace sandboxing (§39); a
second generated-stack option beyond the default Node/TS/Express/
Prisma/SQLite choice; self-healing engineering (retrying with a
genuinely different implementation strategy after a failure, beyond
the bounded plain-retry in §28); autonomous prompt rewriting or any
form of agent self-modification (explicitly forbidden by brief §33
regardless of feasibility).
