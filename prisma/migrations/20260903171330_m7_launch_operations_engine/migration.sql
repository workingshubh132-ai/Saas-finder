-- Hand-augmented with SQLite CHECK constraints on every enum-like
-- column (Prisma's SQLite connector does not emit them from
-- prisma/schema.prisma) — same established discipline as every prior
-- migration in this project (M3-M6). Four existing tables' CHECK
-- constraints are widened via RedefineTables at the end of this file
-- (products.status, agent_permissions.permission, events.type,
-- ceo_recommendations.action) to admit the new M7 values —
-- docs/M7_ARCHITECTURE_PROPOSAL.md §30 names agent_permissions.permission
-- specifically as the exact bug class docs/DECISIONS.md #56 caught
-- once already; all four are fixed in this same migration this time.

-- CreateTable
CREATE TABLE "launch_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "pricing_model_id" TEXT,
    "deployment_plan_id" TEXT,
    "go_to_market_plan_id" TEXT,
    "summary" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "launch_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "launch_plans_pricing_model_id_fkey" FOREIGN KEY ("pricing_model_id") REFERENCES "pricing_models" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "launch_plans_deployment_plan_id_fkey" FOREIGN KEY ("deployment_plan_id") REFERENCES "deployment_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "launch_plans_go_to_market_plan_id_fkey" FOREIGN KEY ("go_to_market_plan_id") REFERENCES "go_to_market_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deployment_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL CHECK ("environment" IN ('DEV', 'STAGING', 'PRODUCTION')),
    "provider" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "estimated_cost_usd" REAL NOT NULL CHECK ("estimated_cost_usd" >= 0),
    "rollback_plan" TEXT NOT NULL,
    "artifact_ref" TEXT NOT NULL,
    "budget_exceeded" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'HUMAN_APPROVED', 'EXECUTED', 'REJECTED')),
    "approval_request_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deployment_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "deployment_plans_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deployment_plan_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL CHECK ("environment" IN ('DEV', 'STAGING', 'PRODUCTION')),
    "status" TEXT NOT NULL CHECK ("status" IN ('LIVE', 'FAILED', 'ROLLED_BACK')),
    "provider_ref" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "rolled_back_from_id" TEXT,
    "deployed_by_identity_id" TEXT NOT NULL,
    "deployed_at" DATETIME NOT NULL,
    CONSTRAINT "deployments_deployment_plan_id_fkey" FOREIGN KEY ("deployment_plan_id") REFERENCES "deployment_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deployments_rolled_back_from_id_fkey" FOREIGN KEY ("rolled_back_from_id") REFERENCES "deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pricing_models" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "tiers" TEXT NOT NULL,
    "unit_economics" TEXT NOT NULL,
    "grounded_in_claim_ids" TEXT NOT NULL,
    "grounded_in_evidence_ids" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pricing_models_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "billing_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "pricing_model_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'HUMAN_APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'REJECTED')),
    "approval_request_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "billing_plans_pricing_model_id_fkey" FOREIGN KEY ("pricing_model_id") REFERENCES "pricing_models" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "billing_plans_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "billing_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billing_plan_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_product_ref" TEXT NOT NULL,
    "provider_price_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'CANCELLED')),
    "webhook_secret" TEXT NOT NULL,
    "activated_by_identity_id" TEXT NOT NULL,
    "activated_at" DATETIME NOT NULL,
    CONSTRAINT "billing_accounts_billing_plan_id_fkey" FOREIGN KEY ("billing_plan_id") REFERENCES "billing_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billing_account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "event_type" TEXT NOT NULL,
    "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_deliveries_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "go_to_market_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "channels" TEXT NOT NULL,
    "landing_page_spec" TEXT NOT NULL,
    "experiments" TEXT NOT NULL,
    "grounded_in_claim_ids" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "go_to_market_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "business_metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL CHECK ("metric_type" IN ('REVENUE_USD', 'ACTIVE_SUBSCRIPTIONS', 'UPTIME_PCT', 'CONVERSION_RATE', 'MONTHLY_OPERATING_COST_USD', 'CHURN_RATE')),
    "value_kind" TEXT NOT NULL CHECK ("value_kind" IN ('OBSERVED', 'ESTIMATED')),
    "value" REAL NOT NULL,
    "source" TEXT NOT NULL CHECK ("source" IN ('DEV_FIXTURE', 'MANUAL_ENTRY', 'COMPUTED_ESTIMATE')),
    "recorded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_metrics_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "deployment_id" TEXT,
    "severity" TEXT NOT NULL CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    "status" TEXT NOT NULL DEFAULT 'DETECTED' CHECK ("status" IN ('DETECTED', 'TRIAGED', 'INVESTIGATING', 'MITIGATING', 'RESOLVED', 'POSTMORTEM')),
    "summary" TEXT NOT NULL,
    "postmortem" TEXT,
    "detected_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    CONSTRAINT "incidents_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "incidents_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "support_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "request_text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'TRIAGED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'ESCALATED')),
    "triage_recommendation" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "support_cases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "launch_review_memos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "launch_plan_id" TEXT NOT NULL,
    "ceo_recommendation_id" TEXT NOT NULL,
    "chairman_review_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "human_decision" TEXT CHECK ("human_decision" IS NULL OR "human_decision" IN ('APPROVE', 'REQUEST_CHANGES', 'REJECT', 'DEFER')),
    "human_reason" TEXT,
    "decided_at" DATETIME,
    "decided_by_identity_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "launch_review_memos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "launch_review_memos_launch_plan_id_fkey" FOREIGN KEY ("launch_plan_id") REFERENCES "launch_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "launch_review_memos_ceo_recommendation_id_fkey" FOREIGN KEY ("ceo_recommendation_id") REFERENCES "ceo_recommendations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "launch_review_memos_chairman_review_id_fkey" FOREIGN KEY ("chairman_review_id") REFERENCES "chairman_reviews" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "launch_plans_product_id_idx" ON "launch_plans"("product_id");

