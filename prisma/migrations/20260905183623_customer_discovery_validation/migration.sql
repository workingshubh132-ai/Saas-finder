-- CreateTable
CREATE TABLE "customer_discovery_interactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opportunity_id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "outreach_message_id" TEXT,
    "interaction_type" TEXT NOT NULL,
    "interaction_date" DATETIME NOT NULL,
    "channel" TEXT,
    "participant_role" TEXT,
    "raw_notes" TEXT NOT NULL,
    "reality" TEXT NOT NULL,
    "provenance_note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "interaction_outcome" TEXT,
    "recorded_by_identity_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "customer_discovery_interactions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customer_discovery_interactions_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_discovery_interactions_outreach_message_id_fkey" FOREIGN KEY ("outreach_message_id") REFERENCES "outreach_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "customer_discovery_interactions_recorded_by_identity_id_fkey" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "identities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "discovery_findings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interaction_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "evidence_quote" TEXT,
    "promoted_to_evidence_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discovery_findings_interaction_id_fkey" FOREIGN KEY ("interaction_id") REFERENCES "customer_discovery_interactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customer_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "response_id" TEXT,
    "discovery_interaction_id" TEXT,
    "evidence_id" TEXT NOT NULL,
    "prospect_id" TEXT NOT NULL,
    "signal_type" TEXT NOT NULL,
    "related_claim_type" TEXT,
    "strength" TEXT NOT NULL,
    "directness" TEXT NOT NULL,
    "extracted_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_evidence_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "customer_responses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_discovery_interaction_id_fkey" FOREIGN KEY ("discovery_interaction_id") REFERENCES "customer_discovery_interactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_evidence_extracted_by_agent_id_fkey" FOREIGN KEY ("extracted_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_customer_evidence" ("created_at", "directness", "evidence_id", "extracted_by_agent_id", "id", "prospect_id", "related_claim_type", "response_id", "signal_type", "strength") SELECT "created_at", "directness", "evidence_id", "extracted_by_agent_id", "id", "prospect_id", "related_claim_type", "response_id", "signal_type", "strength" FROM "customer_evidence";
DROP TABLE "customer_evidence";
ALTER TABLE "new_customer_evidence" RENAME TO "customer_evidence";
CREATE INDEX "customer_evidence_response_id_idx" ON "customer_evidence"("response_id");
CREATE INDEX "customer_evidence_discovery_interaction_id_idx" ON "customer_evidence"("discovery_interaction_id");
CREATE INDEX "customer_evidence_evidence_id_idx" ON "customer_evidence"("evidence_id");
CREATE INDEX "customer_evidence_prospect_id_idx" ON "customer_evidence"("prospect_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "customer_discovery_interactions_opportunity_id_idx" ON "customer_discovery_interactions"("opportunity_id");

-- CreateIndex
CREATE INDEX "customer_discovery_interactions_prospect_id_idx" ON "customer_discovery_interactions"("prospect_id");

-- CreateIndex
CREATE INDEX "customer_discovery_interactions_outreach_message_id_idx" ON "customer_discovery_interactions"("outreach_message_id");

-- CreateIndex
CREATE INDEX "customer_discovery_interactions_status_idx" ON "customer_discovery_interactions"("status");

-- CreateIndex
CREATE INDEX "discovery_findings_interaction_id_idx" ON "discovery_findings"("interaction_id");

-- CreateIndex
CREATE INDEX "discovery_findings_field_idx" ON "discovery_findings"("field");
