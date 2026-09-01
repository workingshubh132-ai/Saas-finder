import { RateLimitError } from "../domain/shared/errors.js";

interface Window {
  windowStartedAt: number;
  count: number;
}

const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;

/**
 * A small in-memory fixed-window limiter keyed by source id
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §19) — consulted by
 * `SourceSearchTool` before every `ResearchSource.search()` call, so
 * every current and future source gets bounded request behavior for
 * free without each adapter re-implementing backoff. Exceeding the
 * limit raises the same `RateLimitError` any other transient failure
 * would, which the runtime already retries under its existing bounded
 * policy (docs/AGENT_RUNTIME.md) — never a silent drop, never an
 * unbounded wait.
 */
export function checkRateLimit(sourceId: string, requestsPerMinute: number): void {
  const now = Date.now();
  const existing = windows.get(sourceId);

  if (!existing || now - existing.windowStartedAt >= WINDOW_MS) {
    windows.set(sourceId, { windowStartedAt: now, count: 1 });
    return;
  }

  if (existing.count >= requestsPerMinute) {
    throw new RateLimitError(
      `Source "${sourceId}" exceeded its rate limit (${requestsPerMinute} requests/minute).`,
    );
  }
  existing.count += 1;
}

/** Test-only: clears all rate-limit windows so a test starts clean. */
export function resetRateLimits(): void {
  windows.clear();
}
