import { ProofGateError } from "./errors.js";
import { describeReason } from "./reasons.js";
import type { Decision, Report } from "./schemas.js";
import { neutralize as t } from "./terminal.js";

export function findDecision(report: Report, requirementId: string): Decision {
  const exact = report.requirements.find((d) => d.id === requirementId);
  if (exact) return exact;
  throw new ProofGateError("explain_unknown_requirement", `requirement "${t(requirementId)}" is not in this report`, {
    known: report.requirements.map((d) => d.id).slice(0, 50),
  });
}

/**
 * Plain-text explanation: status, reasons, source receipts, rejected receipts. Every value that came from a document is
 * neutralised (`t`) so a hostile receipt cannot inject terminal escapes or forge lines (see src/terminal.ts).
 */
export function explainRequirement(report: Report, requirementId: string): string {
  const d = findDecision(report, requirementId);
  const byId = new Map(report.receipts.map((r) => [r.receipt_id, r]));
  const lines: string[] = [];
  lines.push(`${t(d.id)}  ${t(d.status)}  (${t(d.severity)})`);
  lines.push(`title: ${t(d.title)}`);
  lines.push(`assessment: ${t(report.assessment_id)} at ${t(report.evaluated_at)}`);
  lines.push(
    `required: level>=${t(d.required_level)}, environment=${t(d.required_environment)}, max_age_seconds=${t(d.max_age_seconds)}, execution kinds=${d.allowed_execution_kinds.map(t).join(",")}`,
  );
  if (d.status === "DEFERRED") {
    lines.push(`deferred: ${t(d.deferred_reason ?? "")}`);
    lines.push(`evidence alone would say: ${t(d.evidence_status)}`);
  }
  lines.push("reason codes:");
  for (const code of d.reason_codes) lines.push(`  ${t(code)}  ${describeReason(code)}`);
  lines.push("per repository:");
  for (const p of d.per_repository) {
    lines.push(`  ${t(p.repository)}  expected ${t(p.expected_commit_sha)}  ${t(p.status)}  [${p.reason_codes.map(t).join(", ")}]`);
  }
  lines.push(d.receipt_ids.length === 0 ? "source receipts: none" : "source receipts:");
  for (const id of d.receipt_ids) {
    const r = byId.get(id);
    lines.push(
      r === undefined
        ? `  ${t(id)}`
        : `  ${t(id)}  ${t(r.repository)}@${t(r.commit_sha)}  ${t(r.environment)}/${t(r.test_level)}/${t(r.execution_kind)}  ${t(r.result)}  finished ${t(r.finished_at)}  runner ${t(r.runner_id)}`,
    );
  }
  if (d.rejected_receipts.length > 0) {
    lines.push("rejected receipts:");
    for (const rej of d.rejected_receipts) lines.push(`  ${t(rej.receipt_id)}  ${t(rej.repository)}  [${rej.reason_codes.map(t).join(", ")}]`);
  }
  return `${lines.join("\n")}\n`;
}
