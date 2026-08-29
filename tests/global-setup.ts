import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { TEST_DATABASE_PATH, TEST_DATABASE_URL } from "./test-db.js";

/**
 * Vitest globalSetup: runs once, in its own process, before any test
 * file loads. Applies the real, checked-in migration (including its
 * CHECK constraints) to a fresh test database — this both isolates
 * tests from dev.db and doubles as migration validation (M1 brief §24).
 */
export default function globalSetup(): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const candidate = `${TEST_DATABASE_PATH}${suffix}`;
    if (existsSync(candidate)) rmSync(candidate);
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
