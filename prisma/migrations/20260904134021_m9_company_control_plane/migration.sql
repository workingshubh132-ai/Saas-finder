-- CreateTable
CREATE TABLE "operating_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "objective" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK ("status" IN ('SCHEDULED', 'RUNNING', 'PAUSED', 'STOPPED', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED')),
    "stage" TEXT NOT NULL DEFAULT 'CREATED' CHECK ("stage" IN ('CREATED', 'PLANNING', 'RESEARCHING', 'ANALYZING', 'DECIDING', 'AWAITING_HUMAN', 'EXECUTING', 'OBSERVING', 'LEARNING', 'COMPLETED')),
    "kind" TEXT NOT NULL DEFAULT 'MANUAL' CHECK ("kind" IN ('SCHEDULED', 'MANUAL', 'RESUMED', 'RETRIED')),
    "max_cost_usd" REAL NOT NULL,
    "risk_level" TEXT NOT NULL CHECK ("risk_level" IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
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
    CONSTRAINT "operating_cycles_retried_from_cycle_id_fkey" FOREIGN KEY ("retried_from_cycle_id") REFERENCES "operating_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "operating_cycles_started_by_identity_id_fkey" FOREIGN KEY ("started_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cycle_stage_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycle_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL CHECK ("stage" IN ('CREATED', 'PLANNING', 'RESEARCHING', 'ANALYZING', 'DECIDING', 'AWAITING_HUMAN', 'EXECUTING', 'OBSERVING', 'LEARNING', 'COMPLETED')),
    "entered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    "summary" TEXT,
    CONSTRAINT "cycle_stage_events_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "operating_cycles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "company_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL CHECK ("action" IN ('RESEARCH', 'RUN_CUSTOMER_DISCOVERY', 'BUILD', 'IMPROVE_PRODUCT', 'RUN_EXPERIMENT', 'GROW', 'REDUCE_COST', 'INVEST', 'MAINTAIN', 'PAUSE', 'PREPARE_KILL_REVIEW')),
    "reasoning" TEXT NOT NULL,
    "target_opportunity_id" TEXT,
    "target_product_id" TEXT,
    "cited_resource_ids" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "operating_cycle_id" TEXT,
    "conflict_resolution" TEXT CHECK ("conflict_resolution" IS NULL OR "conflict_resolution" IN ('PROCEED', 'CONFLICTED')),
    "human_decision" TEXT CHECK ("human_decision" IS NULL OR "human_decision" IN ('APPROVE', 'REQUEST_CHANGES', 'REJECT', 'DEFER')),
    "human_reason" TEXT,
    "decided_at" DATETIME,
    "decided_by_identity_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_recommendations_target_opportunity_id_fkey" FOREIGN KEY ("target_opportunity_id") REFERENCES "opportunities" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "company_recommendations_target_product_id_fkey" FOREIGN KEY ("target_product_id") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "company_recommendations_operating_cycle_id_fkey" FOREIGN KEY ("operating_cycle_id") REFERENCES "operating_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "company_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company_recommendation_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL CHECK ("decision" IN ('APPROVE', 'REJECT', 'REQUEST_MORE_EVIDENCE', 'REQUEST_CHANGES', 'DEFER', 'ESCALATE_TO_HUMAN')),
    "reasoning" TEXT NOT NULL,
    "objections" TEXT NOT NULL,
    "missing_evidence" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "recommendation" TEXT NOT NULL,
    "model_provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_reviews_company_recommendation_id_fkey" FOREIGN KEY ("company_recommendation_id") REFERENCES "company_recommendations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "founder_attention_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL CHECK ("source_kind" IN ('APPROVAL_REQUEST', 'MEMO', 'COMPANY_RECOMMENDATION')),
    "source" TEXT NOT NULL,
    "score" REAL NOT NULL CHECK ("score" >= 0 AND "score" <= 1),
    "factors" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" DATETIME
);

