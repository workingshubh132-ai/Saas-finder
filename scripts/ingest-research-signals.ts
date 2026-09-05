/**
 * The operator ingestion path for the real-signal boundary
 * (docs/RESEARCH_SIGNAL_INGESTION.md). Takes a JSON file of
 * ExternalResearchSignalInput[] — real research an operator gathered
 * outside this container (this session's own WebSearch, a manual read
 * of a forum thread, etc., exactly the M10 precedent) — and imports it
 * through the unmodified M3 signal pipeline: signalService.ingest()
 * (normalization, dedup, quality, reliability, audit) then
 * signalClusteringService.assign() (independent-source counting).
 *
 * This does NOT fetch anything itself. It does NOT call any research
 * agent. It does NOT run Problem/Competitor/Market/Opportunity Analyst.
 * Those are separate, already-existing, already-tested, human-triggered
 * steps — see this script's own final printout for exactly what to run
 * next and why that decision is left to a human, not automated here.
 *
 * Usage: npx tsx scripts/ingest-research-signals.ts path/to/signals.json [experimentId]
 *
 * Input file shape — a JSON array of:
 * {
 *   "source": { "id": "reddit", "type": "WEB", "group": "r/smallbusiness thread 123" },
 *   "title": "...",
 *   "content": "...",
 *   "url": "https://...",
 *   "observedAt": "2026-09-05T00:00:00Z",
 *   "authorContext": "u/someuser",
 *   "externalReference": "Found via WebSearch, 2026-09-05, query: \"invoice chasing tool\"",
 *   "reality": "REAL",
 *   "provenanceNote": "Read directly from the real thread URL above."
 * }
 */
import { readFileSync } from "node:fs";
import { agentService } from "../src/services/agent.service.js";
import { researchSignalImportService } from "../src/services/research-signal-import.service.js";
import type { ExternalResearchSignalInput } from "../src/domain/signal/external-signal-input.js";
import { prisma } from "../src/db/client.js";

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

const USAGE = "Usage: npx tsx scripts/ingest-research-signals.ts path/to/signals.json [experimentId]";
const INPUT_SHAPE = `
Input file — a JSON array of ExternalResearchSignalInput (docs/RESEARCH_SIGNAL_INGESTION.md):
{
  "source": { "id": "reddit", "type": "WEB", "group": "r/smallbusiness thread 123" },
  "title": "...",
  "content": "...",
  "url": "https://...",
  "observedAt": "2026-09-05T00:00:00Z",
  "authorContext": "u/someuser",
  "externalReference": "Found via WebSearch, 2026-09-05, query: \\"invoice chasing tool\\"",
  "reality": "REAL",
  "provenanceNote": "Read directly from the real thread URL above."
}

"reality" is one of REAL | DEV_FIXTURE | HUMAN_ACTION | SIMULATED (src/domain/real-world/reality.types.ts).
REAL/HUMAN_ACTION require a non-empty "provenanceNote" — an item without one is rejected, not silently stored.
`;

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath || filePath === "--help" || filePath === "-h") {
    console.error(USAGE);
    console.error(INPUT_SHAPE);
    process.exitCode = filePath ? 0 : 1;
    return;
  }
  const experimentId = process.argv[3] ?? null;

  section("RESEARCH SIGNAL IMPORT (docs/RESEARCH_SIGNAL_INGESTION.md)");

  const raw = readFileSync(filePath, "utf-8");
  const items = JSON.parse(raw) as ExternalResearchSignalInput[];
  console.log(`Read ${items.length} item(s) from ${filePath}.`);

  const humanIdentity = await prisma.identity.findFirst({ where: { type: "HUMAN" }, orderBy: { createdAt: "desc" } });
  if (!humanIdentity) {
    throw new Error("No Human Owner identity found — bootstrap one first (e.g. run an earlier milestone's demo/script once).");
  }
  const grantedBy = { actorType: "HUMAN" as const, actorId: humanIdentity.id };

  const importerAgent = await agentService.createAgent({
    name: "Research Signal Importer",
    role: "Research Agent",
    department: "INTELLIGENCE",
    description: "Attributes operator-imported externally observed research signals — collects nothing itself, grants nothing, calls no tool.",
    riskLevel: "GREEN",
    createdBy: grantedBy,
  });
  console.log(`Attribution agent: ${importerAgent.id} (Human Owner: ${humanIdentity.id})`);

  const result = await researchSignalImportService.ingestBatch({
    items,
    collectedByAgentId: importerAgent.id,
    experimentId,
  });

  section("RESULT");
  console.log(`Accepted:   ${result.acceptedCount}`);
  console.log(`Duplicate:  ${result.duplicateCount}`);
  console.log(`Rejected:   ${result.rejectedCount}`);
  if (result.rejected.length > 0) {
    console.log("\nRejections:");
    for (const r of result.rejected) console.log(`  [${r.index}] ${r.reason}`);
  }
  if (result.duplicates.length > 0) {
    console.log("\nDuplicates:");
    for (const d of result.duplicates) console.log(`  [${d.index}] signal ${d.signalId} -> duplicate of ${d.duplicateOfSignalId} (${d.reason})`);
  }
  console.log(`\nAccepted signal ids: ${result.acceptedSignalIds.join(", ") || "(none)"}`);
  console.log(`Touched cluster ids: ${result.touchedClusterIds.join(", ") || "(none)"}`);

  if (result.touchedClusterIds.length > 0) {
    section("NEXT STEP (a human decision, not automated here)");
    console.log(`
These clusters now hold real, deduplicated, correctly-attributed signals. Extracting a
Problem from one is the existing, unmodified M3 step — a human/operator decides which
cluster is worth the model call, then runs it directly:

  problemAnalystService.run({ agentId: <a Problem Analyst agent id>, clusterId: "<cluster id>", startedBy: <actor> })

This script deliberately does not call it automatically (brief: "prove real signals
improve opportunity discovery" before spending on reasoning, never the reverse).
`);
  }

  await prisma.$disconnect();
  console.log("=== research signal import finished OK ===");
}

await main();
