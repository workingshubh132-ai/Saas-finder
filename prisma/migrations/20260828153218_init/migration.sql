-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "department" TEXT NOT NULL CHECK ("department" IN ('INTELLIGENCE', 'VALIDATION', 'SALES', 'PRODUCT', 'ENGINEERING', 'GROWTH', 'OPERATIONS', 'EXECUTIVE', 'GUARDIAN')),
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'PAUSED', 'SUSPENDED', 'RETIRED')),
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "model_provider" TEXT,
    "model_name" TEXT,
    "parent_agent_id" TEXT,
    "risk_level" TEXT NOT NULL CHECK ("risk_level" IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "agents_parent_agent_id_fkey" FOREIGN KEY ("parent_agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL CHECK ("permission" IN ('READ_WEB', 'WRITE_FILES', 'EXECUTE_CODE', 'READ_DATABASE', 'WRITE_DATABASE', 'SEND_EXTERNAL_MESSAGE', 'CREATE_EXTERNAL_ACCOUNT', 'DEPLOY_APPLICATION', 'SPEND_MONEY', 'ACCESS_SECRET', 'MODIFY_CONFIGURATION')),
    "granted_by" TEXT NOT NULL,
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by" TEXT,
    "revoked_at" DATETIME,
    "reason" TEXT,
    CONSTRAINT "agent_permissions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "assigned_agent_id" TEXT,
    "parent_task_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    "priority" TEXT NOT NULL DEFAULT 'NORMAL' CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    "risk_level" TEXT NOT NULL CHECK ("risk_level" IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
    "input" TEXT,
    "output" TEXT,
    "error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    CONSTRAINT "tasks_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requested_by_agent_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL CHECK ("risk_level" IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
    "resource_type" TEXT,
    "resource_id" TEXT,
    "evidence" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'MODIFIED', 'DEFERRED', 'EXPIRED', 'CANCELLED')),
    "reviewed_by" TEXT,
    "reviewed_at" DATETIME,
    "decision_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME,
    CONSTRAINT "approval_requests_requested_by_agent_id_fkey" FOREIGN KEY ("requested_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claim" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL CHECK ("source_type" IN ('WEB', 'CUSTOMER', 'COMPETITOR', 'MARKET_DATA', 'INTERNAL', 'EXPERIMENT', 'OTHER')),
    "source_reference" TEXT,
    "collected_by_agent_id" TEXT NOT NULL,
    "collected_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reliability" TEXT NOT NULL CHECK ("reliability" IN ('LOW', 'MEDIUM', 'HIGH')),
    "confidence" REAL NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
    "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK ("verification_status" IN ('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'DISPUTED', 'REJECTED')),
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "evidence_collected_by_agent_id_fkey" FOREIGN KEY ("collected_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "target_customer" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK ("status" IN ('DISCOVERED', 'RESEARCHING', 'VALIDATING', 'VALIDATED', 'APPROVED', 'REJECTED', 'ARCHIVED')),
    "opportunity_score" REAL CHECK ("opportunity_score" IS NULL OR ("opportunity_score" >= 0 AND "opportunity_score" <= 1)),
    "confidence_score" REAL CHECK ("confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1)),
    "validation_level" TEXT NOT NULL DEFAULT 'LEVEL_0' CHECK ("validation_level" IN ('LEVEL_0', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5', 'LEVEL_6', 'LEVEL_7', 'LEVEL_8')),
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "opportunity_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opportunity_evidence_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "opportunity_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "opportunity_score_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "dimensions" TEXT NOT NULL,
    "opportunity_score" REAL NOT NULL CHECK ("opportunity_score" >= 0 AND "opportunity_score" <= 1),
    "confidence_score" REAL NOT NULL CHECK ("confidence_score" >= 0 AND "confidence_score" <= 1),
    "scored_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opportunity_score_records_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('WORKING', 'EPISODIC', 'STRATEGIC')),
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT,
    "confidence" REAL CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('AGENT_CREATED', 'AGENT_SUSPENDED', 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_FAILED', 'EVIDENCE_ADDED', 'OPPORTUNITY_DISCOVERED', 'OPPORTUNITY_SCORED', 'OPPORTUNITY_UPDATED', 'APPROVAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED')),
    "payload" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_type" TEXT NOT NULL CHECK ("actor_type" IN ('AGENT', 'HUMAN', 'SYSTEM')),
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "risk_level" TEXT CHECK ("risk_level" IS NULL OR "risk_level" IN ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
    "result" TEXT NOT NULL CHECK ("result" IN ('SUCCESS', 'FAILURE', 'DENIED')),
    "reason" TEXT,
    "metadata" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "agents_status_idx" ON "agents"("status");

-- CreateIndex
CREATE INDEX "agents_department_idx" ON "agents"("department");

-- CreateIndex
CREATE INDEX "agent_permissions_agent_id_permission_idx" ON "agent_permissions"("agent_id", "permission");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_assigned_agent_id_idx" ON "tasks"("assigned_agent_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE INDEX "approval_requests_resource_type_resource_id_idx" ON "approval_requests"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "evidence_collected_by_agent_id_idx" ON "evidence"("collected_by_agent_id");

-- CreateIndex
CREATE INDEX "evidence_source_type_idx" ON "evidence"("source_type");

-- CreateIndex
CREATE INDEX "opportunities_status_idx" ON "opportunities"("status");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_evidence_opportunity_id_evidence_id_key" ON "opportunity_evidence"("opportunity_id", "evidence_id");

-- CreateIndex
CREATE INDEX "opportunity_score_records_opportunity_id_idx" ON "opportunity_score_records"("opportunity_id");

-- CreateIndex
CREATE INDEX "memories_type_subject_idx" ON "memories"("type", "subject");

-- CreateIndex
CREATE INDEX "events_type_idx" ON "events"("type");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");
