import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import { agentExecutionRepository } from "../../src/db/repositories/agent-execution.repository.js";
import { approvalRepository } from "../../src/db/repositories/approval.repository.js";
import { outreachMessageDeliveryRepository } from "../../src/db/repositories/outreach-message-delivery.repository.js";
import { alertService } from "../../src/services/alert.service.js";
import { approvalService } from "../../src/services/approval.service.js";
import { ensureSystemIdentity, registerAutonomousOperationsHandlers, resetAutonomousOperationsForTests } from "../../src/services/autonomous-operations.service.js";
import { billingPlanService } from "../../src/services/billing-plan.service.js";
import { claimExtractionService } from "../../src/services/claim-extraction.service.js";
import { customerResponseService } from "../../src/services/customer-response.service.js";
import { deploymentPlanService } from "../../src/services/deployment-plan.service.js";
import { emergencyStopService } from "../../src/services/emergency-stop.service.js";
import { eventBus } from "../../src/services/event-bus.js";
import { evidenceService } from "../../src/services/evidence.service.js";
import { experimentAnalystService } from "../../src/services/experiment-analyst.service.js";
import { growthExperimentService } from "../../src/services/growth-experiment.service.js";
import { icpAnalystService } from "../../src/services/icp-analyst.service.js";
import { launchReviewMemoService } from "../../src/services/launch-review-memo.service.js";
import { messageApprovalService } from "../../src/services/message-approval.service.js";
import { messageDrafterService } from "../../src/services/message-drafter.service.js";
import { opportunityService } from "../../src/services/opportunity.service.js";
import { MAX_SEND_ATTEMPTS, outboundMessageService } from "../../src/services/outbound-message.service.js";
import { outreachExperimentService } from "../../src/services/outreach-experiment.service.js";
import { productService } from "../../src/services/product.service.js";
import { prospectService } from "../../src/services/prospect.service.js";
import { checkRateLimit, resetRateLimits } from "../../src/sources/rate-limiter.js";
import { authActor, HUMAN_OWNER, makeAgentSetWithOpportunity, makeAwaitingLaunchApprovalProduct, makeFullAgentSet, makeLiveProduct, makeOpportunity, makeProspect } from "../helpers.js";

/**
 * The 16 mandated end-to-end scenarios for Autonomous Operations Phase A
 * (docs/AUTONOMOUS_OPERATIONS_AUDIT.md, docs/SECURITY.md's own threat
 * table). Every fixture below is real — the same dev-fixture model
 * adapter, real persistence, real audit trail every other milestone's
 * test suite already uses; nothing here is mocked (this codebase has
 * never used a test double anywhere, and Phase A doesn't start now).
 *
 * `registerAutonomousOperationsHandlers({})` called then immediately
 * unsubscribed in `beforeEach`/`afterEach` guarantees a clean eventBus
 * subscriber set before and after every test in this file — it self-
 * cleans whatever a previous test (in this file, or a stray leftover)
 * left registered, since `registerAutonomousOperationsHandlers` always
 * unsubscribes its predecessor before adding a new one.
 */
beforeEach(() => {
  resetAutonomousOperationsForTests();
  resetRateLimits();
  registerAutonomousOperationsHandlers({})();
});
afterEach(() => {
  registerAutonomousOperationsHandlers({})();
});

