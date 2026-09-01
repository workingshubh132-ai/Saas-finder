-- Rebuild required to add a NOT NULL foreign-key column (SQLite
-- limitation); the `signals` table introduced in the previous
-- migration has no rows yet, so this is a pure schema change, not a
-- backfill. Every CHECK constraint from that migration is carried
-- forward unchanged (docs/SECURITY.md, "Fail-closed enums, in the
-- database too") plus the new collected_by_agent_id foreign key
-- (Constitution §25 — every significant agent action must be
-- attributable; mirrors evidence.collected_by_agent_id).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_signals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL CHECK ("source_type" IN ('WEB', 'CUSTOMER', 'COMPETITOR', 'MARKET_DATA', 'INTERNAL', 'EXPERIMENT', 'OTHER')),
    "source_reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "collected_by_agent_id" TEXT NOT NULL,
    "published_at" DATETIME,
    "collected_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_context" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "content_hash" TEXT NOT NULL,
    "source_group_key" TEXT,
    "metadata" TEXT,
    "reliability" TEXT NOT NULL CHECK ("reliability" IN ('LOW', 'MEDIUM', 'HIGH')),
    "quality_score" REAL NOT NULL DEFAULT 0 CHECK ("quality_score" >= 0 AND "quality_score" <= 1),
    "status" TEXT NOT NULL DEFAULT 'NEW' CHECK ("status" IN ('NEW', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'CLUSTERED', 'ARCHIVED')),
    "cluster_id" TEXT,
    "duplicate_of_signal_id" TEXT,
    "duplicate_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "signals_collected_by_agent_id_fkey" FOREIGN KEY ("collected_by_agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "signals_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "signal_clusters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "signals_duplicate_of_signal_id_fkey" FOREIGN KEY ("duplicate_of_signal_id") REFERENCES "signals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_signals" ("author_context", "cluster_id", "collected_at", "content", "content_hash", "created_at", "duplicate_of_signal_id", "duplicate_reason", "id", "language", "metadata", "published_at", "quality_score", "reliability", "source", "source_group_key", "source_reference", "source_type", "status", "title", "updated_at") SELECT "author_context", "cluster_id", "collected_at", "content", "content_hash", "created_at", "duplicate_of_signal_id", "duplicate_reason", "id", "language", "metadata", "published_at", "quality_score", "reliability", "source", "source_group_key", "source_reference", "source_type", "status", "title", "updated_at" FROM "signals";
DROP TABLE "signals";
ALTER TABLE "new_signals" RENAME TO "signals";
CREATE INDEX "signals_status_idx" ON "signals"("status");
CREATE INDEX "signals_source_idx" ON "signals"("source");
CREATE INDEX "signals_content_hash_idx" ON "signals"("content_hash");
CREATE INDEX "signals_source_group_key_idx" ON "signals"("source_group_key");
CREATE INDEX "signals_cluster_id_idx" ON "signals"("cluster_id");
CREATE INDEX "signals_collected_by_agent_id_idx" ON "signals"("collected_by_agent_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
