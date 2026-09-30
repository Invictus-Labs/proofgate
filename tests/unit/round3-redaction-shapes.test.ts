/**
 * Review round 2, security re-review: values of any length are redacted whole (the tail of a 600-character password was
 * printed), quoted values end at their closing quote, `Authorization` values at the end of the line, credential shapes and
 * key names that were still unknown, folded key names, the bundle scanner's extra views, and quadratic key redaction.
 * Planted values are assembled from fragments. Every test that names a leaked tail or a new shape fails on the round-2 review tree.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, findCredentialPatterns, isSensitiveKey, redactString, redactValue, scanBufferForCredentials } from "../../src/redact.js";

const j = (...parts: string[]): string => parts.join("");
const A = (n: number): string => "a".repeat(n);
const hex = (n: number): string => "0123456789abcdef".repeat(Math.ceil(n / 16)).slice(0, n);
const ZW = String.fromCharCode(0x200b);
const SHY = String.fromCharCode(0xad);
const fullwidth = (s: string): string => [...s].map((ch) => String.fromCodePoint(ch.codePointAt(0)! + 0xfee0)).join("");
/** A long value that no telltale shape gives away (it is only a secret because of the name in front of it). */
const LONG = "Zk3".repeat(200);

describe("values of any length are consumed whole (P1: only the first 300 characters were redacted)", () => {
  it.each([
    ["password=", `password=${LONG}`],
    ["quoted JSON client_secret", `{"client_secret": "${LONG}"}`],
    ["Authorization: Basic", `Authorization: Basic ${LONG}`],
    ["token:", `token: ${LONG}`],
    ["--password", `--password ${LONG}`],
    ["--password=", `--password=${LONG}`],
    ["quoted --secret", `--secret "${LONG}"`],
    ["glued -p password", `mysql -uroot -pSup3r${LONG} db`],
    ["a 100,000 character value", `password=${"Zk3".repeat(33_334)}`],
    ["Cookie header", `Cookie: session=${"Zk3".repeat(600)}`],
    ["URL password", j("https://", "user", ":", LONG, "@", "example.invalid/x")],
    ["a JWT with a long signature", j("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiJzeW50aGV0aWMifQ", ".", LONG)],
  ])("%s", (_label, text) => {
    const out = redactString(text);
    // No 30-character window of the long value survives (any of its three-character rotations would show).
    for (const window of [LONG.slice(-30), LONG.slice(-31, -1), LONG.slice(-32, -2), LONG.slice(0, 30)]) expect(out, text.slice(0, 40)).not.toContain(window);
    expect(out).toContain(REDACTED);
    expect(out.length).toBeLessThan(200);
  });

  it("the text before and after a long value is untouched", () => {
    expect(redactString(`start password=${LONG} end`)).toBe(`start password=${REDACTED} end`);
    expect(redactString(`a "password": "${LONG}", "user": "ann"`)).toBe(`a "password": "${REDACTED}", "user": "ann"`);
  });
});

describe("where a value ends", () => {
  it("a quoted value ends at its closing quote and may contain spaces", () => {
    expect(redactString('{"password": "correct horse battery staple"}')).toBe(`{"password": "${REDACTED}"}`);
    expect(redactString(`{'client_secret': 'two words here', 'x': 1}`)).toBe(`{'client_secret': '${REDACTED}', 'x': 1}`);
    expect(redactString('{"token": "a\\"b c", "n": 2}')).toBe(`{"token": "${REDACTED}", "n": 2}`);
  });

  it("an unterminated quoted value ends at the end of the line", () => {
    expect(redactString(j("pass", 'word="never closed\nnext line stays'))).toBe(j("pass", `word="${REDACTED}\nnext line stays`));
  });

  it("an Authorization value ends at the end of the line, whatever it contains", () => {
    const digest = 'Authorization: Digest username="bob", realm="x", nonce="0123456789abcdef", response="fedcba9876543210"';
    const out = redactString(`${digest}\nnext: line`);
    expect(out).toBe(`Authorization: ${REDACTED}\nnext: line`);
    expect(redactString('{"authorization": "Bearer abc def ghi"}')).toBe(`{"authorization": "${REDACTED}"}`);
  });

  it("an unquoted value contains ';' and ',' unless another name=value pair follows (a connection string)", () => {
    expect(redactString("password=abc;defghi")).toBe(`password=${REDACTED}`);
    expect(redactString("password=abc,defghi rest")).toBe(`password=${REDACTED} rest`);
    expect(redactString("Server=db;Password=abc;Uid=svc")).toBe(`Server=db;Password=${REDACTED};Uid=svc`);
  });

  it("a stray credential word does not swallow the key of the next pair and leave that pair's value in the clear", () => {
    // Found by the randomized property test: `pass :` looks like an assignment whose value is the quoted key `"token"`.
    expect(redactString('pass : "token": "abc123def456"')).not.toContain("abc123def456");
    expect(redactString("pass : token: abc123def456")).not.toContain("abc123def456");
    expect(redactString('secret = "api_key": "abc123def456", "note": "x"')).toBe(`secret = "api_key": "${REDACTED}", "note": "x"`);
  });

  it("stops at whitespace and at a quote", () => {
    expect(redactString("password=abc def")).toBe(`password=${REDACTED} def`);
    expect(redactString('password=abc"def')).toBe(`password=${REDACTED}"def`);
  });
});

