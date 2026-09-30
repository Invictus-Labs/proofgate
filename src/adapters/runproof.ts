import { ProofGateError } from "../errors.js";
import { parseDocument, runproofDocumentSchema, type Receipt } from "../schemas.js";
import type { AdapterOutput } from "./types.js";

export const RUNPROOF_FORMAT = "runproof.run-detail";

/**
 * Optional RunProof importer.
 *
 * Provenance note (pinned in docs/ADAPTERS.md): the public RunProof main branch
 * publishes no evidence-export endpoint or file format. The only published,
 * versioned shape that carries per-check outcomes is the response of
 * `GET /api/v1/runs/:id` (run row plus `checks`). This adapter therefore reads
 * a wrapper document that embeds that response verbatim as `run`, together with
 * an operator-declared `binding` that supplies what RunProof does not know
 * (repository, full commit SHA, environment, test level, artifact). Nothing here
 * talks to a RunProof server.
 *
 * Trust rules:
 *   - `source_kind: "fixture"` is always imported as `synthetic` evidence, so a
 *     live-required requirement rejects it regardless of the binding;
 *   - a run that claims `verified` while a required check is not `pass` is
 *     rejected outright (`runproof_outcome_mismatch`);
 *   - a run without `finished_at` is not evidence (`runproof_run_unfinished`);
 *   - only a run with `execution_status: "succeeded"` and no non-zero `exit_code` can pass: `failed` (or a non-zero
 *     exit code) is a failure, `running`/`missing` are rejected (`runproof_execution_incomplete`); an `exit_code` that is
 *     present but not an integer or null (a string, a boolean, an object, an array) is `runproof_schema_invalid`;
 *   - only the checks of the LATEST evaluation count (a re-evaluation supersedes earlier ones, as RunProof itself
 *     reports `current_evaluation`); earlier evaluations are preserved verbatim under `extensions.runproof.checks`;
 *   - run fields ProofGate does not map are preserved verbatim under
 *     `extensions.runproof.unmapped_run_fields`, never dropped.
 */

/**
 * Names of a run field that carry an exit status or a verdict, compared after removing everything but letters and digits and folding
 * the case (`exit code`, `exit.code`, `Exit-Status`, `returncode`, `status `, `verdict`, `result`, `success`, `ok`, `failed`, `passed`,
 * `state`, and the words that say how a run ended or how many checks did: `conclusion`, `exit_signal`, `error`, `errors`, `success_count`, ...). The importer reads only the exact keys
 * `exit_code` and `exitCode` and `execution_status`, so a run that carries any other spelling of a verdict would be imported as a pass: it is refused. This is a list of names, not
 * a proof: a verdict under a name that is not on it, and not one of RunProof's own run fields, is kept under `unmapped_run_fields` as data and never read.
 */
const VERDICT_LIKE = new Set([
  "exit", "exitcode", "exitstatus", "exitsignal", "signal", "returncode", "returnstatus", "status", "verdict", "result", "conclusion", "outcomestatus", "success", "ok", "failed", "passed", "state",
  "error", "errors", "exception", "crashed", "timedout", "cancelled", "canceled", "aborted",
  "successcount", "failurecount", "failedcount", "failcount", "passcount", "passedcount", "errorcount",
]);
const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const MAPPED_RUN_FIELDS = new Set(["id", "external_run_id", "execution_status", "outcome", "finished_at", "checks"]);

