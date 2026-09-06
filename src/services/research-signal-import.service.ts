import type { Signal, SignalCluster } from "@prisma/client";
import { buildRealWorldTag } from "../domain/real-world/reality.types.js";
import type { ExternalResearchSignalInput } from "../domain/signal/external-signal-input.js";
import { countRealIndependentSources } from "../domain/signal/real-evidence.js";
import { NotFoundError } from "../domain/shared/errors.js";
import type { RawSourceResult } from "../sources/research-source.js";
import { signalClusterRepository } from "../db/repositories/signal-cluster.repository.js";
import { signalRepository } from "../db/repositories/signal.repository.js";
import { agentService } from "./agent.service.js";
import { auditService } from "./audit.service.js";
import { MIN_INDEPENDENT_SOURCES_TO_PROMOTE } from "./problem-analyst.service.js";
import { signalClusteringService } from "./signal-clustering.service.js";
import { signalService } from "./signal.service.js";

export interface IngestExternalSignalsParams {
  readonly items: readonly ExternalResearchSignalInput[];
  readonly collectedByAgentId: string;
  /** Links accepted signals back to a RealWorldExperiment for later reporting — optional, never validated beyond being a plain string (mirrors OperatorWebSearchSource's own optional experimentId). */
  readonly experimentId?: string | null;
}

export interface RejectedSignalItem {
  readonly index: number;
  readonly reason: string;
}

export interface DuplicateSignalItem {
  readonly index: number;
  readonly signalId: string;
  readonly duplicateOfSignalId: string;
  readonly reason: string;
}

export interface IngestExternalSignalsResult {
  readonly acceptedSignalIds: string[];
  readonly duplicates: DuplicateSignalItem[];
  readonly rejected: RejectedSignalItem[];
  readonly touchedClusterIds: string[];
  readonly acceptedCount: number;
  readonly duplicateCount: number;
  readonly rejectedCount: number;
}

export interface ClusterRealEvidenceAssessment {
  readonly clusterId: string;
  readonly totalClusteredSignals: number;
  /** Independent sources counted WITHOUT regard to REAL/DEV_FIXTURE — signalClusteringService's own existing aggregate, read back unchanged for comparison. */
  readonly independentSourceCount: number;
  /** Independent sources counted from REAL-tagged signals only (countRealIndependentSources) — never inflated by DEV_FIXTURE/SIMULATED/untagged signals sharing this cluster. */
  readonly realIndependentSourceCount: number;
  readonly meetsRealEvidenceThreshold: boolean;
}

function buildRawSourceResult(item: ExternalResearchSignalInput, experimentId: string | null): RawSourceResult {
  const metadata: Record<string, unknown> = { externalReference: item.externalReference };
  // buildRealWorldTag refuses an empty note for REAL/HUMAN_ACTION — the one
  // place a caller's provenance claim is actually checked, not merely stored.
  if (item.reality !== "DEV_FIXTURE") {
    metadata.realWorld = buildRealWorldTag({ reality: item.reality, experimentId, note: item.provenanceNote });
  }
  return {
    title: item.title,
    content: item.content,
    url: item.url,
    publishedAt: item.observedAt,
    authorContext: item.authorContext,
    sourceGroupKey: item.source.group,
    metadata,
  };
}

/**
 * The governed ingestion boundary for externally observed research
 * (docs/RESEARCH_SIGNAL_INGESTION.md) — batching and structured
 * reporting are the ONLY new logic here. Every actual ingestion
 * decision (normalization, three-level deduplication, quality scoring,
 * source reliability, audit) is `signalService.ingest()` itself,
 * unmodified; every clustering decision (including independent-source
 * counting) is `signalClusteringService.assign()` itself, unmodified.
 * This never approves, sends, deploys, or spends anything — the only
 * two services it calls write Signal/SignalCluster rows and an audit
 * log entry, nothing else (docs/SECURITY.md). `assessClusterRealEvidence`
 * below is the one addition beyond ingestion itself — a read-only check,
 * not a new write path.
 */
