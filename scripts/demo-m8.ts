import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

/**
 * A live demonstration of the Revenue & Growth Intelligence Engine,
 * run against the real implemented pipeline, not hard-coded output.
 * Runs in MODEL_PROVIDER_MODE=development in this sandbox (no live
 * model key) — every "[DEV FIXTURE]" value below is clearly labeled
 * and, per docs/REVENUE_GROWTH_INTELLIGENCE.md, a genuine,
 * deterministic function of the REAL data seeded/produced at each
 * step, never a static stub.
 *
 * *** THIS DEMO NEVER TOUCHES ANYTHING REAL. *** Every provider
 * (revenue, analytics, product usage, customer data) is the
 * DEV_FIXTURE implementation only (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §31) — no real payment processor, no real analytics vendor, no real
 * credential of any kind exists in this codebase. The one
 * consequential action (starting a GrowthExperiment) is shown going
 * through the real PLAN -> APPROVE -> EXECUTE split
 * (docs/DECISIONS.md #58, #65): an agent proposes, the Human Owner
 * approves an exact, bound ApprovalRequest, and only a THIRD,
 * separate, human-triggered call ever starts it.
 *
 * Usage: npm run demo:m8
 */

const DEMO_DB_PATH = "/home/user/Saas-finder/prisma/demo-m8.db";
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
const { activationDefinitionRepository } = await import("../src/db/repositories/activation-definition.repository.js");
const { createAnalyticsProvider } = await import("../src/providers/analytics-provider-factory.js");
const { createRevenueProvider } = await import("../src/providers/revenue-provider-factory.js");
const { createCustomerDataProvider } = await import("../src/providers/customer-data-provider-factory.js");
const { businessIntelligenceService } = await import("../src/services/business-intelligence.service.js");
const { businessReviewMemoService } = await import("../src/services/business-review-memo.service.js");
const { experimentAnalystService } = await import("../src/services/experiment-analyst.service.js");
const { growthExperimentService } = await import("../src/services/growth-experiment.service.js");
const { growthExperimentExecutionService } = await import("../src/services/growth-experiment-execution.service.js");
const { growthAnalystService } = await import("../src/services/growth-analyst.service.js");
const { portfolioService } = await import("../src/services/portfolio.service.js");
const { prisma } = await import("../src/db/client.js");

registerDefaultTools();

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
  productIntelligenceAgentId: string;
  revenueAnalystAgentId: string;
  growthAnalystAgentId: string;
  customerIntelligenceAgentId: string;
  experimentAnalystAgentId: string;
  portfolioAnalystAgentId: string;
}

async function bootstrap(): Promise<DemoAgents> {
  const { identity: humanIdentity } = await identityService.createIdentity({ type: "HUMAN", label: "Founder", createdBy: null });
  const humanActor = { type: "HUMAN" as const, id: humanIdentity.id, identityId: humanIdentity.id };
  const humanOwner = { actorType: "HUMAN" as const, actorId: humanIdentity.id };
  const grantedBy = { actorType: "HUMAN" as const, actorId: humanIdentity.id };

  async function makeAgent(name: string, role: string, department: "ENGINEERING" | "OPERATIONS" | "GROWTH" | "INTELLIGENCE" = "ENGINEERING") {
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
  const productIntelligenceAgent = await makeAgent("Product Intelligence Agent", "Product Intelligence Agent", "INTELLIGENCE");
  const revenueAnalystAgent = await makeAgent("Revenue Analyst", "Revenue Analyst", "INTELLIGENCE");
  const growthAnalystAgent = await makeAgent("Growth Analyst", "Growth Analyst", "GROWTH");
  const customerIntelligenceAgent = await makeAgent("Customer Intelligence Agent", "Customer Intelligence Agent", "INTELLIGENCE");
  const experimentAnalystAgent = await makeAgent("Experiment Analyst", "Experiment Analyst", "GROWTH");
  const portfolioAnalystAgent = await makeAgent("Portfolio Analyst", "Portfolio Analyst", "INTELLIGENCE");

  console.log(`Human Owner: ${humanIdentity.id}`);
  console.log("Agents registered: every M8 agent (Product Intelligence, Revenue Analyst, Growth Analyst,");
  console.log("  Customer Intelligence, Experiment Analyst, Portfolio Analyst) holds ZERO Guardian permission");
  console.log("  grants — read-and-reason only (docs/DECISIONS.md #65).");

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
    productIntelligenceAgentId: productIntelligenceAgent.id,
    revenueAnalystAgentId: revenueAnalystAgent.id,
    growthAnalystAgentId: growthAnalystAgent.id,
    customerIntelligenceAgentId: customerIntelligenceAgent.id,
    experimentAnalystAgentId: experimentAnalystAgent.id,
    portfolioAnalystAgentId: portfolioAnalystAgent.id,
  };
}

