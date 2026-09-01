/**
 * What a source adapter returns before normalization
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §4) — deliberately close to the
 * source's own shape; signalService.ingest() does the work of turning
 * this into a normalized Signal, not the adapter itself.
 */
export interface RawSourceResult {
  readonly title: string;
  readonly content: string;
  readonly url: string | null;
  readonly publishedAt: string | null;
  /** Opaque, source-specific author label — never a real-world identity. */
  readonly authorContext: string | null;
  /** Groups results that share a thread/post/author context, for
   *  independent-source counting (§2, §6). Null when a source has no
   *  such notion (every result stands alone). */
  readonly sourceGroupKey: string | null;
  /** Anything source-specific worth keeping that doesn't deserve its
   *  own Signal column (points, tags, answer count...). */
  readonly metadata: Record<string, unknown>;
}

/**
 * A narrow, source-specific search capability — deliberately NOT a
 * `Tool` (docs/M3_ARCHITECTURE_PROPOSAL.md §3). Permissions, risk,
 * budgets, and audit stay exactly where M2 put them: `SourceSearchTool`
 * wraps one of these as a `Tool`. Implementing this interface is the
 * entire contract for adding a new research source.
 */
export interface ResearchSource {
  readonly id: string;
  readonly name: string;
  readonly rateLimit: { requestsPerMinute: number };
  search(query: string, options: { maxResults: number }): Promise<RawSourceResult[]>;
}

/**
 * Baseline trustworthiness for a source is deliberately NOT a field on
 * `ResearchSource` itself — it lives in one centralized,
 * founder-revisable table (domain/evidence/source-reliability-policy.ts),
 * the same pattern as domain/risk/permission-risk-policy.ts, so
 * "how much do we trust source X" is one place to look and change,
 * not scattered across adapter classes.
 */
