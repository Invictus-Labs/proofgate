/**
 * Review round 3 (tests, security and logic re-reviews of the round-2 tree). The redactor was again the source of most findings:
 * a token glued to a letter, a digit or an ESCAPE (a literal backslash-n, %0A, %20) was not redacted although the documents
 * promised it; escaped quotes and aligned or multi-line assignments kept their values; a value that merely contained a
 * credential word and ended in a colon was mistaken for the next key (a regression of round 2); dotted, bracketed and
 * all-lowercase key names kept their values; redaction was not idempotent; some credential forms were unknown.
 * Every planted value is assembled from fragments. Tests that plant a glued or escaped form fail on the round-2 tree.
 */
import { describe, expect, it } from "vitest";
import { MAX_REDACT_STRING, REDACTED, isSensitiveKey, redactString, redactValue } from "../../src/redact.js";

const j = (...parts: string[]): string => parts.join("");
const alnum = (n: number, seed = 0): string => Array.from({ length: n }, (_, i) => "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"[(i * 7 + seed) % 36]).join("");
const hex = (n: number): string => "0123456789abcdef".repeat(Math.ceil(n / 16)).slice(0, n);

/** [shape name, the token, does it have a distinctive prefix (so that a letter or digit in front does not hide it)] */
const TOKENS: Array<[string, string, boolean]> = [
  ["ghp", j("ghp", "_", alnum(36)), true],
  ["gho", j("gho", "_", alnum(36)), true],
  ["ghu", j("ghu", "_", alnum(36)), true],
  ["ghs", j("ghs", "_", alnum(36)), true],
  ["ghr", j("ghr", "_", alnum(36)), true],
  ["github_pat", j("github", "_pat_", alnum(60)), true],
  ["glpat", j("glpat", "-", alnum(24)), true],
  ["npm", j("npm", "_", alnum(40)), true],
  ["xoxb", j("xox", "b-", alnum(30)), true],
  ["sk-ant", j("sk", "-ant-", alnum(40)), true],
  ["sendgrid", j("SG", ".", alnum(22), ".", alnum(43)), true],
  ["huggingface", j("hf", "_", alnum(34)), true],
  ["google api", j("AIza", alnum(35)), true],
  ["google oauth", j("ya", "29.", alnum(40)), true],
  ["sk_live", j("sk", "_live_", alnum(24)), true],
  ["rk_live", j("rk", "_live_", alnum(24)), true],
  ["digitalocean", j("dop", "_v1_", hex(64)), true],
  ["shopify", j("shp", "at_", hex(32)), true],
  ["jwt", j("eyJ", alnum(20), ".", alnum(30), ".", alnum(40)), true],
  ["aws", j("AKI", "A", "IOSFODNN7EXAMPLE"), true],
  ["slack app", j("xapp", "-1-", alnum(12), "-", "1234567890", "-", alnum(30).toLowerCase()), true],
  ["pypi", j("pypi", "-", alnum(60)), true],
  ["docker pat", j("dckr", "_pat_", alnum(30)), true],
  ["gitlab deploy", j("gldt", "-", alnum(30)), true],
  // Short or ordinary-looking prefixes: an ESCAPE or a separator in front is a boundary, a bare letter or digit is not.
  ["sk-", j("sk", "-", alnum(40)), false],
  ["twilio api key", j("SK", hex(32)), false],
  ["twilio account", j("A", "C", hex(32)), false],
  ["mailgun", j("key", "-", hex(32)), false],
];

/** What can sit directly in front of a token: [label, text, is it a plain letter or digit] */
const PREFIXES: Array<[string, string, boolean]> = [
  ["nothing", "", false],
  ["a space", " ", false],
  ["a colon", ":", false],
  ["an underscore", "_", false],
  ["a literal backslash-n", "\\n", false],
  ["a literal backslash-t", "\\t", false],
  ["a literal backslash-r", "\\r", false],
  ["a percent-encoded space", "%20", false],
  ["a percent-encoded newline", "%0A", false],
  ["a percent-encoded tab", "%09", false],
  ["a literal backslash-u0020", "\\u0020", false],
  ["a literal backslash-x20", "\\x20", false],
  ["a word", "word", true],
  ["a letter", "x", true],
  ["a digit", "9", true],
];

