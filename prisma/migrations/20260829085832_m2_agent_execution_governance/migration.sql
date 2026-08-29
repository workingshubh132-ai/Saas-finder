-- CreateTable
CREATE TABLE "identities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('HUMAN', 'AGENT', 'SYSTEM')),
    "label" TEXT NOT NULL,
    "agent_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'REVOKED')),
    "created_by_identity_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME,
    "expires_at" DATETIME,
    "last_used_at" DATETIME,
    CONSTRAINT "identities_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_id" TEXT NOT NULL,
    "task_id" TEXT,
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
    CONSTRAINT "agent_executions_started_by_identity_id_fkey" FOREIGN KEY ("started_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tool_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "execution_id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('SUCCESS', 'FAILED')),
    "input" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    "duration_ms" INTEGER,
    CONSTRAINT "tool_executions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "agent_executions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chairman_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL CHECK ("decision" IN ('APPROVE', 'REJECT', 'REQUEST_MORE_EVIDENCE', 'DEFER', 'ESCALATE_TO_HUMAN')),
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

-- CreateIndex
CREATE UNIQUE INDEX "identities_token_hash_key" ON "identities"("token_hash");

-- CreateIndex
CREATE INDEX "identities_agent_id_idx" ON "identities"("agent_id");

-- CreateIndex
CREATE INDEX "identities_status_idx" ON "identities"("status");

-- CreateIndex
CREATE INDEX "agent_executions_status_idx" ON "agent_executions"("status");

-- CreateIndex
CREATE INDEX "agent_executions_agent_id_idx" ON "agent_executions"("agent_id");

-- CreateIndex
CREATE INDEX "agent_executions_task_id_idx" ON "agent_executions"("task_id");

-- CreateIndex
CREATE INDEX "tool_executions_execution_id_idx" ON "tool_executions"("execution_id");

-- CreateIndex
CREATE INDEX "tool_executions_tool_id_idx" ON "tool_executions"("tool_id");

-- CreateIndex
CREATE INDEX "chairman_reviews_opportunity_id_idx" ON "chairman_reviews"("opportunity_id");
