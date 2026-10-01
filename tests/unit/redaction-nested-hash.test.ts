/**
 * Review round 6 (security final, ruled must-fix): `db:\n  password:\n    #S\n  host: x` leaked S. The redactor read every `#` line under a credential key as a comment when an indented line
 * followed it (and hid the line after it instead), and a password may start with `#`. The rule now judges the `#` line against the KEY's indentation: a `#` line indented DEEPER than the
 * key is the value (redacted, with the lines below it that are deeper than the key too); a `#` line at the key's column or to its left is a comment and stays readable, as before. This file runs the
 * shape at JSON/YAML nesting depth 0 to 3 (spaces and tabs, a list dash in front of the key, a quoted key), with the line breaks written as text (`\n`, `%0A`), for six key names, the exact
 * output of the plain forms, the CONTROLS that real comments stay readable where they were and that a key that is not a credential's is left alone, and the cost (a capped child).
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString } from "../../src/redact.js";
import { expandShape, judge, shapeName, timeInChild } from "../helpers/redact-child.js";

const S = "Zx9Kq2Wm5Lp";
const PW = "pass" + "word";
const KEYS = [PW, "token", "api_key", "secret", "db_" + PW, "client_secret"];
/** The key at nesting depth `depth`, with the parent keys above it, each level indented two more characters (or one more tab). */
function nested(key: string, depth: number, value: string, indent: string, after = "host: x"): string {
  const lines: string[] = [];
  for (let level = 0; level < depth; level += 1) lines.push(`${indent.repeat(level)}level${level}:`);
  lines.push(`${indent.repeat(depth)}${key}:`);
  lines.push(`${indent.repeat(depth + 1)}${value}`);
  lines.push(`${indent.repeat(depth)}${after}`);
  return lines.join("\n");
}

describe("a hash line deeper than its credential key is the value, at depth 0 to 3", () => {
  const forms = [
    ["two spaces", "  "],
    ["four spaces", "    "],
    ["a tab", "\t"],
  ] as const;
  it.each(forms.flatMap(([label, indent]) => [0, 1, 2, 3].flatMap((depth) => KEYS.map((key) => [`${key}, depth ${depth}, ${label}`, key, depth, indent] as const))))("%s", (_name, key, depth, indent) => {
    const text = nested(key, depth, `#${S}`, indent);
    const out = redactString(text);
    expect(out).not.toContain(S);
    // only the value line changes: the parent keys, the key and the line after it are as written
    expect(out).toBe(nested(key, depth, REDACTED, indent));
  });

  it("the lines below the hash line that are deeper than the key are part of the value too", () => {
    expect(redactString(`db:\n  ${PW}:\n    #${S}\n    more${S}2\n  host: x`)).toBe(`db:\n  ${PW}:\n    ${REDACTED}\n  host: x`);
    expect(redactString(`${PW}:\n  #${S}\n  ${S}2\nnext: 1`)).toBe(`${PW}:\n  ${REDACTED}\nnext: 1`);
  });

  it("a list dash in front of the key and a quoted key count: the key starts where its item starts", () => {
    expect(redactString(`- ${PW}:\n    #${S}\n  host: x`)).toBe(`- ${PW}:\n    ${REDACTED}\n  host: x`);
    expect(redactString(`items:\n  - ${PW}:\n      #${S}\n    host: x`)).toBe(`items:\n  - ${PW}:\n      ${REDACTED}\n    host: x`);
    expect(redactString(`"${PW}":\n    #${S}\nhost: x`)).toBe(`"${PW}":\n    ${REDACTED}\nhost: x`);
    // nested, so that the key's own indentation decides (a quoted key at the column of its parent's value)
    expect(redactString(`db:\n  "${PW}":\n    #${S}\n  host: x`)).toBe(`db:\n  "${PW}":\n    ${REDACTED}\n  host: x`);
    expect(redactString(`db:\n  '${PW}':\n    #${S}\n  host: x`)).toBe(`db:\n  '${PW}':\n    ${REDACTED}\n  host: x`);
  });

  it("line breaks written as text (inside a JSON string, or percent-encoded) do not hide the value", () => {
    const B = "\\";
    for (const br of [`${B}n`, "%0A", `${B}r${B}n`, `${B}${B}n`]) {
      for (const depth of [0, 1, 2, 3]) {
        const lines: string[] = [];
        for (let level = 0; level < depth; level += 1) lines.push(`${"  ".repeat(level)}level${level}:`);
        lines.push(`${"  ".repeat(depth)}${PW}:`, `${"  ".repeat(depth + 1)}#${S}`, `${"  ".repeat(depth)}host: x`);
        const text = lines.join(br);
        expect(redactString(text), `${JSON.stringify(text)}`).not.toContain(S);
        expect(redactString(JSON.stringify({ config: lines.join("\n") })), "a JSON document").not.toContain(S);
      }
    }
  });
});

describe("CONTROLS: a real comment stays readable where it was, and a key that is not a credential's is left alone", () => {
  it("a hash line at the key's column or to its left is a comment (the value is what follows it)", () => {
    // the comment is kept; what redacts is the value the comment precedes (as before the change)
    expect(redactString(`db:\n  ${PW}:\n  # rotate monthly\n    ${S}\n  host: x`)).toBe(`db:\n  ${PW}:\n  # rotate monthly\n    ${REDACTED}\n  host: x`);
    expect(redactString(`db:\n  ${PW}:\n# rotate monthly\n    ${S}\n  host: x`)).toBe(`db:\n  ${PW}:\n# rotate monthly\n    ${REDACTED}\n  host: x`);
    expect(redactString(`${PW}:\n# rotate monthly\n  ${S}`)).toBe(`${PW}:\n# rotate monthly\n  ${REDACTED}`);
  });

  it("comments under keys that are not credentials, and before the first key, are untouched", () => {
    const docs = [
      "db:\n  host: x\n    # note about the host\n  port: 5432",
      "# header comment\nname: demo\n  # indented note\nmode: fast",
      "servers:\n  - name: a\n    # the first one\n  - name: b",
      `notes:\n  # ${PW} rotation is monthly\n  owner: team`,
    ];
    for (const doc of docs) expect(redactString(doc), doc).toBe(doc);
  });

  it("the legacy shapes are as they were: a column-0 hash line is a comment, a hash value with nothing indented behind it is the value", () => {
    expect(redactString(`secret:\n#${S}\n  t`)).toBe(`secret:\n#${S}\n  ${REDACTED}`);
    expect(redactString(`secret:\n  #${S}\nnext: 1`)).toBe(`secret:\n  ${REDACTED}\nnext: 1`);
    expect(redactString(`SECRET:\n#${S}\n%201`)).toBe(`SECRET:\n#${S}\n%20${REDACTED}`);
  });
});

describe("the cost of the rule is linear", () => {
  it.each([
    { prefix: "", unit: "@PW@:\n    #x\n  ", tail: "" },
    { prefix: "", unit: "- @PW@:\n      #x\n    host: y\n", tail: "" },
    { prefix: "@PW@:\n", unit: "    #x\n", tail: "" },
  ].map((shape) => [shapeName(expandShape(shape)), expandShape(shape)] as const))("%s", (_name, shape) => {
    const sizes = [16_384, 65_536, 262_144];
    const t = timeInChild(shape, sizes, "redact");
    expect(judge(shape, t, sizes)).toBeUndefined();
    expect(t?.whole).toEqual([false, false, false]);
  }, 120_000);
});