async function makeDraftedOutreachMessage() {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  const claim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
  const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgent.id, opportunityId: opportunity.id, startedBy: authActor() });
  if (icpOutcome.status !== "COMPLETED") throw new Error("icpAnalystService.run did not complete");
  const icpProfile = icpOutcome.result.icpProfile;

  const experiment = await outreachExperimentService.create({
    opportunityId: opportunity.id,
    claimId: claim.id,
    targetIcpProfileId: icpProfile.id,
    createdByIdentityId: HUMAN_OWNER.actorId,
    objective: "Confirm willingness to pay.",
    researchQuestion: "How much do you currently spend solving this problem, if anything?",
    messageStrategy: "Learning, not selling.",
    prospectLimit: 10,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "3+ responses.",
    failureCriteria: "Fewer than 2.",
  });
  await outreachExperimentService.approve({ id: experiment.id, actor: HUMAN_OWNER });

  const prospect = await makeProspect({ opportunityId: opportunity.id, icpProfileId: icpProfile.id });
  await prospectService.setQualification(
    prospect.id,
    "QUALIFIED",
    { qualificationStatus: "QUALIFIED", icpFit: "HIGH", reasonForMatch: "x", unknowns: "[]" },
    { actorType: "SYSTEM", actorId: null },
  );

  const draftOutcome = await messageDrafterService.run({ agentId: agents.messageDrafterAgent.id, experimentId: experiment.id, prospectId: prospect.id, startedBy: authActor() });
  if (draftOutcome.status !== "COMPLETED") throw new Error("messageDrafterService.run did not complete");

  return { agents, experiment, prospect, message: draftOutcome.result.message };
}

/** A message already APPROVED_TO_CONTACT, with handlers deliberately NOT registered during the decision, so the caller controls exactly when send() is invoked. */
async function makeApprovedOutreachMessage() {
  const draft = await makeDraftedOutreachMessage();
  const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: draft.message.id, requestedByAgentId: draft.agents.messageDrafterAgent.id });
  await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
  const message = await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
  return { ...draft, approvalRequest, message };
}

