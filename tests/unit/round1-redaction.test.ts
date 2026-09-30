/**
 * Review round 1, S3 (P1) and the redaction-shape P2s: object keys, receipt file names and bundle entry paths were not
 * redacted, `\b` boundaries missed tokens preceded by "_" or a word character, and many credential shapes were unknown.
 * Redaction remains best effort (documented). Planted values are assembled from fragments so that no credential-shaped
 * literal exists in this file. Tests that call the CLI or use the new shapes fail on the delivered tree.
 */
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REDACTED, findCredentialPatterns, isSensitiveKey, redactString, redactValue, scanBufferForCredentials } from "../../src/redact.js";
import { errorCode, evalArgs, runCli, runDist } from "../helpers/cli.js";
import { FAKE } from "../helpers/fake-secrets.js";
import { NOW, REPOS, baseManifest, baseRequirement, makeWorkspace, sha256, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const j = (...parts: string[]): string => parts.join("");
const A = (n: number): string => "a".repeat(n);
const NPM = j("npm", "_", A(36));
const GITLAB = j("glpat", "-", A(20));
const SENDGRID = j("SG", ".", A(22), ".", A(43));
const HF = j("hf", "_", A(34));
const OAUTH = j("ya", "29", ".", A(30));
const SLACK_HOOK = j("https://hooks", ".slack.com/services/", "T01234567/B01234567/", A(24));
const DISCORD_HOOK = j("https://discord", ".com/api/webhooks/", "123456789012345678/", A(30));
const TEAMS_HOOK = j("https://contoso", ".webhook.office.com/webhookb2/", A(30), "@", A(8), "/IncomingWebhook/", A(10));

describe("token boundaries: a credential glued to a word or underscore is still a credential", () => {
  it.each([
    ["TOKEN_" + FAKE.githubToken],
    ["unknown_" + FAKE.githubToken],
    ["x-" + FAKE.githubToken],
    ["KEY_" + FAKE.awsKey],
    ["id:" + FAKE.awsKey],
    ["(" + FAKE.skToken + ")"],
    ["value_" + FAKE.slackToken],
    ["_" + FAKE.stripeKey],
  ])("redacts %s", (text) => {
    const out = redactString(text);
    expect(out).toContain(REDACTED);
    for (const secret of [FAKE.githubToken, FAKE.awsKey, FAKE.skToken, FAKE.slackToken, FAKE.stripeKey]) expect(out).not.toContain(secret);
  });

  it("a token longer than any fixed cap is redacted whole, not just its first 255 characters", () => {
    const long = j("gh", "p_", A(600));
    expect(redactString(`t=${long}`)).not.toContain("aaaa");
  });

  it("does not eat letters glued in front of a look-alike (a boundary is required before the prefix)", () => {
    // "AKIA" inside a longer alphanumeric word is not an access key id.
    const glued = ["REALLY", "AKI", "AIOSFODNN7", "EXAMPLE1"].join("");
    expect(redactString(glued)).toBe(glued);
  });
});

describe("credential shapes that were unknown", () => {
  it.each([
    ["npm token", NPM, NPM],
    ["GitLab token", GITLAB, GITLAB],
    ["SendGrid key", SENDGRID, SENDGRID],
    ["Hugging Face token", HF, HF],
    ["Google OAuth token", OAUTH, OAUTH],
    ["Slack webhook", `post to ${SLACK_HOOK} now`, SLACK_HOOK],
    ["Discord webhook", `hook=${DISCORD_HOOK}`, DISCORD_HOOK],
    ["Teams webhook", `${TEAMS_HOOK}`, TEAMS_HOOK],
    ["CLI flag with a value", "deploy --password hunter2hunter2 --region eu", "hunter2hunter2"],
    ["CLI flag with =", "deploy --token=abcd1234efgh --x", "abcd1234efgh"],
    ["CLI flag quoted", `run --secret "two words here" done`, "two words here"],
    ["glued -p password", "mysql -uroot -pSup3rSecret db", "Sup3rSecret"],
    ["Cookie header", "curl -H 'Cookie: session=abc123def456; theme=dark' x", "abc123def456"],
    ["Set-Cookie header", "Set-Cookie: sid=zzz999yyy888; Path=/", "zzz999yyy888"],
    ["signature parameter", "https://store.example.invalid/blob?sv=1&sig=AbCdEf123456%2Bxyz&se=2027", "AbCdEf123456"],
    ["JSON password with a quoted key", '{"password": "hunter2hunter2"}', "hunter2hunter2"],
    ["single-quoted key", "{'client_secret': 'abcdef123456'}", "abcdef123456"],
    ["a short password value", "password=abc", "abc"],
    ["Authorization Basic with a space", "Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA=="],
    ["connection string password", j("postgres://app", ":", "pw12345678", "@", "example.invalid/x"), "pw12345678"],
  ])("redacts a %s", (_name, text, secret) => {
    const out = redactString(text);
    expect(out, text).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("keeps the surrounding text readable (the flag name and the rest of the line survive)", () => {
    expect(redactString("deploy --password hunter2hunter2 --region eu")).toBe(`deploy --password ${REDACTED} --region eu`);
    expect(redactString('{"password": "hunter2hunter2", "user": "ann"}')).toBe(`{"password": "${REDACTED}", "user": "ann"}`);
    expect(redactString("gcc -pipe -O2 main.c")).toBe("gcc -pipe -O2 main.c");
  });

  it("a private key of any length is redacted: PEM over 8,000 characters, PGP blocks, and a header without a footer", () => {
    const body = A(20_000);
    const pem = j("-----BEGIN ", "RSA PRIVATE KEY-----\n", body, "\n-----END ", "RSA PRIVATE KEY-----");
    expect(redactString(`before ${pem} after`)).toBe(`before ${REDACTED} after`);
    const pgp = j("-----BEGIN ", "PGP PRIVATE KEY BLOCK-----\n", A(500), "\n-----END ", "PGP PRIVATE KEY BLOCK-----");
    expect(redactString(`x ${pgp} y`)).toBe(`x ${REDACTED} y`);
    expect(redactString(j("-----BEGIN ", "PRIVATE KEY-----\n", A(300)))).toBe(REDACTED);
  });

  it("text that hides a token with zero-width characters or fullwidth letters is folded and redacted", () => {
    const zw = FAKE.githubToken.slice(0, 5) + String.fromCharCode(0x200b) + FAKE.githubToken.slice(5);
    expect(redactString(`t ${zw}`)).not.toContain(FAKE.githubToken.slice(6));
    const full = [...FAKE.awsKey].map((ch) => String.fromCodePoint(ch.codePointAt(0)! + 0xfee0)).join("");
    const out = redactString(`k ${full}`);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(FAKE.awsKey);
    // Text with no credential is returned exactly as given, not normalised.
    expect(redactString("café ＡＢ")).toBe("café ＡＢ");
  });

  it("is idempotent over the whole corpus and never grows a redacted string", () => {
    const corpus = [FAKE.githubToken, FAKE.awsKey, NPM, GITLAB, SLACK_HOOK, "password=abc", '{"password": "x1y2z3"}', "Authorization: Basic dXNlcg==", "deploy --token=abcd1234", "Cookie: a=b1234567"];
    for (const text of corpus) {
      const once = redactString(text);
      expect(redactString(once)).toBe(once);
      expect(once.length).toBeLessThanOrEqual(text.length + 20);
    }
  });
});

describe("key names", () => {
  it.each(["auth", "passphrase", "pass", "jwt", "signature", "connectionString", "connection_string", "secrets", "tokens", "sshKey", "ssh_key", "auth_token", "client_secrets"])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["PASS", "passed", "tokens_used", "author", "authority", "signal", "secretary"])("does not treat %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it("the KEY TEXT is redacted too, and two secret-looking keys do not overwrite each other", () => {
    const k1 = FAKE.githubToken;
    const k2 = FAKE.githubToken.replace("0123", "9876");
    const out = redactValue({ [k1]: 1, [k2]: 2, ok: 3 }) as Record<string, number>;
    expect(Object.keys(out).sort()).toEqual([REDACTED, `${REDACTED}#2`, "ok"].sort());
    expect(Object.values(out).sort()).toEqual([1, 2, 3]);
    expect(JSON.stringify(out)).not.toContain(FAKE.githubToken);
  });
});

describe("cost is bounded on hostile input", () => {
  const time = (fn: () => unknown): number => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };

  it("24 MB of repeated private-key headers is one pass (it was ~600 ms per MB)", () => {
    const header = j("-----BEGIN ", "PRIVATE KEY-----\n");
    const hostile = header.repeat(Math.floor((24 * 1024 * 1024) / header.length));
    expect(time(() => redactString(hostile))).toBeLessThan(4000);
    expect(redactString(hostile)).toBe(REDACTED);
  });

  it("24 MB of a credential keyword with nothing after it, and 24 MB of name characters, stay linear", () => {
    expect(time(() => redactString("password ".repeat(3 * 1024 * 1024)))).toBeLessThan(6000);
    expect(time(() => redactString("a".repeat(24 * 1024 * 1024)))).toBeLessThan(2000);
  });

  it("scanBufferForCredentials stops at the first window that shows a credential", () => {
    const secret = Buffer.from(`${FAKE.githubToken} `);
    // A second, different credential sits many windows later: the scan stops before reaching it.
    const later = Buffer.from(` ${FAKE.awsKey} `);
    const buf = Buffer.concat([secret, Buffer.alloc(10 * 1024 * 1024, 0x61), later, Buffer.alloc(30 * 1024 * 1024, 0x61)]);
    const t = time(() => expect(scanBufferForCredentials(buf)).toEqual(["github-token"]));
    expect(t).toBeLessThan(1500);
    expect(scanBufferForCredentials(Buffer.alloc(3 * 1024 * 1024, 0x61))).toEqual([]);
  });

  it("findCredentialPatterns names patterns but never returns the matched text", () => {
    const names = findCredentialPatterns(`${FAKE.githubToken} and password=abcdef`);
    expect(names).toEqual(expect.arrayContaining(["github-token", "assignment"]));
    expect(JSON.stringify(names)).not.toContain(FAKE.githubToken);
  });
});

