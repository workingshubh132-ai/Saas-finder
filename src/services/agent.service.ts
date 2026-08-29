import type { Agent, AgentPermission } from "@prisma/client";
import { config } from "../config.js";
import { agentPermissionRepository } from "../db/repositories/permission.repository.js";
import { agentRepository } from "../db/repositories/agent.repository.js";
import { AGENT_STATUS_TRANSITIONS, isAgentDepartment, isAgentStatus } from "../domain/agent/agent.types.js";
import { isPermission } from "../domain/permission/permission.js";
import { isRiskLevel } from "../domain/risk/risk-level.js";
import { NotFoundError, NotHumanOwnerError, ValidationError } from "../domain/shared/errors.js";
import { toJsonString } from "../domain/shared/json.js";
import { assertTransition } from "../domain/shared/state-machine.js";
import { auditService } from "./audit.service.js";
import { eventBus } from "./event-bus.js";

export interface CreateAgentParams {
  name: string;
  role: string;
  department: string;
  description: string;
  capabilities?: string[];
  modelProvider?: string | null;
  modelName?: string | null;
  parentAgentId?: string | null;
  riskLevel: string;
  createdBy: string;
}

export interface Actor {
  actorType: "AGENT" | "HUMAN" | "SYSTEM";
  actorId: string;
}

function assertHumanOwner(identity: string): void {
  if (!config.humanOwnerIds.includes(identity)) {
    throw new NotHumanOwnerError(identity);
  }
}

export const agentService = {
  /**
   * Registering an agent, granting it a capability, and changing its
   * status are all Human-Owner-only in M1 — the Constitution gives the
   * CEO the power to *recommend* new agents (§5, §24), not to create
   * them unilaterally, and no CEO agent exists to make that
   * recommendation yet anyway (see docs/DECISIONS.md).
   */
  async createAgent(params: CreateAgentParams): Promise<Agent> {
    assertHumanOwner(params.createdBy);
    if (!isAgentDepartment(params.department)) {
      throw new ValidationError(`Unknown department: ${params.department}`);
    }
    if (!isRiskLevel(params.riskLevel)) {
      throw new ValidationError(`Unknown risk level: ${params.riskLevel}`);
    }
    if (params.parentAgentId) {
      await agentService.getAgentOrThrow(params.parentAgentId);
    }

    const agent = await agentRepository.create({
      name: params.name,
      role: params.role,
      department: params.department,
      description: params.description,
      status: "ACTIVE",
      capabilities: toJsonString(params.capabilities ?? []),
      modelProvider: params.modelProvider ?? null,
      modelName: params.modelName ?? null,
      parentAgentId: params.parentAgentId ?? null,
      riskLevel: params.riskLevel,
    });

    await auditService.record({
      actorType: "HUMAN",
      actorId: params.createdBy,
      action: "CREATE_AGENT",
      resourceType: "AGENT",
      resourceId: agent.id,
      riskLevel: params.riskLevel,
      result: "SUCCESS",
    });
    await eventBus.publish({ type: "AGENT_CREATED", payload: { agentId: agent.id, name: agent.name, department: agent.department } });

    return agent;
  },

  async getAgentOrThrow(id: string): Promise<Agent> {
    const agent = await agentRepository.findById(id);
    if (!agent) throw new NotFoundError("Agent", id);
    return agent;
  },

  listAgents: agentRepository.list,

  async transitionStatus(params: { id: string; toStatus: string; actor: Actor }): Promise<Agent> {
    if (!isAgentStatus(params.toStatus)) {
      throw new ValidationError(`Unknown agent status: ${params.toStatus}`);
    }
    const agent = await agentService.getAgentOrThrow(params.id);
    if (!isAgentStatus(agent.status)) {
      throw new ValidationError(`Corrupt stored status on agent ${agent.id}: ${agent.status}`);
    }
    assertTransition("Agent", AGENT_STATUS_TRANSITIONS, agent.status, params.toStatus);

    const updated = await agentRepository.updateStatus(params.id, params.toStatus);

    await auditService.record({
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      action: `AGENT_STATUS_${agent.status}_TO_${params.toStatus}`,
      resourceType: "AGENT",
      resourceId: params.id,
      result: "SUCCESS",
    });
    if (params.toStatus === "SUSPENDED") {
      await eventBus.publish({ type: "AGENT_SUSPENDED", payload: { agentId: params.id, from: agent.status } });
    }

    return updated;
  },

  /**
   * An agent must not automatically receive unrestricted permissions
   * (Constitution §4 of the M1 brief), and an agent cannot grant itself
   * one: grantedBy must resolve to a configured Human Owner identity,
   * which no agent id ever is.
   */
  async grantPermission(params: {
    agentId: string;
    permission: string;
    grantedBy: string;
    reason?: string;
  }): Promise<AgentPermission> {
    assertHumanOwner(params.grantedBy);
    if (!isPermission(params.permission)) {
      throw new ValidationError(`Unknown permission: ${params.permission}`);
    }
    await agentService.getAgentOrThrow(params.agentId);

    const alreadyGranted = await agentPermissionRepository.hasActivePermission(params.agentId, params.permission);
    if (alreadyGranted) {
      throw new ValidationError(`Agent ${params.agentId} already has an active grant for ${params.permission}`);
    }

    const grant = await agentPermissionRepository.grant({
      agentId: params.agentId,
      permission: params.permission,
      grantedBy: params.grantedBy,
      reason: params.reason ?? null,
    });

    await auditService.record({
      actorType: "HUMAN",
      actorId: params.grantedBy,
      action: "GRANT_PERMISSION",
      resourceType: "AGENT",
      resourceId: params.agentId,
      result: "SUCCESS",
      metadata: { permission: params.permission },
    });

    return grant;
  },

  async revokePermission(params: { permissionId: string; revokedBy: string }): Promise<AgentPermission> {
    assertHumanOwner(params.revokedBy);

    const grant = await agentPermissionRepository.findById(params.permissionId);
    if (!grant) throw new NotFoundError("AgentPermission", params.permissionId);
    if (grant.revokedAt) throw new ValidationError("Permission grant is already revoked.");

    const updated = await agentPermissionRepository.revoke(params.permissionId, params.revokedBy);

    await auditService.record({
      actorType: "HUMAN",
      actorId: params.revokedBy,
      action: "REVOKE_PERMISSION",
      resourceType: "AGENT",
      resourceId: grant.agentId,
      result: "SUCCESS",
      metadata: { permission: grant.permission },
    });

    return updated;
  },

  listPermissions: agentPermissionRepository.listActiveForAgent,
};