describe("a token behind a separator, or behind an escape that stands for one, is redacted (every shape)", () => {
  const cases = TOKENS.flatMap(([shape, token, distinctive]) => PREFIXES.filter(([, , letter]) => !letter || distinctive).map(([label, prefix]) => [shape, label, token, prefix] as const));
  it.each(cases)("%s after %s", (_shape, _label, token, prefix) => {
    const text = j("log line ", prefix, token, " trailing");
    const out = redactString(text);
    expect(out.includes(token.slice(-24)), text.slice(0, 60)).toBe(false);
    expect(out).toContain(REDACTED);
    expect(out.startsWith("log line ")).toBe(true);
  });

  it("the same tokens glued to a letter are NOT redacted when the prefix is short and ordinary ('task-...' is prose)", () => {
    // A documented limit: `sk-`, the Twilio hex keys and `key-` with a letter in front are not treated as credentials.
    const prose = j("task", "-", "runner-configuration-module-for-payments");
    expect(redactString(prose)).toBe(prose);
  });

  it("a JSON log kept as a string inside a JSON string (the realistic case) is redacted, escaped newlines included", () => {
    const token = j("ghp", "_", alnum(36));
    const inner = JSON.stringify({ log: `first\n${token}`, note: "x" });
    const twice = JSON.stringify(inner);
    for (const text of [inner, twice, JSON.stringify(twice)]) expect(redactString(text).includes(token.slice(-24)), text.slice(0, 50)).toBe(false);
    const doc = JSON.stringify(redactValue({ extensions: { "x-note": `line1\\n${token}` } }));
    expect(doc.includes(token.slice(-24))).toBe(false);
  });
});

describe("escaped quotes (JSON inside a JSON string) do not shield a value", () => {
  const v = "hunter2-value-with-tail-9f8e7d6c";
  it.each([
    ["escaped key and value", j('{\\"pass', 'word\\": \\"', v, '\\"}')],
    ["escaped value with spaces", j("pass", 'word=\\"', v, " and more words", '\\"')],
    ["escaped flag value", j("--pass", 'word \\"', v, '\\"')],
    ["double-escaped", j('{\\\\\\"pass', 'word\\\\\\": \\\\\\"', v, '\\\\\\"}')],
    ["escaped single quotes", j("{\\'client_", "secret\\': \\'", v, "\\'}")],
  ])("%s", (_label, text) => {
    const out = redactString(text);
    expect(out.includes(v.slice(-16)), text).toBe(false);
    expect(out).toContain(REDACTED);
  });
});

describe("a value that merely contains a credential word and ends in a colon is a secret, not the next key (round-2 regression)", () => {
  it.each([
    ["basic header ending in a sentence", `Authorization: Basic ${j("dXNlcjpwYXNz", "d29yZDEyMw==")} rejected, invalid token:`],
    ["basic header ending in a word", `Authorization: Basic ${j("dXNlcjpwYXNz", "d29yZDEyMw==")} check the password:`],
    ["password containing secret", j("pass", "word=", "mysecret:")],
    ["password containing token", j("pass", "word=", "hunter2token:")],
    ["api key containing secret", j("api", "_key=", "AbCdEf123456_secret:")],
  ])("%s", (_label, text) => {
    const out = redactString(text);
    expect(out).toContain(REDACTED);
    for (const leaked of ["dXNlcjpwYXNz", "mysecret", "hunter2token", "AbCdEf123456"]) expect(out.includes(leaked), `${leaked} in ${out}`).toBe(false);
  });

  it("a QUOTED value that contains a credential word but is not a whole name is a secret, even when a colon follows it", () => {
    for (const text of [
      j("pass", 'word: "p@ss token": "z"'),
      j("pass", 'word = "hunter2 secret": x'),
      j("api", '_key="Ab Cd token"=yes'),
    ]) {
      const out = redactString(text);
      for (const leaked of ["p@ss", "hunter2", "Ab Cd"]) expect(out.includes(leaked), `${leaked} in ${out}`).toBe(false);
    }
  });

  it("a whole credential-named key is still recognised as the next key", () => {
    expect(redactString(j("pass", ' : "token": "abc123def456"')).includes("abc123def456")).toBe(false);
    expect(redactString("pass : token: abc123def456").includes("abc123def456")).toBe(false);
  });
});

