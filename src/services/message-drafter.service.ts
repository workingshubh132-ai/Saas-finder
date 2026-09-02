import type { Claim, OutreachExperiment, OutreachMessage, Prospect } from "@prisma/client";
import { z } from "zod";
import { claimRepository } from "../db/repositories/claim.repository.js";
import { outreachExperimentRepository } from "../db/repositories/outreach-experiment.repository.js";
import { outreachMessageRepository } from "../db/repositories/outreach-message.repository.js";
import { prospectRepository } from "../db/repositories/prospect.repository.js";
import type { AuthenticatedActor } from "../domain/identity/identity.types.js";
import { computeExpectedInformationGain } from "../domain/claim/eig.js";
import { isClaimImportance } from "../domain/claim/claim.types.js";
import { isClaimValidationStatus } from "../domain/claim/claim-validation.types.js";
import { DEFAULT_OUTREACH_LIMITS } from "../domain/outreach-experiment/outreach-limits.js";
import { PLACEHOLDER_NEUTRAL_SCORE } from "../domain/decision/priority.js";
import { NotFoundError, ValidationError } from "../domain/shared/errors.js";
import { agentRuntimeService, type ExecutionBudget, type RunOutcome } from "./agent-runtime.service.js";
import { completeWithValidation } from "./model-output.js";
import { outreachMessageService } from "./outreach-message.service.js";
import { prospectService } from "./prospect.service.js";

const MODEL_MAX_OUTPUT_TOKENS = 512;
const MESSAGE_MAX_LENGTH = 2000;

/**
 * Zero tool calls (docs/M5_ARCHITECTURE_PROPOSAL.md §12, §24) — the
 * Message Drafter drafts, it never sends and never searches for
 * anything; it is only ever given what the caller already knows.
 */
export const MESSAGE_DRAFTER_BUDGET: Partial<ExecutionBudget> = {
  maxSteps: 2,
  maxToolCalls: 0,
  maxModelCalls: 1,
  maxRetries: 1,
  maxDurationMs: 15_000,
};

const messageDraftSchema = z.object({
  content: z.string().min(1).max(MESSAGE_MAX_LENGTH),
  reasoning: z.string().min(1),
});
type MessageDraft = z.infer<typeof messageDraftSchema>;

const MESSAGE_DRAFTER_SYSTEM_PROMPT =
  "You are the Message Drafter for VentureForge (docs/M5_ARCHITECTURE_PROPOSAL.md §12). Draft ONE short outreach " +
  "message for LEARNING, never selling — you are asking a real research question about the prospect's own current " +
  "behavior, not pitching a product. Bad: \"Hi! We built an amazing AI SaaS. Would you like a demo?\" Better: \"We're " +
  "researching how [role/industry] currently handle [problem]. Could I ask how you currently...?\" You are given ONLY " +
  "the prospect's organization, role, and reason for match, the experiment's research question and message strategy, " +
  "and the claim being tested — nothing else is known about this prospect. You MUST NOT invent or imply: a prior " +
  "relationship, a previous conversation, the prospect's own name (you were not given one — do not invent one), any " +
  "company fact not given to you, an endorsement, that the prospect already uses any product, or any personal " +
  "familiarity. Keep the message short, genuinely curious, and easy to answer briefly. " +
  'Respond with ONLY JSON matching: {"content": string, "reasoning": string}';

export interface RunMessageDrafterParams {
  agentId: string;
  experimentId: string;
  prospectId: string;
  startedBy: AuthenticatedActor;
}

export interface MessageDrafterResult {
  message: OutreachMessage;
}

function buildDraftPrompt(experiment: OutreachExperiment, prospect: Prospect, claim: Claim): string {
  return [
    `Research question: ${experiment.researchQuestion}`,
    `Message strategy: ${experiment.messageStrategy}`,
    `Claim being tested: [${claim.claimType}] ${claim.statement}`,
    "",
    `Prospect organization: ${prospect.organization}`,
    `Prospect role: ${prospect.role}`,
    `Reason this prospect matched the ICP: ${prospect.reasonForMatch ?? "(not recorded)"}`,
  ].join("\n");
}

/**
 * DEVELOPMENT ONLY — genuinely built from the real experiment/prospect
 * input, never a static stub: the message literally embeds the
 * experiment's own researchQuestion and the prospect's own role, so a
 * different experiment/prospect pair produces different, but always
 * unmistakably fake, output. Structurally cannot invent a name (none
 * was ever in the input to draw from) or a relationship (nothing to
 * draw from there either).
 */
function buildDevMessageFixture(experiment: OutreachExperiment, prospect: Prospect): MessageDraft {
  const content =
    `[DEV FIXTURE] Hi — we're researching how ${prospect.role.toLowerCase()}s like yours at ${prospect.organization} ` +
    `currently handle this. ${experiment.researchQuestion} No product pitch — just trying to learn from real ` +
    `experience. Thank you!`;
  return {
    content: content.slice(0, MESSAGE_MAX_LENGTH),
    reasoning: `[DEV FIXTURE] Deterministically assembled from experiment.researchQuestion and prospect.role/organization — no real model reasoning was performed. Framed as research, never a pitch.`,
  };
}