-- CreateTable
CREATE TABLE "company_budgets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "period" TEXT NOT NULL,
    "ceiling_usd" REAL NOT NULL,
    "consumed_usd" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "resource_allocations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL CHECK ("category" IN ('ENGINEERING', 'MARKETING', 'RESEARCH', 'AGENT_EXECUTION', 'FOUNDER_ATTENTION')),
    "period" TEXT NOT NULL,
    "product_id" TEXT,
    "allocated" REAL NOT NULL,
    "consumed" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_allocations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alert_type" TEXT NOT NULL CHECK ("alert_type" IN ('ANOMALY', 'BUSINESS_HEALTH_DECLINED', 'INCIDENT', 'PROVIDER_FAILURE', 'BUDGET_EXHAUSTED', 'CUSTOMER_LOST', 'RAPID_GROWTH', 'UNEXPECTED_OPPORTUNITY', 'CONTRADICTORY_EVIDENCE', 'STALE_APPROVAL', 'CONCURRENT_CONFLICT', 'EMERGENCY_STOP')),
    "severity" TEXT NOT NULL CHECK ("severity" IN ('INFO', 'WARNING', 'CRITICAL')),
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "score" REAL NOT NULL CHECK ("score" >= 0 AND "score" <= 1),
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" DATETIME,
    "acknowledged_by_identity_id" TEXT
);

-- CreateTable
CREATE TABLE "briefings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_start" DATETIME NOT NULL,
    "period_end" DATETIME NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('ACTION_REQUIRED', 'NO_ACTION_REQUIRED')),
    "decision_queue_snapshot" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "decision_outcomes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decision_type" TEXT NOT NULL CHECK ("decision_type" IN ('INVESTMENT_MEMO', 'CUSTOMER_DISCOVERY_MEMO', 'PRODUCT_REVIEW_MEMO', 'LAUNCH_REVIEW_MEMO', 'BUSINESS_REVIEW_MEMO', 'COMPANY_RECOMMENDATION')),
    "decision_resource_id" TEXT NOT NULL,
    "expected_metric_type" TEXT,
    "expected_value" REAL,
    "actual_value" REAL,
    "evaluated_at" DATETIME,
    "learning_record_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_outcomes_learning_record_id_fkey" FOREIGN KEY ("learning_record_id") REFERENCES "learning_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approval_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approval_request_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "captured_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_snapshots_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "emergency_stops" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_by_identity_id" TEXT NOT NULL,
    "resumed_at" DATETIME,
    "resumed_by_identity_id" TEXT
);

-- CreateTable
CREATE TABLE "founder_cockpit_views" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewed_by_identity_id" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "operating_cycles_idempotency_key_key" ON "operating_cycles"("idempotency_key");

-- CreateIndex
CREATE INDEX "operating_cycles_status_idx" ON "operating_cycles"("status");

-- CreateIndex
CREATE INDEX "operating_cycles_stage_idx" ON "operating_cycles"("stage");

-- CreateIndex
CREATE INDEX "cycle_stage_events_cycle_id_idx" ON "cycle_stage_events"("cycle_id");

-- CreateIndex
CREATE INDEX "company_recommendations_target_opportunity_id_idx" ON "company_recommendations"("target_opportunity_id");

-- CreateIndex
CREATE INDEX "company_recommendations_target_product_id_idx" ON "company_recommendations"("target_product_id");

-- CreateIndex
CREATE INDEX "company_reviews_company_recommendation_id_idx" ON "company_reviews"("company_recommendation_id");

-- CreateIndex
CREATE INDEX "founder_attention_items_resource_type_resource_id_idx" ON "founder_attention_items"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "founder_attention_items_score_idx" ON "founder_attention_items"("score");

-- CreateIndex
CREATE UNIQUE INDEX "company_budgets_period_key" ON "company_budgets"("period");

-- CreateIndex
CREATE INDEX "resource_allocations_category_period_idx" ON "resource_allocations"("category", "period");

-- CreateIndex
CREATE INDEX "resource_allocations_product_id_idx" ON "resource_allocations"("product_id");

-- CreateIndex
CREATE INDEX "alerts_resource_type_resource_id_idx" ON "alerts"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "alerts_alert_type_idx" ON "alerts"("alert_type");

-- CreateIndex
CREATE INDEX "alerts_score_idx" ON "alerts"("score");

-- CreateIndex
CREATE INDEX "briefings_generated_at_idx" ON "briefings"("generated_at");

