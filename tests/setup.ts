import { beforeEach } from "vitest";
import { TEST_DATABASE_URL } from "./test-db.js";

// Must happen before anything that imports src/config.ts or
// src/db/client.ts. Static imports in THIS file would be hoisted above
// these assignments (ESM import evaluation always precedes same-file
// statements), so those modules are loaded dynamically below, after
// process.env is set. Test files importing services normally are safe
// because Vitest fully runs setupFiles before loading the test file.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.HUMAN_OWNER_IDS = process.env.HUMAN_OWNER_IDS ?? "founder,second-owner";
process.env.PORT = process.env.PORT ?? "0";

const { prisma } = await import("../src/db/client.js");

async function resetDatabase(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.event.deleteMany();
  await prisma.memory.deleteMany();
  await prisma.opportunityScoreRecord.deleteMany();
  await prisma.opportunityEvidence.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.agentPermission.deleteMany();
  await prisma.agent.deleteMany();
}

beforeEach(async () => {
  await resetDatabase();
});
