-- The `events` table's CHECK constraint on `type` hardcoded M1's
-- literal event-type list and was never updated when M3 added six new
-- DOMAIN_EVENT_TYPES entries (src/domain/events/event.types.ts) — a
-- real gap this migration closes, caught by the same fail-closed
-- CHECK constraint it's fixing (a live smoke test hit "CHECK
-- constraint failed: type" the moment researchCycleService tried to
-- publish RESEARCH_CYCLE_STARTED). No other table's constraints are
-- affected; `events` has no foreign keys in or out.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('AGENT_CREATED', 'AGENT_SUSPENDED', 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_FAILED', 'EVIDENCE_ADDED', 'OPPORTUNITY_DISCOVERED', 'OPPORTUNITY_SCORED', 'OPPORTUNITY_UPDATED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'SIGNAL_CLUSTER_CREATED', 'PROBLEM_EXTRACTED', 'COMPETITOR_ANALYSIS_COMPLETED', 'RESEARCH_CYCLE_STARTED', 'RESEARCH_CYCLE_COMPLETED', 'OPPORTUNITY_DECISION_RECORDED')),
    "payload" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_events" ("id", "type", "payload", "occurred_at") SELECT "id", "type", "payload", "occurred_at" FROM "events";
DROP TABLE "events";
ALTER TABLE "new_events" RENAME TO "events";
CREATE INDEX "events_type_idx" ON "events"("type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
