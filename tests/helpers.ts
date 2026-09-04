import type { Agent, DeploymentPlan, EngineeringTask, GoToMarketPlan, LaunchPlan, LaunchReviewMemo, MvpArchitecture, Opportunity, PricingModel, Problem, Product, ProductSpec, Prospect, SignalCluster } from "@prisma/client";
import { agentService, type CreateAgentParams } from "../src/services/agent.service.js";
import { signalClusterRepository } from "../src/db/repositories/signal-cluster.repository.js";
import { activationDefinitionRepository } from "../src/db/repositories/activation-definition.repository.js";
import { claimExtractionService } from "../src/services/claim-extraction.service.js";
import { deploymentPlanService } from "../src/services/deployment-plan.service.js";
import { deploymentService } from "../src/services/deployment.service.js";
import { engineeringAgentService } from "../src/services/engineering-agent.service.js";
import { engineeringTaskService } from "../src/services/engineering-task.service.js";
import { launchOperationsService } from "../src/services/launch-operations.service.js";
import { launchReviewMemoService } from "../src/services/launch-review-memo.service.js";
import { mvpArchitectService } from "../src/services/mvp-architect.service.js";
import { opportunityService } from "../src/services/opportunity.service.js";
import type { OpportunityScoreDimensions } from "../src/services/opportunity-scorer.js";
import type { KillRiskDimensions } from "../src/services/kill-risk-scorer.js";
import { problemService } from "../src/services/problem.service.js";
import { productFactoryService } from "../src/services/product-factory.service.js";
import { productReviewMemoService } from "../src/services/product-review-memo.service.js";
import { productService } from "../src/services/product.service.js";
import { productStrategistService } from "../src/services/product-strategist.service.js";
import { prospectService, type CreateProspectParams } from "../src/services/prospect.service.js";
import { uxAgentService } from "../src/services/ux-agent.service.js";
import { workspaceService } from "../src/services/workspace.service.js";
import { approvalService } from "../src/services/approval.service.js";
import { createAnalyticsProvider } from "../src/providers/analytics-provider-factory.js";
import { createRevenueProvider } from "../src/providers/revenue-provider-factory.js";
import { createCustomerDataProvider } from "../src/providers/customer-data-provider-factory.js";
import type { DevCustomerDataProvider } from "../src/providers/dev-customer-data-provider.js";
import { humanOwner } from "./setup.js";

export { humanOwner as HUMAN_OWNER } from "./setup.js";

let counter = 0;

export async function makeAgent(overrides: Partial<CreateAgentParams> = {}): Promise<Agent> {
  counter += 1;
  return agentService.createAgent({
    name: `Test Agent ${counter}`,
    role: "Researcher",
    department: "INTELLIGENCE",
    description: "A test agent.",
    riskLevel: "GREEN",
    createdBy: humanOwner,
    ...overrides,
  });
}

/** The M2 `AuthenticatedActor` shape (distinct from the M1 `Actor` shape `humanOwner` already is —
 *  docs/DECISIONS.md #14) for callers like chairmanService/researchAgentService that require it. */
export function authActor(): { type: "HUMAN"; id: string; identityId: string } {
  return { type: "HUMAN", id: humanOwner.actorId, identityId: humanOwner.actorId };
}

export async function makeCluster(overrides: Partial<{ name: string; summary: string }> = {}): Promise<SignalCluster> {
  counter += 1;
  return signalClusterRepository.create({ name: `Test cluster ${counter}`, summary: "A recurring workflow problem for small business owners.", ...overrides });
}

/** A CANDIDATE Problem with sufficient evidenceCount/confidence to
 *  pass every downstream promotion bar by default — override to test
 *  edge cases (e.g. status: "INSUFFICIENT_EVIDENCE"). */
export async function makeProblem(overrides: Partial<Parameters<typeof problemService.create>[0]> = {}): Promise<Problem> {
  const cluster = overrides.clusterId ? null : await makeCluster();
  const agent = overrides.collectedByAgentId ? null : await makeAgent();
  return problemService.create({
    clusterId: cluster?.id ?? (overrides.clusterId as string),
    statement: "Small business owners spend hours reconciling invoices manually every month.",
    customerSegment: "Small business owners",
    workflow: "Monthly invoice reconciliation",
    pain: "Hours of manual, error-prone reconciliation",
    frequency: "Monthly",
    currentSolution: "Spreadsheets",
    dissatisfaction: "High",
    urgency: "Medium",
    willingnessToPaySignal: "Some businesses pay for partial tools already",
    evidenceCount: 3,
    confidence: 0.6,
    status: "CANDIDATE",
    collectedByAgentId: agent?.id ?? (overrides.collectedByAgentId as string),
    ...overrides,
  });
}

