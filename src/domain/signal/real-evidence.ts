import type { Signal } from "@prisma/client";
import { parseRealWorldTag } from "../real-world/reality.types.js";

/**
 * Mirrors signalClusteringService's own independent-source counting
 * (recomputeClusterAggregates, docs/M3_ARCHITECTURE_PROPOSAL.md §2, §6)
 * exactly — same dedup-by-sourceGroupKey rule — but scoped to signals
 * actually tagged REAL. `independentSourceCount` itself intentionally
 * stays reality-blind (it has always counted every clustered signal,
 * and hundreds of existing dev-mode signals carry no reality tag at
 * all); this is an additive, narrower check for the specific question
 * "does this cluster's REAL evidence alone meet the bar," never a
 * replacement for the general-purpose count.
 *
 * A DEV_FIXTURE- or SIMULATED-tagged signal, or one carrying no
 * RealWorldTag at all, contributes nothing here — untagged is treated
 * the same as not-REAL, never assumed real merely because it wasn't
 * explicitly marked otherwise.
 */
export function countRealIndependentSources(signals: readonly Pick<Signal, "id" | "sourceGroupKey" | "metadata">[]): number {
  const realSignals = signals.filter((signal) => isRealSignal(signal));
  return new Set(realSignals.map((signal) => signal.sourceGroupKey ?? signal.id)).size;
}

export function meetsRealEvidenceThreshold(signals: readonly Pick<Signal, "id" | "sourceGroupKey" | "metadata">[], minIndependentSources: number): boolean {
  return countRealIndependentSources(signals) >= minIndependentSources;
}

function isRealSignal(signal: Pick<Signal, "metadata">): boolean {
  const metadata = signal.metadata ? (JSON.parse(signal.metadata) as unknown) : null;
  return parseRealWorldTag(metadata)?.reality === "REAL";
}
