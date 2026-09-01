# Opportunity Intelligence

M3. How a `Problem` becomes a scored, kill-risk-assessed `Opportunity`
with a ranked next research question — the Competitor Analyst, Market
Analyst, Opportunity Analyst, the extended scorer, the kill-risk
scorer, and the evidence-gap engine. Architecture rationale in
`docs/M3_ARCHITECTURE_PROPOSAL.md` §9-14.

## Competitor Analyst

`src/services/competitor-analyst.service.ts` (M3 brief Part 17, 24) —
the one new agent that makes a tool call, so its search genuinely
passes through Guardian (`AGENT_RUNTIME.md`) exactly like the Research
Agent's does. Budget: one bounded search (query built deterministically
from the Problem's `workflow` field — no separate planning model call
needed for one query) + one extraction model call.

The query targets Hacker News specifically
(`COMPETITOR_SEARCH_TOOL_ID = "hacker_news"`, hardcoded) — the more
general "what are people discussing/using" source; Stack Exchange's
Q&A framing is less suited to "what tools exist for this."

**Never fabricates pricing or a competitor that isn't there.** The
extraction prompt is explicit: record only observations the search
results actually support; if a result doesn't mention a price, don't
report one. Zero competitors found is a fully valid, real answer — M3
brief Part 17's own reframe: *"No competitors → possibly no market,"*
not automatically a green light.

`Competitor` (canonical, reusable across problems — found-or-created
by name, `competitorRepository.findOrCreateByName`) is kept separate
from `CompetitorObservation` (one opportunity-specific, timestamped
note: `type` — `PRICING | POSITIONING | REVIEW | STRENGTH | WEAKNESS |
MARKET_MATURITY` — plus `detail` and an optional `sourceReference`).
Competitor name matching is case-sensitive exact match, deliberately —
no fuzzy entity resolution in M3 (`docs/DECISIONS.md`).

## Market Analyst

