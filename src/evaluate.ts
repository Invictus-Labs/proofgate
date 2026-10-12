import { compareStrings, hashCanonical, uuidFromHash } from "./canonical.js";
import type { LoadedManifest } from "./manifest.js";
import { computeReceiptsHash, type LoadedReceipt } from "./receipt.js";
import type { LoadedRevisions } from "./revisions.js";
import { REPORT_IDENTIFIER_LIST_PATHS, redactDocument } from "./identifiers.js";
import {
  LEVEL_RANK,
  STATUSES,
  type Decision,
  type NormalizedRequirement,
  type Report,
  type Status,
} from "./schemas.js";
import { POLICY_ENGINE_VERSION, PROOFGATE_VERSION, SCHEMA_VERSION } from "./version.js";

/**
 * The decision engine. Everything in this file is a pure function of already
 * validated inputs and an injected clock: no I/O, no environment, no network.
 *
 * Status semantics (see docs/INTERFACES.md):
 *   PASS      every declared repository has fresh, qualifying, fully passing evidence
 *   FAIL      qualifying fresh evidence contains a failure
 *   STALE     the only qualifying evidence is at or beyond max_age_seconds
 *   MISSING   no qualifying evidence, or only zero-test pass claims
 *   PARTIAL   skipped/partial results, or only some repositories are covered
 *   DEFERRED  the manifest defers the requirement; never satisfies a mandatory gate
 * Uncertainty never becomes success: only PASS on every mandatory requirement
 * yields exit 0.
 */

type EvidenceStatus = "PASS" | "FAIL" | "PARTIAL" | "MISSING" | "STALE";

interface Classified {
  loaded: LoadedReceipt;
  status: EvidenceStatus;
  reasons: string[];
}

const byString = compareStrings;
const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(byString);

/** Why a receipt that names the requirement cannot count for it (empty = it qualifies). */
export function disqualifiers(
  req: NormalizedRequirement,
  expectedSha: string,
  loaded: LoadedReceipt,
  nowMs: number,
): string[] {
  const r = loaded.receipt;
  const reasons: string[] = [];
  if (r.commit_sha !== expectedSha) reasons.push("revision_mismatch");
  if (r.environment !== req.required_environment) reasons.push("environment_mismatch");
  if (LEVEL_RANK[r.test_level] < LEVEL_RANK[req.required_level]) reasons.push("level_insufficient");
  if (!req.allowed_execution_kinds.includes(r.execution_kind)) reasons.push("execution_kind_not_allowed");
  if (Date.parse(r.finished_at) > nowMs) reasons.push("receipt_from_future");
  return reasons;
}

/** Classify a receipt that already qualifies on identity. Freshness is applied first. */
export function classifyEvidence(req: NormalizedRequirement, loaded: LoadedReceipt, nowMs: number): Classified {
  const r = loaded.receipt;
  const ageMs = nowMs - Date.parse(r.finished_at);
  // At exactly max_age_seconds the evidence is STALE: only strictly younger evidence is fresh.
  if (ageMs >= req.max_age_seconds * 1000) return { loaded, status: "STALE", reasons: ["evidence_stale"] };

  const t = r.tests;
  const reasons: string[] = [];
  // A failure is a failure whatever the counts say: a receipt that reports result "fail" with zero tests must not be
  // downgraded to "no evidence" (which is ignored beside a passing receipt). Only a pass claim with zero tests is MISSING.
  if (t.failed > 0 || r.result === "fail") {
    reasons.push(t.failed > 0 ? "tests_failed" : "result_failed");
    if (r.result === "pass") reasons.push("result_contradicts_counts");
    return { loaded, status: "FAIL", reasons };
  }
  if (t.skipped > 0) reasons.push("tests_skipped");
  if (r.result === "partial") reasons.push("partial_result");
  if (r.result === "skipped") reasons.push("suite_skipped");
  if (t.total === 0) {
    // Zero tests that claim pass are ignorable (MISSING). Zero tests that claim partial/skipped are an incomplete run.
    if (reasons.length > 0) return { loaded, status: "PARTIAL", reasons: ["zero_tests", ...reasons] };
    return { loaded, status: "MISSING", reasons: ["zero_tests"] };
  }
  if (reasons.length > 0 || t.passed < t.total) return { loaded, status: "PARTIAL", reasons };
  return { loaded, status: "PASS", reasons: ["all_criteria_met"] };
}

interface RepoOutcome {
  status: EvidenceStatus;
  reasons: string[];
  receiptIds: string[];
  rejected: Array<{ receipt_id: string; repository: string; reason_codes: string[] }>;
}