const DEFAULT_SCORE_DIMENSIONS: OpportunityScoreDimensions = {
  pain: 0.7,
  demand: 0.7,
  willingnessToPay: 0.6,
  reachability: 0.6,
  retention: 0.6,
  differentiation: 0.5,
  buildability: 0.7,
  economics: 0.6,
  risk: 0.3,
  evidenceQuality: 0.7,
  marketSize: 0.6,
  frequency: 0.6,
  evidenceIndependence: 0.6,
  timing: 0.5,
};

const DEFAULT_KILL_RISK_DIMENSIONS: KillRiskDimensions = {
  weakDemand: 0.2,
  weakWillingnessToPay: 0.2,
  crowdedMarket: 0.3,
  poorDifferentiation: 0.3,
  badDistribution: 0.3,
  technicalDifficulty: 0.3,
  regulatoryRisk: 0.1,
  platformDependency: 0.1,
  lowRetention: 0.3,
  lowMargins: 0.3,
  insufficientEvidence: 0.2,
};

/**
 * A scored Opportunity created directly (not via the full M3 research
 * pipeline) — for M4 tests that need a real, valid Opportunity as
 * their starting point without re-exercising signal collection/
 * clustering/problem extraction every time (docs/M4_ARCHITECTURE_PROPOSAL.md
 * §28's own claim-extraction/Validator/CEO/Chairman/memo tests only
 * need an already-scored opportunity, not a freshly discovered one —
 * the M3 pipeline itself stays covered by its own M3 test suite).
 */
export async function makeOpportunity(overrides: Partial<{ title: string; problem: string; targetCustomer: string; description: string; problemId: string | null }> = {}): Promise<Opportunity> {
  counter += 1;
  const created = await opportunityService.createOpportunity({
    title: `Test Opportunity ${counter}`,
    problem: "Small business owners spend hours reconciling invoices manually every month.",
    targetCustomer: "Small business owners",
    description: "A focused tool that automates monthly invoice reconciliation.",
    discoveredBy: humanOwner,
    ...overrides,
  });
  return opportunityService.scoreOpportunity({
    opportunityId: created.id,
    dimensions: DEFAULT_SCORE_DIMENSIONS,
    scoredBy: "test-helper",
    killRiskDimensions: DEFAULT_KILL_RISK_DIMENSIONS,
  });
}

export interface FullAgentSet {
  researchAgent: Agent;
  problemAgent: Agent;
  competitorAgent: Agent;
  marketAgent: Agent;
  opportunityAgent: Agent;
  validatorAgent: Agent;
  ceoAgent: Agent;
  /** M5 — docs/M5_ARCHITECTURE_PROPOSAL.md §24. Zero grants, like ceoAgent/opportunityAgent (pure reasoning over already-provided data). */
  icpAnalystAgent: Agent;
  prospectQualificationAgent: Agent;
  messageDrafterAgent: Agent;
  responseAnalystAgent: Agent;
  /** M6 — docs/M6_ARCHITECTURE_PROPOSAL.md §23. Zero grants: pure synthesis over already-persisted rows. */
  productStrategistAgent: Agent;
  mvpArchitectAgent: Agent;
  uxAgent: Agent;
  /** M6 — the only two agents in the whole system granted WRITE_WORKSPACE_FILES/RUN_WORKSPACE_COMMAND (both GREEN, confined to one disposable workspace directory). */
  engineeringAgent: Agent;
  codeReviewAgent: Agent;
  qaAgent: Agent;
  securityReviewAgent: Agent;
  /** M7 — docs/M7_ARCHITECTURE_PROPOSAL.md §30. Zero grants, like productStrategistAgent/ceoAgent (pure synthesis/reasoning over already-persisted rows; every M7 EXECUTE step is human-actor-only, never an agent tool call). */
  launchStrategistAgent: Agent;
  pricingAgent: Agent;
  gtmAgent: Agent;
  supportAgent: Agent;
  /** M8 — docs/M8_ARCHITECTURE_PROPOSAL.md §24. Zero grants — every M8 agent only reads provider data and reasons over it. */
  productIntelligenceAgent: Agent;
  revenueAnalystAgent: Agent;
  growthAnalystAgent: Agent;
  customerIntelligenceAgent: Agent;
  experimentAnalystAgent: Agent;
  portfolioAnalystAgent: Agent;
}

