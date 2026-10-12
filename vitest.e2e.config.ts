import { defineConfig } from "vitest/config";

// Packaged-executable E2E: packs the project with `npm pack`, installs the tarball into a fresh temporary directory
// outside the repository and drives the real `proofgate` binary. No coverage here: the binary under test is the
// compiled, packaged artifact, not the TypeScript sources.
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    globalSetup: ["tests/e2e/support/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
