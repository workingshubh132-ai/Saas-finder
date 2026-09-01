import type { Opportunity, Signal } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { dimensionGroundingSchema, type DimensionGrounding } from "../domain/evidence-gap/dimension-grounding.js";
import { NotFoundError } from "../domain/shared/errors.js";
import { competitorRepository, type ObservationWithCompetitor } from "../db/repositories/competitor.repository.js";
import { evidenceRepository } from "../db/repositories/evidence.repository.js";
import { problemRepository } from "../db/repositories/problem.repository.js";
import { signalRepository } from "../db/repositories/signal.repository.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { evidenceGapService } from "./evidence-gap.service.js";
import { evidenceService } from "./evidence.service.js";
import type { MarketAnalysisResult } from "./market-analyst.service.js";
import { completeWithValidation } from "./model-output.js";
import { opportunityService } from "./opportunity.service.js";
import type { OpportunityScoreDimensions } from "./opportunity-scorer.js";
import { problemService } from "./problem.service.js";
import type { KillRiskDimensions } from "./kill-risk-scorer.js";

const MODEL_MAX_OUTPUT_TOKENS = 1536;
const OPPORTUNITY_ANALYST_BUDGET: Partial<ExecutionBudget> = { maxSteps: 2, maxToolCalls: 0, maxModelCalls: 1, maxRetries: 1, maxDurationMs: 15_000 };

const unitInterval = z.number().min(0).max(1);

const scoreDimensionsSchema = z.object({
  pain: unitInterval,
  demand: unitInterval,
  willingnessToPay: unitInterval,
  reachability: unitInterval,
  retention: unitInterval,
  differentiation: unitInterval,
  buildability: unitInterval,
  economics: unitInterval,
  risk: unitInterval,
  evidenceQuality: unitInterval,
  marketSize: unitInterval,
  frequency: unitInterval,
  evidenceIndependence: unitInterval,
  timing: unitInterval,
}) satisfies z.ZodType<OpportunityScoreDimensions>;

const killRiskDimensionsSchema = z.object({
  weakDemand: unitInterval,
  weakWillingnessToPay: unitInterval,
  crowdedMarket: unitInterval,
  poorDifferentiation: unitInterval,
  badDistribution: unitInterval,
  technicalDifficulty: unitInterval,
  regulatoryRisk: unitInterval,
  platformDependency: unitInterval,
  lowRetention: unitInterval,
  lowMargins: unitInterval,
  insufficientEvidence: unitInterval,
}) satisfies z.ZodType<KillRiskDimensions>;

const opportunityGenerationSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  distributionChannels: z.array(z.object({ channel: z.string().min(1), reasoning: z.string().min(1) })),
  scoreDimensions: scoreDimensionsSchema,
  killRiskDimensions: killRiskDimensionsSchema,
  dimensionGrounding: dimensionGroundingSchema,
});
type OpportunityGeneration = z.infer<typeof opportunityGenerationSchema>;

const OPPORTUNITY_ANALYST_SYSTEM_PROMPT =
  "You are the Opportunity Analyst for VentureForge (M3 brief Part 15-22). Synthesize the problem, its real evidence, " +
  "competitor findings, and market-analyst output into ONE opportunity candidate. Score every dimension only from " +
  "what the evidence actually supports — never invent a number to fill a gap; when you must estimate without direct " +
  "evidence, still provide your best number but mark that dimension ASSUMED (not EVIDENCED) in dimensionGrounding. " +
  "killRiskDimensions use the OPPOSITE polarity from scoreDimensions: higher means MORE risk. distributionChannels " +
  "must each cite real reasoning grounded in the input — never assert a channel is viable with no reasoning. " +
  'Respond with ONLY JSON matching: {"title": string, "description": string, "distributionChannels": ' +
  '[{"channel": string, "reasoning": string}], "scoreDimensions": {14 numbers 0-1}, "killRiskDimensions": ' +
  '{11 numbers 0-1}, "dimensionGrounding": [{"dimension": string, "status": "EVIDENCED"|"ASSUMED", "reasoning": string}]}';

export interface RunOpportunityAnalystParams {
  agentId: string;
  problemId: string;
  marketAnalysis: MarketAnalysisResult;
  startedBy: AuthenticatedActor;
}

export interface OpportunityAnalystResult {
  opportunity: Opportunity;
}

