/**
 * KNOWN LIMITS of the redactor that the final security review named and that are accepted as listed, garbled or contrived shapes (a disclosure, not a waiver): the exact strings and
 * today's exact outputs, named in `docs/INTERFACES.md` ("What it does not redact") and `SECURITY.md`. Each pin shows a secret `S` that stays readable. EVERY PIN HERE IS EXPECTED TO BE
 * RETIRED WHEN ITS SHAPE IS FIXED: the fix moves the string to a must-hide list and deletes the pin, so a failing pin after a change of the redactor is news to read, not a test to loosen.
 * The plain forms of each shape (a real line break, a quote, no separator glued on) are hidden, and are asserted beside the pin.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue } from "../../src/redact.js";

const S = "Zx9Kq2Wm5Lp";
const B = "\\";
const PW = "pass" + "word";

describe("KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output", () => {
  it("a bracketed Authorization value that spans lines, with a word glued behind the closing bracket, hides the list and not the word after it", () => {
    expect(redactString(`Authorization: [a,\n b,\n c]tail ${S}`)).toBe(`Authorization: ${REDACTED} ${S}`);
    // the plain forms: the list alone, and a real value after a blank, are hidden
    expect(redactString(`Authorization: [a,\n b,\n c]`)).toBe(`Authorization: ${REDACTED}`);
    expect(redactString(`Authorization: Bearer ${S}`)).toBe(`Authorization: ${REDACTED}`);
  });

  it("a line break written inside a password ends the value: what follows it is read as the next pair", () => {
    for (const br of [`${B}n`, `${B}r`, "%0d", "%0A", "\n"]) {
      expect(redactString(`${PW}=a${br}b=c${S}`), JSON.stringify(br)).toBe(`${PW}=${REDACTED}${br}b=c${S}`);
    }
    // a password without a break in it is hidden whole
    expect(redactString(`${PW}=ab${S}`)).toBe(`${PW}=${REDACTED}`);
  });

  it("an option value that starts with a greater-than sign and is followed by a pair is read as an empty value: S stays", () => {
    expect(redactString(`--token=>;x=y${S}`)).toBe(`--token=>;x=y${S}`);
    expect(redactString(`--token=>${S}`)).toBe(`--token=>${REDACTED}`);
  });

  it("a connection string is split at a semicolon and a name: a password that holds one hides only the part in front of it", () => {
    expect(redactString(`${PW}=;name=${S}`)).toBe(`${PW}=;name=${S}`);
    expect(redactString(`${PW}=${S};name=other`)).toBe(`${PW}=${REDACTED};name=other`);
  });

  it("a blank inside an element of a JSON array ends the option value at the blank, and a raw at-sign in user information ends it at the last one in front of another stop character", () => {
    expect(redactString(JSON.stringify(["run", `--${PW}=ab cd${S}`, "x"]))).toBe(`["run","--${PW}=${REDACTED} cd${S}","x"]`);
    expect(redactString(`x://user:pa@ss${S}#frag@host/path`)).toBe(`x://${REDACTED}@ss${S}#frag@host/path`);
    expect(redactString(JSON.stringify(["run", `--${PW}=${S}`, "x"]))).toBe(`["run","--${PW}=${REDACTED}","x"]`);
  });

  it("garbled label chains that the tree before the final review hid and this one leaves (found by the final differential; the reviewed round-5 tree leaves them too): the secret is the value of a second name", () => {
    expect(redactString(`-token /apikey%3D'${S}`)).toBe(`-token ${REDACTED}'${S}`);
    expect(redactString(`token=u"credential:" ${S}`)).toBe(`token=u"${REDACTED}" ${S}`);
    expect(redactString(`token%3D)token:\n:\n- ${S}`)).toBe(`token=${REDACTED}\n- ${S}`);
    expect(redactString(`-credential ()TOKEN="${S}`)).toBe(`-credential ${REDACTED}"${S}`);
    expect(redactString(`credential%3D/token:\n:\n- ${S}`)).toBe(`credential=${REDACTED}\n- ${S}`);
  });

  it("a user of -u or --user that ends in a colon takes no value from the next line: curl reads the empty password, and the line behind it is a new word (the same for a user that is a credential's name)", () => {
    expect(redactString(`curl -u admin:\n${S}`)).toBe(`curl -u ${REDACTED}\n${S}`);
    expect(redactString(`-u PASSWD:\n${S}`)).toBe(`-u ${REDACTED}\n${S}`);
    expect(redactString(`--user PASSWD:\n${S}`)).toBe(`--user ${REDACTED}\n${S}`);
    expect(redactString(`curl -u Authorization:\n${S}`)).toBe(`curl -u ${REDACTED}\n${S}`);
    expect(redactString(`${B}n-u Authorization:\n${S}`)).toBe(`${B}n-u ${REDACTED}\n${S}`);
    // control: a value on the same line, after the colon and a blank, is hidden
    expect(redactString(`-u Authorization: ${S}`)).toBe(`-u Authorization: ${REDACTED}`);
  });

  it("KNOWN LIMIT: a name-like padded key followed by a delimiter and content keeps its key body readable (an earlier reviewed tree hid both shapes whole; 0 of the realistic key kinds leaked in 22 cells, 2 of 5,000 letters-only 22-character keys did)", () => {
    const KEY = "abcdefJwtGhijkl";
    // the padding and a glued pair behind the comma are hidden; the key (a letters-only key with a credential word in camel case) stays
    expect(redactString(`run --token ${KEY}==,password=${S}`)).toBe(`run --token ${KEY}=${REDACTED},password=${REDACTED}`);
    // the padding, a comma and a bracket with content glued behind them: the same
    expect(redactString(`--token ${KEY}==,]x`)).toBe(`--token ${KEY}=${REDACTED}`);
    // controls: without content glued behind the delimiter the key is hidden whole
    expect(redactString(`run --token ${KEY}==, next`)).toBe(`run --token ${REDACTED} next`);
    expect(redactString(`run --token ${KEY}==; next`)).toBe(`run --token ${REDACTED} next`);
  });

  it("garbled soup of dangling labels, percent escapes, a scheme word and a hash rocket that an earlier tree hid whole (the secret is the value of a second name)", () => {
    expect(redactString(`passwd:Bearer %passwd= ${S}`)).toBe(`passwd:${REDACTED} ${S}`);
    expect(redactString(`${B}n-p%pwd= ${S}`)).toBe(`${B}n-p${REDACTED} ${S}`);
    expect(redactString(`password:1|auth= credential=>'${S}`)).toBe(`password:${REDACTED}|auth= ${REDACTED}'${S}`);
    expect(redactString(`secretAuthorization=; token:|\n${S}`)).toBe(`secretAuthorization=${REDACTED}\n${S}`);
    expect(redactString(`passwd=Authorizationv:\ntoken:\n${S}`)).toBe(`passwd=${REDACTED}\n${S}`);
  });

  it("a truncated percent escape behind a long option name is not a glued secret any more: nothing follows it, nothing is hidden", () => {
    expect(redactString("-passwd%")).toBe("-passwd%");
    expect(redactString("-password%")).toBe("-password%");
  });

  it("random printable passwords that hold a break and then a name and an equals sign show their tail (three in 120,000; 847 more were hidden than before)", () => {
    // a value ends at whitespace, a quote, a line break written as text or a following name= pair: what stands behind such an end is read as the next pair and stays
    expect(redactString(`${PW}=;wJl${B}nqi=Y(#Yp?b`)).toBe(`${PW}=${REDACTED}${B}nqi=Y(#Yp?b`);
    expect(redactString(`secret: t${B}rczayuf=.RaDD;wJNf`)).toBe(`secret: ${REDACTED}${B}rczayuf=.RaDD;wJNf`);
    expect(redactString("cmd --api_key=>+>O1@o>7-z,R=$5(")).toBe(`cmd --api_key=>${REDACTED},R=$5(`);
    // controls: without a name= shape behind the delimiter the password is hidden whole
    expect(redactString(`${PW}=Sup3r${B}nSecretTail99`)).toBe(`${PW}=${REDACTED}`);
    expect(redactString("cmd --api_key=abc,R=$5(")).toBe(`cmd --api_key=${REDACTED}`);
  });

  it("two random printable passwords of the connection-string class show their tail after a comma, a semicolon and a name (an earlier redactor hid them whole)", () => {
    expect(redactString("--access-token=>JfA@pKSN4ZpD5vP%X_nH,P=cWM}p!e>i=>cm0Z;")).toBe(`--access-token=>${REDACTED},P=cWM}p!e>i=>cm0Z;`);
    expect(redactString("--header=X-Api-Key:(gppnN);,Y_B?43W<")).toBe(`--header=X-Api-Key:${REDACTED};,Y_B?43W<`);
  });

  it("a glued -p with a quoted value shows it, and the dotted usage counters differ between text and object keys", () => {
    // `-pS` is hidden, `-p'S'` and `-p"S"` are not (a glued -p followed by a quote is read as a word and a string)
    expect(redactString(`-p${S}`)).toBe(`-p${REDACTED}`);
    expect(redactString(`-p'${S}'`)).toBe(`-p'${S}'`);
    expect(redactString(`-p"${S}"`)).toBe(`-p"${S}"`);
    // a dotted counter name is hidden in text (the safe side) and kept as an object key
    expect(redactString("total.tokens=5")).toBe(`total.tokens=${REDACTED}`);
    expect(redactValue({ "total.tokens": 5, max_tokens: 5 })).toEqual({ "total.tokens": 5, max_tokens: 5 });
  });
});
