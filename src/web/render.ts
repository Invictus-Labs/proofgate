import { createHash } from "node:crypto";
import { STATUSES, type Decision, type Report, type ReportReceipt } from "../schemas.js";
import { EXIT_CODES, STATUS_INFO, explainReason, nextStepForReason, statusInfo } from "./guidance.js";
import { html, join, raw, type Safe } from "./safe-html.js";
import { REPORT_CSS } from "./styles.js";

/**
 * Static HTML acceptance report (the `renderReportHtml` hook of docs/INTERFACES.md).
 *
 * Properties:
 *  - self-contained: one inline stylesheet, no script, no external resource, no fonts, no links to artifact URLs;
 *    a strict CSP meta tag pins the stylesheet by hash and forbids everything else, so it works from file://;
 *  - every report string reaches the markup only through `html`/`text` (see safe-html.ts), i.e. through `escapeHtml`;
 *    attribute values are constants or counters, never report data;
 *  - deterministic: no clock, randomness, locale or environment input; the same report is byte-identical HTML;
 *  - uncertainty never looks like success: only a consistent report whose mandatory requirements are all PASS is
 *    shown as ACCEPTED; everything else reads "no accepted result".
 */

const MANDATORY = "mandatory";
const STYLE_HASH = `sha256-${createHash("sha256").update(REPORT_CSS).digest("base64")}`;

/** Exported so tests and QA can verify the policy that ships in every report. */
export const CONTENT_SECURITY_POLICY = `default-src 'none'; style-src '${STYLE_HASH}'; img-src 'none'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`;

/* ------------------------------------------------------------------ verdict */

export type VerdictKind = "accepted" | "unsatisfied" | "inconsistent" | "empty";

export interface VerdictAssessment {
  kind: VerdictKind;
  mandatory: number;
  mandatoryPassed: number;
  /** Why an inconsistent report is not trusted. */
  problems: string[];
}

/**
 * Cross-check the report's verdict, exit code and summary against its own decisions. The renderer
 * only says ACCEPTED when every signal agrees; any disagreement downgrades to "no accepted result".
 */
export function assessVerdict(report: Report): VerdictAssessment {
  const decisions = report.requirements;
  const mandatory = decisions.filter((d) => d.severity === MANDATORY);
  const mandatoryPassed = mandatory.filter((d) => d.status === "PASS").length;
  const base = { mandatory: mandatory.length, mandatoryPassed };
  if (decisions.length === 0) return { kind: "empty", ...base, problems: [] };

  const problems: string[] = [];
  const allPass = mandatory.length > 0 && mandatoryPassed === mandatory.length;
  const claimsAccepted = report.verdict === "accepted" && report.exit_code === 0;
  const claimsUnsatisfied = report.verdict === "unsatisfied" && report.exit_code === 1;
  if (!claimsAccepted && !claimsUnsatisfied) {
    problems.push(`verdict "${String(report.verdict)}" and exit code ${String(report.exit_code)} are not a matching pair`);
  } else if (claimsAccepted && !allPass) {
    problems.push("the report claims acceptance but a mandatory requirement is not PASS (or none exists)");
  } else if (claimsUnsatisfied && allPass) {
    problems.push("the report claims unsatisfied but every mandatory requirement is PASS");
  }

  const s = report.summary;
  if (
    s.total_requirements !== decisions.length ||
    s.mandatory_requirements !== mandatory.length ||
    s.mandatory_passed !== mandatoryPassed ||
    s.mandatory_unsatisfied !== mandatory.length - mandatoryPassed ||
    STATUSES.some((status) => s.by_status[status] !== decisions.filter((d) => d.status === status).length)
  ) {
    problems.push("the summary counts do not match the requirement decisions");
  }

  if (problems.length > 0) return { kind: "inconsistent", ...base, problems };
  return { kind: claimsAccepted ? "accepted" : "unsatisfied", ...base, problems };
}

/* ------------------------------------------------------------------ helpers */

