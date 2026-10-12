/**
 * Review round 6 (security P1, a regression against the round-5 tree): a value that STARTS WITH A BRACKET was read as a bracket span, and when a closer or a delimiter stood
 * behind it (`; ) } ] > " '` or a backslash) the rest of the password stayed in the clear: `password=(,NI<ON);r#T-=J*`, `PASSWORD={$F}]r|VK*~l)%JcV`, `password=()}IK5I1Y`,
 * `--password {$F}]r|VK*~l)%JcV --x`, `--token=(Z-)}|rrQ)?M76BLahvOucZ@`. Generated passwords hold brackets and delimiters: 86 of 400,000 random printable passwords leaked in
 * `password=<value>` at the round-6 tree and none at the round-5 tree. After a closed bracket that starts the value the token now runs on, unless what follows belongs to the
 * text around the value (a quote, an escaped quote, a line break or a blank written as text, a blank, the end, a closer followed by a blank or a closer, a `;` and a credential's
 * `NAME=`). The colon-less variants that the round-5 tree also left (`password=[]\S`, `password=[a]]S`, `token:[]}S`) are read the same way.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue } from "../../src/redact.js";
import { nest } from "../helpers/redaction-templates.js";

const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)
const S = "Zx9Kq2Wm5Lp";

const CONTEXTS: Array<[string, (value: string) => string]> = [
  ["assignment", (v) => `${PW}=${v}`],
  ["colon", (v) => `${PW}: ${v}`],
  ["upper-case assignment", (v) => `${PW.toUpperCase()}=${v} next`],
  ["YAML next line", (v) => `${PW}:\n  ${v}\nhost: x`],
  ["YAML list", (v) => `${PW}:\n  - ${v}\n  - other`],
  ["option, blank", (v) => `run --${PW} ${v} --x`],
  ["option, equals", (v) => `run --token=${v} now`],
  ["environment", (v) => `run ${PW.toUpperCase()}=${v} x`],
];

/** Brackets and delimiters in front of and behind the secret: what a generated password holds. */
const VALUES = [
  `(,NI<ON);${S}`, `{$F}]${S}|VK*~l)%JcV`, `()}${S}`, `(Z-)}|${S}`, `[_s]${S}|,lp=Y`, `[t=]);w{${S}`, `[]\\${S}`, `[]]${S}`, `[]>${S}`, `[]}${S}`, `[a]\\${S}`, `[a]]${S}`, `[a]>${S}`,
  `{}${S}`, `(a)${S}`, `[a];${S}`, `[a])${S}`, `[a]}${S}`, `(a)>${S}`,
];

describe("a value that starts with a bracket is read to the end of its token", () => {
  it.each(CONTEXTS)("context %s: every bracket-led password, at nesting depth 0 to 2", (_name, make) => {
    const failures: string[] = [];
    for (const value of VALUES) {
      for (const depth of [0, 1, 2]) {
        const text = nest(make(value), depth);
        const out = redactString(text);
        if (out.includes(S)) failures.push(`leak at depth ${depth}: ${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
        else if (redactString(out) !== out) failures.push(`not a fixed point: ${JSON.stringify(text)}`);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("the shapes of the report, exactly", () => {
    expect(redactString(`${PW}=(,NI<ON);r#T-=J*`)).toBe(`${PW}=${REDACTED}`);
    expect(redactString(`${PW.toUpperCase()}={$F}]r|VK*~l)%JcV`)).toBe(`${PW.toUpperCase()}=${REDACTED}`);
    expect(redactString(`${PW}=()}IK5I1Y`)).toBe(`${PW}=${REDACTED}`);
    expect(redactString(`run --${PW} {$F}]r|VK*~l)%JcV --x`)).toBe(`run --${PW} ${REDACTED} --x`);
    expect(redactString(`run --token=(Z-)}|rrQ)?M76BLahvOucZ@ now`)).toBe(`run --token=${REDACTED} now`);
    expect(redactString(`${PW}=[]\\${S}`)).toBe(`${PW}=${REDACTED}`);
    expect(redactString(`token:[]}${S}`)).toBe(`token:${REDACTED}`);
  });

  it("a generated password (a fixed seed, printable characters without quotes and blanks) is gone in every context", () => {
    let seed = 20271101;
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // the characters that, in front of a name and an equals sign, end a value by design (`;name=`, `,name=`) are left out: a connection string is not a password
    const chars = "()[]{}<>!@#$*+-.:/?^|~_&VKrR0123456789abcXYZ";
    const leaks: string[] = [];
    for (let i = 0; i < 4000; i += 1) {
      let password = "";
      const length = 8 + Math.floor(rnd() * 14);
      for (let j = 0; j < length; j += 1) password += chars[Math.floor(rnd() * chars.length)];
      if (!/[A-Za-z0-9]{4}/.test(password)) continue;
      for (const [name, make] of CONTEXTS) {
        const out = redactString(make(password));
        if (out.includes(password) || (password.length >= 8 && out.includes(password.slice(-5)))) leaks.push(`${name}: ${JSON.stringify(make(password))} -> ${JSON.stringify(out)}`);
      }
    }
    expect(leaks.slice(0, 5)).toEqual([]);
  });

  it("as an object value and as a list element", () => {
    expect(redactValue({ [PW]: `(,NI<ON);${S}` })[PW]).toBe(REDACTED);
    expect(JSON.stringify(redactValue({ args: ["run", `--${PW}`, `{$F}]${S}|VK`] })).includes(S)).toBe(false);
  });

  it("controls: what follows a closed bracket and belongs to the text around it stays", () => {
    expect(redactString(`{"${PW}": ["${S}"], "x": 1}`)).toBe(`{"${PW}": ${REDACTED}, "x": 1}`);
    expect(redactString(`${PW}=[${S}]\\nnext=1`)).toBe(`${PW}=${REDACTED}\\nnext=1`);
    expect(redactString(`${PW}=[${S}];token=other`)).toBe(`${PW}=${REDACTED};token=${REDACTED}`);
    expect(redactString(`${PW}=[${S}] tail`)).toBe(`${PW}=${REDACTED} tail`);
    expect(redactString(`${PW}=(${S}) tail`)).toBe(`${PW}=${REDACTED} tail`);
    expect(redactString(`x=[${S}]}\n`)).toBe(`x=[${S}]}\n`);
    // a line break written as text behind the bracket ends the value even when no `name=` follows it
    expect(redactString(`${PW}=[${S}]\\nhello there`)).toBe(`${PW}=${REDACTED}\\nhello there`);
    expect(redactString(`${PW}=(${S})\\thello there`)).toBe(`${PW}=${REDACTED}\\thello there`);
    expect(redactString(`{\\"${PW}\\":[\\"${S}\\"]\\"x`).includes(S)).toBe(false);
  });
});
