/**
 * Review round 4 (security P1 and logic P2-1, a regression against the round-2 tree): redaction was a fixed point for STRINGS but not for
 * OBJECTS. A key such as `pass<token>` is not sensitive as written; redacting its text makes it `pass[REDACTED]`, which is,
 * so a second pass replaced the value that the first pass kept. Bundles store the first pass and restore redacts again, so
 * export wrote a bundle that verify and restore refused. Sensitivity is now judged on the raw AND the redacted key, and this
 * file states the property directly: for any document, redactValue(redactValue(x)) equals redactValue(x).
 * Also here: the pair-object, tuple and argv shapes and the concatenated key names of the security P2 list.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, isSensitiveKey, redactValue } from "../../src/redact.js";
import { FAKE, GLUE_PREFIXES } from "../helpers/fake-secrets.js";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const once = (x: unknown): unknown => redactValue(x);

describe("the reviewers' keys are fixed points at object level", () => {
  const WORDS = ["pass", "token", "api_key", "auth", "pwd", "jwt", "cookie", "bearer", "password", "secret", "session_id", "connection_string"];
  it.each(WORDS)("a key made of %s glued to a distinctive token", (word) => {
    for (const token of [FAKE.githubToken, FAKE.slackToken, FAKE.npmToken, FAKE.gitlabToken]) {
      for (const key of [`${word}${token}`, `${word}_${token}`, `${token}${word}`, `${word} ${token}`]) {
        const doc = { [key]: "harmless value", other: "kept", nested: { [key]: ["a", "b"] } };
        const first = once(doc);
        expect(same(once(first), first), `${key.slice(0, 20)}...: ${JSON.stringify(first).slice(0, 200)}`).toBe(true);
        expect(JSON.stringify(first).includes(token), "the token itself is gone").toBe(false);
      }
    }
  });

  it("an escape followed by a lowercase bearer in a key", () => {
    for (const key of ["\\nbearer abcdefghijklmnop", "a%0Abearer abcdefghijklmnopqrst", "x\\tbearer 0123456789abcdefgh"]) {
      const first = once({ [key]: { inner: "value" } });
      expect(same(once(first), first), key).toBe(true);
    }
  });

  it("a name/value pair whose name only becomes sensitive after redaction", () => {
    const first = once({ name: `pass${FAKE.githubToken}`, value: "harmless" });
    expect(same(once(first), first)).toBe(true);
  });

  it("colliding redacted keys keep distinct names and stay stable", () => {
    const doc: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) doc[`token=${String.fromCharCode(97 + i).repeat(24)}`] = `v${i}`;
    const first = once(doc);
    expect(Object.keys(first as object).length).toBe(6);
    expect(same(once(first), first)).toBe(true);
  });

  it("a seeded random walk over keys and values (word, token, glue, escape) is a fixed point at every depth", () => {
    let a = 20260929;
    const rand = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
    const atoms = [...WORDS, "note", "Authorization", "x", "value", "name", "key", "Name", "Value", "header", "_", "-", ".", " ", "=", ":", ...GLUE_PREFIXES, FAKE.githubToken, FAKE.awsKey, "bearer abcdefghijklmnop", "Bearer abc123def456", "password=hunter2xyz"];
    const text = (): string => Array.from({ length: 1 + Math.floor(rand() * 5) }, () => pick(atoms)).join("");
    const build = (depth: number): unknown => {
      const roll = rand();
      if (depth > 3 || roll < 0.35) return text();
      if (roll < 0.55) return Array.from({ length: Math.floor(rand() * 4) }, () => build(depth + 1));
      const o: Record<string, unknown> = {};
      for (let i = 0; i < 1 + Math.floor(rand() * 4); i += 1) o[text()] = build(depth + 1);
      return o;
    };
    let failures = 0;
    let firstFailure = "";
    for (let i = 0; i < 3000; i += 1) {
      const doc = build(0);
      const first = once(doc);
      if (!same(once(first), first)) {
        failures += 1;
        if (firstFailure === "") firstFailure = JSON.stringify(doc).slice(0, 300);
      }
    }
    expect(failures, `first failing document: ${firstFailure}`).toBe(0);
  });
});

describe("pair objects, tuples and argument lists redact the value by its name", () => {
  const S = "Hs4Zq9PairSecret";
  it.each([
    ["{key,value}", { key: "api_key", value: S }],
    ["{Name,Value} (AWS SSM and ECS)", { Name: "DB_PASSWORD", Value: S }],
    ["{ParameterKey,ParameterValue} (CloudFormation)", { ParameterKey: "AdminPassword", ParameterValue: S }],
    ["{header,value}", { header: "Authorization", value: `Basic ${S}` }],
    ["{name,value} lowercase (Kubernetes)", { name: "DB_PASSWORD", value: S }],
  ])("%s", (_label, doc) => {
    const out = JSON.stringify(once(doc));
    expect(out.includes(S), out).toBe(false);
  });

  it("a tuple list and an argument vector", () => {
    for (const doc of [[["password", S]], { argv: ["run", "--password", S, "--verbose"] }, { argv: ["--token", S] }, { env: [["API_KEY", S], ["REGION", "eu"]] }]) {
      const out = JSON.stringify(once(doc));
      expect(out.includes(S), out).toBe(false);
    }
  });

  it("control: a pair or list whose name is an ordinary word keeps its value", () => {
    for (const doc of [{ name: "region", value: "KEEPME55" }, { key: "colour", value: "KEEPME55" }, ["colour", "KEEPME55"], { argv: ["--verbose", "KEEPME55"] }, ["the password is required", "KEEPME55"]]) {
      expect(JSON.stringify(once(doc)).includes("KEEPME55"), JSON.stringify(doc)).toBe(true);
    }
  });
});

describe("concatenated and compound key names are sensitive", () => {
  it.each([
    "dbpass", "userpass", "adminpwd", "secretkey", "SECRETKEY", "signingkey", "encryption_key", "encryptionkey", "master_key", "masterkey", "passcode",
    "dsn", "cookies", "tokenvalue", "tokenstring", "authkey", "secretvalue", "connectionString", "ssh_key", "jwt", "bearer",
  ])("%s", (key) => {
    expect(isSensitiveKey(key), key).toBe(true);
    expect(JSON.stringify(once({ [key]: "hunter2xyzSECRET" })).includes("hunter2xyzSECRET"), key).toBe(false);
  });

  it.each(["passed", "passing", "author", "authority", "secretary", "tokenizer", "tokens_used", "region", "keyboard", "dsnp", "cookiecutter_template", "summary", "PASS"])(
    "control: %s is not",
    (key) => {
      expect(isSensitiveKey(key), key).toBe(false);
      expect(JSON.stringify(once({ [key]: "KEEPME55" })).includes("KEEPME55"), key).toBe(true);
    },
  );
});

describe("the redaction marker itself is stable", () => {
  it("redacting [REDACTED] changes nothing, as a value and as a key", () => {
    expect(JSON.stringify(once({ [REDACTED]: REDACTED }))).toBe(JSON.stringify({ [REDACTED]: REDACTED }));
  });
});
