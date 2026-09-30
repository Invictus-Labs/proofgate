import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REASON_DESCRIPTIONS, describeReason } from "../../src/reasons.js";
import { STATUSES, reportSchema, type Report } from "../../src/schemas.js";
import { EXIT_CODES, REASON_NEXT_STEPS, STATUS_INFO, explainReason, nextStepForReason, statusInfo } from "../../src/web/guidance.js";
import { CONTENT_SECURITY_POLICY, assessVerdict, duration, renderReportHtml } from "../../src/web/render.js";
import { MAX_TEXT_LENGTH, displayText, html, join, raw, text } from "../../src/web/safe-html.js";
import { REPORT_CSS } from "../../src/web/styles.js";
import { bodyText, elementNames, parseHtml, styleText, titleText, type Token } from "../helpers/html-tokens.js";
import { uuid } from "../helpers/fixture.js";
import { emptyReport, exit0Report, exit1Report } from "../helpers/report-fixtures.js";
import { violations } from "../helpers/report-invariants.js";

/** Cells of every `<tr id="req-N">` in the requirements table, keyed by row id. */
function requirementRows(tokens: Token[]): Array<{ id: string; cells: string[]; badgeClass: string | undefined }> {
  const rows: Array<{ id: string; cells: string[]; badgeClass: string | undefined }> = [];
  let current: { id: string; cells: string[]; badgeClass: string | undefined } | undefined;
  let cell: string | undefined;
  for (const t of tokens) {
    if (t.type === "start" && t.name === "tr") {
      const id = t.attrs.find(([n]) => n === "id")?.[1];
      current = id?.startsWith("req-") ? { id, cells: [], badgeClass: undefined } : undefined;
    } else if (t.type === "end" && t.name === "tr" && current) {
      rows.push(current);
      current = undefined;
    } else if (current && t.type === "start" && (t.name === "td" || t.name === "th")) {
      cell = "";
    } else if (current && t.type === "end" && (t.name === "td" || t.name === "th")) {
      current.cells.push(cell ?? "");
      cell = undefined;
    } else if (current && cell !== undefined && t.type === "start" && t.name === "br") {
      cell += " ";
    } else if (current && t.type === "start" && t.name === "span" && current.badgeClass === undefined) {
      const cls = t.attrs.find(([n]) => n === "class")?.[1];
      if (cls?.startsWith("badge ")) current.badgeClass = cls;
    } else if (current && t.type === "text" && cell !== undefined) {
      cell += t.value;
    }
  }
  return rows;
}

const render = (report: Report): { html: string; tokens: Token[]; text: string } => {
  const out = renderReportHtml(report);
  const { tokens } = parseHtml(out);
  return { html: out, tokens, text: bodyText(tokens) };
};