/**
 * The Message Drafter (docs/M5_ARCHITECTURE_PROPOSAL.md §12) — drafts,
 * never sends. Requires the experiment to already be ACTIVE (the first
 * hard human gate, §2/§11) and the prospect to be QUALIFIED; moves the
 * prospect QUALIFIED -> APPROVED_FOR_DRAFT -> DRAFT_READY as part of
 * drafting, since OutreachMessage.experimentId/prospectId together
 * *are* the record of "this prospect was selected for this
 * experiment" — there is no separate selection step in this schema.
 * Enforces the per-experiment-per-day and per-destination-per-day rate
 * limits (§15, §26) before creating the message — never after.
 */
export const messageDrafterService = {
  async run(params: RunMessageDrafterParams): Promise<RunOutcome<MessageDrafterResult>> {
    const experiment = await outreachExperimentRepository.findById(params.experimentId);
    if (!experiment) throw new NotFoundError("OutreachExperiment", params.experimentId);
    if (experiment.status !== "ACTIVE") {
      throw new ValidationError(`OutreachExperiment ${experiment.id} is not ACTIVE (status: ${experiment.status}) — no message may be drafted under it.`);
    }

    const prospect = await prospectRepository.findById(params.prospectId);
    if (!prospect) throw new NotFoundError("Prospect", params.prospectId);
    if (prospect.opportunityId !== experiment.opportunityId) {
      throw new ValidationError(`Prospect ${prospect.id} belongs to a different opportunity than experiment ${experiment.id}.`);
    }
    if (prospect.status !== "QUALIFIED") {
      throw new ValidationError(`Prospect ${prospect.id} is not QUALIFIED (status: ${prospect.status}) — only qualified prospects may be drafted for.`);
    }

    const claim = await claimRepository.findById(experiment.claimId);
    if (!claim) throw new NotFoundError("Claim", experiment.claimId);
    const claimImportance = claim.importance;
    const claimStatus = claim.status;
    if (!isClaimImportance(claimImportance)) {
      throw new ValidationError(`Corrupt stored importance on claim ${claim.id}: ${claimImportance}`);
    }
    if (!isClaimValidationStatus(claimStatus)) {
      throw new ValidationError(`Corrupt stored status on claim ${claim.id}: ${claimStatus}`);
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const messagesToday = await outreachMessageRepository.countForExperimentSince(experiment.id, startOfToday);
    if (messagesToday >= DEFAULT_OUTREACH_LIMITS.maxMessagesPerExperimentPerDay) {
      throw new ValidationError(`Experiment ${experiment.id} has already drafted ${messagesToday} message(s) today — the limit is ${DEFAULT_OUTREACH_LIMITS.maxMessagesPerExperimentPerDay}.`);
    }
    const destinationToday = await outreachMessageRepository.countForDestinationSince(experiment.id, prospect.publicContactChannel, startOfToday);
    if (destinationToday >= DEFAULT_OUTREACH_LIMITS.maxMessagesPerDestinationSourcePerDay) {
      throw new ValidationError(`Contact channel ${prospect.publicContactChannel} has already received ${destinationToday} message(s) today for this experiment.`);
    }

    const execution = await agentRuntimeService.startExecution({
      agentId: params.agentId,
      taskId: null,
      input: { experimentId: params.experimentId, prospectId: params.prospectId },
      startedBy: params.startedBy,
    });

    return agentRuntimeService.run(
      execution.id,
      async (handle) => {
        handle.step();
        const { value: draft } = await completeWithValidation(handle.callModel, messageDraftSchema, {
          systemPrompt: MESSAGE_DRAFTER_SYSTEM_PROMPT,
          maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: buildDraftPrompt(experiment, prospect, claim) }],
          devFixtureResponse: buildDevMessageFixture(experiment, prospect),
        });

        await handle.transition("PROCESSING_RESULT");
        handle.step();

        const expectedInformationGain = computeExpectedInformationGain({
          importance: claimImportance,
          status: claimStatus,
          normalizedResearchCost: PLACEHOLDER_NEUTRAL_SCORE,
        });

        const message = await outreachMessageService.create({
          experimentId: experiment.id,
          prospectId: prospect.id,
          content: draft.content,
          reasoning: draft.reasoning,
          claimBeingTestedId: claim.id,
          expectedInformationGain,
          draftedByAgentId: params.agentId,
          actorType: "AGENT",
          actorId: params.agentId,
        });

        await prospectService.setStatus({ id: prospect.id, toStatus: "APPROVED_FOR_DRAFT", actorType: "AGENT", actorId: params.agentId });
        await prospectService.setStatus({ id: prospect.id, toStatus: "DRAFT_READY", actorType: "AGENT", actorId: params.agentId });

        return { message };
      },
      MESSAGE_DRAFTER_BUDGET,
    );
  },
};
