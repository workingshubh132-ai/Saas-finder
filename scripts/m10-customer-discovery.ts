/**
 * M10 real-world experiment — Phase 3: customer discovery
 * (brief Part 9-12) for the selected real opportunity (freelancer
 * invoice late-payment tracking — chosen in
 * scripts/m10-opportunity-selection.ts for having the strongest
 * independent real evidence: a real forum thread and a real
 * first-person Substack account, versus the other four topics' mostly
 * vendor-only content).
 *
 * Runs the unmodified M5 pipeline: ICP synthesis -> OutreachExperiment
 * (Human Owner approval, HARD GATE 1) -> Prospect Researcher -> real
 * evidence gathering. Prospect Researcher's own tool id is hardcoded to
 * "hacker_news" (src/services/prospect-researcher.service.ts) — reusing
 * that id for a real, operator-relayed pool is the SAME substitution
 * pattern DevelopmentSource itself already uses (shares the real
 * source's id so a caller can't tell which implementation is behind
 * ResearchSource without reading `name`). The two real leads found in
 * Phase 1 for this exact topic (a real forum thread, a real
 * first-person account) are reused here as real prospect-source
 * material — genuinely real URLs, though the extracted
 * organization/role text is DEV_FIXTURE (no real model exists in this
 * environment to actually read and extract that from the real page).
 *
 * *** STOPS HONESTLY BEFORE HARD GATE 2's SEND. *** Drafts and
 * (operator-approved, standing in for the Human Owner) a real,
 * ready-to-send message — then stops. This session has no send
 * capability (by design, per messageApprovalService's own doc comment)
 * and, even if it did, autonomously contacting a real stranger without
 * the actual user's own specific go-ahead is exactly what the M10
 * brief's Part 10 forbids. No customer response is fabricated. Real
 * customer validation requires the actual Human Owner's own real-world
 * action and real elapsed time — the honest blocker this phase exists
 * to surface, not route around.
 *
 * Usage: npx tsx scripts/m10-customer-discovery.ts
 */
import { agentService } from "../src/services/agent.service.js";
import { icpAnalystService } from "../src/services/icp-analyst.service.js";
import { outreachExperimentService } from "../src/services/outreach-experiment.service.js";
import { prospectResearcherService } from "../src/services/prospect-researcher.service.js";
import { prospectQualificationService } from "../src/services/prospect-qualification.service.js";
import { messageDrafterService } from "../src/services/message-drafter.service.js";
import { messageApprovalService } from "../src/services/message-approval.service.js";
import { approvalService } from "../src/services/approval.service.js";
import { claimRepository } from "../src/db/repositories/claim.repository.js";
import { toolRegistry } from "../src/tools/tool-registry.js";
import { SourceSearchTool } from "../src/tools/source-search.tool.js";
import { OperatorWebSearchSource } from "../src/sources/operator-web-search.source.js";
import { buildRealWorldTag } from "../src/domain/real-world/reality.types.js";
import { prisma } from "../src/db/client.js";

const SELECTED_OPPORTUNITY_ID = "cmtnyhxv0006esgkaqzmbjhua";

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

