/**
 * Seam for agent-execution code to call any LLM without the kernel
 * depending on a specific vendor (Constitution's "provider/model
 * agnostic" requirement). Defined in M1 as an unused contract;
 * M2 (docs/M2_ARCHITECTURE_PROPOSAL.md §9) adds the first two
 * implementations — DevelopmentModelProvider and AnthropicModelProvider
 * — behind it. Agent.modelProvider/modelName remain plain descriptive
 * strings for the same reason: the schema must never hardcode a vendor
 * enum.
 */
export interface CompletionMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface CompletionRequest {
  readonly systemPrompt?: string;
  readonly messages: ReadonlyArray<CompletionMessage>;
  readonly maxOutputTokens?: number;
  /**
   * Used ONLY by DevelopmentModelProvider — a real provider ignores
   * this entirely. The caller supplies a value already shaped like its
   * own expected structured output, so a development run exercises the
   * full validation pipeline without ever calling a real model. Never
   * presented as real output: DevelopmentModelProvider always labels
   * its result `provider: "development-fixture"`.
   */
  readonly devFixtureResponse?: unknown;
}

export interface CompletionResult {
  readonly content: string;
  readonly provider: string;
  readonly model: string;
}

export interface ModelProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
