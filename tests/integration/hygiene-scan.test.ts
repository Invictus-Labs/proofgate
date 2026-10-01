/**
 * Negative controls for the secret and content hygiene scan (scripts/hygiene-scan.mjs), which is a step of the local gate.
 * A scan that cannot go red proves nothing, so every rule is planted in a scratch directory and must be found there,
 * and a clean directory must pass. Planted values are assembled from fragments so this file is itself clean.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE } from "../helpers/fake-secrets.js";
import { ROOT } from "../helpers/cli.js";

/** A process that could not be started or was killed is never reported as exit status 1, which means "policy unsatisfied". */
const SPAWN_FAILED = -1;

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function scan(files: Record<string, string>): Promise<{ code: number; stdout: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pg-hygiene-"));
  made.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return new Promise((resolve) => {
    execFile(process.execPath, [join(ROOT, "scripts", "hygiene-scan.mjs"), "--root", dir], (error, stdout) => {
      resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : SPAWN_FAILED, stdout });
    });
  });
}

const j = (...parts: string[]): string => parts.join("");

describe("hygiene scan negative controls", () => {
  it("passes a clean tree and prints no matched text", async () => {
    const r = await scan({ "README.md": "# Synthetic demo\n\nContact: person@example.invalid\nUse http://localhost:8080 for local demos.\n", "src/a.ts": "export const a = 1;\n" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("clean");
  });

  const planted: Array<[string, string, string, string]> = [
    ["an AWS access key id", "notes.txt", FAKE.awsKey, "AWS access key"],
    ["a GitHub token", "notes.txt", FAKE.githubToken, "GitHub token"],
    ["a fine-grained GitHub token", "notes.txt", FAKE.githubPat, "fine-grained"],
    ["a Slack token", "notes.txt", FAKE.slackToken, "Slack token"],
    ["an API secret key", "notes.txt", FAKE.skToken, "API secret key"],
    ["a Google API key", "notes.txt", FAKE.googleKey, "Google API key"],
    ["a payment key", "notes.txt", FAKE.stripeKey, "payment secret key"],
    ["a JWT", "notes.txt", FAKE.jwt, "JWT"],
    ["a private key block", "key.txt", FAKE.privateKey, "private key block"],
    ["a password inside a URL", "notes.txt", FAKE.urlPassword, "password in URL"],
    ["a personal path (macOS)", "notes.md", j("see ", "/Us", "ers/", "someone/project"), "personal path"],
    ["a personal path (Linux)", "notes.md", j("see ", "/ho", "me/", "someone/project"), "personal path"],
    ["an e-mail address", "notes.md", j("mail me at ", "someone", "@", "company.example.com"), "e-mail address"],
    ["a UUID literal in committed fixture data", "fixtures/demo/receipt.json", j('{"id": "', "123e4567", "-e89b-", "12d3-", "a456-", '426614174000"}'), "UUID literal"],
    ["a token glued to a word with an underscore", "notes.txt", `TOKEN_${FAKE.githubToken}`, "GitHub token"],
    ["a bidi override stored raw in a text file", "notes.md", `title ${String.fromCharCode(0x202e)}gnp.exe`, "invisible or bidi"],
    ["a zero-width character stored raw in a text file", "notes.ts", `const a = "x${String.fromCharCode(0x200b)}y";`, "invisible or bidi"],
    ["a raw ESC character", "notes.md", `red ${String.fromCharCode(0x1b)}[31m text`, "invisible or bidi"],
    ["an internal board reference", "notes.md", j("Status: Draft. Board: ", "#", "1234", " (authoring only)."), "internal board or ticket"],
  ];
  it.each(planted)("finds %s", async (_name, file, content, label) => {
    const r = await scan({ [file]: `${content}\n` });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(label);
    expect(r.stdout).toContain(file);
    // The scan reports where, never what.
    expect(r.stdout).not.toContain(content.slice(0, 24));
  });

  it("allows the reserved example domain and a bare private-key header (a redaction test string), and UUIDs outside committed data", async () => {
    const r = await scan({
      "docs/a.md": "person@example.invalid\n",
      "tests/redact.test.ts": j("const header = '-----BEGIN ", "PRIVATE KEY-----';\n"),
      "docs/ids.md": `${j("123e4567", "-e89b-", "12d3-", "a456-", "426614174000")}\n`,
    });
    expect(r.code).toBe(0);
  });

  it("refuses forbidden files: an env file, a key file, build output, a tarball and a GitHub Actions workflow", async () => {
    for (const file of [".env", "server.pem", "dist/cli.js", "proofgate-0.1.0.tgz", ".github/workflows/ci.yml"]) {
      const r = await scan({ [file]: "x\n" });
      expect(r.code, file).toBe(1);
      expect(r.stdout, file).toContain("forbidden file");
    }
    expect((await scan({ ".env.example": "PLACEHOLDER=\n" })).code).toBe(0);
  });
});