describe("AC-05 report side: every requirement, status, source receipt, environment and reason", () => {
  const report = exit1Report();
  const { html: out, tokens, text: body } = render(report);
  const rows = requirementRows(tokens);

  it("is well formed and satisfies every structural safety invariant", () => {
    expect(violations(out)).toEqual([]);
  });

  it("lists EVERY requirement exactly once, mandatory first, manifest order inside each group", () => {
    const ids = rows.map((r) => (r.cells[0] ?? "").split(/\s/)[0]);
    expect(ids).toHaveLength(report.requirements.length);
    expect(new Set(ids).size).toBe(ids.length);
    const mandatory = report.requirements.filter((d) => d.severity === "mandatory").map((d) => d.id);
    const advisory = report.requirements.filter((d) => d.severity === "advisory").map((d) => d.id);
    expect(ids).toEqual([...mandatory, ...advisory]);
    expect(rows.map((r) => r.id)).toEqual(ids.map((_, i) => `req-${i + 1}`));
  });

  it("shows all six statuses, each as a text label (never colour alone), with a decorative hidden symbol", () => {
    for (const status of STATUSES) {
      const decision = report.requirements.find((d) => d.status === status);
      expect(decision, `fixture must contain a ${status} requirement`).toBeDefined();
      const row = rows.find((r) => (r.cells[0] ?? "").split(/\s/)[0] === decision?.id);
      expect(row?.cells[1]).toContain(status);
      expect(row?.badgeClass).toBe(`badge tone-${status.toLowerCase()}`);
    }
    expect(out.match(/<span class="sym" aria-hidden="true">/g)?.length).toBeGreaterThan(6);
  });

  it("reconciles each row with its decision: status, receipt ids, environments and reason codes", () => {
    for (const decision of report.requirements) {
      const row = rows.find((r) => (r.cells[0] ?? "").split(/\s/)[0] === decision.id);
      expect(row, decision.id).toBeDefined();
      const cells = row?.cells ?? [];
      expect(cells[1]).toContain(decision.status);
      for (const id of decision.receipt_ids) expect(cells[3]).toContain(id);
      if (decision.receipt_ids.length === 0) expect(cells[3]).toContain("None: no receipt decided this status.");
      for (const env of decision.environments) expect(cells[4]).toContain(env);
      for (const code of decision.reason_codes) {
        expect(cells[5]).toContain(code);
        expect(cells[5]).toContain(describeReason(code));
      }
      expect(cells[6]?.length).toBeGreaterThan(10);
      expect(cells[2]).toContain(decision.required_environment);
    }
  });

  it("never styles a non-PASS requirement with the success tone", () => {
    for (const decision of report.requirements) {
      const row = rows.find((r) => (r.cells[0] ?? "").split(/\s/)[0] === decision.id);
      if (decision.status !== "PASS") expect(row?.badgeClass).not.toContain("tone-pass");
    }
    expect(body).not.toContain("tone-pass");
  });

  it("explains DEFERRED clearly: reason, that evidence alone would say otherwise, and that it is not a pass", () => {
    const row = rows.find((r) => (r.cells[0] ?? "").startsWith("REQ-DEFERRED "));
    expect(row?.cells[1]).toContain("Deferred: Vendor sandbox is unavailable this week");
    expect(row?.cells[1]).toContain("Evidence alone would say");
    expect(row?.cells[1]).toContain("Deferral is not a pass.");
    expect(row?.cells[6]).toContain("Resolve the deferral");
    expect(row?.badgeClass).toBe("badge tone-deferred");
  });

  it("still explains a DEFERRED requirement whose reason was not recorded", () => {
    const base = exit1Report();
    const report: Report = { ...base, requirements: base.requirements.map((d) => (d.status === "DEFERRED" ? { ...d, deferred_reason: null } : d)) };
    expect(render(report).text).toContain("Deferred: no reason recorded");
  });

  it("explains PARTIAL, STALE and MISSING with concrete next steps and rejected receipts", () => {
    const partial = rows.find((r) => (r.cells[0] ?? "").startsWith("REQ-PARTIAL "));
    expect(partial?.cells[5]).toContain("incomplete_repository_coverage");
    expect(partial?.cells[6]).toContain("every declared repository");
    const stale = rows.find((r) => (r.cells[0] ?? "").startsWith("REQ-STALE "));
    expect(stale?.cells[2]).toContain("evidence at exactly this age is stale");
    expect(stale?.cells[6]).toContain("fresh evidence");
    const missing = rows.find((r) => (r.cells[0] ?? "").startsWith("REQ-MISSING "));
    expect(missing?.cells[3]).toContain("2 receipt(s) rejected");
    expect(body).toContain("Rejected receipts for REQ-MISSING");
    expect(body).toContain("execution_kind_not_allowed");
    expect(body).toContain("revision_mismatch");
  });

  it("shows mandatory/advisory counts per status that add up to the report summary", () => {
    for (const status of STATUSES) {
      expect(report.requirements.filter((d) => d.status === status).length).toBe(report.summary.by_status[status]);
    }
    expect(body).toContain("Requirements by status (8 total)");
  });
});