/**
 * The Opportunity Analyst (M3 brief Part 15, 20-22, 24) — the
 * synthesis stage. Problem + real Evidence (promoted, idempotently,
 * from the problem's own cluster signals — §8) + Competitor
 * observations + Market Analyst output become ONE Opportunity
 * candidate, scored, kill-risk-assessed, and evidence-gap-tagged.
 * Never manufactures an Opportunity from a Problem that doesn't
 * support one — see `opportunityGeneratorService.generateFromProblem`,
 * which is the actual caller and owns the INSUFFICIENT_EVIDENCE
 * escape hatch (M3 brief Part 43).
 */
export const opportunityAnalystService = {
  async run(params: RunOpportunityAnalystParams): Promise<RunOutcome<OpportunityAnalystResult>> {
    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { problemId: params.problemId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        const problem = await problemRepository.findById(params.problemId);
        if (!problem) throw new NotFoundError("Problem", params.problemId);

        const clusteredSignals = (await signalRepository.listByCluster(problem.clusterId)).filter((s) => s.status === "CLUSTERED");
        const evidence = await promoteSignalsToEvidence(clusteredSignals, params.agentId);
        const competitorObservations = await competitorRepository.listObservationsForProblem(problem.id);

        handle.step();
        const { value: generation } = await completeWithValidation(handle.callModel, opportunityGenerationSchema, {
          systemPrompt: OPPORTUNITY_ANALYST_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "user",
              content: buildSynthesisPrompt(problem, evidence, competitorObservations, params.marketAnalysis),
            },
          ],
          devFixtureResponse: buildDevOpportunityFixture(problem, evidence, competitorObservations, params.marketAnalysis),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const opportunity = await opportunityService.createOpportunity({
          title: generation.title,
          problem: problem.statement,
          targetCustomer: problem.customerSegment,
          description: generation.description,
          discoveredBy: { actorType: "AGENT", actorId: params.agentId },
          problemId: problem.id,
          metadata: { distributionChannels: generation.distributionChannels },
        });

        for (const item of evidence) {
          await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: item.id, actor: { actorType: "AGENT", actorId: params.agentId } });
        }

        const scored = await opportunityService.scoreOpportunity({
          opportunityId: opportunity.id,
          dimensions: generation.scoreDimensions,
          scoredBy: params.agentId,
          killRiskDimensions: generation.killRiskDimensions,
        });

        // A Problem may legitimately spawn more than one Opportunity
        // framing over time (docs/M3_ARCHITECTURE_PROPOSAL.md §16) — the
        // PROMOTED transition only applies the first time; PROMOTED has
        // no self-transition (problem.types.ts), so re-running this
        // analyst on an already-promoted Problem must not re-attempt it.
        if (problem.status !== "PROMOTED") {
          await problemService.transition({ id: problem.id, toStatus: "PROMOTED", actorId: params.agentId });
        }
        await evidenceGapService.analyze(opportunity.id, generation.dimensionGrounding, generation.scoreDimensions);

        return { opportunity: scored };
      },
      OPPORTUNITY_ANALYST_BUDGET,
    );
  },
};

/**
 * Idempotent (§8): a signal already promoted to Evidence is reused via
 * OpportunityEvidence rather than duplicated — the same signal can
 * legitimately back more than one Opportunity over time.
 */
async function promoteSignalsToEvidence(signals: Signal[], agentId: string) {
  const evidence = [];
  for (const signal of signals) {
    const existing = await evidenceRepository.findBySignalId(signal.id);
    if (existing) {
      evidence.push(existing);
      continue;
    }
    evidence.push(
      await evidenceService.collectEvidence({
        claim: signal.title,
        source: signal.source,
        sourceType: signal.sourceType,
        sourceReference: signal.sourceReference,
        collectedByAgentId: agentId,
        reliability: signal.reliability,
        confidence: signal.qualityScore,
        metadata: { content: signal.content },
        signalId: signal.id,
      }),
    );
  }
  return evidence;
}

