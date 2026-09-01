# M3 Architecture Proposal — Opportunity Intelligence Engine

Phase 0 deliverable, written before any M3 implementation, per the M3
brief's own gating rule ("do not begin large implementation until this
proposal exists"). This is the plan; `DECISIONS.md` and the M3 final
report record what actually shipped and why anything here changed
during implementation.

## 1. M2 architecture audit

M2 (`d02a757`) added authenticated identity, a bounded Agent Runtime,
a provider-agnostic `ModelProvider`, a `Tool` system with one real
tool (`hn_search`), a Research Agent, formal validation-level policy,
and a Chairman that performs genuine adversarial review. 128/128 tests
pass; the full chain is proven end-to-end
(`tests/integration/m2-end-to-end.test.ts`).

Two structural facts drive every M3 decision below:

1. **`research-agent.service.ts` conflates signal collection with
   opportunity creation.** Its `PROCESS_RESULT` stage takes raw model
   synthesis and directly calls `opportunityService.createOpportunity`
   + `evidenceService.collectEvidence` + `opportunityService.scoreOpportunity`
   in one pass, with no deduplication, no clustering, no independent-source
   counting, and no notion of a "problem" distinct from an
   "opportunity." This is exactly what M3 brief Part 3 forbids
   ("Signal, Evidence, Problem, Opportunity, Decision... a single
   signal should not automatically become an opportunity") — not a
   bug in M2 (M2 never claimed to solve this; it explicitly scoped
   opportunity generation to "one real tool, one pipeline"), but the
   specific gap M3 exists to close. `research-agent.service.ts` is
   therefore **modified**, not left alone: its `PROCESS_RESULT` stage
   is redirected to produce `Signal` rows instead of Evidence/Opportunity
   directly (§9 below). Everything upstream of that stage (PLAN → TOOL
   → SYNTHESIZE, `agentRuntimeService`, budgets, Guardian-in-`callTool`)
   is reused unchanged.
2. **M2 has exactly one tool and one source.** `Tool` (`src/tools/tool.ts`)
   is already source-agnostic in shape (`id, requiredPermissions,
   riskLevel, inputSchema, outputSchema, execute`), but nothing in M2
   separates "how do I search Hacker News" from "how do I run a
   permission-gated, budgeted, audited call" — `HackerNewsSearchTool`
   does both in one class. M3 needs several sources without
   duplicating the Guardian/budget/audit wiring per source, so that
   split becomes real (§3).

Everything else is reused as-is: `authorizationService.authorize()`
(unchanged — no new permission is needed, `READ_WEB`/`GREEN` already
covers "search a public source"), `agentRuntimeService` (the bounded
execution engine — extended usage, unchanged implementation),
`evidenceService`, `opportunityService`'s CRUD/status/validation-level
methods, `chairmanService` (extended inputs, §14), `approvalService`,
`decisionQueueService` (extended `enrich`, §17), `auditService`,
`eventBus`, `identityService`/`authenticate.ts`, and the entire
domain/repository/service/API layering pattern.

## 2. Signal architecture

`Signal` (new) is the first-class, low-commitment record of "something
a source returned" — cheap, unverified, pre-evidence. Fields follow
the M3 brief's minimum list (Part 4) exactly: `id, source, sourceType,
sourceReference, title, content, publishedAt, collectedAt,
authorContext, language, contentHash, metadata, reliability, status`,
plus three additions the brief's field list doesn't name but the
brief's own later sections (dedup, clustering, independence) require
to actually be implementable:

- `clusterId?` — set once a `SignalClusteringService` run assigns the
  signal to a `SignalCluster` (§6). Nullable: a brand-new signal is
  `NEW`/unclustered until the next clustering pass.
- `duplicateOfSignalId?` + `duplicateReason?` — set when `status =
  DUPLICATE`; every dedup decision must be explainable (Part 9), so
  the *reason* is stored, not just the fact.
- `sourceGroupKey?` — a source-adapter-computed key identifying "these
  signals are the same thread/post/author context" (e.g. the HN story
  id all comments on that story share). This is what makes source
  independence (§8, Part 13) a real, queryable property instead of a
  narrative claim: "5 posts from the same thread" is `COUNT(DISTINCT
  sourceGroupKey) = 1`, not `COUNT(*) = 5`.

Status: `NEW → PROCESSED | DUPLICATE | REJECTED`, `PROCESSED → CLUSTERED`,
any non-terminal state `→ ARCHIVED` (§16 has the full transition
table). `REJECTED` covers content that fails a basic sanity/safety
filter (empty after normalization, non-target language when a
language filter is configured, etc.) — never a judgment about whether
the *opportunity* is good, only whether the *signal* is usable at all.

## 3. Source adapter architecture

```ts
interface ResearchSource {
  readonly id: string;
  readonly name: string;
  readonly reliability: EvidenceReliability;   // baseline, see §12
  readonly rateLimit: { requestsPerMinute: number };
  search(query: string, options: { maxResults: number }): Promise<RawSourceResult[]>;
}
```

(`src/sources/research-source.ts`). This is deliberately **narrower**
than `Tool` — a `ResearchSource` only knows how to search one external
system and return raw, source-shaped results; it has no concept of
permissions, risk, budgets, or audit. Those stay exactly where M2 put
them: a single generic `SourceSearchTool implements Tool`
(`src/tools/source-search.tool.ts`), constructed with one
`ResearchSource`, supplies `id = source.id`, `riskLevel: "GREEN"`,
`requiredPermissions: ["READ_WEB"]` (unchanged from M2 — no new
permission needed, §18), and an `execute()` that rate-limits (§19)
then delegates to `source.search()`. Registering a new source is
`toolRegistry.register(new SourceSearchTool(new WhateverSource()))` —
one line, and it automatically inherits Guardian authorization, budget
accounting, retry semantics, and `ToolExecution` audit rows from the
unchanged `agentRuntimeService` (`AGENT_RUNTIME.md`). This is the
concrete fix for M2 audit finding #2 above, and it's why "the rest of
VentureForge must not depend directly on Hacker News/Reddit/etc." (M3
brief Part 5) is achievable without touching the runtime at all.

**Sources implemented:**

- **`HackerNewsSource`** — M2's `HackerNewsSearchTool` logic, moved
  behind `ResearchSource` (real, unit-tested against realistic mocked
  responses; live connectivity from this sandbox unverified — see
  `TOOL_SYSTEM.md`, unchanged reasoning).
- **`StackExchangeSource`** (new) — Stack Exchange's `/2.3/search/advanced`
  API: public, keyless for the volume this system needs, explicitly
  built for programmatic search, well-documented rate limits. Same
  profile as Hacker News Algolia: no auth/paywall/CAPTCHA/robots.txt
  to bypass. Implemented for real, unit-tested against realistic
  mocked responses; live connectivity from this sandbox is expected to
  be unverifiable for the same proxy-allowlist reason `hn.algolia.com`
  was (§21 confirms whichever hosts are actually reachable and updates
  this line honestly rather than assuming).
- **`DevelopmentSource`** (new, generic) — one fixture class
  parameterized by which real source it stands in for, returning
  deterministic, clearly `[DEV FIXTURE]`-labeled results derived from
  the query text (never a static canned response) — the same honesty
  bar as M2's `DevelopmentSearchTool`, generalized so each registered
  real source gets a matching fixture without per-source fixture
  boilerplate.

**Not implemented, and why:**

- **Reddit** — the brief lists it as a "potential" source (Part 6) and
  explicitly requires "official APIs or legitimately accessible public
  interfaces" and no rate-limit evasion (Part 7). Reddit's official API
  now requires an OAuth-registered application credential; this
  environment has none. The legacy unauthenticated `.json` endpoints
  are not a legitimate substitute for programmatic/automated use at
  any real volume under Reddit's current API terms. Building against
  them would mean either shipping a source that's unsafe to actually
  run, or shipping dead code — neither is honest. `ResearchSource`'s
  interface already fits Reddit; adding it later is a founder decision
  (register an app, supply `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`)
  plus one new adapter file, not an architecture change. Flagged as a
  founder decision, not silently skipped.
- **Product review sites / generic forums** — Part 6 calls these
  "potential," not required, and Part 45/6 both warn against adding
  sources merely to raise the count. Two real, legitimate, keyless
  sources plus a clean extension point satisfy "multiple useful public
  research sources" (Part 6) without padding.

## 4. Signal normalization

Every `ResearchSource.search()` returns source-shaped `RawSourceResult`
objects; `signalService.ingest()` is the one place that turns those
into `Signal` rows, so nothing downstream of ingestion ever
special-cases a source. Mapping is deliberately thin — title, content,
a canonicalized `publishedAt`, `sourceReference` (the canonical URL),
`authorContext` (source-specific, e.g. HN username or SE display
name, stored as opaque text — never resolved to a real-world
identity), `language` (best-effort, defaulted `"en"` when a source
doesn't report one), and `metadata` for anything source-specific worth
keeping (score/points, tags, answer count) that doesn't deserve its
own column. `contentHash` is computed here (`sha256(title + "\n" +
content)`), which is what §5's exact-duplicate check keys on.

## 5. Signal deduplication

Three levels, each cheap enough to run synchronously during ingestion
(no model call — Part 45's "avoid N×M×K explosions" applies directly
to dedup, which runs once per *signal*, not once per *pair*):

1. **Exact duplicate** — `contentHash` collision → the new signal is
   written with `status: "DUPLICATE"`, `duplicateOfSignalId` pointing
   at the existing row, `duplicateReason: "identical content hash"`.
   O(1) via a unique-enough index lookup, not a full-table scan.
2. **Source repost detection** — same `sourceReference` URL seen again
   (a source returning the same story twice across two queries in one
   cycle) → `DUPLICATE`, `duplicateReason: "same source reference
   already ingested this cycle"`.
3. **Near-duplicate (content similarity)** — a cheap, deterministic
   shingled Jaccard/token-overlap similarity against recently-ingested
   signals in the same source (not a model call, not a vector
   database — Part 33 defers "complex vector memory" to M4+, and a
   similarity heuristic doesn't need one to be useful here). Above a
   documented threshold → `DUPLICATE` with the specific similarity
   score in `duplicateReason`. Below it → not a duplicate, proceeds to
   clustering, where genuinely-related-but-distinct signals are
   grouped *without* being discarded (§6) — near-duplicate detection
   only catches near-*identical* restatements, not "signals about the
   same problem," which is clustering's job, not dedup's.

A `DUPLICATE` signal is never counted in a cluster's `signalCount` or
`independentSourceCount`, and never becomes Evidence — this is the
direct implementation of Part 9's "do not let duplicated content
artificially inflate opportunity scores."

## 6. Signal clustering

`signalClusteringService.assign(signal)`: for each `PROCESSED`,
non-duplicate signal, compare against existing `SignalCluster`
centroids/representative-signal text (same token-overlap similarity
primitive as near-dup detection, different threshold — a looser bar,
since a cluster groups *related* problems, not near-identical text) —
above threshold, join that cluster (`Signal.clusterId` set,
`Signal.status → "CLUSTERED"`, cluster's `signalCount`/
`independentSourceCount`/`updatedAt` recomputed); below every existing
cluster's threshold, create a new `SignalCluster` with this signal as
its sole, founding member. `independentSourceCount` is
`COUNT(DISTINCT sourceGroupKey)` across the cluster's non-duplicate
signals (§2) — never conflated with raw `signalCount` (Part 13's
explicit "100 posts ≠ 100 independent customers"). `confidence` is a
simple, documented function of `independentSourceCount` and average
signal quality score (§10) — more independent corroboration and
higher-quality signals raise cluster confidence; a cluster of five
posts from one thread stays low-confidence regardless of count.

**Not implemented:** cross-cluster merging (discovering after the fact
that two existing clusters are actually the same theme). One-shot
assignment is sufficient for M3's bounded cycles and avoids a
non-trivial "when do two clusters get merged, and what happens to
Problems already extracted from either" question that a full
implementation would need to answer carefully. Flagged for M4.

## 7. Problem extraction

`Problem` (new): the M3 brief's literal field list (Part 11) —
`statement, customerSegment, workflow, pain, frequency,
currentSolution, dissatisfaction, urgency, willingnessToPaySignal,
evidenceCount, confidence` — plus `clusterId` (FK, traceability) and
`status` (`CANDIDATE | PROMOTED | INSUFFICIENT_EVIDENCE | REJECTED |
ARCHIVED`).

`problemAnalystAgent` (new, `src/agents/problem-analyst.ts`): given a
`SignalCluster` above a minimum size/confidence threshold, one bounded
model call (+ one corrective schema retry, same `completeWithValidation`
helper Chairman and the Research Agent already use — no new pattern)
produces the structured `Problem`. The system prompt states the exact
distinction Part 11 demands — "*I don't like this product*" is not a
Problem; "*a recurring, expensive workflow problem affecting many
customers*" is — as a worked contrast, not just an instruction to
"be careful." `evidenceCount` in the model's output is **not trusted
directly**: the service clamps it to the cluster's actual
non-duplicate `signalCount` (a model cannot claim more supporting
signals than genuinely exist — same "never trust raw model output
beyond what's checkable" discipline as everything else in this
codebase). If the cluster's `independentSourceCount < 2` or the
extracted `confidence` is below a documented floor, the Problem is
created with `status: "INSUFFICIENT_EVIDENCE"` and the pipeline does
**not** proceed to Opportunity generation for it (§9's honesty
requirement, Part 43) — this is a real branch with its own test, not
a documentation claim.

## 8. Evidence architecture

`Evidence` (M1/M2, unchanged shape) gains one nullable column:
`signalId` — set when a piece of evidence is formalized *from* a
specific signal. Evidence is created once a `Problem` is being
promoted toward an `Opportunity` candidate (§9): each contributing,
non-duplicate signal in the problem's cluster becomes one `Evidence`
row via the existing, unmodified `evidenceService.collectEvidence()`
— `reliability` seeded from the source's baseline (§12), `confidence`
seeded from the signal's own quality score (§10), `sourceReference`
carried through unchanged, `metadata` carrying the signal's
`authorContext`/`sourceGroupKey` for downstream independence-aware
reasoning (Chairman, §14). This is the concrete reading of Part 1's
pipeline placing "MULTI-SOURCE EVIDENCE" after "PROBLEM CANDIDATE": a
signal is *raw material*; it becomes *evidence* at the moment it's
actually being used to back a specific claim about a specific problem
— matching Part 3's ordering intent (signals are not automatically
evidence) even though Part 3's simplified diagram and Part 1's
detailed pipeline order Evidence and Problem differently; Part 1's
literal, detailed sequence is treated as authoritative here since
Part 3 is explicitly a "these are different concepts" illustration,
not a second, conflicting literal ordering.

## 9. Opportunity generation

`opportunityGeneratorService` (new) replaces the part of M2's
`research-agent.service.ts` that used to call `createOpportunity`
directly. Inputs: a `PROMOTED`-eligible `Problem`, its cluster's
signals-turned-Evidence, the Competitor Analyst's output (§14), the
Market Analyst's WTP/timing read (§14). `opportunityAnalystAgent`
(new) performs one bounded synthesis model call (no new tool calls —
everything it needs was already gathered by the upstream agents) that
produces: the merged title/description, `distributionChannels` (JSON
array of `{channel, reasoning}`, Part 19 — never asserted without the
reasoning that grounds it in what was actually found), the 14-dimension
score input (§10), the kill-risk dimension input (§11), and a
per-dimension `EVIDENCED | ASSUMED` tag (§13's evidence-gap engine).

`Opportunity` gains one nullable FK: `problemId`. Traceability (Part
15 — "why did VentureForge discover this opportunity?") is then a
direct, joinless-free walk: `Opportunity.problemId → Problem.clusterId
→ Signal.clusterId → Signal.sourceReference`, plus
`Evidence.signalId` for the specific claims actually attached. No
`opportunity_problems` or `problem_signals` join table was created —
see §16 for why.

**The honesty requirement (Part 43) is enforced structurally, not
just documented:** if a `Problem` is `INSUFFICIENT_EVIDENCE` (§7), or
if the Opportunity Analyst's own output can't ground
`distributionChannels`/WTP signals in anything the Competitor/Market
Analysts actually returned, `opportunityGeneratorService` does not
call `createOpportunity` at all — it records the attempt (audit +
event) and leaves the `Problem` at its current status. "We found
nothing worth pursuing" is a normal, successful return value of this
service, not an error path.

## 10. Opportunity scoring

`OpportunityScoreDimensions` (`opportunity-scorer.ts`) is extended
with the M3 brief's additional named dimensions not already present in
M1's ten: `marketSize`, `frequency`, `evidenceIndependence`, `timing`
(M1 already has `pain, demand, willingnessToPay, reachability,
retention, differentiation, buildability, economics, risk,
evidenceQuality` — 4 of Part 20's suggested list were genuinely new;
`competition` is deliberately **not** added as its own attractiveness
dimension — see §11, it is kill-risk's concern, not attractiveness's,
per Part 17's explicit reframe: "no competitors ≠ good idea,"
i.e. competition is not monotonically bad-for-score, so it doesn't
belong in a "higher is better" attractiveness vector at all).
`DeterministicOpportunityScorer` is extended (documented weights, not
a silent behavior change) to fold in the four additions; the
`risk`-discount mechanic is unchanged. This is a `Partial`-safe,
additive extension of an existing interface implementation — every M2
caller passing the original ten fields still fails validation exactly
as before (`assertUnitInterval` now requires the extra four too),
which is a deliberate, tested, and documented breaking change to
`ScoreOpportunityDimensions` callers, not a silent one — the M3 report
lists it under decisions requiring founder approval as a re-affirmation
of the existing "every dimension is a founder-revisable policy
choice" precedent (`DECISIONS.md` #4, #20).

## 11. Kill-risk scoring

New `killRiskScorer` (`src/services/kill-risk-scorer.ts`), same
interface shape as `OpportunityScorer` for consistency:
`KillRiskDimensions` — `weakDemand, weakWillingnessToPay,
crowdedMarket, poorDifferentiation, badDistribution,
technicalDifficulty, regulatoryRisk, platformDependency, lowRetention,
lowMargins, insufficientEvidence` (Part 21's named factors, each 0..1,
**higher = more risk**, the opposite polarity from attractiveness
dimensions — deliberately, so a reader is never left to guess which
direction is "good"). `DeterministicKillRiskScorer.score()` is a
documented weighted average producing `killRiskScore` (0..1) plus
`killRiskReasons: string[]` — every dimension crossing a documented
"high" threshold (0.6) becomes one explicit, named reason string
("crowded market: 3+ established competitors found with no
differentiation identified"), never a bare number with no explanation
(Part 21's explicit "the system should be able to explain why").

**Storage decision:** kill-risk fields are added to the *existing*
`OpportunityScoreRecord` (`killRiskScore, killRiskDimensions
(json), killRiskReasons (json)`) rather than a new table. It is
produced by the same synthesis step that produces the attractiveness
score, needs the same point-in-time history (a re-score's kill-risk
history matters exactly as much as its attractiveness-score history,
same "why do we believe this" principle, `DECISIONS.md` #6), and
splitting them into two separately-timestamped tables would let them
drift out of sync for no benefit. Score, confidence, and kill risk
remain three independently-read, never-conflated numbers at the API
level (Part 22) even though two of the three share a table.

## 12. Source reliability

`SOURCE_RELIABILITY` (`src/domain/evidence/source-reliability-policy.ts`),
same pattern as `PERMISSION_RISK_LEVEL` (a small, explicit,
founder-revisable `Record<sourceId, EvidenceReliability>`): baseline
reliability per registered source (e.g. Hacker News: `MEDIUM` — public
but pseudonymous and unverified; Stack Exchange: `MEDIUM` — similarly
public/pseudonymous, but a "question with an accepted answer" pattern
gives slightly more structure than a discussion thread, still not
elevated to `HIGH` since M3 does no identity verification of authors).
This is the seed value `Evidence.reliability` takes when a signal from
that source becomes evidence (§8) — a downstream agent may still
record a *different*, more specific reliability if it has grounds to
(e.g. a Competitor Analyst citing a vendor's own pricing page directly
might reasonably record `HIGH` for that one specific claim), but
nothing defaults to `HIGH` merely because a source exists — matching
the fail-closed-on-unknown-value discipline used everywhere else
(`SECURITY.md`).

## 13. Research scheduling

Covered together with orchestration in §16 (Research Cycle) and the
Research Queue (below) — scheduling in M3 is "what runs next inside a
bounded cycle," not a cron/calendar system. `researchQueueService`
(new) populates `ResearchQueueItem` rows after each cycle: one item
per unresolved `EvidenceGap` (§14) on a `Problem`/`Opportunity` still
short of a human decision, `priorityScore = w1 · informationGain +
w2 · opportunityScore − w3 · killRiskScore − w4 · estimatedResearchCost`
(documented weights, `src/services/research-queue.service.ts`) —
resolving the single largest uncertainty on a promising, low-kill-risk
opportunity outranks blindly re-researching whatever currently scores
highest, directly implementing Part 30's "the best next research task
isn't always the highest-scoring opportunity." `researchQueueService.next()`
pops the highest-priority `PENDING` item for the next cycle to act on
first, subject to that cycle's own budget (§20).

## 14. Agent responsibilities

Six agent roles total — small, each with a genuinely distinct
reasoning task (Part 25's own anti-proliferation rule), none
duplicating another:

| Agent | Purpose | Input | Output | Tools | Risk | Budget | Terminates when |
|---|---|---|---|---|---|---|---|
| **Research Agent** (M2, modified §1) | Collect raw signals for an objective | objective string | `Signal[]` (via ingest) | N registered `SourceSearchTool`s | GREEN | `DEFAULT_EXECUTION_BUDGET` (unchanged) | plan executed, all planned queries run, or budget hit |
| **Problem Analyst** (new) | Extract a structured Problem from a cluster | `SignalCluster` + its signals | `Problem` | none (reasoning-only) | GREEN | 1 model call + 1 corrective retry | output validates or 2nd attempt fails |
| **Competitor Analyst** (new) | Find and structure real competitor mentions | `Problem` | `Competitor`/`CompetitorObservation[]` | 1 bounded search call (reused `SourceSearchTool`) + 1 model call | GREEN | 1 tool call + 1 model call (+1 retry) | search + extraction done or budget hit |
| **Market Analyst** (new) | WTP signals + market timing read | `Problem` + its evidence | WTP signal list + timing note | none (reasoning-only) | GREEN | 1 model call + 1 corrective retry | output validates or 2nd attempt fails |
| **Opportunity Analyst** (new) | Synthesize everything into a scored, kill-risk-assessed Opportunity candidate | Problem + Evidence + Competitor + Market output | `Opportunity` + scores + evidence-gap tags | none (synthesis-only) | GREEN | 1 model call + 1 corrective retry | output validates, or `INSUFFICIENT_EVIDENCE` (§9) |
| **Chairman** (M2, extended §17) | Adversarial review | richer Opportunity | `ChairmanReview` | none | GREEN | 1 model call + 1 corrective retry | unchanged from M2 |

**Not built as a separate agent: Evidence Validator.** The brief
allows this only "if justified" (Part 24). It isn't, yet: the two
concrete responsibilities a validator would plausibly own —
independent-source counting and reliability seeding — are already
deterministic, code-based, and covered (§6, §12); genuinely
re-verifying a claim against a live primary source (visiting the cited
URL again, checking it still supports the claim) is a real, distinct
capability but would duplicate the Competitor/Market Analysts' own
search-and-read pattern without a clearly separate reasoning task
today. Flagged for M4 once there's a concrete task for it that isn't
already covered.

**CEO boundary (Part 26):** implemented as `researchCycleService`
(§16), **not** a reasoning agent with its own model calls in M3. It
orchestrates the fixed sequence above in code, enforces the cycle
budget, and consults the Research Queue for prioritization — it never
calls a model to decide "what should we work on," matching the brief's
explicit "do not build the entire autonomous CEO in M3; build the
orchestration foundation." It holds no elevated privilege: every step
it triggers goes through the same authenticated, Guardian-checked,
audited service calls any other caller would use.

## 15. Tool responsibilities

Unchanged from M2 (`TOOL_SYSTEM.md`) except in count: every source is
one `SourceSearchTool` instance (§3), each independently
Guardian-gated on `READ_WEB`/GREEN, budget-accounted, and
`ToolExecution`-audited by the unmodified `agentRuntimeService`. No
write-capable tool is introduced in M3 (research remains read-only
throughout).

## 16. Data model changes

**New tables**, each justified individually (Part 35 warns against
creating every suggested one automatically):

- **`signals`** — required, §2.
- **`signal_clusters`** — required, §6.
- **`problems`** — required, §7.
- **`competitors`** / **`competitor_observations`** — required, §14;
  split so the same competitor (e.g. "Notion") is one canonical row
  reusable across opportunities, while opportunity-specific
  observations (pricing seen, a complaint found, a positioning note)
  stay separately timestamped and evidence-linked.
- **`evidence_gaps`** — required, §14 below (evidence-gap engine).
- **`research_cycles`** — required, §16 (orchestration + operating
  window state together, see below).
- **`research_queue_items`** — required, §13.

**New columns** on existing tables: `Evidence.signalId` (§8),
`Opportunity.problemId`, `Opportunity.killRiskScore`/
`killRiskReasons`... — wait, kill-risk fields live on
`OpportunityScoreRecord`, not `Opportunity` itself, matching §11's
"history matters" reasoning; `Opportunity` instead gets
`nextBestResearchQuestion?` (denormalized for cheap reads, §14) and
`problemId?`. `OpportunityScoreRecord` gains `killRiskScore,
killRiskDimensions, killRiskReasons` (§11).

**Not created, and why:**

- **`problem_signals`** (join table) — a Problem's signal provenance
  is already fully recoverable via `Problem.clusterId →
  Signal.clusterId` (§9); a Problem draws from exactly the signals its
  founding cluster contains, so a many-to-many join would model a
  relationship that doesn't exist in this design (one cluster → the
  problem(s) extracted from it, never a problem assembled from
  signals spanning multiple clusters).
- **`opportunity_problems`** (join table) — same reasoning:
  `Opportunity.problemId` is a direct FK because, in this design, one
  Opportunity candidate is generated from one Problem. A Problem *can*
  spawn more than one Opportunity framing over time (the FK direction
  supports that — many Opportunities may share a `problemId`), which
  is the actual degree of freedom the brief's examples call for,
  without needing the reverse (an Opportunity spanning multiple
  Problems) that a join table would additionally allow but nothing
  requires.
- **A dedicated human-feedback/rejection table** (Part 32/33) — every
  field Part 32 lists (opportunity, decision, reason, evidence,
  scores, chairman reasoning, human reasoning) is already durably
  captured by existing, unmodified rows:
  `ApprovalRequest.decisionReason` + `status`, the full
  `OpportunityScoreRecord` history, the full `ChairmanReview` history,
  and the `AuditLog`/`Event` trail — nothing is ever deleted. What's
  genuinely missing is an explicit *event* marking the moment of
  decision so a future learning process doesn't have to reconstruct
  "was this a rejection" by joining four tables — so §17 adds
  `OPPORTUNITY_DECISION_RECORDED` and `OPPORTUNITY_REJECTED` to
  `DOMAIN_EVENT_TYPES` instead, satisfying Part 32/33's literal ask
  ("establish the data model/**event** foundation") without a
  redundant table. No ML retraining of any kind is implemented,
  per Part 33's own instruction.

`ResearchCycle` fields: `id, objective, status
(SCHEDULED|RUNNING|PAUSED|STOPPED|AWAITING_HUMAN|COMPLETED|FAILED|CANCELLED),
startedByIdentityId, budget fields (maxDurationMs, maxSignals,
maxToolCalls, maxModelCalls, maxCostUsd), usage counters
(signalsCollected, queriesRun, opportunitiesGenerated,
estimatedCostUsd), createdAt, startedAt, completedAt`. This single
table carries both "research cycle" and "operating window" (Part 29)
— they are the same bounded unit of work in this design (one cycle
*is* one operating window), so a separate `OperatingWindow` entity
would duplicate the same lifecycle for no added information.
`AWAITING_HUMAN` has exactly one real producer in M3 (not a decorative
unused state): a cycle that can't even start because its assigned
Research Agent currently lacks an active `READ_WEB` grant lands here
instead of failing outright, so a human sees "why is nothing
running" in the same queue-shaped place as every other decision,
rather than in a buried error log. Mid-cycle pause/resume for a
non-blocking reason is not implemented (M2 precedent: no
mid-execution suspension exists yet either, `AGENT_RUNTIME.md`); a
cycle that exhausts its own budget mid-run goes to `STOPPED` with
partial results intact (Part 38), not `AWAITING_HUMAN`, since nothing
in M3 resumes a stopped cycle — the next scheduled cycle simply starts
fresh and the Research Queue (§13) carries forward what's still
unresolved.

Every new enum-like/bounded column gets the same SQLite `CHECK`
constraint treatment as M1/M2 (`SECURITY.md`).

## 17. API changes

New authenticated routers: `GET /api/signals` (+ `/:id`),
`GET /api/signal-clusters` (+ `/:id`), `GET /api/problems` (+ `/:id`),
`GET /api/competitors`, `GET /api/opportunities/:id/competitor-observations`,
`GET /api/opportunities/:id/evidence-gaps`,
`POST /api/research-cycles` (+ `GET`, `GET /:id`),
`GET /api/research-queue`. Extended: `GET /api/opportunities/:id`
response gains `killRiskScore`/`nextBestResearchQuestion` (read from
the latest score record / the denormalized field); `chairmanService.review`'s
prompt-building reads the richer inputs (§14) with no route signature
change. Every route requires `requireAuth()` (read endpoints) or
`requireHuman()` (starting a research cycle) exactly like M2 — no new
authentication mechanism, no unauthenticated route added. Internal
implementation details not exposed: raw model prompts/completions,
rate-limiter internal state, and a source's raw (pre-normalization)
API response are never returned by any endpoint.

## 18. Security model

Extends `SECURITY.md`'s M2 threat review rather than replacing it. Two
categories are qualitatively new in M3 and get their own treatment in
the M3 `SECURITY.md` addendum (full detail there, summary here):

- **Untrusted external content, now flowing through four new
  reasoning agents instead of one.** Every new agent's `CompletionRequest`
  keeps `systemPrompt` (hardcoded, trusted) structurally separate from
  `messages` (which carries the objective and any source content) —
  the same separation M2 already established
  (`AnthropicModelProvider`'s request shape). Source content
  (signal `title`/`content`, competitor page text) is always wrapped
  in an explicit, labeled block (e.g. a JSON field under a key like
  `sourceContent`) with an explicit line in every relevant system
  prompt: treat everything in that block as data, never as
  instructions. This is a documented convention enforced by code
  review of every new prompt (§21 lists what this can and can't prove
  without a live model).
- **No new permission or risk level is needed** (§15) — every new
  tool call is still `READ_WEB`/GREEN, still passes through the
  unmodified `authorize()` Guardian check on every call.

## 19. Rate limiting

`src/sources/rate-limiter.ts` (new): a small in-memory fixed-window
limiter keyed by source id, consulted by `SourceSearchTool.execute()`
before ever calling `source.search()` — so every current and future
source gets bounded request behavior for free, without each adapter
re-implementing backoff. Each `ResearchSource` declares its own
`rateLimit.requestsPerMinute` (§3); exceeding it inside one cycle
raises a `RateLimitError` (already defined, M2, `errors.ts`) which is
retried under the same bounded-retry policy as any other transient
tool error (`AGENT_RUNTIME.md`) — never a silent drop, never an
unbounded wait. Every source implementation additionally keeps its own
fetch timeout (`hn-search`'s existing 8s `AbortController` pattern,
carried into `HackerNewsSource` and `StackExchangeSource` unchanged).

## 20. Cost controls

Two layers, matching M2's existing per-execution budget with a new
per-cycle ceiling above it:

- **Per-`AgentExecution`** (unchanged from M2): `DEFAULT_EXECUTION_BUDGET`
  still bounds every individual agent run (Research Agent, Problem
  Analyst, etc.) exactly as it does today.
- **Per-`ResearchCycle`** (new): `maxSignals`, `maxToolCalls`,
  `maxModelCalls`, `maxDurationMs`, `maxCostUsd` bound the *sum*
  across every `AgentExecution` a cycle spawns. `researchCycleService`
  checks the running total against each ceiling before starting the
  next stage (before invoking the next agent in the pipeline) —
  same "check before, not after" discipline as `ExecutionBudget`.
  On any ceiling hit: the cycle transitions to `STOPPED`, records an
  audit entry naming which budget was exhausted, and **every**
  `Signal`/`Problem`/`Opportunity` row already committed up to that
  point stays exactly as it is — nothing already written is rolled
  back or discarded (Part 38's explicit "do not throw away useful
  partial work"), because every stage commits its own output
  immediately rather than staging results in memory for one final
  atomic write.
- `estimatedCostUsd` accumulation carries the same honest gap M2 flagged
  (`AGENT_RUNTIME.md`, `SECURITY.md`): it sums whatever each
  `AgentExecution.estimatedCostUsd` reports, which is currently `null`
  in development mode (no real provider call, no real cost) and still
  unpopulated even in `anthropic` mode (M2 never wired up parsing the
  Anthropic response's `usage` block) — `maxCostUsd` is therefore
  enforced today in the same indirect way M2 already documented
  (bounded call counts × bounded `maxOutputTokens`, not a live dollar
  figure). Not silently fixed here — carried forward as the same
  flagged gap, now also blocking a real `maxCostUsd` from being
  enforceable in dollars rather than call-count until it's closed.

## 21. Failure/retry model

Unchanged bounded-retry primitives from M2 (`withBoundedRetry`,
`completeWithValidation`'s one corrective retry) reused by every new
agent — no new retry mechanism introduced. `researchCycleService`
adds exactly one new failure shape: a stage that produces *no usable
output* (e.g. Problem Analyst runs on a cluster but the model
repeatedly can't produce a groundable `Problem`) is not retried
indefinitely — it fails that one cluster (recorded, audited) and the
cycle moves on to the next queue item, rather than one bad cluster
stalling the whole cycle. Genuinely transient errors (tool/model,
`ToolError`/`ModelError`) are retried per the existing policy; a
budget-exceeded, authorization-denied, or validation error is never
retried, exactly as M2 established.

## 22. Observability

Extends the existing two-table pattern
(`AgentExecution`/`ToolExecution`, unchanged) with `ResearchCycle` as
the new top-level unit: `GET /api/research-cycles/:id` answers "what
happened in this cycle" by aggregating its own counters plus every
`AgentExecution` it spawned (linked via a `researchCycleId` column
added to `AgentExecution`). No new logging subsystem — same
append-only-row pattern throughout. `duplicateReason`/`killRiskReasons`/
`EvidenceGap.description` all exist specifically so "why did the
system do X" is answerable by reading a row, not by re-deriving it.

## 23. Testing strategy

Same split as M1/M2: `tests/unit/*` for pure logic (dedup similarity
functions, clustering assignment, kill-risk scoring, evidence-gap
ranking, priority-queue formula, new state transitions — all
deterministic, no DB, no model), `tests/integration/*` for each new
service against the real SQLite test database, and one new capstone
end-to-end test (`tests/integration/m3-end-to-end.test.ts`) mirroring
Part 41 exactly: multiple sources → signals → dedup → cluster →
problem → evidence → competitor analysis → opportunity → score →
kill-risk → evidence gap → Chairman → decision queue, over the real
HTTP API, asserting every stage's audit/event trail same as M2's
capstone test. Every automated test runs in
`RESEARCH_TOOL_MODE=development`/`MODEL_PROVIDER_MODE=development` —
no live network or live model dependency anywhere in the suite,
continuing M1/M2's own precedent. One dedicated test proves the
`INSUFFICIENT_EVIDENCE` path is real (a thin cluster does **not**
produce an Opportunity). One dedicated test proves duplicate/repost
signals never inflate a cluster's `independentSourceCount`.

## 24. Alternatives considered

- **A generic `Signal`-typed `Tool<Signal[]>`** instead of splitting
  out `ResearchSource` — rejected: would still leave permission/risk/
  budget wiring duplicated per source the way M2's one-tool-does-everything
  design did (§1); the two-layer split costs one small interface and
  saves that duplication for every source added from here on,
  including ones a founder adds later without touching the runtime.
- **Storing kill-risk in its own table** (`opportunity_kill_risk_records`)
  — rejected in favor of extending `OpportunityScoreRecord` (§11): the
  two are produced together, needed together, and historized
  together; a second table would only add a join for no new
  capability.
- **Vector-embedding-based clustering/dedup** — rejected for M3:
  Part 33 explicitly defers "complex vector memory," and a
  deterministic token-overlap similarity is sufficient for the volume
  one bounded research cycle handles, cheaper, and fully explainable
  (a similarity *score* between two specific texts is directly
  inspectable; a nearest-neighbor result in embedding space is not,
  without additional tooling this milestone doesn't need yet).
- **A reasoning "CEO agent" making real prioritization judgment calls**
  — rejected for M3 per the brief's own instruction (Part 26); the
  deterministic priority formula (§13) is the "orchestration
  foundation" the brief asks for, not the full autonomous CEO.
- **Reddit via the unauthenticated legacy endpoint** — rejected; see
  §3.

## 25. Risks

- **Four new reasoning agents multiply the "dev-mode fixture must stay
  honest and provably non-trivial" burden** M2 first established for
  the Chairman. Mitigated by requiring every new dev fixture to be a
  genuine function of its real input (never static text) and by
  writing a "different inputs → different outputs" test for each,
  the same proof pattern `chairman.test.ts` already established.
- **Clustering/dedup thresholds are heuristic, not learned.** A
  threshold picked without real traffic risks under- or
  over-clustering. Mitigated by keeping the thresholds in one
  documented, isolated location (same "founder-revisable policy"
  pattern as the permission→risk and validation-level tables) rather
  than scattered through the clustering code, and by every dedup/
  cluster decision being explainable and auditable so a founder can
  actually inspect whether the threshold is behaving well.
- **Two real sources (HN, Stack Exchange) both plausibly sit outside
  this sandbox's outbound proxy allowlist**, same as M2's HN finding —
  meaning M3, like M2, ships real adapter code that is unit-tested but
  not live-exercised here. Mitigated by being explicit about this in
  every relevant doc (as M2 was) rather than implying otherwise, and
  by the demo script (§42, brief) working correctly in development
  mode regardless.
- **Scope**: this is the largest brief yet. Mitigated by a hard scope
  line (§26 below) and by reusing M1/M2 wherever this brief doesn't
  explicitly require a change (§1).

## 26. Deferred to M4+

Everything Part 48 names verbatim (autonomous cold outreach, mass
email, social DMs, sales agents contacting customers, payment
processing, autonomous spending, automatic SaaS deployment, automatic
company formation, fully autonomous business operation, large-scale
multi-agent swarms, complex distributed infrastructure, self-modifying
agents, automatic model training) — plus, specific to the choices
above: a real Evidence Validator agent; cross-cluster merging; a
reasoning CEO agent that makes real prioritization judgment calls;
mid-cycle pause/resume for a non-blocking reason; vector-embedding-based
similarity; a live, OAuth-backed Reddit adapter; amount-tiered or
dollar-denominated cost budgets (still blocked on the same unpopulated
`estimatedCostUsd` gap M2 flagged); any UI.
