/**
 * Seam for future agent-execution code to call any LLM without the
 * kernel depending on a specific vendor (Constitution's "provider/model
 * agnostic" requirement). M1 defines the contract only: no business
 * logic in this kernel calls a real implementation of it, because M1
 * has no autonomous agent-execution loop yet (that is explicitly out
 * of scope — see docs/DECISIONS.md). Agent.modelProvider/modelName are
 * plain descriptive strings for the same reason: the schema must never
 * hardcode a vendor enum.
 */
export interface CompletionMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface CompletionRequest {
  readonly systemPrompt?: string;
  readonly messages: ReadonlyArray<CompletionMessage>;
  readonly maxOutputTokens?: number;
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
