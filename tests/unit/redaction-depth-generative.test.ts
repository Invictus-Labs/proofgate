/**
 * Review round 4 (security P1s, conformance F1): three review rounds found the same family of holes in new shapes, each
 * time a cap or a special case (an escaped quote up to 8 backslashes, an escaped newline as a separator, a value that itself
 * holds a quote). The rules are now general, and this file proves them the way a point fix cannot be proven: for EVERY
 * planted secret, in EVERY embedding template, at EVERY depth of JSON string nesting k = 0..8 (the text is JSON-stringified k
 * times, so a quote carries 2^k - 1 backslashes), no piece of the secret may survive, and redacting the result again must
 * change nothing. Markers are alphanumeric, so escaping cannot hide them from the check. Over-redaction is allowed (a value
 * that cannot be delimited is consumed to the end of its line: fail closed); a leaked tail is not.
 */
import { describe, expect, it } from "vitest";
import { redactString } from "../../src/redact.js";
import { DEPTHS, TEMPLATES, nest, secrets } from "../helpers/redaction-templates.js";

describe("every secret, in every template, at JSON nesting depth 0 to 8, is gone and the result is a fixed point", () => {
  for (const template of TEMPLATES) {
    it(template.name, () => {
      let n = 0;
      for (const secret of secrets(template.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6))) {
        // A secret holding a quote or a backslash cannot be written into an unquoted template without changing what it means.
        if (!template.quoted && !secret.plain) continue;
        for (const k of DEPTHS) {
          n += 1;
          const text = `log ${nest(template.make(secret.value), k)} end`;
          const out = redactString(text);
          for (const marker of secret.markers) expect(out.includes(marker), `${template.name} / ${secret.label} / depth ${k}: ${marker} survives in ${out.slice(0, 300)}`).toBe(false);
          expect(redactString(out) === out, `${template.name} / ${secret.label} / depth ${k}: not a fixed point`).toBe(true);
        }
      }
      expect(n).toBeGreaterThan(8);
    });
  }

  it("control: a non-secret key keeps its value at every depth (the rules are not 'redact everything')", () => {
    for (const k of DEPTHS) {
      const text = `log ${nest(JSON.stringify({ summary: "KEEPME55", note: "plain words here" }), k)} end`;
      const out = redactString(text);
      expect(out.includes("KEEPME55"), `depth ${k}: ${out}`).toBe(true);
      expect(out.includes("plain words here"), `depth ${k}`).toBe(true);
    }
  });
});

describe("a value that itself contains a quote, at depth 1 to 3 (conformance F1: 15 of 32 shapes leaked their tail)", () => {
  const shapes: Array<[string, string]> = [
    ["quote inside", 'ab"cdTAILSECRET99'],
    ["quote at the start", '"TAILSECRET99'],
    ["two quotes", 'a"b"TAILSECRET99'],
    ["backslash then quote", 'a\\"TAILSECRET99'],
    ["space then quote", 'a "TAILSECRET99'],
    ["quote at the end", 'HEADSECRET77TAILSECRET99"'],
  ];
  it.each(shapes)("%s", (_label, value) => {
    for (const depth of [0, 1, 2, 3]) {
      const text = `run --log ${nest(JSON.stringify({ password: value, user: "svc" }), depth)} done`;
      const out = redactString(text);
      expect(out.includes("TAILSECRET99"), `depth ${depth}: ${out}`).toBe(false);
      expect(redactString(out) === out, `depth ${depth}: not a fixed point`).toBe(true);
    }
  });
});

