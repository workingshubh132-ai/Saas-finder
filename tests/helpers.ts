import type { Agent, Opportunity, Problem, SignalCluster } from "@prisma/client";
import { agentService, type CreateAgentParams } from "../src/services/agent.service.js";
import { signalClusterRepository } from "../src/db/repositories/signal-cluster.repository.js";
import { opportunityService } from "../src/services/opportunity.service.js";
import type { OpportunityScoreDimensions } from "../src/services/opportunity-scorer.js";
import type { KillRiskDimensions } from "../src/services/kill-risk-scorer.js";
import { problemService } from "../src/services/problem.service.js";
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
  return { researchAgent, problemAgent, competitorAgent, marketAgent, opportunityAgent, validatorAgent, ceoAgent };
}
