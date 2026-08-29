import { agentPermissionRepository } from "../db/repositories/permission.repository.js";
import { agentRepository } from "../db/repositories/agent.repository.js";
import { isPermission } from "../domain/permission/permission.js";
import { getPermissionRiskLevel } from "../domain/risk/permission-risk-policy.js";
import { getRiskPolicy, type RiskLevel } from "../domain/risk/risk-level.js";
import { auditService } from "./audit.service.js";

export type AuthorizationDecisionKind = "ALLOWED" | "DENIED" | "REQUIRES_APPROVAL";

export interface AuthorizationDecision {
  decision: AuthorizationDecisionKind;
  riskLevel: RiskLevel | null;
  reason: string;
}

export interface AuthorizeParams {
  agentId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
}

async function evaluate(params: AuthorizeParams): Promise<AuthorizationDecision> {
  // Fail closed for unknown permissions — an action the system doesn't
  // recognize is never implicitly allowed.
  if (!isPermission(params.action)) {
    return { decision: "DENIED", riskLevel: null, reason: `Unknown permission: ${params.action}` };
  }
  const riskLevel = getPermissionRiskLevel(params.action);

  const agent = await agentRepository.findById(params.agentId);
  if (!agent) {
    return { decision: "DENIED", riskLevel, reason: `Unknown agent: ${params.agentId}` };
  }
  if (agent.status !== "ACTIVE") {
    return { decision: "DENIED", riskLevel, reason: `Agent is not ACTIVE (status: ${agent.status})` };
  }

  const granted = await agentPermissionRepository.hasActivePermission(params.agentId, params.action);
  if (!granted) {
    return { decision: "DENIED", riskLevel, reason: `Agent does not hold an active grant for ${params.action}` };
  }

  const policy = getRiskPolicy(riskLevel);
  if (policy.requiresApproval) {
    return {
      decision: "REQUIRES_APPROVAL",
      riskLevel,
      reason: `${params.action} is ${riskLevel} and requires an approved decision before execution.`,
    };
  }

  return { decision: "ALLOWED", riskLevel, reason: `${params.action} is ${riskLevel} and the agent is authorized.` };
}

/**
 * The single path every capability check must go through (Constitution
 * §7 of the M1 brief: "Authorization should be explicit"). Every call
 * is audited, allowed or not, so the system can always answer who was
 * denied what and why.
 */
export const authorizationService = {
  async authorize(params: AuthorizeParams): Promise<AuthorizationDecision> {
    const result = await evaluate(params);

    await auditService.record({
      actorType: "AGENT",
      actorId: params.agentId,
      action: `AUTHORIZE:${params.action}`,
      resourceType: params.resourceType ?? "PERMISSION",
      resourceId: params.resourceId ?? params.action,
      riskLevel: result.riskLevel,
      result: result.decision === "DENIED" ? "DENIED" : "SUCCESS",
      reason: result.reason,
    });

    return result;
  },
};
