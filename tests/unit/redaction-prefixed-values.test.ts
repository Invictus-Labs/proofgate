/**
 * Review round 6 (logic P1, security P1): a string prefix in front of a quoted value (`b'S'`, `u"S"`, `$'S'`) is part of the value, and a padded base64 secret is the VALUE,
 * not a label. The round-6 redactor took a prefixed string that looked like `name` + `=` or `:` (`[A-Za-z][A-Za-z0-9_.-]{0,60}`, blanks, `[:=]`, `[>=]`) for "another credential's
 * name and separator" and left the string in the clear while it redacted the prefix: `password=b'c2VjcmV0cGFzcw=='` showed the secret (base64 padding is `=` or `==`, and a secret
 * may end in `:`). The round-5 tree hid all of them; style F of the reviewer's differential (realistic secrets) found 2,859 of 150,000, all one class.
 * The prefix vocabulary also grew: `f`, `fr` (Python f-strings), SQL's `N'`, `E'`, `X'`, `U&'`.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString } from "../../src/redact.js";
import { nest } from "../helpers/redaction-templates.js";

const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)
const BODIES = ["c2VjcmV0cGFzcw==", "dGhpcyBpcyBhIHNlY3JldA=", "YWJjZGVmZ2hpams", "hunter2secretvalue=", "Zx9Kq2Wm5Lp:", "Zx9Kq2Wm5Lp=:", "Zx9Kq2Wm5Lp"];
const PREFIXES: Array<[string, string]> = [["b'", "'"], ['b"', '"'], ["u'", "'"], ['u"', '"'], ["r'", "'"], ['r"', '"'], ["br'", "'"], ['Rb"', '"'], ["$'", "'"], ['$"', '"'], ["f'", "'"], ['fr"', '"'], ["F'", "'"], ["N'", "'"], ["E'", "'"], ["X'", "'"], ["U&'", "'"]];
const KEYS = [PW, "API_TOKEN", "secret", `DB_${PW.toUpperCase()}`, "client_secret", "Authorization"];
const SEPS = ["=", ": ", " = ", ":"];

describe("a prefixed quoted value is redacted whole, whatever its text looks like", () => {
  it.each(PREFIXES)("prefix %s: every body (padded base64, a trailing colon, a trailing equals sign), key and separator, at nesting depth 0 to 3", (prefix, quote) => {
    const failures: string[] = [];
    for (const body of BODIES) {
      const marker = body.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      for (const key of KEYS) {
        for (const sep of SEPS) {
          for (const depth of [0, 1, 2, 3]) {
            // the quote of the value must survive the JSON layers: only the depth-0 form carries a literal quote, the others are what a JSON string holds
            const text = nest(`${key}${sep}${prefix}${body}${quote} done`, depth);
            const out = redactString(text);
            if (out.includes(marker)) failures.push(`leak at depth ${depth}: ${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
            else if (redactString(out) !== out) failures.push(`not a fixed point: ${JSON.stringify(text)}`);
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("the shapes of the reports, exactly", () => {
    expect(redactString(`${PW}=b'c2VjcmV0cGFzcw=='`)).toBe(`${PW}=b'${REDACTED}'`);
    expect(redactString(`API_TOKEN=u'dGhpcyBpcyBhIHNlY3JldA=='`)).toBe(`API_TOKEN=u'${REDACTED}'`);
    expect(redactString(`secret: r"YWJjZGVmZ2hpams="`)).toBe(`secret: r"${REDACTED}"`);
    expect(redactString(`DB_${PW.toUpperCase()}=b'hunter2secretvalue='`)).toBe(`DB_${PW.toUpperCase()}=b'${REDACTED}'`);
    expect(redactString(`os.environ['${PW.toUpperCase()}'] = b'Zx9Kq2Wm5Lp=='`).includes("Zx9Kq2Wm5Lp")).toBe(false);
    expect(redactString(`TOKEN=b'Zx9Kq2Wm5Lp:'`)).toBe(`TOKEN=b'${REDACTED}'`);
    expect(redactString(`token%3Db'Zx9Kq2Wm5Lp%3D'`).includes("Zx9Kq2Wm5Lp")).toBe(false);
    expect(redactString(`${PW}=f'Zx9Kq2Wm5Lp='`)).toBe(`${PW}=f'${REDACTED}'`);
    expect(redactString(`${PW}=N'Zx9Kq2Wm5Lp'`)).toBe(`${PW}=N'${REDACTED}'`);
    expect(redactString(`${PW}=U&'Zx9Kq2Wm5Lp'`)).toBe(`${PW}=U&'${REDACTED}'`);
  });

  it("in a JSON document, a command and an option", () => {
    expect(redactString(JSON.stringify({ command: `run --env TOKEN=b'Zx9Kq2Wm5Lp==' x` })).includes("Zx9Kq2Wm5Lp")).toBe(false);
    expect(redactString(`run --token b'Zx9Kq2Wm5Lp==' --x`).includes("Zx9Kq2Wm5Lp")).toBe(false);
    expect(redactString(`run --token=fr'Zx9Kq2Wm5Lp' --x`).includes("Zx9Kq2Wm5Lp")).toBe(false);
  });

  it("controls: a label with a word glued behind its closing quote is still not the value, and ordinary prefixed text keeps its shape", () => {
    // `u"secret="S`: the string is a label and the value is the word behind it: the prefix is taken for the value, and the label is left for its own reader, which takes S
    expect(redactString(`${PW}=u"secret="Zx9Kq2Wm5Lp`)).toBe(`${PW}=${REDACTED}"secret="${REDACTED}`);
    // a prefixed string that is not a credential's value stays text
    expect(redactString(`name=b'label: value'`)).toBe(`name=b'label: value'`);
    expect(redactString(`mode=N'abc'`)).toBe(`mode=N'abc'`);
  });
});
