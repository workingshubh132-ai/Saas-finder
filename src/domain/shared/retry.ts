export interface BoundedRetryOptions {
  /** Total attempts, including the first — 1 means "no retry". */
  maxAttempts: number;
  isRetryable: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Retries a transient failure a fixed, bounded number of times — never
 * an unbounded/autonomous loop (M2 brief Part 21). Non-retryable
 * errors (per `isRetryable`) propagate immediately on the first
 * attempt.
 */
export async function withBoundedRetry<T>(fn: () => Promise<T>, options: BoundedRetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxAttempts || !options.isRetryable(error)) {
        throw error;
      }
      options.onRetry?.(attempt, error);
    }
  }
  // Unreachable (the loop always returns or throws), but keeps the compiler satisfied.
  throw lastError;
}
