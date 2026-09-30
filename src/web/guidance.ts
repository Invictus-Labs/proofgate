import { REASON_DESCRIPTIONS, describeReason, type ReasonCode } from "../reasons.js";
import type { Status } from "../schemas.js";

/**
 * Fixed wording for the static report. Nothing here comes from the report: it
 * is the plain-language layer (what a status means, what the operator does
 * next). Reason-code explanations come from the core (`describeReason`).
 */

export interface StatusInfo {
  /** Text label, always shown next to the symbol so colour is never the only cue. */
  label: Status;
  /** Text-presentation Unicode shape (no emoji), decorative: hidden from assistive technology. */
  symbol: string;
  /** Lowercase key used for CSS classes (a fixed set, never taken from the report). */
  key: string;
  meaning: string;
  /** What this status contributes to acceptance. */
  acceptance: string;
  /** Default next step when no reason-specific step applies. */
  nextStep: string;
}

export const STATUS_INFO: Record<Status, StatusInfo> = {
  PASS: {
    label: "PASS",
    symbol: "✓",
    key: "pass",
    meaning: "Every required repository has fresh, complete, passing evidence for the exact revision, environment and test level.",
    acceptance: "Satisfies the requirement.",
    nextStep: "No action needed for this requirement.",
  },
  FAIL: {
    label: "FAIL",
    symbol: "✗",
    key: "fail",
    meaning: "Fresh evidence for the exact revision contains a failing test or contradicts itself.",
    acceptance: "Not satisfied. A failing mandatory requirement blocks acceptance.",
    nextStep: "Fix the failure, re-run the tests on this revision and evaluate again.",
  },
  STALE: {
    label: "STALE",
    symbol: "◷",
    key: "stale",
    meaning: "The only matching evidence is at or beyond the maximum allowed age. Evidence exactly at the limit is already stale.",
    acceptance: "Not satisfied. Old evidence is not accepted.",
    nextStep: "Re-run the tests on this revision to produce fresh evidence and evaluate again.",
  },
  MISSING: {
    label: "MISSING",
    symbol: "○",
    key: "missing",
    meaning: "No matching evidence exists, or the only evidence is passing claims of runs that executed zero tests.",
    acceptance: "Not satisfied. Absence of evidence is not a pass.",
    nextStep: "Run the required tests and add a receipt for this requirement.",
  },
  PARTIAL: {
    label: "PARTIAL",
    symbol: "◐",
    key: "partial",
    meaning: "The evidence is incomplete: skipped tests, a partial result, or only some of the declared repositories are covered.",
    acceptance: "Not satisfied. Incomplete evidence is not accepted.",
    nextStep: "Complete the run (no skipped tests, every declared repository covered) and evaluate again.",
  },
  DEFERRED: {
    label: "DEFERRED",
    symbol: "◇",
    key: "deferred",
    meaning: "The manifest explicitly defers this requirement. It is unverified and stays visible.",
    acceptance: "Not satisfied. Deferral never satisfies a mandatory requirement.",
    nextStep: "Resolve the deferral: run the tests, then remove the deferral from the manifest.",
  },
};

/** Shown when a report carries a status this renderer does not know. It is never styled as success. */
export const UNKNOWN_STATUS: Omit<StatusInfo, "label"> = {
  symbol: "?",
  key: "unknown",
  meaning: "This status is not one of the six ProofGate statuses. Treat the requirement as unsatisfied.",
  acceptance: "Not satisfied. Unknown states never pass.",
  nextStep: "Re-run proofgate evaluate with a matching ProofGate version and check the report.",
};

export function statusInfo(status: unknown): StatusInfo | (Omit<StatusInfo, "label"> & { label: null }) {
  return typeof status === "string" && Object.hasOwn(STATUS_INFO, status)
    ? STATUS_INFO[status as Status]
    : { ...UNKNOWN_STATUS, label: null };
}

/** One concrete next step per core reason code. Typed against the core table so a new code cannot be forgotten. */
export const REASON_NEXT_STEPS: Record<ReasonCode, string> = {
  revision_mismatch: "Re-run the tests on the exact commit in the revision set, or change the revision set deliberately and evaluate again.",
  environment_mismatch: "Run the tests in the required environment; results from another environment cannot substitute.",
  level_insufficient: "Run the tests at the required level or a higher one.",
  execution_kind_not_allowed: "Replace the mocked or synthetic run with a live run, or allow that execution kind in the manifest through review.",
  receipt_from_future: "Check the runner clock and re-run; a receipt dated after the evaluation time is never trusted.",
  repository_not_required: "No action, unless this requirement should cover that repository; then change the manifest.",
  evidence_stale: "Re-run the tests on this revision to produce fresh evidence and evaluate again.",
  zero_tests: "Fix the test selection so at least one test runs; an empty suite proves nothing.",
  tests_failed: "Fix the failing tests, re-run them on this revision and evaluate again.",
  result_failed: "Investigate the failing result the runner reported, fix it, re-run and evaluate again.",
  result_contradicts_counts: "Investigate the runner: it claimed a pass while reporting failures. Re-run and issue a new receipt.",
  tests_skipped: "Enable the skipped tests, or remove them from scope through review, then re-run.",
  partial_result: "Complete the run so the runner reports a full result, then evaluate again.",
  suite_skipped: "Run the suite; a skipped suite is not evidence.",
  all_criteria_met: "No action needed.",
  no_receipt: "Run the required tests and add a receipt that names this requirement.",
  no_qualifying_receipt: "See the rejected receipts in the details below and fix the mismatch (revision, environment, level, execution kind or timing).",
  conflicting_evidence: "Resolve the contradiction: re-run on this revision, and remove a receipt from the evidence set only if it is truly obsolete.",
  incomplete_repository_coverage: "Provide passing evidence for every declared repository of this requirement.",
  requirement_deferred: "Resolve the deferral: run the tests, then remove the deferral from the manifest. Until then it cannot be accepted.",
};

const UNKNOWN_REASON_DESCRIPTION = "No description is available for this reason code.";

/**
 * Plain-language explanation of a reason code, from the core table. Only own keys are trusted, so a code such as
 * `constructor` or `__proto__` in a hand-edited report cannot resolve to an inherited object member.
 */
export function explainReason(code: string): string {
  return Object.hasOwn(REASON_DESCRIPTIONS, code) ? describeReason(code) : UNKNOWN_REASON_DESCRIPTION;
}

export function nextStepForReason(code: string): string {
  return Object.hasOwn(REASON_NEXT_STEPS, code) ? REASON_NEXT_STEPS[code as ReasonCode] : UNKNOWN_REASON_NEXT_STEP;
}

export const UNKNOWN_REASON_NEXT_STEP ="Run proofgate explain for this requirement to see the receipt ids and reason codes.";

export interface ExitCodeInfo {
  code: 0 | 1 | 2;
  meaning: string;
}

export const EXIT_CODES: readonly ExitCodeInfo[] = [
  { code: 0, meaning: "Accepted: every mandatory requirement is PASS." },
  { code: 1, meaning: "Unsatisfied: at least one mandatory requirement is not PASS. A report is written; nothing is accepted." },
  { code: 2, meaning: "Malformed input or an internal error. No report is produced, so a report can never carry this code." },
];
