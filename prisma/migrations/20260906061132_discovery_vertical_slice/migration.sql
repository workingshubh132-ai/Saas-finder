-- CreateTable
CREATE TABLE "prospect_research_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospect_id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "contact_type" TEXT NOT NULL,
    "contact_source" TEXT NOT NULL,
    "decision_maker" TEXT NOT NULL,
    "workflow_signals" TEXT NOT NULL,
    "pain_hypotheses" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "reality" TEXT NOT NULL,
    "provenance_note" TEXT NOT NULL,
    "created_by_agent_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prospect_research_profiles_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "prospect_research_profiles_created_by_agent_id_fkey" FOREIGN KEY ("created_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "prospect_research_profiles_prospect_id_key" ON "prospect_research_profiles"("prospect_id");

-- CreateIndex
CREATE INDEX "prospect_research_profiles_prospect_id_idx" ON "prospect_research_profiles"("prospect_id");
