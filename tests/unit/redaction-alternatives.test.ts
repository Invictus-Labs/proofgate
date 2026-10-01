/**
 * Review round 5 (tests P1 and P2): multi-line YAML flow lists and blank lines inside a block list leaked, and 22 of 41 hand-made
 * leak-direction mutants of the round-4 redactor survived the named tests because nothing exercised the alternative they removed.
 * This file has ONE leak test per constant or alternative the reviewer removed (in text and, where it applies, as an object), at JSON
 * nesting depth 0 to 8 where the form can be nested, and the multi-line list forms.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, isSensitiveKey, redactString, redactValue } from "../../src/redact.js";
import { DEPTHS, nest } from "../helpers/redaction-templates.js";

const S = "Zx9qLm3vRt7wKp2N";
const noLeak = (text: string, depths: readonly number[] = DEPTHS): void => {
  for (const k of depths) {
    const out = redactString(nest(text, k));
    expect(out.includes(S), `depth ${k}: ${JSON.stringify(out).slice(0, 120)}`).toBe(false);
    expect(redactString(out), `depth ${k}: not a fixed point`).toBe(out);
  }
};

describe("multi-line flow lists and block lists with blank or comment lines", () => {
  const LISTS: Array<[string, string]> = [
    ["a flow list continued on an indented line", `password: [a, b\n  c, ${S}]\nnext: 1`],
    ["a flow list whose items sit on their own lines", `passwords: [alpha,\n  ${S}]\nnext: 1`],
    ["a flow list with quoted items, one per line", `password: [\n  "${S}",\n  "x"\n]\nnext: 1`],
    ["a nested multi-line flow list", `password: [[a,\n  b], [c,\n  ${S}]]\nnext: 1`],
    ["a block list with a blank line before the secret", `password:\n  - a\n\n  - ${S}\nnext: 1`],
    ["a block list with a comment line before the secret", `password:\n  - a\n  # note\n  - ${S}\nnext: 1`],
    ["a block list with a blank and a comment line", `password:\n  - a\n\n  # note\n  - ${S}\nnext: 1`],
    ["a tab after the list dash", `password:\n  -\t${S}\nnext: 1`],
    ["a flow list as a later dash item", `password:\n  - a\n  - [b, ${S}]\nnext: 1`],
    ["a multi-line flow list as a later dash item", `password:\n  - a\n  - [b,\n    ${S}]\nnext: 1`],
  ];
  for (const [name, text] of LISTS) it(name, () => noLeak(text));

  it("what follows a closed multi-line list is kept, and an unclosed one ends at its first line", () => {
    expect(redactString(`password: [a, b\n  c, ${S}]\nkeepmarker: 1`)).toBe(`password: ${REDACTED}\nkeepmarker: 1`);
    expect(redactString(`password: [a, b\nkeepmarker: 1`)).toContain("keepmarker");
    expect(redactString(`password: [a, b\nkeepmarker: 1`)).not.toContain("password: [a");
  });

  it("controls: a list under a name that is not a credential is unchanged, however many lines it has", () => {
    for (const text of ["tags: [a, b,\n  c, d]\nnext: 1", "items:\n  - a\n\n  - b\n", "note: [x,\n y]"]) expect(redactString(text), text).toBe(text);
  });
});

describe("escapes that stand for a line break or a blank, in front of and after a key", () => {
  const CASES: Array<[string, string]> = [
    ["an encoded CRLF and an indent after the colon", `password:%0D%0A  ${S}\nnext: 1`],
    ["a unicode-escaped line break after the colon", `password:\\u000a  ${S}`],
    ["a hex-escaped line break before the name", `a\\x0apwd=${S}`],
    ["a hex-escaped space before the name", `a\\x20token=${S}`],
    ["a backspace escape before the name", `a\\bpwd=${S}`],
    ["a form-feed escape before the name", `a\\fpwd=${S}`],
    ["a vertical-tab escape before the name", `a\\vpwd=${S}`],
    ["an encoded newline and indent (lowercase hex)", `password:%0a%20%20${S}`],
    ["encoded brackets and quotes around a list pair", `%5B%22--password%22%2C%22${S}%22%5D`],
    ["a space before the comma of a list pair", `["--password" , "${S}"]`],
  ];
  for (const [name, text] of CASES) it(name, () => noLeak(text));
});

describe("pair labels: judged as written and as redacted, and of any length", () => {
  it("a label made of `pass` and a token is a credential label as an object and as text", () => {
    const label = ["pass", "ghp", "_", "0123456789abcdefghijklmnopqrstuvwxyzAB"].join("");
    expect(JSON.stringify(redactValue({ name: label, value: S }))).not.toContain(S);
    expect(JSON.stringify(redactValue({ value: S, name: label }))).not.toContain(S);
    noLeak(JSON.stringify({ name: label, value: S }));
  });

  it.each(["AWS_SECRET_ACCESS_KEY", "SOME_VERY_LONG_ENVIRONMENT_VARIABLE_NAME_PASSWORD", "spring.datasource.hikari.data-source-properties.password", `${"x".repeat(45)}_password`])("a label of %d characters", (label) => {
    expect(JSON.stringify(redactValue({ name: label, value: S }))).not.toContain(S);
    noLeak(JSON.stringify({ name: label, value: S }));
    noLeak(JSON.stringify({ value: S, name: label }));
  });

  it("the value key is found 1,000 characters away, in both orders (the window is 4 KiB)", () => {
    const gap = "g".repeat(1000);
    noLeak(JSON.stringify({ name: "DB_PASSWORD", gap, value: S }));
    noLeak(JSON.stringify({ value: S, gap, name: "DB_PASSWORD" }));
  });

  it("a quote inside an escaped value is part of the value (the tail is not left)", () => {
    for (const k of [1, 2, 3, 4]) {
      const out = redactString(nest(JSON.stringify({ password: `Zx9q"Lm3vRt7wKp2N` }), k));
      expect(out.includes("Lm3vRt7wKp2N"), `depth ${k}`).toBe(false);
    }
  });
});

describe("key names that the whole-key and suffix rules must keep finding", () => {
  it.each(["hmacKey", "botKey", "licenseKey", "jwtKey", "serverpass", "serverPass", "dbpass", "userpwd", "AWS_SECRET_ACCESS_KEY"])("%s is a credential key, as an object key and as text", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
    expect(JSON.stringify(redactValue({ [key]: S }))).not.toContain(S);
    noLeak(`${key}=${S}`);
    noLeak(JSON.stringify({ [key]: S }));
  });
});
