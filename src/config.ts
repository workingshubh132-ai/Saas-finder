import "dotenv/config";

export type ModelProviderMode = "development" | "anthropic";
export type ResearchToolMode = "development" | "hn_algolia";

export const config = {
  port: Number(process.env.PORT ?? 3000),

  /**
   * "development" (default) uses the labeled, non-live
   * DevelopmentModelProvider everywhere the runtime would otherwise
   * call a real model. "anthropic" uses the real Anthropic Messages
   * API and requires ANTHROPIC_API_KEY. See docs/M2_ARCHITECTURE_PROPOSAL.md §9.
   */
  modelProviderMode: (process.env.MODEL_PROVIDER_MODE ?? "development") as ModelProviderMode,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022",

  /**
   * "development" (default) uses a labeled fixture tool with no
   * network dependency. "hn_algolia" calls the real, keyless Hacker
   * News Algolia Search API. See docs/TOOL_SYSTEM.md.
   */
  researchToolMode: (process.env.RESEARCH_TOOL_MODE ?? "development") as ResearchToolMode,
} as const;

export function assertConfigValid(): void {
  if (config.modelProviderMode !== "development" && config.modelProviderMode !== "anthropic") {
    throw new Error(
      `MODEL_PROVIDER_MODE must be "development" or "anthropic" (got "${config.modelProviderMode}"). Refusing to start.`,
    );
  }
  if (config.researchToolMode !== "development" && config.researchToolMode !== "hn_algolia") {
    throw new Error(
      `RESEARCH_TOOL_MODE must be "development" or "hn_algolia" (got "${config.researchToolMode}"). Refusing to start.`,
    );
  }
  if (config.modelProviderMode === "anthropic" && !config.anthropicApiKey) {
    throw new Error("MODEL_PROVIDER_MODE=anthropic requires ANTHROPIC_API_KEY to be set. Refusing to start.");
  }
}
