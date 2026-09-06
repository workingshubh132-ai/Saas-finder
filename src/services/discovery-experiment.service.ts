import type { OutreachExperiment, Prospect, ProspectResearchProfile } from "@prisma/client";
import { prisma } from "../db/client.js";
import { icpProfileRepository } from "../db/repositories/icp-profile.repository.js";
import { outreachExperimentRepository } from "../db/repositories/outreach-experiment.repository.js";
import { problemRepository } from "../db/repositories/problem.repository.js";
import { prospectRepository } from "../db/repositories/prospect.repository.js";
import { prospectResearchProfileRepository } from "../db/repositories/prospect-research-profile.repository.js";
import { signalClusterRepository } from "../db/repositories/signal-cluster.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { agentService, type Actor } from "./agent.service.js";
import { icpAnalystService } from "./icp-analyst.service.js";
import { messageApprovalService } from "./message-approval.service.js";
import { messageDrafterService } from "./message-drafter.service.js";
import { opportunityService } from "./opportunity.service.js";
import { prospectQualificationService } from "./prospect-qualification.service.js";
import { prospectResearcherService } from "./prospect-researcher.service.js";

/** A single research-tool loop cannot be meaningfully re-run indefinitely against the same ICP — the query is
 *  deterministic, so repeated calls return the same search results. This just bounds how many attempts are made
 *  toward targetCount before accepting whatever was actually found (never a promise the tool can't keep). */
const MAX_RESEARCH_ITERATIONS = 5;

export interface RunDiscoveryExperimentParams {
  opportunityId: string;
  experimentId: string;
  targetCount: number;
}

export interface ProspectCandidateReport {
  prospectId: string;
  businessName: string;
  industry: string;
  location: string;
  website: string;
  publicContactChannel: string;
  contactType: string;
  contactSource: string;
  decisionMaker: string;
  workflowSignals: unknown;
  painHypotheses: unknown;
  evidence: string;
  evidenceLevel: string;
  opportunityId: string;
  qualificationStatus: string | null;
  qualificationReason: string | null;
  confidence: number;
  reality: string;
  provenanceNote: string;
  outreachMessageId: string | null;
  approvalRequestId: string | null;
  rejectionReason: string | null;
}

export interface DiscoveryExperimentReport {
  opportunityId: string;
  experimentId: string;
  businessesResearched: number;
  signalsDiscovered: number;
  clustersTouched: number;
  prospectsDiscovered: number;
  prospectsQualified: number;
  contactChannelsDiscovered: number;
  outreachDraftsCreated: number;
  approvalsRequired: number;
  qualifiedCandidates: ProspectCandidateReport[];
  rejectedCandidates: ProspectCandidateReport[];
  /** Always 0 — this command never sends anything externally (Phase 6/8's own non-negotiable). */
  messagesSent: 0;
}

function toCandidateReport(prospect: Prospect, profile: ProspectResearchProfile | null, outreachMessageId: string | null, approvalRequestId: string | null): ProspectCandidateReport {
  return {
    prospectId: prospect.id,
    businessName: profile?.businessName ?? prospect.organization,
    industry: profile?.industry ?? "UNKNOWN",
    location: profile?.location ?? "UNKNOWN",
    website: profile?.website ?? "UNKNOWN",
    publicContactChannel: prospect.publicContactChannel,
    contactType: profile?.contactType ?? "OTHER",
    contactSource: profile?.contactSource ?? "UNKNOWN",
    decisionMaker: profile?.decisionMaker ?? "UNKNOWN",
    workflowSignals: profile ? JSON.parse(profile.workflowSignals) : [],
    painHypotheses: profile ? JSON.parse(profile.painHypotheses) : [],
    evidence: prospect.reasonForMatch ?? "",
    evidenceLevel: profile?.reality ?? "UNKNOWN",
    opportunityId: prospect.opportunityId,
    qualificationStatus: prospect.qualificationStatus,
    qualificationReason: prospect.reasonForMatch,
    confidence: profile?.confidence ?? 0,
    reality: profile?.reality ?? "UNKNOWN",
    provenanceNote: profile?.provenanceNote ?? "",
    outreachMessageId,
    approvalRequestId,
    rejectionReason: prospect.qualificationStatus === "QUALIFIED" ? null : prospect.reasonForMatch,
  };
}

