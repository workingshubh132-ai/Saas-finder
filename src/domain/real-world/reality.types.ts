/**
 * The M10 real-world boundary (docs/M10_REAL_WORLD_BOUNDARY.md,
 * docs/M10_REAL_WORLD_AUDIT.md). Every consequential M10 step is
 * classified as exactly one of these four — never left implicit, never
 * inferred by a reader from context alone.
 *
 * Deliberately NOT the same axis as `MetricValueKind`
 * (src/domain/business-metric/business-metric.types.ts,
 * OBSERVED/ESTIMATED/INFERRED/PREDICTED) — that classifies how grounded
 * a NUMBER is; this classifies whether an ACTION actually touched the
 * real world. A revenue figure can be OBSERVED (a real webhook fired)
 * while the step that produced it is tagged REAL; a CEO's forecast can
 * be PREDICTED while the reasoning step that produced it is tagged
 * DEV_FIXTURE (no live model key configured) — the two axes vary
 * independently and neither substitutes for the other.
 */
export const REALITY_LABELS = ["REAL", "DEV_FIXTURE", "HUMAN_ACTION", "SIMULATED"] as const;
export type RealityLabel = (typeof REALITY_LABELS)[number];

export function isRealityLabel(value: string): value is RealityLabel {
  return (REALITY_LABELS as readonly string[]).includes(value);
}

/**
 * Embedded into an existing free-form `metadata` JSON column (Signal,
 * Opportunity — both already carry one) rather than a new column on
 * every leaf table, matching this codebase's own established pattern
 * for optional, non-relational annotation (docs/DECISIONS.md). Only
 * `OperatingCycle`, which has no metadata column, gets a real FK
 * (`realWorldExperimentId` on the Prisma model) instead.
 */
export interface RealWorldTag {
  readonly reality: RealityLabel;
  readonly experimentId: string | null;
  /** One line, human-readable: how this was actually obtained, or why
   *  this label applies. Never empty for REAL or HUMAN_ACTION — "trust
   *  me" is not a provenance note. */
  readonly note: string;
}

export function buildRealWorldTag(input: RealWorldTag): RealWorldTag {
  if ((input.reality === "REAL" || input.reality === "HUMAN_ACTION") && !input.note.trim()) {
    throw new Error(`buildRealWorldTag: a ${input.reality} tag requires a non-empty provenance note.`);
  }
  return input;
}

/** Reads a `RealWorldTag` back out of a parsed metadata object's
 *  `realWorld` key, if present and well-formed. Never throws on
 *  malformed/missing data — a metadata blob predating M10, or one this
 *  tag was never attached to, is simply untagged, not corrupt. */
export function parseRealWorldTag(metadata: unknown): RealWorldTag | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const raw = (metadata as Record<string, unknown>).realWorld;
  if (typeof raw !== "object" || raw === null) return null;
  const { reality, experimentId, note } = raw as Record<string, unknown>;
  if (typeof reality !== "string" || !isRealityLabel(reality)) return null;
  if (experimentId !== null && typeof experimentId !== "string") return null;
  if (typeof note !== "string") return null;
  return { reality, experimentId, note };
}

export const REAL_WORLD_EXPERIMENT_STATUSES = ["RUNNING", "COMPLETED", "ABANDONED"] as const;
export type RealWorldExperimentStatus = (typeof REAL_WORLD_EXPERIMENT_STATUSES)[number];

export function isRealWorldExperimentStatus(value: string): value is RealWorldExperimentStatus {
  return (REAL_WORLD_EXPERIMENT_STATUSES as readonly string[]).includes(value);
}