describe("file names, extension keys and bundle entries never carry a planted secret", () => {
  const made: Workspace[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((w) => w.cleanup()));
  });
  const allBytes = (dir: string): string =>
    readdirSync(dir, { withFileTypes: true })
      .map((e) => (e.isDirectory() ? allBytes(join(dir, e.name)) : `${e.name}\n${readFileSync(join(dir, e.name), "latin1")}`))
      .join("\n");

  async function planted(): Promise<{ ws: Workspace; name: string }> {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement()] }));
    await writeRevisions(ws, REPOS);
    const name = `${FAKE.githubToken}.receipt.json`;
    await writeReceipt(ws, {
      fileName: name,
      receipt: { extensions: { [FAKE.awsKey]: "value", [`TOKEN_${FAKE.skToken}`]: "x" } },
    });
    return { ws, name };
  }

  it("a token in a receipt file name, an extension key or a key with a word prefix does not reach report.json, index.html, the bundle, the restored tree or any output", async () => {
    const { ws } = await planted();
    const outputs: string[] = [];
    const ev = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(ev.code, ev.stderr).toBe(0);
    outputs.push(ev.stdout, ev.stderr, allBytes(ws.outputDir));
    const bundle = join(ws.dir, "planted.pgbundle");
    const exp = await runCli(["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", bundle]);
    expect(exp.code, exp.stderr).toBe(0);
    outputs.push(exp.stdout, exp.stderr, readFileSync(bundle, "latin1"));
    const restored = join(ws.dir, "restored");
    const res = await runCli(["bundle", "restore", bundle, "--output", restored]);
    expect(res.code, res.stderr).toBe(0);
    outputs.push(res.stdout, allBytes(restored));
    const ex = await runCli(["explain", "REQ-001", "--report", ws.outputDir]);
    outputs.push(ex.stdout);
    const secrets = [FAKE.githubToken, FAKE.awsKey, FAKE.skToken];
    for (const [i, text] of outputs.entries()) for (const s of secrets) expect(text, `output ${i}`).not.toContain(s);
    // The report shows a name derived from the receipt's content (round 3: a redacted name collided and lost its suffix), never the token.
    const shown = JSON.parse(readFileSync(join(ws.outputDir, "report.json"), "utf8")).receipts[0].source_file as string;
    expect(shown).toMatch(/^redacted-[0-9a-f]{16}\.receipt\.json$/);
    expect(shown).not.toContain(FAKE.githubToken);
  });

  it("an error that names such a file does not echo the token (packaged binary)", async () => {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws);
    await writeRevisions(ws);
    await mkdir(ws.receiptsDir, { recursive: true });
    await writeFile(join(ws.receiptsDir, `${FAKE.githubToken}.receipt.json`), "{ not json");
    const r = await runDist(evalArgs(ws, ["--now", NOW]));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("receipt_invalid_json");
    expect(r.stderr).not.toContain(FAKE.githubToken);
    expect(r.stderr).toContain(REDACTED);
    void sha256;
  });
});
