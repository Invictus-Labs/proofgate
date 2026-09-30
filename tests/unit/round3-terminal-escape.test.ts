/**
 * Review round 2: `escapeJsonForTerminal` and the report page's `displayText` built their output one character at a time
 * (`out += ch`), which needs about 46 bytes of heap per character, so `evaluate --json` on a report inside the documented
 * limits aborted V8 at a 256 MB heap. They now rewrite with `String.replace` and array joins. The differential tests below
 * compare the new code with the old per-character implementation (kept here as the reference) on random text, on a chunk
 * boundary, and on lone surrogates. The heap-limited runs are in tests/integration/round3-hostile-memory.test.ts.
 */
import { describe, expect, it } from "vitest";
import { escapeJsonForTerminal, neutralize } from "../../src/terminal.js";
import { MAX_TEXT_LENGTH, displayText } from "../../src/web/safe-html.js";

/** The rewrite ranges of the original implementation (numbers, so no invisible character appears in this file). */
const TERMINAL_UNSAFE: ReadonlyArray<readonly [number, number]> = [
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];
const unicodeEscape = (unit: number): string => `\\u${unit.toString(16).padStart(4, "0")}`;

function referenceEscapeJson(json: string): string {
  let out = "";
  for (const ch of json) {
    const cp = ch.codePointAt(0) as number;
    if (!TERMINAL_UNSAFE.some(([lo, hi]) => cp >= lo && cp <= hi)) out += ch;
    else if (cp > 0xffff) {
      const v = cp - 0x10000;
      out += unicodeEscape(0xd800 + (v >> 10)) + unicodeEscape(0xdc00 + (v & 0x3ff));
    } else out += unicodeEscape(cp);
  }
  return out;
}

const INVISIBLE: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xd800, 0xdfff],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];
function referenceShowInvisible(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0) as number;
    out += INVISIBLE.some(([lo, hi]) => cp >= lo && cp <= hi) ? `[U+${cp.toString(16).toUpperCase().padStart(4, "0")}]` : ch;
  }
  return out;
}

/** Replace every unpaired surrogate with U+FFFD (what `String.prototype.toWellFormed` does, which this build's library target lacks). */
function wellFormed(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      out += text.slice(i, i + 2);
      i += 1;
    } else if (c >= 0xd800 && c <= 0xdfff) out += String.fromCharCode(0xfffd);
    else out += text.charAt(i);
  }
  return out;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Code points around every boundary of the ranges, plus ordinary and astral characters and lone surrogates. */
const INTERESTING = [
  ...[...TERMINAL_UNSAFE, ...INVISIBLE].flatMap(([lo, hi]) => [lo - 1, lo, hi, hi + 1]).filter((cp) => cp >= 0 && cp <= 0x10ffff),
  0x41, 0x7a, 0x20, 0x22, 0x5c, 0xe9, 0x4e2d, 0x1f600, 0x1d11e, 0xd83d, 0xde00, 0xdbff, 0xdc00,
];
function randomText(random: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const cp = INTERESTING[Math.floor(random() * INTERESTING.length)] as number;
    out += cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
  }
  return out;
}

describe("escapeJsonForTerminal is the old per-character rewrite, faster and in bounded memory", () => {
  it("agrees with the reference on 3,000 random texts (boundaries of every range, astral characters, ASCII)", () => {
    const random = rng(7);
    for (let i = 0; i < 3000; i += 1) {
      const text = randomText(random, Math.floor(random() * 60));
      // JSON.stringify never emits a lone surrogate, so the reference is compared on what the CLI really passes in.
      const json = JSON.stringify({ k: wellFormed(text) });
      expect(escapeJsonForTerminal(json), JSON.stringify(text)).toBe(referenceEscapeJson(json));
      expect(JSON.parse(escapeJsonForTerminal(json))).toEqual(JSON.parse(json));
    }
  });

  it("agrees on raw (not well-formed) input too, lone surrogates included", () => {
    const random = rng(11);
    for (let i = 0; i < 1000; i += 1) {
      const text = randomText(random, Math.floor(random() * 40));
      expect(escapeJsonForTerminal(text), JSON.stringify(text)).toBe(referenceEscapeJson(text));
    }
  });

  it("rewrites an astral 'tag' character that straddles a chunk boundary, at every offset around it", () => {
    const chunk = 256 * 1024;
    const tag = String.fromCodePoint(0xe0041);
    for (let shift = -3; shift <= 3; shift += 1) {
      const json = `${"a".repeat(chunk - 1 + shift)}${tag}${"b".repeat(50)}`;
      const out = escapeJsonForTerminal(json);
      expect(out.includes(tag), `shift ${shift}`).toBe(false);
      expect(out).toBe(referenceEscapeJson(json));
    }
  });

  it("a long text with unsafe characters in every chunk is rewritten completely", () => {
    const zero = String.fromCharCode(0x200b);
    const bidi = String.fromCharCode(0x202e);
    const json = `"${("x".repeat(9999) + zero + "y".repeat(9999) + bidi).repeat(60)}"`;
    const out = escapeJsonForTerminal(json);
    expect(out).toBe(referenceEscapeJson(json));
    expect(out).not.toContain(zero);
    expect(out).not.toContain(bidi);
  });

  it("leaves safe text alone and returns quickly for a 20 MB document", () => {
    const json = JSON.stringify({ note: "plain text ".repeat(2_000_000) });
    const t0 = performance.now();
    expect(escapeJsonForTerminal(json)).toBe(json);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});

describe("displayText and neutralize (report page and terminal text)", () => {
  it("agree with the old per-character implementation on random text, cut at the display limit as before", () => {
    const random = rng(23);
    for (let i = 0; i < 3000; i += 1) {
      const text = randomText(random, Math.floor(random() * 80));
      expect(displayText(text), JSON.stringify(text)).toBe(referenceShowInvisible(text));
    }
    const long = "é".repeat(MAX_TEXT_LENGTH + 500);
    expect(displayText(long)).toContain("more characters not shown");
  });

  it("neutralize turns tab, CR and LF into visible markers on top of the page rules", () => {
    expect(neutralize("a\tb\r\nc")).toBe("a[U+0009]b[U+000D][U+000A]c");
    expect(neutralize(`x${String.fromCharCode(0x1b)}[31m`)).toBe("x[U+001B][31m");
  });
});
