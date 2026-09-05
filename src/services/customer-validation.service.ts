import type { DiscoveryFinding } from "@prisma/client";
import { customerDiscoveryInteractionRepository } from "../db/repositories/customer-discovery-interaction.repository.js";
import { discoveryFindingRepository } from "../db/repositories/discovery-finding.repository.js";
import { countIndependentBusinesses } from "../domain/customer-discovery/business-independence.js";
import { classifyWtp, maxWtpLevel, type WtpLevel } from "../domain/customer-discovery/wtp.js";
import {
  CUSTOMER_VALIDATION_THRESHOLDS,
  evaluateCustomerValidation,
  type CustomerValidationStatus,
} from "../domain/customer-discovery/validation-status.js";
import { opportunityService } from "./opportunity.service.js";
import { prospectService } from "./prospect.service.js";

export interface CustomerValidationEvaluation {
  readonly opportunityId: string;
  readonly totalBusinessCount: number;
  readonly confirmingBusinessCount: number;
  readonly recurringConfirmed: boolean;
  readonly measuredTimeOrCostConfirmed: boolean;
  readonly existingSpendConfirmed: boolean;
  readonly bestWtpLevel: WtpLevel;
  readonly status: CustomerValidationStatus;
  readonly reasons: string[];
  readonly evidenceGaps: string[];
  readonly disqualifyingReasons: string[];
}

/**
 * The findings that count toward "recurring or measurable pain" for
 * the validation ladder — FREQUENCY/VOLUME establish recurrence,
 * TIME_COST establishes a measured cost. Kept as a named constant so
 * the ladder's own definition of "measurable" is traceable to one
 * place, not re-derived ad hoc.
 */
const RECURRING_FIELDS = ["FREQUENCY", "VOLUME"] as const;
const TIME_COST_FIELD = "TIME_COST";
const EXISTING_SPEND_FIELD = "EXISTING_SPEND";

function hasObservedField(findings: readonly DiscoveryFinding[], field: string): boolean {
  return findings.some((f) => f.provenance === "OBSERVED" && f.field === field);
}

/**
 * Deterministic evidence-sufficiency evaluator (Phase 5) — no model
 * call anywhere in this file. Scope, stated honestly: this reads
 * CustomerDiscoveryInteraction + DiscoveryFinding (the Customer
 * Discovery + Validation layer's own model) as its source of truth.
 * Pre-existing CustomerResponse/CustomerEvidence data recorded through
 * the original M5 outreach-reply path is not automatically folded in —
 * documented as a known scope boundary in docs/CUSTOMER_DISCOVERY_VALIDATION.md,
 * not silently assumed away. CustomerEvidence itself was extended to
 * accept either source (see prisma/schema.prisma), so a future pass
 * could unify the two counts without another schema change.
 */
