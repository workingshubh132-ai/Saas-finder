/**
 * Evidence independence for one claim (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §7) — continues M3's "100 signals != 100 customers" discipline
 * (`Signal.sourceGroupKey`, `docs/SIGNAL_MODEL.md`) one layer deeper.
 * Exactly three levels, per the M4 brief: never pretend certainty that
 * can't be established, so `UNKNOWN` is the fallback, not `KNOWN`.
 */
export const INDEPENDENCE_LEVELS = ["KNOWN", "LIKELY", "UNKNOWN"] as const;
export type IndependenceLevel = (typeof INDEPENDENCE_LEVELS)[number];

export function isIndependenceLevel(value: string): value is IndependenceLevel {
  return (INDEPENDENCE_LEVELS as readonly string[]).includes(value);
}

/** One supporting-evidence item's identity, as far as independence classification needs it. */
export interface IndependenceInput {
  readonly evidenceId: string;
  readonly source: string;
  readonly sourceType: string;
  /** From the linked Signal, when one exists (`Evidence.signalId`). Null for pre-M3/unlinked evidence. */
  readonly sourceGroupKey: string | null;
}

export interface IndependenceAssessment {
  readonly level: IndependenceLevel;
  readonly reasoning: string;
}

/**
 * Pure, deterministic — no model call, mirroring `computeQueuePriority`'s
 * own "caller assembles the input, this just classifies it" shape.
 * `KNOWN` requires every item to resolve to a real `sourceGroupKey`
 * with at least two distinct values actually present — a directly
 * queryable fact, not an inference.
 */
export function classifyIndependence(items: readonly IndependenceInput[]): IndependenceAssessment {
  if (items.length < 2) {
    return {
      level: "UNKNOWN",
      reasoning: `Only ${items.length} supporting evidence item(s) — independence cannot be assessed from a single source.`,
    };
  }

  const groupKeys = items.map((item) => item.sourceGroupKey);
  if (groupKeys.every((key): key is string => key !== null)) {
    const distinctGroups = new Set(groupKeys).size;
    if (distinctGroups >= 2) {
      return {
        level: "KNOWN",
        reasoning: `${items.length} supporting item(s) resolve to ${distinctGroups} distinct source-group(s) (Signal.sourceGroupKey) — independence is a directly queryable fact.`,
      };
    }
    return {
      level: "KNOWN",
      reasoning: `All ${items.length} supporting item(s) share the same source-group (Signal.sourceGroupKey) — known to NOT be independent (same thread/author context).`,
    };
  }

  const distinctSources = new Set(items.map((item) => item.source));
  const distinctSourceTypes = new Set(items.map((item) => item.sourceType));
  if (distinctSources.size >= 2 || distinctSourceTypes.size >= 2) {
    return {
      level: "LIKELY",
      reasoning: `Supporting items come from ${distinctSources.size} distinct source(s)/${distinctSourceTypes.size} distinct source type(s), but at least one lacks a resolvable source-group key — independence is a reasonable inference, not a proven fact.`,
    };
  }

  return {
    level: "UNKNOWN",
    reasoning: "Supporting items share the same source and source type with no source-group key to disambiguate — independence cannot be established.",
  };
}
