import type { Alert } from "@prisma/client";
import { alertRepository } from "../db/repositories/alert.repository.js";
import { computeFounderAttentionScore, type FounderAttentionFactors } from "../domain/attention/attention-score.js";
import { isAlertType, withinDedupWindow, type AlertSeverity, type AlertType } from "../domain/alert/alert.types.js";
import { ValidationError } from "../domain/shared/errors.js";
import { eventBus } from "./event-bus.js";

const SEVERITY_TO_RISK: Readonly<Record<AlertSeverity, number>> = { INFO: 0.2, WARNING: 0.5, CRITICAL: 0.9 };
/** No richer signal exists yet for these factors at the alert level — same documented-neutral-default discipline as attentionScoringService. */
const NEUTRAL_DEFAULT = 0.5;

function scoreForSeverity(severity: AlertSeverity): number {
  const risk = SEVERITY_TO_RISK[severity];
  const factors: FounderAttentionFactors = {
    financialImpact: NEUTRAL_DEFAULT,
    urgency: risk,
    risk,
    uncertainty: NEUTRAL_DEFAULT,
    reversibility: NEUTRAL_DEFAULT,
    opportunityCost: NEUTRAL_DEFAULT,
    evidenceQuality: NEUTRAL_DEFAULT,
    strategicImportance: NEUTRAL_DEFAULT,
    deadlineProximity: NEUTRAL_DEFAULT,
  };
  return computeFounderAttentionScore(factors);
}

export interface RaiseAlertParams {
  alertType: AlertType;
  severity: AlertSeverity;
  resourceType: string;
  resourceId: string;
  message: string;
}

/**
 * Company Alerts (docs/M9_ARCHITECTURE_PROPOSAL.md §35, M9 brief §23)
 * — every source is a REAL, already-existing event or computed
 * condition (never a new detector); ranked by the SAME
 * `computeFounderAttentionScore` an alert is just another kind of
 * attention item (§35's own "no second ranking system"). "Avoid alert
 * spam": two alerts for the same (alertType, resourceType, resourceId)
 * within the dedup window collapse into one, `occurrenceCount`
 * incremented rather than a new row.
 */
export const alertService = {
  async raise(params: RaiseAlertParams): Promise<Alert> {
    if (!isAlertType(params.alertType)) {
      throw new ValidationError(`Unknown alert type: ${params.alertType}`);
    }
    const now = new Date();
    const existing = await alertRepository.findMostRecentForKey(params.alertType, params.resourceType, params.resourceId);

    if (existing && withinDedupWindow(existing.lastSeenAt, now)) {
      return alertRepository.bumpOccurrence(existing.id, now);
    }

    const alert = await alertRepository.create({
      alertType: params.alertType,
      severity: params.severity,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      message: params.message,
      score: scoreForSeverity(params.severity),
    });
    await eventBus.publish({ type: "ATTENTION_QUEUE_UPDATED", payload: { alertId: alert.id, alertType: alert.alertType, resourceType: alert.resourceType, resourceId: alert.resourceId, score: alert.score } });
    return alert;
  },

  listUnacknowledged: alertRepository.listUnacknowledged,
  list: alertRepository.list,

  acknowledge(id: string, acknowledgedByIdentityId: string): Promise<Alert> {
    return alertRepository.acknowledge(id, acknowledgedByIdentityId, new Date());
  },
};