describe("verdict and exit-code meaning", () => {
  it("exit 1: 'no accepted result', exit code 1 meaning, list of unsatisfied mandatory requirements", () => {
    const { html: out, tokens, text: body } = render(exit1Report());
    expect(assessVerdict(exit1Report())).toMatchObject({ kind: "unsatisfied", mandatory: 6, mandatoryPassed: 1 });
    expect(body).toContain("NO ACCEPTED RESULT");
    expect(body).toContain("Verdict unsatisfied, exit code 1: 5 of 6 mandatory requirements are not PASS");
    expect(body).toContain("Uncertain states (STALE, MISSING, PARTIAL, DEFERRED) count as not accepted.");
    expect(out).toContain('class="verdict tone-fail"');
    expect(out).not.toMatch(/<h2 id="verdict-h">[^<]*<span aria-hidden="true">[^<]*<\/span> ACCEPTED</);
    expect(titleText(tokens)).toBe("ProofGate report: demo-release-gate (NO ACCEPTED RESULT)");
    expect(body).toContain("Mandatory requirements that are not PASS:");
    // The "This report" column marks exit code 1 only.
    const yes = out.match(/<strong>Yes<\/strong>/g) ?? [];
    expect(yes).toHaveLength(1);
    for (const e of EXIT_CODES) expect(body).toContain(e.meaning);
  });

  it("exit 0: ACCEPTED with the success tone, exit code 0, and open advisory work stays visible", () => {
    const report = exit0Report();
    const { html: out, tokens, text: body } = render(report);
    expect(report.exit_code).toBe(0);
    expect(assessVerdict(report)).toMatchObject({ kind: "accepted", mandatory: 2, mandatoryPassed: 2 });
    expect(out).toContain('class="verdict tone-pass"');
    expect(body).toContain("ACCEPTED");
    expect(body).not.toContain("NO ACCEPTED RESULT");
    expect(body).toContain("Verdict accepted, exit code 0: all 2 mandatory requirements are PASS");
    expect(body).toContain("1 advisory requirement(s) are not PASS. They do not block acceptance and stay listed below.");
    expect(titleText(tokens)).toBe("ProofGate report: demo-release-gate (ACCEPTED)");
    expect(violations(out)).toEqual([]);
  });

  it("exit 0 with no open advisory work has no advisory notice", () => {
    const report = exit0Report();
    const advisory = report.requirements.find((d) => d.severity === "advisory");
    if (!advisory) throw new Error("fixture");
    const clean: Report = { ...report, requirements: report.requirements.map((d) => (d === advisory ? { ...d, status: "PASS", evidence_status: "PASS", deferred_reason: null } : d)) };
    const cleanReport = { ...clean, summary: { ...clean.summary, by_status: { ...clean.summary.by_status, DEFERRED: 0, PASS: 3 } } };
    expect(render(cleanReport).text).not.toContain("advisory requirement(s)");
    expect(assessVerdict(cleanReport).kind).toBe("accepted");
  });

  it("renders the header facts: assessment id, hashes, evaluated_at, full SHAs, engine", () => {
    const report = exit1Report();
    const { text: body } = render(report);
    for (const value of [report.assessment_id, report.manifest_hash, report.policy_hash, report.revisions_hash, report.receipts_hash, report.evaluated_at, report.engine.version, report.manifest_name]) {
      expect(body).toContain(value);
    }
    for (const r of report.revisions) {
      expect(r.commit_sha).toHaveLength(40);
      expect(body).toContain(r.commit_sha);
    }
    expect(body).toContain("Replaced an earlier report");
    expect(body).toContain("No. This is the first assessment at this location.");
  });

  it("says when the report replaced an earlier one, and whether the policy changed", () => {
    const base = exit1Report();
    const earlier = uuid(11);
    const sup = { assessment_id: earlier, manifest_hash: "b".repeat(64), policy_hash: "c".repeat(64) };
    const changed = render({ ...base, supersedes: { ...sup, policy_changed: true } }).text;
    expect(changed).toContain(`Yes. Earlier assessment ${earlier}; the policy changed`);
    expect(render({ ...base, supersedes: { ...sup, policy_changed: false } }).text).toContain("the policy did not change");
  });

  it("marks exit-code rows by the report's own code, and none when the report is inconsistent", () => {
    const base = exit0Report();
    expect(render(base).html.match(/<strong>Yes<\/strong>/g)).toHaveLength(1);
    const broken: Report = { ...base, verdict: "unsatisfied", exit_code: 1 };
    expect(render(broken).html).not.toContain("<strong>Yes</strong>");
  });
});

