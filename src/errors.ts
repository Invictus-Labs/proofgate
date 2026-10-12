/**
 * Stable error contract. Every input rejection is a ProofGateError carrying a
 * machine-readable `code`; the CLI maps any ProofGateError (and any unexpected
 * error) to exit code 2. The codes are part of the public interface and are
 * documented in docs/INTERFACES.md.
 */

export const ERROR_CODES = [
  // command line
  "cli_usage",
  "clock_invalid",
  "connector_disconnected",
  "internal_error",
  // manifest
  "manifest_not_found",
  "manifest_parse_error",
  "manifest_schema_invalid",
  "manifest_unknown_field",
  "manifest_duplicate_requirement_id",
  "manifest_duplicate_repository",
  "manifest_unknown_repository",
  "manifest_no_mandatory_requirements",
  // revisions
  "revisions_not_found",
  "revisions_invalid_json",
  "revisions_schema_invalid",
  "revisions_unknown_field",
  "revisions_invalid_commit_sha",
  "revisions_duplicate_repository",
  "revisions_unknown_repository",
  "revisions_missing_repository",
  // receipts and adapters
  "receipts_dir_not_found",
  "receipt_invalid_json",
  "receipt_schema_invalid",
  "receipt_unknown_field",
  "receipt_invalid_commit_sha",
  "receipt_duplicate_id",
  "receipt_unknown_requirement",
  "receipt_unknown_repository",
  "receipt_unreferenced_file",
  "adapter_unknown_format",
  "runproof_schema_invalid",
  "runproof_unknown_field",
  "runproof_invalid_commit_sha",
  "runproof_outcome_mismatch",
  "runproof_run_unfinished",
  "runproof_execution_incomplete",
  "unsupported_schema_version",
  "json_duplicate_key",
  // artifacts and filesystem
  "artifact_missing",
  "artifact_hash_mismatch",
  "path_invalid",
  "path_absolute",
  "path_traversal",
  "path_symlink_rejected",
  "path_not_regular_file",
  // limits
  "limit_file_count",
  "limit_metadata_bytes",
  "limit_manifest_size",
  "limit_blob_bytes",
  "limit_json_depth",
  "limit_json_containers",
  "limit_json_values",
  // report / output
  "output_exists",
  "output_overlaps_input",
  "output_unwritable",
  "report_not_found",
  "report_invalid",
  "explain_unknown_requirement",
  // bundle
  "bundle_not_found",
  "bundle_truncated",
  "bundle_corrupt",
  "bundle_invalid_header",
  "bundle_unsupported_version",
  "bundle_entry_invalid",
  "bundle_too_large",
  "bundle_target_exists",
  "bundle_input_mismatch",
  "bundle_secret_detected",
  "bundle_reevaluation_mismatch",
  // event envelope
  "envelope_schema_invalid",
  "envelope_unknown_field",
  "envelope_conflict",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ProofGateError extends Error {
  readonly code: ErrorCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ProofGateError";
    this.code = code;
    this.detail = detail;
  }
}

export function isProofGateError(value: unknown): value is ProofGateError {
  return value instanceof ProofGateError;
}
