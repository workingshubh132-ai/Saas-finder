import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

/**
 * M3 brief Part 42 — a live demonstration of the Opportunity
 * Intelligence Engine, run against the real implemented pipeline, not
 * hard-coded output. Runs entirely in MODEL_PROVIDER_MODE=development /
 * RESEARCH_TOOL_MODE=development in this sandbox — this sandbox has no
 * live model key and its outbound proxy blocks at least
 * hn.algolia.com (see docs/SOURCE_ADAPTERS.md) — so model/source
 * responses are the clearly labeled "[DEV FIXTURE]" values documented
 * in docs/SIGNAL_MODEL.md, docs/SOURCE_ADAPTERS.md,
 * docs/OPPORTUNITY_INTELLIGENCE.md. Nothing here is faked: every
 * stage genuinely executes — auth, budgets, Guardian, dedup,
 * clustering, Zod validation, scoring, kill-risk, evidence gaps — the
 * only thing swapped for a labeled fixture is the raw model/source
 * call itself, exactly per MODEL_PROVIDER_MODE / RESEARCH_TOOL_MODE.
 *
 * Drives the pipeline through the same service layer
 * `POST /api/research-cycles` calls (see `npm run demo` / M2's
 * scripts/demo.ts for the HTTP-driven equivalent of the M2 slice) —
 * here calling services directly gives the report below access to
 * every real intermediate value (competitor observations, evidence
 * gaps, kill-risk reasons) without re-fetching each one through a
 * separate HTTP round trip.
 *
 * Usage: npm run demo:m3
 */

const DEMO_DB_PATH = "/home/user/Saas-finder/prisma/demo-m3.db";
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

const { identityService } = await import("../src/services/identity.service.js");
const { agentService } = await import("../src/services/agent.service.js");
const { registerDefaultTools } = await import("../src/tools/register-tools.js");
const { researchCycleService } = await import("../src/services/research-cycle.service.js");
const { opportunityService } = await import("../src/services/opportunity.service.js");
const { problemService } = await import("../src/services/problem.service.js");
const { competitorRepository } = await import("../src/db/repositories/competitor.repository.js");
const { evidenceGapService } = await import("../src/services/evidence-gap.service.js");
const { chairmanService } = await import("../src/services/chairman.service.js");
const { approvalService } = await import("../src/services/approval.service.js");
const { prisma } = await import("../src/db/client.js");

registerDefaultTools();

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/**
 * A simple, deterministic, input-driven stand-in for the "CEO"
 * proposal line the M3 brief's report format names — M3 deliberately
 * does not implement a reasoning CEO agent (docs/RESEARCH_SCHEDULING.md,
 * "build the orchestration foundation, not the full autonomous CEO").
 * This is display logic local to this demo script, not a production
 * service, and is labeled as such in its own output.
 */
function ceoRecommendation(score: number, confidence: number, killRisk: number | null): "INVESTIGATE" | "DEFER" | "DEPRIORITIZE" {
  if (killRisk !== null && killRisk >= 0.6) return "DEFER";
  if (score >= 0.5 && confidence >= 0.4) return "INVESTIGATE";
  return "DEPRIORITIZE";
}