describe("automatic resumption after a human decision — event-driven, no manual follow-up call", () => {
  it("OUTREACH_MESSAGE: APPROVED auto-applies and auto-sends through the DEV_FIXTURE provider — no manual applyDecision/send call", async () => {
    registerAutonomousOperationsHandlers({});
    const { agents, message, prospect } = await makeDraftedOutreachMessage();

    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgent.id });
    const decided = await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    expect(decided.status).toBe("APPROVED");

    const contactedProspect = await prospectService.getOrThrow(prospect.id);
    expect(contactedProspect.status).toBe("CONTACTED");

    const deliveries = await outreachMessageDeliveryRepository.listForMessage(message.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("SENT");
    expect(deliveries[0]!.provider).toBe("DEV_FIXTURE");
  });

  it("DEPLOYMENT_PLAN: APPROVED auto-applies and auto-executes — the Product reaches LIVE with no manual applyDecision/execute call", async () => {
    registerAutonomousOperationsHandlers({});
    const chain = await makeAwaitingLaunchApprovalProduct();
    await launchReviewMemoService.recordHumanDecision({ memoId: chain.memo.id, humanDecision: "APPROVE", humanReason: null, actor: HUMAN_OWNER });

    const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: chain.deploymentPlan.id, requestedByAgentId: chain.agents.launchStrategistAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });

    const finalProduct = await productService.getOrThrow(chain.product.id);
    expect(finalProduct.status).toBe("LIVE");
    const finalPlan = await deploymentPlanService.getOrThrow(chain.deploymentPlan.id);
    expect(finalPlan.status).toBe("EXECUTED");
  });

  it("BILLING_PLAN: APPROVED auto-applies and auto-activates — a real ACTIVE BillingAccount with no manual applyDecision/activate call", async () => {
    registerAutonomousOperationsHandlers({});
    const { agents, product, pricingModel } = await makeAwaitingLaunchApprovalProduct();
    const billingPlan = await billingPlanService.create({ productId: product.id, pricingModelId: pricingModel.id, provider: "DEV_FIXTURE" });

    const approvalRequest = await billingPlanService.requestApproval({ billingPlanId: billingPlan.id, requestedByAgentId: agents.pricingAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });

    const finalPlan = await billingPlanService.getOrThrow(billingPlan.id);
    expect(finalPlan.status).toBe("ACTIVE");
  });

  it("GROWTH_EXPERIMENT: APPROVED auto-applies AND auto-starts the experiment (RUNNING) — the real two-step chain, not just the first step", async () => {
    // makeLiveProduct() drives its own real approve->execute chain manually (DeploymentPlan) —
    // handlers must not be registered yet, or that manual chain races the automatic one.
    const chain = await makeLiveProduct();
    registerAutonomousOperationsHandlers({});
    const proposeOutcome = await experimentAnalystService.run({ agentId: chain.agents.experimentAnalystAgent.id, productId: chain.product.id, targetMetricType: "CONVERSION_RATE", startedBy: authActor() });
    if (proposeOutcome.status !== "COMPLETED") throw new Error("experimentAnalystService.run did not complete");
    const proposed = proposeOutcome.result.growthExperiment;

    const approvalRequest = await growthExperimentService.requestApproval({ growthExperimentId: proposed.id, requestedByAgentId: chain.agents.experimentAnalystAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });

    const finalExperiment = await growthExperimentService.getOrThrow(proposed.id);
    expect(finalExperiment.status).toBe("RUNNING");
  });

  it(
    "OPPORTUNITY_DISCOVERED: the full claim -> evidence -> CEO -> Chairman -> memo -> approval-request chain runs automatically, and the human's subsequent APPROVE auto-kills the opportunity",
    async () => {
      const agents = await makeFullAgentSet();
      const opportunity = await makeOpportunity();

      // Real, honest evidence directly contradicting willingness to pay (mirrors m4-end-to-end.test.ts's own kill-path fixture).
      const contradictingEvidence = await evidenceService.collectEvidence({
        claim: "Three prospective customers independently said they wouldn't pay for this because their current spreadsheet process, while slow, is free and good enough.",
        source: "customer-interview",
        sourceType: "CUSTOMER",
        sourceReference: "interview-002",
        collectedByAgentId: agents.opportunityAgent.id,
        reliability: "HIGH",
        confidence: 0.85,
        metadata: {},
      });
      await opportunityService.attachEvidence({ opportunityId: opportunity.id, evidenceId: contradictingEvidence.id, actor: { actorType: "AGENT", actorId: agents.opportunityAgent.id } });

      await ensureSystemIdentity(authActor());
      registerAutonomousOperationsHandlers({ ceoAgentId: agents.ceoAgent.id, evidenceValidatorAgentId: agents.validatorAgent.id });

      await eventBus.publish({ type: "OPPORTUNITY_DISCOVERED", payload: { opportunityId: opportunity.id, title: opportunity.title } });

      const queue = await approvalRepository.listQueue();
      const approvalRequest = queue.find((a) => a.resourceType === "OPPORTUNITY" && a.resourceId === opportunity.id);
      expect(approvalRequest).toBeDefined();
      expect(approvalRequest!.action).toBe("KILL_OPPORTUNITY");

      await approvalService.decide({ id: approvalRequest!.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER, decisionReason: "Confirmed: real customers said they would not pay." });

      const finalOpportunity = await opportunityService.getOrThrow(opportunity.id);
      expect(finalOpportunity.status).toBe("KILLED");
    },
    { timeout: 60_000 },
  );
});