/** Every agent role M3+M4's pipelines need, correctly permissioned (docs/M4_ARCHITECTURE_PROPOSAL.md §23). */
export async function makeFullAgentSet(): Promise<FullAgentSet> {
  const researchAgent = await makeAgent({ role: "Research Agent" });
  await agentService.grantPermission({ agentId: researchAgent.id, permission: "READ_WEB", grantedBy: humanOwner });
  const problemAgent = await makeAgent({ role: "Problem Analyst" });
  const competitorAgent = await makeAgent({ role: "Competitor Analyst" });
  await agentService.grantPermission({ agentId: competitorAgent.id, permission: "READ_WEB", grantedBy: humanOwner });
  const marketAgent = await makeAgent({ role: "Market Analyst" });
  const opportunityAgent = await makeAgent({ role: "Opportunity Analyst" });
  const validatorAgent = await makeAgent({ role: "Evidence Validator" });
  await agentService.grantPermission({ agentId: validatorAgent.id, permission: "READ_WEB", grantedBy: humanOwner });
  const ceoAgent = await makeAgent({ role: "CEO" });
  const icpAnalystAgent = await makeAgent({ role: "ICP Analyst" });
  const prospectQualificationAgent = await makeAgent({ role: "Prospect Qualification" });
  const messageDrafterAgent = await makeAgent({ role: "Message Drafter" });
  const responseAnalystAgent = await makeAgent({ role: "Response Analyst" });
  const productStrategistAgent = await makeAgent({ role: "Product Strategist" });
  const mvpArchitectAgent = await makeAgent({ role: "MVP Architect" });
  const uxAgent = await makeAgent({ role: "UX Agent" });
  const engineeringAgent = await makeAgent({ role: "Engineering Agent" });
  await agentService.grantPermission({ agentId: engineeringAgent.id, permission: "WRITE_WORKSPACE_FILES", grantedBy: humanOwner });
  await agentService.grantPermission({ agentId: engineeringAgent.id, permission: "RUN_WORKSPACE_COMMAND", grantedBy: humanOwner });
  const codeReviewAgent = await makeAgent({ role: "Code Review Agent" });
  const qaAgent = await makeAgent({ role: "QA Agent" });
  const securityReviewAgent = await makeAgent({ role: "Security Review Agent" });
  const launchStrategistAgent = await makeAgent({ role: "Launch Strategist" });
  const pricingAgent = await makeAgent({ role: "Pricing Agent" });
  const gtmAgent = await makeAgent({ role: "GTM Agent" });
  const supportAgent = await makeAgent({ role: "Support Agent" });
  const productIntelligenceAgent = await makeAgent({ role: "Product Intelligence Agent" });
  const revenueAnalystAgent = await makeAgent({ role: "Revenue Analyst" });
  const growthAnalystAgent = await makeAgent({ role: "Growth Analyst" });
  const customerIntelligenceAgent = await makeAgent({ role: "Customer Intelligence Agent" });
  const experimentAnalystAgent = await makeAgent({ role: "Experiment Analyst" });
  const portfolioAnalystAgent = await makeAgent({ role: "Portfolio Analyst" });
  return {
    researchAgent,
    problemAgent,
    competitorAgent,
    marketAgent,
    opportunityAgent,
    validatorAgent,
    ceoAgent,
    icpAnalystAgent,
    prospectQualificationAgent,
    messageDrafterAgent,
    responseAnalystAgent,
    productStrategistAgent,
    mvpArchitectAgent,
    uxAgent,
    engineeringAgent,
    codeReviewAgent,
    qaAgent,
    securityReviewAgent,
    launchStrategistAgent,
    pricingAgent,
    gtmAgent,
    supportAgent,
    productIntelligenceAgent,
    revenueAnalystAgent,
    growthAnalystAgent,
    customerIntelligenceAgent,
    experimentAnalystAgent,
    portfolioAnalystAgent,
  };
}