export const customerValidationService = {
  async evaluate(opportunityId: string): Promise<CustomerValidationEvaluation> {
    await opportunityService.getOrThrow(opportunityId);

    const interactions = await customerDiscoveryInteractionRepository.listForOpportunity(opportunityId);

    const prospectIds = [...new Set(interactions.map((i) => i.prospectId))];
    const prospects = await Promise.all(prospectIds.map((id) => prospectService.getOrThrow(id)));
    const organizationByProspectId = new Map(prospects.map((p) => [p.id, p.organization] as const));

    const findingsByInteractionId = new Map<string, DiscoveryFinding[]>();
    for (const interaction of interactions) {
      findingsByInteractionId.set(interaction.id, await discoveryFindingRepository.listForInteraction(interaction.id));
    }

    const totalBusinessCount = countIndependentBusinesses(interactions.map((i) => organizationByProspectId.get(i.prospectId)));

    const confirmingOrgs = new Set<string>();
    const recurringOrgs = new Set<string>();
    const timeCostOrgs = new Set<string>();
    const existingSpendOrgs = new Set<string>();
    const notPresentOrgs = new Set<string>();
    let bestWtpLevel: WtpLevel = "NONE";

    for (const interaction of interactions) {
      const org = organizationByProspectId.get(interaction.prospectId);
      if (!org) continue;
      const findings = findingsByInteractionId.get(interaction.id) ?? [];

      if (interaction.interactionOutcome === "PROBLEM_CONFIRMED") {
        confirmingOrgs.add(org);
        if (RECURRING_FIELDS.some((field) => hasObservedField(findings, field))) recurringOrgs.add(org);
        if (hasObservedField(findings, TIME_COST_FIELD)) timeCostOrgs.add(org);
        if (hasObservedField(findings, EXISTING_SPEND_FIELD)) existingSpendOrgs.add(org);

        const wtp = classifyWtp(findings.map((f) => ({ field: f.field, provenance: f.provenance, value: f.value })));
        bestWtpLevel = maxWtpLevel(bestWtpLevel, wtp.level);
      } else if (interaction.interactionOutcome === "PROBLEM_NOT_PRESENT" || interaction.interactionOutcome === "ALREADY_SOLVED_ADEQUATELY") {
        notPresentOrgs.add(org);
      }
    }

    const disqualifyingReasons: string[] = [];
    if (notPresentOrgs.size >= CUSTOMER_VALIDATION_THRESHOLDS.MIN_BUSINESSES_FOR_STRONG) {
      disqualifyingReasons.push(
        `${notPresentOrgs.size} independent business(es) reported the problem is not present, or is already solved adequately with an existing tool.`,
      );
    }

    const recurringOrMeasurablePainConfirmed = recurringOrgs.size > 0 || timeCostOrgs.size > 0;

    const result = evaluateCustomerValidation({
      confirmingBusinessCount: confirmingOrgs.size,
      recurringOrMeasurablePainConfirmed,
      bestWtpLevel,
      disqualifyingReasons,
    });

    return {
      opportunityId,
      totalBusinessCount,
      confirmingBusinessCount: confirmingOrgs.size,
      recurringConfirmed: recurringOrgs.size > 0,
      measuredTimeOrCostConfirmed: timeCostOrgs.size > 0,
      existingSpendConfirmed: existingSpendOrgs.size > 0,
      bestWtpLevel,
      status: result.status,
      reasons: result.reasons,
      evidenceGaps: result.evidenceGaps,
      disqualifyingReasons,
    };
  },

  /**
   * Phase 12's exact opportunity-summary report shape. Every value here
   * is either a direct count or traces back to evaluate()'s own
   * evidence-backed computation above — never a separate, parallel
   * judgment that could drift from it.
   */
  async summarize(opportunityId: string) {
    const opportunity = await opportunityService.getOrThrow(opportunityId);
    const evaluation = await customerValidationService.evaluate(opportunityId);

    const recurringPain: "CONFIRMED" | "UNKNOWN" | "CONTRADICTED" =
      evaluation.disqualifyingReasons.length > 0 ? "CONTRADICTED" : evaluation.recurringConfirmed ? "CONFIRMED" : "UNKNOWN";

    return {
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      businessesContacted: evaluation.totalBusinessCount,
      businessesResponded: evaluation.totalBusinessCount,
      businessesConfirmingProblem: evaluation.confirmingBusinessCount,
      recurringPain,
      measuredTimeOrCost: (evaluation.measuredTimeOrCostConfirmed ? "CONFIRMED" : "UNKNOWN") as "CONFIRMED" | "UNKNOWN",
      existingSpend: (evaluation.existingSpendConfirmed ? "CONFIRMED" : "UNKNOWN") as "CONFIRMED" | "UNKNOWN",
      wtp: evaluation.bestWtpLevel,
      disqualifyingEvidence: evaluation.disqualifyingReasons.length > 0,
      validation: evaluation.status,
      evidenceGaps: evaluation.evidenceGaps,
    };
  },
};
