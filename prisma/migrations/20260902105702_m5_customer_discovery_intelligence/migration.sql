-- M5 — Customer Discovery Intelligence (docs/M5_ARCHITECTURE_PROPOSAL.md §22).
-- Hand-augmented with SQLite CHECK constraints on every enum-like and
-- bounded column, the same discipline every M1-M4 migration in this
-- project established (see prisma/schema.prisma's own top-of-file
-- note: SQLite has no native enum support, so the canonical value
-- sets defined in TypeScript — src/domain/** — are mirrored here as
-- CHECK constraints, never trusted from the write path alone).
--
-- Two existing tables are rebuilt here specifically to widen their
-- CHECK constraints: `ceo_recommendations.action` (five new
-- CUSTOMER_DISCOVERY_ACTIONS values, domain/decision/customer-discovery-action.types.ts)
-- and `events.type` (seven new M5 domain event types,
-- domain/events/event.types.ts) — the exact lesson recorded in
-- docs/DECISIONS.md from M3's own "events" CHECK-constraint gap and
-- already repeated correctly once for M4: every DOMAIN_EVENT_TYPES
-- addition ships in the same migration that adds the code producing
-- it, never left for a later migration to catch up. Both tables'
-- pre-existing columns/constraints/indexes are reproduced byte-for-byte
-- below, confirmed against the live dev database's sqlite_master
-- before writing this file.
--
-- `expected_information_gain` (outreach_messages) is deliberately left
-- unbounded — domain/claim/eig.ts's own computeExpectedInformationGain
-- is documented "deliberately unbounded / can go negative," matching
-- ceo_recommendations.priority_score's own unbounded REAL column.

-- CreateTable
CREATE TABLE "icp_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "company_size_min" INTEGER CHECK ("company_size_min" IS NULL OR "company_size_min" >= 0),
    "company_size_max" INTEGER CHECK ("company_size_max" IS NULL OR "company_size_max" >= 0),
    "role" TEXT NOT NULL,
    "problem_exposure" TEXT NOT NULL,
    "likely_frequency" TEXT NOT NULL,
    "geography" TEXT NOT NULL,
    "technology" TEXT NOT NULL,
    "exclusions" TEXT NOT NULL,
    "field_grounding" TEXT NOT NULL,
    "generated_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "icp_profiles_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "icp_profiles_generated_by_agent_id_fkey" FOREIGN KEY ("generated_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "prospects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "icp_profile_id" TEXT,
    "organization" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "public_contact_channel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "discovered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualification_status" TEXT CHECK ("qualification_status" IS NULL OR "qualification_status" IN ('QUALIFIED', 'REJECTED', 'UNQUALIFIED')),
    "icp_fit" TEXT CHECK ("icp_fit" IS NULL OR "icp_fit" IN ('HIGH', 'MEDIUM', 'LOW')),
    "reason_for_match" TEXT,
    "unknowns" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK ("status" IN ('DISCOVERED', 'QUALIFIED', 'REJECTED', 'APPROVED_FOR_DRAFT', 'DRAFT_READY', 'AWAITING_HUMAN_APPROVAL', 'APPROVED_TO_CONTACT', 'CONTACTED', 'RESPONDED', 'NO_RESPONSE', 'DO_NOT_CONTACT', 'COMPLETED')),
    "discovered_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "prospects_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "prospects_icp_profile_id_fkey" FOREIGN KEY ("icp_profile_id") REFERENCES "icp_profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "prospects_discovered_by_agent_id_fkey" FOREIGN KEY ("discovered_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outreach_experiments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "target_icp_profile_id" TEXT NOT NULL,
    "research_question" TEXT NOT NULL,
    "message_strategy" TEXT NOT NULL,
    "prospect_limit" INTEGER NOT NULL CHECK ("prospect_limit" > 0),
    "time_window_start" DATETIME,
    "time_window_end" DATETIME,
    "success_criteria" TEXT NOT NULL,
    "failure_criteria" TEXT NOT NULL,
    "contact_policy" TEXT NOT NULL DEFAULT 'HUMAN_APPROVAL_REQUIRED' CHECK ("contact_policy" IN ('NO_CONTACT', 'RESEARCH_ONLY', 'HUMAN_APPROVAL_REQUIRED', 'APPROVED', 'DO_NOT_CONTACT')),
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK ("status" IN ('PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'STOPPED', 'CANCELLED')),
    "created_by_identity_id" TEXT NOT NULL,
    "approved_by_identity_id" TEXT,
    "approved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "outreach_experiments_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "outreach_experiments_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outreach_experiments_target_icp_profile_id_fkey" FOREIGN KEY ("target_icp_profile_id") REFERENCES "icp_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outreach_experiments_created_by_identity_id_fkey" FOREIGN KEY ("created_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "outreach_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experiment_id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "claim_being_tested_id" TEXT NOT NULL,
    "expected_information_gain" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'AWAITING_HUMAN_APPROVAL', 'APPROVED_TO_CONTACT', 'REJECTED', 'CONTACTED', 'CANCELLED')),
    "approval_request_id" TEXT,
    "contacted_at" DATETIME,
    "contacted_by_identity_id" TEXT,
    "drafted_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "outreach_messages_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "outreach_experiments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "outreach_messages_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outreach_messages_claim_being_tested_id_fkey" FOREIGN KEY ("claim_being_tested_id") REFERENCES "claims" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outreach_messages_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "outreach_messages_drafted_by_agent_id_fkey" FOREIGN KEY ("drafted_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "customer_responses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outreach_message_id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "raw_content" TEXT NOT NULL,
    "classification" TEXT CHECK ("classification" IS NULL OR "classification" IN ('POSITIVE_SIGNAL', 'NEGATIVE_SIGNAL', 'NEUTRAL', 'QUESTION', 'OBJECTION', 'REQUEST_FOR_DETAILS', 'INTEREST', 'NOT_INTERESTED', 'NOISE', 'UNCLEAR')),
    "status" TEXT NOT NULL DEFAULT 'RECEIVED' CHECK ("status" IN ('RECEIVED', 'ANALYZED')),
    "entered_by_identity_id" TEXT NOT NULL,
    "recorded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analyzed_at" DATETIME,
    CONSTRAINT "customer_responses_outreach_message_id_fkey" FOREIGN KEY ("outreach_message_id") REFERENCES "outreach_messages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_responses_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_responses_entered_by_identity_id_fkey" FOREIGN KEY ("entered_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "customer_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "response_id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "signal_type" TEXT NOT NULL CHECK ("signal_type" IN ('PAIN', 'FREQUENCY', 'URGENCY', 'CURRENT_WORKAROUND', 'CURRENT_SPENDING', 'WTP', 'PURCHASE_AUTHORITY', 'INTEREST', 'OBJECTION', 'ALTERNATIVE', 'REQUEST')),
    "related_claim_type" TEXT CHECK ("related_claim_type" IS NULL OR "related_claim_type" IN ('CUSTOMER_PROBLEM', 'CUSTOMER_SEGMENT', 'FREQUENCY', 'WILLINGNESS_TO_PAY', 'MARKET_SIZE', 'COMPETITIVE_POSITION', 'DIFFERENTIATION', 'DISTRIBUTION', 'RETENTION', 'BUILDABILITY', 'TIMING', 'ECONOMICS')),
    "strength" TEXT NOT NULL CHECK ("strength" IN ('LOW', 'MEDIUM', 'HIGH')),
    "directness" TEXT NOT NULL CHECK ("directness" IN ('DIRECT', 'INFERRED')),
    "extracted_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_evidence_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "customer_responses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_extracted_by_agent_id_fkey" FOREIGN KEY ("extracted_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "customer_discovery_memos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "ceo_recommendation_id" TEXT NOT NULL,
    "chairman_review_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "claims_strengthened" TEXT NOT NULL,
    "claims_weakened" TEXT NOT NULL,
    "independent_organization_count" INTEGER NOT NULL CHECK ("independent_organization_count" >= 0),
    "response_count" INTEGER NOT NULL CHECK ("response_count" >= 0),
    "recommendation" TEXT NOT NULL,
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "human_decision" TEXT CHECK ("human_decision" IS NULL OR "human_decision" IN ('APPROVE', 'REJECT', 'MORE_RESEARCH', 'REFINE_ICP', 'STOP')),
    "human_reason" TEXT,
    "decided_at" DATETIME,
    "decided_by_identity_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_discovery_memos_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customer_discovery_memos_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "outreach_experiments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_discovery_memos_ceo_recommendation_id_fkey" FOREIGN KEY ("ceo_recommendation_id") REFERENCES "ceo_recommendations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_discovery_memos_chairman_review_id_fkey" FOREIGN KEY ("chairman_review_id") REFERENCES "chairman_reviews" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "icp_profiles_opportunity_id_idx" ON "icp_profiles"("opportunity_id");

-- CreateIndex
CREATE INDEX "prospects_opportunity_id_idx" ON "prospects"("opportunity_id");

-- CreateIndex
CREATE INDEX "prospects_icp_profile_id_idx" ON "prospects"("icp_profile_id");

-- CreateIndex
CREATE INDEX "prospects_status_idx" ON "prospects"("status");

-- CreateIndex
CREATE INDEX "outreach_experiments_opportunity_id_idx" ON "outreach_experiments"("opportunity_id");

-- CreateIndex
CREATE INDEX "outreach_experiments_status_idx" ON "outreach_experiments"("status");

-- CreateIndex
CREATE INDEX "outreach_messages_experiment_id_idx" ON "outreach_messages"("experiment_id");

-- CreateIndex
CREATE INDEX "outreach_messages_prospect_id_idx" ON "outreach_messages"("prospect_id");

-- CreateIndex
CREATE INDEX "outreach_messages_status_idx" ON "outreach_messages"("status");

-- CreateIndex
CREATE INDEX "customer_responses_outreach_message_id_idx" ON "customer_responses"("outreach_message_id");

-- CreateIndex
CREATE INDEX "customer_responses_prospect_id_idx" ON "customer_responses"("prospect_id");

-- CreateIndex
CREATE INDEX "customer_responses_status_idx" ON "customer_responses"("status");

-- CreateIndex
CREATE INDEX "customer_evidence_response_id_idx" ON "customer_evidence"("response_id");

-- CreateIndex
CREATE INDEX "customer_evidence_evidence_id_idx" ON "customer_evidence"("evidence_id");

-- CreateIndex
CREATE INDEX "customer_evidence_prospect_id_idx" ON "customer_evidence"("prospect_id");

-- CreateIndex
CREATE INDEX "customer_discovery_memos_opportunity_id_idx" ON "customer_discovery_memos"("opportunity_id");

-- CreateIndex
CREATE INDEX "customer_discovery_memos_experiment_id_idx" ON "customer_discovery_memos"("experiment_id");

-- RedefineTables — widen two existing CHECK constraints (not expressed
-- in prisma/schema.prisma itself, so Prisma's own diff cannot see
-- them; hand-applied here, same as every other CHECK-constraint change
-- in this project's migration history). Reproduces every other column/
-- constraint/index on both tables unchanged (confirmed against the
-- live dev database's sqlite_master immediately before writing this
-- migration).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ceo_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "decision_cycle_id" TEXT,
    "action" TEXT NOT NULL CHECK ("action" IN ('KILL', 'DEPRIORITIZE', 'INVESTIGATE', 'VALIDATE_CUSTOMER', 'PREPARE_REVIEW', 'HUMAN_REVIEW', 'RUN_CUSTOMER_DISCOVERY', 'REFINE_ICP', 'TEST_CLAIM', 'STOP_EXPERIMENT', 'REQUEST_HUMAN_REVIEW')),
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
    "type" TEXT NOT NULL CHECK ("type" IN ('AGENT_CREATED', 'AGENT_SUSPENDED', 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_FAILED', 'EVIDENCE_ADDED', 'OPPORTUNITY_DISCOVERED', 'OPPORTUNITY_SCORED', 'OPPORTUNITY_UPDATED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'SIGNAL_CLUSTER_CREATED', 'PROBLEM_EXTRACTED', 'COMPETITOR_ANALYSIS_COMPLETED', 'RESEARCH_CYCLE_STARTED', 'RESEARCH_CYCLE_COMPLETED', 'OPPORTUNITY_DECISION_RECORDED', 'CLAIM_EXTRACTED', 'CLAIM_VALIDATED', 'CEO_RECOMMENDATION_ISSUED', 'INVESTMENT_MEMO_CREATED', 'OPPORTUNITY_KILLED', 'DECISION_CYCLE_STARTED', 'DECISION_CYCLE_COMPLETED', 'PROSPECT_DISCOVERED', 'OUTREACH_EXPERIMENT_APPROVED', 'OUTREACH_MESSAGE_DRAFTED', 'OUTREACH_MESSAGE_CONTACTED', 'CUSTOMER_RESPONSE_RECORDED', 'CUSTOMER_EVIDENCE_CREATED', 'CUSTOMER_DISCOVERY_MEMO_CREATED')),
    "payload" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_events" ("id", "type", "payload", "occurred_at") SELECT "id", "type", "payload", "occurred_at" FROM "events";
DROP TABLE "events";
ALTER TABLE "new_events" RENAME TO "events";
CREATE INDEX "events_type_idx" ON "events"("type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