describe("outboundMessageService.send() governance — enforced on every call, manual or automatic", () => {
  it("is idempotent at the direct-call level — a second send() for an already-SENT message returns the same delivery without a second provider call", async () => {
    const { message } = await makeApprovedOutreachMessage();
    const first = await outboundMessageService.send({ outreachMessageId: message.id, actor: HUMAN_OWNER });
    const second = await outboundMessageService.send({ outreachMessageId: message.id, actor: HUMAN_OWNER });
    expect(second.id).toBe(first.id);
    const deliveries = await outreachMessageDeliveryRepository.listForMessage(message.id);
    expect(deliveries).toHaveLength(1);
  });

  it("a stale approval (the message changed after approval) blocks send — a human must re-approve the current content", async () => {
    const { message } = await makeApprovedOutreachMessage();
    await prisma.outreachMessage.update({ where: { id: message.id }, data: { content: `${message.content} — CHANGED AFTER APPROVAL` } });

    await expect(outboundMessageService.send({ outreachMessageId: message.id, actor: HUMAN_OWNER })).rejects.toThrow(/STALE_APPROVAL/);
    const deliveries = await outreachMessageDeliveryRepository.listForMessage(message.id);
    expect(deliveries).toHaveLength(0);
  });

  it("Emergency Stop blocks send — fails closed, the same gate every EXECUTE step already respects", async () => {
    const { message } = await makeApprovedOutreachMessage();
    await emergencyStopService.activate({ actor: authActor(), reason: "test: verifying send() fails closed" });

    await expect(outboundMessageService.send({ outreachMessageId: message.id, actor: HUMAN_OWNER })).rejects.toThrow();
    const deliveries = await outreachMessageDeliveryRepository.listForMessage(message.id);
    expect(deliveries).toHaveLength(0);
  });

  it("Company Budget exhaustion blocks send and raises a BUDGET_EXHAUSTED alert — the bug where the check result was discarded is fixed", async () => {
    const { message, agents } = await makeApprovedOutreachMessage();
    const execution = await agentExecutionRepository.create({ agentId: agents.ceoAgent.id, taskId: null, startedByIdentityId: HUMAN_OWNER.actorId, input: "autonomous-operations test — overspend" });
    await agentExecutionRepository.update(execution.id, { estimatedCostUsd: 100000 });

    await expect(outboundMessageService.send({ outreachMessageId: message.id, actor: HUMAN_OWNER })).rejects.toThrow(/Company Budget exceeded/);
    const deliveries = await outreachMessageDeliveryRepository.listForMessage(message.id);
    expect(deliveries).toHaveLength(0);

    const alerts = await alertService.list();
    expect(alerts.some((a) => a.alertType === "BUDGET_EXHAUSTED" && a.resourceType === "OUTREACH_MESSAGE" && a.resourceId === message.id)).toBe(true);
  });

  it("bounded retry: a message that has already failed MAX_SEND_ATTEMPTS times is never retried automatically again", async () => {
    const { message } = await makeApprovedOutreachMessage();
    for (let i = 0; i < MAX_SEND_ATTEMPTS; i += 1) {
      await outreachMessageDeliveryRepository.create({
        outreachMessageId: message.id,
        provider: "DEV_FIXTURE",
        status: "FAILED",
        providerRef: "",
        detail: `test: simulated failed attempt ${i + 1}`,
        sentByIdentityId: HUMAN_OWNER.actorId,
        sentAt: new Date(),
      });
    }

    await expect(outboundMessageService.send({ outreachMessageId: message.id, actor: HUMAN_OWNER })).rejects.toThrow(/bounded retry exhausted/i);
    const deliveries = await outreachMessageDeliveryRepository.listForMessage(message.id);
    expect(deliveries).toHaveLength(MAX_SEND_ATTEMPTS);
  });

  it("rate limit: exceeding OUTBOUND_MESSAGE_RATE_LIMIT_PER_MINUTE blocks further sends", async () => {
    const { message } = await makeApprovedOutreachMessage();
    for (let i = 0; i < 5; i += 1) checkRateLimit("outbound_message", 5);

    await expect(outboundMessageService.send({ outreachMessageId: message.id, actor: HUMAN_OWNER })).rejects.toThrow(/rate limit/i);
    const deliveries = await outreachMessageDeliveryRepository.listForMessage(message.id);
    expect(deliveries).toHaveLength(0);
  });
});

