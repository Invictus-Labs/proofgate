import { describe, expect, it, vi } from "vitest";

// Seeded negative control: replace escapeHtml with the identity function. The renderer, the strict tokenizer
// and the safety invariants must then FAIL on hostile input, proving the escaping tests are able to fail.
vi.mock("../../src/escape.js", () => ({ escapeHtml: (value: unknown) => String(value) }));

const { renderReportHtml } = await import("../../src/web/render.js");
const { exit1Report } = await import("../helpers/report-fixtures.js");
const { violations } = await import("../helpers/report-invariants.js");

describe("negative control: rendering with escaping disabled is detected", () => {
  it("script tags, attribute breakouts and comments become violations", () => {
    for (const attack of ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "<!-- x -->", "</td></tr></table><h1>x</h1>"]) {
      const base = exit1Report();
      const report = { ...base, requirements: base.requirements.map((d) => ({ ...d, title: attack })) };
      expect(violations(renderReportHtml(report)).length, attack).toBeGreaterThan(0);
    }
  });

  it("a benign report still passes (the control fails only because escaping was removed)", () => {
    expect(violations(renderReportHtml(exit1Report()))).toEqual([]);
  });
});
