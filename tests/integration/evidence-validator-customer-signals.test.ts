import { describe, expect, it } from "vitest";
import { icpProfileRepository } from "../../src/db/repositories/icp-profile.repository.js";
import { outreachMessageRepository } from "../../src/db/repositories/outreach-message.repository.js";
import { customerResponseRepository } from "../../src/db/repositories/customer-response.repository.js";
import { opportunityRepository } from "../../src/db/repositories/opportunity.repository.js";
import { validationReportRepository } from "../../src/db/repositories/validation-report.repository.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { customerEvidenceService } from "../../src/services/customer-evidence.service.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { evidenceValidatorService } from "../../src/services/evidence-validator.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { authActor, makeFullAgentSet, makeOpportunity, makeProspect, HUMAN_OWNER } from "../helpers.js";
import type { Claim } from "@prisma/client";

/**
 * A minimal, directly-created OutreachMessage + CustomerResponse pair
 * — purely to satisfy CustomerResponse's own FK chain. This test suite
 * is only about the Evidence Validator's consumption of already-wrapped
 * CustomerEvidence (docs/M5_ARCHITECTURE_PROPOSAL.md §17-18), not about
 * drafting or response-analysis, both covered by their own test files.
 */
async function makeDummyResponseChain(opportunityId: string, claim: Claim, organization: string, agentId: string, observation: string) {
  const prospect = await makeProspect({ opportunityId, icpProfileId: null, organization });

  let icpProfile = await icpProfileRepository.findLatestForOpportunity(opportunityId);
  if (!icpProfile) {
    icpProfile = await icpProfileRepository.create({
      opportunityId,
      industry: "Any",
      companySizeMin: null,
      companySizeMax: null,
      role: "Any",
      problemExposure: "Any",
      likelyFrequency: "Any",
      geography: "Any",
      technology: "Any",
      exclusions: "[]",
      fieldGrounding: "[]",
      generatedByAgentId: agentId,
    });
  }

  const experiment = await outreachExperimentService.create({
    opportunityId,
    claimId: claim.id,
    targetIcpProfileId: icpProfile.id,
    createdByIdentityId: HUMAN_OWNER.actorId,
    objective: "test",
    researchQuestion: "test?",
    messageStrategy: "test",
    prospectLimit: 25,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "test",
    failureCriteria: "test",
  });

  const message = await outreachMessageRepository.create({
    experimentId: experiment.id,
    prospectId: prospect.id,
    content: "test message",
    reasoning: "test reasoning",
    claimBeingTestedId: claim.id,
    expectedInformationGain: 0.5,
    draftedByAgentId: agentId,
  });

  return customerResponseRepository.create({
    outreachMessageId: message.id,
    prospectId: prospect.id,
    rawContent: observation,
    enteredByIdentityId: HUMAN_OWNER.actorId,
  });
}

async function makeCustomerEvidence(params: { opportunityId: string; claim: Claim; organization: string; signalType: string; relatedClaimType?: string | null; observation: string; agentId: string }) {
  const response = await makeDummyResponseChain(params.opportunityId, params.claim, params.organization, params.agentId, params.observation);

  const evidence = await evidenceService.collectEvidence({
    claim: params.observation,
    source: "customer-response",
    sourceType: "CUSTOMER",
    sourceReference: response.id,
    collectedByAgentId: params.agentId,
    reliability: "HIGH",
    confidence: 0.8,
  });
  await opportunityRepository.attachEvidence(params.opportunityId, evidence.id);

  await customerEvidenceService.create({
    responseId: response.id,
    evidenceId: evidence.id,
    prospectId: response.prospectId,
    signalType: params.signalType,
    relatedClaimType: params.relatedClaimType ?? null,
    strength: "HIGH",
    directness: "DIRECT",
    extractedByAgentId: params.agentId,
    actorId: params.agentId,
  });

  return evidence;
}

describe("evidenceValidatorService — customer signal-type routing (docs/M5_ARCHITECTURE_PROPOSAL.md §17)", () => {
  it("never offers INTEREST-tagged customer evidence as a candidate for a WILLINGNESS_TO_PAY claim", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;

    const interestEvidence = await makeCustomerEvidence({
      opportunityId: opportunity.id,
      claim: wtpClaim,
      organization: "Interested Co",
      signalType: "INTEREST",
      observation: "I would definitely try this out, sounds interesting!",
      agentId: agents.validatorAgent.id,
    });

    const outcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const report = await validationReportRepository.findLatestForClaim(wtpClaim.id);
    const supportingIds = JSON.parse(report!.supportingEvidenceIds) as string[];
    expect(supportingIds).not.toContain(interestEvidence.id);
  });

  it("does offer WTP-tagged customer evidence as a real candidate for a WILLINGNESS_TO_PAY claim", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;

    const wtpEvidence = await makeCustomerEvidence({
      opportunityId: opportunity.id,
      claim: wtpClaim,
      organization: "Willing Co",
      signalType: "WTP",
      observation: "We currently pay $200/month for a partial workaround and would pay for a real solution.",
      agentId: agents.validatorAgent.id,
    });

    const outcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const report = await validationReportRepository.findLatestForClaim(wtpClaim.id);
    const supportingIds = JSON.parse(report!.supportingEvidenceIds) as string[];
    expect(supportingIds).toContain(wtpEvidence.id);
  });

  it("treats two customer evidence items from the SAME organization as KNOWN to not be independent — never inflated to LIKELY/independent-looking", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;

    await makeCustomerEvidence({ opportunityId: opportunity.id, claim: wtpClaim, organization: "Same Co", signalType: "WTP", observation: "We pay for a similar tool today and would switch.", agentId: agents.validatorAgent.id });
    await makeCustomerEvidence({ opportunityId: opportunity.id, claim: wtpClaim, organization: "Same Co", signalType: "WTP", observation: "Our team pays for a similar tool and would switch too.", agentId: agents.validatorAgent.id });

    const outcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const report = await validationReportRepository.findLatestForClaim(wtpClaim.id);
    const independence = JSON.parse(report!.independenceAssessment) as { level: string; reasoning: string };
    expect(independence.level).toBe("KNOWN");
    expect(independence.reasoning).toMatch(/NOT be independent/i);
  });

  it("treats two customer evidence items from DIFFERENT organizations as known-independent", async () => {
    const agents = await makeFullAgentSet();
    const opportunity = await makeOpportunity();
    const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;

    await makeCustomerEvidence({ opportunityId: opportunity.id, claim: wtpClaim, organization: "Org One", signalType: "WTP", observation: "We pay for a similar tool today and would switch.", agentId: agents.validatorAgent.id });
    await makeCustomerEvidence({ opportunityId: opportunity.id, claim: wtpClaim, organization: "Org Two", signalType: "WTP", observation: "Our company pays for a competing product currently.", agentId: agents.validatorAgent.id });

    const outcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const report = await validationReportRepository.findLatestForClaim(wtpClaim.id);
    const independence = JSON.parse(report!.independenceAssessment) as { level: string };
    expect(independence.level).toBe("KNOWN");
  });
});