/** `90061` becomes `1 d 1 h 1 min 1 s`. Deterministic integer arithmetic, no locale. */
export function duration(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 0) return String(seconds);
  if (seconds === 0) return "0 s";
  const parts: string[] = [];
  let rest = seconds;
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["min", 60], ["s", 1]] as const) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${unit}`);
  }
  return parts.join(" ");
}

function relativeToEvaluation(finishedAt: string, evaluatedAt: string): string {
  const diff = (Date.parse(evaluatedAt) - Date.parse(finishedAt)) / 1000;
  if (!Number.isFinite(diff)) return "age unknown";
  return diff < 0 ? `${duration(-Math.round(diff))} after the evaluation time` : `${duration(Math.round(diff))} before the evaluation time`;
}

function badge(status: unknown): Safe {
  const info = statusInfo(status);
  const label = info.label ?? `UNKNOWN: ${String(status)}`;
  return html`<span class="badge tone-${info.key}"><span class="sym" aria-hidden="true">${info.symbol}</span> ${label}</span>`;
}

function codeList(values: string[], none: string): Safe {
  if (values.length === 0) return html`<span class="muted">${none}</span>`;
  return join(values.map((v) => html`<code>${v}</code>`), ", ");
}

function reasonList(codes: string[]): Safe {
  if (codes.length === 0) return html`<span class="muted">No reason code recorded.</span>`;
  return html`<ul class="plain">${codes.map((c) => html`<li><code>${c}</code><br>${explainReason(c)}</li>`)}</ul>`;
}

function nextSteps(decision: Decision): string[] {
  const steps: string[] = [];
  const add = (step: string): void => {
    if (!steps.includes(step)) steps.push(step);
  };
  const info = statusInfo(decision.status);
  if (decision.status === "DEFERRED") add(STATUS_INFO.DEFERRED.nextStep);
  for (const code of decision.reason_codes) {
    if (code === "all_criteria_met" && decision.status !== "PASS") continue;
    add(nextStepForReason(code));
  }
  if (steps.length === 0) add(info.nextStep);
  return steps;
}

const kindLabel = (kind: unknown): Safe =>
  kind === "live"
    ? html`live`
    : kind === "mocked" || kind === "synthetic"
      ? html`<span class="tag tone-notice">${String(kind).toUpperCase()}: not live evidence</span>`
      : html`<span class="tag tone-unknown">UNKNOWN: ${String(kind)}</span>`;

function kinds(values: string[]): Safe {
  return join(values.map(kindLabel), ", ");
}

interface Row {
  decision: Decision;
  n: number;
}

/** Mandatory requirements first, then the rest; manifest order is preserved inside each group. */
function orderedRows(report: Report): Row[] {
  const first = report.requirements.filter((d) => d.severity === MANDATORY);
  const rest = report.requirements.filter((d) => d.severity !== MANDATORY);
  return [...first, ...rest].map((decision, i) => ({ decision, n: i + 1 }));
}

const severityTag = (severity: unknown): Safe =>
  severity === MANDATORY ? html`<span class="tag strong">MANDATORY</span>` : html`<span class="tag">${String(severity).toUpperCase()}</span>`;

/* ----------------------------------------------------------------- sections */

function verdictSection(report: Report, verdict: VerdictAssessment, rows: Row[]): Safe {
  const advisoryOpen = rows.filter((r) => r.decision.severity !== MANDATORY && r.decision.status !== "PASS").length;
  let tone: string;
  let symbol: string;
  let headline: string;
  let body: Safe;
  switch (verdict.kind) {
    case "accepted":
      tone = "pass";
      symbol = "✓";
      headline = "ACCEPTED";
      body = html`<p>Verdict <strong>accepted</strong>, exit code <strong>0</strong>: all ${verdict.mandatory} mandatory requirements are PASS for the revisions listed below.</p>${
        advisoryOpen > 0
          ? html`<p>${advisoryOpen} advisory requirement(s) are not PASS. They do not block acceptance and stay listed below.</p>`
          : ""
      }`;
      break;
    case "unsatisfied":
      tone = "fail";
      symbol = "✗";
      headline = "NO ACCEPTED RESULT";
      body =
        verdict.mandatory === 0
          ? html`<p>Verdict <strong>unsatisfied</strong>, exit code <strong>${report.exit_code}</strong>: the report contains no mandatory requirement, so nothing can be accepted.</p>`
          : html`<p>Verdict <strong>unsatisfied</strong>, exit code <strong>${report.exit_code}</strong>: ${verdict.mandatory - verdict.mandatoryPassed} of ${verdict.mandatory} mandatory requirements are not PASS, so this delivery is not accepted. Uncertain states (STALE, MISSING, PARTIAL, DEFERRED) count as not accepted.</p>`;
      break;
    case "inconsistent":
      tone = "fail";
      symbol = "!";
      headline = "NO ACCEPTED RESULT (report inconsistent)";
      body = html`<p>This report contradicts itself, so it is treated as not accepted regardless of its stated verdict (<code>${report.verdict}</code>, exit code <code>${report.exit_code}</code>). Run <code>proofgate evaluate</code> again and use the fresh report.</p><ul>${verdict.problems.map((p) => html`<li>${p}</li>`)}</ul>`;
      break;
    default:
      tone = "notice";
      symbol = "○";
      headline = "NO ACCEPTED RESULT (nothing evaluated)";
      body = html`<p>This report contains no requirements, so there is nothing to accept. An empty policy never counts as success; check the manifest and evaluate again.</p>`;
  }
  const open = rows.filter((r) => r.decision.severity === MANDATORY && r.decision.status !== "PASS");
  return html`<section id="verdict" class="verdict tone-${tone}" aria-labelledby="verdict-h">
