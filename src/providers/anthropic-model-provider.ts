import type { CompletionRequest, CompletionResult, ModelProvider } from "../domain/ports/model-provider.js";
import { ModelError } from "../domain/shared/errors.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export interface AnthropicModelProviderOptions {
  apiKey: string;
  model: string;
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessagesResponse {
  model?: string;
  content?: AnthropicContentBlock[];
}

/**
 * Real implementation — calls the Anthropic Messages API directly over
 * fetch (no SDK dependency needed for one endpoint). Confirmed
 * reachable from this sandbox (a direct curl to api.anthropic.com
 * returned a real HTTP response through the environment's proxy), but
 * no application-level API key is configured here, so this class is
 * unit-tested against a mocked fetch shaped like the real, documented
 * API response — never live-exercised in this environment. See
 * docs/M2_ARCHITECTURE_PROPOSAL.md §9.
 */
export class AnthropicModelProvider implements ModelProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicModelProviderOptions) {
    if (!options.apiKey) {
      throw new ModelError("AnthropicModelProvider requires an API key.");
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await this.fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        system: request.systemPrompt,
        messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ModelError(`Anthropic API returned ${response.status}: ${body.slice(0, 500)}`);
    }

    const payload = (await response.json()) as AnthropicMessagesResponse;
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");

    if (!text) {
      throw new ModelError("Anthropic API response contained no text content.");
    }

    return { content: text, provider: this.name, model: payload.model ?? this.model };
  }
}