describe("empty and 'no accepted result' states", () => {
  it("zero requirements: explicit empty state, nothing styled as success, no requirements table", () => {
    const report = emptyReport();
    reportSchema.parse(report);
    const { html: out, text: body } = render(report);
    expect(assessVerdict(report).kind).toBe("empty");
    expect(body).toContain("NO ACCEPTED RESULT (nothing evaluated)");
    expect(body).toContain("No requirements were evaluated. There is no acceptance decision to show.");
    expect(body).toContain("No receipts were supplied. Without receipts no requirement can pass.");
    expect(body).toContain("No revisions are recorded in this report.");
    expect(out).not.toContain('id="requirements-cap"');
    expect(body).toContain("No requirement details: nothing was evaluated.");
    expect(out).not.toContain('id="detail-1"');
    expect(out).not.toContain('class="verdict tone-pass"');
    expect(violations(out)).toEqual([]);
  });

  it("an 'accepted' report with no requirements is still not accepted", () => {
    const report: Report = { ...emptyReport(), verdict: "accepted", exit_code: 0 };
    expect(assessVerdict(report).kind).toBe("empty");
    expect(render(report).text).not.toMatch(/^ACCEPTED/m);
    expect(render(report).html).not.toContain('class="verdict tone-pass"');
  });

  it("a report with zero mandatory requirements says nothing can be accepted", () => {
    const base = exit0Report();
    const advisoryOnly: Report = {
      ...base,
      verdict: "unsatisfied",
      exit_code: 1,
      requirements: base.requirements.filter((d) => d.severity === "advisory"),
      summary: { total_requirements: 1, mandatory_requirements: 0, mandatory_passed: 0, mandatory_unsatisfied: 0, by_status: { PASS: 0, FAIL: 0, STALE: 0, MISSING: 0, PARTIAL: 0, DEFERRED: 1 } },
    };
    expect(assessVerdict(advisoryOnly).kind).toBe("unsatisfied");
    expect(render(advisoryOnly).text).toContain("the report contains no mandatory requirement, so nothing can be accepted");
    const claimsAccepted: Report = { ...advisoryOnly, verdict: "accepted", exit_code: 0 };
    expect(assessVerdict(claimsAccepted).kind).toBe("inconsistent");
  });

  it.each([
    ["accepted but a mandatory requirement is not PASS", (r: Report): Report => ({ ...r, requirements: r.requirements.map((d, i) => (i === 0 ? { ...d, status: "FAIL" } : d)) }), "claims acceptance"],
    ["unsatisfied although every mandatory requirement passes", (r: Report): Report => ({ ...r, verdict: "unsatisfied", exit_code: 1 }), "claims unsatisfied"],
    ["verdict and exit code disagree", (r: Report): Report => ({ ...r, exit_code: 1 }), "not a matching pair"],
    ["summary counts disagree with the decisions", (r: Report): Report => ({ ...r, summary: { ...r.summary, mandatory_passed: 99 } }), "summary counts do not match"],
    ["by_status disagrees with the decisions", (r: Report): Report => ({ ...r, summary: { ...r.summary, by_status: { ...r.summary.by_status, FAIL: 3 } } }), "summary counts do not match"],
    ["total disagrees", (r: Report): Report => ({ ...r, summary: { ...r.summary, total_requirements: 7 } }), "summary counts do not match"],
  ])("a self-contradicting report (%s) is shown as NOT accepted", (_name, mutate, why) => {
    const report = mutate(exit0Report());
    const verdict = assessVerdict(report);
    expect(verdict.kind).toBe("inconsistent");
    expect(verdict.problems.join(" ")).toContain(why);
    const { html: out, text: body } = render(report);
    expect(body).toContain("NO ACCEPTED RESULT (report inconsistent)");
    expect(out).not.toContain('class="verdict tone-pass"');
    expect(body).toContain("This report contradicts itself");
  });

  it("unknown status, severity and execution kind are shown as unknown and never as success", () => {
    const base = exit0Report();
    const weird: Report = {
      ...base,
      verdict: "unsatisfied",
      exit_code: 1,
      requirements: base.requirements.map((d, i) => (i === 0 ? ({ ...d, status: "GREEN", severity: "critical", allowed_execution_kinds: ["quantum"] } as unknown as typeof d) : d)),
    };
    const { html: out, text: body, tokens } = render(weird);
    expect(body).toContain("UNKNOWN: GREEN");
    expect(body).toContain("CRITICAL");
    expect(body).toContain("UNKNOWN: quantum");
    expect(body).toContain("Requirements whose status is not one of the six known statuses. They never pass.");
    const weirdRow = requirementRows(tokens).find((r) => (r.cells[0] ?? "").startsWith(`${base.requirements[0]?.id ?? "?"} `));
    expect(weirdRow?.badgeClass).toBe("badge tone-unknown");
    expect(out).toContain('class="verdict tone-fail"');
    expect(violations(out)).toEqual([]);
    // The unknown-status requirement is sorted with the advisory group (not mandatory), and counted as unknown.
    const asMandatory = { ...weird, requirements: weird.requirements.map((d, i) => (i === 0 ? ({ ...d, severity: "mandatory" } as typeof d) : d)) };
    expect(render(asMandatory).text).toContain("Requirements whose status is not one of the six known statuses.");
  });

  it("unknown status objects resolve to the unknown info, inherited names are not trusted", () => {
    expect(statusInfo("PASS").label).toBe("PASS");
    for (const bad of ["pass", "constructor", "__proto__", "toString", 7, null, undefined]) {
      const info = statusInfo(bad);
      expect(info.label).toBeNull();
      expect(info.key).toBe("unknown");
    }
  });
});