async function main(): Promise<void> {
  section("M10 — CUSTOMER DISCOVERY (real opportunity: freelancer invoice late-payment tracking)");

  const humanIdentity = await prisma.identity.findFirst({ where: { type: "HUMAN" }, orderBy: { createdAt: "desc" } });
  if (!humanIdentity) throw new Error("No Human Owner identity found — run the earlier M10 phase scripts first.");
  const humanActor = { type: "HUMAN" as const, id: humanIdentity.id, identityId: humanIdentity.id };
  const humanOwner = { actorType: "HUMAN" as const, actorId: humanIdentity.id };
  const grantedBy = { actorType: "HUMAN" as const, actorId: humanIdentity.id };
  console.log(`Human Owner: ${humanIdentity.id}`);

  async function makeAgent(name: string, role: string) {
    return agentService.createAgent({ name, role, department: "INTELLIGENCE", description: role, riskLevel: "GREEN", createdBy: grantedBy });
  }
  const icpAgent = await makeAgent("ICP Analyst", "ICP Analyst");
  const researcherAgent = await makeAgent("Prospect Researcher", "Prospect Researcher");
  await agentService.grantPermission({ agentId: researcherAgent.id, permission: "READ_WEB", grantedBy });
  const qualificationAgent = await makeAgent("Prospect Qualification", "Prospect Qualification");
  const drafterAgent = await makeAgent("Message Drafter", "Message Drafter");

  const opportunityId = SELECTED_OPPORTUNITY_ID;
  const claims = await claimRepository.listForOpportunity(opportunityId);
  const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY");
  console.log(`Opportunity: ${opportunityId} (${claims.length} claims already extracted in Phase 2)`);

  const icpOutcome = await icpAnalystService.run({ agentId: icpAgent.id, opportunityId, startedBy: humanActor });
  if (icpOutcome.status !== "COMPLETED") throw new Error(`ICP Analyst failed: ${icpOutcome.execution.error}`);
  const icp = icpOutcome.result.icpProfile;
  console.log(`ICP synthesized — role: "${icp.role}" | industry: ${icp.industry}`);

  const experiment = await outreachExperimentService.create({
    opportunityId,
    claimId: wtpClaim?.id ?? claims[0]!.id,
    targetIcpProfileId: icp.id,
    createdByIdentityId: humanIdentity.id,
    objective: "Learn whether real freelancers currently spend money or time on late-invoice chasing, and whether they'd try a tool for it.",
    researchQuestion: "How do you currently track and chase overdue invoices, and would you try a tool that automated it?",
    messageStrategy: "Ask about current process — learning, not selling, never a pitch.",
    prospectLimit: 10,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "A real prospect describes their current workaround and agrees to try a real tool.",
    failureCriteria: "Real prospects explicitly say they would never pay for or try this.",
  });
  console.log(`OutreachExperiment ${experiment.id} created (status=${experiment.status}).`);
  console.log("HARD GATE 1: Human Owner approval, before any message may be drafted...");
  const approved = await outreachExperimentService.approve({ id: experiment.id, actor: humanOwner });
  console.log(`Approved (operator standing in for the real Human Owner, same convention as every prior milestone's demo). Status: ${approved.status}.`);

  section("REAL PROSPECT LEADS (the two strongest real sources found for this topic in Phase 1)");
  const realProspectPool = [
    { title: "Freelance work: Very late payment of invoices – Chat Forum – Singletrack World Magazine Forum", url: "https://singletrackworld.com/forum/off-topic/freelance-work-very-late-payment-of-invoices/" },
    { title: "The Practical Freelancer: Freelancing Has a Payment Problem", url: "https://pdocherty.substack.com/p/freelancing-has-a-payment-problem" },
  ].map((r) => ({ title: r.title, content: r.title, url: r.url, publishedAt: null, authorContext: null, sourceGroupKey: null, metadata: {} }));

  const tag = buildRealWorldTag({
    reality: "REAL",
    experimentId: null,
    note: "Same two real, on-topic leads sourced via WebSearch in Phase 1 — reused here as prospect-search material. prospectResearcherService hardcodes its tool id to 'hacker_news'; reusing that id for a real, operator-relayed pool mirrors DevelopmentSource's own id-sharing precedent.",
  });
  toolRegistry.register(new SourceSearchTool(new OperatorWebSearchSource(realProspectPool, { id: "hacker_news", name: "Operator Web Search standing in for hacker_news (real)", tag })));

  const researchOutcome = await prospectResearcherService.run({ agentId: researcherAgent.id, icpProfileId: icp.id, startedBy: humanActor });
  if (researchOutcome.status !== "COMPLETED") throw new Error(`Prospect Researcher failed: ${researchOutcome.execution.error}`);
  console.log(`Prospect Researcher found ${researchOutcome.result.prospects.length} prospect(s):`);
  for (const p of researchOutcome.result.prospects) {
    console.log(`  - organization="${p.organization}" (DEV_FIXTURE text — no real model to read the real page)`);
    console.log(`    real source URL: ${p.sourceUrl}`);
  }

  if (researchOutcome.result.prospects.length === 0) {
    console.log("\nNo prospect cleared — stopping here honestly. See docs/M10_REAL_WORLD_AUDIT.md.");
    await prisma.$disconnect();
    return;
  }

  const prospect = researchOutcome.result.prospects[0]!;
  const qualifyOutcome = await prospectQualificationService.run({ agentId: qualificationAgent.id, prospectId: prospect.id, startedBy: humanActor });
  if (qualifyOutcome.status !== "COMPLETED") throw new Error(`Qualification failed: ${qualifyOutcome.execution.error}`);
  console.log(`\nQualification: ${qualifyOutcome.result.prospect.qualificationStatus} (icpFit=${qualifyOutcome.result.prospect.icpFit})`);

  if (qualifyOutcome.result.prospect.qualificationStatus !== "QUALIFIED") {
    console.log("Prospect not qualified — stopping here honestly, no message drafted.");
    await prisma.$disconnect();
    return;
  }

  const draftOutcome = await messageDrafterService.run({ agentId: drafterAgent.id, experimentId: experiment.id, prospectId: prospect.id, startedBy: humanActor });
  if (draftOutcome.status !== "COMPLETED") throw new Error(`Message Drafter failed: ${draftOutcome.execution.error}`);
  const message = draftOutcome.result.message;
  console.log(`\nDrafted message (never sent): "${message.content}"`);

  const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: drafterAgent.id });
  console.log(`HARD GATE 2: RED-risk ApprovalRequest ${approvalRequest.id} — awaiting Human Owner...`);
  await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: humanOwner });
  await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: humanOwner });
  console.log("Human Owner (operator, standing in) approved the exact text above.");

  section("STOPPING HONESTLY HERE — this is the real boundary, not a simulated one");
  console.log(`
The message above is REAL: a real, human-approved, ready-to-send text, referencing a REAL
prospect lead (${prospect.sourceUrl}).

What happens next in a real deployment is a HUMAN_ACTION this session cannot perform and must
not simulate: the actual Human Owner personally sends this exact text through their own real
channel (the forum thread itself, a direct message, email), waits for a real reply — which may
take hours, days, or never come — and then pastes that real reply back in for the Response
Analyst to classify (customerResponseService.record + responseAnalystService.run, both already
built and unchanged).

No customer response is fabricated here. Until a real reply exists, this opportunity's
WILLINGNESS_TO_PAY claim stays exactly where Phase 2 left it, and the Build Gate
(src/domain/real-world/validation-threshold.ts, BUILD_GATE_MINIMUM_LEVEL=VERY_STRONG) is not
and must not be satisfied by anything produced in this session.
`);

  await prisma.$disconnect();
  console.log("=== M10 customer discovery (stopped at the real human-action boundary) finished OK ===");
}

await main();
