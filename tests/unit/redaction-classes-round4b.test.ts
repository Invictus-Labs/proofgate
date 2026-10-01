/**
 * Review round 4, second security review of the sibling product: the classes that the first round-4 tests left open, written
 * as generative tests (every template at JSON nesting depth 0..8 and at object level), not as single cases.
 *   1  name/value PAIRS in every order and shape, as text and as objects;
 *   2  YAML next-line values and list items after a credential key;
 *   3  percent-encoded separators (%3D %3A %22 %40 %20 %2F ...) in front of assignments, headers and URL userinfo;
 *   4  the WHOLE key tested for credential words, not only its segments (database_url, stripeKey, slack_webhook ...);
 *   5  idempotence on short mixed shapes;
 *   6  invisible code points of the newest Unicode blocks;
 *   7  an own "__proto__" key.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { REDACTED, findCredentialPatterns, isSensitiveKey, redactString, redactValue, scanBufferForCredentials } from "../../src/redact.js";
import { DEPTHS, nest, secrets } from "../helpers/redaction-templates.js";

const SECRETS = secrets("Cls");
const leaked = (out: string, markers: string[]): string[] => markers.filter((m) => out.includes(m));

/* ------------------------------------------------------------------------------------------------ 1  pairs */

interface PairShape {
  name: string;
  /** A JSON document (as text) holding the secret. */
  doc: (s: string) => unknown;
}

const PAIR_SHAPES: PairShape[] = [
  { name: "name, value", doc: (s) => ({ name: "DB_PASSWORD", value: s }) },
  { name: "value before name", doc: (s) => ({ value: s, name: "DB_PASSWORD" }) },
  { name: "AWS SSM (Name, Type, Value)", doc: (s) => ({ Name: "DB_PASSWORD", Type: "SecureString", Value: s }) },
  { name: "AWS SSM, value before an intervening key", doc: (s) => ({ Value: s, Type: "SecureString", Name: "DB_PASSWORD" }) },
  { name: "path-shaped name", doc: (s) => ({ name: "/prod/db/password", value: s }) },
  { name: "path-shaped name, value first", doc: (s) => ({ value: s, name: "/prod/db/password" }) },
  { name: "cookie pair (session)", doc: (s) => ({ name: "session", value: s }) },
  { name: "cookie pair (sessionid)", doc: (s) => ({ name: "sessionid", value: s }) },
  { name: "cookie pair (PHPSESSID)", doc: (s) => ({ name: "PHPSESSID", value: s }) },
  { name: "cookie pair (connect.sid)", doc: (s) => ({ name: "connect.sid", value: s }) },
  { name: "cookie pair (sid), value first", doc: (s) => ({ value: s, name: "sid" }) },
  { name: "ECS valueFrom and value", doc: (s) => ({ name: "DB_PASSWORD", valueFrom: "arn:aws:example:region:0:secret", value: s }) },
  { name: "ECS value, then valueFrom", doc: (s) => ({ value: s, valueFrom: "arn:aws:example:region:0:secret", name: "DB_PASSWORD" }) },
  { name: "key and value", doc: (s) => ({ key: "client_secret", value: s }) },
  { name: "header and value", doc: (s) => ({ header: "Authorization", value: s }) },
  { name: "parameter_name, parameter_value", doc: (s) => ({ parameter_name: "api_token", other: 1, parameter_value: s }) },
  { name: "tuple list", doc: (s) => [["password", s]] },
  { name: "tuple list, among others", doc: (s) => [["host", "localhost"], ["DB_PASSWORD", s], ["port", "5432"]] },
  { name: "argv list", doc: (s) => ["--password", s] },
  { name: "argv list, long", doc: (s) => ["run", "--verbose", "--token", s, "--out", "x"] },
  { name: "argv list, flag right after the command", doc: (s) => ["run", "--token", s] },
  { name: "argv list, two flags in a row", doc: (s) => ["run", "--password", "--token", s] },
  { name: "a closing brace inside an intervening value", doc: (s) => ({ name: "DB_PASSWORD", note: "a}b{c", value: s }) },
  { name: "a brace inside an intervening value, value first", doc: (s) => ({ value: s, note: "a}b{c", name: "DB_PASSWORD" }) },
  { name: "two credential names for one value", doc: (s) => ({ name: "DB_PASSWORD", key: "token", value: s }) },
  { name: "pair list with siblings", doc: (s) => [{ name: "HOST", value: "localhost" }, { value: s, name: "DB_PASSWORD" }, { name: "PORT", value: "5432" }] },
];

