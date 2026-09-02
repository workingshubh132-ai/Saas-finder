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
  /**
   * M5 (docs/M5_ARCHITECTURE_PROPOSAL.md §18) — the Prospect's
   * `organization` behind a piece of customer evidence, when known.
   * Two items sharing an `organizationKey` are treated as NOT
   * independent, exactly like two items sharing a `sourceGroupKey`:
   * ten employees from the same company are one organization's worth
   * of corroboration, never ten independent customers. Null for
   * non-customer evidence or customer evidence with no known
   * organization.
   */
  readonly organizationKey?: string | null;
}

export interface IndependenceAssessment {
  readonly level: IndependenceLevel;
  readonly reasoning: string;
}

/**
 * Pure, deterministic — no model call, mirroring `computeQueuePriority`'s
 * own "caller assembles the input, this just classifies it" shape.
 * `KNOWN` requires every item to resolve to a real value on every
 * dimension that actually applies to this evidence set (`sourceGroupKey`
 * for M3-style signal-derived evidence, `organizationKey` for M5-style
 * customer evidence — a dimension no item in the set carries at all is
 * simply inapplicable, not unresolved) — a directly queryable fact,
 * not an inference.
 */
/** Two items are grouped together if they share EITHER a sourceGroupKey OR an organizationKey — same thread/author context and same organization are both "not independent" (docs/M5_ARCHITECTURE_PROPOSAL.md §18). */
function groupTogether(a: IndependenceInput, b: IndependenceInput): boolean {
  if (a.sourceGroupKey !== null && a.sourceGroupKey === b.sourceGroupKey) return true;
  if (a.organizationKey && a.organizationKey === b.organizationKey) return true;
  return false;
}

export function classifyIndependence(items: readonly IndependenceInput[]): IndependenceAssessment {
  if (items.length < 2) {
    return {
      level: "UNKNOWN",
      reasoning: `Only ${items.length} supporting evidence item(s) — independence cannot be assessed from a single source.`,
    };
  }

  const groupKeys = items.map((item) => item.sourceGroupKey);
  const organizationKeys = items.map((item) => item.organizationKey ?? null);
  // A dimension only blocks KNOWN when it's genuinely PARTIALLY known —
  // some items have a real value, others don't, so a hidden link can't
  // be ruled out. When NO item in this set has the dimension at all
  // (e.g. sourceGroupKey for a set of pure customer evidence, which
  // never has one; or organizationKey for pre-M5 non-customer
  // evidence), the dimension is simply inapplicable here, not
  // unresolved, and must not block a KNOWN verdict the other dimension
  // can still support.
  const anyGroupKeyKnown = groupKeys.some((key) => key !== null);
  const groupKeyFullyKnown = !anyGroupKeyKnown || groupKeys.every((key): key is string => key !== null);
  const anyOrganizationKeyKnown = organizationKeys.some((key) => key !== null);
  const organizationFullyKnown = !anyOrganizationKeyKnown || organizationKeys.every((key) => key !== null);
  // At least one dimension must actually be active (present for some
  // item) — if NEITHER sourceGroupKey NOR organizationKey is known for
  // ANY item, there is nothing to disambiguate with, and "fully known
  // because entirely absent" must not vacuously produce KNOWN.
  const hasAnyResolvableDimension = anyGroupKeyKnown || anyOrganizationKeyKnown;

  if (hasAnyResolvableDimension && groupKeyFullyKnown && organizationFullyKnown) {
    const distinctGroupings = new Set(items.map((item) => `${item.sourceGroupKey ?? ""}::${item.organizationKey ?? ""}`)).size;
    const anyGrouped = items.some((a, i) => items.slice(i + 1).some((b) => groupTogether(a, b)));
    if (distinctGroupings >= 2 && !anyGrouped) {
      return {
        level: "KNOWN",
        reasoning: `${items.length} supporting item(s) resolve to ${distinctGroupings} distinct source-group/organization combination(s) — independence is a directly queryable fact.`,
      };
    }
    return {
      level: "KNOWN",
      reasoning: `Supporting item(s) share the same source-group and/or the same organization — known to NOT be independent (same thread/author context, or the same company's employees).`,
    };
  }

  const distinctSources = new Set(items.map((item) => item.source));
  const distinctSourceTypes = new Set(items.map((item) => item.sourceType));
  const distinctOrganizations = new Set(organizationKeys.filter((key): key is string => key !== null && key !== undefined));
  if (distinctOrganizations.size >= 2 || distinctSources.size >= 2 || distinctSourceTypes.size >= 2) {
    return {
      level: "LIKELY",
      reasoning: `Supporting items come from ${distinctSources.size} distinct source(s)/${distinctSourceTypes.size} distinct source type(s)/${distinctOrganizations.size} distinct known organization(s), but at least one lacks a resolvable source-group key or organization — independence is a reasonable inference, not a proven fact.`,
    };
  }

  return {
    level: "UNKNOWN",
    reasoning: "Supporting items share the same source, source type, and (where known) organization with no source-group key to disambiguate — independence cannot be established.",
  };
}
