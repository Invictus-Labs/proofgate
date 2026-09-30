import { describe, expect, it } from "vitest";
import { REDACTED, findCredentialPatterns, isSensitiveKey, redactString, redactValue, scanBufferForCredentials } from "../../src/redact.js";
import { FAKE } from "../helpers/fake-secrets.js";

describe("redaction of credential-shaped text", () => {
  it.each(Object.entries(FAKE).filter(([k]) => k !== "email"))("redacts %s", (_name, secret) => {
    const out = redactString(`before ${secret} after`);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
    expect(out.startsWith("before ")).toBe(true);
  });

  it("redacts personal email addresses in free text", () => {
    expect(redactString(`contact ${FAKE.email} now`)).toBe(`contact ${REDACTED} now`);
  });

  it("keeps the credential-less part of URLs and assignments", () => {
    expect(redactString(FAKE.urlPassword)).toBe(`https://${REDACTED}@example.invalid/path`);
    expect(redactString(FAKE.assignment)).toBe(`api_key=${REDACTED}`);
    expect(redactString(`password: "s3cretvalue!"`)).toBe(`password: "${REDACTED}"`);
    expect(redactString(FAKE.bearer)).toBe(`Bearer ${REDACTED}`);
  });

  it("removes every planted value from a mixed blob", () => {
    const values = Object.values(FAKE);
    const out = redactString(values.join(" | "));
    for (const v of values) expect(out).not.toContain(v);
  });

  it("is idempotent", () => {
    for (const value of Object.values(FAKE)) {
      const once = redactString(`x ${value} y`);
      expect(redactString(once)).toBe(once);
    }
    const doc = { note: `password: ${FAKE.skToken}`, nested: [{ client_secret: "abc" }] };
    expect(redactValue(redactValue(doc))).toEqual(redactValue(doc));
  });

  it("leaves ordinary text, commit SHAs and sha256 digests alone", () => {
    const text = `commit ${"a".repeat(40)} artifact ${"b".repeat(64)} REQ-001 staging tests passed: 10`;
    expect(redactString(text)).toBe(text);
  });

  it("handles a lone private key header without a footer (bounded)", () => {
    const out = redactString(`${["-----BEGIN ", "PRIVATE KEY-----"].join("")}\n${"A".repeat(50)}`);
    expect(out).toBe(REDACTED);
  });

  it("stays fast on adversarial input (no catastrophic backtracking)", () => {
    const keyword = ["pass", "word="].join("");
    const header = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    const hostile = `${keyword.repeat(2000)}${"a".repeat(50_000)} ${"Bearer ".repeat(1000)} ${header.repeat(200)}`;
    const start = Date.now();
    redactString(hostile);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("key-name redaction", () => {
  it.each(["password", "db_password", "clientSecret", "client_secret", "access_token", "x-api-key", "apiKey", "Authorization", "private_key", "session_id", "cookie", "credentials"])(
    "treats %s as sensitive",
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    },
  );

  it.each(["passed", "tests", "tokens_used", "secretary", "environment", "receipt_id", "repository", "token_count", "passing", "author", "signal"])("does not treat %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it("replaces the whole value of a sensitive key, whatever its type, but keeps nulls", () => {
    const out = redactValue({ password: { deep: 1 }, token: 12345, api_key: null, keep: "ok", list: [{ secret: ["a"] }] });
    expect(out).toEqual({ password: REDACTED, token: REDACTED, api_key: null, keep: "ok", list: [{ secret: REDACTED }] });
  });

  it("does not mutate its input and treats __proto__ as plain data", () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"a":"x"}') as Record<string, unknown>;
    const out = redactValue(input) as Record<string, unknown>;
    expect(Object.keys(out)).toContain("__proto__");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out.polluted).toBeUndefined();
    const frozen = Object.freeze({ a: "x" });
    expect(redactValue(frozen)).toEqual({ a: "x" });
  });

  it("truncates absurdly deep structures instead of overflowing the stack", () => {
    let v: unknown = "leaf";
    for (let i = 0; i < 200; i += 1) v = { k: v };
    expect(JSON.stringify(redactValue(v))).toContain("[TRUNCATED]");
  });

  it("passes primitives through", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBeNull();
  });
});

describe("credential scanning of opaque bytes", () => {
  it("reports pattern names but never the secret", () => {
    const found = findCredentialPatterns(`log ${FAKE.githubToken} and ${FAKE.awsKey}`);
    expect(found).toEqual(expect.arrayContaining(["github-token", "aws-access-key"]));
    expect(JSON.stringify(found)).not.toContain(FAKE.githubToken);
    expect(findCredentialPatterns("nothing to see")).toEqual([]);
    expect(findCredentialPatterns(FAKE.email)).toEqual([]); // personal field, not a credential
  });

  it("finds a secret that straddles a window boundary and in binary data", () => {
    const window = 1024 * 1024;
    const buf = Buffer.alloc(window * 2 + 100, 0x20);
    const at = window - 10;
    buf.write(FAKE.githubToken, at, "latin1");
    expect(scanBufferForCredentials(buf)).toContain("github-token");
    const binary = Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from(FAKE.awsKey), Buffer.from([0, 0])]);
    expect(scanBufferForCredentials(binary)).toContain("aws-access-key");
    expect(scanBufferForCredentials(Buffer.alloc(10))).toEqual([]);
  });
});
