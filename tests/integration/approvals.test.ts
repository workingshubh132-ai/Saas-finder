import type { ApprovalRequest } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { InvalidTransitionError, NotHumanOwnerError, SelfApprovalError } from "../../src/domain/shared/errors.js";
import { approvalService } from "../../src/services/approval.service.js";
import { HUMAN_OWNER, makeAgent } from "../helpers.js";

function requestSample(agentId: string): Promise<ApprovalRequest> {
  return approvalService.requestApproval({
    requestedByAgentId: agentId,
    action: "SEND_EXTERNAL_MESSAGE",
    description: "Send outreach email to 10 qualified leads",
    riskLevel: "YELLOW",
  });
}

describe("approvalService", () => {
  it("PENDING -> APPROVED works", async () => {
    const agent = await makeAgent();
    const request = await requestSample(agent.id);

    const approved = await approvalService.decide({ id: request.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });

    expect(approved.status).toBe("APPROVED");
    expect(approved.reviewedBy).toBe(HUMAN_OWNER);
    expect(approved.reviewedAt).not.toBeNull();
  });

  it("PENDING -> REJECTED works", async () => {
    const agent = await makeAgent();
    const request = await requestSample(agent.id);

    const rejected = await approvalService.decide({
      id: request.id,
      toStatus: "REJECTED",
      reviewedBy: HUMAN_OWNER,
      decisionReason: "Not enough evidence of demand yet.",
    });

    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decisionReason).toContain("evidence");
  });

  it("rejects deciding an already-resolved request", async () => {
    const agent = await makeAgent();
    const request = await requestSample(agent.id);
    await approvalService.decide({ id: request.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });

    await expect(approvalService.decide({ id: request.id, toStatus: "REJECTED", reviewedBy: HUMAN_OWNER })).rejects.toThrow(
      InvalidTransitionError,
    );
  });

  it("an unrecognized reviewer identity cannot decide at all", async () => {
    const agent = await makeAgent();
    const request = await requestSample(agent.id);

    await expect(approvalService.decide({ id: request.id, toStatus: "APPROVED", reviewedBy: agent.id })).rejects.toThrow(
      NotHumanOwnerError,
    );
  });

  it("the requester cannot approve its own request — even if its id somehow reached the Human Owner allow-list", async () => {
    const agent = await makeAgent();
    const request = await requestSample(agent.id);

    // Defense-in-depth check: this simulates the should-never-happen
    // case where the agent id space and the Human Owner allow-list
    // collide, proving the explicit SelfApprovalError guard is real
    // and not merely incidental to the allow-list check above.
    config.humanOwnerIds.push(agent.id);
    try {
      await expect(approvalService.decide({ id: request.id, toStatus: "APPROVED", reviewedBy: agent.id })).rejects.toThrow(
        SelfApprovalError,
      );
    } finally {
      const index = config.humanOwnerIds.indexOf(agent.id);
      if (index >= 0) config.humanOwnerIds.splice(index, 1);
    }
  });

  it("REQUEST_MORE_EVIDENCE defers the request, and it can be re-queued", async () => {
    const agent = await makeAgent();
    const request = await requestSample(agent.id);

    const deferred = await approvalService.requestMoreEvidence({ id: request.id, reviewedBy: HUMAN_OWNER });
    expect(deferred.status).toBe("DEFERRED");

    const requeued = await approvalService.requeue(request.id);
    expect(requeued.status).toBe("PENDING");
  });
});
