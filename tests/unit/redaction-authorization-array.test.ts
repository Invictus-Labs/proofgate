/**
 * Found by the final differential against the tree that the round-5 reviewers reviewed: a pretty-printed header dump, an `Authorization` key
 * whose value is an array that starts on the next line (`"Authorization": [` / `  "S"` / `]`, or `Authorization=[` / `S]`), was redacted by that tree and
 * left in the clear by the round-6 redactor: its Authorization branch takes the rest of the LINE ("the scheme and its parameters") before it looks for a
 * bracket, so `[` alone was the value. Every other credential key (`token`, `apikey`, `secret`) reads the whole bracket, and so does `Authorization`
 * now: the value runs through the closing bracket, and never ends earlier than the line.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue } from "../../src/redact.js";
import { nest } from "../helpers/redaction-templates.js";

const S = "Zx9Kq2Wm5Lp";
const KEYS = ["Authorization", "authorization", "AUTHORIZATION", "Proxy-Authorization", "proxy-authorization", "\"Authorization\"", "'Authorization'", "X-Authorization", "userAuthorization"];
const SEPS = [": ", ":", "=", " = ", "="];
const LAYOUTS: Array<[string, (s: string) => string]> = [
  ["bare element on the next line", (s) => `[\n  ${s}\n]`],
  ["bare element, closing bracket glued", (s) => `[\n${s}]`],
  ["quoted element", (s) => `[\n  "${s}"\n]`],
  ["scheme and element", (s) => `[\n  Basic ${s}\n]`],
  ["scheme and element, bracket glued", (s) => `[\n Basic ${s}]`],
  ["two elements", (s) => `[\n  ${s},\n  ${s}\n]`],
  ["CRLF", (s) => `[\r\n  ${s}\r\n]`],
  ["text-written breaks", (s) => `[\\n  ${s}\\n]`],
  ["percent-written breaks", (s) => `[%0A  ${s}%0A]`],
  ["tab-indented", (s) => `[\n\t${s}\n]`],
];

describe("an Authorization key whose array starts on the next line is one value", () => {
  it.each(LAYOUTS)("layout: %s, every key and separator, at nesting depth 0 to 3", (_name, make) => {
    const failures: string[] = [];
    for (const key of KEYS) {
      for (const sep of SEPS) {
        for (const depth of [0, 1, 2, 3]) {
          const text = nest(`${key}${sep}${make(S)}\nnext: 1`, depth);
          const out = redactString(text);
          if (out.includes(S)) failures.push(`leak at depth ${depth}: ${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
          else if (redactString(out) !== out) failures.push(`not a fixed point: ${JSON.stringify(text)}`);
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("the value ends at the closing bracket: the lines after it are their own", () => {
    expect(redactString(`Authorization: [\n  ${S}\n]\nnext: 1`)).toBe(`Authorization: ${REDACTED}\nnext: 1`);
    expect(redactString(`"Authorization": [\n  "${S}"\n],\n"next": 1`)).toBe(`"Authorization": ${REDACTED},\n"next": 1`);
    expect(redactString(`Proxy-Authorization=[\n${S}]\nname=ok`)).toBe(`Proxy-Authorization=${REDACTED}\nname=ok`);
  });

  it("a brace or a parenthesis that starts the value and runs past the line is read whole too", () => {
    expect(redactString(`Authorization: (\n  ${S}\n)\nnext: 1`)).toBe(`Authorization: ${REDACTED}\nnext: 1`);
    expect(redactString(`Authorization={\n  "scheme": "Basic",\n  "credentials": "${S}"\n}\nnext: 1`)).toBe(`Authorization=${REDACTED}\nnext: 1`);
    expect(redactString(`"Authorization": {\n  "a": "${S}"\n}`).includes(S)).toBe(false);
  });

  it("a JSON document written as text, an object and an array of objects", () => {
    const doc = { headers: { Authorization: [S], Accept: ["text/plain"] }, name: "job" };
    const pretty = redactString(JSON.stringify(doc, null, 2));
    expect(pretty.includes(S)).toBe(false);
    expect(pretty).toContain("text/plain");
    expect(pretty).toContain("\"name\": \"job\"");
    const compact = redactString(JSON.stringify(doc));
    expect(compact.includes(S)).toBe(false);
    expect(JSON.stringify(redactValue(doc)).includes(S)).toBe(false);
    expect(JSON.stringify(redactValue([{ Authorization: [S] }, { "proxy-authorization": [`Basic ${S}`] }])).includes(S)).toBe(false);
  });

  it("YAML and environment layouts", () => {
    expect(redactString(`headers:\n  Authorization: [\n    ${S}\n  ]\n  Accept: text/plain`).includes(S)).toBe(false);
    expect(redactString(`headers:\n  Authorization: [\n    ${S}\n  ]\n  Accept: text/plain`)).toContain("Accept: text/plain");
    expect(redactString(`export HTTP_AUTHORIZATION=[\n${S}\n]`).includes(S)).toBe(false);
  });

  it("controls: the one-line array, the block list, the other keys and a scheme on the line keep their behaviour", () => {
    expect(redactString(`Authorization: [ ${S} ]`)).toBe(`Authorization: ${REDACTED}`);
    expect(redactString(`Authorization=[${S}\n]`)).toBe(`Authorization=${REDACTED}`); // (the bracket that closes on the next line is part of the value now)
    expect(redactString(`Authorization:\n  - ${S}`)).toBe(`Authorization:\n  - ${REDACTED}`);
    expect(redactString(`Authorization: Bearer ${S}`)).toBe(`Authorization: ${REDACTED}`);
    expect(redactString(`token: [\n  ${S}\n]`)).toBe(`token: ${REDACTED}`);
    expect(redactString(`apikey=[\n${S}\n]`)).toBe(`apikey=${REDACTED}`);
  });

  it("precision: a bracket that is not an Authorization value's array adds no hit, and an unclosed bracket is read like the one of every other key", () => {
    // no Authorization key
    expect(redactString(`Accept: [\n  text/plain\n]`)).toBe(`Accept: [\n  text/plain\n]`);
    expect(redactString(`headers = [\n  "x-trace"\n]`)).toBe(`headers = [\n  "x-trace"\n]`);
    // the word behind the name is not a key
    expect(redactString(`The Authorization header is [\n  optional\n]`)).toBe(`The Authorization header is [\n  optional\n]`);
    // an unclosed bracket is read like the one of every other key (the first line only), so the Authorization key gains no false hit and no wider reach than `token`
    const unclosed = (key: string) => redactString(`${key}: [\n  ${S}\nnext: 1`).replace(key, "KEY");
    expect(unclosed("Authorization")).toBe(unclosed("token"));
    expect(unclosed("Authorization")).toBe(`KEY: ${REDACTED}\n  ${S}\nnext: 1`);
  });
});
