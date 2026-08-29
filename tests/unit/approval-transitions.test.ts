import { describe, expect, it } from "vitest";
import { canTransition } from "../../src/domain/shared/state-machine.js";
import { APPROVAL_STATUS_TRANSITIONS } from "../../src/domain/approval/approval.types.js";

describe("ApprovalRequest status transitions", () => {
  it("PENDING -> APPROVED and PENDING -> REJECTED are valid", () => {
    expect(canTransition(APPROVAL_STATUS_TRANSITIONS, "PENDING", "APPROVED")).toBe(true);
    expect(canTransition(APPROVAL_STATUS_TRANSITIONS, "PENDING", "REJECTED")).toBe(true);
  });

  it("PENDING -> DEFERRED -> PENDING supports the REQUEST_MORE_EVIDENCE round-trip", () => {
    expect(canTransition(APPROVAL_STATUS_TRANSITIONS, "PENDING", "DEFERRED")).toBe(true);
    expect(canTransition(APPROVAL_STATUS_TRANSITIONS, "DEFERRED", "PENDING")).toBe(true);
  });

  it("resolved statuses are terminal", () => {
    for (const status of ["APPROVED", "REJECTED", "MODIFIED", "CANCELLED", "EXPIRED"] as const) {
      expect(APPROVAL_STATUS_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("rejects deciding an already-approved request again", () => {
    expect(canTransition(APPROVAL_STATUS_TRANSITIONS, "APPROVED", "REJECTED")).toBe(false);
  });
});