describe("class 1: pairs in every order and shape, as text at depth 0..8", () => {
  for (const shape of PAIR_SHAPES) {
    it(`${shape.name}`, () => {
      const failures: string[] = [];
      for (const secret of SECRETS) {
        const text = JSON.stringify(shape.doc(secret.value));
        for (const k of DEPTHS) {
          const out = redactString(nest(text, k));
          const found = leaked(out, secret.markers);
          if (found.length > 0) failures.push(`${secret.label} at depth ${k}: ${found.join(",")}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("keeps the non-credential siblings of a pair list (precision) at every depth", () => {
    const list = [
      { name: "HOST", value: "hostmarkerone" },
      { value: SECRETS[0]?.value, name: "DB_PASSWORD" },
      { name: "PORT", value: "portmarkertwo" },
      { Name: "DB_PASSWORD", Type: "SecureString", Value: SECRETS[0]?.value },
      { name: "REGION", value: "regionmarkerthree" },
    ];
    for (const k of DEPTHS) {
      const out = redactString(nest(JSON.stringify(list), k));
      for (const kept of ["hostmarkerone", "portmarkertwo", "regionmarkerthree"]) expect(out, `${kept} at depth ${k}`).toContain(kept);
      expect(out, `depth ${k}`).not.toContain(SECRETS[0]?.markers[0]);
    }
  });
});

describe("class 1: the output keeps the keys and only the value is replaced (exact output at depth 0..8)", () => {
  const CASES: Array<[string, unknown, unknown]> = [
    ["name, value", { name: "DB_PASSWORD", value: "Hs7Zq9ExactXy" }, { name: "DB_PASSWORD", value: REDACTED }],
    ["value first", { value: "Hs7Zq9ExactXy", name: "DB_PASSWORD" }, { value: REDACTED, name: "DB_PASSWORD" }],
    ["intervening key", { Name: "DB_PASSWORD", Type: "SecureString", Value: "Hs7Zq9ExactXy" }, { Name: "DB_PASSWORD", Type: "SecureString", Value: REDACTED }],
    ["two names for one value", { name: "DB_PASSWORD", key: "token", value: "Hs7Zq9ExactXy" }, { name: "DB_PASSWORD", key: "token", value: REDACTED }],
    ["one name before and one after the value", { name: "DB_PASSWORD", value: "Hs7Zq9ExactXy", key: "token" }, { name: "DB_PASSWORD", value: REDACTED, key: "token" }],
    ["list", ["run", "--token", "Hs7Zq9ExactXy", "--verbose"], ["run", "--token", REDACTED, "--verbose"]],
    ["tuple", [["password", "Hs7Zq9ExactXy"]], [["password", REDACTED]]],
    ["pair among plain siblings", [{ name: "HOST", value: "h" }, { name: "DB_PASSWORD", value: "Hs7Zq9ExactXy" }, { name: "PORT", value: "p" }], [{ name: "HOST", value: "h" }, { name: "DB_PASSWORD", value: REDACTED }, { name: "PORT", value: "p" }]],
  ];
  for (const [name, doc, expected] of CASES) {
    it(name, () => {
      for (const k of DEPTHS) {
        expect(redactString(nest(JSON.stringify(doc), k)), `depth ${k}`).toBe(nest(JSON.stringify(expected), k));
      }
    });
  }
});

describe("class 1: the same pairs written with single quotes (a Python repr), at depth 0..8", () => {
  const SINGLE: Array<[string, (s: string) => string]> = [
    ["name, value", (s) => `{'name': 'DB_PASSWORD', 'value': '${s}'}`],
    ["value before name", (s) => `{'value': '${s}', 'name': 'DB_PASSWORD'}`],
    ["intervening key", (s) => `{'Name': 'DB_PASSWORD', 'Type': 'SecureString', 'Value': '${s}'}`],
    ["cookie pair", (s) => `{'name': 'session', 'value': '${s}'}`],
    ["tuple list", (s) => `[['password', '${s}']]`],
    ["argv list", (s) => `['run', '--token', '${s}', '--verbose']`],
  ];
  for (const [name, make] of SINGLE) {
    it(name, () => {
      const failures: string[] = [];
      for (const secret of SECRETS.filter((x) => x.plain)) {
        for (const k of DEPTHS) {
          const out = redactString(nest(make(secret.value), k));
          if (leaked(out, secret.markers).length > 0) failures.push(`depth ${k}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe("class 1: documented limits of the pair reader", () => {
  const S = "Hs7Zq9LimitPairXy";
  it("pairs written as YAML or TOML lines (a name line, then a value line) are not read as pairs", () => {
    expect(redactString(`env:\n  - name: DB_PASSWORD\n    value: ${S}\n`)).toContain(S);
    expect(redactString(`[[env]]\nname = "DB_PASSWORD"\nvalue = "${S}"\n`)).toContain(S);
  });

  it("a credential KEY in those syntaxes is still read, so the same secret under its own key is hidden", () => {
    expect(redactString(`env:\n  DB_PASSWORD: ${S}\n`)).not.toContain(S);
    expect(redactString(`DB_PASSWORD = "${S}"\n`)).not.toContain(S);
  });

  it("an object boundary between the name and the value keeps a neighbour's value out of reach", () => {
    const out = redactString(`[{"name":"DB_PASSWORD","note":"a}b"},{"value":"neighbourmarker","name":"HOST"}]`);
    expect(out).toContain("neighbourmarker");
  });
});

/** The value wrapped k levels deep in objects and arrays (alternating). */
function wrap(doc: unknown, k: number): unknown {
  let out = doc;
  for (let i = 0; i < k; i += 1) out = i % 2 === 0 ? { level: out } : [out];
  return out;
}

describe("class 1: pairs in every order and shape, as objects at depth 0..8", () => {
  for (const shape of PAIR_SHAPES) {
    it(`${shape.name}`, () => {
      const failures: string[] = [];
      for (const secret of SECRETS) {
        for (const k of DEPTHS) {
          const out = JSON.stringify(redactValue(wrap(shape.doc(secret.value), k)));
          const found = leaked(out, secret.markers);
          if (found.length > 0) failures.push(`${secret.label} at depth ${k}: ${found.join(",")}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("keeps the non-credential siblings of a pair list (precision) at object level", () => {
    const list = [
      { name: "HOST", value: "hostmarkerone" },
      { value: "secretvaluemarker", name: "DB_PASSWORD" },
      { name: "PORT", value: "portmarkertwo" },
      ["host", "localhost"],
      ["--verbose", "verbosemarker"],
    ];
    for (const k of DEPTHS) {
      const out = JSON.stringify(redactValue(wrap(list, k)));
      for (const kept of ["hostmarkerone", "portmarkertwo", "verbosemarker", "localhost"]) expect(out, `${kept} at depth ${k}`).toContain(kept);
      expect(out).not.toContain("secretvaluemarker");
    }
  });

  it("a pair is redacted as an object whether or not its text is redacted first, and twice is once", () => {
    for (const shape of PAIR_SHAPES) {
      const once = redactValue(shape.doc("Hs7Zq9PairXy"));
      expect(JSON.stringify(redactValue(once)), shape.name).toBe(JSON.stringify(once));
    }
  });
});

/* ------------------------------------------------------------------------------------------------ 2  YAML */

const YAML_TEMPLATES: Array<{ name: string; make: (s: string) => string }> = [
  { name: "value on the next line", make: (s) => `db:\n  password:\n    ${s}\nnext: line` },
  { name: "list dash on the next line", make: (s) => `db:\n  password:\n    - ${s}\nnext: line` },
  { name: "list dash, two items", make: (s) => `db:\n  secrets:\n    - ${s}\n    - ${s}\nnext: line` },
  { name: "list item that holds a credential key", make: (s) => `env:\n  - password:\n      ${s}\n  - other: fine` },
  { name: "dash at the same indent as the key", make: (s) => `password:\n- ${s}\nnext: line` },
  { name: "inline flow list", make: (s) => `password: [${s}, ${s}]\nnext: line` },
  { name: "nested flow lists", make: (s) => `password: [[${s}], [${s}, ${s}]]\nnext: line` },
  { name: "flow list with a bracket inside a quoted item", make: (s) => `password: ["x]y", "${s}"]\nnext: line` },
  { name: "flow list with a bracket inside a single-quoted item", make: (s) => `password: ['x]y', '${s}']\nnext: line` },
  { name: "value after a comment-free blank indent", make: (s) => `api_key:\n      ${s}\n` },
];

describe("class 2: YAML next-line values and list items at depth 0..8 (text inside JSON strings)", () => {
  for (const template of YAML_TEMPLATES) {
    it(template.name, () => {
      const failures: string[] = [];
      for (const secret of SECRETS.filter((x) => x.plain)) {
        for (const k of DEPTHS) {
          const out = redactString(nest(template.make(secret.value), k));
          const found = leaked(out, secret.markers);
          if (found.length > 0) failures.push(`depth ${k}: ${found.join(",")}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("keeps the keys that follow (precision) at depth 0; inside a JSON string the escaped line break is part of the word, and more is hidden", () => {
    const out = redactString(`password:\n  - Hs7Zq9YamlXy\nkeepmarker: yes\n`);
    expect(out).toBe(`password:\n  - ${REDACTED}\nkeepmarker: yes\n`);
    for (const k of DEPTHS) {
      expect(redactString(nest(`password:\n  - Hs7Zq9YamlXy\nkeepmarker: yes\n`, k)), `depth ${k}`).not.toContain("Hs7Zq9YamlXy");
    }
  });

  it("a JSON list of secrets under a credential key, as text at every depth", () => {
    for (const secret of SECRETS) {
      const text = JSON.stringify({ password: [secret.value, secret.value + "b"], keep: "keepmarker" });
      for (const k of DEPTHS) {
        const out = redactString(nest(text, k));
        expect(leaked(out, secret.markers), `${secret.label} at depth ${k}`).toEqual([]);
        expect(out).toContain("keepmarker");
      }
    }
  });
});

/* ------------------------------------------------------------------------------------------------ 3  percent */

const PERCENT_TEMPLATES: Array<{ name: string; make: (s: string) => string }> = [
  { name: "password%3D", make: (s) => `password%3D${s}` },
  { name: "lowercase hex", make: (s) => `password%3d${s}` },
  { name: "after an encoded ampersand", make: (s) => `a%3D1%26password%3D${s}%26b%3D2` },
  { name: "colon and space", make: (s) => `password%3A%20${s}` },
  { name: "colon without space", make: (s) => `token%3A${s}` },
  { name: "Authorization header", make: (s) => `Authorization%3A%20Bearer%20${s}` },
  { name: "x-api-key header", make: (s) => `x-api-key%3A${s}` },
  { name: "URL userinfo, fully encoded", make: (s) => `https%3A%2F%2Fadmin%3A${s}%40db.example.invalid%2Fpath` },
  { name: "URL userinfo, encoded separators only", make: (s) => `https://admin%3A${s}%40db.example.invalid/path` },
  { name: "encoded quotes", make: (s) => `%22password%22%3A%22${s}%22` },
  { name: "encoded JSON object", make: (s) => `%7B%22token%22%3A%22${s}%22%2C%22keep%22%3A1%7D` },
  { name: "inside a query string", make: (s) => `https://example.invalid/cb?state=1&client_secret%3D${s}&x=2` },
  { name: "double-encoded (%253D)", make: (s) => `password%253D${s}` },
  { name: "triple-encoded (%25253D)", make: (s) => `password%25253D${s}` },
];

describe("class 3: percent-encoded separators at layers 0..4", () => {
  for (const template of PERCENT_TEMPLATES) {
    it(template.name, () => {
      const failures: string[] = [];
      for (const secret of SECRETS.filter((x) => x.plain)) {
        for (const k of [0, 1, 2, 3, 4]) {
          const out = redactString(nest(JSON.stringify({ cmd: template.make(secret.value) }), k));
          const found = leaked(out, secret.markers);
          if (found.length > 0) failures.push(`layer ${k}: ${found.join(",")}`);
        }
        const bare = redactString(template.make(secret.value));
        if (leaked(bare, secret.markers).length > 0) failures.push("bare text");
      }
      expect(failures).toEqual([]);
    });
  }

  it("text that names no credential is returned as written (no decoding of ordinary percent escapes)", () => {
    for (const text of ["https://example.invalid/a%20b/c%3Fd", "name%3Dvalue&x%3D1", "100%25 sure", "%3A%3A%3A", "q=a%26b%3Dc"]) {
      expect(redactString(text)).toBe(text);
    }
  });

  it("an encoded credential is redacted once, and twice is once", () => {
    for (const template of PERCENT_TEMPLATES) {
      const out = redactString(template.make("Hs7Zq9PctXy"));
      expect(redactString(out), template.name).toBe(out);
    }
  });

  it("the artifact scan finds a credential behind percent-encoded separators, and only there", () => {
    for (const template of PERCENT_TEMPLATES.slice(0, 13)) {
      expect(findCredentialPatterns(template.make("Hs7Zq9ScanXy")).length, template.name).toBeGreaterThan(0);
    }
    expect(findCredentialPatterns("https://example.invalid/a%20b/c%3Fd?name%3Dvalue")).toEqual([]);
  });

  it("an artifact with a percent-encoded credential is flagged as a buffer, and random bytes stuffed with encoded separators are not", () => {
    expect(scanBufferForCredentials(Buffer.from(`log line\n${PERCENT_TEMPLATES[0]?.make("Hs7Zq9BufXy")}\nend\n`)).length).toBeGreaterThan(0);
    for (let i = 0; i < 20; i += 1) {
      const noise = randomBytes(64 * 1024);
      const stuffed = Buffer.concat([noise, Buffer.from("%3D%26%20%3A%22%40%2F".repeat(200)), randomBytes(64 * 1024)]);
      expect(scanBufferForCredentials(stuffed), `buffer ${i}`).toEqual([]);
    }
    expect(scanBufferForCredentials(Buffer.from("GET /a%20b?x%3D1%26y%3D2 HTTP/1.1\nHost: localhost\n"))).toEqual([]);
  });

  it("limit: an escape nested more than three times is not decoded (documented)", () => {
    const secret = "Hs7Zq9LimitXy";
    expect(redactString(`password%2525253D${secret}`)).toContain(secret);
  });
});

/* ------------------------------------------------------------------------------------------------ 4  keys */

const CREDENTIAL_KEYS = [
  "PGPASSWORD", "dbpass", "userpass", "adminpwd", "DB_PASS", "smtp_pass", "passcode", "signingkey", "encryption_key",
  "master_key", "ssh_key", "secretkey", "cookies", "database_url", "DATABASE_URL", "redis_url", "REDIS_URL", "webhook_url",
  "stripeKey", "stripe_key", "STRIPE_KEY", "slack_webhook", "SLACK_WEBHOOK", "Auth", "auth", "mongodb_uri", "connection_url",
  "DatabaseUrl", "sendgridKey", "githubKey", "openai_key", "webhookUrl", "sentry_dsn", "jdbc_url", "celery_broker_url",
];

describe("class 4: the whole key is tested for credential words", () => {
  it.each(CREDENTIAL_KEYS)("%s is a credential key", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it("their values are hidden as objects at depth 0..8", () => {
    for (const key of CREDENTIAL_KEYS) {
      for (const k of DEPTHS) {
        expect(JSON.stringify(redactValue(wrap({ [key]: "Hs7Zq9KeyValXy", keep: "keepmarker" }, k))), `${key} at ${k}`).not.toContain("Hs7Zq9KeyValXy");
      }
    }
  });

  it("their values are hidden as text (JSON, assignment, colon) at depth 0..8", () => {
    const failures: string[] = [];
    for (const key of CREDENTIAL_KEYS) {
      const templates = [JSON.stringify({ [key]: "Hs7Zq9KeyValXy", keep: "keepmarker" }), `${key}=Hs7Zq9KeyValXy`, `${key}: Hs7Zq9KeyValXy`];
      for (const text of templates) {
        for (const k of DEPTHS) {
          const out = redactString(nest(text, k));
          if (out.includes("Hs7Zq9KeyValXy")) failures.push(`${key} ${k} ${text.slice(0, 30)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(["primary_key", "sort_key", "partition_key", "keyboard", "monkey", "turkey", "hockey", "author", "authority", "host", "port", "database", "database_name", "redis_host", "redis_port", "url", "callback_url", "homepage_url", "compass", "bypass", "passed", "status"])(
    "%s stays an ordinary key",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

/* ------------------------------------------------------------------------------------------------ 5  idempotence */

const AK = "AKIA" + "IOSFODNN7EXAMPLE";
const PIECES = [
  AK,
  "sk-" + "abcdefghijklmnopqrstuvwx",
  "hf_" + "abcdefghijklmnopqrstuvwxyz0123456789",
  "ABCDEF",
  "ghp_" + "0123456789abcdefghijklmnopqrstuvwxyzAB",
  "xox" + "b-123456789012-abcdefghijklmnop",
  "Bearer abcdefghijklmnopqr",
  "password=bearer",
  "abcdefghijk=>",
  "token: ",
  "Bearer ",
  "AKIA",
  "sk-",
  "hf_",
  "=",
  "password",
];
const JOINS = ["", " ", "\n", "\\n", "=", "=>", ":", "\\\\n"];

describe("class 5: idempotence on short mixed shapes", () => {
  it("the reviewers' three shapes", () => {
    for (const text of [AK + "sk-" + "abcdefghijklmnopqrstuvwx","ABCDEF" + "hf_" + "abcdefghijklmnopqrstuvwxyz0123456789", "password=bearer\\nabcdefghijk=>", "password=bearer\nabcdefghijk=>"]) {
      const once = redactString(text);
      expect(redactString(once), text).toBe(once);
    }
  });

  it("every ordered pair of pieces with every join", () => {
    const bad: string[] = [];
    for (const a of PIECES) {
      for (const b of PIECES) {
        for (const join of JOINS) {
          const text = `${a}${join}${b}`;
          const once = redactString(text);
          if (redactString(once) !== once) bad.push(JSON.stringify(text));
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("3000 seeded random triples and quadruples", () => {
    let seed = 0x1a2b3c4d;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const bad: string[] = [];
    for (let i = 0; i < 3000; i += 1) {
      let text = PIECES[next(PIECES.length)] as string;
      for (let j = 0, parts = 2 + next(3); j < parts; j += 1) text += (JOINS[next(JOINS.length)] as string) + (PIECES[next(PIECES.length)] as string);
      const once = redactString(text);
      if (redactString(once) !== once) bad.push(JSON.stringify(text));
    }
    expect(bad).toEqual([]);
  });

  it("the artifact scan and redactString agree on the shapes (a text that redacts changes, a settled text does not)", () => {
    for (const a of PIECES.slice(0, 8)) {
      const settled = redactString(`${a} ${AK}`);
      expect(findCredentialPatterns(settled).length, JSON.stringify(settled)).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------------------------------------ 6  code points */

describe("class 6: invisible code points of the newest blocks split no token", () => {
  const ranges: Array<[number, number]> = [[0x13430, 0x1343f], [0xfff9, 0xfffb], [0xe0001, 0xe007f], [0x1bca0, 0x1bca3], [0x110bd, 0x110bd], [0x110cd, 0x110cd]];
  const token = ["ghp", "_", "0123456789abcdefghijklmnopqrstuvwxyzAB"].join("");
  it("each is folded away in the middle of a token, at every position of the prefix", () => {
    for (const [from, to] of ranges) {
      for (let cp = from; cp <= to; cp += 1) {
        const ch = String.fromCodePoint(cp);
        for (const at of [1, 3, 4, 10, 30]) {
          const text = `log ${token.slice(0, at)}${ch}${token.slice(at)} end`;
          expect(redactString(text), `U+${cp.toString(16)} at ${at}`).not.toContain("0123456789abcdefghij");
        }
      }
    }
  });

  it("each is folded away inside a credential key and inside an assignment", () => {
    for (const [from, to] of ranges) {
      for (let cp = from; cp <= to; cp += 1) {
        const ch = String.fromCodePoint(cp);
        expect(isSensitiveKey(`pass${ch}word`), `key U+${cp.toString(16)}`).toBe(true);
        expect(redactString(`pass${ch}word=Hs7Zq9CpXy`), `assignment U+${cp.toString(16)}`).not.toContain("Hs7Zq9CpXy");
      }
    }
  });

  it("every code point with the Cf property does the same (whatever the Unicode version of the runtime)", () => {
    const failures: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if (!/\p{Cf}/u.test(ch)) continue;
      if (redactString(`log ghp_${ch}0123456789abcdefghijklmnopqrstuvwxyzAB`).includes("0123456789abcdefghij")) failures.push(cp.toString(16));
    }
    expect(failures).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------ 7  __proto__ */

describe("class 7: an own __proto__ key is data", () => {
  it("is kept, redacted by its content, and pollutes no prototype", () => {
    const doc = JSON.parse('{"__proto__":{"password":"Hs7Zq9ProtoXy","polluted":true},"note":"kept"}') as Record<string, unknown>;
    const out = redactValue(doc) as Record<string, unknown>;
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out.note).toBe("kept");
    const inner = Object.getOwnPropertyDescriptor(out, "__proto__")?.value as Record<string, unknown>;
    expect(inner.password).toBe(REDACTED);
    expect(inner.polluted).toBe(true);
    expect(JSON.stringify(out)).not.toContain("Hs7Zq9ProtoXy");
  });

  it("is kept at every depth, in arrays, and as a scalar", () => {
    for (const k of DEPTHS) {
      const doc = wrap(JSON.parse('{"__proto__":"scalarmarker","password":"Hs7Zq9ProtoXy"}'), k);
      const out = JSON.stringify(redactValue(doc));
      expect(out, `depth ${k}`).toContain('"__proto__":"scalarmarker"');
      expect(out).not.toContain("Hs7Zq9ProtoXy");
    }
  });

  it("a credential-named __proto__ hides its value, and twice is once", () => {
    const doc = JSON.parse('{"__proto__":"x","token":"Hs7Zq9ProtoXy"}');
    const first = redactValue(doc);
    expect(JSON.stringify(redactValue(first))).toBe(JSON.stringify(first));
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
  });
});