function decideRepository(
  req: NormalizedRequirement,
  repository: string,
  expectedSha: string,
  named: LoadedReceipt[],
  nowMs: number,
): RepoOutcome {
  const forRepo = named.filter((l) => l.receipt.repository === repository);
  const rejected: RepoOutcome["rejected"] = [];
  const evidence: Classified[] = [];
  for (const loaded of forRepo) {
    const why = disqualifiers(req, expectedSha, loaded, nowMs);
    if (why.length === 1 && why[0] === "receipt_from_future") {
      // Future-dated rule: a receipt that finished after the evaluation time never counts as passing evidence, but if it
      // otherwise qualifies (repository, SHA, environment, level, execution kind) and reports a failure or a partial
      // run it still blocks. Clock skew must not let an older pass hide a newer failure.
      const held = classifyEvidence(req, loaded, nowMs);
      if (held.status === "FAIL" || held.status === "PARTIAL") {
        evidence.push({ ...held, reasons: uniqueSorted([...held.reasons, "receipt_from_future"]) });
        continue;
      }
    }
    if (why.length > 0) rejected.push({ receipt_id: loaded.receipt.receipt_id, repository, reason_codes: uniqueSorted(why) });
    else evidence.push(classifyEvidence(req, loaded, nowMs));
  }

  const ids = (items: Classified[]) => items.map((c) => c.loaded.receipt.receipt_id).sort(byString);
  const reasonsOf = (items: Classified[]) => uniqueSorted(items.flatMap((c) => c.reasons));

  const fresh = evidence.filter((c) => c.status !== "STALE");
  const substantive = fresh.filter((c) => c.status !== "MISSING");
  if (substantive.length > 0) {
    const failing = substantive.filter((c) => c.status === "FAIL");
    if (failing.length > 0) {
      const reasons = reasonsOf(failing);
      if (substantive.some((c) => c.status === "PASS")) reasons.push("conflicting_evidence");
      return { status: "FAIL", reasons: uniqueSorted(reasons), receiptIds: ids(failing), rejected };
    }
    const partial = substantive.filter((c) => c.status === "PARTIAL");
    if (partial.length > 0) return { status: "PARTIAL", reasons: reasonsOf(partial), receiptIds: ids(partial), rejected };
    return { status: "PASS", reasons: reasonsOf(substantive), receiptIds: ids(substantive), rejected };
  }
  if (fresh.length > 0) return { status: "MISSING", reasons: reasonsOf(fresh), receiptIds: ids(fresh), rejected };
  const stale = evidence.filter((c) => c.status === "STALE");
  if (stale.length > 0) return { status: "STALE", reasons: reasonsOf(stale), receiptIds: ids(stale), rejected };
  return {
    status: "MISSING",
    reasons: [forRepo.length === 0 ? "no_receipt" : "no_qualifying_receipt", ...uniqueSorted(rejected.flatMap((r) => r.reason_codes))],
    receiptIds: [],
    rejected,
  };
}

/** Combine per-repository statuses into the requirement's evidence status. */
export function combineStatuses(statuses: EvidenceStatus[]): EvidenceStatus {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.every((s) => s === "PASS")) return "PASS";
  if (statuses.includes("PARTIAL")) return "PARTIAL";
  if (statuses.includes("PASS")) return "PARTIAL";
  if (statuses.includes("STALE")) return "STALE";
  return "MISSING";
}

/** Receipts grouped by the requirement ids they name, built once so assessing N requirements is not N scans of every receipt. */
export function indexReceiptsByRequirement(receipts: LoadedReceipt[]): Map<string, LoadedReceipt[]> {
  const index = new Map<string, LoadedReceipt[]>();
  for (const loaded of receipts) {
    for (const id of new Set(loaded.receipt.requirement_ids)) {
      const list = index.get(id);
      if (list === undefined) index.set(id, [loaded]);
      else list.push(loaded);
    }
  }
  return index;
}

export function decideRequirement(
  req: NormalizedRequirement,
  receipts: LoadedReceipt[],
  revisions: LoadedRevisions,
  nowMs: number,
  index?: Map<string, LoadedReceipt[]>,
): Decision {
  const named = index === undefined ? receipts.filter((l) => l.receipt.requirement_ids.includes(req.id)) : (index.get(req.id) ?? []);
  const rejected: Decision["rejected_receipts"] = [];

  // Receipts for a repository the requirement does not cover never count.
  for (const loaded of named) {
    if (!req.repositories.includes(loaded.receipt.repository)) {
      rejected.push({ receipt_id: loaded.receipt.receipt_id, repository: loaded.receipt.repository, reason_codes: ["repository_not_required"] });
    }
  }

  const perRepository = req.repositories.map((repository) => {
    const expected = revisions.byRepository.get(repository) as string;
    const outcome = decideRepository(req, repository, expected, named, nowMs);
    rejected.push(...outcome.rejected);
    return { repository, expected_commit_sha: expected, outcome };
  });

  const evidenceStatus = combineStatuses(perRepository.map((p) => p.outcome.status));
  const reasons = new Set(perRepository.flatMap((p) => p.outcome.reasons));
  // "all_criteria_met" describes a fully passing requirement; a repository that passed inside a FAIL, PARTIAL, STALE
  // or MISSING requirement keeps it in its own per-repository entry, but the requirement-level list must not claim it.
  if (evidenceStatus !== "PASS") reasons.delete("all_criteria_met");
  if (evidenceStatus === "PARTIAL" && perRepository.some((p) => p.outcome.status === "PASS")) {
    reasons.add("incomplete_repository_coverage");
  }

  const receiptIds = uniqueSorted(perRepository.flatMap((p) => p.outcome.receiptIds));
  const idSet = new Set(receiptIds);
  const sourceReceipts = named.filter((l) => idSet.has(l.receipt.receipt_id));
  const deferred = req.deferred !== undefined;

  return {
    id: req.id,
    title: req.title,
    severity: req.severity,
    required_level: req.required_level,
    required_environment: req.required_environment,
    max_age_seconds: req.max_age_seconds,
    repositories: [...req.repositories],
    allowed_execution_kinds: [...req.allowed_execution_kinds],
    status: deferred ? "DEFERRED" : evidenceStatus,
    evidence_status: evidenceStatus,
    deferred_reason: req.deferred?.reason ?? null,
    reason_codes: uniqueSorted(deferred ? [...reasons, "requirement_deferred"] : reasons),
    receipt_ids: receiptIds,
    environments: uniqueSorted(sourceReceipts.map((l) => l.receipt.environment)),
    per_repository: perRepository.map((p) => ({
      repository: p.repository,
      expected_commit_sha: p.expected_commit_sha,
      status: p.outcome.status,
      reason_codes: uniqueSorted(p.outcome.reasons),
      receipt_ids: p.outcome.receiptIds,
    })),
    rejected_receipts: rejected.sort((a, b) => byString(a.receipt_id, b.receipt_id) || byString(a.repository, b.repository)),
  };
}

