/**
 * Review round 4 (tests P3): the exact edges of the redactor's limits, each pinned on both sides so that moving one of them by
 * one is noticed: the blanks allowed around a separator (64), the longest string and key that are examined (4 MiB), the digits after
 * `secret` or `token` at the end of a name segment, and the spellings of compound key names that were found unrecognised.
 * (Not pinned, because they cannot be observed through the public functions: the 80-character left and right reach of the name
 * walk, whose effect is hidden by the keyword that started the walk, and the six-round settle limit, which only replaces a text
 * that would otherwise have been redacted further.)
 */
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { assertJsonDepth } from "../../src/canonical.js";
import { MAX_EXTENSION_DEPTH } from "../../src/limits.js";
import { parseManifestText } from "../../src/manifest.js";
import { MAX_REDACT_STRING, REDACTED, isSensitiveKey, redactString } from "../../src/redact.js";
import { baseManifest } from "../helpers/fixture.js";

const S = "Hs8Zq9EdgeSecretXy";

describe("blanks around a separator: 64 are read, 65 are not (documented)", () => {
  it.each([
    ["after a colon", (n: number) => `password:${" ".repeat(n)}${S}`],
    ["after an equals sign", (n: number) => `password=${" ".repeat(n)}${S}`],
    ["before an equals sign", (n: number) => `password${" ".repeat(n)}=${S}`],
    ["tabs after a colon", (n: number) => `password:${"\t".repeat(n)}${S}`],
  ])("%s", (_label, make) => {
    expect(redactString(make(1)).includes(S), "1 blank").toBe(false);
    expect(redactString(make(64)).includes(S), "64 blanks").toBe(false);
    expect(redactString(make(65)).includes(S), "65 blanks: past the reach, the value is left (the documented limit)").toBe(true);
  });
});

describe("the size cap: a string or key of exactly 4 MiB is examined, one character more is replaced whole", () => {
  it("strings", () => {
    const exact = "a".repeat(MAX_REDACT_STRING);
    expect(redactString(exact) === exact, "exactly the cap is processed").toBe(true);
    expect(redactString(`${exact}a`) === REDACTED, "one more is replaced").toBe(true);
  });
  it("keys", () => {
    expect(isSensitiveKey("a".repeat(MAX_REDACT_STRING))).toBe(false);
    expect(isSensitiveKey("a".repeat(MAX_REDACT_STRING + 1))).toBe(true);
  });
});

describe("the extensions nesting limit: 16 levels are accepted, 17 are refused", () => {
  const nested = (levels: number): unknown => {
    let value: unknown = "leaf";
    for (let i = 0; i < levels; i += 1) value = { level: value };
    return value;
  };
  it("assertJsonDepth and the constant agree", () => {
    expect(MAX_EXTENSION_DEPTH).toBe(16);
    expect(() => assertJsonDepth(nested(16), MAX_EXTENSION_DEPTH, "extensions")).not.toThrow();
    expect(() => assertJsonDepth(nested(17), MAX_EXTENSION_DEPTH, "extensions")).toThrow(/deeper than 16 levels/);
  });
  it("a manifest is held to it", () => {
    const yamlFor = (levels: number): string => stringify(baseManifest({ extensions: { root: nested(levels - 1) } }));
    expect(() => parseManifestText(yamlFor(16))).not.toThrow();
    expect(() => parseManifestText(yamlFor(17))).toThrow(/deeper than 16 levels/);
  });
});

describe("secret or token at the END of a name segment, with or without digits", () => {
  it.each(["clientsecret", "clientsecret2", "clientsecret123", "mytoken", "mytoken1", "accesstokens", "accesstokens42", "db_secret9"])("%s is a credential name", (key) => {
    expect(isSensitiveKey(key), key).toBe(true);
  });
  it.each(["secretary", "secretary2", "tokenizer", "tokenizer3", "secretion", "tokenize"])("control: %s is not", (key) => {
    expect(isSensitiveKey(key), key).toBe(false);
  });
});

describe("compound and concatenated key names that were found unrecognised", () => {
  it.each([
    "userpwd", "adminpwd", "dbpwd", "dbpass", "userpass", "rootpass", "servicepass", "encryptionKey", "encryption_key", "masterKey", "master_key", "signingKey",
    "secretKey", "secretkey", "SecretKey", "tokenValue", "authKey", "authToken", "passCode", "passcode", "DSN", "cookies", "connectionString", "sshKey", "ssh_key",
  ])("%s", (key) => {
    expect(isSensitiveKey(key), key).toBe(true);
  });
  it.each(["compass", "bypass", "keyboard", "monkey", "turkey", "passenger", "regionkey"])(
    "control: %s is not",
    (key) => {
      expect(isSensitiveKey(key), key).toBe(false);
    },
  );
});
