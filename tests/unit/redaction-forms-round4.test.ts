/**
 * Review round 4 (security P2s and P3s): shapes and characters that the redactor still let through, and one that it took for a
 * credential without cause.
 *  - `=>` (hash rocket) and blanks around `=` after a flag;
 *  - the credential words the documents list (connection_string, ssh_key, jwt, bearer, ...) inside text, not only as JSON keys;
 *  - EVERY invisible code point (Default_Ignorable_Code_Point and Cf) used to split a token or a keyword: 4,262 of 4,284
 *    survived when only a hand-picked list was folded away;
 *  - the artifact scanner took random binary (a zip, a png, a gz) for a "glued password flag": 185 of 200 random 256 KB buffers;
 *  - Slack `xoxc-`, `xoxd-`, `xoxo-` tokens.
 */
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { findCredentialPatterns, redactString, scanBufferForCredentials } from "../../src/redact.js";
import { FAKE } from "../helpers/fake-secrets.js";

// The secret itself holds no credential word: the assignment step is chosen by a literal word in the text, so a secret that
// contained one (`Secret`) would run the step for every test and hide a missing keyword.
const S = "Hs7Zq9FormValueXy";

describe("separators and keywords that were not recognised", () => {
  it.each([
    ["hash rocket, quoted", `{ "password" => "${S}" }`],
    ["hash rocket, single quotes", `['password' => '${S}']`],
    ["hash rocket, bare (print_r)", `[password] => ${S}`],
    ["flag, spaces around =", `--password = ${S}`],
    ["flag, quoted value after =", `-token = "${S}"`],
    ["flag, single dash secret", `-secret = ${S}`],
    ["connection_string in text", `{"connectionString":"${S}"}`],
    ["connection_string assignment", `connection_string=${S}`],
    ["ssh_key assignment", `ssh_key=${S}`],
    ["jwt assignment", `jwt=${S}`],
    ["bearer assignment", `bearer=${S}`],
    ["signing key", `{"signingKey":"${S}"}`],
    ["passcode", `passcode: ${S}`],
    ["dsn", `dsn=${S}`],
    ["cookies", `cookies: ${S}`],
  ])("%s", (_label, text) => {
    const out = redactString(text);
    expect(out.includes(S), out).toBe(false);
    expect(redactString(out) === out).toBe(true);
  });

  it("control: ordinary text with the same words is left alone", () => {
    for (const text of ["dsnp=1", "cookiecutter=yes", "jwtless=ok", "the connection string is documented", "bearing=north", "passed=10"]) expect(redactString(text), text).toBe(text);
  });
});

describe("every invisible code point splits nothing", () => {
  const invisible: number[] = [];
  const property = /\p{Default_Ignorable_Code_Point}|\p{Cf}/u;
  for (let cp = 0; cp <= 0x10ffff; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (property.test(String.fromCodePoint(cp))) invisible.push(cp);
  }

  it("the set is what the review counted (about 4,284 code points)", () => {
    expect(invisible.length).toBeGreaterThan(4000);
  });

  it("a token split with any of them is redacted", () => {
    const body = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const survivors: string[] = [];
    for (const cp of invisible) {
      const ch = String.fromCodePoint(cp);
      const out = redactString(`log gh${ch}p_${body} end`);
      if (out.includes(body)) survivors.push(`U+${cp.toString(16).toUpperCase()}`);
    }
    expect(survivors.slice(0, 20), `${survivors.length} of ${invisible.length} survive`).toEqual([]);
  });

  it("a credential keyword split with any of them still redacts its value", () => {
    const survivors: string[] = [];
    for (const cp of invisible) {
      const ch = String.fromCodePoint(cp);
      const out = redactString(`pass${ch}word=${S}`);
      if (out.includes(S)) survivors.push(`U+${cp.toString(16).toUpperCase()}`);
    }
    expect(survivors.slice(0, 20), `${survivors.length} of ${invisible.length} survive`).toEqual([]);
  });

  it("control: ordinary text with an emoji joiner or a variation selector is not otherwise disturbed", () => {
    const joiner = String.fromCodePoint(0x200d);
    const text = `status ok ${String.fromCodePoint(0x1f468)}${joiner}${String.fromCodePoint(0x1f469)} done`;
    expect(redactString(text)).toBe(text);
  });
});

describe("the artifact scan does not take random binary for a password flag", () => {
  function seeded(n: number, seed: number): Buffer {
    const out = Buffer.alloc(n);
    let a = seed >>> 0;
    for (let i = 0; i < n; i += 1) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      out[i] = (t ^ (t >>> 14)) & 0xff;
    }
    return out;
  }

  it("random and compressed buffers of 4 KB to 1 MB report nothing", () => {
    const flagged: string[] = [];
    for (const size of [4 * 1024, 16 * 1024, 64 * 1024, 256 * 1024, 1024 * 1024]) {
      for (let seed = 1; seed <= 6; seed += 1) {
        if (scanBufferForCredentials(seeded(size, seed * 7919 + size)).length > 0) flagged.push(`random ${size} seed ${seed}`);
      }
    }
    for (let i = 0; i < 6; i += 1) if (scanBufferForCredentials(gzipSync(randomBytes(300 * 1024))).length > 0) flagged.push(`gzip ${i}`);
    expect(flagged).toEqual([]);
  });

  it("controls: real text is still scanned for the flag, and binary that holds a real token still trips", () => {
    expect(scanBufferForCredentials(Buffer.from("mysql -pSecret1234 done"))).toContain("glued-password-flag");
    expect(scanBufferForCredentials(Buffer.from(`${"lorem ipsum ".repeat(30000)} run -pSecret1234 ${"dolor sit ".repeat(30000)}`))).toContain("glued-password-flag");
    const noisy = Buffer.concat([seeded(200 * 1024, 5), Buffer.from(` ${FAKE.githubToken} `), seeded(200 * 1024, 6)]);
    expect(scanBufferForCredentials(noisy).length).toBeGreaterThan(0);
    expect(findCredentialPatterns("x -pSecret1234 y")).toContain("glued-password-flag");
  });
});

describe("Slack token families", () => {
  it.each(["xoxa-", "xoxb-", "xoxc-", "xoxd-", "xoxe-", "xoxo-", "xoxp-", "xoxr-", "xoxs-"])("%s", (prefix) => {
    const out = redactString(`t ${prefix}123456789012-abcdefghijklmnopqrstuvwxyz end`);
    expect(out.includes("abcdefghijklmnopqrstuvwxyz"), out).toBe(false);
  });
});
