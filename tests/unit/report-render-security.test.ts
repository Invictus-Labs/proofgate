import { describe, expect, it } from "vitest";
import type { Report } from "../../src/schemas.js";
import { renderReportHtml } from "../../src/web/render.js";
import { displayText } from "../../src/web/safe-html.js";
import { ATTACK_STRINGS, prng, randomAttack } from "../helpers/attack-strings.js";
import { bodyText, parseHtml, titleText } from "../helpers/html-tokens.js";
import { exit0Report, exit1Report } from "../helpers/report-fixtures.js";
import { violations } from "../helpers/report-invariants.js";

/**
 * AC-07 / AC-09 report side: hostile report text is rendered as visible text, never as markup, attributes,
 * links or script. No HTML parser dependency exists in this repository, so the checks use the strict local
 * tokenizer in tests/helpers/html-tokens.ts, which fails on any raw "<" that is not a well-formed tag,
 * any bare "&", unquoted attributes and mismatched nesting, plus an allow-list of elements and attributes.
 */

/** Put `value` into every free-form string field a schema-valid report can carry. */
function injectFreeForm(base: Report, value: string): Report {
  return {
    ...base,
    manifest_name: value,
    engine: { ...base.engine, version: value },
    requirements: base.requirements.map((d) => ({
      ...d,
      title: value,
      required_environment: value,
      environments: d.environments.map(() => value),
      deferred_reason: d.deferred_reason === null ? null : value,
      reason_codes: d.reason_codes.map(() => value),
      per_repository: d.per_repository.map((p) => ({ ...p, reason_codes: p.reason_codes.map(() => value) })),
      rejected_receipts: d.rejected_receipts.map((r) => ({ ...r, reason_codes: [value] })),
    })),
    receipts: base.receipts.map((r) => ({
      ...r,
      runner_id: value,
      environment: value,
      artifact_path: value,
      command: r.command === null ? null : value,
      source_file: value,
      adapter: { ...r.adapter, name: value },
    })),
  };
}

/** Replace EVERY string leaf (ids, hashes, statuses, enums too): schema-invalid, but must still be inert. */
function injectEverywhere(node: unknown, value: string): unknown {
  if (typeof node === "string") return value;
  if (Array.isArray(node)) return node.map((n) => injectEverywhere(n, value));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, injectEverywhere(v, value)]));
  return node;
}

function expectInert(report: Report, expected: string | undefined, label: string): void {
  const out = renderReportHtml(report);
  const problems = violations(out);
  expect(problems, `${label}: ${problems.join("; ")}`).toEqual([]);
  if (expected !== undefined) {
    const { tokens } = parseHtml(out);
    // The attack text is present as decoded TEXT (what a reader would see), in the body and, for the manifest name, the title.
    expect(bodyText(tokens).includes(displayText(expected)), `${label}: attack text is not visible as text`).toBe(true);
  }
}

describe("hostile strings render as visible text only (attack corpus x every free-form field)", () => {
  const base = exit1Report();
  it.each(ATTACK_STRINGS.map((s, i) => [i, s] as const))("corpus entry #%i", (i, attack) => {
    expectInert(injectFreeForm(base, attack), attack, `corpus #${i}`);
  });

  it("the accepted (exit 0) report is just as safe", () => {
    for (const attack of ATTACK_STRINGS) expectInert(injectFreeForm(exit0Report(), attack), attack, "exit0");
  });

  it("the page title carries the manifest name as escaped text", () => {
    for (const attack of ATTACK_STRINGS) {
      const out = renderReportHtml(injectFreeForm(base, attack));
      const { tokens, errors } = parseHtml(out);
      expect(errors).toEqual([]);
      expect(titleText(tokens)).toContain(displayText(attack));
    }
  });
});