describe("plain-language wording", () => {
  it("has a status description and a next step for all six statuses", () => {
    for (const status of STATUSES) {
      const info = STATUS_INFO[status];
      expect(info.label).toBe(status);
      expect(info.meaning.length).toBeGreaterThan(20);
      expect(info.nextStep.length).toBeGreaterThan(10);
      expect(info.acceptance).toMatch(status === "PASS" ? /^Satisfies/ : /^Not satisfied/);
    }
  });

  it("has a specific next step for every core reason code, and only for real codes", () => {
    expect(Object.keys(REASON_NEXT_STEPS).sort()).toEqual(Object.keys(REASON_DESCRIPTIONS).sort());
    for (const code of Object.keys(REASON_DESCRIPTIONS)) {
      expect(nextStepForReason(code)).toBe(REASON_NEXT_STEPS[code as keyof typeof REASON_NEXT_STEPS]);
      expect(explainReason(code)).toBe(describeReason(code));
    }
  });

  it("does not resolve inherited object members as reason codes", () => {
    for (const code of ["constructor", "__proto__", "toString", "hasOwnProperty", "not_a_code"]) {
      expect(explainReason(code)).toBe("No description is available for this reason code.");
      expect(nextStepForReason(code)).toContain("proofgate explain");
    }
  });

  it("renders unknown reason codes with the fallback wording", () => {
    const base = exit1Report();
    const report: Report = { ...base, requirements: base.requirements.map((d, i) => (i === 1 ? { ...d, reason_codes: ["brand_new_code", "constructor"] } : d)) };
    const body = render(report).text;
    expect(body).toContain("brand_new_code");
    expect(body).toContain("No description is available for this reason code.");
    expect(body).toContain("Run proofgate explain for this requirement");
    expect(body).not.toContain("function Object");
  });

  it("shows a status-level next step when a requirement carries no reason codes", () => {
    const base = exit1Report();
    const report: Report = { ...base, requirements: base.requirements.map((d, i) => (i === 1 ? { ...d, reason_codes: [] } : d)) };
    const { tokens, text: body } = render(report);
    expect(body).toContain("No reason code recorded.");
    expect(requirementRows(tokens)[1]?.cells[6]).toContain(STATUS_INFO.FAIL.nextStep);
  });
});

describe("duration()", () => {
  it.each([
    [0, "0 s"],
    [59, "59 s"],
    [60, "1 min"],
    [600, "10 min"],
    [3600, "1 h"],
    [3661, "1 h 1 min 1 s"],
    [90061, "1 d 1 h 1 min 1 s"],
    [86400 * 400, "400 d"],
    [-5, "-5"],
    [1.5, "1.5"],
    [Number.NaN, "NaN"],
  ])("%s -> %s", (seconds, expected) => {
    expect(duration(seconds)).toBe(expected);
  });
});