describe("redaction is idempotent (a bundle restores by redacting again and comparing)", () => {
  it("the reviewer's two-header line that ends in a colon is a fixed point", () => {
    const line = "x Authorization: Bearer UpRwUzdpmcG6BZpAO2sbG5hRp8J8jp Authorization: Bearer PKGA1H7Sst0tFFnOuPWlwjem5sV6U2 error:";
    const once = redactString(line);
    expect(redactString(once)).toBe(once);
  });

  it("the glued -p flag whose redaction introduced capitals settles", () => {
    const line = "-pcookie.:a;" + j("pass", "word:x");
    const once = redactString(line);
    expect(redactString(once)).toBe(once);
  });

  it("300,000 random fragment strings: redact(redact(x)) === redact(x), and every output is bounded", () => {
    const fragments = [
      "Authorization: ", "Bearer ", "Basic ", "error:", " token:", j("pass", "word="), "--pass ", "-p", "cookie.", ":a;", "ghp_", alnum(36), "x", "9", "\\n", "%0A", '"', "'", "\\\"", " ", "\t", "\n", ",", ";", "=", ":", "[", "]",
      "eyJ", ".", alnum(12), "key-", hex(32), "SK", "AC", "sk-", "@", "a.b", "http://", "user:pw@", "Set-Cookie: ", "-u ", "--user ", "PASS=", "session_id=",
    ];
    let seed = 0x1d3a;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 300_000; i += 1) {
      let text = "";
      for (let k = 0, n = 2 + Math.floor(next() * 10); k < n; k += 1) text += fragments[Math.floor(next() * fragments.length)];
      const once = redactString(text);
      const twice = redactString(once);
      if (twice !== once) expect(twice, `not a fixed point: ${JSON.stringify(text)}`).toBe(once);
      if (once.length > text.length * 4 + 64) expect(once.length, JSON.stringify(text)).toBeLessThanOrEqual(text.length * 4 + 64);
    }
  });
});

describe("key names: every non-alphanumeric character separates segments, and strong words inside one segment count", () => {
  it.each([
    "spring.datasource.password", "db.password", "app.auth.token", "aws.secret.key", "user[password]", "user:password", "example.com/api-key", "db password", "Password ",
    "password1", "PASSWORD1", "dbpassword", "mytoken", "accesstoken", "authtoken", "apitoken", "clientsecret", "clientsecret2", "a.b.secret", "x.token", "myapikey", "dbPass", "DB.PASS",
  ])("treats %j as sensitive", (key) => {
    expect(isSensitiveKey(key), key).toBe(true);
    expect(redactValue({ [key]: "hunter2hunter2" })).toEqual({ [key]: REDACTED });
  });

  it.each(["PASS", "Pass", "passed", "passing", "author", "authority", "tokens_used", "token_count", "secretary", "tokenizer", "environment", "receipt_id", "mandatory_passed", "accounting", "signal", "requirements.0.title"])(
    "does not treat %j as sensitive",
    (key) => {
      expect(isSensitiveKey(key), key).toBe(false);
    },
  );

  it("a Kubernetes-style name/value pair object redacts the value", () => {
    const out = redactValue({ env: [{ name: "DB_PASSWORD", value: "hunter2hunter2" }, { name: "REGION", value: "eu" }] }) as { env: Array<{ value: string }> };
    expect(out.env[0]?.value).toBe(REDACTED);
    expect(out.env[1]?.value).toBe("eu");
  });
});

describe("assignment names are judged by their segments, not by a fixed keyword list", () => {
  it.each([
    ["pwd", "pwd=hunter2hunter2"],
    ["DB_PASS", "DB_PASS=hunter2hunter2"],
    ["dbPass", "dbPass=hunter2hunter2"],
    ["PASS (upper case, an environment variable)", "PASS=hunter2hunter2"],
    ["auth", "auth=hunter2hunter2"],
    ["a dotted key", "spring.datasource.pass=hunter2hunter2"],
    ["a suffix secret", "client_secret=hunter2hunter2"],
  ])("%s", (_label, text) => {
    const out = redactString(text);
    expect(out.includes("hunter2hunter2"), out).toBe(false);
    expect(out).toContain(REDACTED);
  });
  it("control: ordinary words that merely start like a credential name are left alone", () => {
    for (const text of ["passed=10", "author=someone", "passing=yes", "summary: PASS", "authority=local"]) expect(redactString(text), text).toBe(text);
  });
});