/** Builds and launches a real product all the way to LIVE — M8 picks up from exactly this point (M6+M7, unchanged). */
async function buildAndLaunchToLive(agents: DemoAgents, title: string, opportunityDimensions: { pain: number; demand: number; willingnessToPay: number }): Promise<string> {
  const opportunity = await opportunityService.createOpportunity({
    title,
    problem: "Small business owners spend hours every month manually reconciling invoices against bank statements.",
    targetCustomer: "Small business owners and solo bookkeepers",
    description: "A focused tool that automates monthly invoice reconciliation.",
    discoveredBy: { actorType: "AGENT", actorId: agents.ceoAgentId },
  });
  await opportunityService.scoreOpportunity({
    opportunityId: opportunity.id,
    dimensions: { pain: opportunityDimensions.pain, demand: opportunityDimensions.demand, willingnessToPay: opportunityDimensions.willingnessToPay, reachability: 0.5, retention: 0.5, differentiation: 0.4, buildability: 0.7, economics: 0.5, risk: 0.3, evidenceQuality: 0.6, marketSize: 0.5, frequency: 0.5, evidenceIndependence: 0.5, timing: 0.5 },
    scoredBy: agents.ceoAgentId,
    killRiskDimensions: { weakDemand: 0.2, weakWillingnessToPay: 0.2, crowdedMarket: 0.3, poorDifferentiation: 0.3, badDistribution: 0.3, technicalDifficulty: 0.2, regulatoryRisk: 0.1, platformDependency: 0.1, lowRetention: 0.3, lowMargins: 0.3, insufficientEvidence: 0.2 },
  });
  await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "AGENT", actorId: agents.ceoAgentId });
  const productProposed = await productService.create({ opportunityId: opportunity.id, createdByIdentityId: agents.humanId });
  await productService.approve({ id: productProposed.id, actor: agents.humanOwner });

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
  await productReviewMemoService.recordHumanDecision({ memoId: build.memo!.id, humanDecision: "APPROVE", humanReason: "Ready to launch.", actor: agents.humanOwner });

  const launchSummary = await launchOperationsService.planLaunch({
    productId: productProposed.id,
    launchStrategistAgentId: agents.launchStrategistAgentId,
    pricingAgentId: agents.pricingAgentId,
    gtmAgentId: agents.gtmAgentId,
    ceoAgentId: agents.ceoAgentId,
    startedBy: agents.humanActor,
  });
  if (launchSummary.stoppedReason) throw new Error(`Launch planning stopped unexpectedly: ${launchSummary.stoppedReason}`);
  const { deploymentPlan, memo } = launchSummary;
  await launchReviewMemoService.recordHumanDecision({ memoId: memo!.id, humanDecision: "APPROVE", humanReason: "Launch thesis looks sound.", actor: agents.humanOwner });

  const deployApproval = await deploymentPlanService.requestApproval({ deploymentPlanId: deploymentPlan!.id, requestedByAgentId: agents.launchStrategistAgentId });
  await approvalService.decide({ id: deployApproval.id, toStatus: "APPROVED", reviewedBy: agents.humanOwner });
  await deploymentPlanService.applyDecision({ approvalRequestId: deployApproval.id, actor: agents.humanOwner });
  await deploymentService.execute({ deploymentPlanId: deploymentPlan!.id, actor: agents.humanOwner });

  const product = await productService.getOrThrow(productProposed.id);
  console.log(`"${title}" is now LIVE (product ${product.id}) — reached only through the real M6/M7 PLAN -> APPROVE -> EXECUTE chain.`);
  return product.id;
}

