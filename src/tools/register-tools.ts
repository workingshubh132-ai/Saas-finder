import { config } from "../config.js";
import { DevelopmentSearchTool } from "./development-search.tool.js";
import { HackerNewsSearchTool } from "./hacker-news-search.tool.js";
import { toolRegistry } from "./tool-registry.js";

/** Populates the tool registry according to RESEARCH_TOOL_MODE. Call once at process startup (and once in tests/setup.ts). */
export function registerDefaultTools(): void {
  const searchTool = config.researchToolMode === "hn_algolia" ? new HackerNewsSearchTool() : new DevelopmentSearchTool();
  toolRegistry.register(searchTool);
}
