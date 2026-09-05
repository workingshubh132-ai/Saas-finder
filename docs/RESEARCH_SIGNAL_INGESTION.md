# Research Signal Ingestion — the real-signal boundary

The smallest reliable boundary for getting real, externally observed
research into VentureForge's existing intelligence engine — reusing
everything M3 and M10 already built, adding nothing that duplicates it.

## Architecture decision: where REAL research enters

```
REAL EXTERNALLY OBSERVED RESEARCH
        │  (operator/founder, gathered outside this container)
        ▼
scripts/ingest-research-signals.ts        ← NEW: reads a JSON file, attributes to a real Agent
        │
        ▼
researchSignalImportService.ingestBatch() ← NEW: the only new logic — batching + structured reporting
        │  builds a RawSourceResult + (for REAL/HUMAN_ACTION) a RealWorldTag per item
        ▼
signalService.ingest()                    ← UNCHANGED (M3): normalization, 3-level dedup,
        │                                    quality scoring, source reliability, audit
        ▼
signalClusteringService.assign()          ← UNCHANGED (M3): deterministic clustering,
        │                                    independent-source counting
        ▼
problemAnalystService.run() / researchCycleService  ← UNCHANGED (M3), human-triggered next,
        │                                    not called automatically by this boundary
        ▼
EXISTING M3–M9 INTELLIGENCE (competitor/market/opportunity analysis, scoring, kill-risk,
Chairman, CEO, evidence-gap, decision queue — all unmodified)
```

Two facts made this small:

1. **`signalService.ingest()` already accepts almost exactly this shape**
   (`src/services/signal.service.ts`) — a `RawSourceResult` plus
   `source`/`sourceType`/`collectedByAgentId`. It already does
   normalization, exact-hash dedup, source-repost dedup, near-duplicate
   (Jaccard similarity) dedup, quality scoring, source-reliability
   lookup (fails closed to `LOW` for any unrecognized source id — a
   caller can never buy a higher trust tier just by naming a source),
   and audit logging. None of that is touched.
2. **M10 already built the REAL/DEV_FIXTURE distinction**
   (`src/domain/real-world/reality.types.ts`): `RealityLabel`,
   `buildRealWorldTag()` (throws for an empty provenance note on
   `REAL`/`HUMAN_ACTION` — the one place a provenance claim is actually
   checked, not merely stored), `parseRealWorldTag()`, embedded in
   `Signal.metadata`'s existing free-form JSON column. `OperatorWebSearchSource`
   (`src/sources/operator-web-search.source.ts`) already proved this tag
   survives `signalService.ingest()` unmodified.

What was missing, and is all this change adds:

- **Batch ingestion with structured reporting** — `signalService.ingest()`
  is one-signal-at-a-time; nothing aggregated accepted/duplicate/rejected
  counts and reasons across a list, or reported which clusters a batch
  touched.
- **An operator-friendly JSON import path** — M10's own real-signal runs
  hardcoded pools inline in TypeScript (`scripts/m10-real-signals-data.ts`);
  nothing let an operator hand in a plain JSON file.
- **Explicit per-item clustering** — `researchCycleService.run()` only
  clusters signals returned by its own `researchAgentService.run()` call
  (`signal-ids` from *that* execution); a signal ingested outside a
  research-agent tool call is never automatically discovered and
  clustered by anything else. This ingestion boundary calls
  `signalClusteringService.assign()` itself, immediately after a
  successful ingest, so an imported signal reaches exactly the state
  (`CLUSTERED`, with a correct `independentSourceCount`) a live research
  cycle would have left it in.

## What this boundary deliberately does NOT do

- Does not fetch anything from the network itself. No web crawler, no
  browser automation, no bypass of this container's outbound HTTPS
  restriction. Real content is gathered by an operator/founder *outside*
  this container (a WebSearch session, reading a real thread) and handed
  in as already-observed text plus its real source URL — the exact M10
  precedent (`docs/M10_REAL_WORLD_AUDIT.md`).
