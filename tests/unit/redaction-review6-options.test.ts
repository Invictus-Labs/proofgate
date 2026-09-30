/**
 * Review round 6, the option, list and break findings that are not shapes of a bracket, a prefix or a counter:
 *  - (logic P2) `%09-password%20'S'` left S: a line break lead that is a percent escape (`%09`, `%0A`, `%0D`) made the glued `-pSECRET` rule fire before the percent decode,
 *    and it swallowed the option's NAME (`assword%20`). A glued `-p` whose "secret" is a credential option name that a percent escape or a colon follows is left to the option reader;
 *  - (security P3) options after a break written as `\u000a`, `\x0a`, `%0B`, `%0C`, `\f`, `\v`, `\u0009`, `\x09` stayed in the clear (the option reader knew six of the breaks that the
 *    line reader knows); `-pApiKey: S` and `-pAuthorization: S` are not glued secrets;
 *  - (security P2) in a YAML block list an item that ends in `:` handed over "the first word of the next line", which is the next item's dash, so the next item's value stayed;
 *  - (review: option form of a fixed shape) `--Authorization=[` and the elements on the next line, and an option value that is a bracket and runs on (`--token={rERr+<l}!u;dByQ_9F=`).
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString } from "../../src/redact.js";

const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)
const S = "Zx9Kq2Wm5Lp";
const B = "\\";

describe("a glued -p is not an option's name", () => {
  const LEADS = ["%09", "%0A", "%0D", "%0a", "%0d", `${B}n`, `${B}t`, " ", "\n", "x "];
  it.each(LEADS)("lead %j: `-password%20'S'`, `-password%3A\"S\"`, `-passD: S`, `-pApiKey: S`, `-pAuthorization: S`", (lead) => {
    const failures: string[] = [];
    for (const tail of [`-${PW}%20'${S}'`, `-${PW}%3A"${S}"`, `-passD: ${S}`, `-pApiKey: ${S}`, `-pAuthorization: ${S}`, `-${PW}%3D${S}`, `-pass3: ${S}`]) {
      const text = `run${lead}${tail}`;
      const out = redactString(text);
      if (out.includes(S)) failures.push(`${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
    }
    expect(failures.slice(0, 4)).toEqual([]);
  });

  it("a real glued password is still a glued password", () => {
    expect(redactString(`mysql -pS3cr3t!x db`)).toBe(`mysql -p${REDACTED} db`);
    expect(redactString(`mysql -p${S} db`)).toBe(`mysql -p${REDACTED} db`);
    expect(redactString(`x%0A-p${S}!`)).toBe(`x%0A-p${REDACTED}`);
    expect(redactString(`mysql -p=${S}`)).toBe(`mysql -p${REDACTED}`);
    // ordinary flags stay
    expect(redactString("docker run -pipe -p 8080:80 nginx")).toBe("docker run -pipe -p 8080:80 nginx");
  });
});

describe("an option after any written line break is read", () => {
  const BREAKS = [`${B}u000a`, `${B}u000A`, `${B}x0a`, `${B}x0D`, "%0B", "%0C", "%0b", `${B}f`, `${B}v`, `${B}u0009`, `${B}x09`, `${B}n`, `${B}r`, `${B}t`, "%0A", "%0D", "%09"];
  it.each(BREAKS)("break %j in front of --password S, --token=S and -p S", (brk) => {
    const failures: string[] = [];
    for (const tail of [`--${PW} ${S}`, `--token=${S}`, `--${PW}="${S}"`, `-u admin:${S}`]) {
      const text = `a${brk}${tail}`;
      const out = redactString(text);
      if (out.includes(S)) failures.push(`${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("a YAML block list: an item that ends in a colon does not take the next item", () => {
  it("both items are values", () => {
    expect(redactString(`passwd:\n  - abcdef:\n  - ${S}`)).toBe(`passwd:\n  - ${REDACTED}\n  - ${REDACTED}`);
    expect(redactString(`secrets:\n  - a:\n  - b:\n  - ${S}\nnext: 1`).includes(S)).toBe(false);
    expect(redactString(`secrets:\n  - a:\n  - b:\n  - ${S}\nnext: 1`)).toContain("next: 1");
  });
  it("a dangling label still hands its value over when the next line is not a list item", () => {
    expect(redactString(`${PW}: abcdef:\n  ${S}`).includes(S)).toBe(false);
  });
});

describe("options with brackets", () => {
  it("--Authorization= and a bracket that runs past its line", () => {
    expect(redactString(`--Authorization=[\n"${S}"]`).includes(S)).toBe(false);
    expect(redactString(`a${B}n--Authorization=[\n"${S}"]`).includes(S)).toBe(false);
  });
  it("an option value that is a bracket and runs on is the whole word", () => {
    expect(redactString(`run --token={rERr+<l}!u;dByQ_9F= now`)).toBe(`run --token=${REDACTED} now`);
    expect(redactString(`run --${PW} [t=]);w{2Ubelhb*Hl --x`)).toBe(`run --${PW} ${REDACTED} --x`);
    expect(redactString(`run --token=[a,b] --x`)).toBe(`run --token=${REDACTED} --x`);
  });
});
