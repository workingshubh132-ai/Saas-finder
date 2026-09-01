import type { Signal } from "@prisma/client";
import { signalRepository, type CreateSignalInput } from "../db/repositories/signal.repository.js";
import { computeContentHash } from "../domain/signal/content-hash.js";
import { textSimilarity } from "../domain/signal/similarity.js";
import { computeSignalQualityScore } from "../domain/signal/signal-quality.js";
import { getSourceReliability } from "../domain/evidence/source-reliability-policy.js";
import { isSignalSourceType, isSignalStatus, SIGNAL_STATUS_TRANSITIONS, type SignalStatus } from "../domain/signal/signal.types.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import type { RawSourceResult } from "../sources/research-source.js";
import { agentService } from "./agent.service.js";
import { auditService } from "./audit.service.js";

/** Above this Jaccard similarity, two signals from the same source are
 *  treated as the same underlying content, not two independent ones
 *  (docs/M3_ARCHITECTURE_PROPOSAL.md §5). */
const NEAR_DUPLICATE_THRESHOLD = 0.85;
/** Bounded comparison window — Part 45's "avoid N x M x K explosions":
 *  dedup/near-dup checks compare against recent signals, never the
 *  whole table. */
const RECENT_COMPARISON_WINDOW = 200;

export interface IngestSignalParams {
  source: string;
  sourceType: string;
  raw: RawSourceResult;
  collectedByAgentId: string;
}

type BaseFields = Omit<CreateSignalInput, "qualityScore" | "status" | "duplicateOfSignalId" | "duplicateReason">;

function assertReachable(toStatus: SignalStatus): SignalStatus {
  assertTransition("Signal", SIGNAL_STATUS_TRANSITIONS, "NEW", toStatus);
  return toStatus;
}

/**
 * signalService.ingest() — the single path from a source adapter's
 * raw result to a normalized Signal row: normalization, three-level
 * deduplication, and deterministic quality scoring, all in one
 * synchronous pass (docs/M3_ARCHITECTURE_PROPOSAL.md §4, §5, §10).
 * Every dedup decision is explainable (`duplicateReason`), and a
 * duplicate never inflates a cluster's counts — signalClusteringService
 * only ever considers non-duplicate signals.
 */
export const signalService = {
  async ingest(params: IngestSignalParams): Promise<Signal> {
    if (!isSignalSourceType(params.sourceType)) {
      throw new ValidationError(`Unknown signal source type: ${params.sourceType}`);
    }
    await agentService.getAgentOrThrow(params.collectedByAgentId);

    const title = params.raw.title.trim();
    const content = params.raw.content.trim();
    const contentHash = computeContentHash(title, content);
    const publishedAt = params.raw.publishedAt ? new Date(params.raw.publishedAt) : null;
    const reliability = getSourceReliability(params.source);

    const base: BaseFields = {
      source: params.source,
      sourceType: params.sourceType,
      // Never fabricates a URL-looking value when a source has none —
      // an unambiguous non-URL internal reference instead.
      sourceReference: params.raw.url ?? `no-url:${params.source}:${contentHash}`,
      title: title || "(untitled)",
      content,
      collectedByAgentId: params.collectedByAgentId,
      publishedAt,
      authorContext: params.raw.authorContext,
      language: "en",
      contentHash,
      sourceGroupKey: params.raw.sourceGroupKey,
      metadata: toJsonString(params.raw.metadata),
      reliability,
    };

    if (!title || !content) {
      return signalRepository.create({
        ...base,
        qualityScore: 0,
        status: assertReachable("REJECTED"),
        duplicateOfSignalId: null,
        duplicateReason: null,
      });
    }

    const exactDuplicate = await signalRepository.findByContentHash(contentHash);
    if (exactDuplicate) {
      return createDuplicate(base, exactDuplicate.id, "identical content hash");
    }

    if (params.raw.url) {
      const repost = await signalRepository.findBySourceReference(params.raw.url);
      if (repost) {
        return createDuplicate(base, repost.id, "same source reference already ingested");
      }
    }

    const recentComparable = await signalRepository.listRecentComparable(params.source, RECENT_COMPARISON_WINDOW);
    for (const candidate of recentComparable) {
      const similarity = textSimilarity(content, candidate.content);
      if (similarity >= NEAR_DUPLICATE_THRESHOLD) {
        return createDuplicate(base, candidate.id, `near-duplicate content (similarity ${similarity.toFixed(2)})`);
      }
    }

    const qualityScore = computeSignalQualityScore({ content, reliability, publishedAt });
    const signal = await signalRepository.create({
      ...base,
      qualityScore,
      status: assertReachable("PROCESSED"),
      duplicateOfSignalId: null,
      duplicateReason: null,
    });

    await auditService.record({
      actorType: "AGENT",
      actorId: params.collectedByAgentId,
      action: "INGEST_SIGNAL",
      resourceType: "SIGNAL",
      resourceId: signal.id,
      result: "SUCCESS",
      metadata: { source: params.source, qualityScore },
    });

    return signal;
  },

  async getOrThrow(id: string): Promise<Signal> {
    const signal = await signalRepository.findById(id);
    if (!signal) throw new NotFoundError("Signal", id);
    return signal;
  },

  list: signalRepository.list,
  listByCluster: signalRepository.listByCluster,

  /** Only signalClusteringService calls this — the one legal path from PROCESSED to CLUSTERED. */
  async markClustered(id: string, clusterId: string): Promise<Signal> {
    const signal = await signalService.getOrThrow(id);
    if (!isSignalStatus(signal.status)) {
      throw new ValidationError(`Corrupt stored status on signal ${signal.id}: ${signal.status}`);
    }
    assertTransition("Signal", SIGNAL_STATUS_TRANSITIONS, signal.status, "CLUSTERED");
    return signalRepository.update(id, { status: "CLUSTERED", clusterId });
  },

  async archive(id: string): Promise<Signal> {
    const signal = await signalService.getOrThrow(id);
    if (!isSignalStatus(signal.status)) {
      throw new ValidationError(`Corrupt stored status on signal ${signal.id}: ${signal.status}`);
    }
    assertTransition("Signal", SIGNAL_STATUS_TRANSITIONS, signal.status, "ARCHIVED");
    return signalRepository.update(id, { status: "ARCHIVED" });
  },
};

async function createDuplicate(base: BaseFields, duplicateOfSignalId: string, reason: string): Promise<Signal> {
  const signal = await signalRepository.create({
    ...base,
    qualityScore: 0,
    status: assertReachable("DUPLICATE"),
    duplicateOfSignalId,
    duplicateReason: reason,
  });
  await auditService.record({
    actorType: "AGENT",
    actorId: base.collectedByAgentId,
    action: "INGEST_SIGNAL",
    resourceType: "SIGNAL",
    resourceId: signal.id,
    result: "SUCCESS",
    metadata: { duplicate: true, duplicateOfSignalId, reason },
  });
  return signal;
}
