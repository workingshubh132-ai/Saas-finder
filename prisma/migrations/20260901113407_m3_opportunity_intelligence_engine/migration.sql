-- M3 — Opportunity Intelligence Engine (docs/M3_ARCHITECTURE_PROPOSAL.md).
-- Hand-augmented with SQLite CHECK constraints on every enum-like and
-- bounded-numeric column, matching the M1/M2 migrations (see
-- docs/SECURITY.md, "Fail-closed enums, in the database too").
-- Every existing CHECK constraint on a rebuilt table (evidence,
-- opportunities, agent_executions — SQLite must recreate a table to
-- add a foreign-key column) is carried forward unchanged.

-- AlterTable
ALTER TABLE "opportunity_score_records" ADD COLUMN "kill_risk_dimensions" TEXT;
ALTER TABLE "opportunity_score_records" ADD COLUMN "kill_risk_reasons" TEXT;
ALTER TABLE "opportunity_score_records" ADD COLUMN "kill_risk_score" REAL CHECK ("kill_risk_score" IS NULL OR ("kill_risk_score" >= 0 AND "kill_risk_score" <= 1));

-- CreateTable
CREATE TABLE "signals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL CHECK ("source_type" IN ('WEB', 'CUSTOMER', 'COMPETITOR', 'MARKET_DATA', 'INTERNAL', 'EXPERIMENT', 'OTHER')),
    "source_reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "published_at" DATETIME,
    "collected_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_context" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "content_hash" TEXT NOT NULL,
    "source_group_key" TEXT,
    "metadata" TEXT,
    "reliability" TEXT NOT NULL CHECK ("reliability" IN ('LOW', 'MEDIUM', 'HIGH')),
    "quality_score" REAL NOT NULL DEFAULT 0 CHECK ("quality_score" >= 0 AND "quality_score" <= 1),
    "status" TEXT NOT NULL DEFAULT 'NEW' CHECK ("status" IN ('NEW', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'CLUSTERED', 'ARCHIVED')),
    "cluster_id" TEXT,
    "duplicate_of_signal_id" TEXT,
    "duplicate_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "signals_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "signal_clusters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "signals_duplicate_of_signal_id_fkey" FOREIGN KEY ("duplicate_of_signal_id") REFERENCES "signals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "signal_clusters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "signal_count" INTEGER NOT NULL DEFAULT 0 CHECK ("signal_count" >= 0),
    "independent_source_count" INTEGER NOT NULL DEFAULT 0 CHECK ("independent_source_count" >= 0 AND "independent_source_count" <= "signal_count"),
    "confidence" REAL NOT NULL DEFAULT 0 CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "problems" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cluster_id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "customer_segment" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "pain" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "current_solution" TEXT NOT NULL,
    "dissatisfaction" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "willingness_to_pay_signal" TEXT NOT NULL,
    "evidence_count" INTEGER NOT NULL CHECK ("evidence_count" >= 0),
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK ("status" IN ('CANDIDATE', 'PROMOTED', 'INSUFFICIENT_EVIDENCE', 'REJECTED', 'ARCHIVED')),
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "problems_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "signal_clusters" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "competitor_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitor_id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('PRICING', 'POSITIONING', 'REVIEW', 'STRENGTH', 'WEAKNESS', 'MARKET_MATURITY')),
    "detail" TEXT NOT NULL,
    "source_reference" TEXT,
    "observed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "competitor_observations_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "competitor_observations_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "evidence_gaps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK ("status" IN ('UNKNOWN', 'ASSUMPTION', 'KNOWN', 'RESOLVED')),
    "description" TEXT NOT NULL,
    "suggested_research_question" TEXT NOT NULL,
    "impact_score" REAL NOT NULL CHECK ("impact_score" >= 0 AND "impact_score" <= 1),
    "resolved_at" DATETIME,
    "resolved_by_evidence_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_gaps_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "evidence_gaps_resolved_by_evidence_id_fkey" FOREIGN KEY ("resolved_by_evidence_id") REFERENCES "evidence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "research_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK ("status" IN ('SCHEDULED', 'RUNNING', 'PAUSED', 'STOPPED', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED')),
    "started_by_identity_id" TEXT NOT NULL,
    "max_duration_ms" INTEGER NOT NULL CHECK ("max_duration_ms" > 0),
    "max_signals" INTEGER NOT NULL CHECK ("max_signals" > 0),
    "max_tool_calls" INTEGER NOT NULL CHECK ("max_tool_calls" > 0),
    "max_model_calls" INTEGER NOT NULL CHECK ("max_model_calls" > 0),
    "max_cost_usd" REAL NOT NULL CHECK ("max_cost_usd" >= 0),
    "signals_collected" INTEGER NOT NULL DEFAULT 0 CHECK ("signals_collected" >= 0),
    "tool_call_count" INTEGER NOT NULL DEFAULT 0 CHECK ("tool_call_count" >= 0),
    "model_call_count" INTEGER NOT NULL DEFAULT 0 CHECK ("model_call_count" >= 0),
    "opportunities_generated" INTEGER NOT NULL DEFAULT 0 CHECK ("opportunities_generated" >= 0),
    "estimated_cost_usd" REAL CHECK ("estimated_cost_usd" IS NULL OR "estimated_cost_usd" >= 0),
    "stopped_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    CONSTRAINT "research_cycles_started_by_identity_id_fkey" FOREIGN KEY ("started_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "research_queue_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "evidence_gap_id" TEXT,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('RESOLVE_EVIDENCE_GAP', 'DEEPEN_RESEARCH', 'NEW_SIGNAL_SWEEP')),
    "priority_score" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED')),
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "research_queue_items_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "research_queue_items_evidence_gap_id_fkey" FOREIGN KEY ("evidence_gap_id") REFERENCES "evidence_gaps" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_agent_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_id" TEXT NOT NULL,
    "task_id" TEXT,
    "research_cycle_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED' CHECK ("status" IN ('CREATED', 'QUEUED', 'RUNNING', 'WAITING_FOR_TOOL', 'PROCESSING_RESULT', 'COMPLETED', 'FAILED', 'CANCELLED')),
    "started_by_identity_id" TEXT NOT NULL,
    "model_provider" TEXT,
    "model_name" TEXT,
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "tool_call_count" INTEGER NOT NULL DEFAULT 0,
    "model_call_count" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "estimated_cost_usd" REAL CHECK ("estimated_cost_usd" IS NULL OR "estimated_cost_usd" >= 0),
    "input" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "error_code" TEXT CHECK ("error_code" IS NULL OR "error_code" IN ('VALIDATION_ERROR', 'AUTHENTICATION_ERROR', 'AUTHORIZATION_ERROR', 'TOOL_ERROR', 'MODEL_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'BUDGET_EXCEEDED', 'DOMAIN_ERROR', 'INTERNAL_ERROR')),
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    CONSTRAINT "agent_executions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_executions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_executions_research_cycle_id_fkey" FOREIGN KEY ("research_cycle_id") REFERENCES "research_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_executions_started_by_identity_id_fkey" FOREIGN KEY ("started_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_agent_executions" ("agent_id", "completed_at", "completion_tokens", "created_at", "error", "error_code", "estimated_cost_usd", "id", "input", "model_call_count", "model_name", "model_provider", "output", "prompt_tokens", "retry_count", "started_at", "started_by_identity_id", "status", "step_count", "task_id", "tool_call_count") SELECT "agent_id", "completed_at", "completion_tokens", "created_at", "error", "error_code", "estimated_cost_usd", "id", "input", "model_call_count", "model_name", "model_provider", "output", "prompt_tokens", "retry_count", "started_at", "started_by_identity_id", "status", "step_count", "task_id", "tool_call_count" FROM "agent_executions";
DROP TABLE "agent_executions";
ALTER TABLE "new_agent_executions" RENAME TO "agent_executions";
CREATE INDEX "agent_executions_status_idx" ON "agent_executions"("status");
CREATE INDEX "agent_executions_agent_id_idx" ON "agent_executions"("agent_id");
CREATE INDEX "agent_executions_task_id_idx" ON "agent_executions"("task_id");
CREATE TABLE "new_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claim" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL CHECK ("source_type" IN ('WEB', 'CUSTOMER', 'COMPETITOR', 'MARKET_DATA', 'INTERNAL', 'EXPERIMENT', 'OTHER')),
    "source_reference" TEXT,
    "collected_by_agent_id" TEXT NOT NULL,
    "collected_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signal_id" TEXT,
    "reliability" TEXT NOT NULL CHECK ("reliability" IN ('LOW', 'MEDIUM', 'HIGH')),
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK ("verification_status" IN ('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'DISPUTED', 'REJECTED')),
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "evidence_collected_by_agent_id_fkey" FOREIGN KEY ("collected_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "evidence_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_evidence" ("claim", "collected_at", "collected_by_agent_id", "confidence", "created_at", "id", "metadata", "reliability", "source", "source_reference", "source_type", "updated_at", "verification_status") SELECT "claim", "collected_at", "collected_by_agent_id", "confidence", "created_at", "id", "metadata", "reliability", "source", "source_reference", "source_type", "updated_at", "verification_status" FROM "evidence";
DROP TABLE "evidence";
ALTER TABLE "new_evidence" RENAME TO "evidence";
CREATE INDEX "evidence_collected_by_agent_id_idx" ON "evidence"("collected_by_agent_id");
CREATE INDEX "evidence_source_type_idx" ON "evidence"("source_type");
CREATE INDEX "evidence_signal_id_idx" ON "evidence"("signal_id");
CREATE TABLE "new_opportunities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "target_customer" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK ("status" IN ('DISCOVERED', 'RESEARCHING', 'VALIDATING', 'VALIDATED', 'APPROVED', 'REJECTED', 'ARCHIVED')),
    "opportunity_score" REAL CHECK ("opportunity_score" IS NULL OR ("opportunity_score" >= 0 AND "opportunity_score" <= 1)),
    "confidence_score" REAL CHECK ("confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1)),
    "validation_level" TEXT NOT NULL DEFAULT 'LEVEL_0' CHECK ("validation_level" IN ('LEVEL_0', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_6', 'LEVEL_7', 'LEVEL_8')),
    "problem_id" TEXT,
    "next_best_research_question" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "metadata" TEXT,
    CONSTRAINT "opportunities_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_opportunities" ("confidence_score", "created_at", "description", "id", "metadata", "opportunity_score", "problem", "status", "target_customer", "title", "updated_at", "validation_level") SELECT "confidence_score", "created_at", "description", "id", "metadata", "opportunity_score", "problem", "status", "target_customer", "title", "updated_at", "validation_level" FROM "opportunities";
DROP TABLE "opportunities";
ALTER TABLE "new_opportunities" RENAME TO "opportunities";
CREATE INDEX "opportunities_status_idx" ON "opportunities"("status");
CREATE INDEX "opportunities_problem_id_idx" ON "opportunities"("problem_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "signals_status_idx" ON "signals"("status");

-- CreateIndex
CREATE INDEX "signals_source_idx" ON "signals"("source");

-- CreateIndex
CREATE INDEX "signals_content_hash_idx" ON "signals"("content_hash");

-- CreateIndex
CREATE INDEX "signals_source_group_key_idx" ON "signals"("source_group_key");

-- CreateIndex
CREATE INDEX "signals_cluster_id_idx" ON "signals"("cluster_id");

-- CreateIndex
CREATE INDEX "signal_clusters_status_idx" ON "signal_clusters"("status");

-- CreateIndex
CREATE INDEX "problems_status_idx" ON "problems"("status");

-- CreateIndex
CREATE INDEX "problems_cluster_id_idx" ON "problems"("cluster_id");

-- CreateIndex
CREATE INDEX "competitor_observations_competitor_id_idx" ON "competitor_observations"("competitor_id");

-- CreateIndex
CREATE INDEX "competitor_observations_problem_id_idx" ON "competitor_observations"("problem_id");

-- CreateIndex
CREATE INDEX "evidence_gaps_opportunity_id_idx" ON "evidence_gaps"("opportunity_id");

-- CreateIndex
CREATE INDEX "evidence_gaps_status_idx" ON "evidence_gaps"("status");

-- CreateIndex
CREATE INDEX "research_cycles_status_idx" ON "research_cycles"("status");

-- CreateIndex
CREATE INDEX "research_queue_items_status_idx" ON "research_queue_items"("status");

-- CreateIndex
CREATE INDEX "research_queue_items_opportunity_id_idx" ON "research_queue_items"("opportunity_id");
