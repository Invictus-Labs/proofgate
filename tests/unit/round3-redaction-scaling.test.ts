/**
 * Review round 2 (security and performance re-review): the JWT pattern was quadratic ('eyJ_'.repeat(n): 256 KB took 19.6 s),
 * so "cost is bounded" was a claim the tests did not check. This is the hostile-input matrix: every pattern shape at 1, 2
 * and 3.5 MiB (see the constants below). It checks SCALING (time at 3.5x the size against time at 1x, which a linear pass keeps
 * near 3.5 and a quadratic one pushes to 12) plus a generous absolute ceiling, and never a tight wall-clock bound, so a slow or busy host does not
 * make it flaky. A randomized property test then plants secrets in random text and requires that none survives.
 * Planted values are assembled from fragments.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue, scanBufferForCredentials } from "../../src/redact.js";

const j = (...parts: string[]): string => parts.join("");
const ZW = String.fromCharCode(0x200b);
const FDFA = String.fromCharCode(0xfdfa);
const COMBINING = String.fromCharCode(0x0301);
const A = (n: number): string => "a".repeat(n);
/** `unit` repeated until the text is about `n` characters long. */
const rep = (unit: string, n: number): string => unit.repeat(Math.max(1, Math.ceil(n / unit.length)));

/** [shape name, generator for a hostile text of about n characters]. One entry per pattern and per way of failing to match it. */
const SHAPES: Array<[string, (n: number) => string]> = [
  // values that are read as a whole container (options and assignments): long runs of openers, unterminated, repeated
  ["container: an option value of [ repeated, unterminated", (n) => j("run --", "pass", "word=", rep("[", n))],
  ["container: an option value of { repeated, unterminated", (n) => j("run --", "pass", "word=", rep("{", n))],
  ["container: an option value of ( repeated, unterminated", (n) => j("run --", "pass", "word=", rep("(", n))],
  ["container: an assignment value of [{( repeated, unterminated", (n) => j("pass", "word=", rep("[{(", n))],
  ["container: many options each with an unterminated bracket", (n) => rep(j("--", "pass", "word=[ x\n"), n)],
  ["container: many assignments each with an unterminated brace", (n) => rep(j("pass", "word={ x\n"), n)],
  ["container: an Authorization option repeated", (n) => rep("--Authorization=[a b\n", n)],
  ["container: nested balanced brackets under an option", (n) => j("--", "pass", "word=", "[".repeat(Math.floor(n / 2)), "]".repeat(Math.floor(n / 2)))],
  ["container: anchors and tags repeated after a credential key", (n) => rep(j("pass", "word: !!x &a !!y &b\n"), n)],
  // JWT (was quadratic)
  ["jwt: eyJ_ repeated", (n) => rep("eyJ_", n)],
  ["jwt: eyJ- repeated", (n) => rep("eyJ-", n)],
  ["jwt: eyJ then a long run, no dot", (n) => j("eyJ", A(n))],
  ["jwt: header dot repeated", (n) => rep(j("eyJ", A(10), "."), n)],
  ["jwt: two segments repeated", (n) => rep(j("eyJ", A(10), ".", "eyJ", A(10), "."), n)],
  ["jwt: almost a token repeated", (n) => rep(j("eyJ", A(10), ".", A(10), ".", A(3), " "), n)],
  // token prefixes
  ["github: ghp_ repeated", (n) => rep("ghp_", n)],
  ["github: ghp_ and 29 characters repeated", (n) => rep(j("ghp_", A(29), " "), n)],
  ["github pat: github_pat_ repeated", (n) => rep("github_pat_", n)],
  ["gitlab: glpat- repeated", (n) => rep("glpat-", n)],
  ["npm: npm_ repeated", (n) => rep("npm_", n)],
  ["slack: xoxb- repeated", (n) => rep("xoxb-", n)],
  ["sk: sk- repeated", (n) => rep("sk-", n)],
  ["sk: sk-ant- repeated", (n) => rep("sk-ant-", n)],
  ["sendgrid: SG. repeated", (n) => rep("SG.", n)],
  ["sendgrid: SG.<16>. repeated", (n) => rep(j("SG.", A(16), "."), n)],
  ["huggingface: hf_ repeated", (n) => rep("hf_", n)],
  ["google: AIza repeated", (n) => rep("AIza", n)],
  ["google oauth: ya29. repeated", (n) => rep("ya29.", n)],
  ["stripe: sk_live_ repeated", (n) => rep("sk_live_", n)],
  ["aws: AKIA repeated", (n) => rep("AKIA", n)],
  ["aws: AKIA and 15 characters repeated", (n) => rep(j("AKIA", "A".repeat(15), " "), n)],
  ["twilio: SK repeated", (n) => rep("SK", n)],
  ["twilio account: AC repeated", (n) => rep("AC", n)],
  ["twilio: SK and 31 hex characters repeated", (n) => rep(j("SK", "0".repeat(31), " "), n)],
  ["digitalocean: dop_v1_ repeated", (n) => rep("dop_v1_", n)],
  ["shopify: shpat_ repeated", (n) => rep("shpat_", n)],
  ["mailgun: key- repeated", (n) => rep("key-", n)],
  ["bearer: Bearer repeated", (n) => rep("Bearer ", n)],
  ["bearer: Bearer and a token repeated", (n) => rep("Bearer abc123 ", n)],
  ["bearer: bearer and 15 characters repeated", (n) => rep(j("bearer ", A(15), " "), n)],
  // URLs, headers, flags
  ["url: scheme separator repeated", (n) => rep("a://", n)],
  ["url: user and colon, no @", (n) => rep("x://u:", n)],
  ["url: https user colon long, no @", (n) => j("https://user:", A(n))],
  ["url: one long user", (n) => j("https://", A(n), ":")],
  ["webhook: hooks.slack.com repeated", (n) => rep("https://hooks.slack.com/services/", n)],
  ["webhook: office prefix repeated", (n) => rep("https://a.b.webhook.office.com/webhookb2/", n)],
  ["webhook: discord repeated", (n) => rep("https://discord.com/api/webhooks/12345/", n)],
  ["webhook: office label run", (n) => j("https://", rep("a.", n))],
  ["cookie: Cookie: repeated on one line", (n) => rep("Cookie: ", n)],
  ["cookie: Set-Cookie repeated", (n) => rep("Set-Cookie:a", n)],
  ["cookie: one long value", (n) => j("Cookie: ", A(n))],
  ["signature: sig= repeated", (n) => rep("sig=abcdef", n)],
  ["signature: signature= repeated", (n) => rep("signature=", n)],
  ["signature: one long value", (n) => j("sig=", A(n))],
  ["flag: --password repeated", (n) => rep("--password ", n)],
  ["flag: --password and an opening double quote repeated", (n) => rep('--password "', n)],
  ["flag: --password and an opening single quote repeated", (n) => rep("--password '", n)],
  ["flag: --token=a repeated", (n) => rep("--token=a ", n)],
  ["flag: dashes repeated", (n) => rep("--", n)],
  ["flag: -p repeated", (n) => rep("-pA1234", n)],
  ["flag: one long unquoted value", (n) => j("--password ", A(n))],
  ["flag: one long quoted value, never closed", (n) => j('--password "', A(n))],
  ["email: a@ repeated", (n) => rep("a@", n)],
  ["email: a@b. repeated", (n) => rep("a@b.", n)],
  ["email: 70-character local part", (n) => rep(j(A(70), "@"), n)],
  ["email: label run", (n) => j("a@", rep("b.", n))],
  // assignments
  ["assignment: password= repeated", (n) => rep("password=", n)],
  ["assignment: password=a repeated", (n) => rep("password=a", n)],
  ["assignment: password (no separator) repeated", (n) => rep("password ", n)],
  ["assignment: passed= repeated (not a credential name)", (n) => rep("passed=", n)],
  ["assignment: pass=x repeated", (n) => rep("pass=x ", n)],
  ["assignment: author=x repeated", (n) => rep("author=x ", n)],
  ["assignment: auth: repeated", (n) => rep("auth:", n)],
  ["assignment: token: repeated", (n) => rep("token:", n)],
  ["assignment: authorization: repeated", (n) => rep("authorization:", n)],
  ["assignment: quoted key and opening quote repeated", (n) => rep('"password": "', n)],
  ["assignment: one long quoted value, never closed", (n) => j('"password": "', A(n))],
  ["assignment: one long unquoted value", (n) => j("password=", A(n))],
  ["assignment: semicolons and commas in a value", (n) => j("pass", "word=", rep("a;b,c", n))],
  ["assignment: value with many name= pairs", (n) => j("password=x", rep(";Aa=b", n))],
  ["assignment: name characters before the keyword", (n) => rep(j(A(45), "password"), n)],
  ["assignment: keyword repeated with no gap", (n) => rep("secret", n)],
  ["assignment: escaped quotes in a value", (n) => j('password="', rep('a\\"', n))],
  // private keys
  ["pem: header repeated", (n) => rep(j("-----BEGIN ", "PRIVATE KEY-----"), n)],
  ["pem: header and footer repeated", (n) => rep(j("-----BEGIN ", "RSA PRIVATE KEY-----\n-----END ", "RSA PRIVATE KEY-----\n"), n)],
  ["pem: END markers repeated", (n) => rep("-----END ", n)],
  ["pem: one long body", (n) => j("-----BEGIN ", "PRIVATE KEY-----\n", A(n))],
  // no shape at all
  ["plain text", (n) => rep("the quick brown fox ", n)],
  ["newlines", (n) => rep("\n", n)],
  ["dashes and underscores", (n) => rep("-_", n)],
  // non-ASCII (folded view)
  ["non-ASCII: U+FDFA (folds to 18 characters each)", (n) => rep(FDFA, n)],
  ["non-ASCII: accented letters", (n) => rep("\u00e9", n)],
  ["non-ASCII: zero-width characters", (n) => rep(ZW, n)],
  ["non-ASCII: zero-width characters splitting a prefix", (n) => rep(j("gh", ZW, "p_"), n)],
  ["non-ASCII: a run of combining marks", (n) => j("a", rep(COMBINING, n))],
  ["non-ASCII: jwt with zero-width", (n) => rep(j("eyJ", ZW, "_"), n)],
  // round 4 (pairs, lists, percent-encoded separators): runs of the characters the new scanners key on
  ["pairs: open braces", (n) => rep("{", n)],
  ["pairs: name keys repeated", (n) => rep('"name":"password",', n)],
  ["pairs: name key and an open brace repeated", (n) => rep('{"name":"password"', n)],
  ["pairs: value keys repeated", (n) => rep('"value":"x",', n)],
  ["pairs: value 1,500 characters after the name, repeated", (n) => rep(j('"name":"password","', A(1500), '":1,"value":"v",'), n)],
  ["pairs: value before the name, repeated", (n) => rep('{"value":"v","name":"password"},', n)],
  ["pairs: escaped name and value keys, repeated", (n) => rep('\\"name\\":\\"password\\",\\"value\\":\\"v\\",', n)],
  ["pairs: 255 backslashes in front of every quote", (n) => rep(j("\\".repeat(255), '"name', "\\".repeat(255), '"'), n)],
  ["pairs: single quotes, repeated", (n) => rep("{'name': 'password', 'value': 'v'},", n)],
  ["lists: open brackets and a credential name, repeated", (n) => rep('["password",', n)],
  ["lists: credential names in a row", (n) => rep('"--password","--token",', n)],
  ["lists: an open bracket after a key, never closed", (n) => rep("password=[", n)],
  ["lists: a block list under a key", (n) => rep("password:\n  - a\n", n)],
  ["percent: encoded separators, no credential", (n) => rep("a%3Db%26c%3Dd%20", n)],
  ["percent: encoded equals only", (n) => rep("%3D", n)],
  ["percent: a credential name and an encoded equals, repeated", (n) => rep("password%3D", n)],
  ["percent: double- and triple-encoded, repeated", (n) => rep("%253D%25253D", n)],
  ["percent: encoded separators then a credential at the end", (n) => j(rep("a%3Db%26c%3Dd%20", n), "password%3Dx")],
  ["keys: database_url assignments, repeated", (n) => rep("database_url=x ", n)],
  ["keys: the word key, repeated", (n) => rep("key ", n)],
  // round 5 (block scalars, properties, operators, prefixed options)
  ["blocks: a header and two indented lines, repeated", (n) => rep("password: |\n  a\n  b\n", n)],
  ["blocks: headers with no content, repeated", (n) => rep("password: |\n", n)],
  ["blocks: blank lines after one header", (n) => j("password: |\n", rep("\n", n))],
  ["blocks: one header and one very long indented block", (n) => j("password: |\n  ", A(n))],
  ["blocks: header and lines written as escaped line breaks, repeated", (n) => rep("password: |\\n  a\\n", n)],
  ["blocks: 255 backslashes before every line break", (n) => rep(j("password: |", "\\".repeat(255), "n  a", "\\".repeat(255), "n"), n)],
  ["properties: anchors, repeated", (n) => rep("password: &a ", n)],
  ["properties: a tag and a line break, repeated", (n) => rep("password: !!str\n  ", n)],
  ["operators: ?= and += repeated", (n) => rep("password ?= password += ", n)],
  ["options: many name prefixes, repeated", (n) => rep("--a-b-c-d-e-f-g-h-i ", n)],
  ["options: a prefixed name and a value, repeated", (n) => rep("--a-b-password x ", n)],
  // round 5 (shared reader for options and user information, wider pairs): the shapes that hung or slowed the first version
  ["userinfo: //u:a/ repeated, one @ at the end", (n) => j(rep("//u:a/", n), "@")],
  ["userinfo: //u:a/@ repeated", (n) => rep("//u:a/@", n)],
  ["userinfo: //u: repeated with a late @", (n) => j(rep("//u:", n), "@")],
  ["userinfo: scheme separators, colon and @", (n) => rep("a://u:p@", n)],
  ["userinfo: one very long password", (n) => j("//u:", A(n), "@h")],
  ["userinfo: slash passwords inside one token", (n) => j(rep("//u:ab/cd", n), " @x")],
  ["options: quoted values repeated", (n) => rep('--password "x" ', n)],
  ["options: escaped quotes repeated", (n) => rep('--password \\"x\\" ', n)],
  ["options: -u with a colon value, repeated", (n) => rep("-u a:b ", n)],
  ["options: an unterminated quote", (n) => j('--password "', A(n))],
  ["pairs: {\"key\":\"value\"} repeated (the shape that hung)", (n) => rep('{"key":"value"}', n)],
  ["pairs: object values, repeated", (n) => rep('{"name":"password","value":{"a":[1,2,{"b":3}]}},', n)],
  ["pairs: numeric values, repeated", (n) => rep('{"name":"password","value":12345},', n)],
  ["pairs: 1,000-character labels, repeated", (n) => rep(j('{"name":"', A(1000), '","value":"x"},'), n)],
  ["pairs: an unclosed 1,100-character label, repeated", (n) => rep(j('"name":"', A(1100)), n)],
  ["pairs: a container value that never closes", (n) => j('{"name":"password","value":', "[".repeat(n))],
  ["python: prefixed strings, repeated", (n) => rep("password=b'x' ", n)],
  ["blank lines: a key and a very long run of empty lines", (n) => j("password:\n", "\n".repeat(n))],
  ["blank lines: a key, a comment and an empty line, repeated", (n) => rep("password:\n# c\n\n", n)],
  ["percent: encoded backslashes and underscores, repeated", (n) => rep("password%5F%5C%22%3D ", n)],
  ["usage counters, repeated", (n) => rep("max_tokens=5 total_tokens: 7 ", n)],
];

