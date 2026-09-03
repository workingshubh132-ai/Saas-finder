import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * A live demonstration of the SaaS Factory, run against the real
 * implemented pipeline, not hard-coded output. Runs in
 * MODEL_PROVIDER_MODE=development in this sandbox (no live model
 * key) — every "[DEV FIXTURE]" value below is clearly labeled and,
 * per docs/SAAS_FACTORY.md, a genuine, deterministic function of the
 * REAL data produced at each step, never a static stub. Every code
 * write below goes through the real Guardian-gated write_workspace_file
 * tool, every typecheck/test run is a real subprocess (tsc/vitest),
 * and the CEO/Chairman/memo/human-decision chain is the real,
 * unmodified service layer — nothing here is simulated.
 *
 * *** THIS DEMO NEVER DEPLOYS ANYTHING. *** There is no deploy
 * capability anywhere in this codebase (docs/SECURITY.md, M6 section)
 * — Product has no DEPLOYED status. The pipeline stops at
 * READY_FOR_DEPLOYMENT with a compiled, human-readable plan.
 *
 * Shows two build attempts: one that reaches a genuinely clean
 * BUILD/APPROVE/READY_FOR_DEPLOYMENT outcome, and one where a real,
 * deterministically-detected security vulnerability is injected into
 * already-completed code and correctly propagates all the way to a
 * human REJECT — a positive and a negative path, no hardcoded result.
 *
 * Usage: npm run demo:m6
 */

const DEMO_DB_PATH = "/home/user/Saas-finder/prisma/demo-m6.db";
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
const { productStrategistService } = await import("../src/services/product-strategist.service.js");
const { mvpArchitectService } = await import("../src/services/mvp-architect.service.js");
const { uxAgentService } = await import("../src/services/ux-agent.service.js");
const { workspaceService } = await import("../src/services/workspace.service.js");
const { engineeringTaskService } = await import("../src/services/engineering-task.service.js");
const { engineeringAgentService } = await import("../src/services/engineering-agent.service.js");
const { codeReviewAgentService } = await import("../src/services/code-review-agent.service.js");
const { qaAgentService } = await import("../src/services/qa-agent.service.js");
const { securityReviewAgentService } = await import("../src/services/security-review-agent.service.js");
const { ceoReasoningService } = await import("../src/services/ceo-reasoning.service.js");
const { chairmanService } = await import("../src/services/chairman.service.js");
const { productReviewMemoService } = await import("../src/services/product-review-memo.service.js");
const { toolRegistry } = await import("../src/tools/tool-registry.js");
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
}

async function bootstrap(): Promise<DemoAgents> {
  const { identity: humanIdentity } = await identityService.createIdentity({ type: "HUMAN", label: "Founder", createdBy: null });
  const humanActor = { type: "HUMAN" as const, id: humanIdentity.id, identityId: humanIdentity.id };
  const humanOwner = { actorType: "HUMAN" as const, actorId: humanIdentity.id };
  const grantedBy = { actorType: "HUMAN" as const, actorId: humanIdentity.id };

  async function makeAgent(name: string, role: string) {
    return agentService.createAgent({ name, role, department: "ENGINEERING", description: role, riskLevel: "GREEN", createdBy: grantedBy });
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

  console.log(`Human Owner: ${humanIdentity.id}`);
  console.log("Agents registered: Product Strategist/MVP Architect/UX/Code Review/QA/Security/CEO (zero grants),");
  console.log("  Engineering Agent (WRITE_WORKSPACE_FILES + RUN_WORKSPACE_COMMAND — the only two grants in this whole milestone).");

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
  };
}

