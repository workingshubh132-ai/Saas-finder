import type { Evidence } from "@prisma/client";
import { z } from "zod";
import { claimEvidenceRepository } from "../db/repositories/claim-evidence.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { signalRepository } from "../db/repositories/signal.repository.js";
import { validationReportRepository } from "../db/repositories/validation-report.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { CLAIM_EVIDENCE_RELATIONSHIPS, type ClaimEvidenceRelationship } from "../domain/claim/claim-evidence.types.js";
import { CLAIM_VALIDATION_STATUSES } from "../domain/claim/claim-validation.types.js";
import {
  computeQualityScore,
  DIRECTNESS_FACTOR,
  RELIABILITY_FACTOR,
  type EvidenceQualityAssessment,
} from "../domain/claim/evidence-quality.js";
import { computeRecencyScore } from "../domain/claim/freshness-policy.js";
import { classifyIndependence, type IndependenceInput } from "../domain/claim/independence.js";
import { specificityScore } from "../domain/signal/signal-quality.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import type { SearchToolOutput } from "../tools/source-search.tool.js";
import { toolRegistry } from "../tools/tool-registry.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { completeWithValidation } from "./model-output.js";
import { promoteSignalsToEvidence } from "./opportunity-analyst.service.js";
import { signalService } from "./signal.service.js";

const MODEL_MAX_OUTPUT_TOKENS = 1536;
const SEARCH_RESULTS_PER_QUERY = 5;
const SEARCH_QUERY_MAX_LENGTH = 200;

/**
 * Real tool calls allowed (docs/M4_ARCHITECTURE_PROPOSAL.md §2) —
 * unlike the CEO (§12, zero tool calls), the Evidence Validator
 * actively searches for counter-evidence. One structured-output model
 * call per claim, up to two counter-evidence searches.
 */
export const EVIDENCE_VALIDATOR_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 4,
  maxToolCalls: 2,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 20_000,
};

const evidenceClassificationSchema = z.object({
  evidenceId: z.string().min(1),
  relationship: z.enum(CLAIM_EVIDENCE_RELATIONSHIPS),
  reasoning: z.string().min(1),
});

const validationOutputSchema = z.object({
  status: z.enum(CLAIM_VALIDATION_STATUSES),
  confidence: z.number().min(0).max(1),
  classifications: z.array(evidenceClassificationSchema),
  reasoning: z.string().min(1),
  missingEvidence: z.array(z.string().min(1)),
  recommendedResearch: z.string().min(1),
  /** Is each SUPPORTING item saying something new, or repeating another in different words? (§8) */
  originality: z.number().min(0).max(1),
  /** How much should the (deterministically counted) supporting evidence actually be trusted? (§8) */
  corroborationStrength: z.number().min(0).max(1),
});
type ValidationOutput = z.infer<typeof validationOutputSchema>;

const EVIDENCE_VALIDATOR_SYSTEM_PROMPT =
  "You are the Evidence Validator for VentureForge (docs/M4_ARCHITECTURE_PROPOSAL.md §2). Your job is to actively " +
  "search for reasons ONE SPECIFIC CLAIM might be WRONG, not to summarize support for it — you are not another " +
  "opportunity generator. You are given a claim and a list of evidence items (some may be freshly searched " +
  "counter-evidence). For EACH evidence item, decide whether it SUPPORTS the claim, CONTRADICTS the claim, or its " +
  "bearing on this SPECIFIC claim is UNKNOWN/ambiguous — evidence relevant to the opportunity in general but silent " +
  "on this exact claim must be UNKNOWN, never SUPPORTING. Then form an overall judgment: UNVERIFIED (nothing bears " +
  "on it yet), SUPPORTED (credible support, no unresolved credible contradiction), WEAK (some support but thin, " +
  "low-quality, or low-independence), CONTRADICTED (credible contradiction outweighs support), CONFLICTED (both " +
  "sides credible and roughly balanced — do not force a tie-break), or INSUFFICIENT_EVIDENCE (a genuine pass found " +
  "close to nothing either way — this is an honest, valid outcome; never force SUPPORTED or CONTRADICTED to avoid " +
  "it). Never ignore or explain away contradicting evidence because it hurts the outcome — a credible contradiction " +
  "is reported even if you ultimately still lean SUPPORTED. Also assess: originality (is each item classified " +
  "SUPPORTING saying something NEW, or repeating another supporting item in different words?) and " +
  "corroborationStrength (given the supporting items you just classified, how much should that corroboration " +
  "actually be trusted — several weak, repetitive mentions deserve less than one strong, specific, independent " +
  "confirmation). List what evidence is still missing, and the single next research question that would most change " +
  "your assessment. " +
  'Respond with ONLY JSON matching: {"status": "UNVERIFIED"|"SUPPORTED"|"WEAK"|"CONTRADICTED"|"CONFLICTED"|' +
  '"INSUFFICIENT_EVIDENCE", "confidence": number, "classifications": [{"evidenceId": string, "relationship": ' +
  '"SUPPORTING"|"CONTRADICTING"|"UNKNOWN", "reasoning": string}], "reasoning": string, "missingEvidence": string[], ' +
  '"recommendedResearch": string, "originality": number, "corroborationStrength": number}';