function bestOf(times: number, fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < times; i += 1) {
    // CPU time of this process, not wall time: a host that runs other work (the round-6 runs had a load average above 290) does not move it
    const before = process.cpuUsage();
    fn();
    const used = process.cpuUsage(before);
    best = Math.min(best, (used.user + used.system) / 1000);
  }
  return best;
}

// Round 3 (tests re-review P2): at 64/128/256 KB the real code takes 2 to 8 ms, so a 150 ms noise floor let a quadratic redactor
// with a small constant through (78 ms at 256 KB, 17 s at 4 MB). The sizes are now 1, 2 and 3.5 MiB (just under the 4 MiB
// MAX_REDACT_STRING, above which a string is replaced whole and there is nothing to measure), the floor is 25 ms, and the
// growth bound is 6 for 3.5x the input: a linear pass gives about 3.5, a quadratic one about 12.
const SIZES = [1024 * 1024, 2 * 1024 * 1024, 3.5 * 1024 * 1024] as const;
const MAX_GROWTH = 7;
/** Below this a measurement is noise and a ratio means nothing (milliseconds). */
const NOISE_FLOOR = 25;
/** Generous: the slowest linear shape here takes a small fraction of this even on a busy host. */
const CEILING = 20000;
/** Each size is measured this many times and the fastest run counts, so a garbage-collection pause or a busy host does not decide. */
const RUNS = 4;

