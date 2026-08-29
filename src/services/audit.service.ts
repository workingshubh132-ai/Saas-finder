import { auditRepository } from "../db/repositories/audit.repository.js";
import { toJsonString } from "../domain/shared/json.js";
import type { ActorType, AuditResult } from "../domain/audit/audit.types.js";
import type { RiskLevel } from "../domain/risk/risk-level.js";

export interface RecordAuditParams {
  actorType: ActorType;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  riskLevel?: RiskLevel | null;
  result: AuditResult;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * The only path allowed to write audit_logs. Every service in this
 * kernel that changes state or makes an authorization decision calls
 * this — see docs/SECURITY.md for which actions are covered.
 */
export const auditService = {
  record(params: RecordAuditParams) {
    return auditRepository.record({
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      riskLevel: params.riskLevel ?? null,
      result: params.result,
      reason: params.reason ?? null,
      metadata: params.metadata ? toJsonString(params.metadata) : null,
    });
  },

  list: auditRepository.list,
};
