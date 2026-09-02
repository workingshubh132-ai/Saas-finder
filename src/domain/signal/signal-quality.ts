import type { EvidenceReliability } from "../evidence/evidence.types.js";

/**
 * Deterministic 0..1 signal quality assessment
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §2, M3 brief Part 10) — never a
 * model call, so it can run synchronously on every ingested signal
 * without a performance or cost concern (Part 45).
 *
 * Covers three of the M3 brief's six named factors — source
 * reliability, specificity (via content length as a cheap, defensible
 * proxy), and recency — because those three are honestly computable
 * without semantic understanding. The other three (originality,
 * problem clarity, evidence richness) are NOT faked as a fourth
 * deterministic number here; they are better judged by the Problem
 * Analyst's actual reasoning over the whole cluster later
 * (docs/M3_ARCHITECTURE_PROPOSAL.md §7), where real judgment is
 * already happening, rather than approximated cheaply and passed off
 * as equivalent.
 */

const RELIABILITY_SCORE: Readonly<Record<EvidenceReliability, number>> = { LOW: 0.3, MEDIUM: 0.6, HIGH: 0.9 };

const SPECIFICITY_LENGTH_CAP = 280;
const RECENCY_FULL_SCORE_DAYS = 30;
const RECENCY_FLOOR_DAYS = 730;
const RECENCY_FLOOR_SCORE = 0.2;
const MS_PER_DAY = 86_400_000;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Exported for reuse as the specificity factor in M4's evidence-quality
 *  assessment (domain/claim/evidence-quality.ts; docs/M4_ARCHITECTURE_PROPOSAL.md
 *  §8) — the same cheap, defensible content-length proxy, not a second
 *  implementation of the same idea. */
export function specificityScore(content: string): number {
  return clamp01(content.trim().length / SPECIFICITY_LENGTH_CAP);
}

function recencyScore(publishedAt: Date | null, now: Date): number {
  // Unknown publish date is neither rewarded nor penalized.
  if (!publishedAt) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / MS_PER_DAY);
  if (ageDays <= RECENCY_FULL_SCORE_DAYS) return 1;
  if (ageDays >= RECENCY_FLOOR_DAYS) return RECENCY_FLOOR_SCORE;
  const decayRange = RECENCY_FLOOR_DAYS - RECENCY_FULL_SCORE_DAYS;
  const decayFraction = (ageDays - RECENCY_FULL_SCORE_DAYS) / decayRange;
  return clamp01(1 - decayFraction * (1 - RECENCY_FLOOR_SCORE));
}

export interface SignalQualityInput {
  content: string;
  reliability: EvidenceReliability;
  publishedAt: Date | null;
}

/** Weighted toward reliability (0.5) — the most trustworthy of the
 *  three inputs — then specificity (0.3), then recency (0.2). */
export function computeSignalQualityScore(input: SignalQualityInput, now: Date = new Date()): number {
  const reliability = RELIABILITY_SCORE[input.reliability];
  const specificity = specificityScore(input.content);
  const recency = recencyScore(input.publishedAt, now);
  return clamp01(0.5 * reliability + 0.3 * specificity + 0.2 * recency);
}
