import type { Agent } from "@prisma/client";
import { agentService, type CreateAgentParams } from "../src/services/agent.service.js";

export const HUMAN_OWNER = "founder";

let counter = 0;

export async function makeAgent(overrides: Partial<CreateAgentParams> = {}): Promise<Agent> {
  counter += 1;
  return agentService.createAgent({
    name: `Test Agent ${counter}`,
    role: "Researcher",
    department: "INTELLIGENCE",
    description: "A test agent.",
    riskLevel: "GREEN",
    createdBy: HUMAN_OWNER,
    ...overrides,
  });
}
