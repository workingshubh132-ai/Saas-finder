-- CreateTable
CREATE TABLE "real_world_experiments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" DATETIME,
    "created_by_identity_id" TEXT NOT NULL,
    CONSTRAINT "real_world_experiments_created_by_identity_id_fkey" FOREIGN KEY ("created_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_operating_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "objective" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "stage" TEXT NOT NULL DEFAULT 'CREATED',
    "kind" TEXT NOT NULL DEFAULT 'MANUAL',
    "max_cost_usd" REAL NOT NULL,
    "risk_level" TEXT NOT NULL,
    "deadline" DATETIME,
    "owner" TEXT NOT NULL,
    "consumed_cost_usd" REAL NOT NULL DEFAULT 0,
    "stopped_reason" TEXT,
    "idempotency_key" TEXT,
    "retried_from_cycle_id" TEXT,
    "started_by_identity_id" TEXT NOT NULL,
    "scheduled_for" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "real_world_experiment_id" TEXT,
    CONSTRAINT "operating_cycles_retried_from_cycle_id_fkey" FOREIGN KEY ("retried_from_cycle_id") REFERENCES "operating_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "operating_cycles_started_by_identity_id_fkey" FOREIGN KEY ("started_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "operating_cycles_real_world_experiment_id_fkey" FOREIGN KEY ("real_world_experiment_id") REFERENCES "real_world_experiments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_operating_cycles" ("completed_at", "consumed_cost_usd", "created_at", "deadline", "id", "idempotency_key", "kind", "max_cost_usd", "objective", "owner", "retried_from_cycle_id", "risk_level", "scheduled_for", "scope", "stage", "started_at", "started_by_identity_id", "status", "stopped_reason") SELECT "completed_at", "consumed_cost_usd", "created_at", "deadline", "id", "idempotency_key", "kind", "max_cost_usd", "objective", "owner", "retried_from_cycle_id", "risk_level", "scheduled_for", "scope", "stage", "started_at", "started_by_identity_id", "status", "stopped_reason" FROM "operating_cycles";
DROP TABLE "operating_cycles";
ALTER TABLE "new_operating_cycles" RENAME TO "operating_cycles";
CREATE UNIQUE INDEX "operating_cycles_idempotency_key_key" ON "operating_cycles"("idempotency_key");
CREATE INDEX "operating_cycles_status_idx" ON "operating_cycles"("status");
CREATE INDEX "operating_cycles_stage_idx" ON "operating_cycles"("stage");
CREATE INDEX "operating_cycles_real_world_experiment_id_idx" ON "operating_cycles"("real_world_experiment_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