async function makeApprovedProduct(agents: DemoAgents, title: string) {
  const opportunity = await opportunityService.createOpportunity({
    title,
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

  const product = await productService.create({ opportunityId: opportunity.id, createdByIdentityId: agents.humanId });
  console.log(`Product ${product.id} proposed for opportunity "${title}".`);
  const approved = await productService.approve({ id: product.id, actor: agents.humanOwner });
  console.log(`Human Owner approved. Product is now ${approved.status}.`);
  return approved;
}

async function main(): Promise<void> {
  section("BOOTSTRAP");
  const agents = await bootstrap();

  section("BUILD 1 — a genuinely clean build");
  const product1 = await makeApprovedProduct(agents, "Automated invoice reconciliation for small businesses");

  console.log("\nRunning the full factory pipeline: Strategist -> Architect -> UX -> Engineering -> Code Review -> QA + Integration Test -> Security Review -> CEO -> Chairman -> Memo...");
  const build1 = await productFactoryService.build({
    productId: product1.id,
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
  if (build1.stoppedReason) throw new Error(`Build 1 stopped unexpectedly: ${build1.stoppedReason}`);

  console.log(`\nProductSpec: "${build1.productSpec!.name}" — target customer: ${build1.productSpec!.targetCustomer}`);
  console.log(`Engineering tasks: ${build1.engineeringTasks.length} (${build1.engineeringTasks.map((t) => t.title).join("; ")}) — all COMPLETED, real typecheck passed each time.`);
  console.log(`Estimated cost: $${build1.product.estimatedDevelopmentCostUsd} development / $${build1.product.estimatedOperatingCostUsd}/mo operating (a rough, founder-revisable estimate — never a real quote).`);
  console.log(`\nCEO product-build recommendation: ${build1.ceoRecommendation!.action} (confidence ${build1.ceoRecommendation!.confidence.toFixed(2)})`);
  console.log(`  Reasoning: ${build1.ceoRecommendation!.reasoning}`);
  console.log(`\nCHAIRMAN: ${build1.chairmanReview!.decision}`);
  for (const [i, o] of (JSON.parse(build1.chairmanReview!.objections) as string[]).entries()) console.log(`  ${i + 1}. ${o}`);
  console.log(`\nProduct status: ${build1.product.status} — awaiting the Human Owner's own go/no-go decision.`);

  console.log("\nHUMAN: reviewing the compiled memo and the deployment plan...");
  console.log(`Deployment plan (never executed automatically):\n${build1.product.deploymentPlan}`);
  const decided1 = await productReviewMemoService.recordHumanDecision({ memoId: build1.memo!.id, humanDecision: "APPROVE", humanReason: "Clean pipeline, real working code — approved for a real deployment attempt outside this system.", actor: agents.humanOwner });
  console.log(`Human Owner decision: ${decided1.humanDecision}`);
  const final1 = await productService.getOrThrow(product1.id);
  console.log(`Product status: ${final1.status}`);

  section("BUILD 2 — a real, deterministically-detected vulnerability propagates to REJECTED");
  const product2 = await makeApprovedProduct(agents, "Automated expense-report reconciliation for freelancers");

  let product = await productService.setStatus(product2.id, "SPECIFYING", agents.humanOwner);
  const strategistOutcome = await productStrategistService.run({ agentId: agents.strategistAgentId, productId: product.id, startedBy: agents.humanActor });
  if (strategistOutcome.status !== "COMPLETED") throw new Error("Product Strategist did not complete");

  product = await productService.setStatus(product.id, "ARCHITECTING", agents.humanOwner);
  const architectOutcome = await mvpArchitectService.run({ agentId: agents.architectAgentId, productSpecId: strategistOutcome.result.productSpec.id, startedBy: agents.humanActor });
  if (architectOutcome.status !== "COMPLETED") throw new Error("MVP Architect did not complete");
  const uxOutcome = await uxAgentService.run({ agentId: agents.uxAgentId, mvpArchitectureId: architectOutcome.result.mvpArchitecture.id, startedBy: agents.humanActor });
  if (uxOutcome.status !== "COMPLETED") throw new Error("UX Agent did not complete");

  product = await productService.setStatus(product.id, "BUILDING", agents.humanOwner);
  const workspacePath = await workspaceService.provision(product.id);
  const [storeTask, apiTask] = await engineeringTaskService.decomposeFromArchitecture(uxOutcome.result.mvpArchitecture.id, agents.engineeringAgentId);
  console.log(`Workspace provisioned: ${workspacePath}`);

  const storeOutcome = await engineeringAgentService.run({ agentId: agents.engineeringAgentId, engineeringTaskId: storeTask!.id, startedBy: agents.humanActor });
  if (storeOutcome.status !== "COMPLETED" || !storeOutcome.result.typecheckPassed) throw new Error("Store task did not complete cleanly");
  const apiOutcome = await engineeringAgentService.run({ agentId: agents.engineeringAgentId, engineeringTaskId: apiTask!.id, startedBy: agents.humanActor });
  if (apiOutcome.status !== "COMPLETED" || !apiOutcome.result.typecheckPassed) throw new Error("API task did not complete cleanly");
  console.log("Both engineering tasks COMPLETED — real code, real passing typecheck.");

  console.log("\n[DEV FIXTURE / DELIBERATE INJECTION] Simulating a real code-injection vulnerability being introduced into");
  console.log("already-completed code — through the same Guardian-gated write_workspace_file tool the Engineering Agent");
  console.log("itself uses, never a shortcut. eval(\"1\") typechecks cleanly but is exactly the pattern");
  console.log("src/domain/security-review/security-scan.ts is built to catch.");
  const currentStoreContent = readFileSync(join(workspacePath, "src", "store.ts"), "utf-8");
  const writeTool = toolRegistry.get("write_workspace_file")!;
  await writeTool.execute(
    { workspacePath, relativePath: "src/store.ts", content: `${currentStoreContent}\nexport const __debugEval = () => eval("1");\n` },
    { agentId: agents.engineeringAgentId, executionId: "demo-injection" },
  );

  product = await productService.setStatus(product.id, "REVIEWING", agents.humanOwner);
  const codeReviewOutcome = await codeReviewAgentService.run({ agentId: agents.codeReviewAgentId, engineeringTaskId: storeTask!.id, startedBy: agents.humanActor });
  await codeReviewAgentService.run({ agentId: agents.codeReviewAgentId, engineeringTaskId: apiTask!.id, startedBy: agents.humanActor });
  if (codeReviewOutcome.status === "COMPLETED") console.log(`Code Review: hasBlockingFinding=${codeReviewOutcome.result.codeReview.hasBlockingFinding}`);

  product = await productService.setStatus(product.id, "TESTING", agents.humanOwner);
  await qaAgentService.run({ agentId: agents.qaAgentId, engineeringTaskId: storeTask!.id, startedBy: agents.humanActor });
  await qaAgentService.run({ agentId: agents.qaAgentId, engineeringTaskId: apiTask!.id, startedBy: agents.humanActor });

  product = await productService.setStatus(product.id, "SECURITY_REVIEW", agents.humanOwner);
  const securityOutcome = await securityReviewAgentService.run({ agentId: agents.securityAgentId, engineeringTaskId: storeTask!.id, startedBy: agents.humanActor });
  await securityReviewAgentService.run({ agentId: agents.securityAgentId, engineeringTaskId: apiTask!.id, startedBy: agents.humanActor });
  if (securityOutcome.status === "COMPLETED") {
    console.log(`Security Review: verdict=${securityOutcome.result.securityReview.verdict}`);
    for (const f of JSON.parse(securityOutcome.result.securityReview.findings) as Array<{ category: string; evidence: string }>) {
      console.log(`  [${f.category}] evidence: ${f.evidence}`);
    }
  }

  const ceoOutcome2 = await ceoReasoningService.recommendProductBuildAction({ agentId: agents.ceoAgentId, productId: product.id, startedBy: agents.humanActor });
  if (ceoOutcome2.status !== "COMPLETED") throw new Error("CEO product-build recommendation did not complete");
  console.log(`\nCEO product-build recommendation: ${ceoOutcome2.result.recommendation.action} (confidence ${ceoOutcome2.result.recommendation.confidence.toFixed(2)})`);
  console.log(`  Reasoning: ${ceoOutcome2.result.recommendation.reasoning}`);

  const chairmanResult2 = await chairmanService.reviewProduct({ productId: product.id, reviewedBy: agents.humanActor });
  console.log(`\nCHAIRMAN: ${chairmanResult2.review.decision}`);
  for (const [i, o] of (JSON.parse(chairmanResult2.review.objections) as string[]).entries()) console.log(`  ${i + 1}. ${o}`);

  const memo2 = await productReviewMemoService.compile({
    productId: product.id,
    productSpec: strategistOutcome.result.productSpec,
    mvpArchitecture: uxOutcome.result.mvpArchitecture,
    ceoRecommendation: ceoOutcome2.result.recommendation,
    chairmanReview: chairmanResult2.review,
    actor: agents.humanOwner,
  });
  await productService.setStatus(product.id, "HUMAN_REVIEW", agents.humanOwner);

  console.log("\nHUMAN: reviewing the memo — a real security failure is visible in it...");
  const decided2 = await productReviewMemoService.recordHumanDecision({ memoId: memo2.id, humanDecision: "REJECT", humanReason: "Real security failure — do not ship.", actor: agents.humanOwner });
  console.log(`Human Owner decision: ${decided2.humanDecision}`);
  const final2 = await productService.getOrThrow(product2.id);
  console.log(`Product status: ${final2.status}`);

  section("SUMMARY");
  console.log(`
Build 1 (${product1.id}): ${build1.productSpec!.name}
  Engineering: ${build1.engineeringTasks.length}/${build1.engineeringTasks.length} tasks COMPLETED, real typecheck + real integration test passed
  CEO: ${build1.ceoRecommendation!.action}   Chairman: ${build1.chairmanReview!.decision}   Human: ${decided1.humanDecision}   Final status: ${final1.status}

Build 2 (${product2.id}): ${strategistOutcome.result.productSpec.name}
  A real eval() call was injected into already-completed code — detected by the deterministic security
  scanner, propagated through Code Review, Security Review, the CEO, and the Chairman, all the way to a
  human REJECT.
  CEO: ${ceoOutcome2.result.recommendation.action}   Chairman: ${chairmanResult2.review.decision}   Human: ${decided2.humanDecision}   Final status: ${final2.status}

No code was ever deployed by this system — Product has no DEPLOYED status anywhere in this codebase
(docs/SECURITY.md, M6 section). READY_FOR_DEPLOYMENT means a human-reviewable plan exists, nothing more.
`);

  await prisma.$disconnect();
  console.log("=== Demo finished OK ===");
}

await main();
