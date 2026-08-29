import { config } from "../config.js";
import type { ModelProvider } from "../domain/ports/model-provider.js";
import { AnthropicModelProvider } from "./anthropic-model-provider.js";
import { DevelopmentModelProvider } from "./development-model-provider.js";

/**
 * The one place that decides which ModelProvider implementation the
 * runtime actually talks to. Everything downstream depends on
 * ModelProvider, never on a concrete class — see docs/M2_ARCHITECTURE_PROPOSAL.md §9.
 */
export function createModelProvider(): ModelProvider {
  if (config.modelProviderMode === "anthropic") {
    return new AnthropicModelProvider({ apiKey: config.anthropicApiKey ?? "", model: config.anthropicModel });
  }
  return new DevelopmentModelProvider();
}
