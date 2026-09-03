import "dotenv/config";

export type ModelProviderMode = "development" | "anthropic";
export type ResearchToolMode = "development" | "live";

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
   * "development" (default) uses labeled fixture sources with no
   * network dependency. "live" calls the real, keyless research
   * sources (Hacker News Algolia, Stack Exchange). See
   * docs/SOURCE_ADAPTERS.md.
   */
  researchToolMode: (process.env.RESEARCH_TOOL_MODE ?? "development") as ResearchToolMode,

  /**
   * M6 (docs/M6_ARCHITECTURE_PROPOSAL.md §10) — every factory workspace
   * lives under this directory, always a descendant of the VentureForge
   * repo root itself. That placement is deliberate, not incidental:
   * Node's own module resolution (and TypeScript's, which follows the
   * same convention) walks UP from a file looking for the nearest
   * node_modules, so generated product code can `import express from
   * "express"` and resolve it from VentureForge's own already-installed
   * dependency — no network-dependent `npm install` inside a generated
   * workspace, ever (§29 cost/dependency policy). process.cwd() is the
   * repo root in every invocation path this project already uses (npm
   * scripts, vitest, tsx scripts/*.ts all run from the repo root).
   */
  factoryWorkspacesDir: `${process.cwd()}/factory-workspaces`,
} as const;

export function assertConfigValid(): void {
  if (config.modelProviderMode !== "development" && config.modelProviderMode !== "anthropic") {
    throw new Error(
      `MODEL_PROVIDER_MODE must be "development" or "anthropic" (got "${config.modelProviderMode}"). Refusing to start.`,
    );
  }
  if (config.researchToolMode !== "development" && config.researchToolMode !== "live") {
    throw new Error(
      `RESEARCH_TOOL_MODE must be "development" or "live" (got "${config.researchToolMode}"). Refusing to start.`,
    );
  }
  if (config.modelProviderMode === "anthropic" && !config.anthropicApiKey) {
    throw new Error("MODEL_PROVIDER_MODE=anthropic requires ANTHROPIC_API_KEY to be set. Refusing to start.");
  }
}
