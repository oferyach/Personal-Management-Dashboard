import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const srcRoot = resolve(import.meta.dirname, "src");

const alias = { "@": srcRoot };

/**
 * Two projects, because unit tests and integration tests have different needs:
 *  - unit: pure logic plus an isolated SQLite file when needed.
 *  - integration: real route handlers against a real (isolated) SQLite file,
 *    created by the same migrations production runs, with the same pragmas.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.tsx", "tests/**", "scripts/**"],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-unit.ts"],
          globalSetup: ["tests/helpers/globalSetup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-integration.ts"],
          globalSetup: ["tests/helpers/globalSetup.ts"],
          // One SQLite file per worker process; keep writes serialized until the
          // job queue (Phase 3) is what concurrency is actually about.
          fileParallelism: false,
        },
      },
    ],
  },
});