describe("receipts table", () => {
  const report = exit1Report();
  const { html: out, text: body } = render(report);

  it("lists every receipt with scope, run, result, timing and artifact as inert text", () => {
    expect(body).toContain(`Every receipt read (${report.receipts.length} total)`);
    for (const r of report.receipts) {
      for (const value of [r.receipt_id, r.commit_sha, r.runner_id, r.artifact_path, r.artifact_sha256, r.content_sha256, r.source_file, r.finished_at]) expect(body).toContain(value);
    }
    expect(body).toContain("Command text (informational, never executed)");
    expect(body).toContain("npm test -- --run");
    expect(body).toContain("10 min before the evaluation time");
    expect(body).toContain("Artifacts are hashed, never opened as links or fetched.");
  });

  it("labels mocked and synthetic runs as not live evidence", () => {
    expect(body).toContain("MOCKED: not live evidence");
    const synthetic: Report = { ...report, receipts: report.receipts.map((r, i) => (i === 0 ? { ...r, execution_kind: "synthetic" as const, command: null } : r)) };
    const text2 = render(synthetic).text;
    expect(text2).toContain("SYNTHETIC: not live evidence");
    expect(text2.split("Command text (informational, never executed)").length - 1).toBe(report.receipts.length - 1);
  });

  it("never links an artifact: the only href values are in-page anchors", () => {
    const hrefs = [...out.matchAll(/ href="([^"]*)"/g)].map((m) => m[1] as string);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) expect(href.startsWith("#")).toBe(true);
    expect(out).not.toMatch(/\b(src|action|formaction|srcset|poster|data)=/);
    expect(out).not.toMatch(/https?:\/\//);
  });

  it("describes receipts finishing after the evaluation time and unparsable times", () => {
    const first = report.receipts[0];
    if (!first) throw new Error("fixture");
    const odd: Report = {
      ...report,
      receipts: [
        { ...first, finished_at: "2026-09-29T12:30:00Z" },
        { ...first, receipt_id: "r2", finished_at: "not-a-time" },
      ],
    };
    const t = render(odd).text;
    expect(t).toContain("30 min after the evaluation time");
    expect(t).toContain("age unknown");
  });
});

describe("accessibility and structure", () => {
  const { tokens, html: out } = render(exit1Report());
  const starts = tokens.filter((t): t is Extract<Token, { type: "start" }> => t.type === "start");
  const attr = (t: Extract<Token, { type: "start" }>, name: string): string | undefined => t.attrs.find(([n]) => n === name)?.[1];

  it("has a language, landmarks, a skip link, exactly one h1 and no skipped heading levels", () => {
    expect(out.startsWith("<!doctype html>\n<html lang=\"en\">")).toBe(true);
    const names = elementNames(tokens);
    for (const el of ["header", "main", "footer", "nav"]) expect(names.has(el)).toBe(true);
    expect(starts.filter((t) => t.name === "h1")).toHaveLength(1);
    expect(out).toContain('<a class="skip" href="#requirements">');
    let last = 0;
    for (const t of starts) {
      const m = /^h([1-3])$/.exec(t.name);
      if (!m) continue;
      const level = Number(m[1]);
      expect(level - last).toBeLessThanOrEqual(1);
      last = level;
    }
  });

  it("every table has a caption, header cells with scope, and row headers with scope=row", () => {
    const tables = starts.filter((t) => t.name === "table").length;
    expect(tables).toBeGreaterThanOrEqual(6);
    expect(starts.filter((t) => t.name === "caption")).toHaveLength(tables);
    const ths = starts.filter((t) => t.name === "th");
    expect(ths.length).toBeGreaterThan(20);
    for (const th of ths) expect(["col", "row"]).toContain(attr(th, "scope"));
    expect(starts.filter((t) => t.name === "thead")).toHaveLength(tables);
  });

  it("scrollable regions are labelled and keyboard focusable; decorative symbols are hidden from assistive technology", () => {
    const regions = starts.filter((t) => attr(t, "role") === "region");
    expect(regions.length).toBeGreaterThanOrEqual(2);
    for (const r of regions) {
      expect(attr(r, "tabindex")).toBe("0");
      expect(attr(r, "aria-labelledby")).toBeDefined();
    }
    for (const s of starts.filter((t) => attr(t, "class") === "sym")) expect(attr(s, "aria-hidden")).toBe("true");
  });

  it("narrow-screen cells carry static data-labels so stacked rows stay readable", () => {
    const labels = starts.map((t) => attr(t, "data-label")).filter((v): v is string => v !== undefined);
    expect(labels.length).toBeGreaterThan(50);
    for (const l of ["Requirement", "Status", "Required", "Source receipts", "Environment", "Reasons", "Next step"]) expect(labels).toContain(l);
  });
});

describe("self-contained page: CSP, no scripts, no network, light/dark, narrow, print", () => {
  const out = renderReportHtml(exit1Report());
  const { tokens } = parseHtml(out);

  it("ships a strict CSP meta tag that pins the inline stylesheet by hash and allows nothing else", () => {
    const meta = tokens.find((t) => t.type === "start" && t.name === "meta" && t.attrs.some(([n]) => n === "http-equiv"));
    const policy = meta?.type === "start" ? meta.attrs.find(([n]) => n === "content")?.[1] : undefined;
    expect(policy).toBe(CONTENT_SECURITY_POLICY);
    const hash = createHash("sha256").update(styleText(tokens)[0] ?? "").digest("base64");
    expect(policy).toContain(`style-src 'sha256-${hash}'`);
    for (const directive of ["default-src 'none'", "script-src 'none'", "img-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"]) expect(policy).toContain(directive);
    expect(policy).not.toMatch(/unsafe-|\*|https?:/);
    expect(out).toContain('<meta name="referrer" content="no-referrer">');
  });

  it("contains no script, handler, external URL, style attribute or link element", () => {
    expect(elementNames(tokens)).not.toContain("script");
    expect(elementNames(tokens)).not.toContain("link");
    expect(out).not.toMatch(/<script|\son[a-z]+=|javascript:|\sstyle=|@import|url\(|https?:\/\/|\/\/[a-z]/i);
    expect(REPORT_CSS).not.toMatch(/@import|url\(|@font-face|https?:/);
  });

  it("supports light and dark schemes, narrow screens and print", () => {
    expect(REPORT_CSS).toContain("color-scheme:light dark");
    expect(REPORT_CSS).toContain("@media (prefers-color-scheme:dark)");
    expect(REPORT_CSS).toContain("@media screen and (max-width:720px)");
    expect(REPORT_CSS).toContain("@media print");
    expect(out).toContain('<meta name="color-scheme" content="light dark">');
    expect(out).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });
});

describe("determinism", () => {
  it("renders the same report to byte-identical HTML, from copies and with different key order", () => {
    const report = exit1Report();
    const a = renderReportHtml(report);
    expect(renderReportHtml(report)).toBe(a);
    expect(renderReportHtml(structuredClone(report))).toBe(a);
    const reordered = JSON.parse(JSON.stringify(report, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))) as Report;
    expect(renderReportHtml(reordered)).toBe(a);
  });

  it("does not depend on the clock or the locale", () => {
    const report = exit1Report();
    const a = renderReportHtml(report);
    const RealDate = Date;
    const realNow = Date.now;
    const realLocale = Number.prototype.toLocaleString;
    try {
      Date.now = () => 42;
      Number.prototype.toLocaleString = () => "LOCALE";
      expect(renderReportHtml(report)).toBe(a);
    } finally {
      Date.now = realNow;
      Number.prototype.toLocaleString = realLocale;
      expect(Date).toBe(RealDate);
    }
  });

  it("different reports render differently (the golden files are not trivially equal)", () => {
    expect(renderReportHtml(exit1Report())).not.toBe(renderReportHtml(exit0Report()));
  });
});

/** The assessment id is a hash-derived UUID; golden files carry a placeholder so no raw UUID is committed. */
const goldenForm = (page: string): string => page.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<assessment-uuid>");

describe("golden snapshots (synthetic fixture, fixed clock; UUIDs replaced by a placeholder)", () => {
  it("exit code 1 report", async () => {
    await expect(goldenForm(renderReportHtml(exit1Report()))).toMatchFileSnapshot("./report-render.golden/exit1.html");
  });
  it("exit code 0 report", async () => {
    await expect(goldenForm(renderReportHtml(exit0Report()))).toMatchFileSnapshot("./report-render.golden/exit0.html");
  });
  it("empty report", async () => {
    await expect(goldenForm(renderReportHtml(emptyReport()))).toMatchFileSnapshot("./report-render.golden/empty.html");
  });
});

describe("scale", () => {
  it("renders 1,000 requirements linearly and quickly", () => {
    const base = exit1Report();
    const template = base.requirements[1];
    if (!template) throw new Error("fixture");
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...template, id: `REQ-${i}` }));
    const big: Report = { ...base, requirements: many, summary: { ...base.summary, total_requirements: 1000, mandatory_requirements: 1000, mandatory_passed: 0, mandatory_unsatisfied: 1000, by_status: { PASS: 0, FAIL: 1000, STALE: 0, MISSING: 0, PARTIAL: 0, DEFERRED: 0 } } };
    const start = performance.now();
    const out = renderReportHtml(big);
    const ms = performance.now() - start;
    expect(requirementRows(parseHtml(out).tokens)).toHaveLength(1000);
    expect(ms).toBeLessThan(5000);
  });
});