- Does not run Problem/Competitor/Market/Opportunity Analyst. Clustering
  is deterministic, no-model-call code (`signalClusteringService`'s own
  doc comment: "no model call, no vector database") — reasoning steps
  that cost money and require a model are left for a human to trigger
  next, deliberately, once a cluster looks worth the spend.
- Does not approve, send, deploy, activate billing, or bypass the
  Chairman/human-approval system. The only two functions it calls
  (`signalService.ingest`, `signalClusteringService.assign`) write
  `Signal`/`SignalCluster` rows and an audit log entry — nothing else.
  No agent permission is added or changed.

## Provenance — REAL_EXTERNALLY_OBSERVED vs DEV_FIXTURE

`REAL_EXTERNALLY_OBSERVED` research is **externally collected evidence
imported through a governed ingestion boundary.** It is explicitly NOT
equivalent to:

- automated source access (nothing in this container fetched it);
- verified truth (a real forum post can still be wrong or misleading —
  `getSourceReliability()` seeds a conservative baseline, never HIGH,
  for exactly this reason);
- customer validation or willingness-to-pay validation (that is M5's own,
  separate, much stronger evidentiary bar — a real signal here is raw
  market research, not a real customer's own qualified response).

Every imported item states its own `reality` (`REAL`, `DEV_FIXTURE`,
`HUMAN_ACTION`, or `SIMULATED` — `src/domain/real-world/reality.types.ts`,
unchanged). `REAL`/`HUMAN_ACTION` items must carry a non-empty
`provenanceNote` describing how the content was actually obtained;
`buildRealWorldTag()` refuses to construct the tag otherwise, and
`researchSignalImportService.ingestBatch()` catches that refusal and
rejects the one offending item with a clear reason rather than crashing
the batch or silently storing it unlabeled. A `DEV_FIXTURE` item is never
retagged as `REAL`, and a `REAL` item is never silently downgraded — the
tag a caller supplies is the tag stored, verified round-trip in
`tests/integration/research-signal-import.test.ts`.

## The current network limitation, stated honestly

This runtime does not currently have unrestricted public-web access (the
container's own egress proxy blocks external HTTPS domains, verified
directly in M10 — `docs/M10_REAL_WORLD_AUDIT.md`). This ingestion path is
intentionally designed around that fact rather than working around it: it
accepts externally observed research an operator already gathered, and
never pretends the runtime fetched it itself. A future real
`ResearchSource` adapter (a live, network-reaching implementation) remains
possible without any change to this boundary — `signalService.ingest()`
and `signalClusteringService.assign()` are exactly the same functions such
an adapter's own results would flow through.

## Governance

- No new agent permission. The attribution agent
  (`scripts/ingest-research-signals.ts` creates one, role "Research
  Agent") is zero-grant, exactly like every other pure-collection agent
  in this codebase.
- The ingestion actor is a real, persisted `Agent`, attributed via
  `collectedByAgentId` exactly like every other Signal (Constitution
  §25). A batch-level audit event (`INGEST_RESEARCH_SIGNAL_BATCH`) is
  written in addition to `signalService.ingest()`'s own per-signal audit
  entries.
- No schema migration. `Signal.metadata` (a nullable, free-form JSON
  column that has existed since M3) already holds the embedded
  `RealWorldTag` exactly as M10 already proved
  (`tests/unit/m10-real-world.test.ts`,
  `tests/integration/m10-real-signal-provenance.test.ts`) — extending an
  existing column, not adding a new one.

## Files

- `src/domain/signal/external-signal-input.ts` — the operator-facing
  per-item shape.
- `src/services/research-signal-import.service.ts` —
  `researchSignalImportService.ingestBatch()`.
- `scripts/ingest-research-signals.ts` — the operator command.
- `tests/integration/research-signal-import.test.ts` — the test suite
  (provenance, idempotency, source independence, and a real imported
  signal flowing into `problemAnalystService` unchanged).

## Exact next command for an operator

```
npx tsx scripts/ingest-research-signals.ts path/to/signals.json [experimentId]
```

See that script's own top-of-file comment for the exact input JSON shape.
