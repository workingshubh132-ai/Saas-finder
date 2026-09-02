import { describe, expect, it } from "vitest";
import { claimEvidenceRepository } from "../../src/db/repositories/claim-evidence.repository.js";
import { validationReportRepository } from "../../src/db/repositories/validation-report.repository.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { evidenceValidatorService } from "../../src/services/evidence-validator.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { authActor, makeFullAgentSet, makeOpportunity } from "../helpers.js";

async function setUpOpportunityWithEvidence() {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  const evidence = await evidenceService.collectEvidence({
    claim: "A real customer said they would pay $30/month for this if it saved them two hours a week.",
    source: "customer-interview",
    sourceType: "CUSTOMER",
    sourceReference: null,
    collectedByAgentId: agents.opportunityAgent.id,
    reliability: "HIGH",
    confidence: 0.8,
    metadata: {},
  });
  await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: evidence.id, actor: { actorType: "AGENT", actorId: agents.opportunityAgent.id } });
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  return { agents, opportunity, evidence, claims };
}

describe("evidenceValidatorService.run", () => {
  it("produces a structured ValidationReport and ClaimEvidence rows, without a real tool call when maxSearches = 0", async () => {
    const { agents, claims } = await setUpOpportunityWithEvidence();
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;

    const outcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;
    expect(outcome.execution.toolCallCount).toBe(0);

    const report = await validationReportRepository.findById(outcome.result.validationReportId);
    expect(report).not.toBeNull();
    expect(["UNVERIFIED", "SUPPORTED", "WEAK", "CONTRADICTED", "CONFLICTED", "INSUFFICIENT_EVIDENCE"]).toContain(report!.status);
    expect(JSON.parse(report!.qualityAssessment)).toHaveProperty("qualityScore");
    expect(JSON.parse(report!.independenceAssessment)).toHaveProperty("level");

    const classifications = await claimEvidenceRepository.listForClaim(wtpClaim.id);
    expect(classifications.length).toBeGreaterThan(0);
    for (const c of classifications) {
      expect(["SUPPORTING", "CONTRADICTING", "UNKNOWN"]).toContain(c.relationship);
      expect(c.validationReportId).toBe(report!.id);
    }
  });

  it("classifies real payment-intent evidence as SUPPORTING for a willingness-to-pay claim", async () => {
    const { agents, claims, evidence } = await setUpOpportunityWithEvidence();
    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;

    const outcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const classifications = await claimEvidenceRepository.listForClaim(wtpClaim.id);
    const seeded = classifications.find((c) => c.evidenceId === evidence.id);
    expect(seeded?.relationship).toBe("SUPPORTING");
  });

  it("classifies evidence with a real negative signal as CONTRADICTING", async () => {
    const { agents, opportunity, claims } = await setUpOpportunityWithEvidence();
    const negativeEvidence = await evidenceService.collectEvidence({
      claim: "Another prospect said they wouldn't pay for this — their spreadsheet is free and good enough.",
      source: "customer-interview",
      sourceType: "CUSTOMER",
      sourceReference: null,
      collectedByAgentId: agents.opportunityAgent.id,
      reliability: "HIGH",
      confidence: 0.8,
      metadata: {},
    });
    await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: negativeEvidence.id, actor: { actorType: "AGENT", actorId: agents.opportunityAgent.id } });

    const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
    const outcome = await evidenceValidatorService.run({ agentId: agents.validatorAgent.id, claimId: wtpClaim.id, maxSearches: 0, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const classifications = await claimEvidenceRepository.listForClaim(wtpClaim.id);
    const negative = classifications.find((c) => c.evidenceId === negativeEvidence.id);
    expect(negative?.relationship).toBe("CONTRADICTING");
    expect(["CONTRADICTED", "CONFLICTED"]).toContain(outcome.result.status);
  });
});
