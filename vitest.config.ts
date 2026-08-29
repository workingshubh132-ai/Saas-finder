import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // Integration tests share one SQLite file and mutate shared tables,
    // so they must not run concurrently against it.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