export const researchSignalImportService = {
  async ingestBatch(params: IngestExternalSignalsParams): Promise<IngestExternalSignalsResult> {
    // One clear, upfront failure for a misconfigured caller rather than
    // the same "no such agent" rejection repeated once per item.
    await agentService.getAgentOrThrow(params.collectedByAgentId);
    const experimentId = params.experimentId ?? null;

    const acceptedSignalIds: string[] = [];
    const duplicates: DuplicateSignalItem[] = [];
    const rejected: RejectedSignalItem[] = [];
    const touchedClusterIds = new Set<string>();

    for (let index = 0; index < params.items.length; index += 1) {
      const item = params.items[index]!;
      try {
        if (!item.source.id.trim()) {
          rejected.push({ index, reason: "source.id is required — a signal can never claim provenance from an unnamed source." });
          continue;
        }

        const raw = buildRawSourceResult(item, experimentId);
        const signal: Signal = await signalService.ingest({
          source: item.source.id,
          sourceType: item.source.type,
          raw,
          collectedByAgentId: params.collectedByAgentId,
        });

        if (signal.status === "REJECTED") {
          rejected.push({ index, reason: "empty title or content." });
        } else if (signal.status === "DUPLICATE") {
          duplicates.push({
            index,
            signalId: signal.id,
            duplicateOfSignalId: signal.duplicateOfSignalId!,
            reason: signal.duplicateReason ?? "duplicate",
          });
        } else {
          const cluster: SignalCluster = await signalClusteringService.assign(signal.id);
          touchedClusterIds.add(cluster.id);
          acceptedSignalIds.push(signal.id);
        }
      } catch (err) {
        rejected.push({ index, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    await auditService.record({
      actorType: "AGENT",
      actorId: params.collectedByAgentId,
      action: "INGEST_RESEARCH_SIGNAL_BATCH",
      resourceType: "SIGNAL_BATCH",
      result: "SUCCESS",
      metadata: {
        itemCount: params.items.length,
        acceptedCount: acceptedSignalIds.length,
        duplicateCount: duplicates.length,
        rejectedCount: rejected.length,
        touchedClusterIds: [...touchedClusterIds],
        experimentId,
      },
    });

    return {
      acceptedSignalIds,
      duplicates,
      rejected,
      touchedClusterIds: [...touchedClusterIds],
      acceptedCount: acceptedSignalIds.length,
      duplicateCount: duplicates.length,
      rejectedCount: rejected.length,
    };
  },

  /**
   * Read-only. The operator-facing check for "does this cluster's REAL
   * evidence alone actually meet the promotion bar" — never trusts the
   * cluster's own reality-blind `independentSourceCount` (which counts
   * every clustered signal, REAL or not) when the question specifically
   * concerns REAL evidence. Reuses `problemAnalystService`'s own
   * threshold constant rather than a second copy. Intended to be run
   * BEFORE deciding to call `problemAnalystService.run()` on a cluster
   * that is meant to back a REAL-world claim.
   */
  async assessClusterRealEvidence(clusterId: string): Promise<ClusterRealEvidenceAssessment> {
    const cluster = await signalClusterRepository.findById(clusterId);
    if (!cluster) throw new NotFoundError("SignalCluster", clusterId);

    const clusteredSignals = (await signalRepository.listByCluster(clusterId)).filter((signal) => signal.status === "CLUSTERED");
    const realIndependentSourceCount = countRealIndependentSources(clusteredSignals);

    return {
      clusterId,
      totalClusteredSignals: clusteredSignals.length,
      independentSourceCount: cluster.independentSourceCount,
      realIndependentSourceCount,
      meetsRealEvidenceThreshold: realIndependentSourceCount >= MIN_INDEPENDENT_SOURCES_TO_PROMOTE,
    };
  },
};
