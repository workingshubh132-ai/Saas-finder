import path from "node:path";

/**
 * Absolute path avoids any ambiguity between how the Prisma CLI
 * (globalSetup, run via `prisma migrate deploy`) and the generated
 * Node client (setup.ts, running inside the test process) resolve a
 * relative `file:` SQLite URL.
 */
export const TEST_DATABASE_PATH = path.resolve(import.meta.dirname, "..", "prisma", "test.db");
export const TEST_DATABASE_URL = `file:${TEST_DATABASE_PATH}`;