describe("safe-html primitives", () => {
  it("escapes interpolations, keeps Safe fragments, joins arrays and drops null/undefined/false", () => {
    expect(html`<p>${"<b>&\"'`"}</p>`.value).toBe("<p>&lt;b&gt;&amp;&quot;&#39;&#96;</p>");
    expect(html`<i>${raw("<b>ok</b>")}</i>`.value).toBe("<i><b>ok</b></i>");
    expect(html`${[html`<a>`, "<x>", 3]}`.value).toBe("<a>&lt;x&gt;3");
    expect(html`${null}${undefined}${false}!`.value).toBe("!");
    expect(String(raw("<u>"))).toBe("<u>");
    expect(join(["<a>", raw("<br>")], "<hr>").value).toBe("&lt;a&gt;<hr><br>");
    expect(join(["a", "b"]).value).toBe("ab");
  });

  it("a report string that merely looks like a Safe fragment is still escaped", () => {
    const forged = JSON.parse('{"value":"<script>x</script>"}') as unknown;
    expect(html`${forged}`.value).toBe("[object Object]");
    expect(html`${{ value: "<script>" }}`.value).not.toContain("<script>");
  });

  it("shows invisible and direction-changing characters as [U+XXXX]", () => {
    expect(displayText(`a${String.fromCodePoint(0x202e)}b${String.fromCodePoint(0)}c${String.fromCodePoint(0x200b)}d`)).toBe("a[U+202E]b[U+0000]c[U+200B]d");
    expect(displayText(`x${String.fromCharCode(0xd800)}y`)).toBe("x[U+D800]y");
    expect(displayText(String.fromCodePoint(0xe0041))).toBe("[U+E0041]");
    expect(displayText("tab\tnewline\ncr\r")).toBe("tab\tnewline\ncr\r");
    expect(displayText(String.fromCodePoint(0x1f600, 0xe9))).toBe(String.fromCodePoint(0x1f600, 0xe9));
    expect(text("<&>")).toBe("&lt;&amp;&gt;");
  });

  it("cuts very long text at a code point boundary with a visible marker", () => {
    const long = "a".repeat(MAX_TEXT_LENGTH + 10);
    expect(displayText(long)).toBe(`${"a".repeat(MAX_TEXT_LENGTH)} [... 10 more characters not shown; the full value is in report.json]`);
    expect(displayText("a".repeat(MAX_TEXT_LENGTH))).toHaveLength(MAX_TEXT_LENGTH);
    const emoji = `${"x".repeat(MAX_TEXT_LENGTH - 1)}${String.fromCodePoint(0x1f600)}tail`;
    const cut = displayText(emoji);
    expect(cut.startsWith("x".repeat(MAX_TEXT_LENGTH - 1))).toBe(true);
    expect(cut).toContain("more characters not shown");
    expect(cut.slice(MAX_TEXT_LENGTH - 1, MAX_TEXT_LENGTH + 1)).toBe(" ["); // the surrogate pair was not split
  });
});
