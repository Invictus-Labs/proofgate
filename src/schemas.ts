import { z } from "zod";
import { ProofGateError, type ErrorCode } from "./errors.js";
import { SCHEMA_VERSION } from "./version.js";

/* ------------------------------------------------------------------ primitives */

export const TEST_LEVELS = ["unit", "integration", "e2e"] as const;
export type TestLevel = (typeof TEST_LEVELS)[number];
/** Higher rank satisfies a lower required level (an e2e run covers an integration requirement). */
export const LEVEL_RANK: Record<TestLevel, number> = { unit: 1, integration: 2, e2e: 3 };

export const EXECUTION_KINDS = ["live", "mocked", "synthetic"] as const;
export type ExecutionKind = (typeof EXECUTION_KINDS)[number];

export const RESULTS = ["pass", "fail", "partial", "skipped"] as const;
export type ReceiptResult = (typeof RESULTS)[number];

export const SEVERITIES = ["mandatory", "advisory"] as const;
export const STATUSES = ["PASS", "FAIL", "STALE", "MISSING", "PARTIAL", "DEFERRED"] as const;
export type Status = (typeof STATUSES)[number];

export const commitSha = z.string().regex(/^[0-9a-f]{40}$/, "must be a full 40-character lowercase hex commit SHA");
export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be a 64-character lowercase hex sha256");
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "must be a lowercase UUID");
/**
 * Receipt (and RunProof run) identifiers are opaque: UUIDs are accepted, but CI systems rarely
 * emit them, so any 1-128 character token of A-Z a-z 0-9 . _ : - is allowed.
 */
export const receiptId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "must be 1-128 characters of A-Z a-z 0-9 . _ : -");
export const requirementId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "must be 1-64 characters of A-Z a-z 0-9 . _ -");
export const repositoryId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/, "must be 1-100 characters of A-Z a-z 0-9 . _ / -");

const UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/** Strict UTC instant: `YYYY-MM-DDTHH:MM:SS[.fff]Z`. Offsets and date-only forms are rejected. */
export function isUtcTimestamp(value: string): boolean {
  const m = UTC_RE.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

// The pattern is what the published JSON Schema carries; the refinement adds the calendar check (no 2026-02-30) that a
// pattern cannot express.
export const utcTimestamp = z
  .string()
  .regex(UTC_RE, "must be a UTC timestamp like 2026-09-29T00:00:00Z")
  .refine(isUtcTimestamp, "must be a UTC timestamp like 2026-09-29T00:00:00Z");

export const relativePath = z.string().min(1).max(512);
const schemaVersion1 = z.literal(SCHEMA_VERSION);
const extensions = z.record(z.string().max(100), z.unknown());

/* -------------------------------------------------------------------- manifest */

export const requirementSchema = z.strictObject({
  id: requirementId,
  title: z.string().min(1).max(300),
  severity: z.enum(SEVERITIES),
  required_level: z.enum(TEST_LEVELS),
  required_environment: z.string().min(1).max(100),
  max_age_seconds: z.number().int().positive().max(315_360_000),
  /** Declared repositories whose evidence is required. Defaults to every declared repository. */
  repositories: z.array(repositoryId).min(1).max(50).optional(),
  /** Defaults to ["live"]: mocked and synthetic evidence never satisfies a requirement unless listed. */
  allowed_execution_kinds: z.array(z.enum(EXECUTION_KINDS)).min(1).max(3).optional(),
  /** Explicitly deferred requirements resolve to DEFERRED and never satisfy a mandatory gate. */
  deferred: z.strictObject({ reason: z.string().min(1).max(500) }).optional(),
});

export const manifestSchema = z.strictObject({
  schema_version: schemaVersion1,
  name: z.string().min(1).max(200),
  repositories: z
    .array(z.strictObject({ id: repositoryId, description: z.string().max(300).optional() }))
    .min(1)
    .max(50),
  requirements: z.array(requirementSchema).min(1).max(5000),
  extensions: extensions.optional(),
});

/**
 * The normalised manifest is itself a valid manifest document (defaults filled,
 * lists sorted), so normalising twice is a no-op and the manifest hash is stable.
 */
export interface NormalizedRequirement {
  id: string;
  title: string;
  severity: (typeof SEVERITIES)[number];
  required_level: TestLevel;
  required_environment: string;
  max_age_seconds: number;
  repositories: string[];
  allowed_execution_kinds: ExecutionKind[];
  deferred?: { reason: string };
}
export interface NormalizedManifest {
  schema_version: 1;
  name: string;
  repositories: Array<{ id: string; description?: string }>;
  requirements: NormalizedRequirement[];
  extensions?: Record<string, unknown>;
}

/* ------------------------------------------------------------------- revisions */

export const revisionsSchema = z.strictObject({
  schema_version: schemaVersion1,
  revisions: z.array(z.strictObject({ repository: repositoryId, commit_sha: commitSha })).min(1).max(50),
});
export interface Revision {
  repository: string;
  commit_sha: string;
}

/* -------------------------------------------------------------------- receipts */

const testCounts = z
  .strictObject({
    total: z.number().int().min(0).max(100_000_000),
    passed: z.number().int().min(0).max(100_000_000),
    failed: z.number().int().min(0).max(100_000_000),
    skipped: z.number().int().min(0).max(100_000_000),
  })
  .refine((t) => t.passed + t.failed + t.skipped === t.total, {
    message: "tests.passed + tests.failed + tests.skipped must equal tests.total",
  });

const artifactRef = z.strictObject({ path: relativePath, sha256: sha256Hex });

export const receiptBodyShape = {
  receipt_id: receiptId,
  requirement_ids: z.array(requirementId).min(1).max(200),
  repository: repositoryId,
  commit_sha: commitSha,
  runner_id: z.string().min(1).max(200),
  environment: z.string().min(1).max(100),
  test_level: z.enum(TEST_LEVELS),
  execution_kind: z.enum(EXECUTION_KINDS),
  result: z.enum(RESULTS),
  tests: testCounts,
  artifact: artifactRef,
  finished_at: utcTimestamp,
  /** Informational only. ProofGate never executes it. */
  command: z.string().max(2000).optional(),
  extensions: extensions.optional(),
};

export const receiptSchema = z.strictObject({
  format: z.literal("proofgate.receipt").optional(),
  schema_version: schemaVersion1,
  ...receiptBodyShape,
});

/** Normalised receipt used by the engine (after schema validation, redaction and adapter mapping). */
export interface Receipt {
  receipt_id: string;
  requirement_ids: string[];
  repository: string;
  commit_sha: string;
  runner_id: string;
  environment: string;
  test_level: TestLevel;
  execution_kind: ExecutionKind;
  result: ReceiptResult;
  tests: { total: number; passed: number; failed: number; skipped: number };
  artifact: { path: string; sha256: string };
  finished_at: string;
  command: string | null;
  extensions: Record<string, unknown> | null;
}

/* ------------------------------------------------------- runproof adapter input */

const runproofCheck = z.looseObject({
  id: z.string().max(200),
  evaluation: z.number().int().min(0),
  definition_id: z.string().max(200),
  required: z.boolean(),
  state: z.enum(["pending", "pass", "fail", "unknown"]),
});

export const runproofRunSchema = z.looseObject({
  id: receiptId,
  external_run_id: z.string().min(1).max(200),
  execution_status: z.enum(["running", "succeeded", "failed", "missing"]),
  outcome: z.enum(["pending", "verified", "failed", "unknown"]),
  finished_at: utcTimestamp.nullable(),
  checks: z.array(runproofCheck).max(5000),
  // When a run records an exit code it must be an integer. A string ("1"), a boolean or an object is not "no exit code":
  // it used to be skipped, and the run imported as a pass. `exitCode` is the same field spelled the other common way.
  exit_code: z.number().int().nullable().optional(),
  exitCode: z.number().int().nullable().optional(),
});

export const runproofDocumentSchema = z.strictObject({
  format: z.literal("runproof.run-detail"),
  schema_version: schemaVersion1,
  /** `fixture` documents are always treated as synthetic evidence, never live. */
  source_kind: z.enum(["fixture", "operator_capture"]),
  runproof: z.strictObject({ main_sha: commitSha, basis: z.string().min(1).max(500) }),
  run: runproofRunSchema,
  binding: z.strictObject({
    requirement_ids: z.array(requirementId).min(1).max(200),
    repository: repositoryId,
    commit_sha: commitSha,
    environment: z.string().min(1).max(100),
    test_level: z.enum(TEST_LEVELS),
    execution_kind: z.enum(EXECUTION_KINDS),
    runner_id: z.string().min(1).max(200).optional(),
    artifact: artifactRef,
  }),
});

/* --------------------------------------------------------------------- report */

const statusSchema = z.enum(STATUSES);
const reasonCodes = z.array(z.string().min(1).max(120));

export const adapterInfoSchema = z.strictObject({
  name: z.string(),
  version: z.number().int().min(1),
  provenance: z.enum(["native", "fixture", "operator_capture"]),
});

export const reportReceiptSchema = z.strictObject({
  receipt_id: receiptId,
  requirement_ids: z.array(requirementId),
  repository: repositoryId,
  commit_sha: commitSha,
  runner_id: z.string(),
  environment: z.string(),
  test_level: z.enum(TEST_LEVELS),
  execution_kind: z.enum(EXECUTION_KINDS),
  result: z.enum(RESULTS),
  tests: z.strictObject({ total: z.number().int(), passed: z.number().int(), failed: z.number().int(), skipped: z.number().int() }),
  artifact_path: z.string(),
  artifact_sha256: sha256Hex,
  finished_at: utcTimestamp,
  command: z.string().nullable(),
  content_sha256: sha256Hex,
  adapter: adapterInfoSchema,
  source_file: z.string(),
});

const perRepository = z.strictObject({
  repository: repositoryId,
  expected_commit_sha: commitSha,
  status: statusSchema,
  reason_codes: reasonCodes,
  receipt_ids: z.array(receiptId),
});

export const decisionSchema = z.strictObject({
  id: requirementId,
  title: z.string(),
  severity: z.enum(SEVERITIES),
  required_level: z.enum(TEST_LEVELS),
  required_environment: z.string(),
  max_age_seconds: z.number().int(),
  repositories: z.array(repositoryId),
  allowed_execution_kinds: z.array(z.enum(EXECUTION_KINDS)),
  status: statusSchema,
  /** What the evidence alone says. Differs from `status` only for DEFERRED requirements. */
  evidence_status: statusSchema,
  deferred_reason: z.string().nullable(),
  reason_codes: reasonCodes,
  /** Source receipts that decided the status. */
  receipt_ids: z.array(receiptId),
  /** Environments of the source receipts. */
  environments: z.array(z.string()),
  per_repository: z.array(perRepository),
  /** Receipts that named this requirement but were disqualified, with why. */
  rejected_receipts: z.array(z.strictObject({ receipt_id: receiptId, repository: repositoryId, reason_codes: reasonCodes })),
});

export const reportSchema = z.strictObject({
  schema_version: schemaVersion1,
  assessment_id: uuid,
  manifest_name: z.string(),
  manifest_hash: sha256Hex,
  policy_hash: sha256Hex,
  revisions_hash: sha256Hex,
  receipts_hash: sha256Hex,
  evaluated_at: utcTimestamp,
  /** Where the evaluation instant came from: `--now` (flag), PROOFGATE_NOW (env) or the system clock. */
  clock_source: z.enum(["flag", "env", "system"]),
  engine: z.strictObject({ name: z.literal("proofgate"), version: z.string(), policy_version: z.number().int() }),
  revisions: z.array(z.strictObject({ repository: repositoryId, commit_sha: commitSha })),
  verdict: z.enum(["accepted", "unsatisfied"]),
  exit_code: z.union([z.literal(0), z.literal(1)]),
  summary: z.strictObject({
    total_requirements: z.number().int(),
    mandatory_requirements: z.number().int(),
    mandatory_passed: z.number().int(),
    mandatory_unsatisfied: z.number().int(),
    by_status: z.strictObject({
      PASS: z.number().int(),
      FAIL: z.number().int(),
      STALE: z.number().int(),
      MISSING: z.number().int(),
      PARTIAL: z.number().int(),
      DEFERRED: z.number().int(),
    }),
  }),
  /** Set when this assessment replaced an earlier report in the same output location. */
  supersedes: z
    .strictObject({ assessment_id: uuid, manifest_hash: sha256Hex, policy_hash: sha256Hex, policy_changed: z.boolean() })
    .nullable(),
  input_summary: z.strictObject({
    files_scanned: z.number().int(),
    receipt_documents: z.number().int(),
    metadata_bytes: z.number().int(),
    artifact_bytes: z.number().int(),
  }),
  requirements: z.array(decisionSchema),
  receipts: z.array(reportReceiptSchema),
});
export type Report = z.infer<typeof reportSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type ReportReceipt = z.infer<typeof reportReceiptSchema>;

/* ----------------------------------------------------------------- validation */

export type DocumentKind = "manifest" | "revisions" | "receipt" | "runproof" | "report" | "bundle" | "envelope";

interface KindCodes {
  invalid: ErrorCode;
  unknownField?: ErrorCode;
  badSha?: ErrorCode;
}

const KIND_CODES: Record<DocumentKind, KindCodes> = {
  manifest: { invalid: "manifest_schema_invalid", unknownField: "manifest_unknown_field" },
  revisions: { invalid: "revisions_schema_invalid", unknownField: "revisions_unknown_field", badSha: "revisions_invalid_commit_sha" },
  receipt: { invalid: "receipt_schema_invalid", unknownField: "receipt_unknown_field", badSha: "receipt_invalid_commit_sha" },
  runproof: { invalid: "runproof_schema_invalid", unknownField: "runproof_unknown_field", badSha: "runproof_invalid_commit_sha" },
  report: { invalid: "report_invalid" },
  bundle: { invalid: "bundle_invalid_header" },
  envelope: { invalid: "envelope_schema_invalid", unknownField: "envelope_unknown_field" },
};

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Rejects an unsupported major version before any other validation so that a
 * future document is never half-read. Throws on rejection.
 */
export function assertSupportedVersion(raw: unknown, kind: DocumentKind, label: string): void {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const version = (raw as Record<string, unknown>).schema_version;
  if (typeof version === "number" && Number.isInteger(version) && version !== SCHEMA_VERSION) {
    throw new ProofGateError(
      "unsupported_schema_version",
      `${label} declares schema_version ${version}; this ProofGate reads only schema_version ${SCHEMA_VERSION}`,
      { document: kind, found: version, supported: [SCHEMA_VERSION] },
    );
  }
}

/**
 * Validate an untrusted value. Unknown fields are rejected (never silently
 * dropped); the only free-form area is the namespaced `extensions` object.
 */
export function parseDocument<S extends z.ZodType>(schema: S, raw: unknown, kind: DocumentKind, label: string): z.infer<S> {
  assertSupportedVersion(raw, kind, label);
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const codes = KIND_CODES[kind];
  const issues = result.error.issues;
  const badSha = issues.some((i) => i.path[i.path.length - 1] === "commit_sha" || i.path[i.path.length - 1] === "main_sha");
  const unknownKey = issues.some((i) => i.code === "unrecognized_keys");
  let code = codes.invalid;
  if (badSha && codes.badSha) code = codes.badSha;
  else if (unknownKey && codes.unknownField) code = codes.unknownField;
  throw new ProofGateError(code, `${label} is invalid: ${formatIssues(result.error)}`, {
    document: kind,
    issues: issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}
