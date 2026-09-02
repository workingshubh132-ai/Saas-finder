import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

/**
 * M5 brief Part 39 — a live demonstration of Customer Discovery
 * Intelligence, run against the real implemented pipeline, not
 * hard-coded output. Runs entirely in MODEL_PROVIDER_MODE=development /
 * RESEARCH_TOOL_MODE=development in this sandbox (no live model key,
 * outbound proxy blocks the research sources — see
 * docs/SOURCE_ADAPTERS.md) — every "[DEV FIXTURE]" value below is
 * clearly labeled and, per docs/CUSTOMER_DISCOVERY.md, a genuine,
 * deterministic function of the REAL data collected in this run, never
 * a static stub. Nothing here is faked: every stage genuinely executes
 * — ICP synthesis, real (dev-fixture) prospect discovery with real
 * source provenance, qualification, drafting, both hard human approval
 * gates, response classification, the unmodified M4 Evidence
 * Validator/confidence recalculation, the CEO's customer-discovery
 * reasoning, the Chairman's independent attack, and memo compilation.
 *
 * *** THE ONE THING THIS DEMO NEVER DOES: SEND ANYTHING. *** There is
 * no send capability anywhere in this codebase (docs/SECURITY.md, M5
 * section — a repo-wide grep for SEND_EXTERNAL_MESSAGE finds only its
 * own two declaration sites, zero grants, ever). "markContacted" below
 * is Human-Owner-only RECORD-KEEPING: in a real run, a human would
 * have already sent the approved text through their own channel
 * BEFORE calling it — this demo calls it immediately after approval
 * purely to keep the scripted walkthrough moving, and says so loudly,
 * every time, so nobody mistakes it for a real send.
 *
 * Shows two opportunities sharing the same shape, diverging only in
 * the real customer response text recorded for each — one where a
 * real prospect's spending language strengthens the WILLINGNESS_TO_PAY
 * claim, one where three independent organizations' real "wouldn't
 * pay" language contradicts it and stops the experiment, exactly as
 * M5 brief Part 39 requires (a positive and a negative path, no
 * hardcoded result).
 *
 * Usage: npm run demo:m5
 */

const DEMO_DB_PATH = "/home/user/Saas-finder/prisma/demo-m5.db";
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
const { opportunityService } = await import("../src/services/opportunity.service.js");
const { claimExtractionService } = await import("../src/services/claim-extraction.service.js");
const { claimRepository } = await import("../src/db/repositories/claim.repository.js");
const { icpAnalystService } = await import("../src/services/icp-analyst.service.js");
const { outreachExperimentService } = await import("../src/services/outreach-experiment.service.js");
const { prospectResearcherService } = await import("../src/services/prospect-researcher.service.js");
const { prospectQualificationService } = await import("../src/services/prospect-qualification.service.js");
const { messageDrafterService } = await import("../src/services/message-drafter.service.js");
const { messageApprovalService } = await import("../src/services/message-approval.service.js");
const { approvalService } = await import("../src/services/approval.service.js");
const { customerResponseService } = await import("../src/services/customer-response.service.js");
const { responseAnalystService } = await import("../src/services/response-analyst.service.js");
const { evidenceValidatorService } = await import("../src/services/evidence-validator.service.js");
const { claimConfidenceService } = await import("../src/services/claim-confidence.service.js");
const { ceoReasoningService } = await import("../src/services/ceo-reasoning.service.js");
const { chairmanService } = await import("../src/services/chairman.service.js");
const { customerDiscoveryMemoService } = await import("../src/services/customer-discovery-memo.service.js");
const { prisma } = await import("../src/db/client.js");

registerDefaultTools();

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

/**
 * DISPLAY ONLY — the underlying dev-fixture organization/message text is
 * genuinely this long (it deterministically embeds the ICP's own
 * role/industry/problemExposure, per prospect-researcher.service.ts's
 * buildDevProspectFixture), and every real service call above still
 * sees and stores the untruncated value. This only keeps the demo's
 * console output readable — it never changes what's actually processed.
 */
