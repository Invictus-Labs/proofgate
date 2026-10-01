/** Package version; a unit test asserts this equals package.json. */
export const PROOFGATE_VERSION = "0.1.0";
/**
 * Bumped whenever a decision rule changes. It is folded into the policy hash so a
 * rule change is always visible as a new policy and forces a new assessment.
 * 2: failing zero-test receipts count as FAIL, future-dated failures block, RunProof
 *    execution status and exit code are honoured, requirement-level all_criteria_met only for PASS.
 */
export const POLICY_ENGINE_VERSION = 2;
export const SCHEMA_VERSION = 1;
