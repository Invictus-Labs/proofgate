import { defineConfig } from "@playwright/test";

// Browser smoke of the static report, in real Chromium. The pages are produced by the installed, packed `proofgate`
// binary (see tests/e2e/support/playwright-setup.ts) and opened from file://; nothing is mocked and there is no server.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/support/playwright-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  outputDir: "test-results",
  use: { browserName: "chromium", headless: true },
});
