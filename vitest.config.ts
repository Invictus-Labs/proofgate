import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/proofgate.spec.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The report layer (src/web/**) is covered by the same 90% thresholds now that it is integrated.
      // Exclusions: src/index.ts is a re-export barrel plus one call (`refuseWhenStartedAsMain`, whose logic lives in src/entry-guard.ts
      // and has a floor below) and src/adapters/types.ts is type declarations only.
      // src/cli.ts is the executable entry (a dozen lines: signal, EPIPE and crash handlers, then `main(...)`). It runs only in the
      // built binary in a subprocess (tests/integration/round4-cli-entry.test.ts, round2-cli-safety, the packaged E2E), never in
      // this in-process run, so a line count would read 0% whatever the tests prove; all decision logic lives in src/run.ts, which
      // has a floor below.
      exclude: ["src/index.ts", "src/adapters/types.ts", "src/cli.ts", "**/*.d.ts"],
      reporter: ["text", "json-summary"],
      // Global floor, plus a floor per decision and security module: a well-covered whole can hide a weak file (bundle.ts sat
      // at 89.8% branches while the total read 96%).
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
        ...Object.fromEntries(
          [
            "evaluate", "receipt", "redact", "manifest", "json", "report", "bundle", "fsguard", "terminal", "clock", "revisions", "canonical", "pipeline",
            // Round 3 (tests re-review P3): decision-relevant and boundary modules that the global figure could hide.
            "run", "schemas", "explain", "escape", "errors", "reasons", "identifiers", "entry-guard", "adapters/runproof", "adapters/envelope", "adapters/native", "adapters/index",
            "web/render", "web/safe-html", "web/guidance", "web/styles",
          ].map((name) => [
            `src/${name}.ts`,
            { lines: 90, branches: 90, functions: 90, statements: 90 },
          ]),
        ),
      },
    },
  },
});
