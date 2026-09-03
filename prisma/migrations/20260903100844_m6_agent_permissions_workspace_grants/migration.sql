-- Widens `agent_permissions.permission`'s CHECK constraint to include
-- the two M6 workspace permissions (WRITE_WORKSPACE_FILES,
-- RUN_WORKSPACE_COMMAND — src/domain/permission/permission.ts). The
-- prior M6 migration (20260903050853_m6_saas_factory) widened
-- chairman_reviews/ceo_recommendations/events but missed this table —
-- caught by tests/integration/engineering-task.test.ts, which grants
-- both permissions to a real Engineering Agent and failed with
-- "CHECK constraint failed: permission" before this migration. Not
-- expressed in prisma/schema.prisma itself (Prisma's SQLite connector
-- does not emit CHECK constraints from the schema), so hand-applied
-- here per this project's established migration discipline.
-- Reproduces every other column/constraint/index on the table
-- unchanged (confirmed against the live dev database's sqlite_master
-- immediately before writing this migration).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_agent_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL CHECK ("permission" IN ('READ_WEB', 'WRITE_FILES', 'EXECUTE_CODE', 'READ_DATABASE', 'WRITE_DATABASE', 'SEND_EXTERNAL_MESSAGE', 'CREATE_EXTERNAL_ACCOUNT', 'DEPLOY_APPLICATION', 'SPEND_MONEY', 'ACCESS_SECRET', 'MODIFY_CONFIGURATION', 'WRITE_WORKSPACE_FILES', 'RUN_WORKSPACE_COMMAND')),
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
PRAGMA foreign_keys=ON;
