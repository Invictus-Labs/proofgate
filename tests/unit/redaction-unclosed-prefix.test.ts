/**
 * Found by the differential against the tree that the round-5 reviewers reviewed: a quote that never closes after a Python string prefix or a
 * shell `$` (`password=b'S`, `token: u"S`, `api_key=$'S`, the secret being the last thing in the text or in its line) was redacted by that
 * tree (to the end of the line) and left in the clear by the round-6 redactor: its prefix rule skipped `b'` only when a closing quote existed,
 * so with none the value was the letter `b` and the secret stayed. A truncated log or receipt command leaves exactly such a quote. A plain unclosed
 * quote (`password='S`) was always redacted to the end of its line; now the prefixed one is too. A closing quote on a LATER line (the dangling
 * prefix of the no-regression fixtures) is still not a closing quote of the value.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString } from "../../src/redact.js";
import { nest } from "../helpers/redaction-templates.js";

const S = "Zx9Kq2Wm5Lp";
const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)

const PREFIXES = ["b'", 'u"', "$'", 'B"', "br'", 'R"', "$\""];
const SEPS = ["=", ": ", " = ", ":"];
const KEYS = [PW, "token", "api_key", "secret", `DB_${PW.toUpperCase()}`, "client_secret", "Authorization"];
const TAILS = ["", "\nnext: 1", " tail words", "\n  next: 1\nmore: 2"];

describe("a quote that never closes after a Python prefix or a shell $ is a value to the end of its line", () => {
  it.each(PREFIXES)("prefix %s: every key, separator and tail, at nesting depth 0 to 3", (prefix) => {
    const failures: string[] = [];
    for (const key of KEYS) {
      for (const sep of SEPS) {
        for (const tail of TAILS) {
          for (const depth of [0, 1, 2, 3]) {
            const text = nest(`${key}${sep}${prefix}${S}${tail}`, depth);
            const out = redactString(text);
            if (out.includes(S)) failures.push(`leak at depth ${depth}: ${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
            else if (redactString(out) !== out) failures.push(`not a fixed point: ${JSON.stringify(text)}`);
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("the value ends at the end of its line, the next line is its own", () => {
    expect(redactString(`${PW}=b'${S}\nnext: 1`)).toBe(`${PW}=b'${REDACTED}\nnext: 1`);
    expect(redactString(`token: u"${S} x\nother: y`)).toBe(`token: u"${REDACTED}\nother: y`);
  });

  it("after an option, in a JSON string and with a text-written line break behind it", () => {
    expect(redactString(`run --${PW} b'${S}`).includes(S)).toBe(false);
    expect(redactString(JSON.stringify({ command: `x ${PW}=u"${S}` })).includes(S)).toBe(false);
    expect(redactString(`${PW}=b'${S}\\nnext=1`).includes(S)).toBe(false);
  });

  it("a closing quote on a LATER line is not the closing quote of the value (the round-5 redactor hid these too)", () => {
    expect(redactString(`${PW}=b'${S}\nother='x'`)).toBe(`${PW}=b'${REDACTED}\nother='x'`);
    expect(redactString(`${PW}=u"${S} rest\nlog: it's fine`)).toBe(`${PW}=u"${REDACTED}\nlog: it's fine`);
    expect(redactString(`${PW}=u"${S}\nname="x"`)).toBe(`${PW}=u"${REDACTED}\nname="x"`);
    expect(redactString(`${PW}=b'${S}\nx=b'y'`)).toBe(`${PW}=b'${REDACTED}\nx=b'y'`);
  });

  it("a prefixed string that CLOSES is redacted whatever is glued behind its closing quote (the round-5 redactor hid these; a whitelist of following characters lost them)", () => {
    const glued = ["\"", "'", "|", "&", "%", "<", "@", "e", "0", ".decode()", "/rest", ":1", `${"\\"}n`, `${"\\"}"`, "#x", "}", "]", ")", ",", ";", " "];
    const failures: string[] = [];
    for (const prefix of ["b'", 'u"', "$'", "br'"]) {
      const quote = prefix.endsWith('"') ? '"' : "'";
      for (const key of [PW, "token", "api_key"]) {
        for (const tail of glued) {
          const text = `${key}=${prefix}${S}${quote}${tail}`;
          const out = redactString(text);
          if (out.includes(S)) failures.push(`${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    // a Python repr inside a JSON string: the closing quote of the JSON string stands right behind the closing quote of the value
    expect(redactString(JSON.stringify({ command: `login token=b'${S}'` })).includes(S)).toBe(false);
    expect(redactString(JSON.stringify({ command: `login token=u"${S}"` })).includes(S)).toBe(false);
  });

  it("controls: a prefixed string that closes on its line, a plain unclosed quote and a dangling prefix keep their behaviour", () => {
    expect(redactString(`${PW}=b'${S}' tail`)).toBe(`${PW}=b'${REDACTED}' tail`);
    expect(redactString(`${PW}='${S}`)).toBe(`${PW}='${REDACTED}`);
    // a prefix and a quote with nothing behind them are a word and a quote, not a value; a closing quote on a later line does not close it
    const out = redactString(`${PW}=b'\n${PW}2="${S}"`);
    expect(out.includes(S)).toBe(false);
    expect(out).toContain(`${PW}=b'\n`);
    expect(redactString(`x=b'abc\nname='ok'`)).toBe(`x=b'abc\nname='ok'`);
  });
});