export interface AssessmentInput {
  manifest: LoadedManifest;
  revisions: LoadedRevisions;
  receipts: LoadedReceipt[];
  now: Date;
  inputSummary: Report["input_summary"];
  supersedes?: Report["supersedes"];
  /** Where `now` came from; defaults to "system" for library callers that pass the real clock. */
  clockSource?: Report["clock_source"];
}

/** Build the full, immutable assessment. Deterministic for fixed inputs and a fixed clock. */
export function assess(input: AssessmentInput): Report {
  const { manifest, revisions, receipts, now } = input;
  const nowMs = now.getTime();
  const evaluatedAt = now.toISOString();
  const receiptsHash = computeReceiptsHash(receipts);

  const index = indexReceiptsByRequirement(receipts);
  const requirements = manifest.manifest.requirements.map((req) => decideRequirement(req, receipts, revisions, nowMs, index));

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const d of requirements) byStatus[d.status] += 1;
  const mandatory = requirements.filter((d) => d.severity === "mandatory");
  const mandatoryPassed = mandatory.filter((d) => d.status === "PASS").length;
  const accepted = mandatory.length > 0 && mandatoryPassed === mandatory.length;

  const report: Report = {
    schema_version: SCHEMA_VERSION,
    assessment_id: uuidFromHash(
      hashCanonical({
        manifest_hash: manifest.manifest_hash,
        policy_hash: manifest.policy_hash,
        revisions_hash: revisions.revisions_hash,
        receipts_hash: receiptsHash,
        evaluated_at: evaluatedAt,
      }),
    ),
    manifest_name: manifest.manifest.name,
    manifest_hash: manifest.manifest_hash,
    policy_hash: manifest.policy_hash,
    revisions_hash: revisions.revisions_hash,
    receipts_hash: receiptsHash,
    evaluated_at: evaluatedAt,
    clock_source: input.clockSource ?? "system",
    engine: { name: "proofgate", version: PROOFGATE_VERSION, policy_version: POLICY_ENGINE_VERSION },
    revisions: revisions.revisions.map((r) => ({ ...r })),
    verdict: accepted ? "accepted" : "unsatisfied",
    exit_code: accepted ? 0 : 1,
    summary: {
      total_requirements: requirements.length,
      mandatory_requirements: mandatory.length,
      mandatory_passed: mandatoryPassed,
      mandatory_unsatisfied: mandatory.length - mandatoryPassed,
      by_status: byStatus,
    },
    supersedes: input.supersedes ?? null,
    input_summary: input.inputSummary,
    requirements,
    receipts: receipts.map((l) => ({
      receipt_id: l.receipt.receipt_id,
      requirement_ids: [...l.receipt.requirement_ids],
      repository: l.receipt.repository,
      commit_sha: l.receipt.commit_sha,
      runner_id: l.receipt.runner_id,
      environment: l.receipt.environment,
      test_level: l.receipt.test_level,
      execution_kind: l.receipt.execution_kind,
      result: l.receipt.result,
      tests: { ...l.receipt.tests },
      artifact_path: l.receipt.artifact.path,
      artifact_sha256: l.receipt.artifact.sha256,
      finished_at: l.receipt.finished_at,
      command: l.receipt.command,
      content_sha256: l.content_sha256,
      adapter: { ...l.adapter },
      source_file: l.source_file,
    })),
  };
  // Inputs were redacted at load time; this final pass is a belt-and-braces guarantee for the exported document.
  return redactDocument(report, REPORT_IDENTIFIER_LIST_PATHS);
}
