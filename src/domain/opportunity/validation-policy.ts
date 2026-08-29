import type { EvidenceReliability, EvidenceSourceType } from "../evidence/evidence.types.js";
import type { ValidationLevel } from "./validation-level.js";

/**
 * The formal, per-level evidence-sufficiency policy (M2 brief Part 14
 * — M1 explicitly deferred this, docs/DECISIONS.md #9). For every
 * level: minimum evidence, minimum average confidence, and — from
 * LEVEL_3 up — which evidence *type* must actually back the claim
 * (market/competitor signal, then a real customer, then a real
 * experiment), at what reliability, in what quantity. `requiresHumanActor`
 * and `requiresChairmanApproval` say whether an agent may set this
 * level itself or whether it needs a human hand (and, from LEVEL_5, a
 * standing Chairman APPROVE review) on the wheel. Numbers are a
 * founding policy choice — see docs/VALIDATION_POLICY.md and
 * docs/DECISIONS.md for the reasoning behind each one; a founder
 * revising them touches only this file.
 */
export interface ValidationLevelRequirement {
  readonly level: ValidationLevel;
  readonly minEvidenceCount: number;
  readonly minAverageConfidence: number;
  readonly requiredSourceTypes?: readonly EvidenceSourceType[];
  /** How many evidence records of `requiredSourceTypes` are needed. Default 1. */
  readonly minCountOfRequiredSourceType?: number;
  readonly minReliabilityAmongRequired?: EvidenceReliability;
  readonly requiresHumanActor: boolean;
  readonly requiresChairmanApproval: boolean;
}

export const VALIDATION_LEVEL_REQUIREMENTS: Readonly<Record<ValidationLevel, ValidationLevelRequirement>> = {
  LEVEL_0: {
    level: "LEVEL_0",
    minEvidenceCount: 0,
    minAverageConfidence: 0,
    requiresHumanActor: false,
    requiresChairmanApproval: false,
  },
  LEVEL_1: {
    level: "LEVEL_1",
    minEvidenceCount: 1,
    minAverageConfidence: 0,
    requiresHumanActor: false,
    requiresChairmanApproval: false,
  },
  LEVEL_2: {
    level: "LEVEL_2",
    minEvidenceCount: 2,
    minAverageConfidence: 0.3,
    requiresHumanActor: false,
    requiresChairmanApproval: false,
  },
  LEVEL_3: {
    level: "LEVEL_3",
    minEvidenceCount: 2,
    minAverageConfidence: 0.4,
    requiredSourceTypes: ["MARKET_DATA", "COMPETITOR"],
    requiresHumanActor: false,
    requiresChairmanApproval: false,
  },
  LEVEL_4: {
    level: "LEVEL_4",
    minEvidenceCount: 2,
    minAverageConfidence: 0.5,
    requiredSourceTypes: ["CUSTOMER"],
    minReliabilityAmongRequired: "MEDIUM",
    requiresHumanActor: true,
    requiresChairmanApproval: false,
  },
  LEVEL_5: {
    level: "LEVEL_5",
    minEvidenceCount: 3,
    minAverageConfidence: 0.6,
    requiredSourceTypes: ["CUSTOMER"],
    minReliabilityAmongRequired: "HIGH",
    requiresHumanActor: true,
    requiresChairmanApproval: true,
  },
  LEVEL_6: {
    level: "LEVEL_6",
    minEvidenceCount: 3,
    minAverageConfidence: 0.7,
    requiredSourceTypes: ["EXPERIMENT"],
    requiresHumanActor: true,
    requiresChairmanApproval: true,
  },
  LEVEL_7: {
    level: "LEVEL_7",
    minEvidenceCount: 4,
    minAverageConfidence: 0.75,
    requiredSourceTypes: ["EXPERIMENT"],
    minCountOfRequiredSourceType: 2,
    requiresHumanActor: true,
    requiresChairmanApproval: true,
  },
  LEVEL_8: {
    level: "LEVEL_8",
    minEvidenceCount: 5,
    minAverageConfidence: 0.8,
    requiredSourceTypes: ["EXPERIMENT"],
    minCountOfRequiredSourceType: 2,
    requiresHumanActor: true,
    requiresChairmanApproval: true,
  },
};

export interface EvidenceSummaryItem {
  readonly sourceType: EvidenceSourceType;
  readonly reliability: EvidenceReliability;
  readonly confidence: number;
}

export interface ValidationLevelCheckResult {
  readonly satisfied: boolean;
  /** Human-readable, specific gaps — empty when satisfied. */
  readonly reasons: readonly string[];
}

const RELIABILITY_RANK: Readonly<Record<EvidenceReliability, number>> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * Pure evaluation — no I/O, so it's trivially unit-testable. Never
 * "pretends weak evidence satisfies a higher level" (M2 brief Part
 * 14): every unmet condition is reported, not just the first one.
 */
export function checkValidationLevelRequirement(
  requirement: ValidationLevelRequirement,
  evidence: readonly EvidenceSummaryItem[],
): ValidationLevelCheckResult {
  const reasons: string[] = [];

  if (evidence.length < requirement.minEvidenceCount) {
    reasons.push(`requires at least ${requirement.minEvidenceCount} evidence record(s), has ${evidence.length}`);
  }

  const averageConfidence = evidence.length > 0 ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length : 0;
  if (averageConfidence < requirement.minAverageConfidence) {
    reasons.push(`requires average evidence confidence >= ${requirement.minAverageConfidence}, has ${averageConfidence.toFixed(2)}`);
  }

  if (requirement.requiredSourceTypes && requirement.requiredSourceTypes.length > 0) {
    const requiredTypes = requirement.requiredSourceTypes;
    const minCount = requirement.minCountOfRequiredSourceType ?? 1;
    const matching = evidence.filter((item) => requiredTypes.includes(item.sourceType));

    if (matching.length < minCount) {
      reasons.push(`requires at least ${minCount} evidence record(s) of type ${requiredTypes.join(" or ")}, has ${matching.length}`);
    } else if (requirement.minReliabilityAmongRequired) {
      const minRank = RELIABILITY_RANK[requirement.minReliabilityAmongRequired];
      const sufficientlyReliable = matching.filter((item) => RELIABILITY_RANK[item.reliability] >= minRank);
      if (sufficientlyReliable.length < minCount) {
        reasons.push(
          `requires at least ${minCount} evidence record(s) of type ${requiredTypes.join(" or ")} with reliability >= ${requirement.minReliabilityAmongRequired}, has ${sufficientlyReliable.length}`,
        );
      }
    }
  }

  return { satisfied: reasons.length === 0, reasons };
}
