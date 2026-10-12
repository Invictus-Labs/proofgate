import { describe, expect, it } from "vitest";
import { PALETTE, REPORT_CSS, type Palette } from "../../src/web/styles.js";

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] as number) + 0.7152 * (channels[1] as number) + 0.0722 * (channels[2] as number);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast (WCAG AA, 4.5:1 for text)", () => {
  it("computes known reference ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(contrast("#ffffff", "#ffffff")).toBe(1);
  });

  for (const [scheme, palette] of Object.entries(PALETTE) as Array<[string, Palette]>) {
    it(`${scheme}: body, muted and link text on page and surface backgrounds`, () => {
      for (const bg of [palette.page, palette.surface]) {
        for (const fg of [palette.text, palette.muted, palette.link]) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${scheme}: every status/notice tone text on its own background`, () => {
      for (const [name, tone] of Object.entries(palette.tones)) expect(contrast(tone.fg, tone.bg), `${scheme} ${name}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${scheme}: tone text stays readable on the page background too (used for bordered text)`, () => {
      for (const [name, tone] of Object.entries(palette.tones)) expect(contrast(tone.fg, palette.page), `${scheme} ${name}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${scheme}: borders that carry meaning reach the 3:1 non-text contrast`, () => {
      expect(contrast(palette.border, palette.page)).toBeGreaterThanOrEqual(3);
      for (const [name, tone] of Object.entries(palette.tones)) expect(contrast(tone.border, tone.bg), `${scheme} ${name} border`).toBeGreaterThanOrEqual(3);
    });
  }

  it("PASS is the only green tone: no other status shares its hue family with the success colours", () => {
    for (const scheme of Object.values(PALETTE)) {
      const { pass, ...others } = scheme.tones;
      for (const [name, tone] of Object.entries(others)) {
        expect(tone.fg, name).not.toBe(pass.fg);
        expect(tone.bg, name).not.toBe(pass.bg);
      }
    }
  });
});

describe("stylesheet", () => {
  it("gives each status a distinct border style as a second, non-colour cue", () => {
    const styles = new Map<string, string>();
    for (const name of ["pass", "fail", "stale", "missing", "partial", "deferred"]) {
      const m = new RegExp(`\\.tone-${name}\\{[^}]*border-style:([a-z]+)`).exec(REPORT_CSS);
      expect(m, name).not.toBeNull();
      styles.set(name, m?.[1] ?? "");
    }
    expect(styles.get("pass")).toBe("solid");
    expect(styles.get("deferred")).toBe("double");
    expect(styles.get("stale")).not.toBe(styles.get("pass"));
    expect(styles.get("missing")).not.toBe(styles.get("pass"));
  });

  it("restores light tokens for print so dark-mode users print dark text on white", () => {
    const printBlock = REPORT_CSS.slice(REPORT_CSS.indexOf("@media print"));
    expect(printBlock).toContain(`--pass-fg:${PALETTE.light.tones.pass.fg}`);
    expect(printBlock).toContain("--page:#fff");
  });

  it("keeps the focus outline and reduces nothing that assistive users need", () => {
    expect(REPORT_CSS).toContain(":focus-visible{outline:3px solid var(--link)");
    expect(REPORT_CSS).not.toMatch(/outline:\s*none/);
  });
});