describe("hostile strings in structured positions (schema-invalid reports must still be inert)", () => {
  it.each(ATTACK_STRINGS.map((s, i) => [i, s] as const))("every string leaf replaced, corpus entry #%i", (i, attack) => {
    const hostile = injectEverywhere(exit1Report(), attack) as Report;
    const out = renderReportHtml(hostile);
    expect(violations(out), `corpus #${i}`).toEqual([]);
    expect(bodyText(parseHtml(out).tokens).includes(displayText(attack))).toBe(true);
  });

  it("weird non-string data (numbers, nulls, objects) cannot break the markup either", () => {
    const report = exit1Report();
    const odd = { ...report, engine: { ...report.engine, version: { toString: () => "<script>alert(1)</script>" } }, evaluated_at: 12345 } as unknown as Report;
    const out = renderReportHtml(odd);
    expect(violations(out)).toEqual([]);
    expect(bodyText(parseHtml(out).tokens)).toContain("<script>alert(1)</script>");
  });
});

describe("property-style fuzz (seeded, reproducible)", () => {
  it("600 random hostile strings x random fields keep every invariant", () => {
    const rand = prng(0x5eed);
    const base = exit1Report();
    for (let i = 0; i < 600; i += 1) {
      const attack = randomAttack(rand);
      const report = rand() < 0.5 ? injectFreeForm(base, attack) : (injectEverywhere(base, attack) as Report);
      const out = renderReportHtml(report);
      const problems = violations(out);
      expect(problems, `iteration ${i}: ${JSON.stringify(attack)} -> ${problems.join("; ")}`).toEqual([]);
      expect(bodyText(parseHtml(out).tokens).includes(displayText(attack)), `iteration ${i}: ${JSON.stringify(attack)}`).toBe(true);
    }
  });

  it("mixing a different random attack into each field independently is still inert", () => {
    const rand = prng(0xbadc0de);
    const base = exit1Report();
    for (let i = 0; i < 100; i += 1) {
      const scrambled = JSON.parse(JSON.stringify(base), (_k, v: unknown) => (typeof v === "string" ? randomAttack(rand) : v)) as Report;
      const problems = violations(renderReportHtml(scrambled));
      expect(problems, `iteration ${i}`).toEqual([]);
    }
  });

  it("rendering hostile input is deterministic", () => {
    const report = injectFreeForm(exit1Report(), ATTACK_STRINGS.slice(0, 30).join(" | "));
    expect(renderReportHtml(report)).toBe(renderReportHtml(structuredClone(report)));
  });
});

describe("very long strings are bounded but never silently dropped", () => {
  it("cuts each string at the display limit with a visible marker; output stays small", () => {
    const huge = "Z".repeat(2_000_000);
    const report = injectFreeForm(exit1Report(), huge);
    const out = renderReportHtml(report);
    expect(violations(out)).toEqual([]);
    expect(out).toContain("more characters not shown; the full value is in report.json");
    expect(out.length).toBeLessThan(8_000_000);
    expect(out).not.toContain("Z".repeat(4001));
  });
});

describe("invisible and reordering characters are made visible", () => {
  it("bidi overrides, zero-width characters and NUL are shown as [U+XXXX] in the rendered text", () => {
    const attack = `${String.fromCodePoint(0x202e)}fdp.exe${String.fromCodePoint(0x200b)}${String.fromCodePoint(0)}`;
    const out = renderReportHtml(injectFreeForm(exit1Report(), attack));
    expect(out).toContain("[U+202E]fdp.exe[U+200B][U+0000]");
    for (const cp of [0x202e, 0x200b, 0]) expect(out.includes(String.fromCodePoint(cp))).toBe(false);
  });
});

describe("negative control: the safety checks detect an unsafe renderer", () => {
  it("flags markup that a naive string-concatenating renderer would emit", () => {
    const naive = (value: string): string =>
      `<!doctype html>\n<html lang="en"><head><title>t</title></head><body><table><tr><td class="${value}">${value}</td></tr></table></body></html>\n`;
    for (const attack of [
      "<script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      '" onmouseover="alert(1)',
      "<a href=\"javascript:alert(1)\">x</a>",
      "<!-- x -->",
    ]) {
      expect(violations(naive(attack)).length, attack).toBeGreaterThan(0);
    }
    expect(violations(naive("plain text"))).not.toEqual([]); // no stylesheet / CSP: also flagged
  });

  it("the real renderer output is clean for a benign report (the control is not vacuous)", () => {
    expect(violations(renderReportHtml(exit1Report()))).toEqual([]);
  });
});
