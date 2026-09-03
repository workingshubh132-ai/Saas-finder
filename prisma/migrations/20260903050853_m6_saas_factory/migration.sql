-- Hand-augmented with SQLite CHECK constraints on every enum-like
-- column, matching this project's established migration discipline
-- (M3-M5): Prisma's SQLite connector does not express CHECK constraints
-- from the schema itself, so every enum-like field is fail-closed at
-- the database layer too, never trusted from the write path alone.
--
-- Two existing tables' CHECK constraints are widened via RedefineTables
-- below: `chairman_reviews.decision` (+REQUEST_CHANGES, §33) and
-- `ceo_recommendations.action` (+BUILD/CONTINUE_BUILD/CUT_SCOPE/
-- REQUEST_CUSTOMER_RESEARCH/STOP — REQUEST_HUMAN_REVIEW already exists
-- from M5, §32), plus `events.type` (+7 new M6 event types, §2).
-- Reproduces every other column/constraint/index on all three tables
-- unchanged (confirmed against the live dev database's sqlite_master
-- immediately before writing this migration).

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED' CHECK ("status" IN ('PROPOSED', 'APPROVED', 'SPECIFYING', 'ARCHITECTING', 'BUILDING', 'REVIEWING', 'TESTING', 'SECURITY_REVIEW', 'HUMAN_REVIEW', 'READY_FOR_DEPLOYMENT', 'REJECTED', 'FAILED', 'ARCHIVED')),
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