<h2 id="verdict-h"><span aria-hidden="true">${symbol}</span> ${headline}</h2>
${body}
${
  open.length === 0
    ? ""
    : html`<p><strong>Mandatory requirements that are not PASS:</strong></p><ol>${open.map(
        (r) => html`<li><a href="#req-${r.n}"><code>${r.decision.id}</code></a> ${badge(r.decision.status)} ${nextSteps(r.decision)[0]}</li>`,
      )}</ol>`
}
</section>
<section aria-labelledby="exit-h">
<h2 id="exit-h">Exit code meaning</h2>
<div class="scroll"><table>
<caption>Exit codes of <code>proofgate evaluate</code></caption>
<thead><tr><th scope="col">Code</th><th scope="col">Meaning</th><th scope="col">This report</th></tr></thead>
<tbody>${EXIT_CODES.map(
    (e) =>
      html`<tr><th scope="row">${e.code}</th><td>${e.meaning}</td><td>${verdict.kind !== "inconsistent" && report.exit_code === e.code ? html`<strong>Yes</strong>` : html`<span class="muted">No</span>`}</td></tr>`,
  )}</tbody>
</table></div>
</section>`;
}

function summarySection(rows: Row[]): Safe {
  const count = (status: string, severity: "mandatory" | "advisory" | "all"): number =>
    rows.filter(
      (r) =>
        r.decision.status === status &&
        (severity === "all" || (severity === MANDATORY ? r.decision.severity === MANDATORY : r.decision.severity !== MANDATORY)),
    ).length;
  const known = new Set<string>(STATUSES);
  const unknown = rows.filter((r) => !known.has(r.decision.status)).length;
  return html`<section id="summary" aria-labelledby="summary-h">
<h2 id="summary-h">Summary by status</h2>
<div class="scroll"><table class="stack">
<caption>Requirements by status <span class="muted">(${rows.length} total)</span></caption>
<thead><tr><th scope="col">Status</th><th scope="col">What it means</th><th scope="col">Mandatory</th><th scope="col">Advisory</th><th scope="col">Total</th></tr></thead>
<tbody>${STATUSES.map((status) => {
    const info = STATUS_INFO[status];
    return html`<tr><th scope="row" data-label="Status">${badge(status)}</th><td data-label="What it means">${info.meaning} <em>${info.acceptance}</em></td><td data-label="Mandatory">${count(status, "mandatory")}</td><td data-label="Advisory">${count(status, "advisory")}</td><td data-label="Total">${count(status, "all")}</td></tr>`;
  })}${
    unknown === 0
      ? ""
      : html`<tr><th scope="row" data-label="Status">${badge("unknown")}</th><td data-label="What it means">Requirements whose status is not one of the six known statuses. They never pass.</td><td data-label="Mandatory">${rows.filter((r) => !known.has(r.decision.status) && r.decision.severity === MANDATORY).length}</td><td data-label="Advisory">${rows.filter((r) => !known.has(r.decision.status) && r.decision.severity !== MANDATORY).length}</td><td data-label="Total">${unknown}</td></tr>`
  }</tbody>
</table></div>
</section>`;
}

function identitySection(report: Report): Safe {
  const sup = report.supersedes;
  return html`<section id="identity" aria-labelledby="identity-h">
