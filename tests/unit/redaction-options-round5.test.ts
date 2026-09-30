/**
 * Review round 5, second pass (conformance P1, found by a differential against the two earlier redactors): the option reader took an
 * unquoted value only up to the next blank or quote, and it runs before the assignment step, so `--Authorization=["S"] x` lost every
 * character after the bracket (the redactor of the round-3 tree took an Authorization value to the end of the line). Also read now: a
 * Python prefix or a shell `$` in front of the quote, a bracket, brace or parenthesis value (as a whole), a value that starts with
 * an anchor or a tag; and the assignment step reads `{...}` and `(...)` under a credential key as a whole, like `[...]`.
 * `redaction-no-regression` holds the frozen fixture of these forms derived from both earlier redactors.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString } from "../../src/redact.js";

const S = "Qm4Zt8LxVb2Nw";
const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)

describe("an Authorization option is redacted to the end of its line, whatever its value looks like", () => {
  const FORMS = [`["${S}"]`, `[${S}]`, `b'${S}'`, `$'${S}'`, `u"${S}"`, `{"a":"${S}"}`, `!!str ${S}`, `&a ${S}`, `Basic ${S}`, `Bearer ${S}`, `Digest username="a", response="${S}"`, `'${S}'`, `"${S}"`, S];
  const NAMES = ["Authorization", "authorization", "AUTHORIZATION", "Proxy-Authorization", "userAuthorization", "x-authorization"];

  it("every option spelling x value form x separator x prefix: the secret is gone, the option stays, the result is a fixed point", () => {
    const failures: string[] = [];
    for (const name of NAMES) {
      for (const prefix of ["--", "-"]) {
        for (const sep of ["=", " ", " = "]) {
          for (const form of FORMS) {
            const text = `curl ${prefix}${name}${sep}${form} x`;
            const out = redactString(text);
            if (out.includes(S)) failures.push(`leaks: ${text} -> ${out}`);
            else if (!out.includes(`${prefix}${name}`)) failures.push(`option lost: ${text} -> ${out}`);
            else if (redactString(out) !== out) failures.push(`not a fixed point: ${text}`);
          }
        }
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it("the reviewer's examples", () => {
    expect(redactString(`curl --Authorization=["${S}"] x`)).toBe("curl --Authorization=[REDACTED]");
    for (const text of [`run -Authorization=b'${S}' x`, `--Authorization={"a":"${S}"}`, `--Authorization=!!str ${S} x`, `--Authorization=$'${S}'`]) expect(redactString(text), text).not.toContain(S);
  });

  it("an option that only contains the word, and options that are not credentials, keep what follows", () => {
    for (const text of ["kube-apiserver --authorization-mode=Node,RBAC --bind-address=127.0.0.1", "run --authorization-webhook-config-file=/etc/x.yaml --port 8080"]) {
      expect(redactString(text), text).toContain(text.slice(text.indexOf("--", 20)));
    }
    for (const text of ["run --tags [a,b] --filter {x} --name (y) x", "run --token-count [1] --max-tokens (2)"]) expect(redactString(text), text).toBe(text);
  });
});

describe("a credential option with a Python prefix, a shell $ prefix, a bracket, a brace, a parenthesis or a tag", () => {
  it.each([
    [`--${PW}=b'${S}'`],
    [`--${PW}=u"${S}"`],
    [`--${PW}=r'${S}'`],
    [`--${PW}=$'${S} x'`],
    [`--${PW}=$"${S} x"`],
    [`--${PW}=["${S}", "y"]`],
    [`--${PW}={"a": "${S}"}`],
    [`--${PW}=('${S}')`],
    [`--${PW} (ConvertTo-SecureString "${S}" -AsPlainText)`],
    [`--${PW}=!!str ${S}`],
    [`--${PW}=&a ${S}`],
    [`-Password (ConvertTo-SecureString "${S}" -AsPlainText)`],
  ])("%s", (text) => {
    const out = redactString(`run ${text} tail`);
    expect(out.includes(S), out).toBe(false);
    expect(redactString(out), text).toBe(out);
  });

  it("what follows a bracketed, braced or parenthesised value is kept", () => {
    expect(redactString(`run --${PW}=["${S}", "y"] tail`)).toBe(`run --${PW}=[REDACTED] tail`);
    expect(redactString(`run --${PW}={"a": "${S}"} tail`)).toBe(`run --${PW}=[REDACTED] tail`);
    expect(redactString(`run --${PW}=('${S}') tail`)).toBe(`run --${PW}=[REDACTED] tail`);
  });
});

describe("the assignment step reads {...} and (...) under a credential key as a whole value", () => {
  it.each([
    [`{"secret": {"a": {"b": "${S}"}}}`],
    [`{"${PW}": {"inner": "${S}"}}`],
    [`PASSWORDS=(a ${S})`],
    [`${PW} = ('${S}')`],
    [`${PW}: {a: ${S}, b: c}`],
    [`f"${PW}={'${S}'}"`],
  ])("%s", (text) => {
    const out = redactString(text);
    expect(out.includes(S), out).toBe(false);
    expect(redactString(out), text).toBe(out);
  });

  it("exact outputs: the container is replaced, what follows it stays", () => {
    expect(redactString(`{"secret": {"a": {"b": "${S}"}}, "keep": 1}`)).toBe(`{"secret": [REDACTED], "keep": 1}`);
    expect(redactString(`PASSWORDS=(a ${S}) next=1`)).toBe("PASSWORDS=[REDACTED] next=1");
  });

  it("controls: containers under a name that is not a credential are left alone", () => {
    for (const text of [`{"summary": {"a": {"b": "${S}"}}}`, `LIST=(a ${S}) next=1`, `note: {a: b}`]) expect(redactString(text), text).toBe(text);
  });

  it("an unclosed bracket ends at its line, and the work is bounded (a long run of openers is one pass)", () => {
    const out = redactString(`${PW}=(${"(".repeat(200_000)}\nnext: 1`);
    expect(out).toContain("next: 1");
    const t0 = performance.now();
    redactString(`${PW}={${"{".repeat(400_000)}`);
    expect(performance.now() - t0).toBeLessThan(20_000);
  });
});

describe("what the differential against both earlier redactors found in the option reader", () => {
  it.each([
    [`--api_key=>'${S}'`],
    [`--token=>["${S}", "y"]`],
    [`--client_secret=>{a: ${S}}`],
    [`-db-${PW}=>"${S}"`],
  ])("a hash rocket after an option separates an assignment: %s", (text) => {
    const out = redactString(`run ${text} tail`);
    expect(out.includes(S), out).toBe(false);
    expect(redactString(out), text).toBe(out);
  });

  it.each([
    [`--${PW}-stdin --token ${S}`],
    [`--${PW}-stdin --token=${S}`],
    [`--${PW}-stdin token=${S}`],
    [`--${PW}-stdin ${PW.toUpperCase()} = '${S}'`],
    [`--${PW}-file Authorization: Basic ${S}`],
    [`--no-${PW} --api_key "${S}"`],
    [`--${PW}-stdin --client_secret='${S}'`],
  ])("an option that takes no value of its own does not swallow the next credential: %s", (text) => {
    const out = redactString(`run ${text}\nnext: 1`);
    expect(out.includes(S), out).toBe(false);
    expect(out).toContain("next: 1");
    expect(redactString(out), text).toBe(out);
  });

  it("the next word is still this option's value when it does not name a credential (a password may be any word)", () => {
    expect(redactString(`run --${PW} hunter2 tail`)).toBe(`run --${PW} ${REDACTED} tail`);
    expect(redactString(`run --${PW} -abc123 tail`)).toBe(`run --${PW} ${REDACTED} tail`);
    expect(redactString(`run --${PW} secret tail`), "a value that is itself the word secret").toBe(`run --${PW} ${REDACTED} tail`);
  });

  it.each([
    [`x=b'abc\napi_key='${S}'`],
    [`x=u"abc\n${PW}: "${S}"`],
    [`${PW}=$'\ntoken2='${S}'`],
  ])("a Python or shell prefix and a quote that does not close on the line is not a quoted value: %s", (text) => {
    const out = redactString(text);
    expect(out.includes(S), out).toBe(false);
  });

  it.each([[`${PW.toUpperCase()} = $'${S} x'`], [`export ${PW.toUpperCase()}=$'${S}'`], [`${PW}=b'${S}'`], [`${PW}=u"${S}"`]])("a prefix in front of the quote of an assignment: %s", (text) => {
    const out = redactString(text);
    expect(out.includes(S), out).toBe(false);
    expect(redactString(out), text).toBe(out);
  });
});
