import type { CompletionRequest, CompletionResult, ModelProvider } from "../domain/ports/model-provider.js";
import { ModelError } from "../domain/shared/errors.js";

/**
 * DEVELOPMENT ONLY — never calls a real model, never fabricates
 * research or claims to be AI reasoning. If the caller supplied
 * `devFixtureResponse`, it is echoed back verbatim (JSON-encoded), so
 * a development run can exercise the full schema-validation pipeline
 * offline and deterministically. With no fixture there is nothing
 * honest to return, so this throws rather than inventing content (M2
 * brief Part 28: "do not represent deterministic fixtures as real AI
 * research").
 */
export class DevelopmentModelProvider implements ModelProvider {
  readonly name = "development-fixture";

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (request.devFixtureResponse === undefined) {
      throw new ModelError(
        "DevelopmentModelProvider has no devFixtureResponse for this call. Either have the caller supply one, or set MODEL_PROVIDER_MODE=anthropic with a real ANTHROPIC_API_KEY.",
      );
    }
    return Promise.resolve({
      content: JSON.stringify(request.devFixtureResponse),
      provider: this.name,
      model: "development-fixture-v1",
    });
  }
}
