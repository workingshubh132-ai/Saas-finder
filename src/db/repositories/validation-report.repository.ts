import type { ValidationReport } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateValidationReportInput {
  claimId: string;
  status: string;
  confidence: number;
  supportingEvidenceIds: string;
  contradictingEvidenceIds: string;
  independenceAssessment: string;
  qualityAssessment: string;
  reasoning: string;
  missingEvidence: string;
  recommendedResearch: string;
  modelProvider: string;
  modelName: string;
}

/** Append-only (docs/M4_ARCHITECTURE_PROPOSAL.md §2, §27) — no update method exposed; a re-validation is always a new row. */
export const validationReportRepository = {
  create(input: CreateValidationReportInput): Promise<ValidationReport> {
    return prisma.validationReport.create({ data: input });
  },

  findById(id: string): Promise<ValidationReport | null> {
    return prisma.validationReport.findUnique({ where: { id } });
  },

  listForClaim(claimId: string): Promise<ValidationReport[]> {
    return prisma.validationReport.findMany({ where: { claimId }, orderBy: { createdAt: "desc" } });
  },

  findLatestForClaim(claimId: string): Promise<ValidationReport | null> {
    return prisma.validationReport.findFirst({ where: { claimId }, orderBy: { createdAt: "desc" } });
  },
};