/** A DISCOVERED Prospect with plausible defaults — override organization/role/icpProfileId to test specific qualification outcomes (docs/M5_ARCHITECTURE_PROPOSAL.md §4-5). */
export async function makeProspect(overrides: Partial<Omit<CreateProspectParams, "actorType" | "actorId">> & Pick<CreateProspectParams, "opportunityId" | "icpProfileId">): Promise<Prospect> {
  counter += 1;
  const agent = overrides.discoveredByAgentId ? null : await makeAgent({ role: "Prospect Researcher" });
  return prospectService.create({
    organization: `Test Org ${counter}`,
    role: "Small business owner",
    publicContactChannel: `https://dev-fixture.local/test-prospect-${counter}`,
    source: "hacker_news",
    sourceUrl: `https://dev-fixture.local/test-prospect-${counter}`,
    discoveredByAgentId: agent?.id ?? (overrides.discoveredByAgentId as string),
    actorType: "SYSTEM",
    actorId: null,
    ...overrides,
  });
}

export interface ProductChain {
  agents: FullAgentSet;
  opportunity: Opportunity;
  product: Product;
  productSpec: ProductSpec;
  mvpArchitecture: MvpArchitecture;
}

export interface AgentSetWithOpportunity {
  agents: FullAgentSet;
  opportunity: Opportunity;
}

/**
 * A real Opportunity with real extracted claims and a full M6 agent
 * set — no Product created yet. For a test that itself exercises
 * Product creation/approval (e.g. over HTTP), as distinct from
 * makeApprovedProduct()'s own further-advanced starting point.
 */
export async function makeAgentSetWithOpportunity(): Promise<AgentSetWithOpportunity> {
  const agents = await makeFullAgentSet();
  const opportunity = await makeOpportunity();
  await claimExtractionService.extractForOpportunity({ opportunityId: opportunity.id, actorType: "SYSTEM", actorId: null });
  return { agents, opportunity };
}

export interface ApprovedProductChain extends AgentSetWithOpportunity {
  product: Product;
}

/**
 * makeAgentSetWithOpportunity(), plus a human-APPROVED Product — the
 * starting point productFactoryService.build() itself needs (it runs
 * the Strategist -> Architect -> UX -> Engineering -> ... chain
 * internally), as distinct from makeMvpArchitecture()'s own
 * further-advanced starting point for tests of individual downstream
 * agents.
 */
export async function makeApprovedProduct(): Promise<ApprovedProductChain> {
  const { agents, opportunity } = await makeAgentSetWithOpportunity();

  const product = await productService.create({ opportunityId: opportunity.id, createdByIdentityId: humanOwner.actorId });
  await productService.approve({ id: product.id, actor: humanOwner });

  return { agents, opportunity, product };
}

/**
 * The full M6 pipeline up through a UX-complete MvpArchitecture — a
 * real Opportunity with real extracted claims, a human-APPROVED
 * Product, and the Product Strategist -> MVP Architect -> UX Agent
 * chain run for real (dev-fixture model responses, real persistence,
 * real audit trail). The shared starting point every M6 downstream
 * test (engineering tasks, code review, QA, security review) needs,
 * mirroring makeContactedMessage's own role in the M5 test suite.
 */
export async function makeMvpArchitecture(): Promise<ProductChain> {
  const { agents, opportunity, product } = await makeApprovedProduct();

  const strategistOutcome = await productStrategistService.run({ agentId: agents.productStrategistAgent.id, productId: product.id, startedBy: authActor() });
  if (strategistOutcome.status !== "COMPLETED") throw new Error("productStrategistService.run did not complete");

  const architectOutcome = await mvpArchitectService.run({ agentId: agents.mvpArchitectAgent.id, productSpecId: strategistOutcome.result.productSpec.id, startedBy: authActor() });
  if (architectOutcome.status !== "COMPLETED") throw new Error("mvpArchitectService.run did not complete");

  const uxOutcome = await uxAgentService.run({ agentId: agents.uxAgent.id, mvpArchitectureId: architectOutcome.result.mvpArchitecture.id, startedBy: authActor() });
  if (uxOutcome.status !== "COMPLETED") throw new Error("uxAgentService.run did not complete");

  return { agents, opportunity, product, productSpec: strategistOutcome.result.productSpec, mvpArchitecture: uxOutcome.result.mvpArchitecture };
}

