import { describe, expect, it } from "vitest";
import { agentService } from "../../src/services/agent.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { prospectResearcherService } from "../../src/services/prospect-researcher.service.js";
import { prospectResearchProfileRepository } from "../../src/db/repositories/prospect-research-profile.repository.js";
import { authActor, makeAgent, makeFullAgentSet, makeOpportunity, HUMAN_OWNER } from "../helpers.js";

async function authorizedProspectResearcher() {
  const agent = await makeAgent({ role: "Prospect Researcher" });
  await agentService.grantPermission({ agentId: agent.id, permission: "READ_WEB", grantedBy: HUMAN_OWNER });
  return agent;
}

async function makeIcpProfile() {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  const outcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (outcome.status !== "COMPLETED") throw new Error("icpAnalystService.run did not complete");
  return { opportunity, icpProfile: outcome.result.icpProfile };
}

describe("prospectResearcherService", () => {
  it("finds and persists prospects grounded in real search results, each with real provenance", async () => {
    const agent = await authorizedProspectResearcher();
    const { opportunity, icpProfile } = await makeIcpProfile();

    const outcome = await prospectResearcherService.run({ agentId: agent.id, icpProfileId: icpProfile.id, startedBy: authActor() });

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;
    expect(outcome.result.prospects.length).toBeGreaterThan(0);
    for (const prospect of outcome.result.prospects) {
      expect(prospect.opportunityId).toBe(opportunity.id);
      expect(prospect.icpProfileId).toBe(icpProfile.id);
      expect(prospect.source).toBe("hacker_news");
      expect(prospect.sourceUrl).toMatch(/^https:\/\/dev-fixture\.local\//);
      expect(prospect.organization).toBeTruthy();
      expect(prospect.publicContactChannel).toBeTruthy();
      expect(prospect.status).toBe("DISCOVERED");
      // No qualification has run yet — never fabricate a fit assessment before prospectQualificationService actually does the work.
      expect(prospect.qualificationStatus).toBeNull();
    }
  });

  it("never invents a personal contact field — publicContactChannel is always the real, dereferenceable source URL in the dev fixture", async () => {
    const agent = await authorizedProspectResearcher();
    const { icpProfile } = await makeIcpProfile();

    const outcome = await prospectResearcherService.run({ agentId: agent.id, icpProfileId: icpProfile.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    for (const prospect of outcome.result.prospects) {
      expect(prospect.publicContactChannel).toBe(prospect.sourceUrl);
    }
  });

  it("is denied when the agent lacks READ_WEB — fails closed, no prospect is created", async () => {
    const agent = await makeAgent({ role: "Prospect Researcher" }); // no grant
    const { icpProfile } = await makeIcpProfile();

    const outcome = await prospectResearcherService.run({ agentId: agent.id, icpProfileId: icpProfile.id, startedBy: authActor() });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.errorCode).toBe("AUTHORIZATION_ERROR");
  });

  it("stays within its bounded budget — exactly one tool call, at most one model call", async () => {
    const agent = await authorizedProspectResearcher();
    const { icpProfile } = await makeIcpProfile();

    const outcome = await prospectResearcherService.run({ agentId: agent.id, icpProfileId: icpProfile.id, startedBy: authActor() });

    expect(outcome.execution.toolCallCount).toBe(1);
    expect(outcome.execution.modelCallCount).toBeLessThanOrEqual(1);
  });

  it("deduplicates by sourceUrl — running twice against the same ICP never creates duplicate prospects for the same discussion", async () => {
    const agent = await authorizedProspectResearcher();
    const { icpProfile } = await makeIcpProfile();

    const first = await prospectResearcherService.run({ agentId: agent.id, icpProfileId: icpProfile.id, startedBy: authActor() });
    const second = await prospectResearcherService.run({ agentId: agent.id, icpProfileId: icpProfile.id, startedBy: authActor() });
    expect(first.status).toBe("COMPLETED");
    expect(second.status).toBe("COMPLETED");
    if (first.status !== "COMPLETED" || second.status !== "COMPLETED") return;

    // Same ICP -> same deterministic dev-fixture query -> same 3 URLs -> the second run must find zero *new* prospects.
    expect(first.result.prospects.length).toBeGreaterThan(0);
    expect(second.result.prospects).toHaveLength(0);
  });

  it("persists a ProspectResearchProfile per prospect, honestly labeled UNKNOWN/OTHER/DEV_FIXTURE — never a fabricated fact", async () => {
    const agent = await authorizedProspectResearcher();
    const { icpProfile } = await makeIcpProfile();

    const outcome = await prospectResearcherService.run({ agentId: agent.id, icpProfileId: icpProfile.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    for (const prospect of outcome.result.prospects) {
      const profile = await prospectResearchProfileRepository.findByProspectId(prospect.id);
      expect(profile).not.toBeNull();
      expect(profile!.industry).toBe("UNKNOWN");
      expect(profile!.location).toBe("UNKNOWN");
      expect(profile!.website).toBe("UNKNOWN");
      // Never WHATSAPP without real structural evidence — the dev fixture's channel is a bare thread URL.
      expect(profile!.contactType).toBe("OTHER");
      expect(profile!.reality).toBe("DEV_FIXTURE");
      expect(profile!.provenanceNote).toBeTruthy();
    }
  });

  it("never marks a dev-fixture workflow signal or pain hypothesis as OBSERVED — no real reasoning occurred", async () => {
    const agent = await authorizedProspectResearcher();
    const { icpProfile } = await makeIcpProfile();

    const outcome = await prospectResearcherService.run({ agentId: agent.id, icpProfileId: icpProfile.id, startedBy: authActor() });
    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") return;

    for (const prospect of outcome.result.prospects) {
      const profile = await prospectResearchProfileRepository.findByProspectId(prospect.id);
      const signals = JSON.parse(profile!.workflowSignals) as Array<{ provenance: string }>;
      const pains = JSON.parse(profile!.painHypotheses) as Array<{ provenance: string }>;
      for (const s of [...signals, ...pains]) expect(s.provenance).not.toBe("OBSERVED");
      // No OBSERVED signal anywhere -> confidence must be capped low, never a false show of certainty.
      expect(profile!.confidence).toBeLessThanOrEqual(0.4);
    }
  });
});
