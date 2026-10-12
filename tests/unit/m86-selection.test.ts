import { expect, it } from "vitest";
// @ts-expect-error The harness helper is ESM JavaScript, as are the existing kill-rule helpers.
import { M86_ARGS, M86_FILE, M86_NAME, validM86Selection } from "../../scripts/m86-selection.mjs";

const report = (failed = false) => ({
  success: !failed, numTotalTests: 1, numPassedTests: failed ? 0 : 1,
  numFailedTests: failed ? 1 : 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ name: `/owned/${M86_FILE}`, status: failed ? "failed" : "passed", assertionResults: [{
    fullName: M86_NAME, title: M86_NAME, status: failed ? "failed" : "passed",
    failureMessages: failed ? ["AssertionError: expected true to be false"] : [],
  }] }],
});
it("M86 selection admits exactly the named native result and rejects missing, skipped or unrelated results", () => {
  expect(M86_ARGS).toEqual([M86_FILE, "--testNamePattern", `^${M86_NAME}$`]);
  expect(validM86Selection(report(), 0)).toBe(true);
  expect(validM86Selection(report(true), 1)).toBe(true);
  for (const invalid of [undefined, {}, { ...report(), numTotalTests: 0 },
    { ...report(), numPendingTests: 1 }, { ...report(), numTodoTests: 1 },
    { ...report(), numPassedTests: 0 }, { ...report(), success: false },
    { ...report(), testResults: [] },
    { ...report(), testResults: [...report().testResults, ...report().testResults] },
  ]) expect(validM86Selection(invalid, 0)).toBe(false);
  for (const field of ["fullName", "title", "status"] as const) {
    const changed = report();changed.testResults[0]!.assertionResults[0]![field] = "unrelated";
    expect(validM86Selection(changed, 0)).toBe(false);
  }
  const wrongFile = report();wrongFile.testResults[0]!.name = "/owned/tests/unit/other.test.ts";
  expect(validM86Selection(wrongFile, 0)).toBe(false);
  const extraTest = report();extraTest.testResults[0]!.assertionResults.push(extraTest.testResults[0]!.assertionResults[0]!);
  expect(validM86Selection(extraTest, 0)).toBe(false);
  expect(validM86Selection(report(true), 0)).toBe(false);
  expect(validM86Selection(report(), 1)).toBe(false);
  expect(validM86Selection(report(true), null)).toBe(false);
  expect(validM86Selection(report(true), 2)).toBe(false);
});
