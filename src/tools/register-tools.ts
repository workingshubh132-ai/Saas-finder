import { config } from "../config.js";
import { DevelopmentSource } from "../sources/development.source.js";
import { HackerNewsSource } from "../sources/hacker-news.source.js";
import type { ResearchSource } from "../sources/research-source.js";
import { StackExchangeSource } from "../sources/stack-exchange.source.js";
import { SourceSearchTool } from "./source-search.tool.js";
import { toolRegistry } from "./tool-registry.js";

/**
 * The real research sources M3 registers (docs/M3_ARCHITECTURE_PROPOSAL.md
 * §3) — deliberately just these two: both public, keyless, and built
 * for programmatic search, satisfying "multiple useful public
 * research sources" without padding (Part 6/45 of the M3 brief). See
 * docs/SOURCE_ADAPTERS.md for what else was considered and why it
 * isn't here.
 */
const REAL_SOURCES: readonly ResearchSource[] = [new HackerNewsSource(), new StackExchangeSource()];

/**
 * Populates the tool registry with one SourceSearchTool per registered
 * research source, according to RESEARCH_TOOL_MODE. Call once at
 * process startup (and once in tests/setup.ts).
 */
export function registerDefaultTools(): void {
  const sources: ResearchSource[] =
    config.researchToolMode === "live"
      ? [...REAL_SOURCES]
      : REAL_SOURCES.map((source) => new DevelopmentSource({ standsInFor: source.id, displayName: source.name }));

  for (const source of sources) {
    toolRegistry.register(new SourceSearchTool(source));
  }
}
