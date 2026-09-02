import { describe, expect, it } from "vitest";
import { icpProfileRepository } from "../../src/db/repositories/icp-profile.repository.js";
import { prospectRepository } from "../../src/db/repositories/prospect.repository.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { prospectQualificationService } from "../../src/services/prospect-qualification.service.js";
import { authActor, makeAgent, makeFullAgentSet, makeOpportunity, makeProspect } from "../helpers.js";

async function makeIcpProfile() {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  const outcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (outcome.status !== "COMPLETED") throw new Error("icpAnalystService.run did not complete");
  return { agents, opportunity, icpProfile: outcome.result.icpProfile };
}

describe("prospectQualificationService.run", () => {
  it("qualifies a prospect whose role clearly overlaps the ICP's own role, with a real explanation — never a bare score", async () => {
    const { agents, opportunity, icpProfile } = await makeIcpProfile();
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id, organization: "Acme Co", role: icpProfile.role });

    const outcome = await prospectQualificationService.run({ agentId: agents.prospectQualificationAgent.id, prospectId: prospect.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;
    expect(outcome.execution.toolCallCount).toBe(0);

    const qualified = outcome.result.prospect;
    expect(qualified.qualificationStatus).toBe("QUALIFIED");
    expect(qualified.status).toBe("QUALIFIED");
    expect(["HIGH", "MEDIUM"]).toContain(qualified.icpFit);
    expect(qualified.reasonForMatch).toBeTruthy();
    expect(JSON.parse(qualified.unknowns as string).length).toBeGreaterThan(0);
  });

  it("rejects a prospect whose organization/role text matches an explicit ICP exclusion", async () => {
    const { agents, opportunity, icpProfile: baseIcp } = await makeIcpProfile();
    // A hand-crafted ICP with a real exclusion — icpAnalystService's own dev fixture never populates exclusions, so this exercises the exclusion branch directly at the repository layer.
    const icpProfile = await icpProfileRepository.create({
      opportunityId: opportunity.id,
      industry: baseIcp.industry,
      companySizeMin: null,
      companySizeMax: null,
      role: "Small business owner",
      problemExposure: baseIcp.problemExposure,
      likelyFrequency: baseIcp.likelyFrequency,
      geography: baseIcp.geography,
      technology: baseIcp.technology,
      exclusions: JSON.stringify(["reseller"]),
      fieldGrounding: baseIcp.fieldGrounding,
      generatedByAgentId: baseIcp.generatedByAgentId,
    });
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id, organization: "Acme Reseller Inc", role: "Small business owner" });

    const outcome = await prospectQualificationService.run({ agentId: agents.prospectQualificationAgent.id, prospectId: prospect.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    const result = outcome.result.prospect;
    expect(result.qualificationStatus).toBe("REJECTED");
    expect(result.status).toBe("REJECTED");
    expect(result.icpFit).toBe("LOW");
    expect(result.reasonForMatch).toContain("reseller");
  });

  it("marks a prospect UNQUALIFIED (not REJECTED) when fit is genuinely unclear rather than excluded — honest uncertainty, never forced", async () => {
    const { agents, opportunity, icpProfile } = await makeIcpProfile();
    const mismatched = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id, organization: "Some Org", role: "A role sharing nothing with the ICP" });

    const outcome = await prospectQualificationService.run({ agentId: agents.prospectQualificationAgent.id, prospectId: mismatched.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    // Coarser status still routes an unclear-fit prospect out of the drafting pipeline (REJECTED), while qualificationStatus preserves the finer "wasn't excluded, just unclear" distinction for a human reading the record (docs/M5_ARCHITECTURE_PROPOSAL.md §8).
    expect(outcome.result.prospect.qualificationStatus).toBe("UNQUALIFIED");
    expect(outcome.result.prospect.status).toBe("REJECTED");
  });

  it("throws a clear error rather than fabricating an assessment for a prospect with no ICP profile", async () => {
    const { agents, opportunity } = await makeIcpProfile();
    const researcherAgent = await makeAgent({ role: "Prospect Researcher" });
    const orphan = await prospectRepository.create({
      opportunityId: opportunity.id,
      icpProfileId: null,
      organization: "Orphan Org",
      role: "Orphan role",
      publicContactChannel: "https://dev-fixture.local/orphan",
      source: "hacker_news",
      sourceUrl: "https://dev-fixture.local/orphan",
      discoveredByAgentId: researcherAgent.id,
    });

    // A missing prerequisite resource is a pre-flight ValidationError (thrown before agentRuntimeService.startExecution even runs), the same "throw, don't fabricate a RunOutcome" shape evidence-validator.service.ts/ceo-reasoning.service.ts already use for their own "resource not found" checks.
    await expect(prospectQualificationService.run({ agentId: agents.prospectQualificationAgent.id, prospectId: orphan.id, startedBy: authActor() })).rejects.toThrow(/no ICP profile/i);
  });
});