describe("credential shapes that were still unknown (P2)", () => {
  const twilioAccount = j("A", "C", hex(32));
  const digitalOcean = j("dop", "_v1_", hex(64));
  const shopify = j("shp", "at_", hex(32));
  const mailgun = j("key", "-", hex(32));
  const account = j("Account", "Key=", "A".repeat(86), "==;");
  it.each([
    ["Twilio account SID", `sid ${twilioAccount} ok`, twilioAccount],
    ["DigitalOcean token", `token ${digitalOcean}`, digitalOcean],
    ["Shopify admin token", `x-shopify ${shopify}`, shopify],
    ["Mailgun key", `mg ${mailgun}`, mailgun],
    ["Azure storage AccountKey", `Endpoint=x;${account}Suffix=y`, "A".repeat(86)],
    ["pwd=", "conn pwd=hunter2hunter2 done", "hunter2hunter2"],
    ["DB_PASS=", "export DB_PASS=hunter2hunter2", "hunter2hunter2"],
    ["dbPass:", "dbPass: hunter2hunter2", "hunter2hunter2"],
    ["private_key=", "private_key=MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC"],
    ["private_key_id", '{"private_key_id": "0123456789abcdef0123456789abcdef01234567"}', "0123456789abcdef0123456789abcdef01234567"],
    ["Docker auth", '{"auth":"dXNlcjpwYXNzd29yZA=="}', "dXNlcjpwYXNzd29yZA=="],
    ["a short Bearer token", "Authorization header was Bearer abc123 today", "abc123"],
  ])("%s", (_label, text, secret) => {
    const out = redactString(text);
    expect(out, text).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("ordinary text near these shapes is left alone", () => {
    for (const text of [
      "the author passed the test",
      "passed=12 failed=0",
      "compass=north bypass=on",
      "ACCEPTED 12 checks",
      "AC power and key-value stores",
      "the bearer of this note",
      "monkey-1234 and hockey-cards",
      "status: PASS",
    ]) {
      expect(redactString(text), text).toBe(text);
    }
  });

  it("is idempotent for the new shapes and never grows a redacted string by more than a constant", () => {
    for (const text of [twilioAccount, digitalOcean, shopify, mailgun, account, "pwd=abc", "DB_PASS=abc", `password=${LONG}`, 'Authorization: Digest username="a", response="b"']) {
      const once = redactString(text);
      expect(redactString(once)).toBe(once);
      expect(once.length).toBeLessThanOrEqual(text.length + 20);
    }
  });
});

describe("key names, including folded spellings (P2)", () => {
  it.each(["accountKey", "AccountKey", "account_key", "dbPass", "DB_PASS", "db_pass", "pass_phrase", "sharedAccessKey", "sharedAccessSignature", "private_key_id", "privateKeyId"])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([`pass${ZW}word`, `to${SHY}ken`, fullwidth("password"), fullwidth("client_secret"), `api${ZW}_${ZW}key`, `Account${ZW}Key`])("treats the folded key %j as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
    expect(redactValue({ [key]: "hunter2hunter2" })).toEqual({ [key]: REDACTED });
  });

  it.each(["PASS", "Pass", "passed", "passing", "author", "tokens_used", "environment", "mandatory_passed", "accounting"])("does not treat %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it("the report's own status counts keep their PASS key", () => {
    const summary = { PASS: 3, FAIL: 1, mandatory_passed: 3 };
    expect(redactValue({ summary })).toEqual({ summary });
  });
});

