import type { RealityLabel } from "../real-world/reality.types.js";

/**
 * The operator-facing shape for importing an externally observed
 * research signal (the ingestion boundary this doc names —
 * docs/RESEARCH_SIGNAL_INGESTION.md). Deliberately close to
 * `RawSourceResult` (src/sources/research-source.ts) — this is what an
 * operator hands in, `RawSourceResult` is what `signalService.ingest()`
 * already accepts; `researchSignalImportService.ingestBatch()` is the
 * one small mapping between the two, adding nothing signalService
 * itself doesn't already do.
 *
 * `reality`/`provenanceNote` are never trusted blindly: for anything
 * other than `"DEV_FIXTURE"`/`"SIMULATED"`, `buildRealWorldTag()`
 * (src/domain/real-world/reality.types.ts, unchanged since M10) refuses
 * an empty note — a caller cannot claim REAL provenance without saying
 * how the content was actually obtained. `source.id` is never assumed
 * trustworthy either: `getSourceReliability()` (unchanged since M3)
 * still fails closed to LOW for any id it doesn't already recognize, so
 * a caller cannot claim "source: hacker_news" and inherit that source's
 * MEDIUM baseline merely by naming it.
 */
export interface ExternalSignalSourceDescriptor {
  /** A real, already-registered ResearchSource id (e.g. "hacker_news"), or any operator-chosen id for a source with no adapter — either way, reliability is looked up, never supplied here. */
  readonly id: string;
  /** One of SIGNAL_SOURCE_TYPES (signal.types.ts) — "WEB" for every public web/community/forum source. */
  readonly type: string;
  /** Groups items that share a thread/post/author context, for independent-source counting — same field, same meaning as RawSourceResult.sourceGroupKey. Null when each item stands alone. */
  readonly group: string | null;
}

export interface ExternalResearchSignalInput {
  readonly source: ExternalSignalSourceDescriptor;
  readonly title: string;
  readonly content: string;
  /** The real, dereferenceable URL this content came from — null only when a source genuinely has none. */
  readonly url: string | null;
  /** ISO 8601, or null when unknown. */
  readonly observedAt: string | null;
  /** Opaque, source-specific author label — never a real-world identity. */
  readonly authorContext: string | null;
  /** How this item was actually obtained (e.g. "WebSearch result, 2026-09-05, query: ..."). Folded into the persisted Signal's own metadata for a human auditing provenance later — distinct from `provenanceNote`, which is the RealWorldTag's own required-for-REAL note. */
  readonly externalReference: string | null;
  /** Never assumed — must be stated per item. "REAL" requires a non-empty provenanceNote (buildRealWorldTag enforces this); "DEV_FIXTURE" is the only label existing fixtures should keep using unchanged. */
  readonly reality: RealityLabel;
  readonly provenanceNote: string;
}
