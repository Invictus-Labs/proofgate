/**
 * Review round 5 (tests P2): mutants of the option, user-information and list readers that no test told apart from the original,
 * because another step reads the same text and hides the difference. Each test here pins the exact output (what is kept and what
 * is replaced), or a shape only the mutated reader could get wrong, in text and, where it applies, as an object, at the JSON
 * nesting depths where the form can be nested.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue } from "../../src/redact.js";
import { nest } from "../helpers/redaction-templates.js";

const S = "Zx9qLm3vRt7wKp2N";
const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)

describe("an option value after a spaced equals sign is replaced together with its quotes", () => {
  // The assignment step also reads `--password = "S"` but keeps the quotes around the marker; the option reader replaces the value
  // with its quotes. Both hide the secret, so only the exact output tells the readers apart.
  it.each([
    ["double quotes", `"hunter2 ${S}"`],
    ["single quotes", `'hunter2 ${S}'`],
  ])("%s", (_label, value) => {
    for (const k of [0, 1, 2, 3]) {
      const out = redactString(`run ${nest(`x --password = ${value} y`, k)} end`);
      expect(out.includes(S), `depth ${k}: ${out}`).toBe(false);
      expect(out.includes(`--password = ${REDACTED} y`), `depth ${k}: ${out}`).toBe(true);
    }
  });

  it("with the blanks written the other way round", () => {
    expect(redactString(`x --db-${PW}  =  "${S} b" y`)).toBe(`x --db-${PW}  =  ${REDACTED} y`);
    expect(redactString(`x --client-secret\t=\t'${S} b' y`)).toBe(`x --client-secret\t=\t${REDACTED} y`);
  });
});

describe("a session or CSRF cookie name as a list element names a credential", () => {
  it.each(["PHPSESSID", "csrf", "xsrf", "session", "app_session", "app-sess"])("%s", (name) => {
    expect(redactString(JSON.stringify(["run", name, S])), name).not.toContain(S);
    expect(JSON.stringify(redactValue([name, S])), name).not.toContain(S);
    expect(JSON.stringify(redactValue({ args: ["run", "--cookie", name, S] })), name).not.toContain(S);
  });

  it("control: an ordinary word followed by a value keeps the value", () => {
    expect(redactString(JSON.stringify(["run", "sessions", "KEEPME55"]))).toContain("KEEPME55");
    expect(JSON.stringify(redactValue(["run", "KEEPME55"]))).toContain("KEEPME55");
  });
});

describe("percent escapes in ordinary text keep their escapes (the decoded copy is only returned when it shows a credential)", () => {
  it.each([
    "download my%2Dfile.txt and read notes%5Fv2.md",
    "version 1%2E2%2E3 is out, see /docs/a%2Db/c%2Ed",
    "open C:%5Cusers%5Cshared%5Creport%2Etxt today",
    "GET /search?q=a%20b%2Dc%2Ed&page=2 HTTP/1.1",
    "https://localhost:8080/a%2Fb?x=1%26y=2",
  ])("%s", (text) => {
    expect(redactString(text), text).toBe(text);
  });

  it("a credential behind the same escapes is found, and the result is a fixed point", () => {
    for (const text of [`x%5Cpassword%3D${S}`, `a%2Dfile%2Etxt password%3D${S}`, `%7B%5C%22password%5C%22%3A%5C%22${S}%5C%22%7D`]) {
      const out = redactString(text);
      expect(out.includes(S), text).toBe(false);
      expect(redactString(out), text).toBe(out);
    }
  });
});

describe("user information: a password that holds a slash and the reach of that reading", () => {
  it("an at sign 16 characters past the slash still ends the password (the reach is 512, not a handful of characters)", () => {
    for (const k of [0, 1, 2]) {
      const out = redactString(`url ${nest(`//svc:hd/${S}@host.example/db ok`, k)} end`);
      expect(out.includes(S), `depth ${k}: ${out}`).toBe(false);
      expect(out.includes("@host.example"), `depth ${k}: ${out}`).toBe(true);
    }
  });
});

describe("-u and --user: a quoted user name without a colon is a user name, not a credential", () => {
  it.each([`-u "root"`, `-u 'root'`, `--user "root"`, `--user='root'`, `-u \\"root\\"`])("%s is kept", (flag) => {
    const text = `curl ${flag} http://localhost:8080/x`;
    expect(redactString(text), text).toBe(text);
  });

  it("with a colon inside the quotes the part after the name is replaced", () => {
    for (const flag of [`-u "root:${S}"`, `--user 'root:${S}'`, `-u \\"root:${S}\\"`]) {
      const out = redactString(`curl ${flag} http://localhost:8080/x`);
      expect(out.includes(S), out).toBe(false);
      expect(out.includes("http://localhost:8080/x"), out).toBe(true);
    }
  });
});

describe("the value of a name/value pair may be an object or an array: every element is replaced, not the first word", () => {
  const AA = "Aa1bB2cC3dD4eE5f";
  it("an object value with several members, in both orders, at depth 0 to 3", () => {
    for (const k of [0, 1, 2, 3]) {
      const after = redactString(`log ${nest(JSON.stringify({ name: "DB_PASSWORD", value: { first: AA, second: S } }), k)} end`);
      expect(after.includes(S) || after.includes(AA), `after, depth ${k}: ${after}`).toBe(false);
      const before = redactString(`log ${nest(JSON.stringify({ value: { first: AA, second: S }, name: "DB_PASSWORD" }), k)} end`);
      expect(before.includes(S) || before.includes(AA), `before, depth ${k}: ${before}`).toBe(false);
    }
  });

  it("an array value with several elements, in both orders, at depth 0 to 3", () => {
    for (const k of [0, 1, 2, 3]) {
      const after = redactString(`log ${nest(JSON.stringify({ name: "DB_PASSWORD", value: [AA, S] }), k)} end`);
      expect(after.includes(S) || after.includes(AA), `after, depth ${k}: ${after}`).toBe(false);
      const before = redactString(`log ${nest(JSON.stringify({ value: [AA, S], name: "DB_PASSWORD" }), k)} end`);
      expect(before.includes(S) || before.includes(AA), `before, depth ${k}: ${before}`).toBe(false);
    }
  });
});

describe("an array or object value is replaced as a whole and the pair around it is kept (exact output)", () => {
  it("the name and the brackets of the document stay, in both orders", () => {
    const list = ["Aa1bB2cC3dD4eE5f", S];
    expect(redactString(JSON.stringify({ name: "DB_PASSWORD", value: list }))).toBe(`{"name":"DB_PASSWORD","value":${REDACTED}}`);
    expect(redactString(JSON.stringify({ value: list, name: "DB_PASSWORD" }))).toBe(`{"value":${REDACTED},"name":"DB_PASSWORD"}`);
    expect(redactString(JSON.stringify({ name: "DB_PASSWORD", value: { a: list[0], b: S } }))).toBe(`{"name":"DB_PASSWORD","value":${REDACTED}}`);
    expect(redactString(JSON.stringify({ name: "DB_PASSWORD", value: list, note: "KEEPME55" }))).toBe(`{"name":"DB_PASSWORD","value":${REDACTED},"note":"KEEPME55"}`);
  });
});

describe("a pair label is one line (a name that spans lines is prose, not a credential name)", () => {
  it("an object whose name holds a line break keeps its value; the same name on one line does not", () => {
    const prose = { name: "Deploy notes\nrotate the password monthly", value: "KEEPME55" };
    expect(JSON.stringify(redactValue(prose))).toContain("KEEPME55");
    const oneLine = { name: "rotate the password monthly", value: S };
    expect(JSON.stringify(redactValue(oneLine))).not.toContain(S);
  });
});

describe("user information: an at sign before the password is not the end of it", () => {
  it("an at sign earlier in the text (a handle, a mention) does not turn a later scheme-less pair into a span running backwards", () => {
    for (const text of [
      "cc @ops please look at //svc:notasecret/path today",
      "ping @alice @bob and //svc:notasecret/path?x=1",
      "reply to @team: see //svc:notasecret#top",
    ]) {
      expect(redactString(text), text).toBe(text);
    }
  });

  it("the same texts with a real at sign after the password are redacted, the earlier one kept", () => {
    const out = redactString(`cc @ops please look at //svc:${S}@host.example/path today`);
    expect(out.includes(S)).toBe(false);
    expect(out.startsWith("cc @ops please look at //")).toBe(true);
    expect(out.endsWith("@host.example/path today")).toBe(true);
  });
});
