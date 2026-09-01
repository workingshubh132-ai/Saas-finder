# Research Scheduling

M3. The CEO orchestration boundary, the bounded research cycle /
operating window lifecycle, budgets and cost controls, and the
prioritized research queue that decides what a cycle works on next.
Architecture rationale in `docs/M3_ARCHITECTURE_PROPOSAL.md` §13, §16,
§20.

## The CEO orchestration boundary

`src/services/research-cycle.service.ts`'s `researchCycleService.run()`
(M3 brief Part 26, 28-29) drives the full pipeline
(`INTELLIGENCE_ENGINE.md`) end to end. It is **deterministic
orchestration code — never a model call of its own.** The brief's own
instruction: "do not build the entire autonomous CEO in M3; build the
orchestration foundation" — no model here decides *what* to research
or *how much effort* to spend; that's the fixed pipeline plus the
research-queue priority formula (below), both plain code.

It holds **no elevated privilege**: every step it triggers
(`researchAgentService.run`, `signalClusteringService.assign`,
`problemAnalystService.run`, `competitorAnalystService.run`,
`marketAnalystService.run`, `opportunityAnalystService.run`,
`researchQueueService.populateForOpportunity`) goes through the same
authenticated, Guardian-checked, audited service calls any other
caller would use — it never bypasses permissions, the approval system,
or the Human Owner (M3 brief Part 26's explicit constraint).

## Operating window / research cycle lifecycle

One entity carries both concepts (`domain/research-cycle/research-cycle.types.ts`)
— a research cycle *is* one bounded operating window, so a separate
`OperatingWindow` entity would duplicate the same lifecycle for no new
information:

```
SCHEDULED → RUNNING → {COMPLETED | FAILED | STOPPED | PAUSED | CANCELLED}
SCHEDULED → AWAITING_HUMAN → {SCHEDULED | RUNNING | CANCELLED}
```

`AWAITING_HUMAN` has exactly one real producer in M3 (not a decorative
unused state): a cycle whose Research Agent currently lacks the
`READ_WEB` grant it needs lands here instead of failing outright or
silently doing nothing — checked via the unmodified
`authorizationService.authorize()` before the cycle even transitions
to `RUNNING`. This surfaces "why is nothing running" in the same
queue-shaped place as every other decision, not buried in a log.

## Budgets — layered on top of the unchanged per-execution budget

Two layers (`docs/M3_ARCHITECTURE_PROPOSAL.md` §20):

- **Per-`AgentExecution`** (unchanged from M2, `AGENT_RUNTIME.md`):
  still bounds every individual agent run.
- **Per-`ResearchCycle`** (new): `maxSignals`, `maxToolCalls`,
  `maxModelCalls`, `maxDurationMs`, `maxCostUsd` bound the **sum**
  across every `AgentExecution` a cycle spawns.

```ts
DEFAULT_RESEARCH_CYCLE_BUDGET = {
  maxDurationMs: 120_000,
  maxSignals: 30,
  maxToolCalls: 20,
  maxModelCalls: 20,
  maxCostUsd: 5,
}
```

Sized to comfortably cover one cold-start cycle with margin, not
derived from an SLA — a founder-revisable number
(`docs/DECISIONS.md`), overridable per call
(`RunResearchCycleParams.budgetOverrides`).

`researchCycleService` checks the running total against every ceiling
**before** starting the next pipeline stage (before invoking the next
agent) — same "check before, not after" discipline as
`ExecutionBudget`. On any ceiling hit, the cycle transitions to
`STOPPED` with a `stoppedReason` naming which budget was exhausted.
**Every row already committed stays exactly as it is** — nothing
already written is rolled back (M3 brief Part 38: "STOP, AUDIT, SAVE
PARTIAL RESULTS. Do not throw away useful partial work.") — each
pipeline stage commits its own output immediately rather than staging
results in memory for one final atomic write, so a mid-cycle stop
simply means later stages never ran, not that earlier ones are undone.
`tests/integration/research-cycle.test.ts`'s "stops cleanly within
budget" test proves this directly: a cycle stopped by a tight
`maxModelCalls` override still has its collected `Signal` rows
genuinely persisted in the database afterward.

**Cost, stated plainly**: `estimatedCostUsd` accumulation carries the
same honest gap M2 flagged (`AGENT_RUNTIME.md`, `SECURITY.md`) forward
— it sums whatever each `AgentExecution.estimatedCostUsd` reports,
which is `null` today (no real provider call in this environment, and
even `AnthropicModelProvider` doesn't yet parse a `usage` block).
`maxCostUsd` is therefore enforced indirectly today, via bounded call
counts × bounded `maxOutputTokens` per call, not a live dollar figure
— not silently fixed here, carried forward as the same flagged gap.

## The research queue — what to work on next

`src/services/research-queue.service.ts` (M3 brief Part 30-31).
Populated after each Opportunity is generated
(`researchQueueService.populateForOpportunity`): one `ResearchQueueItem`
per unresolved `EvidenceGap` on that opportunity
(`OPPORTUNITY_INTELLIGENCE.md`), each carrying a documented priority:

```
priority = 0.4 × informationGain
         + 0.3 × opportunityScore
         − 0.2 × killRiskScore
         − 0.1 × estimatedResearchCost
```

(`domain/research-queue/priority.ts`) — **deliberately unbounded, can
go negative**: a costly item on a low-scoring, high-kill-risk
opportunity should sort to the bottom, not get floored to an
uninformative 0 alongside genuinely marginal items.

At the start of every cycle, `researchCycleService` calls
`researchQueueService.next()` — the single highest-priority `PENDING`
item, if one exists — and, if found, uses **that item's own research
question as the cycle's objective**, marking it `IN_PROGRESS` then
`DONE` around the run. Only when the queue is empty does the cycle
fall back to the caller's cold-start objective. This is the literal
implementation of Part 30's example: *"the best next research task
isn't always 'research the highest-scoring opportunity' — sometimes it
is 'resolve the single uncertainty most likely to change the
decision.'"* Proven directly:
`tests/integration/research-cycle.test.ts`'s "a second cycle resolves
the highest-priority queue item from the first" test asserts the
*persisted* `ResearchCycle.objective` column — not just an in-memory
variable — reflects the resolved queue-item question, not the
caller's originally-passed fallback (a real observability bug caught
and fixed during development; see `docs/DECISIONS.md`).

`ResearchQueueItem.kind` (`RESOLVE_EVIDENCE_GAP | DEEPEN_RESEARCH |
NEW_SIGNAL_SWEEP`) is defined for all three shapes the M3 brief
describes; only `RESOLVE_EVIDENCE_GAP` is actually produced in M3 —
the other two kinds are schema-ready seams for a future scheduler that
also considers "deepen an under-researched but promising opportunity"
or "sweep for brand-new signals even with an empty queue," neither of
which M3 needed to build to satisfy Part 30's core requirement.

## What's deliberately out of scope

A reasoning "CEO agent" making real prioritization judgment calls with
its own model reasoning; mid-cycle pause/resume for a non-blocking
reason (a stopped cycle does not resume — the next scheduled cycle
starts fresh and the research queue carries forward what's still
unresolved); calendar/cron-based automatic scheduling (the brief's own
"the actual scheduling implementation can remain minimal" — starting a
cycle is still an explicit, Human-Owner-authenticated HTTP call,
`POST /api/research-cycles`); a live, dollar-denominated `maxCostUsd`.
All listed in `docs/M3_ARCHITECTURE_PROPOSAL.md` §26.
