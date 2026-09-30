/**
 * Final security review (P1, regression against the tree that was reviewed before): an option given a value after a BLANK (`--token V`, `--password V`, `--api-key V`, `--secret V`,
 * `-token V`, and a header `-H 'X-Api-Key: V'`) left V readable when V has the shape of a label (letters, digits, `_`, `.`, `-`, up to 60 characters, ending in `=` or `==`) and contains
 * a credential word as a camel-case segment (`Pw`, `Jwt`, `Dsn`, `Auth`, `Secret`, `Token`): the value was read as ANOTHER credential's name and separator and left for that name's reader,
 * which finds nothing behind it. Fernet keys, base64 of 32 bytes and 30 random letters and digits followed by `=` are such values. This file runs the repros, seeded random values in every
 * option form (every one must be hidden), and the CONTROLS that genuine names after an option are still left to their own reader.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString } from "../../src/redact.js";

/** mulberry32: a seeded generator, so a failure names its seed and reproduces. */
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
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const pick = (r: () => number, alphabet: string, n: number): string => Array.from({ length: n }, () => alphabet.charAt(Math.floor(r() * alphabet.length))).join("");

/** Values of the three shapes of the review. */
const VALUES: Array<[string, (r: () => number) => string]> = [
  ["a Fernet key (43 base64url characters and `=`)", (r) => `${pick(r, B64URL, 43)}=`],
  ["base64 of 32 bytes (43 characters and `=`)", (r) => `${pick(r, B64, 43)}=`],
  ["30 letters and digits and `=`", (r) => `${pick(r, ALNUM, 30)}=`],
  ["base64url of 20 bytes with `==` padding", (r) => `${pick(r, B64URL, 27)}==`],
];
const OPTIONS: Array<[string, (v: string) => string]> = [
  ["--token V", (v) => `run --token ${v} --verbose`],
  ["--password V", (v) => `run --password ${v}`],
  ["--api-key V", (v) => `deploy --api-key ${v} app`],
  ["--secret V", (v) => `tool --secret ${v} --dry-run`],
  ["-token V", (v) => `tool -token ${v}`],
  ["-H 'X-Api-Key: V'", (v) => `curl -H 'X-Api-Key: ${v}' https://localhost/x`],
];

describe("an option's value after a blank is hidden when it reads as a label (the repros of the review)", () => {
  it("the three repros", () => {
    expect(redactString("run --token LzoVnZg-qdh5H16SBqPw-da6Q3WjgvEReUQEUjrrYWk= --verbose")).toBe(`run --token ${REDACTED} --verbose`);
    expect(redactString("--password w-mxxsyUtdVHNQtpbO3X_8JwtE6xjPip7_7Rk72dpLs=")).toBe(`--password ${REDACTED}`);
    expect(redactString("--token ZqB28ClwKx919Jwt1Yc8=")).toBe(`--token ${REDACTED}`);
    // base64 padding is not a value behind a name
    expect(redactString("run --token oPwQuktAcfwx-RFmry-ANkittgc== --verbose")).toBe(`run --token ${REDACTED} --verbose`);
  });
  it("a header option with a key of that shape", () => {
    expect(redactString("-H 'X-Api-Key: ZqB28ClwKx919Jwt1Yc8='")).toBe(`-H 'X-Api-Key: ${REDACTED}'`);
    expect(redactString("curl -H 'X-Api-Key: LzoVnZg-qdh5H16SBqPw-da6Q3WjgvEReUQEUjrrYWk=' https://localhost/x")).not.toContain("LzoVnZg");
  });
  it.each(VALUES.flatMap(([vname, make]) => OPTIONS.map(([oname, wrap]) => [`${vname} in ${oname}`, make, wrap] as const)))("seeded random: %s is always hidden", (_name, make, wrap) => {
    const r = rng(20271201 + _name.length * 7919);
    let leaks = 0;
    let first = "";
    for (let i = 0; i < 4_000; i += 1) {
      const value = make(r);
      const out = redactString(wrap(value));
      if (out.includes(value.slice(0, 12)) || out.includes(value.slice(-12))) {
        leaks += 1;
        if (first === "") first = JSON.stringify(wrap(value));
      }
    }
    expect(leaks, first).toBe(0);
  }, 120_000);
});

describe("`-u user:password` and `--data` with a base64 password that ends in a credential word are hidden (the name after a base64 character is not a name)", () => {
  it("the repros of the sweep and seeded values", () => {
    expect(redactString("curl -u admin:KOkFDk6B98lQ59NQG+XOikiesPw= http://localhost/")).toBe(`curl -u ${REDACTED} http://localhost/`);
    expect(redactString("curl -u admin:p9DbQ+wb8GC7G4J2hEDStgA6YhWL1RIiNA/fyRwOoPw= http://localhost/")).toBe(`curl -u ${REDACTED} http://localhost/`);
    const r = rng(99_031);
    let leaks = 0;
    let first = "";
    for (let i = 0; i < 6_000; i += 1) {
      const value = i % 2 === 0 ? `${pick(r, B64, 27)}${["Pw", "Jwt", "Auth", "Dsn"][i % 4]}=` : `${pick(r, B64, 43)}=`;
      const text = `curl -u admin:${value} http://localhost/`;
      if (redactString(text).includes(value.slice(-12)) || redactString(text).includes(value.slice(0, 12))) {
        leaks += 1;
        if (first === "") first = JSON.stringify(text);
      }
    }
    expect(leaks, first).toBe(0);
  });
});