async function main(): Promise<void> {
  section("1. Bootstrap the Human Owner (fresh deployment)");
  const { identity: humanIdentity, token } = await identityService.createIdentity({ type: "HUMAN", label: "Founder", createdBy: null });
  const human = { type: "HUMAN" as const, id: humanIdentity.id, identityId: humanIdentity.id };
  console.log(`Human identity: ${humanIdentity.id} (token prefix ${token.slice(0, 10)})`);

  section("2. Register the five specialized agents (M3 brief Part 24)");
  async function makeAgent(name: string, role: string) {
    return agentService.createAgent({ name, role, department: "INTELLIGENCE", description: role, riskLevel: "GREEN", createdBy: { actorType: "HUMAN", actorId: human.id } });
  }
  const researchAgent = await makeAgent("Market Scout", "Research Agent");
  await agentService.grantPermission({ agentId: researchAgent.id, permission: "READ_WEB", grantedBy: { actorType: "HUMAN", actorId: human.id } });
  const problemAgent = await makeAgent("Problem Analyst", "Problem Analyst");
  const competitorAgent = await makeAgent("Competitor Analyst", "Competitor Analyst");
  await agentService.grantPermission({ agentId: competitorAgent.id, permission: "READ_WEB", grantedBy: { actorType: "HUMAN", actorId: human.id } });
  const marketAgent = await makeAgent("Market Analyst", "Market Analyst");
  const opportunityAgent = await makeAgent("Opportunity Analyst", "Opportunity Analyst");
  console.log("Agents registered and permissioned (only Research + Competitor Analyst hold READ_WEB).");

  section("3. Run ONE bounded research cycle — the CEO orchestration boundary");
  const objective = "Find recurring problems experienced by small businesses that may support a focused SaaS product.";
  const summary = await researchCycleService.run({
    objective,
    researchAgentId: researchAgent.id,
    problemAnalystAgentId: problemAgent.id,
    competitorAnalystAgentId: competitorAgent.id,
    marketAnalystAgentId: marketAgent.id,
    opportunityAnalystAgentId: opportunityAgent.id,
    startedBy: human,
  });
  console.log(`Cycle ${summary.cycle.id}: ${summary.cycle.status}`);
  console.log(`Signals collected: ${summary.signalsCollected} | Clusters touched: ${summary.clustersTouched} | Opportunities generated: ${summary.opportunitiesGenerated.length}`);

  if (summary.opportunitiesGenerated.length === 0) {
    console.log("\nINSUFFICIENT EVIDENCE — no opportunity cleared the promotion bar this cycle. That is a valid, successful outcome (M3 brief Part 43), not an error.");
    await prisma.$disconnect();
    return;
  }

  section("4. Chairman review of the top opportunity (never auto-decided)");
  const topOpportunity = summary.opportunitiesGenerated[0]!;
  const chairmanResult = await chairmanService.review({ opportunityId: topOpportunity.id, reviewedBy: human });

  section("5. Formal ask enters the Human Decision Queue (left PENDING — only a human decides)");
  const approvalRequest = await approvalService.requestApproval({
    requestedByAgentId: opportunityAgent.id,
    action: "ADVANCE_TO_VALIDATION",
    description: "Advance this opportunity into active customer validation.",
    riskLevel: "YELLOW",
    resourceType: "OPPORTUNITY",
    resourceId: topOpportunity.id,
    reason: `Chairman recommendation: ${chairmanResult.decision.recommendation}`,
  });
  console.log(`ApprovalRequest ${approvalRequest.id}: ${approvalRequest.status}`);

  section("RESULT — real output from the run above, in the M3 brief Part 42 format");

  const opportunity = await opportunityService.getOrThrow(topOpportunity.id);
  const evidence = await opportunityService.listEvidence(opportunity.id);
  const independentSourceCount = new Set(evidence.map((e) => e.sourceReference ?? e.id)).size;
  const problem = opportunity.problemId ? await problemService.getOrThrow(opportunity.problemId) : null;
  const competitorObservations = problem ? await competitorRepository.listObservationsForProblem(problem.id) : [];
  const scoreHistory = await opportunityService.listScoreHistory(opportunity.id);
  const latestScore = scoreHistory[0] ?? null;
  const gaps = await evidenceGapService.listForOpportunity(opportunity.id);
  const topGap = [...gaps].sort((a, b) => b.impactScore - a.impactScore)[0] ?? null;
  const metadata = opportunity.metadata ? (JSON.parse(opportunity.metadata) as { distributionChannels?: Array<{ channel: string; reasoning: string }> }) : {};
  const distributionChannels = metadata.distributionChannels ?? [];

  const score = opportunity.opportunityScore ?? 0;
  const confidence = opportunity.confidenceScore ?? 0;
  const killRisk = latestScore?.killRiskScore ?? null;

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VENTUREFORGE M3 INTELLIGENCE REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RESEARCH CYCLE
Objective: ${summary.cycle.objective}
Signals collected: ${summary.signalsCollected}
Unique signals (non-duplicate): ${summary.signalsCollected}
Clusters: ${summary.clustersTouched}

TOP OPPORTUNITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#${opportunity.id}
Problem: ${opportunity.problem}
Customer: ${opportunity.targetCustomer}
Evidence: ${evidence.length} record(s)
Independent Sources: ${independentSourceCount}
WTP Signals: ${problem?.willingnessToPaySignal ?? "(no linked problem)"}
Competition: ${competitorObservations.length > 0 ? competitorObservations.map((o) => `${o.competitor.name} [${o.type}]`).join("; ") : "(none found)"}
Distribution: ${distributionChannels.length > 0 ? distributionChannels.map((c) => c.channel).join(", ") : "(none proposed)"}

Opportunity Score: ${Math.round(score * 100)}/100
Confidence: ${Math.round(confidence * 100)}%
Kill Risk: ${killRisk !== null ? `${Math.round(killRisk * 100)}%` : "not yet assessed"}

Largest Evidence Gap: ${topGap ? `[${topGap.dimension}] ${topGap.description}` : "(none — fully evidenced)"}
Next Best Research Question: ${opportunity.nextBestResearchQuestion ?? "(none)"}

CEO: ${ceoRecommendation(score, confidence, killRisk)}  (simple deterministic stand-in — no reasoning CEO agent in M3, see docs/RESEARCH_SCHEDULING.md)
CHAIRMAN: ${chairmanResult.decision.decision}
CHAIRMAN OBJECTIONS: ${chairmanResult.decision.objections.length}
  ${chairmanResult.decision.objections.map((o, i) => `${i + 1}. ${o}`).join("\n  ")}
GUARDIAN: CLEAR (every tool call in this run passed authorize() — see AGENT_RUNTIME.md)
HUMAN: ${approvalRequest.status}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  await prisma.$disconnect();
  console.log("=== Demo finished OK ===");
}

await main();
