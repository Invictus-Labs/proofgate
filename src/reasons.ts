/**
 * Stable decision reason codes. They appear in report.json and are printed by
 * `proofgate explain`. Adding a code is compatible; renaming or removing one is
 * a schema change.
 */
export const REASON_DESCRIPTIONS = {
  // receipt disqualifiers (the receipt names the requirement but cannot count)
  revision_mismatch: "The receipt is for a different commit than the revision set under assessment.",
  environment_mismatch: "The receipt ran in a different environment than the requirement demands.",
  level_insufficient: "The receipt's test level is below the required level.",
  execution_kind_not_allowed: "The receipt's execution kind (mocked or synthetic) is not allowed for this requirement.",
  receipt_from_future: "The receipt claims to have finished after the evaluation time.",
  repository_not_required: "The receipt is for a repository this requirement does not cover.",
  // evidence classification
  evidence_stale: "The evidence is at or beyond max_age_seconds at the evaluation time.",
  zero_tests: "The run executed zero tests, which proves nothing.",
  tests_failed: "One or more tests failed.",
  result_failed: "The receipt reports a failing result.",
  result_contradicts_counts: "The receipt claims a pass but its own test counts show failures.",
  tests_skipped: "Some tests were skipped, so the run is not a complete pass.",
  partial_result: "The receipt reports a partial result.",
  suite_skipped: "The whole suite was skipped.",
  all_criteria_met: "Repository, revision, environment, level, execution kind and freshness all match and every test passed.",
  // aggregation
  no_receipt: "No receipt names this requirement for this repository.",
  no_qualifying_receipt: "Receipts exist for this requirement but none qualifies; see rejected receipts.",
  conflicting_evidence: "Qualifying receipts for the same revision disagree (pass and fail).",
  incomplete_repository_coverage: "Only some of the declared repositories have passing evidence.",
  requirement_deferred: "The manifest explicitly defers this requirement; deferral never satisfies a mandatory gate.",
} as const;

export type ReasonCode = keyof typeof REASON_DESCRIPTIONS;

export function describeReason(code: string): string {
  // Own keys only: a hand-edited report may carry "constructor" or "__proto__", which a plain index would resolve to an
  // inherited function or object instead of the fallback text.
  return Object.hasOwn(REASON_DESCRIPTIONS, code) ? (REASON_DESCRIPTIONS as Record<string, string>)[code] as string : "No description is available for this reason code.";
}
