/**
 * Deterministic, explainable text similarity — no model call, no
 * vector database (docs/M3_ARCHITECTURE_PROPOSAL.md §5, §6, §24:
 * "complex vector memory" is explicitly deferred to M4+). Shared by
 * near-duplicate detection (a tight threshold) and clustering (a
 * looser one) — same primitive, different bar.
 */

const TOKEN_PATTERN = /[a-z0-9]+/g;

export function tokenize(text: string): ReadonlySet<string> {
  return new Set(text.toLowerCase().match(TOKEN_PATTERN) ?? []);
}

/** Jaccard similarity between two texts' token sets, 0..1. */
export function textSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersectionSize += 1;
  }
  const unionSize = tokensA.size + tokensB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}