async function main(): Promise<void> {
  section("BOOTSTRAP");
  const agents = await bootstrap();

  section("M6/M7 RECAP — build and launch a real product to LIVE (docs/SAAS_FACTORY.md, docs/LAUNCH_OPERATIONS.md, unchanged)");
  const productId = await buildAndLaunchToLive(agents, "Automated invoice reconciliation for small businesses", { pain: 0.7, demand: 0.6, willingnessToPay: 0.6 });

  section("M8 — SEEDING REAL POST-LAUNCH DATA (through the real DEV_FIXTURE providers — never a hand-built row)");
  const now = new Date();
  await activationDefinitionRepository.create({ productId, eventName: "core_action", definedBy: "founder" });
  const analytics = createAnalyticsProvider();
  const revenue = createRevenueProvider();
  const customerData = createCustomerDataProvider();

  let userCounter = 0;
  async function seedCohort(cohortSize: number, daysAgo: number, activatedFraction: number, retainedFraction: number): Promise<void> {
    const signedUpAt = new Date(now.getTime() - daysAgo * DAY_MS);
    const activatedCount = Math.round(cohortSize * activatedFraction);
    const retainedCount = Math.round(activatedCount * retainedFraction);
    for (let i = 0; i < cohortSize; i += 1) {
      userCounter += 1;
      const userRef = `demo-user-${userCounter}`;
      await analytics.track({ name: "signup", productId, properties: {}, userRef, occurredAt: signedUpAt });
      if (i < activatedCount) await analytics.track({ name: "core_action", productId, properties: {}, userRef, occurredAt: new Date(signedUpAt.getTime() + DAY_MS) });
      if (i < retainedCount) await analytics.track({ name: "core_action", productId, properties: {}, userRef, occurredAt: new Date(signedUpAt.getTime() + 31 * DAY_MS) });
    }
  }
  await seedCohort(10, 45, 0.9, 0.9);
  await seedCohort(15, 10, 0.9, 0);
  console.log("Seeded 25 real signup events (2 cohorts) through DevAnalyticsProvider — 90% activation, real 30-day-old retention-eligible cohort.");

  for (let i = 0; i < 3; i += 1) {
    await revenue.recordSubscription({ id: `demo-sub-${i}`, productId, monthlyValueUsd: 30, startedAt: new Date(now.getTime() - 60 * DAY_MS) });
  }
  console.log("Seeded 3 real, diversified $30/mo subscriptions through DevRevenueProvider ($90 MRR, no single customer over 50% concentration).");

  const devCustomerData = customerData as unknown as { addFeedback: (input: { productId: string; respondentRef: string; excerpt: string; sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null; collectedAt: Date }) => void };
  devCustomerData.addFeedback({ productId, respondentRef: "cust-1", excerpt: "This solved our reconciliation workflow completely.", sentiment: "POSITIVE", collectedAt: now });
  devCustomerData.addFeedback({ productId, respondentRef: "cust-2", excerpt: "We upgraded seats after two weeks — clear value.", sentiment: "POSITIVE", collectedAt: now });
  devCustomerData.addFeedback({ productId, respondentRef: "cust-3", excerpt: "Exactly what we needed, no complaints so far.", sentiment: "POSITIVE", collectedAt: now });
  console.log("Seeded 3 real, independent, positive-sentiment feedback items through DevCustomerDataProvider.");

  section("M8 — THE FULL INTELLIGENCE LOOP: businessIntelligenceService.analyze()");
  console.log("Running Product Intelligence -> Revenue Analyst -> Growth Analyst -> Customer Intelligence -> claim upserts -> BusinessHealth -> CEO -> Chairman -> Memo...");
  const summary1 = await businessIntelligenceService.analyze({
    productId,
    productIntelligenceAgentId: agents.productIntelligenceAgentId,
    revenueAnalystAgentId: agents.revenueAnalystAgentId,
    growthAnalystAgentId: agents.growthAnalystAgentId,
    customerIntelligenceAgentId: agents.customerIntelligenceAgentId,
    ceoAgentId: agents.ceoAgentId,
    startedBy: agents.humanActor,
  });
  if (summary1.stoppedReason) throw new Error(`Business intelligence analysis stopped unexpectedly: ${summary1.stoppedReason}`);
  const health1 = summary1.businessHealth!;
  console.log(`\nBusinessHealth: state=${health1.state}, compositeScore=${health1.compositeScore.toFixed(2)}, risk=${health1.risk.toFixed(2)}, evidenceConfidence=${health1.evidenceConfidence.toFixed(2)}`);
  console.log(`  dimensions: product=${health1.productHealth.toFixed(2)} customer=${health1.customerHealth.toFixed(2)} revenue=${health1.revenueHealth.toFixed(2)} growth=${health1.growthHealth.toFixed(2)} margin=${health1.marginHealth.toFixed(2)} operational=${health1.operationalHealth.toFixed(2)}`);
  console.log(`\nCEO business-action recommendation: ${summary1.ceoRecommendation!.action} (confidence ${summary1.ceoRecommendation!.confidence.toFixed(2)})`);
  console.log(`  Reasoning: ${summary1.ceoRecommendation!.reasoning}`);
  console.log(`\nCHAIRMAN review: ${summary1.chairmanReview!.decision} (confidence ${summary1.chairmanReview!.confidence.toFixed(2)})`);
  console.log(`\nBusinessReviewMemo ${summary1.memo!.id}: recommendation=${summary1.memo!.recommendation}`);

  section("HUMAN GATE — the memo's own recommendation is strategic guidance; INVEST never itself spends anything");
  const decided1 = await businessReviewMemoService.recordHumanDecision({ memoId: summary1.memo!.id, humanDecision: "APPROVE", humanReason: "Strong real signal across the board.", actor: agents.humanOwner });
  console.log(`Human Owner decision: ${decided1.humanDecision}. Product status: ${(await productService.getOrThrow(productId)).status} (unchanged for INVEST).`);

  section("M8 — GROWTH EXPERIMENT: PROPOSE -> APPROVE -> RUN -> COMPLETE -> feeds the NEXT analysis");
  const proposeOutcome = await experimentAnalystService.run({ agentId: agents.experimentAnalystAgentId, productId, targetMetricType: "CONVERSION_RATE", startedBy: agents.humanActor });
  if (proposeOutcome.status !== "COMPLETED") throw new Error("Experiment Analyst did not complete");
  const experiment = proposeOutcome.result.growthExperiment;
  console.log(`Experiment Analyst proposed: "${experiment.hypothesis}" (status: ${experiment.status}, targets claim ${proposeOutcome.result.targetClaim.claimType})`);

  const expApproval = await growthExperimentService.requestApproval({ growthExperimentId: experiment.id, requestedByAgentId: agents.experimentAnalystAgentId });
  console.log(`ApprovalRequest ${expApproval.id}: action=${expApproval.action}, riskLevel=${expApproval.riskLevel}, bound to GrowthExperiment ${expApproval.resourceId}.`);
  await approvalService.decide({ id: expApproval.id, toStatus: "APPROVED", reviewedBy: agents.humanOwner });
  await growthExperimentService.applyDecision({ approvalRequestId: expApproval.id, actor: agents.humanOwner });
  const running = await growthExperimentExecutionService.approveToRun({ growthExperimentId: experiment.id, actor: agents.humanOwner });
  console.log(`Human Owner started the experiment. Status: ${running.status}.`);

  const { result: expResult } = await growthExperimentExecutionService.completeExperiment({ growthExperimentId: experiment.id, baselineValue: 100, experimentValue: 120, sampleSize: 50, limitations: "Single-cohort dev-fixture observation window." });
  console.log(`Real observed outcome: ${(expResult.observedChangePct * 100).toFixed(1)}% change, confidence=${expResult.confidence} (from sample size alone, never a fabricated p-value), decision=${expResult.decision}`);

  const growthOutcome = await growthAnalystService.run({ agentId: agents.growthAnalystAgentId, productId, startedBy: agents.humanActor });
  if (growthOutcome.status !== "COMPLETED") throw new Error("Growth Analyst did not complete");
  console.log(`Growth Analyst's very next run reads this real result: promisingChannel="${growthOutcome.result.output.promisingChannel}"`);

  section("M8 — A SECOND PRODUCT WITH REAL DECLINE, FOR PORTFOLIO COMPARISON");
  const productId2 = await buildAndLaunchToLive(agents, "Automated meeting-notes summarizer", { pain: 0.4, demand: 0.3, willingnessToPay: 0.2 });
  await opportunityService.scoreOpportunity({
    opportunityId: (await productService.getOrThrow(productId2)).opportunityId,
    dimensions: { pain: 0.3, demand: 0.3, willingnessToPay: 0.2, reachability: 0.3, retention: 0.2, differentiation: 0.2, buildability: 0.5, economics: 0.2, risk: 0.8, evidenceQuality: 0.3, marketSize: 0.3, frequency: 0.3, evidenceIndependence: 0.3, timing: 0.3 },
    scoredBy: "founder-rescore",
    killRiskDimensions: { weakDemand: 0.9, weakWillingnessToPay: 0.9, crowdedMarket: 0.9, poorDifferentiation: 0.9, badDistribution: 0.9, technicalDifficulty: 0.9, regulatoryRisk: 0.9, platformDependency: 0.9, lowRetention: 0.9, lowMargins: 0.9, insufficientEvidence: 0.9 },
  });
  await activationDefinitionRepository.create({ productId: productId2, eventName: "core_action", definedBy: "founder" });
  async function seedCohort2(cohortSize: number, daysAgo: number, activatedFraction: number): Promise<void> {
    const signedUpAt = new Date(now.getTime() - daysAgo * DAY_MS);
    const activatedCount = Math.round(cohortSize * activatedFraction);
    for (let i = 0; i < cohortSize; i += 1) {
      userCounter += 1;
      const userRef = `demo-user2-${userCounter}`;
      await analytics.track({ name: "signup", productId: productId2, properties: {}, userRef, occurredAt: signedUpAt });
      if (i < activatedCount) await analytics.track({ name: "core_action", productId: productId2, properties: {}, userRef, occurredAt: new Date(signedUpAt.getTime() + DAY_MS) });
    }
  }
  await seedCohort2(20, 45, 0.1);
  await seedCohort2(5, 10, 0.1);
  for (let i = 0; i < 3; i += 1) {
    const id = `demo-sub2-${i}`;
    await revenue.recordSubscription({ id, productId: productId2, monthlyValueUsd: 40, startedAt: new Date(now.getTime() - 60 * DAY_MS) });
    await revenue.cancelSubscription({ id, cancelledAt: new Date(now.getTime() - (10 - i) * DAY_MS) });
  }
  devCustomerData.addFeedback({ productId: productId2, respondentRef: "cust2-1", excerpt: "Stopped working for us after week two.", sentiment: "NEGATIVE", collectedAt: now });
  devCustomerData.addFeedback({ productId: productId2, respondentRef: "cust2-2", excerpt: "Cancelled — unresolved issues.", sentiment: "NEGATIVE", collectedAt: now });
  devCustomerData.addFeedback({ productId: productId2, respondentRef: "cust2-3", excerpt: "Support never fixed our core complaint.", sentiment: "NEGATIVE", collectedAt: now });
  console.log("Seeded real declining signups, fully churned revenue, and recurring negative feedback for the second product.");

  const summary2 = await businessIntelligenceService.analyze({
    productId: productId2,
    productIntelligenceAgentId: agents.productIntelligenceAgentId,
    revenueAnalystAgentId: agents.revenueAnalystAgentId,
    growthAnalystAgentId: agents.growthAnalystAgentId,
    customerIntelligenceAgentId: agents.customerIntelligenceAgentId,
    ceoAgentId: agents.ceoAgentId,
    startedBy: agents.humanActor,
  });
  if (summary2.stoppedReason) throw new Error(`Business intelligence analysis stopped unexpectedly: ${summary2.stoppedReason}`);
  console.log(`\nSecond product BusinessHealth: state=${summary2.businessHealth!.state} — CEO: ${summary2.ceoRecommendation!.action}`);

  section("M8 — PORTFOLIO COMPARISON: two real products, compared on Constitution §19's own vocabulary");
  const portfolio = await portfolioService.analyzePortfolio({ agentId: agents.portfolioAnalystAgentId, ceoAgentId: agents.ceoAgentId, productIds: [productId, productId2], startedBy: agents.humanActor });
  for (const snap of portfolio.snapshots) {
    console.log(`  [${snap.productId === productId ? "Product 1 (healthy)" : "Product 2 (declining)"}] recommendation=${snap.recommendation} — ${snap.reasoning}`);
  }
  console.log(`\n${portfolio.triggeredReviews.length} RETIRE/PIVOT-triggered CEO review(s) ran automatically — never a bypass of the normal CEO -> Chairman -> Memo chain.`);
  if (portfolio.triggeredReviews.length > 0) {
    const triggered = portfolio.triggeredReviews[0]!;
    const decided2 = await businessReviewMemoService.recordHumanDecision({ memoId: triggered.memo!.id, humanDecision: "APPROVE", humanReason: "Real decline confirmed across signups, revenue, and sentiment.", actor: agents.humanOwner });
    console.log(`Human Owner decision on the triggered review: ${decided2.humanDecision}. Product 2 status: ${(await productService.getOrThrow(productId2)).status}`);
  }

  section("SUMMARY");
  console.log(`
Product 1 (healthy):    ${(await productService.getOrThrow(productId)).status} — BusinessHealth ${health1.state}, CEO ${summary1.ceoRecommendation!.action}
Product 2 (declining):  ${(await productService.getOrThrow(productId2)).status} — BusinessHealth ${summary2.businessHealth!.state}, CEO ${summary2.ceoRecommendation!.action}

Every number above traces to a real, provider-sourced or deterministically-computed BusinessMetric row,
structurally labeled OBSERVED/ESTIMATED/INFERRED/PREDICTED (Section 1's own non-negotiable). No M8 agent
ever held a permission above GREEN; the one consequential action (the growth experiment) went through a
real human PLAN -> APPROVE -> EXECUTE chain, never autonomously. No real customer, revenue, or market
outcome is claimed anywhere above — every provider is DEV_FIXTURE only.
`);

  await prisma.$disconnect();
  console.log("=== Demo finished OK ===");
}

await main();
