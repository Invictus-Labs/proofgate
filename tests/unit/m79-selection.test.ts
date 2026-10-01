import { expect, it } from "vitest";
// @ts-expect-error The harness helper is ESM JavaScript, as are the existing kill-rule helpers.
import { M79_ARGS, M79_FILE, M79_NAME, validM79Selection } from "../../scripts/m79-selection.mjs";

const report = (failed = false) => ({
  success: !failed, numTotalTests: 1, numPassedTests: failed ? 0 : 1,
  numFailedTests: failed ? 1 : 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ name: `/owned/${M79_FILE}`, status: failed ? "failed" : "passed", assertionResults: [{
    fullName: M79_NAME, title: M79_NAME, status: failed ? "failed" : "passed",
    failureMessages: failed ? ["AssertionError: expected true to be false"] : [],
  }] }],
});
it("M79 selection admits exactly the named native result and rejects missing, skipped or unrelated results", () => {
  expect(M79_ARGS).toEqual([M79_FILE, "--testNamePattern", `^${M79_NAME}$`]);
  expect(validM79Selection(report(), 0)).toBe(true);
  expect(validM79Selection(report(true), 1)).toBe(true);
  for (const invalid of [undefined, {}, { ...report(), numTotalTests: 0 },
    { ...report(), numPendingTests: 1 }, { ...report(), numTodoTests: 1 },
    { ...report(), numPassedTests: 0 }, { ...report(), success: false },
    { ...report(), testResults: [] },
    { ...report(), testResults: [...report().testResults, ...report().testResults] },
  ]) expect(validM79Selection(invalid, 0)).toBe(false);
  for (const field of ["fullName", "title", "status"] as const) {
    const changed = report();changed.testResults[0]!.assertionResults[0]![field] = "unrelated";
    expect(validM79Selection(changed, 0)).toBe(false);
  }
  const wrongFile = report();wrongFile.testResults[0]!.name = "/owned/tests/unit/other.test.ts";
  expect(validM79Selection(wrongFile, 0)).toBe(false);
  const extraTest = report();extraTest.testResults[0]!.assertionResults.push(extraTest.testResults[0]!.assertionResults[0]!);
  expect(validM79Selection(extraTest, 0)).toBe(false);
  expect(validM79Selection(report(true), 0)).toBe(false);
  expect(validM79Selection(report(), 1)).toBe(false);
  expect(validM79Selection(report(true), null)).toBe(false);
  expect(validM79Selection(report(true), 2)).toBe(false);
});
