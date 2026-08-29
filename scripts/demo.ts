import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";

/**
 * M2 brief Part 33 — a live demonstration, run against the real
 * implemented workflow (HTTP API, real services, real database), not
 * hard-coded output. Every value printed below comes from an actual
 * response of the actual running application.
 *
 * Runs entirely in MODEL_PROVIDER_MODE=development /
 * RESEARCH_TOOL_MODE=development — this sandbox has no live model key
 * and this sandbox's outbound proxy blocks hn.algolia.com (see
 * docs/TOOL_SYSTEM.md) — so the model/tool responses are the clearly
 * labeled "[DEV FIXTURE]" values documented in docs/AGENT_RUNTIME.md,
 * docs/TOOL_SYSTEM.md, and docs/CHAIRMAN.md. Nothing here is faked:
 * every stage genuinely executes — auth, budget enforcement, Guardian
 * checks, Zod validation, state transitions, persistence — the only
 * thing swapped for a labeled fixture is the raw model/tool call
 * itself, exactly per MODEL_PROVIDER_MODE / RESEARCH_TOOL_MODE. Run
 * with MODEL_PROVIDER_MODE=anthropic + RESEARCH_TOOL_MODE=hn_algolia
 * and real credentials in an environment with outbound network access
 * to reproduce this against a live model and a live search.
 *
 * Usage: npm run demo
 */

const DEMO_DB_PATH = path.resolve(import.meta.dirname, "..", "prisma", "demo.db");
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
process.env.RESEARCH_TOOL_MODE = process.env.RESEARCH_TOOL_MODE ?? "development";

const { createApp } = await import("../src/api/app.js");
const { registerDefaultTools } = await import("../src/tools/register-tools.js");

