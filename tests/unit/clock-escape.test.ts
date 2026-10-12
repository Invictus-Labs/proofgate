import { describe, expect, it } from "vitest";
import { resolveNow } from "../../src/clock.js";
import { escapeHtml } from "../../src/escape.js";
import { isUtcTimestamp } from "../../src/schemas.js";

describe("clock", () => {
  const system = () => new Date("2030-01-01T00:00:00Z");
  it("prefers the explicit value, then PROOFGATE_NOW, then the system clock", () => {
    expect(resolveNow("2026-09-29T12:00:00Z", { PROOFGATE_NOW: "2026-01-01T00:00:00Z" }, system).toISOString()).toBe("2026-09-29T12:00:00.000Z");
    expect(resolveNow(undefined, { PROOFGATE_NOW: "2026-01-01T00:00:00Z" }, system).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(resolveNow(undefined, {}, system).toISOString()).toBe("2030-01-01T00:00:00.000Z");
    // Set but empty is an error, not "unset": an exported-but-empty variable must not silently select the system clock.
    expect(() => resolveNow(undefined, { PROOFGATE_NOW: "" }, system)).toThrowError(/PROOFGATE_NOW must be a UTC timestamp/);
  });

  it("reads process.env and the real clock by default", () => {
    expect(resolveNow("2026-09-29T12:00:00Z").getTime()).toBe(Date.parse("2026-09-29T12:00:00Z"));
    expect(Math.abs(resolveNow(undefined, {}).getTime() - Date.now())).toBeLessThan(5000);
  });

  it("accepts only strict UTC instants", () => {
    for (const ok of ["2026-09-29T12:00:00Z", "2026-09-29T12:00:00.5Z", "2026-09-29T12:00:00.123Z", "2024-02-29T00:00:00Z"]) expect(isUtcTimestamp(ok)).toBe(true);
    for (const bad of ["2026-09-29", "2026-09-29T12:00:00", "2026-09-29T12:00:00+00:00", "2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-09-29 12:00:00Z", "2026-09-29T24:00:00Z", "2026-09-29T12:00:00.1234Z", ""]) {
      expect(isUtcTimestamp(bad), bad).toBe(false);
    }
  });
});

describe("escapeHtml", () => {
  it("escapes markup, attribute and template metacharacters", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(escapeHtml(`a&b 'c' \`d\``)).toBe("a&amp;b &#39;c&#39; &#96;d&#96;");
  });
  it("is not double-escaping-safe by design: it escapes ampersands every time", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
  it("coerces non-strings", () => {
    expect(escapeHtml(null)).toBe("null");
    expect(escapeHtml(12)).toBe("12");
  });
});
