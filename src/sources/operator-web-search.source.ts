import type { RealWorldTag } from "../domain/real-world/reality.types.js";
import type { RawSourceResult, ResearchSource } from "./research-source.js";

/**
 * REAL, but not LIVE (docs/M10_REAL_WORLD_AUDIT.md,
 * docs/M10_REAL_WORLD_BOUNDARY.md) — this container's own egress proxy
 * blocks the real, keyless HackerNewsSource/StackExchangeSource network
 * calls (verified directly, not assumed), so this milestone's real
 * signals were instead obtained by the operator (this session) through
 * a permitted external search tool immediately before ingestion, then
 * handed to this adapter. Every `RawSourceResult` passed in must carry a
 * real, dereferenceable `url` and a title actually returned by that
 * search — never invented content; the same discipline
 * `HackerNewsSource`/`StackExchangeSource` already hold themselves to.
 *
 * Deliberately does NOT match results to the query string the way a
 * real search API would — it serves its pre-fetched pool in order,
 * `maxResults` at a time, regardless of the exact (dev-fixture-planned)
 * query text asked. That per-query relevance matching a live API
 * performs is not reproduced here; what IS real is every individual
 * result's content and provenance. Labeled plainly rather than silently
 * approximated.
 */
export class OperatorWebSearchSource implements ResearchSource {
  readonly id: string;
  readonly name: string;
  readonly rateLimit = { requestsPerMinute: 30 };

  private cursor = 0;

  constructor(
    private readonly pool: readonly RawSourceResult[],
    private readonly options: { id: string; name: string; tag: RealWorldTag },
  ) {
    this.id = options.id;
    this.name = options.name;
  }

  async search(_query: string, options: { maxResults: number }): Promise<RawSourceResult[]> {
    const slice = this.pool.slice(this.cursor, this.cursor + options.maxResults);
    this.cursor += slice.length;
    // Tagged here, at the one layer that legitimately knows its own
    // provenance, rather than by modifying signalService.ingest() or
    // researchAgentService — both stay exactly as M3 built them.
    return slice.map((result) => ({ ...result, metadata: { ...result.metadata, realWorld: this.options.tag } }));
  }
}