-- CreateTable
CREATE TABLE "product_specs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_customer" TEXT NOT NULL,
    "core_problem" TEXT NOT NULL,
    "core_workflow" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "non_goals" TEXT NOT NULL,
    "grounded_in_claim_ids" TEXT NOT NULL,
    "grounded_in_evidence_ids" TEXT NOT NULL,
    "generated_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_specs_generated_by_agent_id_fkey" FOREIGN KEY ("generated_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_spec_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "problem_addressed" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "evidence_ids" TEXT NOT NULL,
    "expected_learning" TEXT NOT NULL,
    "customer_value" REAL NOT NULL CHECK ("customer_value" >= 0 AND "customer_value" <= 1),
    "learning_value" REAL NOT NULL CHECK ("learning_value" >= 0 AND "learning_value" <= 1),
    "implementation_cost" REAL NOT NULL CHECK ("implementation_cost" >= 0 AND "implementation_cost" <= 1),
    "technical_risk" REAL NOT NULL CHECK ("technical_risk" >= 0 AND "technical_risk" <= 1),
    "score" REAL NOT NULL,
    "priority" TEXT NOT NULL CHECK ("priority" IN ('BUILD_NOW', 'BUILD_LATER', 'EXPERIMENT_ONLY', 'DEFER', 'REJECT')),
    "reasoning" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "features_product_spec_id_fkey" FOREIGN KEY ("product_spec_id") REFERENCES "product_specs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "features_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mvp_architectures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "product_spec_id" TEXT NOT NULL,
    "design_json" TEXT NOT NULL,
    "generated_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mvp_architectures_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mvp_architectures_product_spec_id_fkey" FOREIGN KEY ("product_spec_id") REFERENCES "product_specs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "mvp_architectures_generated_by_agent_id_fkey" FOREIGN KEY ("generated_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "engineering_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mvp_architecture_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "depends_on_task_ids" TEXT NOT NULL,
    "allowed_files" TEXT NOT NULL,
    "acceptance_criteria" TEXT NOT NULL,
    "tests_required" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL DEFAULT 'GREEN' CHECK ("risk_level" IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED')),
    "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0),
    "files_changed" TEXT,
    "implementation_summary" TEXT,
    "known_limitations" TEXT,
    "dependency_records" TEXT NOT NULL DEFAULT '[]',
    "integration_test_passed" BOOLEAN,
    "integration_test_output" TEXT,
    "assigned_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "engineering_tasks_mvp_architecture_id_fkey" FOREIGN KEY ("mvp_architecture_id") REFERENCES "mvp_architectures" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "engineering_tasks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "engineering_tasks_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "code_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engineering_task_id" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "has_blocking_finding" BOOLEAN NOT NULL,
    "reasoning" TEXT NOT NULL,
    "reviewed_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "code_reviews_engineering_task_id_fkey" FOREIGN KEY ("engineering_task_id") REFERENCES "engineering_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "code_reviews_reviewed_by_agent_id_fkey" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "qa_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engineering_task_id" TEXT NOT NULL,
    "verdict" TEXT NOT NULL CHECK ("verdict" IN ('PASS', 'PASS_WITH_GAPS', 'FAIL')),
    "missing_tests" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "reviewed_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qa_reports_engineering_task_id_fkey" FOREIGN KEY ("engineering_task_id") REFERENCES "engineering_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "qa_reports_reviewed_by_agent_id_fkey" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "security_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engineering_task_id" TEXT NOT NULL,
    "verdict" TEXT NOT NULL CHECK ("verdict" IN ('PASS', 'PASS_WITH_WARNINGS', 'FAIL')),
    "findings" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "reviewed_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "security_reviews_engineering_task_id_fkey" FOREIGN KEY ("engineering_task_id") REFERENCES "engineering_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "security_reviews_reviewed_by_agent_id_fkey" FOREIGN KEY ("reviewed_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_review_memos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
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
    CONSTRAINT "product_review_memos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_review_memos_ceo_recommendation_id_fkey" FOREIGN KEY ("ceo_recommendation_id") REFERENCES "ceo_recommendations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_review_memos_chairman_review_id_fkey" FOREIGN KEY ("chairman_review_id") REFERENCES "chairman_reviews" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "products_opportunity_id_key" ON "products"("opportunity_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "product_specs_product_id_idx" ON "product_specs"("product_id");

-- CreateIndex
CREATE INDEX "features_product_spec_id_idx" ON "features"("product_spec_id");

-- CreateIndex
CREATE INDEX "features_claim_id_idx" ON "features"("claim_id");

-- CreateIndex
CREATE INDEX "mvp_architectures_product_id_idx" ON "mvp_architectures"("product_id");

-- CreateIndex
CREATE INDEX "mvp_architectures_product_spec_id_idx" ON "mvp_architectures"("product_spec_id");

-- CreateIndex
CREATE INDEX "engineering_tasks_mvp_architecture_id_idx" ON "engineering_tasks"("mvp_architecture_id");

-- CreateIndex
CREATE INDEX "engineering_tasks_product_id_idx" ON "engineering_tasks"("product_id");

-- CreateIndex
CREATE INDEX "engineering_tasks_status_idx" ON "engineering_tasks"("status");

-- CreateIndex
CREATE INDEX "code_reviews_engineering_task_id_idx" ON "code_reviews"("engineering_task_id");

-- CreateIndex
CREATE INDEX "qa_reports_engineering_task_id_idx" ON "qa_reports"("engineering_task_id");

-- CreateIndex
CREATE INDEX "security_reviews_engineering_task_id_idx" ON "security_reviews"("engineering_task_id");

-- CreateIndex
CREATE INDEX "product_review_memos_product_id_idx" ON "product_review_memos"("product_id");

-- RedefineTables — widen three existing CHECK constraints (not
-- expressed in prisma/schema.prisma itself, so Prisma's own diff
-- cannot see them; hand-applied here, same as every other CHECK-
-- constraint change in this project's migration history). Reproduces
-- every other column/constraint/index on all three tables unchanged.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chairman_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL CHECK ("decision" IN ('APPROVE', 'REJECT', 'REQUEST_MORE_EVIDENCE', 'REQUEST_CHANGES', 'DEFER', 'ESCALATE_TO_HUMAN')),
    "reasoning" TEXT NOT NULL,
    "objections" TEXT NOT NULL,
    "missing_evidence" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "recommendation" TEXT NOT NULL,
    "model_provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chairman_reviews_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chairman_reviews" ("id", "opportunity_id", "decision", "reasoning", "objections", "missing_evidence", "confidence", "recommendation", "model_provider", "model_name", "created_at") SELECT "id", "opportunity_id", "decision", "reasoning", "objections", "missing_evidence", "confidence", "recommendation", "model_provider", "model_name", "created_at" FROM "chairman_reviews";
DROP TABLE "chairman_reviews";
ALTER TABLE "new_chairman_reviews" RENAME TO "chairman_reviews";
CREATE INDEX "chairman_reviews_opportunity_id_idx" ON "chairman_reviews"("opportunity_id");
CREATE TABLE "new_ceo_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "decision_cycle_id" TEXT,
    "action" TEXT NOT NULL CHECK ("action" IN ('KILL', 'DEPRIORITIZE', 'INVESTIGATE', 'VALIDATE_CUSTOMER', 'PREPARE_REVIEW', 'HUMAN_REVIEW', 'RUN_CUSTOMER_DISCOVERY', 'REFINE_ICP', 'TEST_CLAIM', 'STOP_EXPERIMENT', 'REQUEST_HUMAN_REVIEW', 'BUILD', 'CONTINUE_BUILD', 'CUT_SCOPE', 'REQUEST_CUSTOMER_RESEARCH', 'STOP')),
    "reasoning" TEXT NOT NULL,
    "cited_claim_ids" TEXT NOT NULL,
    "cited_validation_report_ids" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "priority_score" REAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ceo_recommendations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ceo_recommendations_decision_cycle_id_fkey" FOREIGN KEY ("decision_cycle_id") REFERENCES "decision_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ceo_recommendations" ("id", "opportunity_id", "decision_cycle_id", "action", "reasoning", "cited_claim_ids", "cited_validation_report_ids", "confidence", "priority_score", "created_at") SELECT "id", "opportunity_id", "decision_cycle_id", "action", "reasoning", "cited_claim_ids", "cited_validation_report_ids", "confidence", "priority_score", "created_at" FROM "ceo_recommendations";
DROP TABLE "ceo_recommendations";
ALTER TABLE "new_ceo_recommendations" RENAME TO "ceo_recommendations";
CREATE INDEX "ceo_recommendations_opportunity_id_idx" ON "ceo_recommendations"("opportunity_id");
CREATE TABLE "new_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('AGENT_CREATED', 'AGENT_SUSPENDED', 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_FAILED', 'EVIDENCE_ADDED', 'OPPORTUNITY_DISCOVERED', 'OPPORTUNITY_SCORED', 'OPPORTUNITY_UPDATED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'SIGNAL_CLUSTER_CREATED', 'PROBLEM_EXTRACTED', 'COMPETITOR_ANALYSIS_COMPLETED', 'RESEARCH_CYCLE_STARTED', 'RESEARCH_CYCLE_COMPLETED', 'OPPORTUNITY_DECISION_RECORDED', 'CLAIM_EXTRACTED', 'CLAIM_VALIDATED', 'CEO_RECOMMENDATION_ISSUED', 'INVESTMENT_MEMO_CREATED', 'OPPORTUNITY_KILLED', 'DECISION_CYCLE_STARTED', 'DECISION_CYCLE_COMPLETED', 'PROSPECT_DISCOVERED', 'OUTREACH_EXPERIMENT_APPROVED', 'OUTREACH_MESSAGE_DRAFTED', 'OUTREACH_MESSAGE_CONTACTED', 'CUSTOMER_RESPONSE_RECORDED', 'CUSTOMER_EVIDENCE_CREATED', 'CUSTOMER_DISCOVERY_MEMO_CREATED', 'PRODUCT_APPROVED', 'PRODUCT_SPEC_CREATED', 'MVP_ARCHITECTURE_CREATED', 'ENGINEERING_TASK_COMPLETED', 'SECURITY_REVIEW_COMPLETED', 'PRODUCT_REVIEW_MEMO_CREATED', 'PRODUCT_READY_FOR_DEPLOYMENT')),
    "payload" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_events" ("id", "type", "payload", "occurred_at") SELECT "id", "type", "payload", "occurred_at" FROM "events";
DROP TABLE "events";
ALTER TABLE "new_events" RENAME TO "events";
CREATE INDEX "events_type_idx" ON "events"("type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