describe("assignments: blanks, line breaks and long names do not hide a value", () => {
  const v = "s3cr3t-value-abcdef";
  const pw = j("pass", "word");
  it.each([
    ["four spaces after the colon", `${pw}:    ${v}`],
    ["padding before and after '='", `${pw}   =    ${v}`],
    ["a tab run", `${pw}:\t\t\t\t${v}`],
    ["padding before the colon", `${pw}    : ${v}`],
    ["a padded JSON value", `{"${pw}":    "${v}"}`],
    ["the value on the next line", `${pw}:\n  ${v}\nnext: line`],
    ["a Windows line break", `${pw}:\r\n    ${v}`],
    ["an Authorization value on the next line", `Authorization:\n Basic ${v}`],
    ["a name that runs far past the keyword", `${pw}_for_the_database_of_the_production_service_in_eu=${v}`],
    ["a name with a long prefix", `the_production_database_connection_${pw}=${v}`],
  ])("%s", (_label, text) => {
    const out = redactString(text);
    expect(out.includes(v), text).toBe(false);
    expect(out).toContain(REDACTED);
  });
});

describe("credential forms that the documents implied but the redactor did not know", () => {
  const v = "hunter2-Value-9f8e7d";
  it.each([
    ["redis URL with an empty user", j("redis", ":", "//", ":", v, "@", "localhost", ":6379/0")],
    ["curl -u user:password", `curl -u admin:${v} https://example.invalid/`],
    ["curl --user user:password", `curl --user admin:${v} https://example.invalid/`],
    ["curl --user=user:password", `curl --user=admin:${v} https://example.invalid/`],
    ["--pass flag", `run --pass ${v} --region eu`],
    ["PASS= environment variable", `PASS=${v} ./run.sh`],
    ["session_id assignment", `session_id=${v}; path=/`],
    ["X-Cookie header", `X-Cookie: sid=${v}`],
    ["upper-case Slack webhook", j("HTTPS://HOOKS.", "SLACK.COM/services/T01234567/B01234567/", alnum(24))],
    ["Slack app token", j("xapp", "-1-A0123456789-1234567890123-", alnum(40).toLowerCase())],
    ["PyPI token", j("pypi", "-AgEIcHlwaS5vcmc", alnum(60))],
    ["Docker personal access token", j("dckr", "_pat_", alnum(30))],
    ["GitLab deploy token", j("gldt", "-", alnum(30))],
    ["Kubernetes pair in text", `{"name":"DB_PASSWORD","value":"${v}"}`],
    ["Kubernetes pair, escaped", `{\\"name\\":\\"API_TOKEN\\",\\"value\\":\\"${v}\\"}`.replaceAll('\\"', '"')],
  ])("%s", (_label, text) => {
    const out = redactString(text);
    expect(out.includes(v) || out.includes(alnum(24)), text).toBe(false);
    expect(out).toContain(REDACTED);
  });

  it("a bare `-u root` (no colon) is a user name, not a secret", () => {
    expect(redactString("mysql -u root -h localhost")).toBe("mysql -u root -h localhost");
  });
});

describe("oversize strings and keys are redacted whole (the process must not run out of memory)", () => {
  it("a string over the limit is replaced, one just under it is processed", () => {
    // Booleans, never the strings themselves: a failed comparison would print megabytes and crash the worker.
    expect(redactString("x".repeat(MAX_REDACT_STRING + 1)) === REDACTED).toBe(true);
    const under = "note ".repeat(Math.floor(MAX_REDACT_STRING / 5) - 1);
    expect(redactString(under) === under).toBe(true);
  });
  it("an oversize key is sensitive and its value is redacted", () => {
    const key = "aB".repeat(MAX_REDACT_STRING / 2 + 1);
    expect(isSensitiveKey(key)).toBe(true);
    const out = redactValue({ [key]: "value", ok: 1 }) as Record<string, unknown>;
    expect(Object.values(out)).toContain(REDACTED);
    expect(out.ok).toBe(1);
  });
});
