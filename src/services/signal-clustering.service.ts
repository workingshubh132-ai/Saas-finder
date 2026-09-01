import type { Signal, SignalCluster } from "@prisma/client";
import { signalClusterRepository } from "../db/repositories/signal-cluster.repository.js";
import { signalRepository } from "../db/repositories/signal.repository.js";
import { computeClusterConfidence } from "../domain/signal/cluster-confidence.js";
import { textSimilarity } from "../domain/signal/similarity.js";
import { ValidationError } from "../domain/shared/errors.js";
import { eventBus } from "./event-bus.js";
import { signalService } from "./signal.service.js";

/** Looser than near-duplicate's 0.85 (docs/M3_ARCHITECTURE_PROPOSAL.md
 *  §6) — a cluster groups related PROBLEMS, not near-identical text. */
const CLUSTER_JOIN_THRESHOLD = 0.35;
/** Bounded candidate set — never scans every existing cluster (Part 45). */
const MAX_CLUSTERS_TO_COMPARE = 300;
const CLUSTER_NAME_MAX_LENGTH = 80;

/**
 * One-shot signal-to-cluster assignment (docs/M3_ARCHITECTURE_PROPOSAL.md
 * §6): deterministic token-overlap similarity against each active
 * cluster's representative text, no model call, no vector database.
 * Cluster-merging (discovering after the fact that two clusters are
 * the same theme) is explicitly out of scope — see
 * docs/M3_ARCHITECTURE_PROPOSAL.md §6, deferred to M4.
 */
export const signalClusteringService = {
  async assign(signalId: string): Promise<SignalCluster> {
    const signal = await signalService.getOrThrow(signalId);
    if (signal.status !== "PROCESSED") {
      throw new ValidationError(
        `Signal ${signal.id} must be PROCESSED to be clustered (status: ${signal.status}) — duplicates and rejected signals are never clustered.`,
      );
    }

    const candidates = await signalClusterRepository.listActive(MAX_CLUSTERS_TO_COMPARE);
    let bestCluster: SignalCluster | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = textSimilarity(signal.content, candidate.summary);
      if (score > bestScore) {
        bestScore = score;
        bestCluster = candidate;
      }
    }

    let cluster: SignalCluster;
    if (bestCluster && bestScore >= CLUSTER_JOIN_THRESHOLD) {
      cluster = bestCluster;
    } else {
      cluster = await signalClusterRepository.create({
        name: deriveClusterName(signal),
        summary: signal.content,
      });
      await eventBus.publish({ type: "SIGNAL_CLUSTER_CREATED", payload: { clusterId: cluster.id, name: cluster.name } });
    }

    await signalService.markClustered(signal.id, cluster.id);
    return recomputeClusterAggregates(cluster.id);
  },
};

function deriveClusterName(signal: Signal): string {
  return signal.title.length > CLUSTER_NAME_MAX_LENGTH ? `${signal.title.slice(0, CLUSTER_NAME_MAX_LENGTH - 1)}…` : signal.title;
}

async function recomputeClusterAggregates(clusterId: string): Promise<SignalCluster> {
  const members = await signalRepository.listByCluster(clusterId);
  const clusteredMembers = members.filter((member) => member.status === "CLUSTERED");

  const signalCount = clusteredMembers.length;
  // A signal with no sourceGroupKey stands alone — counted as its own
  // independent source; signals sharing a real key (same
  // thread/post/author context) count once for that key
  // (docs/M3_ARCHITECTURE_PROPOSAL.md §2, Part 13).
  const independentSourceCount = new Set(clusteredMembers.map((member) => member.sourceGroupKey ?? member.id)).size;
  const confidence = computeClusterConfidence(
    clusteredMembers.map((member) => member.qualityScore),
    independentSourceCount,
  );

  return signalClusterRepository.update(clusterId, { signalCount, independentSourceCount, confidence });
}
