import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

/**
 * A live demonstration of the Company Control Plane & Operating System,
 * run against the real implemented pipeline, not hard-coded output.
 * Runs in MODEL_PROVIDER_MODE=development in this sandbox (no live
 * model key) — every "[DEV FIXTURE]" value below is clearly labeled
 * and, per docs/COMPANY_CONTROL_PLANE.md, a genuine, deterministic
 * function of the REAL data seeded/produced at each step, never a
 * static stub.
 *
 * *** THIS DEMO NEVER TOUCHES ANYTHING REAL. *** No M9 agent role
 * exists at all — the CEO/Chairman entry points this milestone extends
 * run under the same identities M4 already created, and hold the same
 * zero Guardian permissions every prior milestone's CEO/Chairman axis
 * already held. `controlPlaneService` itself calls no execute-capable
 * service directly — every consequential step still goes through the
 * exact PLAN/APPROVE/EXECUTE chain M6/M7 already built and gated.
 *
 * Usage: npm run demo:m9
 */

const DEMO_DB_PATH = "/home/user/Saas-finder/prisma/demo-m9.db";
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
const { businessHealthRepository } = await import("../src/db/repositories/business-health.repository.js");
const { companyRecommendationRepository } = await import("../src/db/repositories/company-recommendation.repository.js");
const { companyReviewRepository } = await import("../src/db/repositories/company-review.repository.js");
const { companyRecommendationService } = await import("../src/services/company-recommendation.service.js");
const { controlPlaneService } = await import("../src/services/control-plane.service.js");
const { briefingService } = await import("../src/services/briefing.service.js");
const { founderCockpitService } = await import("../src/services/founder-cockpit.service.js");
const { decisionQualityService } = await import("../src/services/decision-quality.service.js");
const { toJsonString } = await import("../src/domain/shared/json.js");
const { StaleApprovalError, EmergencyStopActiveError } = await import("../src/domain/shared/errors.js");
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

  async function makeAgent(name: string, role: string, department: "ENGINEERING" | "OPERATIONS" | "EXECUTIVE" = "ENGINEERING") {
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
  const ceoAgent = await makeAgent("CEO", "CEO", "EXECUTIVE");
  const launchStrategistAgent = await makeAgent("Launch Strategist", "Launch Strategist", "OPERATIONS");
  const pricingAgent = await makeAgent("Pricing Agent", "Pricing Agent", "OPERATIONS");
  const gtmAgent = await makeAgent("GTM Agent", "GTM Agent", "OPERATIONS");

  console.log(`Human Owner: ${humanIdentity.id}`);
  console.log("Agents registered — every one reused from M4-M7's own roster; M9 adds NO new agent role at all.");
  console.log("The CEO agent below is the SAME identity that reasons about individual opportunities/products —");
  console.log("this demo simply calls its sixth, company-level axis (recommendCompanyAction).");

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

  section("M6/M7 RECAP — build a real product up to an approved-but-not-yet-executed deployment (unchanged)");
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
  console.log(`DeploymentPlan ${deploymentPlan!.id} is HUMAN_APPROVED, not yet executed.`);

  section("M9 — STALE-APPROVAL DETECTION (docs/M9_ARCHITECTURE_PROPOSAL.md §38-39): a resource changed after approval cannot execute on the old approval");
  const planBeforeTamper = await prisma.deploymentPlan.findUniqueOrThrow({ where: { id: deploymentPlan!.id } });
  const tamperedEnvironment = planBeforeTamper.environment === "PRODUCTION" ? "STAGING" : "PRODUCTION";
  await prisma.deploymentPlan.update({ where: { id: deploymentPlan!.id }, data: { environment: tamperedEnvironment } });
  console.log(`Simulating an out-of-band change: environment quietly changed ${planBeforeTamper.environment} -> ${tamperedEnvironment} after the human approved it.`);
  try {
    await deploymentService.execute({ deploymentPlanId: deploymentPlan!.id, actor: agents.humanOwner });
    throw new Error("Expected StaleApprovalError but execute() succeeded — this would be a real regression.");
  } catch (err) {
    if (!(err instanceof StaleApprovalError)) throw err;
    console.log(`EXECUTE refused: ${err.message}`);
  }
  await prisma.deploymentPlan.update({ where: { id: deploymentPlan!.id }, data: { environment: planBeforeTamper.environment } });
  console.log("Reverting the out-of-band change back to what the human actually approved...");
  const deployment = await deploymentService.execute({ deploymentPlanId: deploymentPlan!.id, actor: agents.humanOwner });
  const productId = productProposed.id;
  console.log(`EXECUTE succeeds now that the plan matches what was approved. Deployment ${deployment.id}, status ${deployment.status}. Product is now LIVE.`);

  section("M9 — SEEDING REAL BUSINESS HEALTH: strong composite score, but a genuinely unhealthy customer base");
  await businessHealthRepository.create({
    productId,
    productHealth: 0.75,
    customerHealth: 0.3,
    revenueHealth: 0.85,
    growthHealth: 0.85,
    marginHealth: 0.85,
    operationalHealth: 0.8,
    risk: 0.15,
    evidenceConfidence: 0.85,
    compositeScore: 0.75,
    state: "HEALTHY",
    reasons: toJsonString(["[DEMO] Strong revenue/growth/margin — but customer health is deliberately weak, a dimension the CEO's own reasoning doesn't examine on its own."]),
  });
  console.log("BusinessHealth seeded: state=HEALTHY (drives the CEO toward GROW), customerHealth=0.30 (the Chairman's own independent check).");

  section("M9 — A FULL OPERATING CYCLE, WITH A REAL CEO/CHAIRMAN CONFLICT (docs/M9_ARCHITECTURE_PROPOSAL.md §15-17, §31-34)");
  const cycle = await controlPlaneService.startCycle({
    definition: { objective: "Decide the company's next move", scope: "company-wide", maxCostUsd: 50, riskLevel: "GREEN", deadline: null, owner: agents.humanId },
    startedBy: agents.humanActor,
  });
  console.log(`OperatingCycle ${cycle.id} started — stage=${cycle.stage}, status=${cycle.status}.`);

  // 4 calls land the cycle AT stage=DECIDING (CREATED->PLANNING->RESEARCHING->ANALYZING->DECIDING transitions);
  // DECIDING's own handler — the real CEO -> Chairman axis — only runs on the 5th call, per
  // tests/integration/m9-capstone-operating-cycle.test.ts. Skipping that 5th call was a real bug this
  // demo caught on its first run: no CompanyRecommendation is created until DECIDING's handler actually executes.
  for (let i = 0; i < 5; i++) {
    const step = await controlPlaneService.runNextStage({ cycleId: cycle.id, actor: agents.humanActor, ceoAgentId: agents.ceoAgentId });
    console.log(`  -> now at stage=${step.stage}`);
  }
  console.log("DECIDING just ran the real CEO -> Chairman company-level axis and routed to AWAITING_HUMAN.");

  const recs = await companyRecommendationRepository.listForCycle(cycle.id);
  const recommendation = recs[0]!;
  const review = await companyReviewRepository.findLatestForRecommendation(recommendation.id);
  console.log(`\nCEO recommends: ${recommendation.action} (confidence ${recommendation.confidence.toFixed(2)})`);
  console.log(`  Reasoning: ${recommendation.reasoning}`);
  console.log(`\nCHAIRMAN reviews: ${review!.decision} (confidence ${review!.confidence.toFixed(2)})`);
  console.log(`  Objections: ${JSON.parse(review!.objections).join(" / ")}`);
  console.log(`\nconflictResolution=${recommendation.conflictResolution} — STOP -> HUMAN REVIEW is the only terminal state for a real conflict, never an automatic pick of either side.`);

  section("M9 — MID-CYCLE READS: the company stays fully queryable while a cycle is paused for human review");
  const companyState = await controlPlaneService.getCompanyState();
  console.log(`Company State: portfolioSize=${companyState.portfolioSize}, decisionBacklog=${companyState.decisionBacklog}, executionBacklog=${companyState.executionBacklog}`);
  const portfolio = await controlPlaneService.getPortfolio();
  console.log(`Portfolio: WINNERS=${portfolio.WINNERS.length}, KILL_CANDIDATES=${portfolio.KILL_CANDIDATES.length}, totalProducts=${portfolio.totalProducts}`);

  section("M9 — THE HUMAN OWNER DECIDES (the Chairman's disagreement is weighed, not obeyed — the human has the final say)");
  const decided = await companyRecommendationService.recordHumanDecision({
    companyRecommendationId: recommendation.id,
    decision: "APPROVE",
    reason: "Growth is worth pursuing; we'll watch customer health closely and course-correct if it doesn't improve.",
    actor: { actorType: "HUMAN", actorId: agents.humanId },
  });
  console.log(`Human Owner decision: ${decided.humanDecision} (conflictResolution remains ${decided.conflictResolution} — a permanent record of what happened, never overwritten).`);

  const resumed = await controlPlaneService.resumeFromAwaitingHuman({ cycleId: cycle.id, actor: agents.humanActor, decisionSummary: "Human approved the GROW recommendation despite the Chairman's customer-health objection." });
  console.log(`Cycle resumed: stage=${resumed.cycle.stage} (re-enters DECIDING itself, per resolveResumeStage's own history-based rule).`);

  for (let i = 0; i < 4; i++) {
    const step = await controlPlaneService.runNextStage({ cycleId: cycle.id, actor: agents.humanActor, ceoAgentId: agents.ceoAgentId });
    console.log(`  -> stage=${step.stage}, status=${step.status}`);
  }

  const finalCycle = await controlPlaneService.getCycle(cycle.id);
  console.log(`\nOperatingCycle ${finalCycle.id}: status=${finalCycle.status}, stage=${finalCycle.stage}`);
  const history = await controlPlaneService.getCycleStageHistory(cycle.id);
  console.log(`Stage history (${history.length} events): ${history.map((e) => e.stage).join(" -> ")}`);
  console.log("Note the AWAITING_HUMAN detour and DECIDING appearing twice — the first DECIDING event stayed open");
  console.log("(its real work wasn't finished until the human decided), so resuming correctly re-entered it rather than skipping ahead.");

  section("M9 — EMERGENCY STOP (docs/M9_ARCHITECTURE_PROPOSAL.md §57): the company-wide kill switch, fails closed");
  const cycle2 = await controlPlaneService.startCycle({ definition: { objective: "Week 2 planning", scope: "company-wide", maxCostUsd: 50, riskLevel: "GREEN", deadline: null, owner: agents.humanId }, startedBy: agents.humanActor });
  for (let i = 0; i < 5; i++) {
    await controlPlaneService.runNextStage({ cycleId: cycle2.id, actor: agents.humanActor, ceoAgentId: agents.ceoAgentId });
  }
  const recs2 = await companyRecommendationRepository.listForCycle(cycle2.id);
  await companyRecommendationService.recordHumanDecision({ companyRecommendationId: recs2[0]!.id, decision: "APPROVE", reason: "Consistent with last week's decision.", actor: { actorType: "HUMAN", actorId: agents.humanId } });
  await controlPlaneService.resumeFromAwaitingHuman({ cycleId: cycle2.id, actor: agents.humanActor, decisionSummary: "Approved." });

  await controlPlaneService.activateEmergencyStop({ actor: agents.humanActor, reason: "Demo: a founder wants to pause everything company-wide, right now." });
  console.log("Emergency Stop ACTIVATED. Attempting to advance the cycle into EXECUTING...");
  try {
    await controlPlaneService.runNextStage({ cycleId: cycle2.id, actor: agents.humanActor, ceoAgentId: agents.ceoAgentId });
    throw new Error("Expected EmergencyStopActiveError but the cycle advanced anyway — this would be a real regression.");
  } catch (err) {
    if (!(err instanceof EmergencyStopActiveError)) throw err;
    console.log(`Blocked, as expected: ${err.message}`);
  }
  await controlPlaneService.resumeFromEmergencyStop({ actor: agents.humanActor });
  console.log("Emergency Stop RESUMED by the Human Owner. Retrying...");
  const afterStop = await controlPlaneService.runNextStage({ cycleId: cycle2.id, actor: agents.humanActor, ceoAgentId: agents.ceoAgentId });
  console.log(`  -> stage=${afterStop.stage} — proceeds now that the stop is lifted.`);
  // afterStop lands on EXECUTING; 3 more calls (OBSERVING, LEARNING, COMPLETED) close the cycle out — same count as cycle 1's own post-resume loop.
  for (let i = 0; i < 3; i++) {
    await controlPlaneService.runNextStage({ cycleId: cycle2.id, actor: agents.humanActor, ceoAgentId: agents.ceoAgentId });
  }
  console.log(`OperatingCycle ${cycle2.id} final status: ${(await controlPlaneService.getCycle(cycle2.id)).status}`);

  section("M9 — THE WEEKEND BRIEFING (docs/M9_ARCHITECTURE_PROPOSAL.md §46): every statement cites a real id, never invented prose");
  const briefing = await briefingService.generate();
  const content = JSON.parse(briefing.content) as Record<string, unknown>;
  console.log(`Briefing ${briefing.id}: status=${briefing.status}`);
  console.log(`  COMPANY: ${JSON.stringify(content.COMPANY)}`);
  console.log(`  PORTFOLIO: ${JSON.stringify(content.PORTFOLIO)}`);

  section("M9 — THE FOUNDER COCKPIT (docs/M9_ARCHITECTURE_PROPOSAL.md §44): one screen, real aggregation");
  const cockpit = await founderCockpitService.getCockpit(agents.humanId);
  console.log(`Current cycle stage: ${cockpit.currentCycleStage}`);
  console.log(`Revenue ranking: ${JSON.stringify(cockpit.revenueRanking)}`);
  console.log(`Latest company recommendation: ${JSON.stringify(cockpit.latestCompanyRecommendation)}`);

  section("M9 — THE DECISION QUALITY DASHBOARD (docs/M9_ARCHITECTURE_PROPOSAL.md §29): calibration, never just being right");
  const dashboard = await decisionQualityService.getDashboard();
  console.log(`productBuilds.totalDecisions=${dashboard.productBuilds.totalDecisions}, launch.totalDecisions=${dashboard.launch.totalDecisions}`);
  console.log(`predictionAccuracyBySource: ${JSON.stringify(dashboard.predictionAccuracyBySource)}`);

  section("SUMMARY");
  console.log(`
Product:               ${(await productService.getOrThrow(productId)).status}, BusinessHealth HEALTHY, CEO recommended GROW
Cycle 1 (${cycle.id.slice(0, 8)}...):  ${finalCycle.status} — a real CEO/Chairman conflict, resolved only by a real human decision
Cycle 2 (${cycle2.id.slice(0, 8)}...):  blocked mid-flight by Emergency Stop, then resumed once a human lifted it

No M9 agent role exists — the CEO/Chairman entry points above are the same identities M4 already created,
holding the same zero Guardian permissions. controlPlaneService itself never called an execute-capable
service directly; every consequential step deferred to the same PLAN/APPROVE/EXECUTE chain M6/M7 already
gated. Every number above traces to a real, seeded row or a deterministically-computed one — no dev-fixture
value was ever presented as a real outcome.
`);

  await prisma.$disconnect();
  console.log("=== Demo finished OK ===");
}

await main();