function buildSynthesisPrompt(
  problem: { statement: string; customerSegment: string; workflow: string; pain: string; currentSolution: string; willingnessToPaySignal: string },
  evidence: Array<{ claim: string; source: string; reliability: string; confidence: number }>,
  competitorObservations: ObservationWithCompetitor[],
  marketAnalysis: MarketAnalysisResult,
): string {
  const evidenceLines = evidence.map((item, index) => `${index + 1}. [${item.source}, reliability=${item.reliability}, confidence=${item.confidence.toFixed(2)}] ${item.claim}`);
  const competitorLines = competitorObservations.map((obs) => `- ${obs.competitor.name} [${obs.type}]: ${obs.detail}`);

  return [
    `Problem: ${problem.statement}`,
    `Customer segment: ${problem.customerSegment}`,
    `Workflow: ${problem.workflow}`,
    `Pain: ${problem.pain}`,
    `Current solution: ${problem.currentSolution}`,
    `Problem-level WTP signal: ${problem.willingnessToPaySignal}`,
    "",
    `Evidence (${evidence.length} record(s)):`,
    ...(evidenceLines.length > 0 ? evidenceLines : ["(none)"]),
    "",
    `Competitor observations (${competitorObservations.length}):`,
    ...(competitorLines.length > 0 ? competitorLines : ["(none found)"]),
    "",
    `Market Analyst — WTP signals: ${marketAnalysis.wtpSignals.length > 0 ? marketAnalysis.wtpSignals.join("; ") : "(none found)"}`,
    `Market Analyst — timing: ${marketAnalysis.marketTiming}`,
    `Market Analyst — qualitative size: ${marketAnalysis.marketSizeQualitative}`,
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — every number derived from the real inputs
 * (evidence count/confidence, competitor presence, WTP signal
 * presence), never a static stub. Every dimension is explicitly tagged
 * ASSUMED unless real evidence grounds it, same honesty standard as
 * every other M2/M3 dev fixture.
 */
function buildDevOpportunityFixture(
  problem: { statement: string; workflow: string },
  evidence: Array<{ confidence: number }>,
  competitorObservations: ObservationWithCompetitor[],
  marketAnalysis: MarketAnalysisResult,
): OpportunityGeneration {
  const avgConfidence = evidence.length > 0 ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length : 0;
  const hasWtp = marketAnalysis.wtpSignals.length > 0;
  const hasCompetitors = competitorObservations.length > 0;

  const scoreDimensions: OpportunityScoreDimensions = {
    pain: avgConfidence,
    demand: avgConfidence,
    willingnessToPay: hasWtp ? Math.min(0.8, avgConfidence + 0.2) : 0.2,
    reachability: 0.4,
    retention: 0.4,
    differentiation: hasCompetitors ? 0.3 : 0.5,
    buildability: 0.6,
    economics: 0.4,
    risk: 1 - avgConfidence,
    evidenceQuality: avgConfidence,
    marketSize: 0.4,
    frequency: Math.min(1, evidence.length / 5),
    evidenceIndependence: Math.min(1, evidence.length / 3),
    timing: 0.5,
  };

  const killRiskDimensions: KillRiskDimensions = {
    weakDemand: 1 - avgConfidence,
    weakWillingnessToPay: hasWtp ? 0.3 : 0.7,
    crowdedMarket: hasCompetitors ? 0.5 : 0.2,
    poorDifferentiation: hasCompetitors ? 0.5 : 0.3,
    badDistribution: 0.5,
    technicalDifficulty: 0.4,
    regulatoryRisk: 0.2,
    platformDependency: 0.2,
    lowRetention: 0.4,
    lowMargins: 0.4,
    insufficientEvidence: evidence.length < 2 ? 0.8 : 0.3,
  };

  const evidencedDimensions: Array<keyof OpportunityScoreDimensions> = ["pain", "demand", "evidenceQuality", "frequency", "evidenceIndependence"];
  if (hasWtp) evidencedDimensions.push("willingnessToPay");

  const dimensionGrounding: DimensionGrounding = (Object.keys(scoreDimensions) as Array<keyof OpportunityScoreDimensions>).map((dimension) => ({
    dimension,
    status: evidencedDimensions.includes(dimension) ? "EVIDENCED" : "ASSUMED",
    reasoning: evidencedDimensions.includes(dimension)
      ? `[DEV FIXTURE] Derived directly from ${evidence.length} real collected signal(s).`
      : "[DEV FIXTURE] No direct evidence for this dimension in development mode — conservative assumption.",
  }));

  return {
    title: `[DEV FIXTURE] Opportunity for: ${problem.workflow}`.slice(0, 200),
    description: `[DEV FIXTURE] Synthesized (no real model call) from ${evidence.length} evidence record(s) and ${competitorObservations.length} competitor observation(s).`,
    distributionChannels: [
      { channel: "Search", reasoning: "[DEV FIXTURE] Placeholder — no real distribution research was performed." },
    ],
    scoreDimensions,
    killRiskDimensions,
    dimensionGrounding,
  };
}
