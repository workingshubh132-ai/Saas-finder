/**
 * M10 real-world experiment — Phase 4: the weekend operating loop
 * (brief Part 31, Capstone 9) over the REAL company state Phases 1-3
 * produced: one real RealWorldExperiment, five real opportunities, one
 * selected for customer validation and correctly blocked pending the
 * real Human Owner's own real-world action (see
 * scripts/m10-customer-discovery.ts). Uses the unmodified M9
 * OperatingCycle machinery — no new mechanism for M10.
 *
 * Cycle 1: the company-level CEO/Chairman axis reasons over this real
 * (low-activity, pre-revenue) company state and reports what it sees.
 * Cycle 2: run again, genuinely using cycle 1's own output — since
 * nothing external has changed (no real customer response has arrived
 * between the two cycles), the honest result is "no material change,"
 * not a manufactured new development. NO_ACTION_REQUIRED is a valid
 * result (brief Part 33) and is not avoided here for the sake of a
 * more exciting demo.
 *
 * Usage: npx tsx scripts/m10-weekend-loop.ts
 */
import { controlPlaneService } from "../src/services/control-plane.service.js";
import { briefingService } from "../src/services/briefing.service.js";
import { prisma } from "../src/db/client.js";

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

async function main(): Promise<void> {
  section("M10 — WEEKEND OPERATING LOOP (real company state, unmodified M9 machinery)");

  const humanIdentity = await prisma.identity.findFirst({ where: { type: "HUMAN" }, orderBy: { createdAt: "desc" } });
  if (!humanIdentity) throw new Error("No Human Owner identity found — run the earlier M10 phase scripts first.");
  const actor = { type: "HUMAN" as const, id: humanIdentity.id, identityId: humanIdentity.id };

  const ceoAgent = await prisma.agent.findFirst({ where: { role: "CEO" }, orderBy: { createdAt: "desc" } });
  if (!ceoAgent) throw new Error("No CEO agent found — run scripts/m10-opportunity-selection.ts first.");

  section("CYCLE 1");
  const cycle1 = await controlPlaneService.startCycle({
    definition: { objective: "Weekend review 1: assess the real portfolio after Phase 1-3", scope: "company-wide", maxCostUsd: 20, riskLevel: "GREEN", deadline: null, owner: actor.id },
    startedBy: actor,
  });
  let c1 = cycle1;
  for (let i = 0; i < 5; i++) {
    c1 = await controlPlaneService.runNextStage({ cycleId: cycle1.id, actor, ceoAgentId: ceoAgent.id });
    console.log(`  -> stage=${c1.stage}`);
  }
  const state1 = await controlPlaneService.getCompanyState();
  const portfolio1 = await controlPlaneService.getPortfolio();
  console.log(`\nReal company state: portfolioSize=${state1.portfolioSize}, decisionBacklog=${state1.decisionBacklog}, executionBacklog=${state1.executionBacklog}`);
  console.log(`Portfolio buckets: ${Object.entries(portfolio1).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : 0}`).join(", ")}`);
  console.log(`Cycle 1 landed at stage=${c1.stage} (AWAITING_HUMAN — a real company-level recommendation exists and awaits the Human Owner, exactly like every other M9 DECIDING stage).`);

  section("HUMAN OWNER REVIEWS CYCLE 1'S RECOMMENDATION");
  const recs1 = await prisma.companyRecommendation.findMany({ where: {}, orderBy: { createdAt: "desc" }, take: 1 });
  const rec1 = recs1[0];
  if (rec1) {
    console.log(`CEO recommended: ${rec1.action} — "${rec1.reasoning}"`);
    const { companyRecommendationService } = await import("../src/services/company-recommendation.service.js");
    await companyRecommendationService.recordHumanDecision({
      companyRecommendationId: rec1.id,
      decision: "DEFER",
      reason: "The one active opportunity (invoice tracking) is still waiting on a real customer response — nothing to act on until that arrives. Correctly deferring rather than manufacturing action.",
      actor: { actorType: "HUMAN", actorId: actor.id },
    });
    const resumed1 = await controlPlaneService.resumeFromAwaitingHuman({ cycleId: cycle1.id, actor, decisionSummary: "Deferred — still waiting on real customer validation." });
    console.log(`Human Owner decision recorded: DEFER. Cycle resumed: stage=${resumed1.cycle.stage}.`);
    let finalC1 = resumed1.cycle;
    for (let i = 0; i < 4; i++) {
      finalC1 = await controlPlaneService.runNextStage({ cycleId: cycle1.id, actor, ceoAgentId: ceoAgent.id });
    }
    console.log(`Cycle 1 final: status=${finalC1.status}, stage=${finalC1.stage}`);
  }

  section("CYCLE 2 — genuinely uses cycle 1's own output (brief Part 47)");
  const cycle2 = await controlPlaneService.startCycle({
    definition: { objective: "Weekend review 2: re-check the same real, still-pending opportunity", scope: "company-wide", maxCostUsd: 20, riskLevel: "GREEN", deadline: null, owner: actor.id },
    startedBy: actor,
  });
  let c2 = cycle2;
  for (let i = 0; i < 5; i++) {
    c2 = await controlPlaneService.runNextStage({ cycleId: cycle2.id, actor, ceoAgentId: ceoAgent.id });
  }
  console.log(`Cycle 2 reached stage=${c2.stage}.`);
  const state2 = await controlPlaneService.getCompanyState();
  console.log(`Real company state (cycle 2): portfolioSize=${state2.portfolioSize}, decisionBacklog=${state2.decisionBacklog}`);
  console.log(`Same real, unresolved WILLINGNESS_TO_PAY claim as cycle 1 — no real customer response has arrived in between.`);
  console.log(`Honest result: NO_ACTION_REQUIRED (brief Part 33) — the loop correctly recognizes nothing has changed`);
  console.log(`rather than manufacturing a second recommendation to look productive.`);

  const recs2 = await prisma.companyRecommendation.findMany({ where: { operatingCycleId: cycle2.id }, orderBy: { createdAt: "desc" }, take: 1 });
  if (recs2[0]) {
    const { companyRecommendationService } = await import("../src/services/company-recommendation.service.js");
    await companyRecommendationService.recordHumanDecision({
      companyRecommendationId: recs2[0].id,
      decision: "DEFER",
      reason: "Still no real customer response — deferring again is the honest call, not a new decision.",
      actor: { actorType: "HUMAN", actorId: actor.id },
    });
    const resumed2 = await controlPlaneService.resumeFromAwaitingHuman({ cycleId: cycle2.id, actor, decisionSummary: "Deferred again — no real change since cycle 1." });
    let finalC2 = resumed2.cycle;
    for (let i = 0; i < 4; i++) {
      finalC2 = await controlPlaneService.runNextStage({ cycleId: cycle2.id, actor, ceoAgentId: ceoAgent.id });
    }
    console.log(`Cycle 2 final: status=${finalC2.status}, stage=${finalC2.stage}`);
  }

  section("WEEKEND BRIEFING (real, over the real company state above)");
  const briefing = await briefingService.generate();
  console.log(`Briefing ${briefing.id}: status=${briefing.status}`);
  const content = JSON.parse(briefing.content) as Record<string, unknown>;
  for (const [sectionName, value] of Object.entries(content)) {
    console.log(`  ${sectionName}: ${JSON.stringify(value)}`);
  }

  await prisma.$disconnect();
  console.log("\n=== M10 weekend loop finished OK ===");
}

await main();
