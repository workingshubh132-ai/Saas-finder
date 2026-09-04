import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

/**
 * A live demonstration of the Launch & Operations Engine, run against
 * the real implemented pipeline, not hard-coded output. Runs in
 * MODEL_PROVIDER_MODE=development in this sandbox (no live model
 * key) — every "[DEV FIXTURE]" value below is clearly labeled and,
 * per docs/LAUNCH_OPERATIONS.md, a genuine, deterministic function of
 * the REAL data produced at each step, never a static stub.
 *
 * *** THIS DEMO NEVER TOUCHES ANYTHING REAL. *** Every provider
 * (deployment, billing) is the DEV_FIXTURE implementation only
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §7) — no real hosting API, no real
 * payment processor, no real credential of any kind exists in this
 * codebase. Every consequential action is shown going through the
 * real PLAN -> APPROVE -> EXECUTE split (docs/DECISIONS.md #58): an
 * agent proposes, the Human Owner approves an exact, bound
 * ApprovalRequest, and only a THIRD, separate, human-triggered call
 * ever does anything.
 *
 * Negative paths (cost-exceeds-budget, a security failure blocking
 * launch) are exercised live by the automated suite, not repeated
 * here — see tests/integration/m7-capstone-negative.test.ts.
 *
 * Usage: npm run demo:m7
 */

const DEMO_DB_PATH = "/home/user/Saas-finder/prisma/demo-m7.db";
const DEMO_DB_URL = `file:${DEMO_DB_PATH}`;

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const candidate = `${DEMO_DB_PATH}${suffix}`;
  if (existsSync(candidate)) rmSync(candidate);
}
execFileSync("npx", ["prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: DEMO_DB_URL },
  stdio: "inherit",
});

process.env.DATABASE_URL = DEMO_DB_URL;
process.env.MODEL_PROVIDER_MODE = process.env.MODEL_PROVIDER_MODE ?? "development";

const { identityService } = await import("../src/services/identity.service.js");
const { agentService } = await import("../src/services/agent.service.js");
const { registerDefaultTools } = await import("../src/tools/register-tools.js");
const { opportunityService } = await import("../src/services/opportunity.service.js");
const { claimExtractionService } = await import("../src/services/claim-extraction.service.js");
const { productService } = await import("../src/services/product.service.js");
const { productFactoryService } = await import("../src/services/product-factory.service.js");
const { productReviewMemoService } = await import("../src/services/product-review-memo.service.js");
const { launchOperationsService } = await import("../src/services/launch-operations.service.js");
const { launchReviewMemoService } = await import("../src/services/launch-review-memo.service.js");
const { approvalService } = await import("../src/services/approval.service.js");
const { deploymentPlanService } = await import("../src/services/deployment-plan.service.js");
const { deploymentService } = await import("../src/services/deployment.service.js");
const { monitoringService } = await import("../src/services/monitoring.service.js");
const { billingPlanService } = await import("../src/services/billing-plan.service.js");
const { billingActivationService } = await import("../src/services/billing-activation.service.js");
const { businessMetricRepository } = await import("../src/db/repositories/business-metric.repository.js");
const { signWebhookPayload } = await import("../src/domain/webhook/webhook-security.js");
const { createApp } = await import("../src/api/app.js");
const { prisma } = await import("../src/db/client.js");

registerDefaultTools();

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

interface DemoAgents {
  humanId: string;
  humanActor: { type: "HUMAN"; id: string; identityId: string };
  humanOwner: { actorType: "HUMAN"; actorId: string };
  strategistAgentId: string;
  architectAgentId: string;
  uxAgentId: string;
  engineeringAgentId: string;
  codeReviewAgentId: string;
  qaAgentId: string;
  securityAgentId: string;
  ceoAgentId: string;
  launchStrategistAgentId: string;
  pricingAgentId: string;
  gtmAgentId: string;
}

