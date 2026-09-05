import { beforeEach } from "vitest";
import { TEST_DATABASE_URL } from "./test-db.js";

// Must happen before anything that imports src/config.ts or
// src/db/client.ts. Static imports in THIS file would be hoisted above
// these assignments (ESM import evaluation always precedes same-file
// statements), so those modules are loaded dynamically below, after
// process.env is set. Test files importing services normally are safe
// because Vitest fully runs setupFiles before loading the test file.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.PORT = process.env.PORT ?? "0";
// No live model/network dependency in the automated suite — ever.
process.env.MODEL_PROVIDER_MODE = "development";
process.env.RESEARCH_TOOL_MODE = "development";

const { prisma } = await import("../src/db/client.js");
const { identityService } = await import("../src/services/identity.service.js");
const { registerDefaultTools } = await import("../src/tools/register-tools.js");

registerDefaultTools();

async function resetDatabase(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.event.deleteMany();
  await prisma.memory.deleteMany();
  // M6 leaf tables first (FK-safe order — docs/M6_ARCHITECTURE_PROPOSAL.md §34):
  // productReviewMemo references product (Cascade)/ceoRecommendation/
  // chairmanReview (both Restrict) so it precedes all three; security/qa/
  // codeReview reference engineeringTask (Cascade) so they precede it;
  // engineeringTask references mvpArchitecture (Cascade)/product (Restrict)
  // so it precedes both; mvpArchitecture references product (Cascade)/
  // productSpec (Restrict) so it precedes both; feature references
  // productSpec (Cascade)/claim (Restrict) so it precedes both.
  await prisma.productReviewMemo.deleteMany();
  await prisma.securityReview.deleteMany();
  await prisma.qaReport.deleteMany();
  await prisma.codeReview.deleteMany();
  await prisma.engineeringTask.deleteMany();
  await prisma.mvpArchitecture.deleteMany();
  await prisma.feature.deleteMany();
  await prisma.productSpec.deleteMany();
  // M7 leaf tables first (FK-safe order — docs/M7_ARCHITECTURE_PROPOSAL.md
  // §33): launchReviewMemo references launchPlan/ceoRecommendation/
  // chairmanReview (all Restrict) so it precedes all three; deployment
  // references deploymentPlan (Restrict) so it precedes it; billingAccount
  // references billingPlan (Restrict) so it precedes it; billingPlan
  // references pricingModel (Restrict) so it precedes it. Everything else
  // below is Cascade/SetNull from product, so order among them doesn't
  // matter — grouped here only for readability.
  await prisma.webhookDelivery.deleteMany();
  await prisma.launchReviewMemo.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.deployment.deleteMany();
  await prisma.billingAccount.deleteMany();
  await prisma.deploymentPlan.deleteMany();
  await prisma.billingPlan.deleteMany();
  await prisma.launchPlan.deleteMany();
  await prisma.pricingModel.deleteMany();
  await prisma.goToMarketPlan.deleteMany();
  await prisma.businessMetric.deleteMany();
  await prisma.supportCase.deleteMany();
  // M8 leaf tables first (FK-safe order — docs/M8_ARCHITECTURE_PROPOSAL.md
  // §32): activationDefinition/cohort/anomaly/businessHealth/
  // portfolioSnapshot/predictionOutcome are all Cascade/SetNull from
  // product only, so order among them doesn't matter — grouped here for
  // readability, before product itself. growthExperiment/growthExperimentResult/
  // learningRecord/businessReviewMemo have Restrict FKs to claim/
  // ceoRecommendation/chairmanReview and are deleted further below,
  // before those tables (docs/DECISIONS.md #64's own resetDatabase discipline).
  await prisma.activationDefinition.deleteMany();
  await prisma.cohort.deleteMany();
  await prisma.anomaly.deleteMany();
  await prisma.businessHealth.deleteMany();
  await prisma.portfolioSnapshot.deleteMany();
  await prisma.predictionOutcome.deleteMany();
  await prisma.product.deleteMany();
  // M5 leaf tables first (FK-safe order — docs/M5_ARCHITECTURE_PROPOSAL.md §22):
  // customerDiscoveryMemo references outreachExperiment/ceoRecommendation/
  // chairmanReview (all Restrict) so it must go before all three;
  // customerEvidence references evidence/prospect (Restrict) so it
  // precedes both; customerResponse references outreachMessage/prospect
  // (Restrict) so it precedes both; outreachMessage references
  // prospect/claim (Restrict) so it precedes both; outreachExperiment
  // references claim/icpProfile (Restrict) so it precedes both.
  await prisma.customerDiscoveryMemo.deleteMany();
  await prisma.customerEvidence.deleteMany();
  await prisma.customerResponse.deleteMany();
  await prisma.outreachMessage.deleteMany();
  await prisma.outreachExperiment.deleteMany();
  await prisma.prospect.deleteMany();
  await prisma.icpProfile.deleteMany();
  // M4 leaf tables first (FK-safe order — docs/M4_ARCHITECTURE_PROPOSAL.md §21):
  // decisionRecord references approvalRequest/investmentMemo/ceoRecommendation/
  // chairmanReview (some Restrict) so it must go before all of them;
  // claimEvidence/validationReport reference claim (validationReport's FK is
  // Restrict, so it must precede claim); investmentMemo references
  // ceoRecommendation/chairmanReview (Restrict) so it precedes both.
  // M9 leaf tables first (FK-safe order — docs/M9_ARCHITECTURE_PROPOSAL.md
  // §55): cycleStageEvent/companyReview reference operatingCycle/
  // companyRecommendation (Cascade) so they precede both; operatingCycle
  // itself has a Restrict FK to identity (startedByIdentityId), so it
  // must be gone before identity.deleteMany() below — this whole block
  // was missing from the original M1-M8 resetDatabase (a real gap this
  // build's own m9-security.test.ts caught: without it, any test
  // creating an OperatingCycle broke every later test's identity
  // bootstrap with a foreign-key violation). The rest (founderAttentionItem/
  // companyBudget/resourceAllocation/alert/briefing/decisionOutcome/
  // emergencyStop/founderCockpitView) carry no Restrict FKs, so order
  // among them doesn't matter — grouped here for readability.
  await prisma.cycleStageEvent.deleteMany();
  await prisma.companyReview.deleteMany();
  await prisma.companyRecommendation.deleteMany();
  await prisma.operatingCycle.deleteMany();
  // M10 — real_world_experiments.created_by_identity_id is Restrict, same reason as above.
  await prisma.realWorldExperiment.deleteMany();
  await prisma.founderAttentionItem.deleteMany();
  await prisma.companyBudget.deleteMany();
  await prisma.resourceAllocation.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.briefing.deleteMany();
  await prisma.decisionOutcome.deleteMany();
  await prisma.emergencyStop.deleteMany();
  await prisma.founderCockpitView.deleteMany();
  await prisma.approvalSnapshot.deleteMany();
  await prisma.decisionRecord.deleteMany();
  // M8 tables with Restrict FKs to claim/ceoRecommendation/chairmanReview
  // (docs/M8_ARCHITECTURE_PROPOSAL.md §32) — must precede all three below.
  await prisma.learningRecord.deleteMany();
  await prisma.businessReviewMemo.deleteMany();
  await prisma.growthExperimentResult.deleteMany();
  await prisma.growthExperiment.deleteMany();
  await prisma.claimEvidence.deleteMany();
  await prisma.investmentMemo.deleteMany();
  await prisma.validationReport.deleteMany();
  await prisma.ceoRecommendation.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.decisionCycle.deleteMany();
  // M3 leaf tables (FK-safe order — docs/M3_ARCHITECTURE_PROPOSAL.md §16).
  await prisma.researchQueueItem.deleteMany();
  await prisma.evidenceGap.deleteMany();
  await prisma.competitorObservation.deleteMany();
  await prisma.competitor.deleteMany();
  await prisma.toolExecution.deleteMany();
  await prisma.agentExecution.deleteMany();
  await prisma.researchCycle.deleteMany();
  await prisma.chairmanReview.deleteMany();
  await prisma.opportunityScoreRecord.deleteMany();
  await prisma.opportunityEvidence.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.problem.deleteMany();
  await prisma.signal.deleteMany();
  await prisma.signalCluster.deleteMany();
  await prisma.task.deleteMany();
  await prisma.agentPermission.deleteMany();
  await prisma.identity.deleteMany();
  await prisma.agent.deleteMany();
}

/**
 * A verified HUMAN Actor, freshly bootstrapped before every single
 * test (the database — identities included — is wiped first, so the
 * one-time bootstrap path in identityService.createIdentity is always
 * available here). Tests that need a *second* distinct human should
 * call identityService.createIdentity themselves with `humanOwner` as
 * `createdBy`.
 */
export let humanOwner: { actorType: "HUMAN"; actorId: string };

beforeEach(async () => {
  await resetDatabase();
  const { identity } = await identityService.createIdentity({ type: "HUMAN", label: "Test Founder", createdBy: null });
  humanOwner = { actorType: "HUMAN", actorId: identity.id };
});