<h2 id="identity-h">Assessment</h2>
<dl class="facts">
<dt>Assessment id</dt><dd><code>${report.assessment_id}</code></dd>
<dt>Manifest</dt><dd>${report.manifest_name}</dd>
<dt>Evaluated at (UTC)</dt><dd><code>${report.evaluated_at}</code></dd>
<dt>Clock</dt><dd>${
    report.clock_source === "system"
      ? html`The system clock at the time of the run.`
      : html`<strong>Fixed by ${report.clock_source === "flag" ? "--now" : "PROOFGATE_NOW"}</strong>: the evidence was judged against the time above, not against the current time, so freshness may differ today.`
  }</dd>
<dt>Manifest hash</dt><dd><code>${report.manifest_hash}</code></dd>
<dt>Policy hash</dt><dd><code>${report.policy_hash}</code></dd>
<dt>Revisions hash</dt><dd><code>${report.revisions_hash}</code></dd>
<dt>Receipts hash</dt><dd><code>${report.receipts_hash}</code></dd>
<dt>Engine</dt><dd>${report.engine.name} ${report.engine.version} (policy engine v${report.engine.policy_version}, schema v${report.schema_version})</dd>
<dt>Replaced an earlier report</dt><dd>${
    sup === null
      ? html`No. This is the first assessment at this location.`
      : html`Yes. Earlier assessment <code>${sup.assessment_id}</code>; the policy ${sup.policy_changed ? "changed" : "did not change"} (earlier policy hash <code>${sup.policy_hash}</code>). The earlier report is kept, not overwritten.`
  }</dd>
<dt>Inputs read</dt><dd>${report.input_summary.files_scanned} files scanned, ${report.input_summary.receipt_documents} receipt documents, ${report.input_summary.metadata_bytes} metadata bytes, ${report.input_summary.artifact_bytes} artifact bytes. Artifacts are hashed, never opened as links or fetched.</dd>
</dl>
</section>
<section id="revisions" aria-labelledby="revisions-h">
<h2 id="revisions-h">Revisions under assessment</h2>
${
  report.revisions.length === 0
    ? html`<p class="empty">No revisions are recorded in this report.</p>`
    : html`<div class="scroll"><table class="stack">
<caption>Revision set: a receipt counts only for the exact full commit SHA listed here</caption>
<thead><tr><th scope="col">Repository</th><th scope="col">Full commit SHA</th></tr></thead>
<tbody>${report.revisions.map((r) => html`<tr><th scope="row" data-label="Repository">${r.repository}</th><td data-label="Full commit SHA"><code>${r.commit_sha}</code></td></tr>`)}</tbody>
</table></div>`
}
</section>`;
}

function requiredCell(d: Decision): Safe {
  return html`<dl class="inline">
<div><dt>Level</dt><dd>${d.required_level} or higher</dd></div>
<div><dt>Environment</dt><dd>${d.required_environment} (exact match)</dd></div>
<div><dt>Max age</dt><dd>${duration(d.max_age_seconds)}; evidence at exactly this age is stale</dd></div>
<div><dt>Repositories</dt><dd>${codeList(d.repositories, "none declared")}</dd></div>
<div><dt>Execution kinds</dt><dd>${kinds(d.allowed_execution_kinds)}</dd></div>
</dl>`;
}

function statusCell(d: Decision): Safe {
  const deferred = d.status === "DEFERRED" || d.deferred_reason !== null;
  return html`${badge(d.status)}${
    deferred
      ? html`<p><strong>Deferred:</strong> ${d.deferred_reason ?? "no reason recorded"}</p><p class="muted">Evidence alone would say ${badge(d.evidence_status)}. Deferral is not a pass.</p>`
      : ""
  }`;
}

function requirementsSection(rows: Row[]): Safe {
  if (rows.length === 0) {
    return html`<section id="requirements" aria-labelledby="requirements-h">
<h2 id="requirements-h">Requirements</h2>
<p class="empty">No requirements were evaluated. There is no acceptance decision to show.</p>
</section>`;
  }
  return html`<section id="requirements" aria-labelledby="requirements-h">
