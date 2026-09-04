-- CreateTable
CREATE TABLE "activation_definitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "defined_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activation_definitions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL CHECK ("dimension" IN ('SIGNUP_DATE', 'ACQUISITION_EXPERIMENT', 'ACQUISITION_CHANNEL', 'PRICING_PLAN', 'PRODUCT_VERSION')),
    "dimension_value" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cohorts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anomalies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL CHECK ("metric_type" IN ('REVENUE_USD', 'ACTIVE_SUBSCRIPTIONS', 'UPTIME_PCT', 'CONVERSION_RATE', 'MONTHLY_OPERATING_COST_USD', 'CHURN_RATE', 'ACTIVATION_RATE', 'RETENTION_D1', 'RETENTION_D7', 'RETENTION_D14', 'RETENTION_D30', 'MRR', 'ARR', 'ARPU', 'GROSS_MARGIN_PCT', 'LOGO_CHURN_RATE', 'REVENUE_CHURN_RATE', 'GROSS_REVENUE_RETENTION', 'NET_REVENUE_RETENTION', 'CAC', 'LTV', 'LTV_TO_CAC', 'PAYBACK_PERIOD_MONTHS')),
    "direction" TEXT NOT NULL CHECK ("direction" IN ('SPIKE', 'DROP')),
    "observed_value" REAL NOT NULL,
    "baseline_mean" REAL NOT NULL,
    "baseline_std_dev" REAL NOT NULL,
    "z_score" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "detected_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "anomalies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "growth_experiments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "intervention_description" TEXT NOT NULL,
    "control_description" TEXT NOT NULL,
    "target_metric_type" TEXT NOT NULL CHECK ("target_metric_type" IN ('REVENUE_USD', 'ACTIVE_SUBSCRIPTIONS', 'UPTIME_PCT', 'CONVERSION_RATE', 'MONTHLY_OPERATING_COST_USD', 'CHURN_RATE', 'ACTIVATION_RATE', 'RETENTION_D1', 'RETENTION_D7', 'RETENTION_D14', 'RETENTION_D30', 'MRR', 'ARR', 'ARPU', 'GROSS_MARGIN_PCT', 'LOGO_CHURN_RATE', 'REVENUE_CHURN_RATE', 'GROSS_REVENUE_RETENTION', 'NET_REVENUE_RETENTION', 'CAC', 'LTV', 'LTV_TO_CAC', 'PAYBACK_PERIOD_MONTHS')),
    "success_criteria" TEXT NOT NULL,
    "failure_criteria" TEXT NOT NULL,
    "estimated_cost_usd" REAL NOT NULL,
    "risk_level" TEXT NOT NULL CHECK ("risk_level" IN ('LOW', 'MEDIUM', 'HIGH')),
    "duration_days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'ANALYZED', 'AWAITING_APPROVAL', 'APPROVED', 'RUNNING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED')),
    "approval_request_id" TEXT,
    "started_at" DATETIME,
    "ended_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "growth_experiments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "growth_experiments_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "growth_experiments_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "growth_experiment_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "growth_experiment_id" TEXT NOT NULL,
    "baseline_value" REAL NOT NULL,
    "experiment_value" REAL NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "observed_change_pct" REAL NOT NULL,
    "confidence" TEXT NOT NULL CHECK ("confidence" IN ('LOW_CONFIDENCE', 'MODERATE', 'HIGH_CONFIDENCE')),
    "limitations" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "growth_experiment_results_growth_experiment_id_fkey" FOREIGN KEY ("growth_experiment_id") REFERENCES "growth_experiments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "business_healths" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "product_health" REAL NOT NULL CHECK ("product_health" >= 0 AND "product_health" <= 1),
    "customer_health" REAL NOT NULL CHECK ("customer_health" >= 0 AND "customer_health" <= 1),
    "revenue_health" REAL NOT NULL CHECK ("revenue_health" >= 0 AND "revenue_health" <= 1),
    "growth_health" REAL NOT NULL CHECK ("growth_health" >= 0 AND "growth_health" <= 1),
    "margin_health" REAL NOT NULL CHECK ("margin_health" >= 0 AND "margin_health" <= 1),
    "operational_health" REAL NOT NULL CHECK ("operational_health" >= 0 AND "operational_health" <= 1),
    "risk" REAL NOT NULL CHECK ("risk" >= 0 AND "risk" <= 1),
    "evidence_confidence" REAL NOT NULL CHECK ("evidence_confidence" >= 0 AND "evidence_confidence" <= 1),
    "composite_score" REAL NOT NULL CHECK ("composite_score" >= 0 AND "composite_score" <= 1),
    "state" TEXT NOT NULL CHECK ("state" IN ('UNKNOWN', 'EARLY', 'PROMISING', 'HEALTHY', 'STAGNATING', 'DECLINING', 'CRITICAL')),
    "reasons" TEXT NOT NULL,
    "computed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_healths_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "portfolio_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "revenue_usd" REAL NOT NULL,
    "growth_rate_pct" REAL NOT NULL,
    "retention_pct" REAL NOT NULL,
    "margin_pct" REAL NOT NULL,
    "evidence_confidence" REAL NOT NULL CHECK ("evidence_confidence" >= 0 AND "evidence_confidence" <= 1),
    "kill_risk_score" REAL NOT NULL CHECK ("kill_risk_score" >= 0 AND "kill_risk_score" <= 1),
    "priority_score" REAL NOT NULL,
    "recommendation" TEXT NOT NULL CHECK ("recommendation" IN ('SCALE', 'MAINTAIN', 'INVESTIGATE', 'PIVOT', 'PAUSE', 'RETIRE')),
    "reasoning" TEXT NOT NULL,
    "cited_metric_ids" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portfolio_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "prediction_outcomes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL CHECK ("metric_type" IN ('REVENUE_USD', 'ACTIVE_SUBSCRIPTIONS', 'UPTIME_PCT', 'CONVERSION_RATE', 'MONTHLY_OPERATING_COST_USD', 'CHURN_RATE', 'ACTIVATION_RATE', 'RETENTION_D1', 'RETENTION_D7', 'RETENTION_D14', 'RETENTION_D30', 'MRR', 'ARR', 'ARPU', 'GROSS_MARGIN_PCT', 'LOGO_CHURN_RATE', 'REVENUE_CHURN_RATE', 'GROSS_REVENUE_RETENTION', 'NET_REVENUE_RETENTION', 'CAC', 'LTV', 'LTV_TO_CAC', 'PAYBACK_PERIOD_MONTHS')),
    "predicted_value" REAL NOT NULL,
    "predicted_at" DATETIME NOT NULL,
    "target_period_start" DATETIME NOT NULL,
    "target_period_end" DATETIME NOT NULL,
    "prediction_source" TEXT NOT NULL,
    "observed_value" REAL,
    "error_pct" REAL,
    "resolved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prediction_outcomes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