`src/services/market-analyst.service.ts` (M3 brief Part 18, 24) —
reasoning-only, zero tool calls, one bounded model call over the
Problem's own fields. Produces `wtpSignals: string[]` (empty is a
valid, honest answer — Part 18's core distinction: *pain* is not the
same as *pain someone will pay to remove*, and reporting zero WTP
signals when none exist is correct, not a failure), `marketTiming`,
and `marketSizeQualitative` (both free text; "unclear" is an
acceptable answer when the evidence doesn't support more).

## Opportunity Analyst — the synthesis stage

`src/services/opportunity-analyst.service.ts` (M3 brief Part 15,
20-22, 24). Zero tool calls (everything it needs was already gathered
upstream); one bounded synthesis model call producing:

- `title`, `description` — the merged opportunity framing.
- `distributionChannels: {channel, reasoning}[]` — Part 19: never
  asserted without the reasoning that grounds it.
- `scoreDimensions` — the full 14-dimension `OpportunityScoreDimensions` (below).
- `killRiskDimensions` — the full 11-dimension `KillRiskDimensions` (below).
- `dimensionGrounding: {dimension, status: EVIDENCED|ASSUMED, reasoning}[]`
  — feeds the evidence-gap engine (below).

### Evidence promotion — idempotent, traceable

Before calling the model, `promoteSignalsToEvidence()` turns each
`CLUSTERED` signal in the problem's cluster into a real `Evidence` row
via the unmodified `evidenceService.collectEvidence()` — **idempotently**:
`evidenceRepository.findBySignalId()` is checked first, so a signal
already promoted (e.g. from an earlier Opportunity generated off the
same Problem) is reused via the existing many-to-many
`OpportunityEvidence` join, never duplicated. `Evidence.signalId` is a
real foreign-key column (not buried in `metadata`) — this is exactly
what makes the idempotency check possible; see `docs/DECISIONS.md`
for the specific bug this caught during development.

### The honesty gate (M3 brief Part 43)

The caller — `researchCycleService` (`RESEARCH_SCHEDULING.md`) — only
invokes the Opportunity Analyst for a Problem whose `status ===
"CANDIDATE"`. A Problem the Problem Analyst already marked
`INSUFFICIENT_EVIDENCE` never reaches this stage at all — no
Opportunity is manufactured from thin evidence. This is enforced in
code (`research-cycle.service.ts`'s `if (problem.status !== "CANDIDATE") continue;`),
not just documented, and covered directly by
`tests/integration/problem-analyst.test.ts`'s
"marks a thin, single-signal cluster INSUFFICIENT_EVIDENCE" test.

### Traceability

`Opportunity.problemId` is a direct foreign key — "why did
VentureForge discover this?" is a joinless-free walk:
`Opportunity.problemId → Problem.clusterId → Signal.clusterId →
Signal.sourceReference`, plus `Evidence.signalId` for the specific
claims actually attached. The Problem itself transitions to
`PROMOTED` the first time an Opportunity is generated from it (guarded
— re-running the analyst on an already-`PROMOTED` Problem, which
legitimately happens when a Problem spawns a second Opportunity
framing, skips the transition rather than erroring; `PROMOTED` has no
self-transition in `problem.types.ts`).

## Opportunity scoring — extended

`OpportunityScoreDimensions` (`src/services/opportunity-scorer.ts`)
grows from M1's ten to fourteen: `marketSize`, `frequency`,
`evidenceIndependence`, `timing` are new. **Deliberately not added**:
`competition` as its own attractiveness dimension — Part 17's reframe
means competition isn't monotonically bad-for-score, so it doesn't
belong in a "higher is better" vector; it's kill-risk's concern
(below) instead.

`DeterministicOpportunityScorer`'s attractiveness mean now covers
eleven dimensions (the original eight plus `marketSize`, `frequency`,
`timing`); **confidence is now the average of `evidenceQuality` and
`evidenceIndependence`** (previously `evidenceQuality` alone) — both
describe how much the assessment can be trusted, not how attractive
the opportunity is, matching Constitution §12's score/confidence
split extended a third way (`docs/DECISIONS.md`).

## Kill-risk scoring — the mandatory third axis

`src/services/kill-risk-scorer.ts` (M3 brief Part 21-22). `KillRiskDimensions`
— eleven factors, **opposite polarity from score dimensions**: higher
means *more* risk, deliberately, so a reader is never left guessing
which direction is bad. `DeterministicKillRiskScorer` is a documented
weighted average (weights sum to exactly 1.0) producing `killRiskScore`
(0..1) plus `killRiskReasons: string[]` — every dimension crossing a
0.6 "high risk" threshold becomes one explicit, named reason
(*"crowded market with many established competitors (0.72)"*), never a
bare number with no explanation.

**Score, confidence, and kill risk are three independently-read,
never-conflated numbers** (Constitution §12; M3 brief Part 22):

```
Opportunity Score: 0.34     "how attractive does this look"
Confidence:        0.62     "how much do we trust that assessment"
Kill Risk:          0.44    "what could kill this, and how much"
```

A high score with low confidence, or a decent score with high kill
risk, are both meaningful, different signals a human should see
separately — never collapsed into one number.

**Storage**: kill-risk fields extend the existing
`OpportunityScoreRecord` (nullable columns) rather than a new table —
produced by the same synthesis step, needing the same point-in-time
history as the attractiveness score (`docs/DECISIONS.md`).

## Evidence-gap engine + next-best-research-question

`src/services/evidence-gap.service.ts` (M3 brief Part 31). Turns the
Opportunity Analyst's `dimensionGrounding` into persisted `EvidenceGap`
rows — one per dimension tagged `ASSUMED` (an `EVIDENCED` dimension has
no gap to report). Each gap gets a natural-language
`suggestedResearchQuestion` (a small per-dimension template,
`RESEARCH_QUESTION_TEMPLATES`, falling back to a generic template for
an unrecognized dimension name) and a deterministic `impactScore`:

```
impactScore = uniformWeight(1/14) × (0.5 + |assumedValue − 0.5|)
```

— a dimension assumed at an *extreme* value (near 0 or 1) ranks higher
than one assumed near a neutral midpoint, since a wrong extreme
assumption is more likely to flip the eventual decision. The
highest-`impactScore` unresolved gap becomes the Opportunity's
denormalized `nextBestResearchQuestion` (recomputed on every analysis
pass) — this is the concrete answer to Part 31's example: *"Largest
uncertainty: willingness to pay → Recommended next research: find
evidence of businesses currently paying for this workflow."*

`EvidenceGap.status`: `UNKNOWN → ASSUMPTION → KNOWN → RESOLVED` — every
gap created by this engine starts at `ASSUMPTION` (a value was
supplied, just not evidenced); `RESOLVED` is terminal for that specific
gap row (a later re-analysis creates a fresh gap rather than reopening
an old one, keeping history honest about exactly when something was
resolved).

## Chairman — extended review inputs

`chairman.service.ts` (M2, extended in M3 — full detail in `CHAIRMAN.md`,
unchanged from M2 except its inputs and challenge list): when an
opportunity has a `problemId`, the review prompt now also includes the
linked Problem's detail, competitor observations, distribution
channels, kill-risk score and reasons, and unresolved evidence gaps —
and the system prompt explicitly adds evidence-independence, WTP,
market, competitive, and distribution assumptions to the five
adversarial questions M2 already required. The dev-mode fixture is
extended the same way: it can now recommend `REJECT` outright when
kill risk is high, not just `REQUEST_MORE_EVIDENCE` when evidence is
thin — still a genuine function of real input, never a static
response.
