import type { Agent, Problem, SignalCluster } from "@prisma/client";
import { agentService, type CreateAgentParams } from "../src/services/agent.service.js";
import { signalClusterRepository } from "../src/db/repositories/signal-cluster.repository.js";
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
