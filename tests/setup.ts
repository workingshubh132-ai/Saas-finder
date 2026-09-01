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
  // M3 leaf tables first (FK-safe order — docs/M3_ARCHITECTURE_PROPOSAL.md §16).
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
