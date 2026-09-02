-- M4 — Decision Intelligence Engine (docs/M4_ARCHITECTURE_PROPOSAL.md §21).
-- Hand-augmented with SQLite CHECK constraints on every enum-like and
-- 0..1-bounded column, exactly the same discipline the M1/M3 migrations
-- established (see prisma/schema.prisma's own top-of-file note: SQLite
-- has no native enum support, so the canonical value sets defined in
-- TypeScript — src/domain/** — are mirrored here as CHECK constraints,
-- never trusted from the write path alone).
--
-- Two tables this migration rebuilds (agent_executions, evidence_gaps)
-- already carry hand-added CHECK constraints from earlier migrations;
-- those are reproduced byte-for-byte below (confirmed against the live
-- dev database's sqlite_master before writing this file) so this
-- migration adds columns without silently dropping any existing
-- constraint. Two more tables (opportunities, events) are rebuilt here
-- specifically to widen their CHECK constraints (KILLED; the five new
-- M4 domain event types) — the exact lesson recorded in
-- docs/DECISIONS.md from M3's "events" CHECK-constraint gap: every
-- DOMAIN_EVENT_TYPES addition ships in the same migration that adds
-- the tables producing it, not left for a later migration to catch up.

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "claim_type" TEXT NOT NULL CHECK ("claim_type" IN ('CUSTOMER_PROBLEM', 'CUSTOMER_SEGMENT', 'FREQUENCY', 'WILLINGNESS_TO_PAY', 'MARKET_SIZE', 'COMPETITIVE_POSITION', 'DIFFERENTIATION', 'DISTRIBUTION', 'RETENTION', 'BUILDABILITY', 'TIMING', 'ECONOMICS')),
    "statement" TEXT NOT NULL,
    "importance" TEXT NOT NULL CHECK ("importance" IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK ("status" IN ('UNVERIFIED', 'SUPPORTED', 'WEAK', 'CONTRADICTED', 'CONFLICTED', 'INSUFFICIENT_EVIDENCE')),
    "confidence" REAL NOT NULL DEFAULT 0 CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "extracted_from" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "claims_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "claim_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claim_id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "relationship" TEXT NOT NULL CHECK ("relationship" IN ('SUPPORTING', 'CONTRADICTING', 'UNKNOWN')),
    "reasoning" TEXT NOT NULL,
    "validation_report_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "claim_evidence_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "claim_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "claim_evidence_validation_report_id_fkey" FOREIGN KEY ("validation_report_id") REFERENCES "validation_reports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "validation_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claim_id" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('UNVERIFIED', 'SUPPORTED', 'WEAK', 'CONTRADICTED', 'CONFLICTED', 'INSUFFICIENT_EVIDENCE')),
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "supporting_evidence_ids" TEXT NOT NULL,
    "contradicting_evidence_ids" TEXT NOT NULL,
    "independence_assessment" TEXT NOT NULL,
    "quality_assessment" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "missing_evidence" TEXT NOT NULL,
    "recommended_research" TEXT NOT NULL,
    "model_provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "validation_reports_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ceo_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "decision_cycle_id" TEXT,
    "action" TEXT NOT NULL CHECK ("action" IN ('KILL', 'DEPRIORITIZE', 'INVESTIGATE', 'VALIDATE_CUSTOMER', 'PREPARE_REVIEW', 'HUMAN_REVIEW')),
    "reasoning" TEXT NOT NULL,
    "cited_claim_ids" TEXT NOT NULL,
    "cited_validation_report_ids" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "priority_score" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ceo_recommendations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ceo_recommendations_decision_cycle_id_fkey" FOREIGN KEY ("decision_cycle_id") REFERENCES "decision_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "investment_memos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "ceo_recommendation_id" TEXT NOT NULL,
    "chairman_review_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "strongest_argument_against" TEXT NOT NULL,
    "investment_thesis" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "key_reason" TEXT NOT NULL,
    "biggest_risk" TEXT NOT NULL,
    "next_action" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "investment_memos_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "investment_memos_ceo_recommendation_id_fkey" FOREIGN KEY ("ceo_recommendation_id") REFERENCES "ceo_recommendations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "investment_memos_chairman_review_id_fkey" FOREIGN KEY ("chairman_review_id") REFERENCES "chairman_reviews" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "decision_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "approval_request_id" TEXT NOT NULL,
    "investment_memo_id" TEXT,
    "ceo_recommendation_id" TEXT,
    "chairman_review_id" TEXT,
    "human_decision" TEXT NOT NULL CHECK ("human_decision" IN ('APPROVED', 'REJECTED', 'MODIFIED', 'DEFERRED', 'CANCELLED', 'EXPIRED')),
    "human_reason" TEXT,
    "opportunity_score_at_decision" REAL CHECK ("opportunity_score_at_decision" IS NULL OR ("opportunity_score_at_decision" >= 0 AND "opportunity_score_at_decision" <= 1)),
    "confidence_at_decision" REAL CHECK ("confidence_at_decision" IS NULL OR ("confidence_at_decision" >= 0 AND "confidence_at_decision" <= 1)),
    "kill_risk_at_decision" REAL CHECK ("kill_risk_at_decision" IS NULL OR ("kill_risk_at_decision" >= 0 AND "kill_risk_at_decision" <= 1)),
    "rejected_claim_ids" TEXT NOT NULL,
    "accepted_claim_ids" TEXT NOT NULL,
    "missing_evidence_noted" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_records_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "decision_records_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "decision_records_investment_memo_id_fkey" FOREIGN KEY ("investment_memo_id") REFERENCES "investment_memos" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "decision_records_ceo_recommendation_id_fkey" FOREIGN KEY ("ceo_recommendation_id") REFERENCES "ceo_recommendations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "decision_records_chairman_review_id_fkey" FOREIGN KEY ("chairman_review_id") REFERENCES "chairman_reviews" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "decision_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK ("status" IN ('SCHEDULED', 'RUNNING', 'PAUSED', 'STOPPED', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED')),
    "started_by_identity_id" TEXT NOT NULL,
    "max_claims" INTEGER NOT NULL CHECK ("max_claims" > 0),
    "max_validator_searches" INTEGER NOT NULL CHECK ("max_validator_searches" > 0),
    "max_model_calls" INTEGER NOT NULL CHECK ("max_model_calls" > 0),
    "max_research_tasks" INTEGER NOT NULL CHECK ("max_research_tasks" > 0),
    "max_ceo_planning_steps" INTEGER NOT NULL CHECK ("max_ceo_planning_steps" > 0),
    "max_duration_ms" INTEGER NOT NULL CHECK ("max_duration_ms" > 0),
    "claims_validated" INTEGER NOT NULL DEFAULT 0 CHECK ("claims_validated" >= 0),
    "validator_search_count" INTEGER NOT NULL DEFAULT 0 CHECK ("validator_search_count" >= 0),
    "model_call_count" INTEGER NOT NULL DEFAULT 0 CHECK ("model_call_count" >= 0),
    "research_tasks_created" INTEGER NOT NULL DEFAULT 0 CHECK ("research_tasks_created" >= 0),
    "ceo_planning_steps" INTEGER NOT NULL DEFAULT 0 CHECK ("ceo_planning_steps" >= 0),
    "stopped_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    CONSTRAINT "decision_cycles_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "decision_cycles_started_by_identity_id_fkey" FOREIGN KEY ("started_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_agent_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_id" TEXT NOT NULL,
    "task_id" TEXT,
    "research_cycle_id" TEXT,
    "decision_cycle_id" TEXT,
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
    CONSTRAINT "agent_executions_decision_cycle_id_fkey" FOREIGN KEY ("decision_cycle_id") REFERENCES "decision_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_executions_started_by_identity_id_fkey" FOREIGN KEY ("started_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_agent_executions" ("agent_id", "completed_at", "completion_tokens", "created_at", "error", "error_code", "estimated_cost_usd", "id", "input", "model_call_count", "model_name", "model_provider", "output", "prompt_tokens", "research_cycle_id", "retry_count", "started_at", "started_by_identity_id", "status", "step_count", "task_id", "tool_call_count") SELECT "agent_id", "completed_at", "completion_tokens", "created_at", "error", "error_code", "estimated_cost_usd", "id", "input", "model_call_count", "model_name", "model_provider", "output", "prompt_tokens", "research_cycle_id", "retry_count", "started_at", "started_by_identity_id", "status", "step_count", "task_id", "tool_call_count" FROM "agent_executions";
DROP TABLE "agent_executions";
ALTER TABLE "new_agent_executions" RENAME TO "agent_executions";
CREATE INDEX "agent_executions_status_idx" ON "agent_executions"("status");
CREATE INDEX "agent_executions_agent_id_idx" ON "agent_executions"("agent_id");
CREATE INDEX "agent_executions_task_id_idx" ON "agent_executions"("task_id");
CREATE INDEX "agent_executions_decision_cycle_id_idx" ON "agent_executions"("decision_cycle_id");
CREATE TABLE "new_evidence_gaps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK ("status" IN ('UNKNOWN', 'ASSUMPTION', 'KNOWN', 'RESOLVED')),
    "description" TEXT NOT NULL,
    "suggested_research_question" TEXT NOT NULL,
    "impact_score" REAL NOT NULL CHECK ("impact_score" >= 0 AND "impact_score" <= 1),
    "claim_id" TEXT,
    "resolved_at" DATETIME,
    "resolved_by_evidence_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_gaps_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "evidence_gaps_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "evidence_gaps_resolved_by_evidence_id_fkey" FOREIGN KEY ("resolved_by_evidence_id") REFERENCES "evidence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_evidence_gaps" ("created_at", "description", "dimension", "id", "impact_score", "opportunity_id", "resolved_at", "resolved_by_evidence_id", "status", "suggested_research_question") SELECT "created_at", "description", "dimension", "id", "impact_score", "opportunity_id", "resolved_at", "resolved_by_evidence_id", "status", "suggested_research_question" FROM "evidence_gaps";
DROP TABLE "evidence_gaps";
ALTER TABLE "new_evidence_gaps" RENAME TO "evidence_gaps";
CREATE INDEX "evidence_gaps_opportunity_id_idx" ON "evidence_gaps"("opportunity_id");
CREATE INDEX "evidence_gaps_status_idx" ON "evidence_gaps"("status");
CREATE INDEX "evidence_gaps_claim_id_idx" ON "evidence_gaps"("claim_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "claims_opportunity_id_idx" ON "claims"("opportunity_id");

-- CreateIndex
CREATE INDEX "claims_status_idx" ON "claims"("status");

-- CreateIndex
CREATE INDEX "claim_evidence_claim_id_idx" ON "claim_evidence"("claim_id");

-- CreateIndex
CREATE INDEX "claim_evidence_evidence_id_idx" ON "claim_evidence"("evidence_id");

-- CreateIndex
CREATE INDEX "validation_reports_claim_id_idx" ON "validation_reports"("claim_id");

-- CreateIndex
CREATE INDEX "ceo_recommendations_opportunity_id_idx" ON "ceo_recommendations"("opportunity_id");

-- CreateIndex
CREATE INDEX "investment_memos_opportunity_id_idx" ON "investment_memos"("opportunity_id");

-- CreateIndex
CREATE INDEX "decision_records_opportunity_id_idx" ON "decision_records"("opportunity_id");

-- CreateIndex
CREATE INDEX "decision_cycles_status_idx" ON "decision_cycles"("status");

-- CreateIndex
CREATE INDEX "decision_cycles_opportunity_id_idx" ON "decision_cycles"("opportunity_id");

-- RedefineTables — widen two existing CHECK constraints (not expressed
-- in prisma/schema.prisma itself, so Prisma's own diff cannot see
-- them; hand-applied here, same as every other CHECK-constraint change
-- in this project's migration history). Reproduces every other column/
-- constraint/index on both tables unchanged.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_opportunities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "target_customer" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK ("status" IN ('DISCOVERED', 'RESEARCHING', 'VALIDATING', 'VALIDATED', 'APPROVED', 'REJECTED', 'KILLED', 'ARCHIVED')),
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
INSERT INTO "new_opportunities" ("id", "title", "problem", "target_customer", "description", "status", "opportunity_score", "confidence_score", "validation_level", "problem_id", "next_best_research_question", "created_at", "updated_at", "metadata") SELECT "id", "title", "problem", "target_customer", "description", "status", "opportunity_score", "confidence_score", "validation_level", "problem_id", "next_best_research_question", "created_at", "updated_at", "metadata" FROM "opportunities";
DROP TABLE "opportunities";
ALTER TABLE "new_opportunities" RENAME TO "opportunities";
CREATE INDEX "opportunities_status_idx" ON "opportunities"("status");
CREATE INDEX "opportunities_problem_id_idx" ON "opportunities"("problem_id");
CREATE TABLE "new_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('AGENT_CREATED', 'AGENT_SUSPENDED', 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_FAILED', 'EVIDENCE_ADDED', 'OPPORTUNITY_DISCOVERED', 'OPPORTUNITY_SCORED', 'OPPORTUNITY_UPDATED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'SIGNAL_CLUSTER_CREATED', 'PROBLEM_EXTRACTED', 'COMPETITOR_ANALYSIS_COMPLETED', 'RESEARCH_CYCLE_STARTED', 'RESEARCH_CYCLE_COMPLETED', 'OPPORTUNITY_DECISION_RECORDED', 'CLAIM_EXTRACTED', 'CLAIM_VALIDATED', 'CEO_RECOMMENDATION_ISSUED', 'INVESTMENT_MEMO_CREATED', 'OPPORTUNITY_KILLED', 'DECISION_CYCLE_STARTED', 'DECISION_CYCLE_COMPLETED')),
    "payload" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_events" ("id", "type", "payload", "occurred_at") SELECT "id", "type", "payload", "occurred_at" FROM "events";
DROP TABLE "events";
ALTER TABLE "new_events" RENAME TO "events";
CREATE INDEX "events_type_idx" ON "events"("type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