-- Created before learning_records, which references it by FK.
CREATE TABLE "business_review_memos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "ceo_recommendation_id" TEXT NOT NULL,
    "chairman_review_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL CHECK ("recommendation" IN ('INVEST', 'IMPROVE_PRODUCT', 'RUN_EXPERIMENT', 'CHANGE_PRICING', 'CHANGE_CHANNEL', 'INVESTIGATE_CHURN', 'REDUCE_COST', 'PAUSE_GROWTH', 'PREPARE_KILL_REVIEW', 'KILL', 'REQUEST_HUMAN_REVIEW')),
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "human_decision" TEXT CHECK ("human_decision" IS NULL OR "human_decision" IN ('APPROVE', 'REQUEST_CHANGES', 'REJECT', 'DEFER')),
    "human_reason" TEXT,
    "decided_at" DATETIME,
    "decided_by_identity_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_review_memos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "business_review_memos_ceo_recommendation_id_fkey" FOREIGN KEY ("ceo_recommendation_id") REFERENCES "ceo_recommendations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "business_review_memos_chairman_review_id_fkey" FOREIGN KEY ("chairman_review_id") REFERENCES "chairman_reviews" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "learning_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prediction_outcome_id" TEXT,
    "business_review_memo_id" TEXT,
    "error_description" TEXT NOT NULL,
    "root_cause" TEXT,
    "lesson" TEXT,
    "suggested_process_change" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_records_prediction_outcome_id_fkey" FOREIGN KEY ("prediction_outcome_id") REFERENCES "prediction_outcomes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "learning_records_business_review_memo_id_fkey" FOREIGN KEY ("business_review_memo_id") REFERENCES "business_review_memos" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_business_metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL CHECK ("metric_type" IN ('REVENUE_USD', 'ACTIVE_SUBSCRIPTIONS', 'UPTIME_PCT', 'CONVERSION_RATE', 'MONTHLY_OPERATING_COST_USD', 'CHURN_RATE', 'ACTIVATION_RATE', 'RETENTION_D1', 'RETENTION_D7', 'RETENTION_D14', 'RETENTION_D30', 'MRR', 'ARR', 'ARPU', 'GROSS_MARGIN_PCT', 'LOGO_CHURN_RATE', 'REVENUE_CHURN_RATE', 'GROSS_REVENUE_RETENTION', 'NET_REVENUE_RETENTION', 'CAC', 'LTV', 'LTV_TO_CAC', 'PAYBACK_PERIOD_MONTHS')),
    "value_kind" TEXT NOT NULL CHECK ("value_kind" IN ('OBSERVED', 'ESTIMATED', 'INFERRED', 'PREDICTED')),
    "value" REAL NOT NULL,
    "source" TEXT NOT NULL CHECK ("source" IN ('DEV_FIXTURE', 'MANUAL_ENTRY', 'COMPUTED_ESTIMATE', 'REVENUE_PROVIDER', 'PRODUCT_USAGE_PROVIDER', 'CUSTOMER_DATA_PROVIDER', 'DETERMINISTIC_CALCULATION')),
    "period_start" DATETIME,
    "period_end" DATETIME,
    "cohort_id" TEXT,
    "input_metric_ids" TEXT,
    "recorded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_metrics_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "business_metrics_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_business_metrics" ("id", "metric_type", "product_id", "recorded_at", "source", "value", "value_kind") SELECT "id", "metric_type", "product_id", "recorded_at", "source", "value", "value_kind" FROM "business_metrics";
