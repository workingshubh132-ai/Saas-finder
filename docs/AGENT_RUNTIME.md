# Agent Runtime

M2. The engine that actually lets an agent do something — call a
model, call a tool, produce a result — under a hard, enforced
boundary. Before M2, `ModelProvider` was a defined-but-unused
interface (`DECISIONS.md` #13); nothing in M1 executed. This is the
thing that closes that gap, per `M2_ARCHITECTURE_PROPOSAL.md` §5/§10.

## What it is not

Not a dynamic "while(true) think/act" planner, not a job queue, not a
distributed worker pool. `agentRuntimeService.run()` drives one
in-process, bounded execution to completion (or failure) inside a
single call — the M2 brief explicitly forbids an unrestricted
loop (Part 21), and M2 has exactly one agent type with a fixed
pipeline, not a dynamic planner deciding its own step count
(`M2_ARCHITECTURE_PROPOSAL.md` §17, Alternatives).

## Lifecycle

`src/domain/execution/execution.types.ts`:

```
CREATED → QUEUED → RUNNING ⇄ WAITING_FOR_TOOL
                       │            │
                       ├──► PROCESSING_RESULT ──► COMPLETED
                       ├──► COMPLETED
                       ├──► FAILED
                       └──► CANCELLED  (WAITING_FOR_TOOL → FAILED, CANCELLED too)
```

`RUNNING ⇄ WAITING_FOR_TOOL` happens once per tool call, not once per
execution — the runtime alternates every time `callTool` runs.
`COMPLETED`/`FAILED`/`CANCELLED` are terminal (no outgoing
transitions). Enforced through the same generic
`domain/shared/state-machine.ts` utility as every M1 lifecycle
(`transitionExecution()` in `agent-runtime.service.ts` calls
`assertTransition()` before every status write — an attempt to skip a
state is a bug, not something silently allowed).

## Budgets — never infinite

```ts
DEFAULT_EXECUTION_BUDGET = {
  maxSteps: 6,
  maxToolCalls: 3,
  maxModelCalls: 3,
  maxRetries: 2,
  maxDurationMs: 30_000,
}
```

(`src/services/agent-runtime.service.ts`). Every budget is checked
**before** the call it guards runs, not after — `step()`, `callModel()`,
and `callTool()` each throw `BudgetExceededError` (429,
`errorCode: "BUDGET_EXCEEDED"`) the moment a limit would be exceeded,
so a runaway plan cannot make one more external call than the budget
allows. `maxDurationMs` is wall-clock, checked at the top of every
`callModel`/`callTool` against the execution's own `startedAt`.
Per-execution overrides are supported (`budgetOverrides` param to
`run()`) but no caller uses a looser default today — the Research
Agent runs on the defaults.

**What bounds cost today, and what doesn't yet:** `maxModelCalls` +
`maxToolCalls` hard-cap the number of external calls (at most 6 per
execution), and every model call sets `maxOutputTokens` (1024) —
together these bound worst-case spend for a fixed-price-per-call
model. `AgentExecution` has `promptTokens` / `completionTokens` /
`estimatedCostUsd` columns ready to receive real usage data, but
`AnthropicModelProvider.complete()` does not yet parse a `usage` block
out of the Anthropic response to populate them, and there is no
`maxCostUsd` budget field enforced independently of call count. This
is a real, acknowledged gap — see `SECURITY.md` (Runaway cost) and
the M2 final report's deferred-items list — not something silently
assumed solved.

## `ExecutionHandle` — what a driving agent gets

```ts
interface ExecutionHandle {
  transition(toStatus): Promise<void>;   // move the execution's own lifecycle status
  callModel(request): Promise<CompletionResult>;  // budget-checked model call
  callTool(toolId, input): Promise<unknown>;       // budget-checked + Guardian-authorized tool call
  step(): void;                                     // count one logical step against maxSteps
}
```

A concrete agent (today: `research-agent.service.ts`) is handed this
by `agentRuntimeService.run(executionId, program)` and drives its own
fixed pipeline through it one call at a time — the runtime owns
lifecycle/budget/audit bookkeeping; the agent owns what the steps
*mean*. See `research-agent.service.ts`'s PLAN → TOOL → SYNTHESIZE →
PROCESS_RESULT pipeline for the only implementation today.

### `callTool` is where Guardian lives

Before executing anything, `callTool` calls
`authorizationService.authorize({ agentId, action: permission, ... })`
(the *same*, unmodified M1 Guardian check, `SECURITY.md`) once per
entry in the tool's `requiredPermissions`:

- `DENIED` → throws `AuthorizationDeniedError` immediately; the tool
  never runs.
- `REQUIRES_APPROVAL` (a YELLOW/ORANGE/RED-risk tool) → **also fails
  the call**, not "pause and wait." M2 does not implement suspending
  an in-flight execution for a human to approve mid-run — building
  that queue/resume mechanism was judged out of scope for this
  milestone (`M2_ARCHITECTURE_PROPOSAL.md` §19). Failing closed was
  the deliberate choice over either silently proceeding or hanging
  forever waiting for an approval that has nowhere to go yet.
- `ALLOWED` (GREEN) → proceeds. Today's one real tool (`hn_search`,
  `READ_WEB`) is GREEN under M1's existing permission policy, so this
  path is what every current test exercises; the `REQUIRES_APPROVAL`
  branch is exercised directly in
  `tests/integration/agent-runtime.test.ts` with a higher-risk test
  tool.

