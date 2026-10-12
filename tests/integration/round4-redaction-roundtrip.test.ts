/**
 * Review round 3 (security re-review must-fix c and d): a bundle is restored by redacting the receipts again and comparing, so
 * redaction must reach a fixed point, and two receipt FILES whose names both look like credentials must not collapse into one
 * bundle entry (or put the credential into an entry name). Hostile receipts go through the whole cycle
 * evaluate -> bundle export -> verify -> restore -> evaluate the restored tree, and every step must succeed with no planted value
 * in any byte of the report or the bundle.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { FAKE, GLUED_TEXT, GLUE_PREFIXES, GLUE_TOKENS, PLANTED_VALUES } from "../helpers/fake-secrets.js";
import { NOW, passingWorkspace, writeReceipt, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

/** mulberry32: a failure can be replayed from its seed. */
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

async function cycle(w: Workspace, label: string): Promise<{ bundleText: string; reportText: string }> {
  const first = await runCli(evalArgs(w, ["--now", NOW]));
  expect([first.code, errorCode(first)], `${label}: ${first.stderr.slice(0, 400)}`).toEqual([0, undefined]);
  const bundle = join(w.dir, "cycle.pgbundle");
  const exported = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
  expect([exported.code, exported.stderr.slice(0, 400)], label).toEqual([0, expect.any(String)]);
  const verified = await runCli(["bundle", "verify", bundle]);
  expect([verified.code, errorCode(verified), verified.stderr.slice(0, 400)], `${label}: verify`).toEqual([0, undefined, expect.any(String)]);
  const restoredTo = join(w.dir, "restored");
  const restored = await runCli(["bundle", "restore", bundle, "--output", restoredTo]);
  expect([restored.code, errorCode(restored), restored.stderr.slice(0, 400)], `${label}: restore`).toEqual([0, undefined, expect.any(String)]);
  const again = await runCli(["bundle", "verify", bundle]);
  expect(again.code, `${label}: verify again`).toBe(0);
  return { bundleText: readFileSync(bundle).toString("latin1"), reportText: readFileSync(join(w.outputDir, "report.json"), "utf8") };
}

describe("hostile receipts survive evaluate -> export -> verify -> restore with nothing planted left", () => {
  it("every glue prefix in front of every token, in one receipt, as plain text and as JSON kept inside JSON", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await writeReceipt(w, {
      receipt: {
        receipt_id: "rcpt-glue-1",
        extensions: { glued: GLUED_TEXT, nested: JSON.stringify({ log: GLUED_TEXT, inner: JSON.stringify({ line: GLUED_TEXT }) }) },
      },
    });
    const { bundleText } = await cycle(w, "glue");
    for (const token of GLUE_TOKENS) expect(bundleText.includes(token), token.slice(0, 10)).toBe(false);
    for (const secret of PLANTED_VALUES) expect(bundleText.includes(secret), secret.slice(0, 10)).toBe(false);
  }, 120_000);

  it.each([1, 2, 3, 4, 5, 6])("seeded random receipt %i: random fragments, escapes, name/value pairs and colliding keys", async (seed) => {
    const random = rng(seed * 7919);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const secrets: string[] = [];
    const fragment = (): string => {
      const kind = Math.floor(random() * 6);
      if (kind === 0) {
        const token = pick(GLUE_TOKENS);
        secrets.push(token);
        return `${pick(GLUE_PREFIXES)}${token}`;
      }
      if (kind === 1) {
        const value = `v${Math.floor(random() * 1e9).toString(36)}Zq9${Math.floor(random() * 1e9).toString(36)}`;
        secrets.push(value);
        return `${pick(["password", "api_key", "client_secret", "Authorization", "token"])}${pick(["=", ": ", " = ", '":"', '\\":\\"'])}${value}`;
      }
      if (kind === 2) return pick(["\\n", "\\t", "%0A", "\\\"", "\\\\", " ", "\n", "&", ";", ","]);
      if (kind === 3) return pick(["done", "passed", "PASS", "author", "token_count", "summary: ok", "tests=10"]);
      if (kind === 4) return `${pick(["--password", "-p", "--token", "-u"])} ${pick(["hunter2x", "root", '"quoted value"', "'single value'"])}`;
      return `${pick(["Bearer ", "Basic ", "Cookie: ", "Set-Cookie: "])}${Math.floor(random() * 1e12).toString(36)}abcdef0123`;
    };
    const text = (): string => Array.from({ length: 8 + Math.floor(random() * 30) }, fragment).join(pick([" ", "\n", "\t", ", ", "; "])); // never empty: a token followed directly by a letter is a documented limit (the AWS key id needs a trailing boundary)
    const collidingKeys: Record<string, string> = {};
    for (let i = 0; i < 4; i += 1) collidingKeys[`token=${String.fromCharCode(97 + i).repeat(24)}`] = text();
    const w = await passingWorkspace();
    made.push(w);
    await writeReceipt(w, {
      receipt: {
        receipt_id: `rcpt-random-${seed}`,
        command: text().slice(0, 1500),
        extensions: { note: text(), list: [text(), text()], env: [{ name: "DB_PASSWORD", value: "hunter2hunter2" }], ...collidingKeys },
      },
    });
    const { bundleText, reportText } = await cycle(w, `seed ${seed}`);
    for (const secret of [...secrets, "hunter2hunter2"]) {
      const at = bundleText.indexOf(secret);
      expect(at === -1, `seed ${seed}: bundle holds ${secret.slice(0, 12)} in context ${JSON.stringify(bundleText.slice(Math.max(0, at - 90), at + secret.length + 30))}`).toBe(true);
      expect(reportText.includes(secret), `seed ${seed}: report holds ${secret.slice(0, 12)}`).toBe(false);
    }
  }, 120_000);
});

describe("receipt files whose NAMES look like credentials", () => {
  it("two names that redact to the same text become two distinct entries, and no entry name carries the credential", async () => {
    const w = await passingWorkspace();
    made.push(w);
    const a = `${FAKE.gitlabToken}-a`;
    const b = `${FAKE.gitlabToken}-b`;
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-name-a" }, fileName: `${a}.receipt.json` });
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-name-b" }, fileName: `${b}.receipt.json` });
    const { bundleText, reportText } = await cycle(w, "names");
    expect(bundleText).not.toContain(FAKE.gitlabToken);
    expect(reportText).not.toContain(FAKE.gitlabToken);
    // the restored tree names the receipts by content, not by the credential
    const names = readdirSync(join(w.dir, "restored", "receipts")).filter((n) => n.endsWith(".receipt.json"));
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names.some((n) => n.includes("glpat"))).toBe(false);
    expect(names.some((n) => n.includes("[REDACTED]")), "no restored name is a redaction marker").toBe(false);
    expect(names.filter((n) => /^redacted-[0-9a-f]{16}(?:-\d+)?\.receipt\.json$/.test(n)).length, "both credential-named receipts are named by content").toBe(2);
    expect(new Set(names).size).toBe(names.length);
  }, 120_000);

  it("a directory named like a credential holding a receipt is handled the same way", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-dir-a" }, fileName: `${FAKE.githubToken}/x.receipt.json` });
    const { bundleText } = await cycle(w, "dir name");
    expect(bundleText).not.toContain(FAKE.githubToken);
  }, 120_000);
});