describe("hostile-input matrix: every pattern shape at 1, 2 and 3.5 MiB (linear scaling, generous ceiling)", () => {
  it.each(SHAPES)("%s", (_name, generate) => {
    const [small, middle, large] = SIZES.map((n) => generate(n)) as [string, string, string];
    const t1 = bestOf(RUNS, () => redactString(small));
    const t2 = bestOf(RUNS, () => redactString(middle));
    const t4 = bestOf(RUNS, () => redactString(large));
    const label = `${_name}: ${Math.round(t1)} ms at 1 MiB, ${Math.round(t2)} ms at 2 MiB, ${Math.round(t4)} ms at 3.5 MiB`;
    expect(t4, label).toBeLessThan(CEILING);
    expect(t2, label).toBeLessThan(CEILING);
    expect(t4, label).toBeLessThanOrEqual(Math.max(MAX_GROWTH * t1, NOISE_FLOOR));
    // The output is bounded by a constant factor of the input (a match becomes a fixed marker); folding may grow non-ASCII text.
    const out = redactString(large);
    expect(out.length, label).toBeLessThanOrEqual(large.length * 4 + 64);
  });

  it("the artifact scanner and object-key redaction scale the same way on the same shapes", () => {
    for (const [name, generate] of SHAPES.filter((s) => /jwt|assignment: one long|pem: header repeated|non-ASCII: U\+FDFA/.test(s[0]))) {
      const small = Buffer.from(generate(SIZES[0]));
      const large = Buffer.from(generate(SIZES[2]));
      const t1 = bestOf(RUNS, () => scanBufferForCredentials(small));
      const t4 = bestOf(RUNS, () => scanBufferForCredentials(large));
      expect(t4, `${name}: ${Math.round(t1)} ms -> ${Math.round(t4)} ms`).toBeLessThanOrEqual(Math.max(MAX_GROWTH * t1, NOISE_FLOOR * 2));
      expect(t4).toBeLessThan(CEILING);
    }
    const t1 = bestOf(RUNS, () => redactValue({ [rep("eyJ_", SIZES[0])]: 1, note: rep("eyJ_", SIZES[0]) }));
    const t4 = bestOf(RUNS, () => redactValue({ [rep("eyJ_", SIZES[2])]: 1, note: rep("eyJ_", SIZES[2]) }));
    expect(t4, `${Math.round(t1)} ms -> ${Math.round(t4)} ms`).toBeLessThanOrEqual(Math.max(MAX_GROWTH * t1, NOISE_FLOOR * 2));
  });

  it("many small strings cost the same as one large one", () => {
    const words = rep("password=abc token: def eyJ_ ", 256 * 1024).split(" ");
    const t0 = performance.now();
    for (const word of words) redactString(word);
    expect(performance.now() - t0).toBeLessThan(CEILING);
  });
});

