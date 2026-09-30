/**
 * Review round 1, S2: the terminal neutraliser itself (the CLI behaviour is in round1-terminal.test.ts).
 * The module does not exist on the delivered tree, so these tests fail there.
 */
import { describe, expect, it } from "vitest";
import { escapeJsonForTerminal, neutralize } from "../../src/terminal.js";

const ESC = String.fromCharCode(0x1b);
const CSI8 = String.fromCharCode(0x9b);
const BEL = String.fromCharCode(0x07);
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);

describe("neutralize", () => {
  it.each([
    [`${ESC}[2J`, "[U+001B][2J"],
    [`a${CSI8}31mb`, "a[U+009B]31mb"],
    [`x${BEL}y`, "x[U+0007]y"],
    ["line1\nline2", "line1[U+000A]line2"],
    ["a\rb", "a[U+000D]b"],
    ["a\tb", "a[U+0009]b"],
    [`${RLO}evil`, "[U+202E]evil"],
    [`a${ZWSP}b`, "a[U+200B]b"],
    ["nul\u0000end", "nul[U+0000]end"],
    ["del\u007fx", "del[U+007F]x"],
  ])("shows %j as visible text", (input, expected) => {
    expect(neutralize(input)).toBe(expected);
  });

  it("leaves ordinary text, punctuation and non-ASCII letters alone, and bounds very long strings visibly", () => {
    expect(neutralize("REQ-001: Checkout (v2) [ok] café 日本語")).toBe("REQ-001: Checkout (v2) [ok] café 日本語");
    expect(neutralize(42)).toBe("42");
    const long = neutralize("x".repeat(10_000));
    expect(long.length).toBeLessThan(4200);
    expect(long).toContain("more characters not shown");
  });
});


describe("escapeJsonForTerminal", () => {
  it("escapes bidi, zero-width, C1 and separator characters (astral ones as surrogate pairs) and parses back to the same value", () => {
    const value = { a: `x${RLO}y${ZWSP}z${CSI8}`, b: "line\nbreak", c: String.fromCodePoint(0xe0041) + "ok" + String.fromCharCode(0x2028) };
    const text = escapeJsonForTerminal(JSON.stringify(value, null, 2));
    expect([...text].every((ch) => (ch.codePointAt(0) as number) < 0x7f || ch === "\n")).toBe(true);
    expect(text).toContain("\\u202e");
    expect(text).toContain("\\udb40\\udc41");
    expect(JSON.parse(text)).toEqual(value);
  });

  it("leaves ordinary text and non-ASCII letters untouched", () => {
    expect(escapeJsonForTerminal(JSON.stringify({ t: "café 日本語 ok" }))).toBe('{"t":"café 日本語 ok"}');
  });
});
