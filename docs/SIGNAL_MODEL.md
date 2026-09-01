# Signal Model

M3. `Signal` → `SignalCluster` → `Problem` — the three entities
upstream of Evidence/Opportunity, and why they're kept separate
(M3 brief Part 3/4/11/12). Full field-by-field rationale in
`docs/M3_ARCHITECTURE_PROPOSAL.md` §2, §6, §7, §16.

## Signal

The raw, low-commitment record of "something a source returned" —
`src/db/repositories/signal.repository.ts`, `prisma/schema.prisma`'s
`Signal` model. Cheap and unverified, deliberately not Evidence: a
Signal only becomes Evidence once it's actually used to back a
specific Problem/Opportunity claim (`OPPORTUNITY_INTELLIGENCE.md` §8).

Status lifecycle (`src/domain/signal/signal.types.ts`):

```
NEW → PROCESSED → CLUSTERED
NEW → DUPLICATE | REJECTED
(any non-terminal) → ARCHIVED
```

In practice `signalService.ingest()` (below) resolves a signal's final
status in one synchronous pass — `NEW` is a schema-completeness value
rarely observed as a standalone row, not a state something waits in.

Every Signal is attributable to the agent whose tool call collected it
(`collectedByAgentId`, mirrors `Evidence.collectedByAgentId` exactly —
Constitution §25).

## Normalization and ingestion — `signalService.ingest()`

`src/services/signal.service.ts` is the one place a `RawSourceResult`
(§ below) becomes a `Signal` row: title/content trimmed, a
`contentHash` computed (`sha256(title + content)`,
`domain/signal/content-hash.ts`), reliability seeded from the source's
baseline (`domain/evidence/source-reliability-policy.ts`), and a
deterministic 0..1 `qualityScore` computed
(`domain/signal/signal-quality.ts` — weighted: reliability 0.5,
content-length-as-specificity-proxy 0.3, recency 0.2; explicitly
**not** faking the M3 brief's other three named factors — originality,
problem clarity, evidence richness — those are left to the Problem
Analyst's real judgment over a whole cluster, not approximated cheaply
here).

## Deduplication — three levels, all explainable

Every `DUPLICATE` signal carries `duplicateOfSignalId` and a
human-readable `duplicateReason` — never just a status flag (M3 brief
Part 9: "every deduplication decision should be explainable"):

1. **Exact duplicate** — `contentHash` collision, checked globally (not
   scoped to one source — the same story can be crossposted).
   `duplicateReason: "identical content hash"`.
2. **Source repost** — the same `sourceReference` URL already ingested.
   `duplicateReason: "same source reference already ingested"`.
3. **Near-duplicate** — Jaccard token-overlap similarity
   (`domain/signal/similarity.ts`, no stemming, no model call, no
   vector database — deliberately deferred, see `docs/M3_ARCHITECTURE_PROPOSAL.md`
   §24) against up to the 200 most recent comparable signals **from
   the same source** (`signalRepository.listRecentComparable` — a
   bounded window, never a full-table scan, per Part 45's
   fan-out warning) at a **0.85** threshold.
   `duplicateReason: "near-duplicate content (similarity 0.87)"` — the
   actual score is always included.

A `DUPLICATE` signal is never clustered
(`signalClusteringService.assign` rejects any non-`PROCESSED` signal)
and never counted in a cluster's aggregates — the direct implementation
of "do not let duplicated content artificially inflate opportunity
scores" (Part 9).

Unusable content (empty title/content after trimming) is `REJECTED`,
never silently dropped.

## SignalCluster

Groups signals about a common underlying theme
(`domain/signal/cluster.types.ts`: `ACTIVE → ARCHIVED`).
`signalClusteringService.assign()` (`src/services/signal-clustering.service.ts`)
compares an incoming `PROCESSED` signal's content against every
`ACTIVE` cluster's representative text (the founding signal's content,
a simple "first signal is the centroid" approximation — no embeddings)
using the same similarity primitive as near-dup detection, at a
**looser 0.35** threshold (a cluster groups *related problems*, not
near-identical text) — above it, joins that cluster; below every
existing cluster, founds a new one, publishing `SIGNAL_CLUSTER_CREATED`
only on that founding event, not on every join.

**Independence, not just count** (M3 brief Part 13 — "100 posts != 100
independent customers"): `independentSourceCount` is
`COUNT(DISTINCT sourceGroupKey)` across the cluster's `CLUSTERED`
(non-duplicate) members, where a `null` `sourceGroupKey` counts the
signal as its own independent group. **Stated plainly**: neither
current live source (Hacker News story search, Stack Exchange question
search) produces a genuine grouping key today — every result from
either is already a distinct, standalone story/question, so
`sourceGroupKey` is `null` for both in practice (`SOURCE_ADAPTERS.md`).
The mechanism is real and tested (`tests/unit/cluster-confidence.test.ts`,
`tests/integration/signal-clustering.test.ts` exercise it directly with
synthetic grouped/ungrouped signals) and ready for a future source
where it matters (e.g. multiple comments on one Reddit thread) — it
just isn't exercised by live data yet, and that gap is not hidden.

`confidence` (`domain/signal/cluster-confidence.ts`) weights
independence over raw average signal quality (0.6 / 0.4) — a documented,
founder-revisable formula, same "isolated policy" pattern as the
permission→risk and validation-level tables.

**Not implemented**: cross-cluster merging. One-shot assignment only —
deferred to M4 (`docs/M3_ARCHITECTURE_PROPOSAL.md` §6, §26).

## Problem

The structured, extracted recurring problem
(`domain/problem/problem.types.ts`):

```
CANDIDATE → PROMOTED | INSUFFICIENT_EVIDENCE | REJECTED
INSUFFICIENT_EVIDENCE → CANDIDATE   (a later re-analysis can revisit it)
(any non-terminal) → ARCHIVED
```

Produced by `problemAnalystService.run()` (`OPPORTUNITY_INTELLIGENCE.md`
covers the agent itself); the field list matches the M3 brief's Part
11 literal spec exactly (`statement, customerSegment, workflow, pain,
frequency, currentSolution, dissatisfaction, urgency,
willingnessToPaySignal, evidenceCount, confidence`), with one
service-level guarantee beyond what any model call can be trusted to
self-report: `evidenceCount` is always clamped to the cluster's real,
non-duplicate signal count — a model cannot claim more supporting
signals exist than genuinely do.

## `RawSourceResult` — what a source hands to ingestion

```ts
interface RawSourceResult {
  title: string;
  content: string;
  url: string | null;
  publishedAt: string | null;
  authorContext: string | null;   // opaque, never a real-world identity
  sourceGroupKey: string | null;  // independence grouping, see above
  metadata: Record<string, unknown>;
}
```

Defined in `src/sources/research-source.ts` — see `SOURCE_ADAPTERS.md`
for the adapters that produce it.