describe("a short letters-only value that holds a credential word in camel case, given to an option after a blank, is hidden", () => {
  it.each([["--token", "file.txt"], ["--passwd", "--verbose"], ["--api-key", "app"], ["--secret", "x y"]])("%s followed by %s", (option, after) => {
    const r = rng(77_001 + option.length);
    let leaks = 0;
    let first = "";
    for (let i = 0; i < 3_000; i += 1) {
      const body = pick(r, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 6 + Math.floor(r() * 10));
      const word = ["Jwt", "Pw", "Auth", "Secret", "Token", "Dsn"][Math.floor(r() * 6)] as string;
      const value = `${body.slice(0, 5)}${word}${body.slice(5)}=`;
      const text = `tool ${option} ${value} ${after}`;
      if (redactString(text).includes(value.slice(0, 8))) {
        leaks += 1;
        if (first === "") first = JSON.stringify(text);
      }
    }
    expect(leaks, first).toBe(0);
  });
});

describe("a short letters-only value with a credential word in camel case inside a quoted header is hidden (the closing quote is not the opening of a value)", () => {
  it("-H 'X-Api-Key: V' and curl -H \"X-Token: V\" with seeded values", () => {
    const r = rng(88_017);
    let leaks = 0;
    let first = "";
    for (let i = 0; i < 4_000; i += 1) {
      const body = pick(r, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 6 + Math.floor(r() * 10));
      const word = ["Jwt", "Pw", "Auth", "Secret", "Token", "Dsn"][Math.floor(r() * 6)] as string;
      const value = `${body.slice(0, 5)}${word}${body.slice(5)}=`;
      for (const text of [`-H 'X-Api-Key: ${value}'`, `curl -H "X-Token: ${value}" https://localhost/x`, `curl -H 'X-client-secret: ${value}' https://localhost/x`]) {
        if (redactString(text).includes(value.slice(0, 8))) {
          leaks += 1;
          if (first === "") first = JSON.stringify(text);
        }
      }
    }
    expect(leaks, first).toBe(0);
  });
});

describe("a dangling label that an option's value takes takes its own value too", () => {
  it("`--token e: password: S` and its forms (a literal backslash and t between words, three labels, a tail)", () => {
    const S = "ZqB28ClwKx919";
    const PW = "pass" + "word";
    expect(redactString(`--token=e: ${PW}: ${S}`)).toBe(`--token=${REDACTED}`);
    expect(redactString("-secret v: pass: ZqB28ClwKx919")).toBe(`-secret ${REDACTED}`);
    expect(redactString(`--token=v65\\tmode: info\\tdb_${PW}: ${S}`)).not.toContain(S);
    expect(redactString(`--token=e: ${PW}: ${S} tail`)).toBe(`--token=${REDACTED} tail`);
    expect(redactString(`run --token a: b: c: ${S} --verbose`)).toBe(`run --token ${REDACTED} --verbose`);
    // a line break ends the chain: what stands on the next line is not taken
    expect(redactString(`--token e:\nhost: localhost`)).toContain("host: localhost");
  });
});

describe("CONTROLS: a genuine name after an option is still left to its own reader", () => {
  it("the option that stands alone, a flag after it, and a name with a value behind it", () => {
    expect(redactString("--token --verbose")).toBe(`--token ${REDACTED}`);
    expect(redactString("--password-stdin --token S3cr3tValue")).toBe(`--password-stdin --token ${REDACTED}`);
    expect(redactString("--user-password token=S3cr3tValue")).toBe(`--user-password token=${REDACTED}`);
    expect(redactString("--token apikey= S3cr3tValue")).toBe(`--token apikey= ${REDACTED}`);
  });
  it("a value on the next line that ends in a hyphen and a credential word is a value, not a name (it was pinned as readable before)", () => {
    const PW = "pass" + "word";
    expect(redactString(`apikey:\nZx9Kq2Wm5Lp-${PW}:`)).toBe(`apikey:\n${REDACTED}`);
  });
  it("a name with nothing behind it after an option is the option's value (the option reader hands a name over only when a value stands behind it)", () => {
    expect(redactString("--api-key SecretAbc12=")).toBe(`--api-key ${REDACTED}`);
    expect(redactString("--token password:")).toBe(`--token ${REDACTED}`);
    expect(redactString("--secret Token12= --dry-run")).toBe(`--secret ${REDACTED} --dry-run`);
  });
  it("the forms that were always hidden stay hidden (glued value, assignment, plain word)", () => {
    expect(redactString("--token=ZqB28ClwKx919Jwt1Yc8=")).toBe(`--token=${REDACTED}`);
    expect(redactString("DB_PASSWORD=ZqB28ClwKx919Jwt1Yc8=")).toBe(`DB_PASSWORD=${REDACTED}`);
    expect(redactString("--token Zx9Kq2Wm5Lp")).toBe(`--token ${REDACTED}`);
  });
});