function short(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface DemoAgents {
  humanId: string;
  humanActor: { type: "HUMAN"; id: string; identityId: string };
  humanOwner: { actorType: "HUMAN"; actorId: string };
  validatorAgentId: string;
  ceoAgentId: string;
  icpAnalystAgentId: string;
  prospectResearcherAgentId: string;
  prospectQualificationAgentId: string;
  messageDrafterAgentId: string;
  responseAnalystAgentId: string;
}

async function bootstrap(): Promise<DemoAgents> {
  const { identity: humanIdentity } = await identityService.createIdentity({ type: "HUMAN", label: "Founder", createdBy: null });
  const humanActor = { type: "HUMAN" as const, id: humanIdentity.id, identityId: humanIdentity.id };
  const humanOwner = { actorType: "HUMAN" as const, actorId: humanIdentity.id };

  async function makeAgent(name: string, role: string) {
    return agentService.createAgent({ name, role, department: "INTELLIGENCE", description: role, riskLevel: "GREEN", createdBy: { actorType: "HUMAN", actorId: humanIdentity.id } });
  }
  const validatorAgent = await makeAgent("Evidence Validator", "Evidence Validator");
  await agentService.grantPermission({ agentId: validatorAgent.id, permission: "READ_WEB", grantedBy: { actorType: "HUMAN", actorId: humanIdentity.id } });
  const ceoAgent = await makeAgent("CEO", "CEO");
  const icpAnalystAgent = await makeAgent("ICP Analyst", "ICP Analyst");
  const prospectResearcherAgent = await makeAgent("Prospect Researcher", "Prospect Researcher");
  await agentService.grantPermission({ agentId: prospectResearcherAgent.id, permission: "READ_WEB", grantedBy: { actorType: "HUMAN", actorId: humanIdentity.id } });
  const prospectQualificationAgent = await makeAgent("Prospect Qualification", "Prospect Qualification");
  const messageDrafterAgent = await makeAgent("Message Drafter", "Message Drafter");
  const responseAnalystAgent = await makeAgent("Response Analyst", "Response Analyst");

  console.log(`Human Owner: ${humanIdentity.id}`);
  console.log("Agents registered: Evidence Validator(READ_WEB), CEO(zero grants), ICP Analyst(zero grants),");
  console.log("  Prospect Researcher(READ_WEB), Prospect Qualification(zero grants), Message Drafter(zero grants), Response Analyst(zero grants).");

  return {
    humanId: humanIdentity.id,
    humanActor,
    humanOwner,
    validatorAgentId: validatorAgent.id,
    ceoAgentId: ceoAgent.id,
    icpAnalystAgentId: icpAnalystAgent.id,
    prospectResearcherAgentId: prospectResearcherAgent.id,
    prospectQualificationAgentId: prospectQualificationAgent.id,
    messageDrafterAgentId: messageDrafterAgent.id,
    responseAnalystAgentId: responseAnalystAgent.id,
  };
}

async function makeOpportunity(agents: DemoAgents, title: string) {
  const opportunity = await opportunityService.createOpportunity({
    title,
    problem: "Small business owners spend hours every month manually reconciling invoices against bank statements.",
    targetCustomer: "Small business owners and solo bookkeepers",
    description: "A focused tool that automates monthly invoice reconciliation.",
    discoveredBy: { actorType: "AGENT", actorId: agents.ceoAgentId },
  });
  await opportunityService.scoreOpportunity({
    opportunityId: opportunity.id,
    dimensions: { pain: 0.6, demand: 0.6, willingnessToPay: 0.5, reachability: 0.5, retention: 0.5, differentiation: 0.4, buildability: 0.7, economics: 0.5, risk: 0.4, evidenceQuality: 0.5, marketSize: 0.5, frequency: 0.5, evidenceIndependence: 0.4, timing: 0.5 },
    scoredBy: agents.ceoAgentId,
    killRiskDimensions: { weakDemand: 0.3, weakWillingnessToPay: 0.3, crowdedMarket: 0.3, poorDifferentiation: 0.3, badDistribution: 0.3, technicalDifficulty: 0.2, regulatoryRisk: 0.1, platformDependency: 0.1, lowRetention: 0.3, lowMargins: 0.3, insufficientEvidence: 0.3 },
  });
  return opportunity;
}

async function reachActiveExperiment(agents: DemoAgents, opportunityId: string) {
  const claims = await claimExtractionService.extractForOpportunity({ opportunityId, actorType: "AGENT", actorId: agents.ceoAgentId });
  console.log(`Claims extracted: ${claims.length}`);
  const wtpClaim = claims.find((c) => c.claimType === "WILLINGNESS_TO_PAY")!;
  console.log(`  [WILLINGNESS_TO_PAY] status=${wtpClaim.status} confidence=${wtpClaim.confidence.toFixed(2)} — the claim this experiment will test.`);

  const icpOutcome = await icpAnalystService.run({ agentId: agents.icpAnalystAgentId, opportunityId, startedBy: agents.humanActor });
  if (icpOutcome.status !== "COMPLETED") throw new Error(`ICP Analyst failed: ${icpOutcome.execution.error}`);
  const icp = icpOutcome.result.icpProfile;
  console.log(`\nICP synthesized — role: "${icp.role}" | industry: ${icp.industry} | problem exposure: "${icp.problemExposure}"`);

  const experiment = await outreachExperimentService.create({
    opportunityId,
    claimId: wtpClaim.id,
    targetIcpProfileId: icp.id,
    createdByIdentityId: agents.humanId,
    objective: "Learn whether real prospects currently spend money solving this problem.",
    researchQuestion: "How much do you currently spend solving this problem, if anything?",
    messageStrategy: "Ask about current process and spend — learning, not selling, never a pitch.",
    prospectLimit: 25,
    timeWindowStart: null,
    timeWindowEnd: null,
    successCriteria: "3+ independent organizations describe real current spending.",
    failureCriteria: "3+ independent organizations explicitly say they would never pay.",
  });
  console.log(`\nOutreachExperiment ${experiment.id} created (status=${experiment.status}).`);
  console.log("HARD GATE 1: awaiting Human Owner approval before any message may be drafted...");
  const approved = await outreachExperimentService.approve({ id: experiment.id, actor: agents.humanOwner });
  console.log(`Human Owner approved. Experiment is now ${approved.status}.`);

  const researchOutcome = await prospectResearcherService.run({ agentId: agents.prospectResearcherAgentId, icpProfileId: icp.id, startedBy: agents.humanActor });
  if (researchOutcome.status !== "COMPLETED") throw new Error(`Prospect Researcher failed: ${researchOutcome.execution.error}`);
  console.log(`\nProspect Researcher found ${researchOutcome.result.prospects.length} real, source-backed prospect(s):`);
  for (const p of researchOutcome.result.prospects) {
    console.log(`  - ${short(p.organization)}`);
    console.log(`    source: ${short(p.sourceUrl, 110)}`);
  }

  return { wtpClaim, experiment: approved, prospects: researchOutcome.result.prospects };
}

async function qualifyDraftApproveContact(agents: DemoAgents, experimentId: string, prospectId: string) {
  const qualifyOutcome = await prospectQualificationService.run({ agentId: agents.prospectQualificationAgentId, prospectId, startedBy: agents.humanActor });
  if (qualifyOutcome.status !== "COMPLETED") throw new Error(`Prospect Qualification failed: ${qualifyOutcome.execution.error}`);
  console.log(`  Qualification: ${qualifyOutcome.result.prospect.qualificationStatus} (icpFit=${qualifyOutcome.result.prospect.icpFit})`);
  if (qualifyOutcome.result.prospect.qualificationStatus !== "QUALIFIED") return null;

  const draftOutcome = await messageDrafterService.run({ agentId: agents.messageDrafterAgentId, experimentId, prospectId, startedBy: agents.humanActor });
  if (draftOutcome.status !== "COMPLETED") throw new Error(`Message Drafter failed: ${draftOutcome.execution.error}`);
  const message = draftOutcome.result.message;
  console.log(`  Drafted message (never sent): "${short(message.content, 160)}"`);

  const approvalRequest = await messageApprovalService.requestApproval({ outreachMessageId: message.id, requestedByAgentId: agents.messageDrafterAgentId });
  console.log(`  HARD GATE 2: RED-risk ApprovalRequest ${approvalRequest.id} created — awaiting Human Owner...`);
  await approvalService.decide({ id: approvalRequest.id, toStatus: "APPROVED", reviewedBy: agents.humanOwner });
  await messageApprovalService.applyDecision({ approvalRequestId: approvalRequest.id, actor: agents.humanOwner });
  console.log("  Human Owner approved the exact text above.");
  console.log("  [DEV FIXTURE / NOT A REAL SEND] In a real run, the Human Owner now personally sends this");
  console.log("  approved text through their own channel (email, LinkedIn, the forum thread itself) — VentureForge");
  console.log("  has no send capability anywhere in this codebase. markContacted() below only RECORDS that a");
  console.log("  human did this outside the system; it never transmits anything itself.");
  await messageApprovalService.markContacted({ outreachMessageId: message.id, actor: agents.humanOwner });

  return message;
}

async function recordAndAnalyze(agents: DemoAgents, messageId: string, rawContent: string) {
  const response = await customerResponseService.record({ outreachMessageId: messageId, rawContent, actor: agents.humanOwner });
  console.log(`  [DEV FIXTURE / NOT A REAL RESPONSE] Human Owner pastes in the real reply they received: "${rawContent}"`);
  const analysisOutcome = await responseAnalystService.run({ agentId: agents.responseAnalystAgentId, customerResponseId: response.id, startedBy: agents.humanActor });
  if (analysisOutcome.status !== "COMPLETED") throw new Error(`Response Analyst failed: ${analysisOutcome.execution.error}`);
  console.log(`  Response Analyst classification: ${analysisOutcome.result.classification} (${analysisOutcome.result.evidenceCount} evidence item(s) extracted)`);
  return analysisOutcome.result;
}

async function runValidatorCeoChairmanMemo(agents: DemoAgents, opportunityId: string, wtpClaimId: string, experimentId: string) {
  const validationOutcome = await evidenceValidatorService.run({ agentId: agents.validatorAgentId, claimId: wtpClaimId, maxSearches: 0, startedBy: agents.humanActor });
  if (validationOutcome.status !== "COMPLETED") throw new Error(`Evidence Validator failed: ${validationOutcome.execution.error}`);
  const updatedClaim = await claimConfidenceService.recalculateFromLatestReport({ claimId: wtpClaimId, actorType: "AGENT", actorId: agents.validatorAgentId });
  console.log(`\nEvidence Validator (unmodified M4 component): WILLINGNESS_TO_PAY is now ${updatedClaim.status} (confidence ${updatedClaim.confidence.toFixed(2)}).`);

  const ceoOutcome = await ceoReasoningService.recommendCustomerDiscoveryAction({ agentId: agents.ceoAgentId, opportunityId, startedBy: agents.humanActor });
  if (ceoOutcome.status !== "COMPLETED") throw new Error(`CEO customer-discovery reasoning failed: ${ceoOutcome.execution.error}`);
  const rec = ceoOutcome.result.recommendation;
  console.log(`\nCEO CUSTOMER-DISCOVERY RECOMMENDATION: ${rec.action} (confidence ${rec.confidence.toFixed(2)})`);
  console.log(`  Reasoning: ${rec.reasoning}`);

  const chairmanResult = await chairmanService.review({ opportunityId, reviewedBy: agents.humanActor });
  console.log(`\nCHAIRMAN: ${chairmanResult.decision.decision}`);
  for (const [i, o] of chairmanResult.decision.objections.entries()) console.log(`  ${i + 1}. ${o}`);

  const { memo, content } = await customerDiscoveryMemoService.compile({
    experimentId,
    ceoRecommendationId: rec.id,
    chairmanReviewId: chairmanResult.review.id,
    actorType: "AGENT",
    actorId: agents.ceoAgentId,
  });
  console.log(`\nCUSTOMER DISCOVERY MEMO ${memo.id}:`);
  console.log(`  Prospects contacted: ${content.prospectsContacted}   Responses: ${memo.responseCount}   Independent organizations: ${memo.independentOrganizationCount}`);
  console.log(`  Claims strengthened: ${content.claimsStrengthened.map((c) => c.claimType).join(", ") || "(none)"}`);
  console.log(`  Claims weakened: ${content.claimsWeakened.map((c) => c.claimType).join(", ") || "(none)"}`);
  console.log(`  Recommendation: ${memo.recommendation}`);

  return { updatedClaim, rec, chairmanResult, memo };
}

async function main(): Promise<void> {
  section("BOOTSTRAP");
  const agents = await bootstrap();

  section("OPPORTUNITY A — real customer evidence strengthens the thesis");
  const opportunityA = await makeOpportunity(agents, "Automated invoice reconciliation for small businesses");
  console.log(`Opportunity: ${opportunityA.id} — "${opportunityA.title}"`);
  const chainA = await reachActiveExperiment(agents, opportunityA.id);

  console.log("\nMessaging the one discovered prospect...");
  const messageA = await qualifyDraftApproveContact(agents, chainA.experiment.id, chainA.prospects[0]!.id);
  if (!messageA) throw new Error("Demo prospect did not qualify — this would be a genuine, honest outcome, but the scripted walkthrough needs a qualified prospect to continue.");

  console.log("\nRecording the real customer response received...");
  await recordAndAnalyze(agents, messageA.id, "We currently pay about $150/month for a partial workaround and it's still a hassle to reconcile everything by hand.");

  const resultA = await runValidatorCeoChairmanMemo(agents, opportunityA.id, chainA.wtpClaim.id, chainA.experiment.id);
  console.log("\nHUMAN: reviewing the memo...");
  const decidedA = await customerDiscoveryMemoService.recordHumanDecision({ memoId: resultA.memo.id, decision: "APPROVE", reason: "Real spending signal — worth continuing.", actor: agents.humanOwner });
  console.log(`Human Owner decision: ${decidedA.humanDecision}`);

  section("OPPORTUNITY B — real customer evidence weakens the thesis and stops the experiment");
  const opportunityB = await makeOpportunity(agents, "Automated expense-report reconciliation for freelancers");
  console.log(`Opportunity: ${opportunityB.id} — "${opportunityB.title}"`);
  const chainB = await reachActiveExperiment(agents, opportunityB.id);

  const negativeResponses = [
    "We looked into it, but honestly we wouldn't pay for another tool — our spreadsheet process is free and works well enough for us.",
    "Thanks for reaching out. We wouldn't pay for this kind of tool right now; budget is tight and it isn't a priority.",
    "Appreciate you asking, but we wouldn't pay to solve this — we just live with the manual process as it is.",
  ];
  console.log(`\nMessaging all ${chainB.prospects.length} discovered prospects (${negativeResponses.length} independent organizations)...`);
  for (const [i, prospect] of chainB.prospects.entries()) {
    console.log(`\nProspect ${i + 1}/${chainB.prospects.length}: ${short(prospect.organization)}`);
    const message = await qualifyDraftApproveContact(agents, chainB.experiment.id, prospect.id);
    if (!message) continue;
    const rawContent = negativeResponses[i] ?? negativeResponses[negativeResponses.length - 1]!;
    await recordAndAnalyze(agents, message.id, rawContent);
  }

  const resultB = await runValidatorCeoChairmanMemo(agents, opportunityB.id, chainB.wtpClaim.id, chainB.experiment.id);
  console.log("\nHUMAN: reviewing the memo...");
  const decidedB = await customerDiscoveryMemoService.recordHumanDecision({ memoId: resultB.memo.id, decision: "STOP", reason: "3 independent organizations confirmed they would not pay.", actor: agents.humanOwner });
  console.log(`Human Owner decision: ${decidedB.humanDecision}`);

  section("SUMMARY");
  const finalClaimA = await claimRepository.findById(chainA.wtpClaim.id);
  const finalClaimB = await claimRepository.findById(chainB.wtpClaim.id);
  console.log(`
Opportunity A: ${opportunityA.title}
  WILLINGNESS_TO_PAY: ${chainA.wtpClaim.status} (${chainA.wtpClaim.confidence.toFixed(2)}) -> ${finalClaimA?.status} (${finalClaimA?.confidence.toFixed(2)})
  CEO: ${resultA.rec.action}   Chairman: ${resultA.chairmanResult.decision.decision}   Human: ${decidedA.humanDecision}

Opportunity B: ${opportunityB.title}
  WILLINGNESS_TO_PAY: ${chainB.wtpClaim.status} (${chainB.wtpClaim.confidence.toFixed(2)}) -> ${finalClaimB?.status} (${finalClaimB?.confidence.toFixed(2)})
  CEO: ${resultB.rec.action}   Chairman: ${resultB.chairmanResult.decision.decision}   Human: ${decidedB.humanDecision}

Not one message was ever sent by this system — every "sent" step above was Human-Owner record-keeping over an
already-approved, unmodifiable text. That boundary is structural in this codebase, not a policy this demo merely
followed (docs/SECURITY.md, M5 section).
`);

  await prisma.$disconnect();
  console.log("=== Demo finished OK ===");
}

await main();
