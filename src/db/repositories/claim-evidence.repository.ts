import type { ClaimEvidence } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateClaimEvidenceInput {
  claimId: string;
  evidenceId: string;
  relationship: string;
  reasoning: string;
  validationReportId: string | null;
}

/** Append-only (docs/M4_ARCHITECTURE_PROPOSAL.md §4) — no update method exposed. */
export const claimEvidenceRepository = {
  create(input: CreateClaimEvidenceInput): Promise<ClaimEvidence> {
    return prisma.claimEvidence.create({ data: input });
  },

  listForClaim(claimId: string): Promise<ClaimEvidence[]> {
    return prisma.claimEvidence.findMany({ where: { claimId }, orderBy: { createdAt: "desc" } });
  },

  listForValidationReport(validationReportId: string): Promise<ClaimEvidence[]> {
    return prisma.claimEvidence.findMany({ where: { validationReportId } });
  },
};