-- CreateIndex
CREATE INDEX "deployment_plans_product_id_idx" ON "deployment_plans"("product_id");

-- CreateIndex
CREATE INDEX "deployment_plans_status_idx" ON "deployment_plans"("status");

-- CreateIndex
CREATE INDEX "deployments_deployment_plan_id_idx" ON "deployments"("deployment_plan_id");

-- CreateIndex
CREATE INDEX "deployments_status_idx" ON "deployments"("status");

-- CreateIndex
CREATE INDEX "pricing_models_product_id_idx" ON "pricing_models"("product_id");

-- CreateIndex
CREATE INDEX "billing_plans_product_id_idx" ON "billing_plans"("product_id");

-- CreateIndex
CREATE INDEX "billing_plans_status_idx" ON "billing_plans"("status");

-- CreateIndex
CREATE INDEX "billing_accounts_billing_plan_id_idx" ON "billing_accounts"("billing_plan_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_billing_account_id_idx" ON "webhook_deliveries"("billing_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_provider_delivery_id_key" ON "webhook_deliveries"("provider", "delivery_id");

-- CreateIndex
CREATE INDEX "go_to_market_plans_product_id_idx" ON "go_to_market_plans"("product_id");

-- CreateIndex
CREATE INDEX "business_metrics_product_id_idx" ON "business_metrics"("product_id");

-- CreateIndex
CREATE INDEX "business_metrics_product_id_metric_type_idx" ON "business_metrics"("product_id", "metric_type");

-- CreateIndex
CREATE INDEX "incidents_product_id_idx" ON "incidents"("product_id");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "support_cases_product_id_idx" ON "support_cases"("product_id");

-- CreateIndex
CREATE INDEX "support_cases_status_idx" ON "support_cases"("status");

-- CreateIndex
CREATE INDEX "launch_review_memos_product_id_idx" ON "launch_review_memos"("product_id");

-- RedefineTables — widen four existing CHECK constraints (not
-- expressed in prisma/schema.prisma itself, so Prisma's own diff
-- cannot see them; hand-applied here, same as every other CHECK-
-- constraint change in this project's migration history). Reproduces
-- every other column/constraint/index on all four tables unchanged
-- (confirmed against each table's current definition immediately
-- before writing this migration).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED' CHECK ("status" IN ('PROPOSED', 'APPROVED', 'SPECIFYING', 'ARCHITECTING', 'BUILDING', 'REVIEWING', 'TESTING', 'SECURITY_REVIEW', 'HUMAN_REVIEW', 'READY_FOR_DEPLOYMENT', 'LAUNCH_PLANNING', 'AWAITING_LAUNCH_APPROVAL', 'DEPLOYING', 'LIVE', 'PAUSED', 'REJECTED', 'FAILED', 'ARCHIVED')),
    "workspace_path" TEXT,
    "estimated_development_cost_usd" REAL,
    "estimated_operating_cost_usd" REAL,
    "deployment_plan" TEXT,
    "rollback_plan" TEXT,
    "created_by_identity_id" TEXT NOT NULL,
    "approved_by_identity_id" TEXT,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "products_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "products_created_by_identity_id_fkey" FOREIGN KEY ("created_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_products" ("id", "opportunity_id", "status", "workspace_path", "estimated_development_cost_usd", "estimated_operating_cost_usd", "deployment_plan", "rollback_plan", "created_by_identity_id", "approved_by_identity_id", "approved_at", "created_at", "updated_at")
SELECT "id", "opportunity_id", "status", "workspace_path", "estimated_development_cost_usd", "estimated_operating_cost_usd", "deployment_plan", "rollback_plan", "created_by_identity_id", "approved_by_identity_id", "approved_at", "created_at", "updated_at" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
CREATE UNIQUE INDEX "products_opportunity_id_key" ON "products"("opportunity_id");
CREATE INDEX "products_status_idx" ON "products"("status");

CREATE TABLE "new_agent_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL CHECK ("permission" IN ('READ_WEB', 'WRITE_FILES', 'EXECUTE_CODE', 'READ_DATABASE', 'WRITE_DATABASE', 'SEND_EXTERNAL_MESSAGE', 'CREATE_EXTERNAL_ACCOUNT', 'DEPLOY_APPLICATION', 'SPEND_MONEY', 'ACCESS_SECRET', 'MODIFY_CONFIGURATION', 'WRITE_WORKSPACE_FILES', 'RUN_WORKSPACE_COMMAND', 'DEPLOY_PRODUCTION', 'CREATE_BILLING', 'ACTIVATE_BILLING', 'MODIFY_PRODUCTION', 'ACCESS_PRODUCTION_DATA')),
    "granted_by" TEXT NOT NULL,
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by" TEXT,
    "revoked_at" DATETIME,
    "reason" TEXT,
    CONSTRAINT "agent_permissions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_agent_permissions" ("id", "agent_id", "permission", "granted_by", "granted_at", "revoked_by", "revoked_at", "reason") SELECT "id", "agent_id", "permission", "granted_by", "granted_at", "revoked_by", "revoked_at", "reason" FROM "agent_permissions";
DROP TABLE "agent_permissions";
ALTER TABLE "new_agent_permissions" RENAME TO "agent_permissions";
CREATE INDEX "agent_permissions_agent_id_permission_idx" ON "agent_permissions"("agent_id", "permission");

CREATE TABLE "new_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('AGENT_CREATED', 'AGENT_SUSPENDED', 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_FAILED', 'EVIDENCE_ADDED', 'OPPORTUNITY_DISCOVERED', 'OPPORTUNITY_SCORED', 'OPPORTUNITY_UPDATED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'SIGNAL_CLUSTER_CREATED', 'PROBLEM_EXTRACTED', 'COMPETITOR_ANALYSIS_COMPLETED', 'RESEARCH_CYCLE_STARTED', 'RESEARCH_CYCLE_COMPLETED', 'OPPORTUNITY_DECISION_RECORDED', 'CLAIM_EXTRACTED', 'CLAIM_VALIDATED', 'CEO_RECOMMENDATION_ISSUED', 'INVESTMENT_MEMO_CREATED', 'OPPORTUNITY_KILLED', 'DECISION_CYCLE_STARTED', 'DECISION_CYCLE_COMPLETED', 'PROSPECT_DISCOVERED', 'OUTREACH_EXPERIMENT_APPROVED', 'OUTREACH_MESSAGE_DRAFTED', 'OUTREACH_MESSAGE_CONTACTED', 'CUSTOMER_RESPONSE_RECORDED', 'CUSTOMER_EVIDENCE_CREATED', 'CUSTOMER_DISCOVERY_MEMO_CREATED', 'PRODUCT_APPROVED', 'PRODUCT_SPEC_CREATED', 'MVP_ARCHITECTURE_CREATED', 'ENGINEERING_TASK_COMPLETED', 'SECURITY_REVIEW_COMPLETED', 'PRODUCT_REVIEW_MEMO_CREATED', 'PRODUCT_READY_FOR_DEPLOYMENT', 'PRODUCT_DEPLOYED', 'PRODUCT_ROLLED_BACK', 'BILLING_ACTIVATED', 'LAUNCH_REVIEW_MEMO_CREATED', 'INCIDENT_DETECTED', 'INCIDENT_RESOLVED', 'SUPPORT_CASE_CREATED')),
    "payload" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_events" ("id", "type", "payload", "occurred_at") SELECT "id", "type", "payload", "occurred_at" FROM "events";
DROP TABLE "events";
ALTER TABLE "new_events" RENAME TO "events";
CREATE INDEX "events_type_idx" ON "events"("type");

CREATE TABLE "new_ceo_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "decision_cycle_id" TEXT,
    "action" TEXT NOT NULL CHECK ("action" IN ('KILL', 'DEPRIORITIZE', 'INVESTIGATE', 'VALIDATE_CUSTOMER', 'PREPARE_REVIEW', 'HUMAN_REVIEW', 'RUN_CUSTOMER_DISCOVERY', 'REFINE_ICP', 'TEST_CLAIM', 'STOP_EXPERIMENT', 'REQUEST_HUMAN_REVIEW', 'BUILD', 'CONTINUE_BUILD', 'CUT_SCOPE', 'REQUEST_CUSTOMER_RESEARCH', 'STOP', 'LAUNCH', 'DELAY_LAUNCH', 'REDUCE_COST', 'CHANGE_PRICING', 'RUN_ACQUISITION_EXPERIMENT', 'IMPROVE_PRODUCT', 'PAUSE_PRODUCT', 'KILL_PRODUCT')),
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
