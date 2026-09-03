import type { Claim, ProductSpec, ValidationReport } from "@prisma/client";
import { z } from "zod";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { featureRepository } from "../db/repositories/feature.repository.js";
import { opportunityRepository } from "../db/repositories/opportunity.repository.js";
import { productRepository } from "../db/repositories/product.repository.js";
import { productSpecRepository } from "../db/repositories/product-spec.repository.js";
import { validationReportRepository } from "../db/repositories/validation-report.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { computeFeaturePriority } from "../domain/product/feature-priority.js";
import { isClaimImportance } from "../domain/claim/claim.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";
import { completeWithValidation } from "./model-output.js";

const MODEL_MAX_OUTPUT_TOKENS = 1536;

/**
 * Zero tool calls (docs/M6_ARCHITECTURE_PROPOSAL.md §5) — pure
 * synthesis over an opportunity's own already-persisted claims and
 * evidence, the same shape ceoReasoningService/icpAnalystService
 * already use for genuine judgment over existing facts.
 */
export const PRODUCT_STRATEGIST_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const candidateFeatureSchema = z.object({
  description: z.string().min(1),
  problemAddressed: z.string().min(1),
  /** A real claim id from the list provided — never invented (§4-5). */
  claimId: z.string().min(1),
  /** Real Evidence ids from the list provided — may be empty if the cited claim has no supporting evidence attached yet. */
  evidenceIds: z.array(z.string()),
  expectedLearning: z.string().min(1),
  customerValue: z.number().min(0).max(1),
  learningValue: z.number().min(0).max(1),
  implementationCost: z.number().min(0).max(1),
  technicalRisk: z.number().min(0).max(1),
});

const strategistOutputSchema = z.object({
  productThesis: z.string().min(1),
  targetCustomer: z.string().min(1),
  coreProblem: z.string().min(1),
  coreJobToBeDone: z.string().min(1),
  proposedSolution: z.string().min(1),
  primaryWorkflow: z.string().min(1),
  successMetric: z.string().min(1),
  mvpBoundary: z.string().min(1),
  /** Never empty (§4) — a spec with no stated non-goal is refused downstream. */
  nonGoals: z.array(z.string().min(1)).min(1),
  knownRisks: z.array(z.string()),
  unknowns: z.array(z.string()),
  openQuestions: z.array(z.string()),
  /** Never empty (§5) — every important product assumption must cite a real claim. */
  groundedInClaimIds: z.array(z.string().min(1)).min(1),
  candidateFeatures: z.array(candidateFeatureSchema),
});
type StrategistOutput = z.infer<typeof strategistOutputSchema>;

const PRODUCT_STRATEGIST_SYSTEM_PROMPT =
  "You are the Product Strategist for VentureForge (docs/M6_ARCHITECTURE_PROPOSAL.md §5). Translate validated " +
  "customer evidence into a NARROWLY SCOPED product thesis for the smallest technically credible product that can " +
  "test the validated business thesis — never the maximum-features product. You are given the opportunity's own " +
  "claims (with status/confidence) and evidence — you MUST NOT invent customer evidence; every important " +
  "assumption (targetCustomer, coreProblem, mvpBoundary) must be grounded in a real claim id from the list given, " +
  "reported in groundedInClaimIds. Produce: productThesis, targetCustomer, coreProblem, coreJobToBeDone, " +
  "proposedSolution, primaryWorkflow, successMetric, mvpBoundary (the single workflow this MVP will actually " +
  "prove), nonGoals (never empty — explicit things this MVP deliberately will NOT do), knownRisks, unknowns, " +
  "openQuestions. Also propose a SMALL list of candidate features (rarely more than 3-5) — for each: description, " +
  "problemAddressed, the real claimId it tests, real evidenceIds supporting it (may be empty), expectedLearning, " +
  "and four 0..1 scores (customerValue, learningValue, implementationCost, technicalRisk) — these scores feed a " +
  "DETERMINISTIC prioritization formula downstream, not your own judgment about priority. A feature with no clear " +
  "reason should not be proposed at all. " +
  'Respond with ONLY JSON matching: {"productThesis": string, "targetCustomer": string, "coreProblem": string, ' +
  '"coreJobToBeDone": string, "proposedSolution": string, "primaryWorkflow": string, "successMetric": string, ' +
  '"mvpBoundary": string, "nonGoals": string[], "knownRisks": string[], "unknowns": string[], "openQuestions": ' +
  'string[], "groundedInClaimIds": string[], "candidateFeatures": [{"description": string, "problemAddressed": ' +
  'string, "claimId": string, "evidenceIds": string[], "expectedLearning": string, "customerValue": number, ' +
  '"learningValue": number, "implementationCost": number, "technicalRisk": number}]}';

export interface RunProductStrategistParams {
  agentId: string;
  productId: string;
  startedBy: AuthenticatedActor;
}

export interface ProductStrategistResult {
  productSpec: ProductSpec;
  featureCount: number;
}