describe("the value ends where its closing quote is (precision: what follows a redacted value is kept)", () => {
  // A value that ends in backslashes is closed by a run of r + c*(r+1) backslashes with c even; treating only a run of exactly r
  // as the close would swallow the rest of the line (never a leak, but the report would lose the fields after the secret).
  it.each([
    ["one trailing backslash", "HEADsecret77\\"],
    ["two trailing backslashes", "HEADsecret77\\\\"],
    ["a quote and a backslash at the end", 'HEADsecret77"\\'],
    ["no special character", "HEADsecret77"],
  ])("%s", (_label, value) => {
    for (const depth of [0, 1, 2, 3, 4]) {
      const text = `log ${nest(JSON.stringify({ password: value, keep: "KEEPME55", alsoKeep: "KEEPME66" }), depth)} end`;
      const out = redactString(text);
      expect(out.includes("HEADsecret77"), `depth ${depth}: the secret survives in ${out}`).toBe(false);
      expect(out.includes("KEEPME55") && out.includes("KEEPME66"), `depth ${depth}: the fields after the secret were swallowed: ${out}`).toBe(true);
      // EXACTLY the text with the value replaced and nothing else touched: a value that runs on past its own closing quote to the
      // next quote would leave the fields but eat the punctuation between them.
      const expected = `log ${nest(JSON.stringify({ password: "[REDACTED]", keep: "KEEPME55", alsoKeep: "KEEPME66" }), depth)} end`;
      expect(out, `depth ${depth}`).toBe(expected);
    }
  });
});

describe("mixed depths and ambiguous quote runs fail closed (the value runs on to the end of its line, never less)", () => {
  const S = "Hs5Zq9MixedSecretXy";
  it.each([
    ["key at depth 1, value at depth 2", `x \\"password\\": \\\\\\"${S}\\\\\\", \\"user\\": \\"svc\\"`],
    ["key at depth 0, value at depth 1", `x "password": \\"${S}\\", "user": "svc"`],
    ["key at depth 2, value at depth 0", `x \\\\\\"password\\\\\\": "${S}", "user": "svc"`],
    ["a closing run that does not match the opening run", `x \\"password\\": \\"${S}", \\"user\\": \\"svc\\"`],
    ["a closing run of 2 for an opening run of 1", `x \\"password\\": \\"${S}\\\\", more`],
    ["no closing quote at all", `x "password": "${S} and then nothing`],
  ])("%s", (_label, text) => {
    const out = redactString(text);
    expect(out.includes(S), out).toBe(false);
    expect(redactString(out) === out).toBe(true);
  });
});

describe("runs of 1 to 127 backslashes before a quote (the round-3 cap was 8)", () => {
  it.each([1, 3, 7, 15, 31, 63, 127])("a quoted key and value behind %i backslashes", (run) => {
    const b = "\\".repeat(run);
    const text = `x ${b}"password${b}": ${b}"Hs${run}Zq9RunSecret${b}", ${b}"user${b}": ${b}"svc${b}"`;
    const out = redactString(text);
    expect(out.includes(`Hs${run}Zq9RunSecret`), out.slice(0, 200)).toBe(false);
    expect(redactString(out) === out).toBe(true);
  });

  it("a hostile run of backslashes costs one pass (linear: 4 times the run takes about 4 times as long, not 16)", () => {
    // A ratio, not an absolute bound: the gate runs beside parallel mutant suites, so a wall-clock limit would flake, while a ratio
    // of the same machine at two sizes does not (the fastest of three runs at each size; below the noise floor a ratio means nothing).
    const time = (n: number): number => {
      const text = `password=${"\\".repeat(n)}"x"`;
      let best = Infinity;
      for (let i = 0; i < 3; i += 1) {
        // CPU time of this process (user + system), not wall time: a host that runs other work, or collects garbage in the middle of the larger run, does not move it
        const before = process.cpuUsage();
        redactString(text);
        const used = process.cpuUsage(before);
        best = Math.min(best, (used.user + used.system) / 1000);
      }
      return best;
    };
    const small = time(500_000);
    const large = time(2_000_000);
    expect(large, `${Math.round(small)} ms at 500,000 and ${Math.round(large)} ms at 2,000,000`).toBeLessThanOrEqual(Math.max(7 * small, 50));
    expect(large).toBeLessThan(60_000);
  });
});
