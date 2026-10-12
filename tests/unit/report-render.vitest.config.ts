import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Renderer-only run with its own coverage gate (the core config excludes src/web/** from coverage):
 *
 *   npx vitest run --config tests/unit/report-render.vitest.config.ts --coverage
 *
 * The renderer tests also run in the normal `npm test` (they match the core include glob).
 */
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  test: {
    include: ["tests/unit/report-render*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/web/**/*.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/report-render",
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