function buildStrategistPrompt(opportunity: { title: string; problem: string; targetCustomer: string; description: string }, claims: readonly Claim[], evidence: readonly { id: string; claim: string; sourceType: string }[]): string {
  const claimLines = claims.map((c) => `- [id=${c.id}] [${c.claimType}] importance=${c.importance} status=${c.status} confidence=${c.confidence.toFixed(2)}: ${c.statement}`);
  const evidenceLines = evidence.slice(0, 20).map((e) => `- [id=${e.id}] (${e.sourceType}): ${e.claim}`);
  return [
    `Opportunity: ${opportunity.title}`,
    `Problem (as originally framed): ${opportunity.problem}`,
    `Target customer (as originally framed): ${opportunity.targetCustomer}`,
    `Description: ${opportunity.description}`,
    "",
    `Claims (${claims.length}):`,
    ...(claimLines.length > 0 ? claimLines : ["(none extracted yet)"]),
    "",
    `Evidence (${evidence.length}${evidence.length > 20 ? ", showing first 20" : ""}):`,
    ...(evidenceLines.length > 0 ? evidenceLines : ["(none collected yet)"]),
  ].join("\n");
}

const DEFAULT_NON_GOALS = ["Multi-user team collaboration", "Payment processing / billing", "Third-party integrations beyond the core workflow"];

/**
 * DEVELOPMENT ONLY — a genuinely input-driven stand-in, never a static
 * stub (same discipline as buildDevIcpFixture): targetCustomer/
 * coreProblem are derived from the opportunity's own real
 * CUSTOMER_SEGMENT/CUSTOMER_PROBLEM claims when SUPPORTED, falling
 * back to the opportunity's own targetCustomer/problem text otherwise
 * — never invented. Exactly one candidate feature is proposed, testing
 * the highest-importance, lowest-confidence real claim (the honest
 * "what would teach us the most" choice), so a genuinely small MVP —
 * never a padded feature list.
 */
function buildDevStrategistFixture(opportunity: { title: string; problem: string; targetCustomer: string; description: string }, claims: readonly Claim[]): StrategistOutput {
  const byType = (type: string): Claim | undefined => claims.find((c) => c.claimType === type);
  const segmentClaim = byType("CUSTOMER_SEGMENT");
  const problemClaim = byType("CUSTOMER_PROBLEM");
  const wtpClaim = byType("WILLINGNESS_TO_PAY");

  const targetCustomer = segmentClaim && segmentClaim.status === "SUPPORTED" ? segmentClaim.statement : opportunity.targetCustomer;
  const coreProblem = problemClaim && problemClaim.status === "SUPPORTED" ? problemClaim.statement : opportunity.problem;

  const groundedInClaimIds = [segmentClaim?.id, problemClaim?.id, wtpClaim?.id].filter((id): id is string => id !== undefined);
  const fallbackClaimId = groundedInClaimIds[0] ?? claims[0]?.id;
  if (!fallbackClaimId) {
    throw new ValidationError("Cannot produce a product thesis for an opportunity with no claims — run claim extraction first.");
  }

  const sortedByLearningValue = [...claims].sort((a, b) => {
    const aWeight = isClaimImportance(a.importance) ? { CRITICAL: 1, HIGH: 0.7, MEDIUM: 0.4, LOW: 0.2 }[a.importance] : 0;
    const bWeight = isClaimImportance(b.importance) ? { CRITICAL: 1, HIGH: 0.7, MEDIUM: 0.4, LOW: 0.2 }[b.importance] : 0;
    return bWeight * (1 - b.confidence) - aWeight * (1 - a.confidence);
  });
  const targetClaim = sortedByLearningValue[0] ?? claims[0];
  if (!targetClaim) throw new ValidationError("Cannot propose a candidate feature with no claims at all.");

  return {
    productThesis: `${targetCustomer} experience "${coreProblem}" — ${opportunity.description}`,
    targetCustomer,
    coreProblem,
    coreJobToBeDone: `Help ${targetCustomer} resolve: ${coreProblem}`,
    proposedSolution: opportunity.description,
    primaryWorkflow: `A single core workflow addressing: ${coreProblem}`,
    successMetric: wtpClaim && wtpClaim.status === "SUPPORTED" ? "Conversion to a real paid or committed action" : "Primary workflow completion rate",
    mvpBoundary: `Only the single workflow described above — nothing else.`,
    nonGoals: DEFAULT_NON_GOALS,
    knownRisks: claims.filter((c) => c.status === "CONTRADICTED" || c.status === "WEAK" || c.status === "CONFLICTED").map((c) => `[${c.claimType}] ${c.statement}`),
    unknowns: claims.filter((c) => c.status === "UNVERIFIED").map((c) => `[${c.claimType}] not yet validated: ${c.statement}`),
    openQuestions: ["What is the minimal real data needed to demonstrate the core workflow end-to-end?"],
    groundedInClaimIds,
    candidateFeatures: [
      {
        description: `Implement the core workflow: ${targetClaim.statement}`,
        problemAddressed: coreProblem,
        claimId: targetClaim.id,
        evidenceIds: [],
        expectedLearning: `Whether real use of this workflow moves claim [${targetClaim.claimType}] toward SUPPORTED or CONTRADICTED.`,
        customerValue: 0.8,
        learningValue: 0.8,
        implementationCost: 0.3,
        technicalRisk: 0.2,
      },
    ],
  };
}

