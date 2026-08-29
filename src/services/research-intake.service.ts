import type { ApprovalRequest, Evidence, Opportunity } from "@prisma/client";
import { approvalService } from "./approval.service.js";
import { evidenceService } from "./evidence.service.js";
import { opportunityService } from "./opportunity.service.js";
import type { OpportunityScoreDimensions } from "./opportunity-scorer.js";

export interface ResearchSignalEvidence {
  claim: string;
  source: string;
  sourceType: string;
  sourceReference?: string;
  reliability: string;
  confidence: number;
}

export interface ResearchSignalInput {
  /** The Intelligence-department agent reporting the signal. */
  agentId: string;
  opportunity: {
    title: string;
    problem: string;
    targetCustomer: string;
    description: string;
  };
  evidence: ResearchSignalEvidence[];
  scoreDimensions: OpportunityScoreDimensions;
  approvalRequest: {
    action: string;
    description: string;
    riskLevel: string;
    reason?: string;
  };
}

export interface ResearchSignalResult {
  opportunity: Opportunity;
  evidence: Evidence[];
  approvalRequest: ApprovalRequest;
}

/**
 * M1's end-to-end vertical slice (M1 brief §17): a research signal
 * becomes an evidence-backed, scored Opportunity with a governed
 * decision request sitting in the Human Decision Queue. Each step
 * below is just an ordinary call into the same services the HTTP API
 * exposes — this function adds no new authority or side channel, it
 * only sequences them the way an Intelligence agent would. Input is
 * caller-supplied structured data (mock/internal in tests) — this
 * kernel does not scrape the web or fabricate research (Constitution
 * §31 of the governing document).
 */
export const researchIntakeService = {
  async intake(input: ResearchSignalInput): Promise<ResearchSignalResult> {
    const opportunity = await opportunityService.createOpportunity({
      ...input.opportunity,
      discoveredBy: { actorType: "AGENT", actorId: input.agentId },
    });

    const collectedEvidence: Evidence[] = [];
    for (const item of input.evidence) {
      const evidence = await evidenceService.collectEvidence({
        claim: item.claim,
        source: item.source,
        sourceType: item.sourceType,
        sourceReference: item.sourceReference,
        reliability: item.reliability,
        confidence: item.confidence,
        collectedByAgentId: input.agentId,
      });
      await opportunityService.attachEvidence({
        opportunityId: opportunity.id,
        evidenceId: evidence.id,
        actor: { actorType: "AGENT", actorId: input.agentId },
      });
      collectedEvidence.push(evidence);
    }

    const scoredOpportunity = await opportunityService.scoreOpportunity({
      opportunityId: opportunity.id,
      dimensions: input.scoreDimensions,
      scoredBy: input.agentId,
    });

    const approvalRequest = await approvalService.requestApproval({
      requestedByAgentId: input.agentId,
      action: input.approvalRequest.action,
      description: input.approvalRequest.description,
      riskLevel: input.approvalRequest.riskLevel,
      resourceType: "OPPORTUNITY",
      resourceId: opportunity.id,
      evidenceIds: collectedEvidence.map((evidence) => evidence.id),
      reason: input.approvalRequest.reason,
    });

    return { opportunity: scoredOpportunity, evidence: collectedEvidence, approvalRequest };
  },
};