<h2 id="requirements-h">Requirements</h2>
<div class="scroll" role="region" aria-labelledby="requirements-cap" tabindex="0"><table class="stack">
<caption id="requirements-cap">Every requirement, mandatory first <span class="muted">(${rows.length} total; manifest order inside each group)</span></caption>
<thead><tr><th scope="col">Requirement</th><th scope="col">Status</th><th scope="col">Required</th><th scope="col">Source receipts</th><th scope="col">Environment</th><th scope="col">Reasons</th><th scope="col">Next step</th></tr></thead>
<tbody>${rows.map(({ decision: d, n }) => {
    const rejected = d.rejected_receipts.length;
    return html`<tr id="req-${n}">
<th scope="row" data-label="Requirement"><code>${d.id}</code><br>${d.title}<br>${severityTag(d.severity)}</th>
<td data-label="Status">${statusCell(d)}</td>
<td data-label="Required" class="cols">${requiredCell(d)}</td>
<td data-label="Source receipts">${codeList(d.receipt_ids, "None: no receipt decided this status.")}${
      rejected === 0 ? "" : html`<p class="muted">${rejected} receipt(s) rejected, see <a href="#detail-${n}">details</a>.</p>`
    }</td>
<td data-label="Environment">${d.environments.length === 0 ? html`<span class="muted">None observed (required: ${d.required_environment})</span>` : codeList(d.environments, "")}</td>
<td data-label="Reasons" class="cols">${reasonList(d.reason_codes)}</td>
<td data-label="Next step" class="cols"><ul class="plain">${nextSteps(d).map((s) => html`<li>${s}</li>`)}</ul></td>
</tr>`;
  })}</tbody>
</table></div>
</section>`;
}

function detailsSection(rows: Row[]): Safe {
  if (rows.length === 0) {
    return html`<section id="details" aria-labelledby="details-h">
<h2 id="details-h">Requirement details</h2>
<p class="empty">No requirement details: nothing was evaluated.</p>
</section>`;
  }
  return html`<section id="details" aria-labelledby="details-h">
<h2 id="details-h">Requirement details</h2>
<p class="muted">Per-repository evidence and rejected receipts behind each decision. A requirement that passed cleanly is folded to one line (its status stays visible); everything else is open. Use the disclosure arrow to open or close any of them.</p>
${rows.map(({ decision: d, n }) => {
    return html`<section id="detail-${n}" aria-labelledby="detail-${n}-h">
<h3 id="detail-${n}-h"><code>${d.id}</code> ${badge(d.status)}</h3>
<details class="detail"${d.status === "PASS" && d.rejected_receipts.length === 0 ? "" : " open"}>
<summary>${d.per_repository.length} repositor${d.per_repository.length === 1 ? "y" : "ies"}: ${d.per_repository.map((p, i) => html`${i === 0 ? "" : ", "}<code>${p.repository}</code> ${p.status}`)}${
      d.rejected_receipts.length === 0 ? "" : html`; ${d.rejected_receipts.length} receipt(s) rejected`
    }</summary>
<div class="scroll"><table class="stack">
<caption>Evidence per repository for <code>${d.id}</code></caption>
<thead><tr><th scope="col">Repository</th><th scope="col">Expected commit</th><th scope="col">Status</th><th scope="col">Reasons</th><th scope="col">Source receipts</th></tr></thead>
<tbody>${d.per_repository.map(
      (p) =>
        html`<tr><th scope="row" data-label="Repository">${p.repository}</th><td data-label="Expected commit"><code>${p.expected_commit_sha}</code></td><td data-label="Status">${badge(p.status)}</td><td data-label="Reasons">${reasonList(p.reason_codes)}</td><td data-label="Source receipts">${codeList(p.receipt_ids, "None")}</td></tr>`,
    )}</tbody>
</table></div>
${
  d.rejected_receipts.length === 0
    ? html`<p class="muted">No receipt was rejected for this requirement.</p>`
    : html`<div class="scroll"><table class="stack">
<caption>Rejected receipts for <code>${d.id}</code> <span class="muted">(named the requirement but cannot count)</span></caption>
<thead><tr><th scope="col">Receipt</th><th scope="col">Repository</th><th scope="col">Why it was rejected</th></tr></thead>
<tbody>${d.rejected_receipts.map(
        (r) => html`<tr><th scope="row" data-label="Receipt"><code>${r.receipt_id}</code></th><td data-label="Repository">${r.repository}</td><td data-label="Why it was rejected">${reasonList(r.reason_codes)}</td></tr>`,
      )}</tbody>
</table></div>`
}
</details>
</section>`;
  })}
</section>`;
}

function receiptRow(r: ReportReceipt, evaluatedAt: string): Safe {
  return html`<tr>
