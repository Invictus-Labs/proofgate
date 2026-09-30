/**
 * Library entry point. The CLI (`proofgate`) is the primary interface; these
 * exports are the frozen, documented surface for report renderers and tools.
 */
import { refuseWhenStartedAsMain } from "./entry-guard.js";

// `node dist/index.js evaluate ...` (also `node .` and `node dist`) would otherwise do nothing and exit 0.
refuseWhenStartedAsMain(import.meta.url, "dist/index.js");

export { PROOFGATE_VERSION, POLICY_ENGINE_VERSION, SCHEMA_VERSION } from "./version.js";
export { ProofGateError, ERROR_CODES, isProofGateError, type ErrorCode } from "./errors.js";
export { canonicalize, hashCanonical, sha256Hex, uuidFromHash } from "./canonical.js";
export { escapeHtml } from "./escape.js";
export { redactString, redactValue, isSensitiveKey, REDACTED } from "./redact.js";
export { REASON_DESCRIPTIONS, describeReason, type ReasonCode } from "./reasons.js";
export {
  reportSchema,
  manifestSchema,
  receiptSchema,
  revisionsSchema,
  runproofDocumentSchema,
  STATUSES,
  type Report,
  type Decision,
  type ReportReceipt,
  type Status,
  type NormalizedManifest,
  type NormalizedRequirement,
  type Receipt,
} from "./schemas.js";
export { parseManifestText, computePolicyHash, type LoadedManifest } from "./manifest.js";
export { parseRevisionsText, type LoadedRevisions } from "./revisions.js";
export { assess, decideRequirement, classifyEvidence, combineStatuses, type AssessmentInput } from "./evaluate.js";
export { loadInputs, evaluatePaths, type EvaluateOptions, type EvaluationResult } from "./pipeline.js";
export { readReport, serializeReport, reportContentHash, writeReportDirectory } from "./report.js";
export { explainRequirement, findDecision } from "./explain.js";
export { exportBundle, restoreBundle, bundleHeaderSchema, type BundleHeader } from "./bundle.js";
export { adaptReceiptDocument, SUPPORTED_FORMATS } from "./adapters/index.js";
export { parseEnvelope, EnvelopeDeduper, envelopeSchema, type EventEnvelope } from "./adapters/envelope.js";
export { DEFAULT_LIMITS, type Limits } from "./limits.js";
export { resolveNow } from "./clock.js";
