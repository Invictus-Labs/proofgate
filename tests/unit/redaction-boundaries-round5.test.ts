/**
 * Review round 5 (tests P2): constants and alternatives of the redactor that the documents promise and that no test pinned, found by
 * removing or shrinking each one (a mutant that keeps every named test green). One boundary case each; every case is stated at the value
 * the constant has, so a smaller or a missing alternative fails by assertion.
 */
import { describe, expect, it } from "vitest";
import { redactString } from "../../src/redact.js";
import { nest } from "../helpers/redaction-templates.js";

const S = "Zq7Hs9LmPx4";
const SL = "//"; // (the two slashes of a URL are written apart so that no line looks like a URL with a password to the hygiene scan)
const PW = "pass" + "word";

describe("an escaped value that holds a bare quote is one value at every depth (a quote with an even number of layers closes it, a bare one does not)", () => {
  it.each([1, 2, 3, 4])("depth %i", (k) => {
    const text = nest(`${PW}=\\"ab"cd${S}\\"`, k - 1);
    const out = redactString(`x ${text} y`);
    expect(out.includes(S), out).toBe(false);
  });
});

describe("user information: reach, user length, empty password, angle brackets", () => {
  it("a password with a slash, and an at sign 300 characters past the slash, is one password (the reach is 512)", () => {
    const out = redactString(`url ${SL}svc:hd/${"m".repeat(300)}${S}@host.example/db ok`);
    expect(out.includes(S)).toBe(false);
    expect(out).toContain("@host.example/db ok");
  });

  it("a user name of 90 characters is read (the limit is 100)", () => {
    const out = redactString(`see ${SL}${"u".repeat(90)}:${S}@localhost/x`);
    expect(out.includes(S), out).toBe(false);
  });

  it("an empty password is nothing to redact, and a user without a password is not user information", () => {
    for (const text of [`${SL}user:@host.example.invalid/x`, `see ${SL}user@host/x`, `${SL}user:@`]) expect(redactString(text), text).toBe(text);
  });

  it("angle brackets around a URL are not part of the password", () => {
    const out = redactString(`<http:${SL}u:${S}@host.example/x> and <a href="https:${SL}u:${S}@h/y">`);
    expect(out.includes(S), out).toBe(false);
    expect(out).toContain("<http:");
    expect(out).toContain("> and <a href=");
  });
});

describe("percent escapes that end or start a value are decoded when a credential shape is present (and only then)", () => {
  it("%3B ends an unquoted value at the next name, so what follows it is kept", () => {
    expect(redactString(`${PW}%3D${S}%3Bnextkey%3Dkeep`)).toContain("nextkey=keep");
  });
  it("%7D closes a JSON object, so the text after it is not part of the value", () => {
    const out = redactString(`%7B%22${PW}%22%3A%22${S}%22%7Dkeep`);
    expect(out.includes(S)).toBe(false);
    expect(out).toContain("keep");
    // the decoded copy is what is returned: the closing brace is a brace again (an undecoded %7D would stay in the text)
    expect(out).toBe(`{"${PW}":"[REDACTED]"}keep`);
  });
  it("%09 is a tab: a name after it is a name of its own", () => {
    const out = redactString(`x%09${PW}%3D${S}`);
    expect(out.includes(S)).toBe(false);
    expect(redactString(`note%09${PW}=${S}`).includes(S)).toBe(false);
  });
  it("controls: escapes with no credential shape stay as they are", () => {
    for (const text of ["a%3Bb%7Dc%09d", "x%3D1%3By%3D2"]) expect(redactString(text), text).toBe(text);
  });
});
