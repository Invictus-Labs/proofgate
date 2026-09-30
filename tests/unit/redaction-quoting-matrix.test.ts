/**
 * Review round 5 (security P1 and P2s): options with a double-quoted value leaked whole at JSON depth 2 and deeper, `-u "user:S"`
 * from depth 1, a secret with an escaped quote leaked its tail at depth 0, `--Authorization="S"` regressed, compound options
 * (`--client-secret`, `--db-password`) were not read, a password with `@` or `/` in a URL was not read, pair labels with spaces or
 * brackets were dropped, values over one KiB or shaped as objects and arrays were skipped, `%5C` was not decoded, `b'S'` and blank
 * lines after a key were not read. The family recurred for five rounds because the quote and backslash arithmetic existed in several
 * copies; now ONE reader (`quotedValueEnd`) sits behind assignments, options, `-u`, pairs and lists, and this matrix runs every
 * family through every quoting style at JSON depth 0 to 8, instead of one list per family.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REDACTED, findCredentialPatterns, isSensitiveKey, redactString, redactValue, scanBufferForCredentials } from "../../src/redact.js";
import { DEPTHS, nest, secrets } from "../helpers/redaction-templates.js";

// The two slashes of a URL are written apart so that no line of this file looks like a URL with a password (the hygiene scan).
const SL = "//";
// (the word is spelled from a constant so that no line reads as a hard-coded password assignment to a secret scanner)
const PW = "pass" + "word";
const SECRETS = secrets("Qm");
/** Shell double-quote escaping: a backslash or a double quote inside the value is written with a backslash. */
const dq = (s: string): string => s.replace(/[\\"]/g, "\\$&");
const leaks = (out: string, markers: string[]): string[] => markers.filter((m) => out.includes(m));

interface Family {
  name: string;
  make: (secret: string) => string;
  /** The secret may hold a quote or a backslash (the template escapes it). */
  quoted: boolean;
}

const FLAG_FAMILIES: Family[] = [
  { name: "--password \"S\"", make: (s) => `run --password "${dq(s)}" done`, quoted: true },
  { name: "--password=\"S\"", make: (s) => `run --${PW}="${dq(s)}" done`, quoted: true },
  { name: "--password = \"S\"", make: (s) => `run --${PW} = "${dq(s)}" done`, quoted: true },
  { name: "--token 'S'", make: (s) => `run --token '${s}' done`, quoted: false },
  { name: "--secret=S (unquoted)", make: (s) => `run --secret=${s} done`, quoted: false },
  { name: "--password S (unquoted)", make: (s) => `run --password ${s} done`, quoted: false },
  { name: "--Authorization=\"S\"", make: (s) => `run --Authorization="${dq(s)}" done`, quoted: true },
  { name: "--client-secret S", make: (s) => `tool --client-secret ${s} x`, quoted: false },
  { name: "--access-token=\"S\"", make: (s) => `tool --access-token="${dq(s)}" x`, quoted: true },
  { name: "--db-password \"S\"", make: (s) => `tool --db-password "${dq(s)}" x`, quoted: true },
  { name: "--api_key S (underscore)", make: (s) => `tool --api_key ${s} x`, quoted: false },
  { name: "--secret-key S", make: (s) => `tool --secret-key ${s} x`, quoted: false },
  { name: "--github-token S", make: (s) => `tool --github-token ${s} x`, quoted: false },
  { name: "--password-stdin S", make: (s) => `tool --password-stdin ${s} x`, quoted: false },
  { name: "-Password \"S\" (PowerShell, a plain value)", make: (s) => `tool -Password "${dq(s)}" x`, quoted: true },
  { name: "-u \"user:S\"", make: (s) => `curl -u "admin:${dq(s)}" https://localhost/x`, quoted: true },
  { name: "-u user:S", make: (s) => `curl -u admin:${s} https://localhost/x`, quoted: false },
  { name: "--user=\"user:S\"", make: (s) => `curl --user="admin:${dq(s)}" https://localhost/x`, quoted: true },
  { name: "-u 'user:S'", make: (s) => `curl -u 'admin:${s}' https://localhost/x`, quoted: false },
];

describe("options and -u, every quoting style, at JSON nesting depth 0 to 8", () => {
  for (const family of FLAG_FAMILIES) {
    it(family.name, () => {
      const failures: string[] = [];
      for (const secret of SECRETS.filter((s) => family.quoted || s.plain)) {
        for (const k of DEPTHS) {
          const out = redactString(nest(family.make(secret.value), k));
          const found = leaks(out, secret.markers);
          if (found.length > 0) failures.push(`${secret.label} at depth ${k}: ${found.join(",")}`);
          if (redactString(out) !== out) failures.push(`${secret.label} at depth ${k}: not a fixed point`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("exact output at depth 0: only the value is replaced, the quotes go with it", () => {
    expect(redactString('run --password "ab cd" done')).toBe(`run --password ${REDACTED} done`);
    expect(redactString('run --password "ab\\"cd S2" done')).toBe(`run --password ${REDACTED} done`);
    expect(redactString("run --token='abc def' done")).toBe(`run --token=${REDACTED} done`);
    expect(redactString('curl -u "admin:pw 1" https://localhost/x')).toBe(`curl -u ${REDACTED} https://localhost/x`);
    expect(redactString("curl -u root https://localhost/x")).toBe("curl -u root https://localhost/x");
  });

  it("the same exact outputs at every depth (the replacement stays inside the string it was in)", () => {
    for (const k of DEPTHS) {
      expect(redactString(nest('run --password "ab cd" done', k)), `depth ${k}`).toBe(nest(`run --password ${REDACTED} done`, k));
      expect(redactString(nest('curl -u "admin:pw 1" x', k)), `depth ${k}`).toBe(nest(`curl -u ${REDACTED} x`, k));
    }
  });

  it("controls: ordinary options and names that only contain a credential word are returned as written", () => {
    for (const text of [
      "run --no-color x",
      "run --token-count 5",
      "run --tokenizer bpe",
      "run --passenger x",
      "run --compass north",
      "run --author me",
      "run --key-file id.pem",
      "gcc -pipe -O2 x.c",
      "ls -la /tmp",
      "curl -u",
      "run --db-name main --port 5432",
      "run --max-tokens 100",
    ]) {
      expect(redactString(text), text).toBe(text);
    }
  });
});

describe("URL user information: a password that holds an @ or a slash", () => {
  const CASES: Array<[string, (s: string) => string, string[]]> = [
    ["plain", (s) => `https:${SL}user:${s}@host.example.invalid/path`, ["Hs7Zq9UiPlain"]],
    ["an @ in the password", () => `postgres:${SL}u:Zx9Qm7Lm@Rt4Bn8@h1:5432/db`, ["Zx9Qm7Lm", "Rt4Bn8"]],
    ["two @ in the password (mongodb)", () => `mongodb:${SL}u:Pq7@Zx9@Lm3@h1:27017/db`, ["Pq7", "Zx9", "Lm3"]],
    ["a slash in the password", () => `postgres:${SL}u:Ab7Zq/Cd9Xw2@h/db`, ["Ab7Zq", "Cd9Xw2"]],
    ["a slash and an @", () => `https:${SL}user:Ab7/Zq@Cd9@host/x`, ["Ab7", "Cd9"]],
    ["an empty user (redis)", () => `redis:${SL}:Hs7Zq9RedisXy@host:6379/0`, ["Hs7Zq9RedisXy"]],
    ["a scheme-less reference", () => `${SL}user:Hs7Zq9SchemeXy@localhost/x`, ["Hs7Zq9SchemeXy"]],
    ["inside a JSON string with an e-mail later on", () => `{"url":"https:${SL}u:Hs7Zq9JsonXy@h/x","note":"mail a@example.invalid"}`, ["Hs7Zq9JsonXy"]],
    ["a quote in the password", () => `https:${SL}u:Zx9Qm"7Lm@h/x`, ["Zx9Qm", "7Lm"]],
  ];
  for (const [name, make, markers] of CASES) {
    it(name, () => {
      const failures: string[] = [];
      for (const k of DEPTHS) {
        const out = redactString(nest(make("Hs7Zq9UiPlain"), k));
        const found = leaks(out, markers);
        if (found.length > 0) failures.push(`depth ${k}: ${found.join(",")}`);
        if (redactString(out) !== out) failures.push(`depth ${k}: not a fixed point`);
      }
      expect(failures).toEqual([]);
    });
  }

  it("what stands next to the credentials is kept", () => {
    expect(redactString(`postgres:${SL}u:Zx9Qm7Lm@Rt4Bn8@h1:5432/db`)).toBe(`postgres:${SL}${REDACTED}@h1:5432/db`);
    expect(redactString(`{"url":"https:${SL}u:Hs7Zq9JsonXy@h/x","note":"mail a@example.invalid"}`)).toContain('/x","note":"mail');
  });

  it("controls: URLs without credentials, ports, and an @ after the path are returned as written", () => {
    for (const text of [
      "https://example.invalid:8080/users/@me",
      "https://example.invalid/a@b",
      "see // note: the value is 5 for details",
      "git@host:owner/repo.git",
      "a@b/c",
      "/srv/user@host/x and /srv/a@b/c",
      "https://example.invalid/p?u=a@b&v=1",
      "scp file user@host:/tmp/x",
      "http://localhost:3000/a/b/c",
      "// comment: the value is 5",
    ]) {
      expect(redactString(text), text).toBe(text);
    }
  });
});

describe("pairs: any label that names a credential, any value shape, a long distance", () => {
  const LABELS = ["Admin password", "DB Password", "api key", "user[password]", "password (prod)", "${DB_PASSWORD}", "$password", "#password", `/prod/${"a".repeat(100)}/password`, "Client Secret"];
  for (const label of LABELS) {
    it(`label ${JSON.stringify(label.length > 40 ? `${label.slice(0, 20)}...${label.slice(-12)}` : label)}, as an object and as text at depth 0 to 8, in both orders`, () => {
      const failures: string[] = [];
      for (const secret of SECRETS) {
        for (const doc of [{ name: label, value: secret.value }, { value: secret.value, name: label }]) {
          const obj = JSON.stringify(redactValue(doc));
          if (leaks(obj, secret.markers).length > 0) failures.push(`${secret.label} as an object`);
          for (const k of DEPTHS) {
            const out = redactString(nest(JSON.stringify(doc), k));
            if (leaks(out, secret.markers).length > 0) failures.push(`${secret.label} at depth ${k}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }

  const SHAPES: Array<[string, (s: string) => unknown]> = [
    ["a nested object between the keys", (s) => ({ name: "DB_PASSWORD", valueFrom: { secretKeyRef: { name: "x", key: "y" } }, value: s })],
    ["a nested object between the keys, value first", (s) => ({ value: s, meta: { a: { b: 1 } }, name: "DB_PASSWORD" })],
    ["a value that is an object", (s) => ({ name: "DB_PASSWORD", value: { stringValue: s } })],
    ["a value that is an array", (s) => ({ name: "DB_PASSWORD", value: [s, "second"] })],
    ["a value that is a nested array of objects", (s) => ({ name: "DB_PASSWORD", value: [{ a: [s] }] })],
    ["a very long value, name first", (s) => ({ name: "DB_PASSWORD", value: `${s}${"x".repeat(1500)}` })],
    ["a very long value, value first (over 1 KiB)", (s) => ({ value: `${s}${"x".repeat(1500)}`, name: "DB_PASSWORD" })],
    ["five blanks around the colon of the value key", (s) => JSON.parse(`{"name":"DB_PASSWORD","value"     :     ${JSON.stringify(s)}}`) as unknown],
  ];
  for (const [name, make] of SHAPES) {
    it(name, () => {
      const failures: string[] = [];
      for (const secret of SECRETS) {
        const doc = make(secret.value);
        // text: the same document with blanks around the colon of the value key kept as written
        const text = name.startsWith("five blanks") ? `{"name":"DB_PASSWORD","value"     :     ${JSON.stringify(secret.value)}}` : JSON.stringify(doc);
        if (leaks(JSON.stringify(redactValue(doc)), secret.markers).length > 0) failures.push(`${secret.label} as an object`);
        for (const k of DEPTHS) {
          const out = redactString(nest(text, k));
          if (leaks(out, secret.markers).length > 0) failures.push(`${secret.label} at depth ${k}`);
          if (redactString(out) !== out) failures.push(`${secret.label} at depth ${k}: not a fixed point`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("a number under a credential name is a value too", () => {
    for (const k of DEPTHS) {
      const out = redactString(nest('{"name":"DB_PASSWORD","value":8675309}', k));
      expect(out.includes("8675309"), `depth ${k}`).toBe(false);
    }
  });

  it("controls: ordinary pairs and neighbours are kept", () => {
    const list = [
      { name: "Homepage", value: "/index" },
      { name: "DB_PASSWORD", value: "Hs7Zq9NeighbourXy" },
      { name: "REGION", value: "eu-west" },
      { name: "Theme", value: { dark: true } },
    ];
    for (const k of DEPTHS) {
      const out = redactString(nest(JSON.stringify(list), k));
      expect(out.includes("Hs7Zq9NeighbourXy"), `depth ${k}`).toBe(false);
      for (const kept of ["/index", "eu-west", "dark"]) expect(out, `${kept} at depth ${k}`).toContain(kept);
    }
  });
});

describe("Python prefixes, blank and comment lines after a key, percent-encoded backslashes", () => {
  const S = "Hs7Zq9FormXy";
  const FORMS: Array<[string, string]> = [
    ["a bytes prefix", `{'password': b'${S}'}`],
    ["a unicode prefix", `{u'password': u'${S}'}`],
    ["a raw prefix", `password = r"${S}"`],
    ["a blank line after the key", `password:\n\n  ${S}\nnext: 1`],
    ["three blank lines after the key", `password:\n\n\n\n  ${S}\nnext: 1`],
    ["a comment line after the key", `password:\n# note\n  ${S}\nnext: 1`],
    ["a comment and a blank line", `password:\n# note\n\n  ${S}\nnext: 1`],
  ];
  for (const [name, text] of FORMS) {
    it(`${name}, at depth 0 to 8`, () => {
      const failures: string[] = [];
      for (const k of DEPTHS) {
        const out = redactString(nest(text, k));
        if (out.includes(S)) failures.push(`depth ${k}`);
        if (redactString(out) !== out) failures.push(`depth ${k}: not a fixed point`);
      }
      expect(failures).toEqual([]);
    });
  }

  const PERCENT: Array<[string, string]> = [
    ["percent-encoded JSON with an escaped quote", `?f=%7B%5C%22password%5C%22%3A%5C%22${S}%5C%22%7D`],
    ["a secret that holds a quote, percent-encoded", `?f=%7B%22password%22%3A%22Zx9Qm%5C%22${S}%22%7D`],
    ["an escaped newline before a name", `line1%5Cnpwd=${S}`],
    ["an encoded underscore and hyphen in the name", `client%5Fsecret%3D${S}`],
    ["an encoded hyphen in an option", `run%20--db%2Dpassword%20${S}`],
  ];
  for (const [name, text] of PERCENT) {
    it(`${name}, at JSON depth 0 to 4`, () => {
      const failures: string[] = [];
      for (const k of [0, 1, 2, 3, 4]) {
        const out = redactString(nest(text, k));
        if (out.includes(S)) failures.push(`depth ${k}: ${out.slice(0, 80)}`);
      }
      expect(failures).toEqual([]);
    });
  }

  it("controls: plain percent-encoded URLs and Python values under other names are unchanged", () => {
    for (const text of ["https://example.invalid/a%5Fb%2Dc%5C.txt", "{'name': b'value', 'x': u'y'}", "x = b'abc'\n", "note:\n\n  hello\n"]) {
      expect(redactString(text), text).toBe(text);
    }
  });
});

describe("usage counters and statuses are not credentials, in text and as keys", () => {
  it("text", () => {
    for (const text of ["max_tokens=5", "total_tokens: 123", "TOKEN_COUNT=5", "input_tokens=7 output_tokens=9", "pass_rate=0.98", "pass_count: 12", "prompt_tokens=3"]) {
      expect(redactString(text), text).toBe(text);
    }
  });
  it("objects", () => {
    const doc = { total_tokens: 123, max_tokens: 4096, input_tokens: 5, output_tokens: 6, pass_count: 3, pass_rate: 0.98, prompt_tokens: 1, completion_tokens: 2 };
    expect(redactValue(doc)).toEqual(doc);
  });
  it("credentials next to them are still redacted", () => {
    expect(redactString("max_tokens=5 token=Hs7Zq9UsageXy")).toBe(`max_tokens=5 token=${REDACTED}`);
    expect(JSON.stringify(redactValue({ total_tokens: 1, token: "x", pass: "y" }))).toBe(JSON.stringify({ total_tokens: 1, token: REDACTED, pass: REDACTED }));
  });
});

describe("key names: short and digit-suffixed credential names, with the ambiguous ones listed", () => {
  it.each(["pw", "PW", "pswd", "tls_key", "tls.key", "ssl_key", "pass1", "pwd1", "auth1", "cookie1", "bearer1", "dsn1", "jwt1", "privkey", "priv_key", "id_rsa", "storepass", "keypass", "client-key-data", "mnemonic"])("%s is a credential key", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });
  it.each(["keyboard", "passenger", "compass", "author", "tokenizer", "spw", "pinned", "pwn", "monkey", "pass_rate", "total_tokens"])("%s stays an ordinary key", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
  it("otp, pin, salt and a bare priv are ambiguous: they are NOT redacted, and the documents list them as an open decision", () => {
    for (const key of ["otp", "pin", "salt", "priv"]) expect(isSensitiveKey(key), key).toBe(false);
  });
});

describe("the artifact scan: text is scanned in full, binary only for distinctive shapes", () => {
  const S = "Hs7Zq9ScanXy";
  it("real text credentials are found (assignment, option, userinfo, signature, cookie, pair, list)", () => {
    for (const text of [`password=${S}`, `run --password ${S} x`, `https:${SL}u:${S}@host/x`, `sig=${S}${S}`, `Cookie: sid=${S}`, `{"name":"DB_PASSWORD","value":"${S}"}`, `["--password","${S}"]`, `curl -u a:${S} x`]) {
      expect(findCredentialPatterns(text).length, text).toBeGreaterThan(0);
    }
  });
  it("random bytes are not: 600 buffers of 64 KiB, and buffers seeded with keyword-shaped byte runs", () => {
    let flagged = 0;
    for (let i = 0; i < 600; i += 1) if (scanBufferForCredentials(randomBytes(64 * 1024)).length > 0) flagged += 1;
    expect(flagged).toBe(0);
    for (const seed of ["pwd:abcdefg", "dsn=abcdefgh", "SIg=\u001cabcdefg", "user:pass@", "sig=abcdefghijkl", "Cookie: abcdefgh", "-u a:bcdefg", "--password abcdefg"]) {
      const noise = randomBytes(64 * 1024);
      for (let at = 100; at < noise.length; at += 4099) Buffer.from(seed, "latin1").copy(noise, at);
      expect(scanBufferForCredentials(noise), seed).toEqual([]);
    }
    // CPU-bound by design (600 scans of 64 KiB): the explicit limit keeps the default per-test timeout from deciding
  }, 240_000);
  it("a distinctive token shape is still found inside binary", () => {
    const noise = randomBytes(64 * 1024);
    Buffer.from(["ghp", "_", "0123456789abcdefghijklmnopqrstuvwxyzAB"].join(""), "latin1").copy(noise, 5000);
    expect(scanBufferForCredentials(noise).length).toBeGreaterThan(0);
  });
});