describe("config-gated automations: real wiring when configured, real silence when not — never a guess at missing agent roles", () => {
  async function makeContactedMessageForResponse() {
    const draft = await makeDraftedOutreachMessage();
    const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: draft.message.id, requestedByAgentId: draft.agents.messageDrafterAgent.id });
    await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: HUMAN_OWNER });
    await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: HUMAN_OWNER });
    await messageApprovalService.markContacted({ outreachMessageId: draft.message.id, actor: HUMAN_OWNER });
    return draft;
  }

  it("CUSTOMER_RESPONSE_RECORDED, configured: responseAnalystService runs automatically the moment a response is recorded", async () => {
    await ensureSystemIdentity(authActor());
    const { agents, message } = await makeContactedMessageForResponse();
    registerAutonomousOperationsHandlers({ responseAnalystAgentId: agents.responseAnalystAgent.id });

    const response = await customerResponseService.record({
      outreachMessageId: message.id,
      rawContent: "We currently pay about $150/month for a partial workaround and it's still a hassle.",
      actor: HUMAN_OWNER,
    });

    const analyzed = await customerResponseService.getOrThrow(response.id);
    expect(analyzed.status).toBe("ANALYZED");
    expect(analyzed.classification).not.toBeNull();
  });

  it("CUSTOMER_RESPONSE_RECORDED, NOT configured: no responseAnalystAgentId means a real, permanent no-op — never a guess at which agent to use", async () => {
    const { message } = await makeContactedMessageForResponse();
    registerAutonomousOperationsHandlers({});

    const response = await customerResponseService.record({
      outreachMessageId: message.id,
      rawContent: "We currently pay about $150/month for a partial workaround and it's still a hassle.",
      actor: HUMAN_OWNER,
    });

    const stillReceived = await customerResponseService.getOrThrow(response.id);
    expect(stillReceived.status).toBe("RECEIVED");
    expect(stillReceived.classification).toBeNull();
  });

  it(
    "PRODUCT_APPROVED, configured: the unmodified M6 factory runs automatically all the way to a decidable HUMAN_REVIEW memo",
    async () => {
      const { agents, opportunity } = await makeAgentSetWithOpportunity();
      const product = await productService.create({ opportunityId: opportunity.id, createdByIdentityId: HUMAN_OWNER.actorId });

      await ensureSystemIdentity(authActor());
      registerAutonomousOperationsHandlers({
        ceoAgentId: agents.ceoAgent.id,
        productFactory: {
          strategistAgentId: agents.productStrategistAgent.id,
          architectAgentId: agents.mvpArchitectAgent.id,
          uxAgentId: agents.uxAgent.id,
          engineeringAgentId: agents.engineeringAgent.id,
          codeReviewAgentId: agents.codeReviewAgent.id,
          qaAgentId: agents.qaAgent.id,
          securityAgentId: agents.securityReviewAgent.id,
        },
      });

      await productService.approve({ id: product.id, actor: HUMAN_OWNER });

      const finalProduct = await productService.getOrThrow(product.id);
      expect(finalProduct.status).toBe("HUMAN_REVIEW");
    },
    { timeout: 120_000 },
  );

  it("PRODUCT_APPROVED, NOT configured: no productFactory config means the Product stays APPROVED — never an automatic build with guessed agent roles", async () => {
    const { agents, opportunity } = await makeAgentSetWithOpportunity();
    const product = await productService.create({ opportunityId: opportunity.id, createdByIdentityId: HUMAN_OWNER.actorId });
    void agents;

    registerAutonomousOperationsHandlers({});
    await productService.approve({ id: product.id, actor: HUMAN_OWNER });

    const finalProduct = await productService.getOrThrow(product.id);
    expect(finalProduct.status).toBe("APPROVED");
  });
});

describe("dispatch defensively ignores decisions it does not own", () => {
  it("a real HUMAN_DECISION_MADE from a memo service (source: LAUNCH_REVIEW_MEMO, not APPROVAL_REQUEST) is never mistaken for an ApprovalRequest decision", async () => {
    registerAutonomousOperationsHandlers({});
    const chain = await makeAwaitingLaunchApprovalProduct();

    await launchReviewMemoService.recordHumanDecision({ memoId: chain.memo.id, humanDecision: "APPROVE", humanReason: null, actor: HUMAN_OWNER });

    // The unrelated DeploymentPlan this memo decision has nothing to do with is untouched — proving the guard discriminated by source, not merely no-op'd for some other reason.
    const plan = await deploymentPlanService.getOrThrow(chain.deploymentPlan.id);
    expect(plan.status).toBe("DRAFT");
  });
});
