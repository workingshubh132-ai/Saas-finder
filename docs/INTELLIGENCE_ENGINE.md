# Intelligence Engine

M3 — the top-level map of how VentureForge continuously discovers,
clusters, researches, evaluates, and ranks real SaaS opportunities.
This document is the entry point; `SIGNAL_MODEL.md`, `SOURCE_ADAPTERS.md`,
`OPPORTUNITY_INTELLIGENCE.md`, and `RESEARCH_SCHEDULING.md` each cover
one stage in depth. Full design rationale lives in
`docs/M3_ARCHITECTURE_PROPOSAL.md`.

## The pipeline, end to end

```
PUBLIC SIGNAL (Hacker News, Stack Exchange, ...)
   │  src/sources/*.source.ts
   ▼
SOURCE ADAPTER  ──►  RawSourceResult          SOURCE_ADAPTERS.md
   │  src/tools/source-search.tool.ts (Guardian-gated, rate-limited)
   ▼
NORMALIZED SIGNAL  ──►  Signal row             SIGNAL_MODEL.md
   │  src/services/signal.service.ts (dedup, quality score)
   ▼
SIGNAL CLUSTER  ──►  SignalCluster row         SIGNAL_MODEL.md
   │  src/services/signal-clustering.service.ts
   ▼
PROBLEM CANDIDATE  ──►  Problem row            SIGNAL_MODEL.md
   │  src/services/problem-analyst.service.ts
   ▼
MULTI-SOURCE EVIDENCE  ──►  Evidence rows       OPPORTUNITY_INTELLIGENCE.md
   │  promoted from the cluster's own signals, idempotently
   ▼
OPPORTUNITY CANDIDATE  ──►  Opportunity row     OPPORTUNITY_INTELLIGENCE.md
   │  src/services/opportunity-analyst.service.ts
   │  (Competitor Analyst + Market Analyst feed this stage)
   ▼
OPPORTUNITY SCORE + KILL-RISK SCORE             OPPORTUNITY_INTELLIGENCE.md
   │  src/services/opportunity-scorer.ts, kill-risk-scorer.ts
   ▼
EVIDENCE GAP + NEXT-BEST-RESEARCH-QUESTION      OPPORTUNITY_INTELLIGENCE.md
   │  src/services/evidence-gap.service.ts
   ▼
RESEARCH QUEUE                                  RESEARCH_SCHEDULING.md
   │  src/services/research-queue.service.ts
   ▼
CHAIRMAN REVIEW  ──►  ChairmanReview row         CHAIRMAN.md (M2, extended)
   │  src/services/chairman.service.ts
   ▼
HUMAN DECISION QUEUE  (unchanged from M1/M2)
```

Every arrow above is a real, separately-callable service — nothing
folds two pipeline stages into one function, matching M3 brief Part
3's rule that Signal, Evidence, Problem, Opportunity, and Decision are
five different concepts, never collapsed into one.

## The CEO orchestration boundary

`src/services/research-cycle.service.ts`'s `researchCycleService.run()`
is what actually drives the pipeline above end to end inside one
bounded, budgeted "research cycle" — deterministic orchestration code,
never a model call of its own (M3 brief Part 26: "build the
orchestration foundation, not the full autonomous CEO"). See
`RESEARCH_SCHEDULING.md` for its budget model, the operating-window
lifecycle, and how it decides what to research next.

## Agents

Six agent roles total, each with a genuinely distinct reasoning task
(M3 brief Part 25's anti-proliferation rule) — full detail in
`docs/M3_ARCHITECTURE_PROPOSAL.md` §14:

| Agent | New in | Makes a tool call? |
|---|---|---|
| Research Agent | M2, modified in M3 | yes (signal collection) |
| Problem Analyst | M3 | no |
| Competitor Analyst | M3 | yes (one bounded search) |
| Market Analyst | M3 | no |
| Opportunity Analyst | M3 | no |
| Chairman | M2, extended in M3 | no (not a registered Agent — a distinct governance role, `CHAIRMAN.md`) |

Every agent runs through the unchanged `agentRuntimeService`
(`AGENT_RUNTIME.md`) — full budget enforcement, Guardian authorization
on every tool call, and `AgentExecution`/`ToolExecution` telemetry —
even the four that make zero tool calls, for uniform accountability
(Constitution §25) and observability (M3 brief Part 22).

## What M3 does NOT do

No autonomous outbound action of any kind. Every path in the pipeline
above terminates at the unchanged Human Decision Queue — nothing here
sends a message, spends money, deploys anything, or creates an
external account. See each linked doc's own "deferred" section, and
`docs/M3_ARCHITECTURE_PROPOSAL.md` §26 for the full list.

## Honesty under thin evidence

At three separate points in the pipeline, "we don't have enough" is a
real, successful, non-error outcome rather than something worked
around:

- A `SignalCluster` too small/unclustered simply never gets deep
  enough to matter.
- A `Problem` extracted from a thin cluster is created with
  `status: "INSUFFICIENT_EVIDENCE"` and the pipeline stops there for
  it — no Opportunity is manufactured (`opportunity-analyst.service.ts`,
  `OPPORTUNITY_INTELLIGENCE.md`).
- Every dev-mode fixture (no live model/network in this sandbox — see
  `SOURCE_ADAPTERS.md`) is a genuine function of its real input,
  proven by dedicated tests (`tests/integration/*-analyst.test.ts`)
  showing different inputs produce different outputs — never a static
  "always succeeds" stub.

M3 brief Part 43's own words: "If the evidence is weak, VentureForge
must say INSUFFICIENT EVIDENCE. That is a successful outcome." — this
is a real, tested code path, not a documentation claim.
