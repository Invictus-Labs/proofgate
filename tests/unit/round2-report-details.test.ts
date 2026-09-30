/**
 * Review round 1 (conformance): at 375 px the unsatisfied report was about 20,900 px tall, most of it requirement details
 * stacked into cards. The page has no script, so it cannot collapse by width; each requirement's details are a native
 * disclosure instead: a cleanly passing requirement is folded to one line, everything else is open, and the one-line summary
 * always carries every repository status as text, so folding never hides a status.
 */
import { describe, expect, it } from "vitest";
import { STATUSES } from "../../src/schemas.js";
import { renderReportHtml } from "../../src/web/render.js";
import { exit0Report, exit1Report } from "../helpers/report-fixtures.js";

const detailsBlocks = (page: string): Array<{ open: boolean; summary: string; body: string }> =>
  [...page.matchAll(/<details class="detail"( open)?>\n<summary>(.*?)<\/summary>\n([\s\S]*?)<\/details>/g)].map((m) => ({ open: m[1] !== undefined, summary: m[2] as string, body: m[3] as string }));

describe("requirement details are disclosures that never hide a status", () => {
  it("one disclosure per requirement; a clean PASS is closed, every other status is open", () => {
    const report = exit1Report();
    const blocks = detailsBlocks(renderReportHtml(report));
    expect(blocks.length).toBe(report.requirements.length);
    report.requirements.forEach((d, i) => {
      const block = blocks[i]!;
      const clean = d.status === "PASS" && d.rejected_receipts.length === 0;
      expect(block.open, `${d.id} ${d.status}`).toBe(!clean);
    });
    expect(new Set(report.requirements.map((d) => d.status)).size).toBeGreaterThan(3);
  });

  it("the summary line of every disclosure names each repository and its status as text", () => {
    for (const report of [exit1Report(), exit0Report()]) {
      const blocks = detailsBlocks(renderReportHtml(report));
      report.requirements.forEach((d, i) => {
        const summary = blocks[i]!.summary;
        for (const p of d.per_repository) {
          expect(summary, `${d.id}`).toContain(`<code>${p.repository}</code> ${p.status}`);
          expect(STATUSES).toContain(p.status);
        }
      });
    }
  });

  it("closed disclosures still contain their tables (folded, not removed)", () => {
    const blocks = detailsBlocks(renderReportHtml(exit0Report()));
    const closed = blocks.filter((b) => !b.open);
    expect(closed.length).toBeGreaterThan(0);
    for (const b of closed) expect(b.body).toContain("Evidence per repository for");
  });
});
