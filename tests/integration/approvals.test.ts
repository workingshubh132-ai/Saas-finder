import type { ApprovalRequest } from "@prisma/client";
import { describe, expect, it } from "vitest";
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
    expect(approved.reviewedBy).toBe(HUMAN_OWNER.actorId);
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

  it("a non-HUMAN actor cannot decide an approval at all", async () => {
    const agent = await makeAgent();
    const request = await requestSample(agent.id);

    await expect(
      approvalService.decide({
        id: request.id,
        toStatus: "APPROVED",
        reviewedBy: { actorType: "AGENT", actorId: agent.id },
      }),
    ).rejects.toThrow(NotHumanOwnerError);
  });

  it("the requester cannot approve its own request, even a hand-crafted HUMAN-typed actor reusing its own id", async () => {
    const agent = await makeAgent();
    const request = await requestSample(agent.id);

    // Defense-in-depth: simulates the should-never-happen case where a
    // caller constructs an Actor claiming type HUMAN but carries the
    // requesting agent's own id — proving SelfApprovalError is a real,
    // independent guard, not merely incidental to assertHumanActor
    // (which this input already satisfies, since actorType is HUMAN).
    await expect(
      approvalService.decide({
        id: request.id,
        toStatus: "APPROVED",
        reviewedBy: { actorType: "HUMAN", actorId: agent.id },
      }),
    ).rejects.toThrow(SelfApprovalError);
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