registerDefaultTools();
const app = createApp();

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  section("1. Bootstrap the Human Owner (fresh deployment, no prior identity)");
  const bootstrap = await request(app).post("/api/identities").send({ type: "HUMAN", label: "Founder" });
  if (bootstrap.status !== 201) throw new Error(`Bootstrap failed: ${JSON.stringify(bootstrap.body)}`);
  const human = `Bearer ${bootstrap.body.token as string}`;
  console.log(`Human identity created: ${bootstrap.body.id} (token prefix ${bootstrap.body.tokenPrefix})`);

  section("2. Register the Research Agent and grant READ_WEB");
  const agentRes = await request(app)
    .post("/api/agents")
    .set("Authorization", human)
    .send({
      name: "Market Scout",
      role: "Research Agent",
      department: "INTELLIGENCE",
      description: "Finds and analyzes evidence for potential SaaS opportunities.",
      riskLevel: "GREEN",
    });
  if (agentRes.status !== 201) throw new Error(`Agent creation failed: ${JSON.stringify(agentRes.body)}`);
  const agentId = agentRes.body.id as string;
  console.log(`Agent created: ${agentId} (status ${agentRes.body.status})`);

  const grantRes = await request(app).post(`/api/agents/${agentId}/permissions`).set("Authorization", human).send({ permission: "READ_WEB" });
  if (grantRes.status !== 201) throw new Error(`Grant failed: ${JSON.stringify(grantRes.body)}`);
  console.log("Granted READ_WEB.");

  const guardianCheck = await request(app).post("/api/authorize").set("Authorization", human).send({ agentId, action: "READ_WEB" });
  const guardianStatus = guardianCheck.body.decision === "ALLOWED" ? "CLEAR" : "BLOCKED";
  console.log(`Guardian check for READ_WEB: ${guardianCheck.body.decision} -> ${guardianStatus}`);

  section("3. Create the research Task and assign it to the agent");
  const objective = "Find a promising SaaS opportunity for small businesses.";
  const taskRes = await request(app)
    .post("/api/tasks")
    .set("Authorization", human)
    .send({ title: "Find a promising SaaS opportunity", objective, assignedAgentId: agentId, riskLevel: "GREEN" });
  if (taskRes.status !== 201) throw new Error(`Task creation failed: ${JSON.stringify(taskRes.body)}`);
  const taskId = taskRes.body.id as string;
  console.log(`Task created: ${taskId}`);

  section("4. Run the Research Agent: PLAN -> TOOL -> SYNTHESIZE -> PROCESS_RESULT");
  const researchRes = await request(app).post("/api/research").set("Authorization", human).send({ agentId, objective, taskId });
  if (researchRes.status !== 201) throw new Error(`Research run failed: ${JSON.stringify(researchRes.body)}`);
  const execution = researchRes.body.execution as { id: string; status: string; stepCount: number; toolCallCount: number; modelCallCount: number };
  console.log(
    `Execution ${execution.id}: ${researchRes.body.status} ` +
      `(steps=${execution.stepCount}, toolCalls=${execution.toolCallCount}, modelCalls=${execution.modelCallCount})`,
  );
  if (researchRes.body.status !== "COMPLETED") {
    console.log(`Execution did not complete: ${JSON.stringify(researchRes.body, null, 2)}`);
    return;
  }
  const opportunityId = researchRes.body.result.opportunityId as string;

  section("5. Read back the Opportunity, Evidence, and Chairman Review");
  const opportunityRes = await request(app).get(`/api/opportunities/${opportunityId}`).set("Authorization", human);
  const opportunity = opportunityRes.body as {
    id: string;
    title: string;
    problem: string;
    targetCustomer: string;
    opportunityScore: number;
    confidenceScore: number;
    validationLevel: string;
    status: string;
  };

  const evidenceRes = await request(app).get(`/api/opportunities/${opportunityId}/evidence`).set("Authorization", human);
  const evidence = evidenceRes.body as Array<{ claim: string; sourceReference: string | null; confidence: number; reliability: string }>;

  const chairmanRes = await request(app).post(`/api/opportunities/${opportunityId}/chairman-review`).set("Authorization", human);
  if (chairmanRes.status !== 201) throw new Error(`Chairman review failed: ${JSON.stringify(chairmanRes.body)}`);
  const decision = chairmanRes.body.decision as { decision: string; objections: string[]; recommendation: string };

  section("6. Put the formal ask in front of the Human Decision Queue");
  const approvalRes = await request(app)
    .post(`/api/opportunities/${opportunityId}/request-approval`)
    .set("Authorization", human)
    .send({
      requestedByAgentId: agentId,
      action: "ADVANCE_TO_VALIDATION",
      description: "Advance this opportunity into active customer validation.",
      riskLevel: "YELLOW",
      reason: `Chairman recommendation: ${decision.recommendation}`,
    });
  if (approvalRes.status !== 201) throw new Error(`Approval request failed: ${JSON.stringify(approvalRes.body)}`);
  console.log(`ApprovalRequest ${approvalRes.body.id as string}: ${approvalRes.body.status as string}`);
  console.log("Deliberately NOT auto-deciding this — only a Human Owner may approve/reject (see docs/SECURITY.md, self-approval).");

  section("RESULT — real output from the run above, in the M2 brief Part 33 format");
  console.log(`
OPPORTUNITY #${opportunity.id}
Problem: ${opportunity.problem}
Target Customer: ${opportunity.targetCustomer}
Evidence:
${evidence.map((item, i) => `  ${i + 1}. [confidence ${item.confidence.toFixed(2)}, reliability ${item.reliability}] ${item.claim}`).join("\n")}
Sources:
${evidence.map((item, i) => `  ${i + 1}. ${item.sourceReference ?? "(none)"}`).join("\n")}
Opportunity Score: ${opportunity.opportunityScore.toFixed(2)}
Confidence: ${opportunity.confidenceScore.toFixed(2)}
Validation Level: ${opportunity.validationLevel}
CEO Recommendation: ${approvalRes.body.description as string} (${approvalRes.body.action as string})
Chairman: ${decision.decision}
Chairman Objections:
${decision.objections.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}
Guardian: ${guardianStatus}
Human: ${approvalRes.body.status as string}
`);
}

await main();
await (await import("../src/db/client.js")).prisma.$disconnect();