export interface RunEvidenceValidatorParams {
  agentId: string;
  claimId: string;
  /** Bounded by the caller's DecisionCycle budget (docs/M4_ARCHITECTURE_PROPOSAL.md §25) — 0 skips search entirely and validates on existing evidence only. */
  maxSearches: number;
  startedBy: AuthenticatedActor;
}

export interface EvidenceValidatorResult {
  validationReportId: string;
  status: string;
  confidence: number;
}

interface EvidenceFactors {
  evidence: Evidence;
  reliability: number;
  directness: number;
  specificity: number;
  recency: number;
}

async function computeEvidenceFactors(evidence: Evidence, now: Date): Promise<EvidenceFactors> {
  const signal = evidence.signalId ? await signalRepository.findById(evidence.signalId) : null;
  const specificity = specificityScore(evidence.claim);
  const recency = computeRecencyScore(signal?.publishedAt ?? evidence.collectedAt, now);
  return {
    evidence,
    reliability: RELIABILITY_FACTOR[evidence.reliability] ?? 0,
    directness: DIRECTNESS_FACTOR[evidence.sourceType] ?? DIRECTNESS_FACTOR.OTHER ?? 0.3,
    specificity,
    recency,
  };
}

function buildValidationPrompt(claim: { claimType: string; statement: string; importance: string }, factors: readonly EvidenceFactors[]): string {
  const lines = factors.map(
    (f, i) =>
      `${i + 1}. [id=${f.evidence.id}] (reliability=${f.reliability.toFixed(2)}, directness=${f.directness.toFixed(2)}, specificity=${f.specificity.toFixed(2)}, recency=${f.recency.toFixed(2)}) ${f.evidence.claim} (source: ${f.evidence.source})`,
  );
  return [
    `Claim type: ${claim.claimType} (importance: ${claim.importance})`,
    `Claim statement: ${claim.statement}`,
    "",
    `Evidence items (${factors.length}) — the four factors shown per item are already computed deterministically; do not restate them, use them to inform your judgment:`,
    ...(lines.length > 0 ? lines : ["(no evidence available for this opportunity yet)"]),
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — a deterministic, keyword-and-number-driven
 * stand-in, never a static stub (same discipline as
 * buildDevChairmanFixture/buildDevOpportunityFixture). A supporting
 * item is one with acceptable reliability/confidence; a contradicting
 * item is one whose text carries a real negative-signal keyword —
 * genuinely input-driven, so a demo opportunity seeded with honest
 * negative evidence produces a genuine CONTRADICTED/CONFLICTED
 * outcome, never a scripted per-opportunity special case.
 */
const NEGATIVE_SIGNAL_KEYWORDS = [
  "wouldn't pay",
  "won't pay",
  "would not pay",
  "not worth",
  "too expensive",
  "failed",
  "churned",
  "abandoned",
  "stopped using",
  "doesn't work",
  "did not work",
  "no interest",
  "not interested",
];

function buildDevValidatorFixture(factors: readonly EvidenceFactors[]): ValidationOutput {
  const classifications = factors.map((f): z.infer<typeof evidenceClassificationSchema> => {
    const text = f.evidence.claim.toLowerCase();
    const negativeKeyword = NEGATIVE_SIGNAL_KEYWORDS.find((kw) => text.includes(kw));
    if (negativeKeyword) {
      return { evidenceId: f.evidence.id, relationship: "CONTRADICTING", reasoning: `[DEV FIXTURE] Evidence text contains negative signal "${negativeKeyword}".` };
    }
    if ((f.evidence.reliability === "MEDIUM" || f.evidence.reliability === "HIGH") && f.evidence.confidence >= 0.5) {
      return { evidenceId: f.evidence.id, relationship: "SUPPORTING", reasoning: `[DEV FIXTURE] Reliability=${f.evidence.reliability}, confidence=${f.evidence.confidence.toFixed(2)} clears the deterministic support bar.` };
    }
    return { evidenceId: f.evidence.id, relationship: "UNKNOWN", reasoning: "[DEV FIXTURE] Below the deterministic support bar and no negative keyword found — bearing on this specific claim is not clear." };
  });

  const supporting = classifications.filter((c) => c.relationship === "SUPPORTING");
  const contradicting = classifications.filter((c) => c.relationship === "CONTRADICTING");
  const supportingFactors = factors.filter((f) => supporting.some((c) => c.evidenceId === f.evidence.id));
  const avgSupportingConfidence = supportingFactors.length > 0 ? supportingFactors.reduce((sum, f) => sum + f.evidence.confidence, 0) / supportingFactors.length : 0;

  let status: ValidationOutput["status"];
  if (factors.length === 0 || (supporting.length === 0 && contradicting.length === 0)) {
    status = "INSUFFICIENT_EVIDENCE";
  } else if (contradicting.length > 0 && supporting.length === 0) {
    status = "CONTRADICTED";
  } else if (contradicting.length > 0 && supporting.length > 0) {
    status = "CONFLICTED";
  } else if (avgSupportingConfidence < 0.5) {
    status = "WEAK";
  } else {
    status = "SUPPORTED";
  }

  const confidence = status === "INSUFFICIENT_EVIDENCE" ? 0 : status === "CONTRADICTED" ? 0.1 : Math.min(0.85, avgSupportingConfidence);

  return {
    status,
    confidence,
    classifications,
    reasoning: `[DEV FIXTURE] Deterministic rule-based validation (no real model call): ${supporting.length} supporting, ${contradicting.length} contradicting, ${classifications.length - supporting.length - contradicting.length} unknown, out of ${factors.length} evidence item(s).`,
    missingEvidence: supporting.length === 0 ? ["Any direct, specific evidence bearing on this exact claim."] : [],
    recommendedResearch: "[DEV FIXTURE] Seek a genuinely independent, direct confirmation or refutation of this specific claim.",
    originality: supporting.length > 0 ? 0.5 : 0,
    corroborationStrength: Math.min(1, supporting.length / 3),
  };
}

/**
 * The Evidence Validator (docs/M4_ARCHITECTURE_PROPOSAL.md §2) —
 * genuinely adversarial, not another opportunity generator. Never
 * writes to Opportunity.status or Claim.status itself; its entire
 * output surface is one persisted ValidationReport (+ the ClaimEvidence
 * rows backing it). A separate, deterministic confidence-recalculation
 * step (claim-confidence.ts, §11) decides how this report changes the
 * Claim's own persisted status/confidence.
 */
export const evidenceValidatorService = {
  async run(params: RunEvidenceValidatorParams): Promise<RunOutcome<EvidenceValidatorResult>> {
    const claim = await claimRepository.findById(params.claimId);
    if (!claim) throw new NotFoundError("Claim", params.claimId);

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { claimId: params.claimId, claimType: claim.claimType },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        const existingEvidence = await opportunityRepository.listEvidence(claim.opportunityId);
        const evidencePool = new Map(existingEvidence.map((e) => [e.id, e] as const));

        if (params.maxSearches > 0) {
          const sourceIds = toolRegistry.list().map((tool) => tool.id);
          const query = claim.statement.slice(0, SEARCH_QUERY_MAX_LENGTH);
          for (let i = 0; i < params.maxSearches && sourceIds.length > 0; i += 1) {
            handle.step();
            const sourceId = sourceIds[i % sourceIds.length] as string;
            const output = (await handle.callTool(sourceId, { query, maxResults: SEARCH_RESULTS_PER_QUERY })) as SearchToolOutput;

            const newSignals = [];
            for (const raw of output.results) {
              const signal = await signalService.ingest({ source: sourceId, sourceType: "WEB", raw, collectedByAgentId: params.agentId });
              if (signal.status !== "DUPLICATE") newSignals.push(signal);
            }
            const newEvidence = await promoteSignalsToEvidence(newSignals, params.agentId);
            for (const item of newEvidence) {
              if (!evidencePool.has(item.id)) {
                await opportunityRepository.attachEvidence(claim.opportunityId, item.id);
                evidencePool.set(item.id, item);
              }
            }
          }
        }

        handle.step();
        const now = new Date();
        const factors = await Promise.all(Array.from(evidencePool.values()).map((e) => computeEvidenceFactors(e, now)));

        const { value: output, raw } = await completeWithValidation(handle.callModel, validationOutputSchema, {
          systemPrompt: EVIDENCE_VALIDATOR_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildValidationPrompt(claim, factors) }],
          devFixtureResponse: buildDevValidatorFixture(factors),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const factorById = new Map(factors.map((f) => [f.evidence.id, f] as const));
        const knownIds = new Set(factorById.keys());
        const classifiedIds = new Set(output.classifications.map((c) => c.evidenceId));
        const classifications = [
          ...output.classifications.filter((c) => knownIds.has(c.evidenceId)),
          ...Array.from(knownIds)
            .filter((id) => !classifiedIds.has(id))
            .map((id) => ({ evidenceId: id, relationship: "UNKNOWN" as ClaimEvidenceRelationship, reasoning: "Not explicitly classified by the Validator; defaulted to UNKNOWN." })),
        ];

        const supportingFactors = classifications.filter((c) => c.relationship === "SUPPORTING").map((c) => factorById.get(c.evidenceId)).filter((f): f is EvidenceFactors => f !== undefined);
        const contradictingIds = classifications.filter((c) => c.relationship === "CONTRADICTING").map((c) => c.evidenceId);
        const supportingIds = supportingFactors.map((f) => f.evidence.id);

        const independenceInputs: IndependenceInput[] = await Promise.all(
          supportingFactors.map(async (f): Promise<IndependenceInput> => {
            const signal = f.evidence.signalId ? await signalRepository.findById(f.evidence.signalId) : null;
            return { evidenceId: f.evidence.id, source: f.evidence.source, sourceType: f.evidence.sourceType, sourceGroupKey: signal?.sourceGroupKey ?? null };
          }),
        );
        const independence = classifyIndependence(independenceInputs);

        const avg = (values: number[]): number => (values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
        const qualityFactors = {
          reliability: avg(supportingFactors.map((f) => f.reliability)),
          directness: avg(supportingFactors.map((f) => f.directness)),
          specificity: avg(supportingFactors.map((f) => f.specificity)),
          recency: avg(supportingFactors.map((f) => f.recency)),
          independence: { KNOWN: 1, LIKELY: 0.6, UNKNOWN: 0.2 }[independence.level],
          originality: output.originality,
          corroboration: output.corroborationStrength,
        };
        const qualityAssessment: EvidenceQualityAssessment = {
          ...qualityFactors,
          qualityScore: computeQualityScore(qualityFactors),
          independenceLevel: independence.level,
        };

        const validationReport = await validationReportRepository.create({
          claimId: claim.id,
          status: output.status,
          confidence: output.confidence,
          supportingEvidenceIds: toJsonString(supportingIds),
          contradictingEvidenceIds: toJsonString(contradictingIds),
          independenceAssessment: toJsonString(independence),
          qualityAssessment: toJsonString(qualityAssessment),
          reasoning: output.reasoning,
          missingEvidence: toJsonString(output.missingEvidence),
          recommendedResearch: output.recommendedResearch,
          modelProvider: raw.provider,
          modelName: raw.model,
        });

        for (const c of classifications) {
          await claimEvidenceRepository.create({
            claimId: claim.id,
            evidenceId: c.evidenceId,
            relationship: c.relationship,
            reasoning: c.reasoning,
            validationReportId: validationReport.id,
          });
        }

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: `VALIDATION_REPORT_${output.status}`,
          resourceType: "CLAIM",
          resourceId: claim.id,
          result: "SUCCESS",
          metadata: { validationReportId: validationReport.id, supportingCount: supportingIds.length, contradictingCount: contradictingIds.length },
        });

        return { validationReportId: validationReport.id, status: validationReport.status, confidence: validationReport.confidence };
      },
      EVIDENCE_VALIDATOR_BUDGET,
    );
  },
};
