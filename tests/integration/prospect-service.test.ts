import { describe, expect, it } from "vitest";
import { prospectService } from "../../src/services/prospect.service.js";
import { makeOpportunity, makeProspect } from "../helpers.js";

describe("prospectService.markDoNotContact", () => {
  it("moves a freshly-discovered prospect straight to DO_NOT_CONTACT — reachable from every non-terminal state", async () => {
    const opportunity = await makeOpportunity();
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: null });
    expect(prospect.status).toBe("DISCOVERED");

    const updated = await prospectService.markDoNotContact({ id: prospect.id, reason: "Explicit human override.", actorType: "HUMAN", actorId: null });

    expect(updated.status).toBe("DO_NOT_CONTACT");
  });

  it("refuses to move a DO_NOT_CONTACT prospect anywhere else — terminal", async () => {
    const opportunity = await makeOpportunity();
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: null });
    await prospectService.markDoNotContact({ id: prospect.id, reason: "First override.", actorType: "HUMAN", actorId: null });

    await expect(prospectService.setStatus({ id: prospect.id, toStatus: "QUALIFIED", actorType: "HUMAN", actorId: null })).rejects.toThrow();
  });
});

describe("prospectService.setQualification / setStatus", () => {
  it("rejects an unknown status value rather than silently corrupting the record", async () => {
    const opportunity = await makeOpportunity();
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: null });

    await expect(prospectService.setStatus({ id: prospect.id, toStatus: "NOT_A_REAL_STATUS", actorType: "SYSTEM", actorId: null })).rejects.toThrow();
  });

  it("rejects an illegal transition (DISCOVERED -> APPROVED_TO_CONTACT)", async () => {
    const opportunity = await makeOpportunity();
    const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: null });

    await expect(prospectService.setStatus({ id: prospect.id, toStatus: "APPROVED_TO_CONTACT", actorType: "SYSTEM", actorId: null })).rejects.toThrow();
  });
});
