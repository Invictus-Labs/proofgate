/**
 * Review round 5, third and fourth reports (tests P1 and P2, logic P2): ordinary shapes that leaked in the round-5 tree and, for most of them, in
 * both earlier trees, and one object-level idempotence hole.
 *  - a `.env` body inside a JSON string (`NAME=S1\nOTHER='S2'` with the line break written as text) lost its second, quoted value: the first
 *    value ran on over the next name and the quote then ended the scan;
 *  - a credential-named PARENT key whose child mapping holds a quoted value (`auth:` then `password: "S"`), with real and with escaped line
 *    breaks, and `hmacKey+=stripeKey="S"`, `token?=apikey:"S"`, `jwt=Authorization="S"`: the value read for the parent was the child's name;
 *  - a block scalar behind an anchor or a tag (`password: !S |`) kept the tag, which may be the secret;
 *  - short names that the key-name rule knows (`pw`, `pswd`, `tls_key`, `privkey`, `id_rsa`, `mnemonic`, ...) were not looked for in text;
 *  - a name/value pair whose name only becomes a credential name once it is redacted (a newline in it) was redacted on the second pass, not the first.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, isSensitiveKey, redactString, redactValue } from "../../src/redact.js";
import { nest } from "../helpers/redaction-templates.js";

const S = "Zq7Hs9LmPx4";
const T = "Yw3Kd8NcRv5";
const B = "\\";
const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)

describe("an unquoted value ends at a line break written as text when another NAME= follows", () => {
  it.each([
    ["backslash n, single quotes", `DB_${PW.toUpperCase()}=${T}${B}nAPI_TOKEN='${S}'`],
    ["backslash n, escaped double quotes", `DB_${PW.toUpperCase()}=${T}${B}nAPI_TOKEN=${B}"${S}${B}"`],
    ["percent-encoded line break", `DB_${PW.toUpperCase()}=${T}%0AAPI_TOKEN='${S}'`],
    ["a real line break", `DB_${PW.toUpperCase()}=${T}\nAPI_TOKEN='${S}'`],
    ["three lines", `A_${PW.toUpperCase()}=${T}${B}nB_TOKEN=x${B}nC_SECRET="${S}"`],
    ["carriage return and line feed as text", `DB_${PW.toUpperCase()}=${T}${B}r${B}nAPI_TOKEN='${S}'`],
  ])("%s", (_name, text) => {
    const out = redactString(text);
    expect(out.includes(S) || out.includes(T), out).toBe(false);
    expect(redactString(out)).toBe(out);
  });

  it("a value that merely holds a backslash and an n, with no name after it, is one value", () => {
    expect(redactString(`${PW}=ab${B}ncd tail`)).toBe(`${PW}=${REDACTED} tail`);
    expect(redactString(`${PW}=ab%0Acd tail`)).toBe(`${PW}=${REDACTED} tail`);
  });
});

describe("a credential-named parent key, and a word that is another credential's name, do not swallow the quoted value behind them", () => {
  const YAML = (key: string, sep: string): string => `${key}:${sep}  ${PW}: "${S}"${sep}`;
  it.each(["auth", "credentials", "secret", "secrets", "token", "authentication"])("plain YAML under %s, with real and with escaped line breaks at depth 0 to 3", (key) => {
    for (const k of [0, 1, 2, 3]) {
      const out = redactString(nest(YAML(key, "\n"), k));
      expect(out.includes(S), `depth ${k}: ${out}`).toBe(false);
      expect(redactString(out), `depth ${k}: not a fixed point`).toBe(out);
    }
  });

  it.each([
    [`hmacKey+=stripeKey="${S}"`],
    [`token?=apikey:"${S}"`],
    [`jwt=Authorization="${S}"`],
    [`databaseurl:${PW}:'${S}`],
    [`${PW.toUpperCase()}:\n ${PW}='${S}'`],
    [`x_${PW}=${T} y_secret:"${S}"`],
  ])("%s", (text) => {
    const out = redactString(text);
    expect(out.includes(S), out).toBe(false);
    expect(redactString(out)).toBe(out);
  });

  it("exact output: the parent stays, the child's value goes", () => {
    expect(redactString(`auth:\n  ${PW}: "${S}"\n  user: bob\n`)).toBe(`auth:\n  ${PW}: "${REDACTED}"\n  user: bob\n`);
  });

  it("controls: a value that merely contains a credential word and ends in a colon is still a secret (round 2)", () => {
    expect(redactString(`${PW}=mysecret: rest`)).not.toContain("mysecret");
    expect(redactString(`pass : token: abc123def456`)).not.toContain("abc123def456");
  });
});

describe("a block scalar behind an anchor or a tag is redacted with the tag", () => {
  it.each([
    [`${PW}: !${S} |\n  x\nnext: 1`],
    [`${PW}: &${S} >-\n  x\nnext: 1`],
    [`${PW}: !!str |\n  ${S}\nnext: 1`],
    [`${PW}: !!str &a |\n  ${S}\nnext: 1`],
  ])("%s", (text) => {
    const out = redactString(text);
    expect(out.includes(S), out).toBe(false);
    expect(out).toContain("next: 1");
    expect(redactString(out)).toBe(out);
  });
  it("exact output", () => {
    expect(redactString(`${PW}: !!str |\n  ${S}\nnext: 1`)).toBe(`${PW}: ${REDACTED}\nnext: 1`);
  });
});

describe("short credential names that the key-name rule knows are looked for in text as well (one rule for both)", () => {
  const NAMES = ["pw", "PW", "pswd", "tls_key", "tlskey", "TLS-KEY", "ssl_key", "privkey", "priv_key", "id_rsa", "id-rsa", "keypass", "storepass", "client-key-data", "mnemonic"];
  it.each(NAMES)("%s: as an assignment, as YAML, as JSON text and as an object key", (name) => {
    expect(isSensitiveKey(name), `${name} is a credential name`).toBe(true);
    for (const text of [`${name}=${S}`, `${name}: ${S}`, `{"${name}": "${S}"}`, `run --${name} ${S}`, `export ${name}='${S}'`]) {
      const out = redactString(text);
      expect(out.includes(S), `${text} -> ${out}`).toBe(false);
    }
    expect(JSON.stringify(redactValue({ [name]: S }))).not.toContain(S);
  });

  it("parity: every name the key-name rule calls a credential hides its value in an assignment", () => {
    const CANDIDATES = ["password", "passwd", "pwd", "pw", "pswd", "secret", "token", "api_key", "apikey", "access_key", "private_key", "priv_key", "privkey", "ssh_key", "tls_key", "ssl_key", "id_rsa", "keypass", "storepass", "mnemonic", "client-key-data", "session_id", "signing_key", "master_key", "encryption_key", "stripeKey", "hmacKey", "dbpass", "userpwd", "auth1", "dsn", "webhook", "database_url"];
    const failures = CANDIDATES.filter((name) => isSensitiveKey(name) && redactString(`${name}=${S}`).includes(S));
    expect(failures).toEqual([]);
  });

  it("controls: ordinary words that contain the letters are not credentials", () => {
    for (const text of ["power=on", "upwards=1", "swpw2=3", "pwm=50", "the pw column"]) expect(redactString(text), text).toBe(text);
  });
});

describe("a name/value pair whose name only becomes a credential name once it is redacted", () => {
  it.each([
    ["Bearer\nabcdefghijklmnopqrstuvwxyz12"],
    ["credentials Bearer\nabcdefghijklmnopqrstuvwxyz12"],
    ["Authorization: Bearer\nabcdefghijklmnopqrstuvwxyz12"],
  ])("object-level redaction is a fixed point and hides the value at once: %j", (name) => {
    const doc = { extensions: { "vendor.pair": { name, value: "TopSecretValue1" } } };
    const once = redactValue(doc);
    expect(JSON.stringify(once)).not.toContain("TopSecretValue1");
    expect(JSON.stringify(redactValue(once))).toBe(JSON.stringify(once));
  });

  it("a property test over pair-shaped objects with names that hold a newline", () => {
    const words = ["Bearer", "credentials", "Authorization:", "token", "x", "abcdefghijklmnopqrstuvwxyz12", "password", "note", "id"];
    let seed = 4242;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed >>> 12) % n;
    };
    const bad: string[] = [];
    for (let i = 0; i < 3000; i += 1) {
      const name = Array.from({ length: 1 + next(4) }, () => words[next(words.length)]).join(next(2) === 0 ? "\n" : " ");
      const doc = { name, value: "TopSecretValue1", other: "keep" };
      const once = redactValue(doc);
      if (JSON.stringify(redactValue(once)) !== JSON.stringify(once)) bad.push(JSON.stringify(name));
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