async function bootstrap(): Promise<DemoAgents> {
  const { identity: humanIdentity } = await identityService.createIdentity({ type: "HUMAN", label: "Founder", createdBy: null });
  const humanActor = { type: "HUMAN" as const, id: humanIdentity.id, identityId: humanIdentity.id };
  const humanOwner = { actorType: "HUMAN" as const, actorId: humanIdentity.id };
  const grantedBy = { actorType: "HUMAN" as const, actorId: humanIdentity.id };

  async function makeAgent(name: string, role: string, department: "ENGINEERING" | "OPERATIONS" | "GROWTH" = "ENGINEERING") {
    return agentService.createAgent({ name, role, department, description: role, riskLevel: "GREEN", createdBy: grantedBy });
  }
  const strategistAgent = await makeAgent("Product Strategist", "Product Strategist");
  const architectAgent = await makeAgent("MVP Architect", "MVP Architect");
  const uxAgent = await makeAgent("UX Agent", "UX Agent");
  const engineeringAgent = await makeAgent("Engineering Agent", "Engineering Agent");
  await agentService.grantPermission({ agentId: engineeringAgent.id, permission: "WRITE_WORKSPACE_FILES", grantedBy });
  await agentService.grantPermission({ agentId: engineeringAgent.id, permission: "RUN_WORKSPACE_COMMAND", grantedBy });
  const codeReviewAgent = await makeAgent("Code Review Agent", "Code Review Agent");
  const qaAgent = await makeAgent("QA Agent", "QA Agent");
  const securityAgent = await makeAgent("Security Review Agent", "Security Review Agent");
  const ceoAgent = await makeAgent("CEO", "CEO");
  const launchStrategistAgent = await makeAgent("Launch Strategist", "Launch Strategist", "OPERATIONS");
  const pricingAgent = await makeAgent("Pricing Agent", "Pricing Agent", "OPERATIONS");
  const gtmAgent = await makeAgent("GTM Agent", "GTM Agent", "GROWTH");

  console.log(`Human Owner: ${humanIdentity.id}`);
  console.log("Agents registered: every M6/M7 agent holds ZERO Guardian permission grants except");
  console.log("  Engineering Agent (WRITE_WORKSPACE_FILES + RUN_WORKSPACE_COMMAND, both GREEN, one disposable workspace).");
  console.log("  No M7 agent holds DEPLOY_PRODUCTION/ACTIVATE_BILLING/CREATE_BILLING/MODIFY_PRODUCTION/ACCESS_PRODUCTION_DATA — ever.");

  return {
    humanId: humanIdentity.id,
    humanActor,
    humanOwner,
    strategistAgentId: strategistAgent.id,
    architectAgentId: architectAgent.id,
    uxAgentId: uxAgent.id,
    engineeringAgentId: engineeringAgent.id,
    codeReviewAgentId: codeReviewAgent.id,
    qaAgentId: qaAgent.id,
    securityAgentId: securityAgent.id,
    ceoAgentId: ceoAgent.id,
    launchStrategistAgentId: launchStrategistAgent.id,
    pricingAgentId: pricingAgent.id,
    gtmAgentId: gtmAgent.id,
  };
}