describe("the bundle artifact scanner examines encodings that hide a credential (P2)", () => {
  const token = j("ghp", "_", "a1B2c3D4e5".repeat(4));
  const aws = j("AKI", "AIOSFODNN7", "EXAMPLE");
  const utf16le = (s: string): Buffer => Buffer.from(s, "utf16le");
  const utf16be = (s: string): Buffer => Buffer.from(s, "utf16le").swap16();

  it("finds a token split by zero-width characters, in fullwidth letters, and in UTF-8 text around non-ASCII characters", () => {
    expect(scanBufferForCredentials(Buffer.from(`log ${token.slice(0, 8)}${ZW}${token.slice(8)} done`))).toContain("github-token");
    expect(scanBufferForCredentials(Buffer.from(`log ${fullwidth(token)} done`))).toContain("github-token");
    expect(scanBufferForCredentials(Buffer.from(`café ${SHY}${aws} 日本`))).toContain("aws-access-key");
  });

  it.each([
    ["UTF-16LE", utf16le(`log ${token} done`)],
    ["UTF-16BE", utf16be(`log ${token} done`)],
    ["UTF-16LE with a byte-order mark", Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le(`log ${token} done`)])],
    ["UTF-16LE starting at an odd offset", Buffer.concat([Buffer.from([0x41]), utf16le(`log ${token} done`)])],
    ["UTF-16BE starting at an odd offset", Buffer.concat([Buffer.from([0x41]), utf16be(`log ${token} done`)])],
    ["UTF-16LE, PowerShell style, with the token deep inside a larger file", Buffer.concat([Buffer.alloc(3 * 1024 * 1024, 0x20), utf16le(`x ${token} y`), Buffer.alloc(1024, 0x20)])],
  ])("finds a token written as %s", (_label, buffer) => {
    expect(scanBufferForCredentials(buffer), _label).toContain("github-token");
  });

  it("controls: clean text in each encoding reports nothing, and binary zeros are not a credential", () => {
    for (const buffer of [utf16le("nothing to see here at all"), utf16be("nothing to see here at all"), Buffer.from("plain ascii"), Buffer.alloc(4096), Buffer.from(`café 日本`)]) {
      expect(scanBufferForCredentials(buffer)).toEqual([]);
    }
  });

  it("a window of characters that fold to 18 characters each is examined in bounded memory, and finds a token after it", () => {
    // U+FDFA normalises to 18 characters; a full window of them folds to about six million.
    const expanding = String.fromCharCode(0xfdfa).repeat(340_000);
    expect(scanBufferForCredentials(Buffer.from(expanding))).toEqual([]);
    expect(scanBufferForCredentials(Buffer.from(`${expanding}${ZW}${token}`))).toContain("github-token");
  });

  it("findCredentialPatterns still names patterns but never returns matched text", () => {
    expect(findCredentialPatterns(`x ${token} y password=hunter2hunter2`)).toEqual(expect.arrayContaining(["github-token", "assignment"]));
  });
});

describe("hidden credentials in strings", () => {
  const token = j("ghp", "_", "a1B2c3D4e5".repeat(4));
  it("a zero-width split, fullwidth spelling and a soft hyphen are folded and redacted, in short and in long strings", () => {
    for (const hidden of [`${token.slice(0, 6)}${ZW}${token.slice(6)}`, fullwidth(token), `${token.slice(0, 9)}${SHY}${token.slice(9)}`]) {
      for (const padding of [0, 70_000, 300_000]) {
        const out = redactString(`${"café ".repeat(padding / 6)}x ${hidden} y`);
        expect(out).not.toContain(token.slice(4, 30));
        expect(out).toContain(REDACTED);
      }
    }
  });

  it("text with no credential is returned exactly as given, not normalised", () => {
    expect(redactString("café ＡＢ")).toBe("café ＡＢ");
    const long = "café ＡＢ ".repeat(30_000);
    expect(redactString(long)).toBe(long);
  });

  it("a token that straddles a folding chunk boundary is still found", () => {
    for (let shift = 0; shift < 12; shift += 1) {
      const text = `${"é".repeat(64 * 1024 - 6 + shift)}${token.slice(0, 20)}${ZW}${token.slice(20)}`;
      expect(redactString(text), `shift ${shift}`).not.toContain(token.slice(24, 40));
    }
  });

  it("text that would fold to more than the budget is redacted whole instead of exhausting memory", () => {
    const out = redactString(String.fromCharCode(0xfdfa).repeat(2_500_000));
    // A boolean, not toBe(REDACTED): a failing comparison would try to print a multi-megabyte string.
    expect(out === REDACTED, `redactString returned ${out.length} characters`).toBe(true);
  });
});

describe("key redaction is linear (P2: it recomputed redactString(key) inside the collision loop)", () => {
  it("20,000 distinct token-shaped keys redact in well under a second per thousand, and stay distinct", () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 20_000; i += 1) input[j("ghp", "_", String(i).padStart(8, "0"), "a".repeat(30))] = i;
    const t0 = performance.now();
    const out = redactValue(input);
    const elapsed = performance.now() - t0;
    expect(Object.keys(out)).toHaveLength(20_000);
    expect(new Set(Object.keys(out)).size).toBe(20_000);
    expect(JSON.stringify(out)).not.toContain("ghp_");
    expect(elapsed).toBeLessThan(10_000);
  });

  it("a real key that already looks like a redaction suffix is not overwritten", () => {
    const token1 = j("ghp", "_", "0".repeat(30));
    const token2 = j("ghp", "_", "1".repeat(30));
    const out = redactValue({ [token1]: 1, [`${REDACTED}#2`]: 2, [token2]: 3 }) as Record<string, number>;
    expect(Object.values(out).sort()).toEqual([1, 2, 3]);
  });
});