<th scope="row" data-label="Receipt"><code>${r.receipt_id}</code><br><span class="muted">Source file</span> <code>${r.source_file}</code><br><span class="muted">Adapter</span> ${r.adapter.name} v${r.adapter.version}, ${r.adapter.provenance}</th>
<td data-label="Scope"><code>${r.repository}</code> at <code>${r.commit_sha}</code><br><span class="muted">Requirements</span> ${codeList(r.requirement_ids, "none")}</td>
<td data-label="Run">${r.runner_id}<br>${r.environment}, ${r.test_level} tests<br>${kindLabel(r.execution_kind)}${
    r.command === null ? "" : html`<br><span class="muted">Command text (informational, never executed)</span> <code>${r.command}</code>`
  }</td>
<td data-label="Result">${r.result}<br>${r.tests.passed} passed, ${r.tests.failed} failed, ${r.tests.skipped} skipped of ${r.tests.total}</td>
<td data-label="Finished (UTC)"><code>${r.finished_at}</code><br><span class="muted">${relativeToEvaluation(r.finished_at, evaluatedAt)}</span></td>
<td data-label="Artifact (not fetched)"><code>${r.artifact_path}</code><br><span class="muted">sha256</span> <code>${r.artifact_sha256}</code><br><span class="muted">receipt content</span> <code>${r.content_sha256}</code></td>
</tr>`;
}

function receiptsSection(report: Report): Safe {
  return html`<section id="receipts" aria-labelledby="receipts-h">
<h2 id="receipts-h">Receipts considered</h2>
${
  report.receipts.length === 0
    ? html`<p class="empty">No receipts were supplied. Without receipts no requirement can pass.</p>`
    : html`<div class="scroll" role="region" aria-labelledby="receipts-cap" tabindex="0"><table class="stack">
<caption id="receipts-cap">Every receipt read <span class="muted">(${report.receipts.length} total)</span></caption>
<thead><tr><th scope="col">Receipt</th><th scope="col">Scope</th><th scope="col">Run</th><th scope="col">Result</th><th scope="col">Finished (UTC)</th><th scope="col">Artifact (not fetched)</th></tr></thead>
<tbody>${report.receipts.map((r) => receiptRow(r, report.evaluated_at))}</tbody>
</table></div>`
}
</section>`;
}

function glossarySection(): Safe {
  return html`<section id="glossary" aria-labelledby="glossary-h">
<h2 id="glossary-h">How to read the statuses</h2>
<p>Only PASS satisfies a requirement. Every other status, including DEFERRED, is visible and keeps a mandatory requirement from being accepted.</p>
<dl class="facts">${STATUSES.map((s) => html`<dt>${badge(s)}</dt><dd>${STATUS_INFO[s].meaning} <strong>${STATUS_INFO[s].acceptance}</strong></dd>`)}</dl>
</section>`;
}

/* ------------------------------------------------------------------- page */

function verdictLabel(kind: VerdictKind): string {
  return kind === "accepted" ? "ACCEPTED" : "NO ACCEPTED RESULT";
}

/** Render a report to one self-contained HTML document. Pure and deterministic. */
export function renderReportHtml(report: Report): string {
  const rows = orderedRows(report);
  const verdict = assessVerdict(report);
  const page = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${raw(CONTENT_SECURITY_POLICY)}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>ProofGate report: ${report.manifest_name} (${verdictLabel(verdict.kind)})</title>
<style>${raw(REPORT_CSS)}</style>
</head>
<body>
<a class="skip" href="#requirements">Skip to the requirements table</a>
<div class="wrap">
<header>
<p class="eyebrow">ProofGate acceptance report</p>
<h1>${report.manifest_name}</h1>
<p class="muted">Evaluated at <code>${report.evaluated_at}</code> UTC. Assessment <code>${report.assessment_id}</code>.</p>
<nav aria-label="Report sections"><a href="#verdict">Verdict</a> | <a href="#summary">Summary</a> | <a href="#identity">Assessment</a> | <a href="#requirements">Requirements</a> | <a href="#details">Details</a> | <a href="#receipts">Receipts</a> | <a href="#glossary">Statuses</a></nav>
</header>
<main>
${verdictSection(report, verdict, rows)}
${summarySection(rows)}
${identitySection(report)}
${requirementsSection(rows)}
${detailsSection(rows)}
${receiptsSection(report)}
${glossarySection()}
</main>
<footer>
<p>Generated statically from <code>report.json</code>: no script runs, nothing is fetched, no artifact link is followed. ProofGate verifies that receipts are consistent with the declared policy and revisions; it does not prove that the party that produced a receipt was honest.</p>
</footer>
</div>
</body>
</html>
`;
  return page.value;
}