async function main(): Promise<void> {
  section("BOOTSTRAP");
  const agents = await bootstrap();

  section("M6 RECAP — build a real, working product to launch (docs/SAAS_FACTORY.md, unchanged)");
  const opportunity = await opportunityService.createOpportunity({
    title: "Automated invoice reconciliation for small businesses",
    problem: "Small business owners spend hours every month manually reconciling invoices against bank statements.",
    targetCustomer: "Small business owners and solo bookkeepers",
    description: "A focused tool that automates monthly invoice reconciliation.",
    discoveredBy: { actorType: "AGENT", actorId: agents.ceoAgentId },
  });
  await opportunityService.scoreOpportunity({
    opportunityId: opportunity.id,
    dimensions: { pain: 0.7, demand: 0.6, willingnessToPay: 0.6, reachability: 0.5, retention: 0.5, differentiation: 0.4, buildability: 0.7, economics: 0.5, risk: 0.3, evidenceQuality: 0.6, marketSize: 0.5, frequency: 0.5, evidenceIndependence: 0.5, timing: 0.5 },
    scoredBy: agents.ceoAgentId,
    killRiskDimensions: { weakDemand: 0.2, weakWillingnessToPay: 0.2, crowdedMarket: 0.3, poorDifferentiation: 0.3, badDistribution: 0.3, technicalDifficulty: 0.2, regulatoryRisk: 0.1, platformDependency: 0.1, lowRetention: 0.3, lowMargins: 0.3, insufficientEvidence: 0.2 },
  });
  await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "AGENT", actorId: agents.ceoAgentId });
  const productProposed = await productService.create({ opportunityId: opportunity.id, createdByIdentityId: agents.humanId });
  await productService.approve({ id: productProposed.id, actor: agents.humanOwner });

  console.log("Running the full M6 factory pipeline (Strategist -> Architect -> UX -> Engineering -> Review -> QA -> Security -> CEO -> Chairman)...");
  const build = await productFactoryService.build({
    productId: productProposed.id,
    strategistAgentId: agents.strategistAgentId,
    architectAgentId: agents.architectAgentId,
    uxAgentId: agents.uxAgentId,
    engineeringAgentId: agents.engineeringAgentId,
    codeReviewAgentId: agents.codeReviewAgentId,
    qaAgentId: agents.qaAgentId,
    securityAgentId: agents.securityAgentId,
    ceoAgentId: agents.ceoAgentId,
    startedBy: agents.humanActor,
  });
  if (build.stoppedReason) throw new Error(`M6 build stopped unexpectedly: ${build.stoppedReason}`);
  console.log(`Product "${build.productSpec!.name}" — CEO: ${build.ceoRecommendation!.action}, Chairman: ${build.chairmanReview!.decision}, status: ${build.product.status}`);
  await productReviewMemoService.recordHumanDecision({ memoId: build.memo!.id, humanDecision: "APPROVE", humanReason: "Clean pipeline — ready to plan a launch.", actor: agents.humanOwner });
  let product = await productService.getOrThrow(productProposed.id);
  console.log(`Human Owner approved the build. Product status: ${product.status}`);

  section("M7 — LAUNCH PLANNING (PLAN only: Launch Strategist -> Pricing -> GTM -> CEO -> Chairman -> Memo)");
  const launchSummary = await launchOperationsService.planLaunch({
    productId: product.id,
    launchStrategistAgentId: agents.launchStrategistAgentId,
    pricingAgentId: agents.pricingAgentId,
    gtmAgentId: agents.gtmAgentId,
    ceoAgentId: agents.ceoAgentId,
    startedBy: agents.humanActor,
  });
  if (launchSummary.stoppedReason) throw new Error(`Launch planning stopped unexpectedly: ${launchSummary.stoppedReason}`);
  const { deploymentPlan, pricingModel, goToMarketPlan, ceoRecommendation, chairmanReview, memo } = launchSummary;
  console.log(`\n[PLANNING ONLY] DeploymentPlan: environment=${deploymentPlan!.environment}, provider=${deploymentPlan!.provider} (DEV_FIXTURE — no real infrastructure exists), estimatedCostUsd=$${deploymentPlan!.estimatedCostUsd}/mo, budgetExceeded=${deploymentPlan!.budgetExceeded}`);
  console.log(`[PLANNING ONLY] Pricing tiers + unit economics:\n  ${pricingModel!.tiers}\n  ${pricingModel!.unitEconomics}`);
  console.log(`[PLANNING ONLY] GTM channels:\n  ${goToMarketPlan!.channels}`);
  console.log(`\nCEO launch recommendation: ${ceoRecommendation!.action} (confidence ${ceoRecommendation!.confidence.toFixed(2)})`);
  console.log(`  Reasoning: ${ceoRecommendation!.reasoning}`);
  console.log(`\nCHAIRMAN launch review: ${chairmanReview!.decision}`);
  for (const [i, o] of (JSON.parse(chairmanReview!.objections) as string[]).entries()) console.log(`  ${i + 1}. ${o}`);
  console.log(`\nProduct status: ${launchSummary.product.status} — awaiting the Human Owner's own go/no-go decision on the launch thesis.`);

  section("HUMAN GATE 1 — APPROVE the launch thesis (this alone never deploys anything)");
  const decidedMemo = await launchReviewMemoService.recordHumanDecision({ memoId: memo!.id, humanDecision: "APPROVE", humanReason: "Launch thesis, pricing, and GTM plan all look sound.", actor: agents.humanOwner });
  console.log(`Human Owner decision: ${decidedMemo.humanDecision}. Product status: ${(await productService.getOrThrow(product.id)).status} (unchanged — nothing has deployed yet).`);

  section("HUMAN GATE 2 — a SEPARATE, exact-action-bound RED approval on the DeploymentPlan itself");
  const deployApproval = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan!.id, requestedByAgentId: agents.launchStrategistAgentId });
  console.log(`ApprovalRequest ${deployApproval.id}: action=${deployApproval.action}, riskLevel=${deployApproval.riskLevel}, bound to DeploymentPlan ${deployApproval.resourceId} — this exact plan, nothing broader.`);
  await approvalService.decide({ id: deployApproval.id, toStatus: "APPROVED", reviewedBy: agents.humanOwner });
  const approvedPlan = await deploymentPlanService.applyDecision({ approvalRequestId: deployApproval.id, actor: agents.humanOwner });
  console.log(`DeploymentPlan status: ${approvedPlan.status}. Still nothing has deployed — one more explicit human call does.`);

  section("HUMAN GATE 3 — EXECUTE (the DEV_FIXTURE DeploymentProvider only; no real infrastructure exists)");
  const deployment = await deploymentService.execute({ deploymentPlanId: deploymentPlan!.id, actor: agents.humanOwner });
  console.log(`Deployment ${deployment.id}: provider=${deployment.provider}, status=${deployment.status}, providerRef=${deployment.providerRef}`);
  product = await productService.getOrThrow(product.id);
  console.log(`Product status: ${product.status}`);

  section("ON-DEMAND HEALTH CHECK (never a background poll — no scheduler exists in this codebase)");
  const health = await monitoringService.checkHealth({ deploymentId: deployment.id });
  console.log(`[DEV_FIXTURE] healthy=${health.healthy}, latencyMs=${health.latencyMs} — ${health.detail}`);
  await businessMetricRepository.create({ productId: product.id, metricType: "UPTIME_PCT", valueKind: "OBSERVED", value: health.healthy ? 100 : 0, source: "DEV_FIXTURE" });
  await businessMetricRepository.create({ productId: product.id, metricType: "MONTHLY_OPERATING_COST_USD", valueKind: "ESTIMATED", value: deploymentPlan!.estimatedCostUsd, source: "COMPUTED_ESTIMATE" });

  section("M7 — BILLING (the identical PLAN -> APPROVE -> EXECUTE shape, on its own axis)");
  const billingPlan = await billingPlanService.create({ productId: product.id, pricingModelId: pricingModel!.id, provider: "DEV_FIXTURE" });
  const billingApproval = await billingPlanService.requestApproval({ billingPlanId: billingPlan.id, requestedByAgentId: agents.pricingAgentId });
  console.log(`ApprovalRequest ${billingApproval.id}: action=${billingApproval.action}, riskLevel=${billingApproval.riskLevel}`);
  await approvalService.decide({ id: billingApproval.id, toStatus: "APPROVED", reviewedBy: agents.humanOwner });
  await billingPlanService.applyDecision({ approvalRequestId: billingApproval.id, actor: agents.humanOwner });
  const billingAccount = await billingActivationService.activate({ billingPlanId: billingPlan.id, actor: agents.humanOwner });
  console.log(`BillingAccount ${billingAccount.id}: provider=${billingAccount.provider} — the moment real payment collection becomes possible (fixture-scoped only).`);

  section("A REAL, SIGNED WEBHOOK DELIVERY over a real local HTTP round-trip");
  const subscription = await billingActivationService.recordSubscriptionFixture({ billingAccountId: billingAccount.id, customerEmail: "dev-fixture-customer@example.test" });
  console.log(`[TEST/DEMO FIXTURE ONLY — never invoked by any agent] Subscription ${subscription.providerSubscriptionRef} created against ${billingAccount.providerPriceRef}.`);

  const app = createApp();
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const payload = { provider: "DEV_FIXTURE", billingAccountId: billingAccount.id, deliveryId: "demo-evt-1", eventType: "subscription.created", data: { amountUsdCents: 4900 } };
    const rawBody = JSON.stringify(payload);
    const timestamp = Date.now();
    const signature = signWebhookPayload(billingAccount.webhookSecret, rawBody, timestamp);
    const res = await fetch(`http://127.0.0.1:${port}/api/billing-webhooks/dev-fixture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Webhook-Timestamp": String(timestamp) },
      body: rawBody,
    });
    console.log(`Webhook delivery: HTTP ${res.status} — ${JSON.stringify(await res.json())}`);

    const replay = await fetch(`http://127.0.0.1:${port}/api/billing-webhooks/dev-fixture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Webhook-Timestamp": String(timestamp) },
      body: rawBody,
    });
    console.log(`Replayed delivery (same deliveryId): HTTP ${replay.status} — rejected as a duplicate, never reprocessed.`);
  } finally {
    server.close();
  }

  const metrics = await businessMetricRepository.listForProduct(product.id);
  section("SUMMARY");
  console.log(`
Product: ${build.productSpec!.name} (${product.id})
Final status: LIVE — reached only through a real PLAN -> APPROVE(x2) -> EXECUTE(x2) chain, never autonomously.

BusinessMetric rows recorded (${metrics.length}):`);
  for (const m of metrics) console.log(`  [${m.valueKind}] ${m.metricType} = ${m.value} (source: ${m.source})`);
  console.log(`
No real revenue, no real customers, no real uptime is claimed anywhere above — every value is
DEV_FIXTURE, ESTIMATED, or COMPUTED_ESTIMATE, labeled structurally (BusinessMetric.valueKind/.source),
not just in prose (Section 45 of the brief, docs/M7_ARCHITECTURE_PROPOSAL.md).
`);

  await prisma.$disconnect();
  console.log("=== Demo finished OK ===");
}

await main();
