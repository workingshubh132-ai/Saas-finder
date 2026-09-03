import { CLAIM_IMPORTANCE_WEIGHT, type ClaimImportance } from "../claim/claim.types.js";

/**
 * Explainable, deterministic feature prioritization
 * (docs/M6_ARCHITECTURE_PROPOSAL.md §6) — a documented weighted sum,
 * same "check the formula, not a black box" shape as
 * domain/decision/priority.ts's computeDecisionPriority. Never an
 * unexplained LLM score (brief §5's explicit prohibition).
 */
export const FEATURE_PRIORITIES = ["BUILD_NOW", "BUILD_LATER", "EXPERIMENT_ONLY", "DEFER", "REJECT"] as const;
export type FeaturePriority = (typeof FEATURE_PRIORITIES)[number];

export function isFeaturePriority(value: string): value is FeaturePriority {
  return (FEATURE_PRIORITIES as readonly string[]).includes(value);
}

export interface FeaturePriorityInput {
  /** Does this feature cite a real claim/evidence at all? A feature with no citation can never clear BUILD_NOW/BUILD_LATER (§4). */
  hasCitation: boolean;
  /** How important is the claim this feature tests — CLAIM_IMPORTANCE_WEIGHT, never re-guessed. */
  claimImportance: ClaimImportance | null;
  /** 0..1 — how directly this feature serves the product thesis's core workflow. */
  customerValue: number;
  /** 0..1 — how much this feature, if built, would teach us about the thesis (independent of whether the thesis is already well-supported). */
  learningValue: number;
  /** 0..1 — engineering effort, normalized. */
  implementationCost: number;
  /** 0..1 — likelihood of a difficult/uncertain implementation. */
  technicalRisk: number;
}

export interface FeaturePriorityResult {
  score: number;
  priority: FeaturePriority;
  reasoning: string;
}

const WEIGHT_CUSTOMER_VALUE = 0.3;
const WEIGHT_CLAIM_IMPORTANCE = 0.25;
const WEIGHT_LEARNING_VALUE = 0.2;
const WEIGHT_IMPLEMENTATION_COST = 0.15;
const WEIGHT_TECHNICAL_RISK = 0.1;

const BUILD_NOW_SCORE_THRESHOLD = 0.6;
const BUILD_NOW_MAX_COST = 0.5;
const BUILD_LATER_SCORE_THRESHOLD = 0.4;
/** A feature whose learningValue clears this bar while customerValue stays low is worth a cheap experiment, not a build. */
const EXPERIMENT_LEARNING_THRESHOLD = 0.6;
const EXPERIMENT_CUSTOMER_VALUE_CEILING = 0.4;

export function computeFeaturePriority(input: FeaturePriorityInput): FeaturePriorityResult {
  if (!input.hasCitation) {
    return { score: 0, priority: "REJECT", reasoning: "No claim or evidence citation — a feature without a clear reason is rejected, never guessed into scope." };
  }

  const claimImportance = input.claimImportance ? CLAIM_IMPORTANCE_WEIGHT[input.claimImportance] : 0;
  const score =
    WEIGHT_CUSTOMER_VALUE * input.customerValue +
    WEIGHT_CLAIM_IMPORTANCE * claimImportance +
    WEIGHT_LEARNING_VALUE * input.learningValue -
    WEIGHT_IMPLEMENTATION_COST * input.implementationCost -
    WEIGHT_TECHNICAL_RISK * input.technicalRisk;

  if (input.learningValue >= EXPERIMENT_LEARNING_THRESHOLD && input.customerValue <= EXPERIMENT_CUSTOMER_VALUE_CEILING) {
    return { score, priority: "EXPERIMENT_ONLY", reasoning: `High learning value (${input.learningValue.toFixed(2)}) with unproven customer value (${input.customerValue.toFixed(2)}) — worth testing cheaply, not building into the MVP yet.` };
  }
  if (score >= BUILD_NOW_SCORE_THRESHOLD && input.implementationCost <= BUILD_NOW_MAX_COST) {
    return { score, priority: "BUILD_NOW", reasoning: `score=${score.toFixed(2)} clears the BUILD_NOW bar (>=${BUILD_NOW_SCORE_THRESHOLD}) at an affordable implementation cost (${input.implementationCost.toFixed(2)}).` };
  }
  if (score >= BUILD_LATER_SCORE_THRESHOLD) {
    return { score, priority: "BUILD_LATER", reasoning: `score=${score.toFixed(2)} clears BUILD_LATER (>=${BUILD_LATER_SCORE_THRESHOLD}) but not BUILD_NOW — either the score or the implementation cost falls short of the immediate bar.` };
  }
  return { score, priority: "DEFER", reasoning: `score=${score.toFixed(2)} falls below the BUILD_LATER bar (${BUILD_LATER_SCORE_THRESHOLD}) — real signal, not yet a priority.` };
}