export const productStrategistService = {
  async run(params: RunProductStrategistParams): Promise<RunOutcome<ProductStrategistResult>> {
    const product = await productRepository.findById(params.productId);
    if (!product) throw new NotFoundError("Product", params.productId);
    if (product.status !== "APPROVED" && product.status !== "SPECIFYING") {
      throw new ValidationError(`Product ${product.id} is not APPROVED (status: ${product.status}) — the Human Owner must approve a build attempt before the Product Strategist may run.`);
    }
    const opportunity = await opportunityRepository.findById(product.opportunityId);
    if (!opportunity) throw new NotFoundError("Opportunity", product.opportunityId);

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { productId: params.productId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const claims = await claimRepository.listForOpportunity(product.opportunityId);
        const opportunityEvidence = await opportunityRepository.listEvidence(product.opportunityId);
        const validClaimIds = new Set(claims.map((c) => c.id));
        const validEvidenceIds = new Set(opportunityEvidence.map((e) => e.id));

        const { value: output } = await completeWithValidation(handle.callModel, strategistOutputSchema, {
          systemPrompt: PRODUCT_STRATEGIST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildStrategistPrompt(opportunity, claims, opportunityEvidence) }],
          devFixtureResponse: buildDevStrategistFixture(opportunity, claims),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        // Never trust the model's own citation on faith (§5) — every grounded claim id must be real and belong to this opportunity.
        const groundedClaimIds = output.groundedInClaimIds.filter((id) => validClaimIds.has(id));
        if (groundedClaimIds.length === 0) {
          throw new ValidationError("Product Strategist produced no real, verifiable claim citations — refusing to persist an ungrounded thesis.");
        }
        const groundedEvidenceIds = Array.from(new Set(output.candidateFeatures.flatMap((f) => f.evidenceIds))).filter((id) => validEvidenceIds.has(id));

        const productSpec = await productSpecRepository.create({
          productId: product.id,
          name: opportunity.title,
          targetCustomer: output.targetCustomer,
          coreProblem: output.coreProblem,
          coreWorkflow: output.primaryWorkflow,
          content: toJsonString({
            productThesis: output.productThesis,
            coreJobToBeDone: output.coreJobToBeDone,
            proposedSolution: output.proposedSolution,
            successMetric: output.successMetric,
            mvpBoundary: output.mvpBoundary,
            knownRisks: output.knownRisks,
            unknowns: output.unknowns,
            openQuestions: output.openQuestions,
          }),
          nonGoals: toJsonString(output.nonGoals),
          groundedInClaimIds: toJsonString(groundedClaimIds),
          groundedInEvidenceIds: toJsonString(groundedEvidenceIds),
          generatedByAgentId: params.agentId,
        });

        let featureCount = 0;
        const latestReportByClaimId = new Map<string, ValidationReport>();
        for (const candidate of output.candidateFeatures) {
          if (!validClaimIds.has(candidate.claimId)) continue; // Never trust a fabricated claim id (§5).
          const claim = claims.find((c) => c.id === candidate.claimId);
          if (!claim) continue;
          if (!latestReportByClaimId.has(candidate.claimId)) {
            const report = await validationReportRepository.findLatestForClaim(candidate.claimId);
            if (report) latestReportByClaimId.set(candidate.claimId, report);
          }
          const evidenceIds = candidate.evidenceIds.filter((id) => validEvidenceIds.has(id));

          const priority = computeFeaturePriority({
            hasCitation: true,
            claimImportance: isClaimImportance(claim.importance) ? claim.importance : null,
            customerValue: candidate.customerValue,
            learningValue: candidate.learningValue,
            implementationCost: candidate.implementationCost,
            technicalRisk: candidate.technicalRisk,
          });

          await featureRepository.create({
            productSpecId: productSpec.id,
            description: candidate.description,
            problemAddressed: candidate.problemAddressed,
            claimId: candidate.claimId,
            evidenceIds: toJsonString(evidenceIds),
            expectedLearning: candidate.expectedLearning,
            customerValue: candidate.customerValue,
            learningValue: candidate.learningValue,
            implementationCost: candidate.implementationCost,
            technicalRisk: candidate.technicalRisk,
            score: priority.score,
            priority: priority.priority,
            reasoning: priority.reasoning,
          });
          featureCount += 1;
        }

        await auditService.record({
          actorType: "AGENT",
          actorId: params.agentId,
          action: "CREATE_PRODUCT_SPEC",
          resourceType: "PRODUCT",
          resourceId: product.id,
          result: "SUCCESS",
          metadata: { productSpecId: productSpec.id, featureCount },
        });
        await eventBus.publish({ type: "PRODUCT_SPEC_CREATED", payload: { productSpecId: productSpec.id, productId: product.id, featureCount } });

        return { productSpec, featureCount };
      },
      PRODUCT_STRATEGIST_BUDGET,
    );
  },
};