export interface CompletedEngineeringTaskChain extends ProductChain {
  workspacePath: string;
  storeTask: EngineeringTask;
  apiTask: EngineeringTask;
}

/**
 * makeMvpArchitecture(), provisioned and decomposed into its two real
 * engineering tasks, with the store task actually implemented by the
 * real Engineering Agent (real workspace files, real typecheck) — the
 * shared "there is real, COMPLETED code to judge" starting point
 * Code Review, QA, and Security Review tests all need.
 */
export async function makeCompletedEngineeringTask(): Promise<CompletedEngineeringTaskChain> {
  const chain = await makeMvpArchitecture();
  const workspacePath = await workspaceService.provision(chain.product.id);
  const [storeTask, apiTask] = await engineeringTaskService.decomposeFromArchitecture(chain.mvpArchitecture.id, chain.agents.engineeringAgent.id);

  const outcome = await engineeringAgentService.run({ agentId: chain.agents.engineeringAgent.id, engineeringTaskId: storeTask!.id, startedBy: authActor() });
  if (outcome.status !== "COMPLETED" || !outcome.result.typecheckPassed) throw new Error("engineeringAgentService.run did not complete the store task");

  return { ...chain, workspacePath, storeTask: outcome.result.task, apiTask: apiTask! };
}

export interface ReadyForDeploymentChain {
  agents: FullAgentSet;
  opportunity: Opportunity;
  product: Product;
}

/**
 * The full M6 pipeline through a real human APPROVE decision — the
 * exact sequence tests/integration/m6-capstone.test.ts's own positive
 * path already exercises (makeApprovedProduct -> productFactoryService.build
 * -> HUMAN_REVIEW -> recordHumanDecision(APPROVE) -> READY_FOR_DEPLOYMENT),
 * factored out here as the shared starting point every M7 test needs
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §1: "M7 picks up from exactly that
 * point"). Slow (real tsc/vitest runs inside the pipeline) — callers
 * need a generous timeout, same as the M6 capstone's own 120_000ms.
 */
export async function makeReadyForDeploymentProduct(): Promise<ReadyForDeploymentChain> {
  const { agents, product } = await makeApprovedProduct();
  const summary = await productFactoryService.build({
    productId: product.id,
    strategistAgentId: agents.productStrategistAgent.id,
    architectAgentId: agents.mvpArchitectAgent.id,
    uxAgentId: agents.uxAgent.id,
    engineeringAgentId: agents.engineeringAgent.id,
    codeReviewAgentId: agents.codeReviewAgent.id,
    qaAgentId: agents.qaAgent.id,
    securityAgentId: agents.securityReviewAgent.id,
    ceoAgentId: agents.ceoAgent.id,
    startedBy: authActor(),
  });
  if (summary.product.status !== "HUMAN_REVIEW" || !summary.memo) {
    throw new Error(`productFactoryService.build did not reach a decidable HUMAN_REVIEW memo (status: ${summary.product.status}, stoppedReason: ${summary.stoppedReason})`);
  }
  await productReviewMemoService.recordHumanDecision({ memoId: summary.memo.id, humanDecision: "APPROVE", humanReason: null, actor: humanOwner });

  const finalProduct = await productService.getOrThrow(product.id);
  if (finalProduct.status !== "READY_FOR_DEPLOYMENT") {
    throw new Error(`Product did not reach READY_FOR_DEPLOYMENT after human APPROVE (status: ${finalProduct.status})`);
  }
  const opportunity = await opportunityService.getOrThrow(finalProduct.opportunityId);
  return { agents, opportunity, product: finalProduct };
}

export interface AwaitingLaunchApprovalChain extends ReadyForDeploymentChain {
  launchPlan: LaunchPlan;
  deploymentPlan: DeploymentPlan;
  pricingModel: PricingModel;
  goToMarketPlan: GoToMarketPlan;
  memo: LaunchReviewMemo;
}

/**
 * makeReadyForDeploymentProduct(), plus a real, compiled LaunchReviewMemo
 * in AWAITING_LAUNCH_APPROVAL — the shared starting point every test of
 * the deployment/billing approve-and-execute flow needs
 * (docs/M7_ARCHITECTURE_PROPOSAL.md §5, §17, §28-31).
 */
