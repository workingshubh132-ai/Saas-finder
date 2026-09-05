/**
 * M10 real-world experiment — Phase 1: real market discovery
 * (docs/M10_REAL_WORLD_AUDIT.md brief Part 5-8).
 *
 * Runs against the real, persistent `dev.db` (not a throwaway demo
 * database) — this is the company's actual operating history, not a
 * simulation. Drives the SAME `researchCycleService.run()` M3 already
 * built, unmodified, five times (once per real topic), with real
 * signal content sourced via this session's own WebSearch tool
 * (scripts/m10-real-signals-data.ts) because this container's own
 * egress proxy blocks the live HackerNewsSource/StackExchangeSource
 * network calls (verified, docs/M10_REAL_WORLD_AUDIT.md). Every
 * downstream stage — dedup, clustering, problem extraction,
 * competitor/market analysis, opportunity generation/scoring,
 * kill-risk — is the real, unmodified pipeline. Reasoning calls
 * (Problem/Competitor/Market/Opportunity Analyst) run under
 * MODEL_PROVIDER_MODE=development (no real model key exists in this
 * environment) and are honestly DEV_FIXTURE — real evidence, fixture
 * reasoning, never conflated.
 *
 * Usage: npx tsx scripts/m10-real-market-discovery.ts
 */
import { identityService } from "../src/services/identity.service.js";
import { agentService } from "../src/services/agent.service.js";
import { toolRegistry } from "../src/tools/tool-registry.js";
import { SourceSearchTool } from "../src/tools/source-search.tool.js";
import { WriteWorkspaceFileTool } from "../src/tools/write-workspace-file.tool.js";
import { RunWorkspaceCommandTool } from "../src/tools/run-workspace-command.tool.js";
import { OperatorWebSearchSource } from "../src/sources/operator-web-search.source.js";
import { researchCycleService } from "../src/services/research-cycle.service.js";
import { realWorldExperimentService } from "../src/services/real-world-experiment.service.js";
import { buildRealWorldTag } from "../src/domain/real-world/reality.types.js";
import { REAL_SIGNAL_TOPICS } from "./m10-real-signals-data.js";
import { prisma } from "../src/db/client.js";

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