async function findOrCreateAgent(name: string, role: string, description: string, createdBy: Actor): Promise<string> {
  const existing = await prisma.agent.findFirst({ where: { name, role }, orderBy: { createdAt: "desc" } });
  if (existing) return existing.id;
  const agent = await agentService.createAgent({ name, role, department: "INTELLIGENCE", description, riskLevel: "GREEN", createdBy });
  return agent.id;
}

/**
 * The discovery vertical slice's one new orchestration path
 * (docs/DISCOVERY_EXPERIMENT_VERTICAL_SLICE.md) — chains ONLY existing
 * services (icpAnalystService, prospectResearcherService,
 * prospectQualificationService, messageDrafterService,
 * messageApprovalService), each exactly as already implemented and
 * tested. This function performs no research, qualification, or
 * drafting logic itself — it is glue and reporting. It never sends
 * anything: the furthest it ever reaches is a PENDING ApprovalRequest,
 * exactly like every other M5 outreach draft.
 *
 * Requires the OutreachExperiment to already exist and be ACTIVE — the
 * existing human-approval gate on experiment creation
 * (outreachExperimentService.approve) is never bypassed or re-created
 * here.
 */
export const discoveryExperimentService = {
  async run(params: RunDiscoveryExperimentParams): Promise<DiscoveryExperimentReport> {
    if (params.targetCount < 1) throw new ValidationError("targetCount must be at least 1.");

    const opportunity = await opportunityService.getOrThrow(params.opportunityId);
    const experiment: OutreachExperiment | null = await outreachExperimentRepository.findById(params.experimentId);
    if (!experiment) throw new NotFoundError("OutreachExperiment", params.experimentId);
    if (experiment.opportunityId !== opportunity.id) {
      throw new ValidationError(`OutreachExperiment ${experiment.id} belongs to a different opportunity than ${opportunity.id}.`);
    }
    if (experiment.status !== "ACTIVE") {
      throw new ValidationError(
        `OutreachExperiment ${experiment.id} is not ACTIVE (status: ${experiment.status}) — a human must approve it first (outreachExperimentService.approve); this command never approves an experiment itself.`,
      );
    }

    const humanIdentity = await prisma.identity.findFirst({ where: { type: "HUMAN" }, orderBy: { createdAt: "desc" } });
    if (!humanIdentity) throw new ValidationError("No Human Owner identity found — bootstrap one first.");
    const grantedBy: Actor = { actorType: "HUMAN", actorId: humanIdentity.id };
    const startedBy: AuthenticatedActor = { type: "HUMAN", id: humanIdentity.id, identityId: humanIdentity.id };

    const icpAgentId = await findOrCreateAgent("Discovery ICP Analyst", "ICP Analyst", "Generates the ICP a discovery experiment researches against. Zero tool calls.", grantedBy);
    const researcherAgentId = await findOrCreateAgent("Discovery Prospect Researcher", "Prospect Researcher", "Finds real businesses via the existing public research tool. One tool call, one model call.", grantedBy);
    const qualifierAgentId = await findOrCreateAgent("Discovery Prospect Qualifier", "Prospect Qualification", "Qualifies discovered prospects against the ICP. Zero tool calls.", grantedBy);
    const drafterAgentId = await findOrCreateAgent("Discovery Message Drafter", "Message Drafter", "Drafts research-only outreach messages. Zero tool calls, never sends.", grantedBy);

    const researcherPermissions = await prisma.agentPermission.findFirst({ where: { agentId: researcherAgentId, permission: "READ_WEB" } });
    if (!researcherPermissions) {
      await agentService.grantPermission({ agentId: researcherAgentId, permission: "READ_WEB", grantedBy });
    }

    let icpProfile = await icpProfileRepository.findLatestForOpportunity(opportunity.id);
    if (!icpProfile) {
      const icpOutcome = await icpAnalystService.run({ agentId: icpAgentId, opportunityId: opportunity.id, startedBy });
      if (icpOutcome.status !== "COMPLETED" || !icpOutcome.result) {
        throw new ValidationError(`ICP generation did not complete for opportunity ${opportunity.id} (execution ${icpOutcome.execution.id}).`);
      }
      icpProfile = icpOutcome.result.icpProfile;
    }

    // --- Business discovery: reuse prospectResearcherService, bounded, never re-invented. ---
    const discovered: Prospect[] = [];
    for (let i = 0; i < MAX_RESEARCH_ITERATIONS && discovered.length < params.targetCount; i++) {
      const outcome = await prospectResearcherService.run({ agentId: researcherAgentId, icpProfileId: icpProfile.id, startedBy });
      if (outcome.status !== "COMPLETED" || !outcome.result) break;
      if (outcome.result.prospects.length === 0) break; // deterministic query already exhausted — stop rather than repeat pointlessly.
      discovered.push(...outcome.result.prospects);
    }

    // --- Qualification: reuse prospectQualificationService, unmodified. ---
    for (const prospect of discovered) {
      await prospectQualificationService.run({ agentId: qualifierAgentId, prospectId: prospect.id, startedBy });
    }

    const refreshedProspects = await Promise.all(discovered.map((p) => prospectRepository.findById(p.id)));
    const qualified = refreshedProspects.filter((p): p is Prospect => p !== null && p.status === "QUALIFIED");
    const rejected = refreshedProspects.filter((p): p is Prospect => p !== null && p.status !== "QUALIFIED");

    // --- Outreach draft + human gate: reuse messageDrafterService + messageApprovalService, unmodified. ---
    const qualifiedReports: ProspectCandidateReport[] = [];
    let draftsCreated = 0;
    let approvalsRequired = 0;

    for (const prospect of qualified) {
      const profile = await prospectResearchProfileRepository.findByProspectId(prospect.id);
      let outreachMessageId: string | null = null;
      let approvalRequestId: string | null = null;

      try {
        const draftOutcome = await messageDrafterService.run({ agentId: drafterAgentId, experimentId: experiment.id, prospectId: prospect.id, startedBy });
        if (draftOutcome.status === "COMPLETED" && draftOutcome.result) {
          outreachMessageId = draftOutcome.result.message.id;
          draftsCreated += 1;

          const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId, requestedByAgentId: drafterAgentId });
          approvalRequestId = approvalRequest.id;
          approvalsRequired += 1;
        }
      } catch (error) {
        // A single candidate's rate-limit or budget failure must never abort the whole batch — reported, not thrown.
        const reason = error instanceof Error ? error.message : String(error);
        qualifiedReports.push({ ...toCandidateReport(prospect, profile, null, null), rejectionReason: `Draft not created: ${reason}` });
        continue;
      }

      qualifiedReports.push(toCandidateReport(prospect, profile, outreachMessageId, approvalRequestId));
    }

    const rejectedReports: ProspectCandidateReport[] = [];
    for (const prospect of rejected) {
      const profile = await prospectResearchProfileRepository.findByProspectId(prospect.id);
      rejectedReports.push(toCandidateReport(prospect, profile, null, null));
    }

    const problem = opportunity.problemId ? await problemRepository.findById(opportunity.problemId) : null;
    const cluster = problem ? await signalClusterRepository.findById(problem.clusterId) : null;

    return {
      opportunityId: opportunity.id,
      experimentId: experiment.id,
      businessesResearched: discovered.length,
      signalsDiscovered: cluster?.signalCount ?? 0,
      clustersTouched: cluster ? 1 : 0,
      prospectsDiscovered: discovered.length,
      prospectsQualified: qualified.length,
      contactChannelsDiscovered: discovered.length,
      outreachDraftsCreated: draftsCreated,
      approvalsRequired,
      qualifiedCandidates: qualifiedReports,
      rejectedCandidates: rejectedReports,
      messagesSent: 0,
    };
  },
};