This check runs on **every** tool call, not once per execution — a
permission revoked between two tool calls in the same run takes effect
on the very next call.

### Tool input/output are re-validated at the runtime boundary too

`callTool` re-parses `input` against `tool.inputSchema` and the tool's
return value against `tool.outputSchema` even though the tool
implementation validates internally — defense in depth, matching M1's
"don't trust the caller, not even an internal one" pattern
(`SECURITY.md`).

## Retries — bounded, and only for what's actually transient

`domain/shared/retry.ts`'s `withBoundedRetry()` wraps both the model
call and the tool call inside `callTool`/`callModel`, capped at
`maxRetries + 1` total attempts. Only `ToolError` and `ModelError` are
retryable (`isRetryableRuntimeError()`); `ValidationError`,
`AuthorizationDeniedError`, and `BudgetExceededError` are never
retried — retrying a permission denial or a blown budget would be
either pointless or actively unsafe. Retries increment `usage.retryCount`,
persisted on the `AgentExecution` row, and — because they happen
*inside* a budget-checked call — a flaky dependency still cannot cause
unbounded work: the outer `maxToolCalls`/`maxModelCalls` ceiling is
unaffected by how many transport-level retries one logical call used
internally.

Separately, `services/model-output.ts`'s `completeWithValidation()`
adds **one corrective retry** when a model's output fails Zod
validation (send the bad output back with "respond again with ONLY
valid JSON"). This is a second, independent kind of retry — a full
additional logical model call, and thus counted against
`maxModelCalls` like any other — not a transport retry.

## Business failures are data, not exceptions

`run()` catches every failure from `program` (tool, model,
authorization, budget, or a plain bug) and writes it as a normal
`FAILED` terminal execution — `errorCode` set from the thrown
`DomainError` (or `INTERNAL_ERROR` for anything else), `error` set to
the message, `TASK_FAILED` published on the event bus. `RunOutcome<T>`
is the discriminated union callers pattern-match on:

```ts
type RunOutcome<T> =
  | { execution; status: "COMPLETED"; result: T }
  | { execution; status: "FAILED" | "CANCELLED"; result: null };
```

The HTTP layer (`POST /api/research`) returns **201 either way** — the
execution *resource* was successfully created and run to completion,
regardless of whether that completion was a success or a well-formed,
audited failure. Only a genuinely missing/corrupt execution row (not a
business failure) throws out of `run()` itself. Proven directly in
`tests/integration/research-agent.test.ts`'s "is denied when the agent
lacks READ_WEB" test: the HTTP-visible outcome is a `FAILED` execution
with `errorCode: "AUTHORIZATION_ERROR"`, not a crash, and — critically
— no `Opportunity` row is created from the failed attempt.

## Observability

Every execution is fully reconstructable from two tables alone:

- **`AgentExecution`** — status, `agentId`/`taskId`, `startedByIdentityId`,
  model provider/name, `stepCount`/`toolCallCount`/`modelCallCount`/
  `retryCount`, timestamps, `input`/`output` (JSON), `error`/`errorCode`.
- **`ToolExecution`** — one row per tool call: `toolId`, `status`
  (`SUCCESS`/`FAILED`), `input`/`output`/`error` (JSON), timing.

`GET /api/agent-executions/:id` returns both together (`agent-executions.routes.ts`).
Nothing here is a separate logging subsystem — same append-only-row
pattern M1 already established for `AuditLog`, applied to execution
telemetry.

## What's deliberately out of scope

Mid-execution approval suspension/resume; a dynamic/open-ended
planning loop; concurrent tool calls within one execution (today's
pipeline is strictly sequential); more than one agent type driving the
runtime; cross-execution state/memory beyond what `domain/memory`
already provides; distributed/multi-process execution. All listed in
`M2_ARCHITECTURE_PROPOSAL.md` §19 and the M2 final report's deferred
list — flagged, not silently built.