export async function makeAwaitingLaunchApprovalProduct(): Promise<AwaitingLaunchApprovalChain> {
  const chain = await makeReadyForDeploymentProduct();
  const summary = await launchOperationsService.planLaunch({
    productId: chain.product.id,
    launchStrategistAgentId: chain.agents.launchStrategistAgent.id,
    pricingAgentId: chain.agents.pricingAgent.id,
    gtmAgentId: chain.agents.gtmAgent.id,
    ceoAgentId: chain.agents.ceoAgent.id,
    startedBy: authActor(),
  });
  if (summary.product.status !== "AWAITING_LAUNCH_APPROVAL" || !summary.launchPlan || !summary.deploymentPlan || !summary.pricingModel || !summary.goToMarketPlan || !summary.memo) {
    throw new Error(`launchOperationsService.planLaunch did not reach AWAITING_LAUNCH_APPROVAL with a full plan (status: ${summary.product.status}, stoppedReason: ${summary.stoppedReason})`);
  }
  return {
    ...chain,
    product: summary.product,
    launchPlan: summary.launchPlan,
    deploymentPlan: summary.deploymentPlan,
    pricingModel: summary.pricingModel,
    goToMarketPlan: summary.goToMarketPlan,
    memo: summary.memo,
  };
}

export interface LiveProductChain extends AwaitingLaunchApprovalChain {
  deploymentId: string;
}

/**
 * makeAwaitingLaunchApprovalProduct(), plus a real human APPROVE, a
 * real exact-action-bound DeploymentPlan approval, and a real EXECUTE
 * against the DEV_FIXTURE DeploymentProvider — the shared starting
 * point every M8 test needs (docs/M8_ARCHITECTURE_PROPOSAL.md §1: M8
 * picks up from exactly a LIVE product). Mirrors
 * tests/integration/m7-capstone-positive.test.ts's own sequence
 * exactly.
 */
export async function makeLiveProduct(): Promise<LiveProductChain> {
  const chain = await makeAwaitingLaunchApprovalProduct();
  await launchReviewMemoService.recordHumanDecision({ memoId: chain.memo.id, humanDecision: "APPROVE", humanReason: null, actor: humanOwner });

  const approvalRequest = await deploymentPlanService.requestApproval({ deploymentPlanId: chain.deploymentPlan.id, requestedByAgentId: chain.agents.launchStrategistAgent.id });
  await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: humanOwner });
  await deploymentPlanService.applyDecision({ approvalRequestId: approvalRequest.id, actor: humanOwner });

  const deployment = await deploymentService.execute({ deploymentPlanId: chain.deploymentPlan.id, actor: humanOwner });
  const liveProduct = await productService.getOrThrow(chain.product.id);
  if (liveProduct.status !== "LIVE") {
    throw new Error(`Product did not reach LIVE after EXECUTE (status: ${liveProduct.status})`);
  }

  return { ...chain, product: liveProduct, deploymentId: deployment.id };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function seedActivationDefinition(productId: string, eventName = "core_action"): Promise<void> {
  await activationDefinitionRepository.create({ productId, eventName, definedBy: "test-fixture" });
}

export interface SeedUsageCohortOptions {
  productId: string;
  cohortSize: number;
  /** How many days before `now` this cohort signed up — must be >= 30 for D30 retention to be measurable. */
  daysAgoSignedUp: number;
  activatedFraction: number;
  /** Of the activated users, the fraction also active >= 30 days after their own signup. */
  retainedFraction: number;
  activationEventName?: string;
  now?: Date;
}

export interface SeedUsageCohortResult {
  signupCount: number;
  activatedCount: number;
  retainedCount: number;
}

/**
 * Seeds one cohort of real, timestamped signup/activation/activity
 * events through the actual DevAnalyticsProvider singleton — never a
 * hand-constructed BusinessMetric row (docs/M8_ARCHITECTURE_PROPOSAL.md
 * §4-5). Callers compose two calls (an older cohort for retention, a
 * recent one for growth trend) to get realistic, controllable signal.
 */
