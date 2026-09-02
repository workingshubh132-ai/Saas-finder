import type { IndependenceLevel } from "./independence.js";

/**
 * The seven evidence-quality factors (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §8) — never collapsed into one unexplained number. Every factor is
 * always persisted alongside the aggregate `qualityScore`, never in
 * place of it. Split by provenance, continuing this codebase's
 * consistent "deterministic where a fact is actually computable, model
 * judgment only where real judgment is required" pattern:
 * `reliability`/`specificity`/`recency`/`directness`/`independenceLevel`
 * are computed deterministically and handed to the Evidence Validator
 * as input (never invented by the model); `originality`/`corroboration`
 * are the Validator's own genuine judgment, captured as explicit
 * structured output.
 */
export interface EvidenceQualityFactors {
  /** From Evidence.reliability (LOW/MEDIUM/HIGH -> 0.2/0.6/1.0). Deterministic. */
  reliability: number;
  /** Is this a direct customer statement or secondary/inferred? Table over EvidenceSourceType. Deterministic. */
  directness: number;
  /** Content-length-as-proxy, reusing Signal.qualityScore's existing component when available. Deterministic. */
  specificity: number;
  /** From the freshness policy (domain/claim/freshness-policy.ts). Deterministic. */
  recency: number;
  /** From the independence classification (domain/claim/independence.ts). Deterministic. */
  independence: number;
  /** Is this saying something new, or repeating another item in different words? Validator judgment. */
  originality: number;
  /** How much weight does the (deterministically counted) corroboration actually deserve? Validator judgment. */
  corroboration: number;
}

export interface EvidenceQualityAssessment extends EvidenceQualityFactors {
  /** Weighted aggregate — a convenience for sorting/thresholds, never a substitute for the factor breakdown above. */
  qualityScore: number;
  independenceLevel: IndependenceLevel;
}

const WEIGHT_RELIABILITY = 0.2;
const WEIGHT_DIRECTNESS = 0.15;
const WEIGHT_SPECIFICITY = 0.15;
const WEIGHT_RECENCY = 0.1;
const WEIGHT_INDEPENDENCE = 0.15;
const WEIGHT_ORIGINALITY = 0.1;
const WEIGHT_CORROBORATION = 0.15;

export function computeQualityScore(factors: EvidenceQualityFactors): number {
  return (
    WEIGHT_RELIABILITY * factors.reliability +
    WEIGHT_DIRECTNESS * factors.directness +
    WEIGHT_SPECIFICITY * factors.specificity +
    WEIGHT_RECENCY * factors.recency +
    WEIGHT_INDEPENDENCE * factors.independence +
    WEIGHT_ORIGINALITY * factors.originality +
    WEIGHT_CORROBORATION * factors.corroboration
  );
}

/** Reliability factor table (docs/M4_ARCHITECTURE_PROPOSAL.md §8) — mirrors Evidence.reliability's own LOW/MEDIUM/HIGH vocabulary. */
export const RELIABILITY_FACTOR: Readonly<Record<string, number>> = {
  LOW: 0.2,
  MEDIUM: 0.6,
  HIGH: 1.0,
};

/** Directness factor table over the existing EvidenceSourceType vocabulary — no new enum. */
export const DIRECTNESS_FACTOR: Readonly<Record<string, number>> = {
  CUSTOMER: 1.0,
  EXPERIMENT: 0.9,
  INTERNAL: 0.7,
  COMPETITOR: 0.5,
  MARKET_DATA: 0.5,
  WEB: 0.4,
  OTHER: 0.3,
};

/** Independence-level credit, reused by both quality aggregation and confidence recalculation (§11). */
export const INDEPENDENCE_CREDIT: Readonly<Record<IndependenceLevel, number>> = {
  KNOWN: 1.0,
  LIKELY: 0.6,
  UNKNOWN: 0.2,
};