DROP TABLE "business_metrics";
ALTER TABLE "new_business_metrics" RENAME TO "business_metrics";
CREATE INDEX "business_metrics_product_id_idx" ON "business_metrics"("product_id");
CREATE INDEX "business_metrics_product_id_metric_type_idx" ON "business_metrics"("product_id", "metric_type");
CREATE INDEX "business_metrics_cohort_id_idx" ON "business_metrics"("cohort_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
-- Widen claims.claim_type's CHECK constraint to add GROWTH_TRAJECTORY (docs/M8_ARCHITECTURE_PROPOSAL.md §21).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_claims" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "claim_type" TEXT NOT NULL CHECK ("claim_type" IN ('CUSTOMER_PROBLEM', 'CUSTOMER_SEGMENT', 'FREQUENCY', 'WILLINGNESS_TO_PAY', 'MARKET_SIZE', 'COMPETITIVE_POSITION', 'DIFFERENTIATION', 'DISTRIBUTION', 'RETENTION', 'BUILDABILITY', 'TIMING', 'ECONOMICS', 'GROWTH_TRAJECTORY')),
    "statement" TEXT NOT NULL,
    "importance" TEXT NOT NULL CHECK ("importance" IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK ("status" IN ('UNVERIFIED', 'SUPPORTED', 'WEAK', 'CONTRADICTED', 'CONFLICTED', 'INSUFFICIENT_EVIDENCE')),
    "confidence" REAL NOT NULL DEFAULT 0 CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "extracted_from" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "claims_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_claims" ("id", "opportunity_id", "claim_type", "statement", "importance", "status", "confidence", "extracted_from", "created_at", "updated_at")
SELECT "id", "opportunity_id", "claim_type", "statement", "importance", "status", "confidence", "extracted_from", "created_at", "updated_at" FROM "claims";
DROP TABLE "claims";
ALTER TABLE "new_claims" RENAME TO "claims";
CREATE INDEX "claims_opportunity_id_idx" ON "claims"("opportunity_id");
CREATE INDEX "claims_status_idx" ON "claims"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
-- Widen customer_evidence.related_claim_type's CHECK constraint to add GROWTH_TRAJECTORY, matching claims.claim_type above.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customer_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "response_id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "signal_type" TEXT NOT NULL CHECK ("signal_type" IN ('PAIN', 'FREQUENCY', 'URGENCY', 'CURRENT_WORKAROUND', 'CURRENT_SPENDING', 'WTP', 'PURCHASE_AUTHORITY', 'INTEREST', 'OBJECTION', 'ALTERNATIVE', 'REQUEST')),
    "related_claim_type" TEXT CHECK ("related_claim_type" IS NULL OR "related_claim_type" IN ('CUSTOMER_PROBLEM', 'CUSTOMER_SEGMENT', 'FREQUENCY', 'WILLINGNESS_TO_PAY', 'MARKET_SIZE', 'COMPETITIVE_POSITION', 'DIFFERENTIATION', 'DISTRIBUTION', 'RETENTION', 'BUILDABILITY', 'TIMING', 'ECONOMICS', 'GROWTH_TRAJECTORY')),
    "strength" TEXT NOT NULL CHECK ("strength" IN ('LOW', 'MEDIUM', 'HIGH')),
    "directness" TEXT NOT NULL CHECK ("directness" IN ('DIRECT', 'INFERRED')),
    "extracted_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_evidence_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "customer_responses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_extracted_by_agent_id_fkey" FOREIGN KEY ("extracted_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_customer_evidence" ("id", "response_id", "evidence_id", "prospect_id", "signal_type", "related_claim_type", "strength", "directness", "extracted_by_agent_id", "created_at")
SELECT "id", "response_id", "evidence_id", "prospect_id", "signal_type", "related_claim_type", "strength", "directness", "extracted_by_agent_id", "created_at" FROM "customer_evidence";
DROP TABLE "customer_evidence";
ALTER TABLE "new_customer_evidence" RENAME TO "customer_evidence";
CREATE INDEX "customer_evidence_response_id_idx" ON "customer_evidence"("response_id");
CREATE INDEX "customer_evidence_evidence_id_idx" ON "customer_evidence"("evidence_id");
CREATE INDEX "customer_evidence_prospect_id_idx" ON "customer_evidence"("prospect_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
-- Widen evidence.source_type's CHECK constraint to add BUSINESS_METRIC (docs/M8_ARCHITECTURE_PROPOSAL.md §21, §39) —
-- businessClaimExtractionService.upsertClaim records real evidence with sourceType "BUSINESS_METRIC".
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claim" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL CHECK ("source_type" IN ('WEB', 'CUSTOMER', 'COMPETITOR', 'MARKET_DATA', 'INTERNAL', 'EXPERIMENT', 'OTHER', 'BUSINESS_METRIC')),
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
INSERT INTO "new_evidence" ("id", "claim", "source", "source_type", "source_reference", "collected_by_agent_id", "collected_at", "signal_id", "reliability", "confidence", "verification_status", "metadata", "created_at", "updated_at")
SELECT "id", "claim", "source", "source_type", "source_reference", "collected_by_agent_id", "collected_at", "signal_id", "reliability", "confidence", "verification_status", "metadata", "created_at", "updated_at" FROM "evidence";
DROP TABLE "evidence";
ALTER TABLE "new_evidence" RENAME TO "evidence";
CREATE INDEX "evidence_collected_by_agent_id_idx" ON "evidence"("collected_by_agent_id");
CREATE INDEX "evidence_source_type_idx" ON "evidence"("source_type");
CREATE INDEX "evidence_signal_id_idx" ON "evidence"("signal_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
-- Widen ceo_recommendations.action's CHECK constraint to add the six genuinely new BUSINESS_ACTIONS strings
-- (docs/M8_ARCHITECTURE_PROPOSAL.md §22) — INVEST, RUN_EXPERIMENT, CHANGE_CHANNEL, INVESTIGATE_CHURN,
-- PAUSE_GROWTH, PREPARE_KILL_REVIEW. The other five (KILL, REQUEST_HUMAN_REVIEW, IMPROVE_PRODUCT, REDUCE_COST,
-- CHANGE_PRICING) already exist from M4/M7's own action vocabularies and are deliberately reused, not duplicated.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ceo_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "decision_cycle_id" TEXT,
    "action" TEXT NOT NULL CHECK ("action" IN ('KILL', 'DEPRIORITIZE', 'INVESTIGATE', 'VALIDATE_CUSTOMER', 'PREPARE_REVIEW', 'HUMAN_REVIEW', 'RUN_CUSTOMER_DISCOVERY', 'REFINE_ICP', 'TEST_CLAIM', 'STOP_EXPERIMENT', 'REQUEST_HUMAN_REVIEW', 'BUILD', 'CONTINUE_BUILD', 'CUT_SCOPE', 'REQUEST_CUSTOMER_RESEARCH', 'STOP', 'LAUNCH', 'DELAY_LAUNCH', 'REDUCE_COST', 'CHANGE_PRICING', 'RUN_ACQUISITION_EXPERIMENT', 'IMPROVE_PRODUCT', 'PAUSE_PRODUCT', 'KILL_PRODUCT', 'INVEST', 'RUN_EXPERIMENT', 'CHANGE_CHANNEL', 'INVESTIGATE_CHURN', 'PAUSE_GROWTH', 'PREPARE_KILL_REVIEW')),
    "reasoning" TEXT NOT NULL,
    "cited_claim_ids" TEXT NOT NULL,
    "cited_validation_report_ids" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "priority_score" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ceo_recommendations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ceo_recommendations_decision_cycle_id_fkey" FOREIGN KEY ("decision_cycle_id") REFERENCES "decision_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ceo_recommendations" ("id", "opportunity_id", "decision_cycle_id", "action", "reasoning", "cited_claim_ids", "cited_validation_report_ids", "confidence", "priority_score", "created_at")
SELECT "id", "opportunity_id", "decision_cycle_id", "action", "reasoning", "cited_claim_ids", "cited_validation_report_ids", "confidence", "priority_score", "created_at" FROM "ceo_recommendations";
DROP TABLE "ceo_recommendations";
ALTER TABLE "new_ceo_recommendations" RENAME TO "ceo_recommendations";
CREATE INDEX "ceo_recommendations_opportunity_id_idx" ON "ceo_recommendations"("opportunity_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "activation_definitions_product_id_idx" ON "activation_definitions"("product_id");

-- CreateIndex
CREATE INDEX "cohorts_product_id_idx" ON "cohorts"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "cohorts_product_id_dimension_dimension_value_key" ON "cohorts"("product_id", "dimension", "dimension_value");

-- CreateIndex
CREATE INDEX "anomalies_product_id_idx" ON "anomalies"("product_id");

-- CreateIndex
CREATE INDEX "anomalies_product_id_metric_type_idx" ON "anomalies"("product_id", "metric_type");

-- CreateIndex
CREATE INDEX "growth_experiments_product_id_idx" ON "growth_experiments"("product_id");

-- CreateIndex
CREATE INDEX "growth_experiments_status_idx" ON "growth_experiments"("status");

-- CreateIndex
CREATE INDEX "growth_experiment_results_growth_experiment_id_idx" ON "growth_experiment_results"("growth_experiment_id");

-- CreateIndex
CREATE INDEX "business_healths_product_id_idx" ON "business_healths"("product_id");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_product_id_idx" ON "portfolio_snapshots"("product_id");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_run_id_idx" ON "portfolio_snapshots"("run_id");

-- CreateIndex
CREATE INDEX "prediction_outcomes_product_id_idx" ON "prediction_outcomes"("product_id");

-- CreateIndex
CREATE INDEX "prediction_outcomes_product_id_metric_type_idx" ON "prediction_outcomes"("product_id", "metric_type");

-- CreateIndex
CREATE INDEX "business_review_memos_product_id_idx" ON "business_review_memos"("product_id");
