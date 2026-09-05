import type { InvestmentMemo } from "@prisma/client";
import { prisma } from "../client.js";

export interface CreateInvestmentMemoInput {
  opportunityId: string;
  ceoRecommendationId: string;
  chairmanReviewId: string;
  content: string;
  strongestArgumentAgainst: string;
  investmentThesis: string;
  recommendation: string;
  confidence: number;
  keyReason: string;
  biggestRisk: string;
  nextAction: string;
}

/** Append-only (docs/M4_ARCHITECTURE_PROPOSAL.md §17, §27) — no update method exposed; a re-run after new evidence is always a new row. */
export const investmentMemoRepository = {
  create(input: CreateInvestmentMemoInput): Promise<InvestmentMemo> {
    return prisma.investmentMemo.create({ data: input });
  },

  findById(id: string): Promise<InvestmentMemo | null> {
    return prisma.investmentMemo.findUnique({ where: { id } });
  },

  listForOpportunity(opportunityId: string): Promise<InvestmentMemo[]> {
    return prisma.investmentMemo.findMany({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },

  findLatestForOpportunity(opportunityId: string): Promise<InvestmentMemo | null> {
    return prisma.investmentMemo.findFirst({ where: { opportunityId }, orderBy: { createdAt: "desc" } });
  },

  /**
   * InvestmentMemo is the one memo table with no direct humanDecision
   * column (docs/M9_ARCHITECTURE_PROPOSAL.md §10, §19) — its own human
   * decision flows through a required-FK `DecisionRecord` instead
   * (M4's KILL-decision wiring onto the approval infrastructure).
   * "Undecided" here means no DecisionRecord references it yet.
   */
  listUndecided(): Promise<InvestmentMemo[]> {
    return prisma.investmentMemo.findMany({ where: { decisionRecords: { none: {} } }, orderBy: { createdAt: "asc" } });
  },
};