export function adaptRunproofDocument(raw: unknown, label: string): AdapterOutput {
  // A run field literally named "__proto__" (JSON.parse creates it as an own property) cannot be preserved under
  // unmapped_run_fields by plain assignment, which would set the prototype and silently drop it: refuse it instead.
  const rawRun = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>).run : undefined;
  if (rawRun !== null && typeof rawRun === "object" && Object.hasOwn(rawRun, "__proto__")) {
    throw new ProofGateError("runproof_schema_invalid", `${label}: the run object has a field named "__proto__", which cannot be preserved; remove it`);
  }
  // The same holds for every check: the schema keeps unknown check fields, and a "__proto__" key is dropped by it without a word.
  const rawChecks = rawRun !== null && typeof rawRun === "object" ? (rawRun as Record<string, unknown>).checks : undefined;
  if (Array.isArray(rawChecks) && rawChecks.some((check) => check !== null && typeof check === "object" && Object.hasOwn(check, "__proto__"))) {
    throw new ProofGateError("runproof_schema_invalid", `${label}: a check has a field named "__proto__", which cannot be preserved; remove it`);
  }
  const doc = parseDocument(runproofDocumentSchema, raw, "runproof", label);
  const { run, binding } = doc;

  // Only `exit_code` and `exitCode` are read. Any other spelling of an exit status (`exit_status`, `exitcode`, `returncode`, ...)
  // would be skipped and the run imported as a pass, so it is refused.
  // A plain `status` (`status: "failed"` beside `execution_status: "succeeded"`) is refused for the same reason: RunProof's own run
  // has `execution_status` and no `status`, so an extra `status` is a verdict this importer would not read.
  const otherExit = Object.keys(run).find((key) => key !== "exit_code" && key !== "exitCode" && VERDICT_LIKE.has(normaliseKey(key)));
  if (otherExit !== undefined) {
    throw new ProofGateError(
      "runproof_schema_invalid",
      `${label}: the run has a field "${otherExit}" that looks like an exit status or a verdict; only "exit_code", "exitCode" and "execution_status" are read, so this run cannot be judged`,
    );
  }

  if (run.finished_at === null) {
    throw new ProofGateError("runproof_run_unfinished", `${label}: RunProof run ${run.id} has no finished_at; an unfinished run is not evidence`);
  }

  const latest = run.checks.reduce((max, check) => Math.max(max, check.evaluation), 0);
  const required = run.checks.filter((check) => check.required && check.evaluation === latest);
  // A required definition that an EARLIER evaluation held and the latest one does not is not "superseded": it is missing, and
  // it may be the one that failed. Refuse instead of importing the remaining definitions as a pass.
  const latestDefinitions = new Set(required.map((check) => check.definition_id));
  const dropped = run.checks.find((check) => check.required && check.evaluation < latest && !latestDefinitions.has(check.definition_id));
  if (dropped !== undefined) {
    throw new ProofGateError(
      "runproof_outcome_mismatch",
      `${label}: required check definition "${dropped.definition_id}" was part of evaluation ${dropped.evaluation} and is absent from the latest evaluation ${latest}; the run cannot be judged from the latest evaluation alone`,
    );
  }
  const passed = required.filter((c) => c.state === "pass").length;
  const failed = required.filter((c) => c.state === "fail").length;
  const skipped = required.length - passed - failed;

  if (run.outcome === "verified" && (failed > 0 || skipped > 0)) {
    throw new ProofGateError(
      "runproof_outcome_mismatch",
      `${label}: RunProof run ${run.id} reports outcome "verified" but ${failed + skipped} required check(s) are not pass`,
    );
  }

  // The run itself must have succeeded. A run that is still running, or whose result is unknown ("missing"), is not
  // evidence at all; a failed run (or a non-zero exit code, when one is recorded) is a failure whatever the checks say.
  if (run.execution_status === "running" || run.execution_status === "missing") {
    throw new ProofGateError(
      "runproof_execution_incomplete",
      `${label}: RunProof run ${run.id} has execution_status "${run.execution_status}"; only a run that succeeded or failed is evidence`,
    );
  }
  // The schema guarantees that a recorded exit code (either spelling) is an integer or null.
  const exitFailed = [run.exit_code, run.exitCode].some((code) => typeof code === "number" && code !== 0);
  const executionFailed = run.execution_status === "failed" || exitFailed;

  const result: Receipt["result"] = executionFailed || run.outcome === "failed" || failed > 0
    ? "fail"
    : required.length === 0
      ? "skipped"
      : run.outcome !== "verified" || skipped > 0
        ? "partial"
        : "pass";

  const fixture = doc.source_kind === "fixture";
  const unmapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(run)) {
    if (!MAPPED_RUN_FIELDS.has(key)) unmapped[key] = value;
  }

  const receipt: Receipt = {
    receipt_id: run.id,
    requirement_ids: [...new Set(binding.requirement_ids)].sort(),
    repository: binding.repository,
    commit_sha: binding.commit_sha,
    runner_id: binding.runner_id ?? "runproof",
    environment: binding.environment,
    test_level: binding.test_level,
    execution_kind: fixture ? "synthetic" : binding.execution_kind,
    result,
    tests: { total: required.length, passed, failed, skipped },
    artifact: { path: binding.artifact.path, sha256: binding.artifact.sha256 },
    finished_at: run.finished_at,
    command: null,
    extensions: {
      runproof: {
        main_sha: doc.runproof.main_sha,
        basis: doc.runproof.basis,
        source_kind: doc.source_kind,
        external_run_id: run.external_run_id,
        execution_status: run.execution_status,
        outcome: run.outcome,
        evaluation: latest,
        declared_execution_kind: binding.execution_kind,
        execution_kind_overridden: fixture && binding.execution_kind !== "synthetic",
        checks: run.checks,
        unmapped_run_fields: unmapped,
      },
    },
  };
  return {
    receipt,
    adapter: { name: RUNPROOF_FORMAT, version: 1, provenance: doc.source_kind },
  };
}