-- CreateIndex
CREATE INDEX "decision_outcomes_decision_type_decision_resource_id_idx" ON "decision_outcomes"("decision_type", "decision_resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_snapshots_approval_request_id_key" ON "approval_snapshots"("approval_request_id");

-- CreateIndex
CREATE INDEX "emergency_stops_resumed_at_idx" ON "emergency_stops"("resumed_at");

-- CreateIndex
CREATE INDEX "founder_cockpit_views_viewed_at_idx" ON "founder_cockpit_views"("viewed_at");

-- RedefineTables — widen the events.type CHECK constraint (not
-- expressed in prisma/schema.prisma itself, so Prisma's own diff
-- cannot see it; hand-applied here, same as every other CHECK-
-- constraint change in this project's migration history —
-- docs/M9_ARCHITECTURE_PROPOSAL.md §8, §42). Adds the 4 M8 catch-up
-- event types and 12 new M9 event types to the list last widened in
-- the M7 migration; every other column/index on this table is
-- reproduced unchanged.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('AGENT_CREATED', 'AGENT_SUSPENDED', 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_FAILED', 'EVIDENCE_ADDED', 'OPPORTUNITY_DISCOVERED', 'OPPORTUNITY_SCORED', 'OPPORTUNITY_UPDATED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'SIGNAL_CLUSTER_CREATED', 'PROBLEM_EXTRACTED', 'COMPETITOR_ANALYSIS_COMPLETED', 'RESEARCH_CYCLE_STARTED', 'RESEARCH_CYCLE_COMPLETED', 'OPPORTUNITY_DECISION_RECORDED', 'CLAIM_EXTRACTED', 'CLAIM_VALIDATED', 'CEO_RECOMMENDATION_ISSUED', 'INVESTMENT_MEMO_CREATED', 'OPPORTUNITY_KILLED', 'DECISION_CYCLE_STARTED', 'DECISION_CYCLE_COMPLETED', 'PROSPECT_DISCOVERED', 'OUTREACH_EXPERIMENT_APPROVED', 'OUTREACH_MESSAGE_DRAFTED', 'OUTREACH_MESSAGE_CONTACTED', 'CUSTOMER_RESPONSE_RECORDED', 'CUSTOMER_EVIDENCE_CREATED', 'CUSTOMER_DISCOVERY_MEMO_CREATED', 'PRODUCT_APPROVED', 'PRODUCT_SPEC_CREATED', 'MVP_ARCHITECTURE_CREATED', 'ENGINEERING_TASK_COMPLETED', 'SECURITY_REVIEW_COMPLETED', 'PRODUCT_REVIEW_MEMO_CREATED', 'PRODUCT_READY_FOR_DEPLOYMENT', 'PRODUCT_DEPLOYED', 'PRODUCT_ROLLED_BACK', 'BILLING_ACTIVATED', 'LAUNCH_REVIEW_MEMO_CREATED', 'INCIDENT_DETECTED', 'INCIDENT_RESOLVED', 'SUPPORT_CASE_CREATED', 'BUSINESS_REVIEW_MEMO_CREATED', 'GROWTH_EXPERIMENT_COMPLETED', 'ANOMALY_DETECTED', 'PORTFOLIO_ANALYZED', 'CUSTOMER_VALIDATED', 'PRODUCT_CREATED', 'REVENUE_OBSERVED', 'CHAIRMAN_REVIEW_COMPLETED', 'HUMAN_DECISION_MADE', 'ACTION_EXECUTED', 'OUTCOME_OBSERVED', 'LESSON_CREATED', 'OPERATING_CYCLE_STAGE_ADVANCED', 'ATTENTION_QUEUE_UPDATED', 'EMERGENCY_STOP_ACTIVATED', 'EMERGENCY_STOP_RESUMED')),
    "payload" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_events" ("id", "type", "payload", "occurred_at") SELECT "id", "type", "payload", "occurred_at" FROM "events";
DROP TABLE "events";
ALTER TABLE "new_events" RENAME TO "events";
CREATE INDEX "events_type_idx" ON "events"("type");

PRAGMA foreign_keys=ON;
