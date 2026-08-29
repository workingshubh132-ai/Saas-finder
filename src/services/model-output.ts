import type { z } from "zod";
import type { CompletionRequest, CompletionResult } from "../domain/ports/model-provider.js";
import { ModelError } from "../domain/shared/errors.js";

export type ModelCompleter = (request: CompletionRequest) => Promise<CompletionResult>;

export interface ValidatedCompletion<T> {
  readonly value: T;
  /** The raw completion that produced `value` — carries provider/model for callers that need to record it. */
  readonly raw: CompletionResult;
}

/**
 * MODEL OUTPUT -> SCHEMA VALIDATION -> (one corrective retry) -> domain
 * value (M2 brief Part 7: "never trust raw model output"). Shared by
 * every caller that needs structured, Zod-validated output from a
 * ModelProvider — research-agent.service.ts and chairman.service.ts
 * both use this instead of duplicating it. `complete` is typically
 * either ExecutionHandle.callModel (budget-tracked) or
 * ModelProvider.complete directly (Chairman has no execution budget of
 * its own — see docs/CHAIRMAN.md).
 */
export async function completeWithValidation<T>(
  complete: ModelCompleter,
  schema: z.ZodType<T>,
  request: CompletionRequest,
): Promise<ValidatedCompletion<T>> {
  const first = await complete(request);
  const firstResult = schema.safeParse(tryParseJson(first.content));
  if (firstResult.success) return { value: firstResult.data, raw: first };

  const corrective = await complete({
    ...request,
    messages: [
      ...request.messages,
      { role: "assistant", content: first.content },
      {
        role: "user",
        content: `That response did not match the required JSON shape (${firstResult.error.message}). Respond again with ONLY valid JSON in the required shape — no other text.`,
      },
    ],
  });
  const secondResult = schema.safeParse(tryParseJson(corrective.content));
  if (secondResult.success) return { value: secondResult.data, raw: corrective };

  throw new ModelError(`Model output failed schema validation twice: ${secondResult.error.message}`);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