async function main(): Promise<void> {
  section("M10 — REAL MARKET DISCOVERY EXPERIMENT");

  const { identity: humanIdentity } = await identityService.createIdentity({ type: "HUMAN", label: "Founder", createdBy: null });
  const human = { type: "HUMAN" as const, id: humanIdentity.id, identityId: humanIdentity.id };
  const grantedBy = { actorType: "HUMAN" as const, actorId: human.id };
  console.log(`Human Owner: ${human.id}`);

  const experiment = await realWorldExperimentService.start({
    name: "VentureForge M10 real-world validation",
    objective: "Discover a real problem, validate it with real people, build and launch a real SaaS, and reach real recurring revenue.",
    startedBy: human,
  });
  console.log(`RealWorldExperiment ${experiment.id} started.`);

  async function makeAgent(name: string, role: string) {
    return agentService.createAgent({ name, role, department: "INTELLIGENCE", description: role, riskLevel: "GREEN", createdBy: grantedBy });
  }
  const researchAgent = await makeAgent("Market Scout", "Research Agent");
  await agentService.grantPermission({ agentId: researchAgent.id, permission: "READ_WEB", grantedBy });
  const problemAgent = await makeAgent("Problem Analyst", "Problem Analyst");
  const competitorAgent = await makeAgent("Competitor Analyst", "Competitor Analyst");
  await agentService.grantPermission({ agentId: competitorAgent.id, permission: "READ_WEB", grantedBy });
  const marketAgent = await makeAgent("Market Analyst", "Market Analyst");
  const opportunityAgent = await makeAgent("Opportunity Analyst", "Opportunity Analyst");
  console.log("Agents registered (same M3 roles, no new agent type for M10).");

  // Only the M6 workspace tools plus a real, operator-relayed research
  // source are registered — deliberately NOT registerDefaultTools(),
  // which would also register the dev-fixture HackerNews/StackExchange
  // stand-ins under RESEARCH_TOOL_MODE=development and mix fake results
  // into a real-signal run.
  toolRegistry.register(new WriteWorkspaceFileTool());
  toolRegistry.register(new RunWorkspaceCommandTool());

  const summaries: Array<{ objective: string; signalsCollected: number; clustersTouched: number; opportunities: number }> = [];
  let totalRawSignals = 0;

  for (const topic of REAL_SIGNAL_TOPICS) {
    section(`REAL TOPIC: ${topic.objective}`);
    const tag = buildRealWorldTag({
      reality: "REAL",
      experimentId: experiment.id,
      note: "Sourced via this session's own WebSearch tool (scripts/m10-real-signals-data.ts) — this container's egress proxy blocks the live HN/SE adapters.",
    });
    // Overwrites the same tool id each iteration (toolRegistry.register
    // is a plain Map.set) — one real source, one pool per topic.
    toolRegistry.register(new SourceSearchTool(new OperatorWebSearchSource(topic.pool, { id: "operator_web_search", name: "Operator Web Search (real)", tag })));

    const summary = await researchCycleService.run({
      objective: topic.objective,
      researchAgentId: researchAgent.id,
      problemAnalystAgentId: problemAgent.id,
      competitorAnalystAgentId: competitorAgent.id,
      marketAnalystAgentId: marketAgent.id,
      opportunityAnalystAgentId: opportunityAgent.id,
      startedBy: human,
    });

    console.log(`Cycle ${summary.cycle.id}: ${summary.cycle.status}`);
    console.log(`  Real signals available in pool: ${topic.pool.length}`);
    console.log(`  Signals ingested this cycle: ${summary.signalsCollected}`);
    console.log(`  Clusters touched: ${summary.clustersTouched}`);
    console.log(`  Problems extracted: ${summary.problemsExtracted.length}`);
    console.log(`  Opportunities generated: ${summary.opportunitiesGenerated.length}`);
    for (const o of summary.opportunitiesGenerated) {
      console.log(`    - ${o.id}: "${o.title}" score=${o.opportunityScore?.toFixed(2) ?? "n/a"} confidence=${o.confidenceScore?.toFixed(2) ?? "n/a"}`);
    }

    totalRawSignals += topic.pool.length;
    summaries.push({ objective: topic.objective, signalsCollected: summary.signalsCollected, clustersTouched: summary.clustersTouched, opportunities: summary.opportunitiesGenerated.length });
  }

  section("DISCOVERY FUNNEL — actual numbers, not manufactured (brief Part 6, 8, 23)");
  const totalIngested = summaries.reduce((sum, s) => sum + s.signalsCollected, 0);
  const totalClusters = summaries.reduce((sum, s) => sum + s.clustersTouched, 0);
  const totalOpportunities = summaries.reduce((sum, s) => sum + s.opportunities, 0);
  console.log(`Real raw signals sourced (WebSearch, this session):     ${totalRawSignals}`);
  console.log(`Signals ingested (post-dedup, across 5 real cycles):    ${totalIngested}`);
  console.log(`Clusters touched:                                       ${totalClusters}`);
  console.log(`Opportunities generated:                                ${totalOpportunities}`);
  console.log(`\nPer-topic breakdown:`);
  for (const s of summaries) {
    console.log(`  ${s.objective}: ${s.signalsCollected} signals -> ${s.clustersTouched} clusters -> ${s.opportunities} opportunities`);
  }

  console.log(`\nHuman Owner identity for next phase: ${human.id}`);
  console.log(`RealWorldExperiment for next phase: ${experiment.id}`);
  console.log(`Agents for next phase: research=${researchAgent.id} problem=${problemAgent.id} competitor=${competitorAgent.id} market=${marketAgent.id} opportunity=${opportunityAgent.id}`);

  await prisma.$disconnect();
  console.log("\n=== M10 real market discovery finished OK ===");
}

await main();