export async function seedUsageCohort(options: SeedUsageCohortOptions): Promise<SeedUsageCohortResult> {
  const analytics = createAnalyticsProvider();
  const now = options.now ?? new Date();
  const activationEventName = options.activationEventName ?? "core_action";
  const activatedCount = Math.round(options.cohortSize * options.activatedFraction);
  const retainedCount = Math.round(activatedCount * options.retainedFraction);
  const signedUpAt = new Date(now.getTime() - options.daysAgoSignedUp * DAY_MS);

  for (let i = 0; i < options.cohortSize; i += 1) {
    counter += 1;
    const userRef = `test-user-${counter}`;
    await analytics.track({ name: "signup", productId: options.productId, properties: {}, userRef, occurredAt: signedUpAt });
    if (i < activatedCount) {
      await analytics.track({ name: activationEventName, productId: options.productId, properties: {}, userRef, occurredAt: new Date(signedUpAt.getTime() + 1 * DAY_MS) });
    }
    if (i < retainedCount) {
      await analytics.track({ name: activationEventName, productId: options.productId, properties: {}, userRef, occurredAt: new Date(signedUpAt.getTime() + 31 * DAY_MS) });
    }
  }

  return { signupCount: options.cohortSize, activatedCount, retainedCount };
}

export interface SeedSubscriptionInput {
  monthlyValueUsd: number;
  /** Defaults to 60 days ago — comfortably before any 30-day churn window. */
  startedDaysAgo?: number;
  /** When set, the subscription is cancelled this many days ago (after being recorded) — real churn signal, not a static "already cancelled" row. */
  cancelledDaysAgo?: number;
}

/** Seeds real subscriptions (optionally later cancelled, for real churn signal) through the actual DevRevenueProvider singleton (docs/M8_ARCHITECTURE_PROPOSAL.md §16, §31). */
export async function seedRevenueData(productId: string, subscriptions: readonly SeedSubscriptionInput[], now?: Date): Promise<void> {
  const revenue = createRevenueProvider();
  const resolvedNow = now ?? new Date();
  for (const sub of subscriptions) {
    counter += 1;
    const id = `test-sub-${counter}`;
    await revenue.recordSubscription({
      id,
      productId,
      monthlyValueUsd: sub.monthlyValueUsd,
      startedAt: new Date(resolvedNow.getTime() - (sub.startedDaysAgo ?? 60) * DAY_MS),
    });
    if (sub.cancelledDaysAgo !== undefined) {
      await revenue.cancelSubscription({ id, cancelledAt: new Date(resolvedNow.getTime() - sub.cancelledDaysAgo * DAY_MS) });
    }
  }
}

export interface SeedFeedbackInput {
  excerpt: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  /** Defaults to a fresh, distinct respondent per item — pass the same ref twice to simulate one respondent giving multiple pieces of feedback (never counted twice toward independence). */
  respondentRef?: string;
}

/**
 * Seeds real feedback through the actual DevCustomerDataProvider
 * singleton (docs/M8_ARCHITECTURE_PROPOSAL.md §12, §31) — cast to the
 * concrete dev class the same way every other M8 seed helper reaches
 * past its port interface to a DEV_FIXTURE-only seeding method
 * (addFeedback/addCancellationReason are deliberately NOT part of the
 * CustomerDataProvider port itself — a production provider would never
 * expose a way to inject fixture rows).
 */
export async function seedCustomerFeedback(productId: string, items: readonly SeedFeedbackInput[], now?: Date): Promise<void> {
  const customerData = createCustomerDataProvider() as DevCustomerDataProvider;
  const collectedAt = now ?? new Date();
  for (const item of items) {
    counter += 1;
    customerData.addFeedback({ productId, respondentRef: item.respondentRef ?? `test-respondent-${counter}`, excerpt: item.excerpt, sentiment: item.sentiment, collectedAt });
  }
}

export interface SeedCancellationInput {
  reason: string;
  respondentRef?: string;
}

/** Seeds real cancellation reasons through the same DevCustomerDataProvider singleton seedCustomerFeedback uses. */
export async function seedCancellationReasons(productId: string, items: readonly SeedCancellationInput[], now?: Date): Promise<void> {
  const customerData = createCustomerDataProvider() as DevCustomerDataProvider;
  const cancelledAt = now ?? new Date();
  for (const item of items) {
    counter += 1;
    customerData.addCancellationReason({ productId, respondentRef: item.respondentRef ?? `test-respondent-${counter}`, reason: item.reason, cancelledAt });
  }
}