/* ------------------------------------------------------------------------------------------ property test */

/** A small deterministic generator (mulberry32), so a failure can be replayed from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const HEX = "0123456789abcdef";
const VALUE_CHARS = `${ALNUM}_+/-.`;

interface Planted {
  /** The text that goes into the document. */
  text: string;
  /** The secret itself; no window of it may appear in the output. */
  secret: string;
}

function makeGenerators(random: () => number): Array<() => Planted> {
  const pick = (chars: string, n: number): string => Array.from({ length: n }, () => chars[Math.floor(random() * chars.length)]).join("");
  const between = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
  const value = (): string => pick(VALUE_CHARS, between(8, random() < 0.2 ? 900 : 60));
  const token = (prefix: string, chars: string, lo: number, hi: number) => (): Planted => {
    const body = pick(chars, between(lo, hi));
    return { text: j(prefix, body), secret: body };
  };
  const assignment = (name: string, quote: string) => (): Planted => {
    const v = value();
    return { text: j(name, quote === "" ? "=" : ": ", quote, v, quote), secret: v };
  };
  return [
    token(j("ghp", "_"), ALNUM, 30, 60),
    token(j("github", "_pat_"), ALNUM, 40, 90),
    token(j("glpat", "-"), ALNUM, 20, 40),
    token(j("npm", "_"), ALNUM, 36, 60),
    token(j("xox", "b-"), ALNUM, 12, 60),
    token(j("sk", "-"), ALNUM, 20, 80),
    token(j("hf", "_"), ALNUM, 30, 50),
    token(j("AIza"), ALNUM, 35, 35),
    token(j("AKI", "A"), "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 16, 16),
    token(j("SK"), HEX, 32, 32),
    token(j("A", "C"), HEX, 32, 32),
    token(j("dop", "_v1_"), HEX, 64, 64),
    token(j("shp", "at_"), HEX, 32, 32),
    token(j("key", "-"), HEX, 32, 32),
    (): Planted => {
      const parts = [pick(ALNUM, between(8, 40)), pick(ALNUM, between(8, 300)), pick(ALNUM, between(8, 700))];
      return { text: j("eyJ", parts.join(".")), secret: parts[2] as string };
    },
    assignment("password", ""),
    assignment("passwd", ""),
    assignment("pwd", ""),
    assignment("DB_PASS", ""),
    assignment("api_key", ""),
    assignment("client_secret", ""),
    assignment("private_key", ""),
    assignment('"password"', '"'),
    assignment('"auth"', '"'),
    assignment('"token"', '"'),
    assignment("token", ""),
    (): Planted => {
      const v = value();
      return { text: j("--password ", v), secret: v };
    },
    (): Planted => {
      const v = value();
      return { text: j("Authorization: Basic ", v), secret: v };
    },
    (): Planted => {
      const v = value();
      return { text: j('Authorization: Digest username="svc", realm="x", response="', v, '"'), secret: v };
    },
    (): Planted => {
      const v = pick(ALNUM, between(8, 400));
      return { text: j("Cookie: session=", v), secret: v };
    },
    (): Planted => {
      const v = pick(ALNUM, between(8, 300));
      return { text: j("https://user:", v, "@example.invalid/x"), secret: v };
    },
  ];
}

/** Text between planted secrets: ordinary words and separators, some of which look a little like the shapes. */
function noise(random: () => number): string {
  const words = ["build", "passed", "author", "the", "log", "status", "ok", "eyJ", "sk", "key", "-p", "--flag", "=", ":", ";", ",", "AC", "Bearer", "token", "pass", "x", "a@b", "\n", "  ", "\t"];
  return Array.from({ length: Math.floor(random() * 8) }, () => words[Math.floor(random() * words.length)]).join(" ");
}

describe("property: planted secrets never survive, whatever surrounds or hides them", () => {
  const DISGUISES: Array<[string, (s: string, random: () => number) => string]> = [
    ["as written", (s) => s],
    ["zero-width character inserted", (s, random) => {
      const at = Math.floor(random() * s.length);
      return `${s.slice(0, at)}${ZW}${s.slice(at)}`;
    }],
    ["written in fullwidth letters where possible", (s) => [...s].map((ch) => (/[A-Za-z0-9]/.test(ch) ? String.fromCodePoint(ch.codePointAt(0)! + 0xfee0) : ch)).join("")],
  ];

  function survives(output: string, secret: string): string | undefined {
    // A window of 10 characters of the secret is far too much to leak; shorter secrets are checked whole.
    const size = Math.min(10, secret.length);
    for (let i = 0; i + size <= secret.length; i += 1) {
      const window = secret.slice(i, i + size);
      if (output.includes(window)) return window;
    }
    return undefined;
  }

  it("1,500 random documents (seeded), each with one to three planted secrets in three disguises", () => {
    const random = rng(Number(process.env.PG_PROPERTY_SEED ?? 0x5eed));
    const generators = makeGenerators(random);
    for (let round = 0; round < Number(process.env.PG_PROPERTY_ROUNDS ?? 1500); round += 1) {
      const count = 1 + Math.floor(random() * 3);
      const secrets: string[] = [];
      let text = noise(random);
      const [disguiseName, disguise] = DISGUISES[round % DISGUISES.length] as (typeof DISGUISES)[number];
      for (let k = 0; k < count; k += 1) {
        const planted = (generators[Math.floor(random() * generators.length)] as () => Planted)();
        // Fullwidth spelling changes the secret's characters; the secret is then what the folded text shows.
        const shown = disguise(planted.text, random);
        text += `${random() < 0.5 ? " " : "\n"}${shown} ${noise(random)}`;
        secrets.push(planted.secret);
      }
      const out = redactString(text);
      for (const secret of secrets) {
        const leaked = survives(out, secret);
        expect(leaked, `round ${round} (${disguiseName}), leaked "${leaked}" from a planted secret; input: ${text.slice(0, 200)}`).toBeUndefined();
      }
      // Bounded output, and idempotence.
      expect(out.length, `round ${round}`).toBeLessThanOrEqual(text.length * 3 + 200);
      expect(redactString(out), `round ${round} idempotence`).toBe(out);
      expect(out).toContain(REDACTED);
    }
  });

  it("the same documents inside object values, object keys and arrays", () => {
    const random = rng(0xbeef);
    const generators = makeGenerators(random);
    for (let round = 0; round < 200; round += 1) {
      const planted = (generators[Math.floor(random() * generators.length)] as () => Planted)();
      const doc = { note: `x ${planted.text} y`, list: [planted.text, { deep: planted.text }], [planted.text]: 1 };
      const out = JSON.stringify(redactValue(doc));
      expect(survives(out, planted.secret), `round ${round}: ${planted.text.slice(0, 80)}`).toBeUndefined();
    }
  });
});
