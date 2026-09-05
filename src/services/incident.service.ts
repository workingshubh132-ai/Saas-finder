import type { Incident } from "@prisma/client";
import { incidentRepository, type UpdateIncidentStatusExtra } from "../db/repositories/incident.repository.js";
import { INCIDENT_STATUS_TRANSITIONS, isIncidentSeverity, isIncidentStatus } from "../domain/incident/incident.types.js";
import type { AlertSeverity } from "../domain/alert/alert.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import type { Actor } from "./agent.service.js";
import { alertService } from "./alert.service.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

const INCIDENT_SEVERITY_TO_ALERT_SEVERITY: Readonly<Record<string, AlertSeverity>> = { LOW: "INFO", MEDIUM: "WARNING", HIGH: "WARNING", CRITICAL: "CRITICAL" };

export interface CreateIncidentParams {
  productId: string;
  deploymentId?: string | null;
  severity: string;
  summary: string;
  actor: Actor;
}

/**
 * Incident lifecycle (docs/M7_ARCHITECTURE_PROPOSAL.md §16, §26) —
 * created by a human directly or by a failed/unhealthy
 * MonitoringProvider.checkHealth result surfaced through the API,
 * never auto-created silently in the background (no scheduler exists
 * anywhere in this codebase, §12/§45).
 */
export const incidentService = {
  async create(params: CreateIncidentParams): Promise<Incident> {
    if (!isIncidentSeverity(params.severity)) throw new ValidationError(`Unknown incident severity: ${params.severity}`);

    const incident = await incidentRepository.create({ productId: params.productId, deploymentId: params.deploymentId ?? null, severity: params.severity, summary: params.summary });

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: "CREATE_INCIDENT",
      resourceType: "PRODUCT",
      resourceId: params.productId,
      result: "SUCCESS",
      metadata: { incidentId: incident.id, severity: incident.severity, deploymentId: params.deploymentId ?? null },
    });
    await eventBus.publish({ type: "INCIDENT_DETECTED", payload: { incidentId: incident.id, productId: params.productId, severity: incident.severity } });
    // docs/M9_ARCHITECTURE_PROPOSAL.md §35 — a real, already-created Incident is one of the brief's own named alert sources.
    await alertService.raise({
      alertType: "INCIDENT",
      severity: INCIDENT_SEVERITY_TO_ALERT_SEVERITY[incident.severity] ?? "WARNING",
      resourceType: "PRODUCT",
      resourceId: params.productId,
      message: `Incident (${incident.severity}): ${incident.summary}`,
    });

    return incident;
  },

  async getOrThrow(id: string): Promise<Incident> {
    const incident = await incidentRepository.findById(id);
    if (!incident) throw new NotFoundError("Incident", id);
    return incident;
  },

  listForProduct: incidentRepository.listForProduct,

  async setStatus(id: string, toStatus: string, actor: Actor, extra: UpdateIncidentStatusExtra = {}): Promise<Incident> {
    if (!isIncidentStatus(toStatus)) throw new ValidationError(`Unknown incident status: ${toStatus}`);
    const incident = await incidentService.getOrThrow(id);
    if (!isIncidentStatus(incident.status)) throw new ValidationError(`Corrupt stored status on incident ${incident.id}: ${incident.status}`);
    assertTransition("Incident", INCIDENT_STATUS_TRANSITIONS, incident.status, toStatus);

    const updated = await incidentRepository.updateStatus(id, toStatus, toStatus === "RESOLVED" ? { resolvedAt: new Date(), ...extra } : extra);

    await auditService.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: `INCIDENT_${incident.status}_TO_${toStatus}`,
      resourceType: "INCIDENT",
      resourceId: id,
      result: "SUCCESS",
    });
    if (toStatus === "RESOLVED") {
      await eventBus.publish({ type: "INCIDENT_RESOLVED", payload: { incidentId: id, productId: incident.productId } });
    }

    return updated;
  },
};
