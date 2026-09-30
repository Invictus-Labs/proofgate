/**
 * Review round 2 (security re-review): three ways to abort V8 with an out-of-memory error (exit status 134, no message) that
 * the documented limits allow. Each test runs the PACKAGED executable under a heap cap and requires a clean exit: 0 or 1 for
 * a verdict, 2 with a stable code for a refusal, never a signal or 134 (the helper reports a killed process as -1). Every test
 * here fails on the round-2 review tree except the two marked controls: the YAML control and the plain run under a heap cap pass there.
 *
 *   1. non-ASCII text: redaction folded whole strings with per-character concatenation and NFKC (up to 18 characters out
 *      for one in), 1.5 million U+FDFA (a 4.5 MB receipt) aborted at 48 MB, 8 million (24 MB) at 256 MB;
 *   2. `evaluate --json` escaped the report one character at a time: a 5,000-requirement report aborted at 256 MB;
 *   3. a JSON document made of millions of tiny containers (`[[],[],...]`): 3 million empty arrays (9 MB) aborted at 256 MB.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { DIST_CLI, errorCode, evalArgs, runDist } from "../helpers/cli.js";
import { NOW, REPOS, baseManifest, baseRequirement, isoAgo, makeWorkspace, passingWorkspace, sha256, writeManifest, writeRevisions, type Workspace } from "../helpers/fixture.js";

const execFileAsync = promisify(execFile);
const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});
async function workspace(): Promise<Workspace> {
  const w = await passingWorkspace();
  made.push(w);
  return w;
}

/** A receipt file whose `extensions` carry the given text, written by hand so a very large value does not pass through stringify twice. */
async function writeReceiptWithNote(w: Workspace, note: string): Promise<void> {
  const artifact = "artifacts/big.xml";
  const content = "<testsuite/>";
  await mkdir(join(w.receiptsDir, "artifacts"), { recursive: true });
  await writeFile(join(w.receiptsDir, artifact), content);
  const head = JSON.stringify({
    schema_version: 1,
    receipt_id: "rcpt-hostile-1",
    requirement_ids: ["REQ-001"],
    repository: "api",
    commit_sha: REPOS.api,
    runner_id: "runner-synthetic-1",
    environment: "staging",
    test_level: "integration",
    execution_kind: "live",
    result: "pass",
    tests: { total: 10, passed: 10, failed: 0, skipped: 0 },
    artifact: { path: artifact, sha256: sha256(content) },
    finished_at: isoAgo(60),
  });
  await writeFile(join(w.receiptsDir, "rcpt-hostile-1.receipt.json"), `${head.slice(0, -1)},"extensions":{"x-note":"${note}"}}`);
}

const noAbort = (r: { code: number; stderr: string }): void => {
  expect(r.code, r.stderr.slice(0, 400)).not.toBe(134);
  expect(r.code, r.stderr.slice(0, 400)).not.toBe(-1);
  expect(r.stderr).not.toContain("heap");
  expect(r.stderr).not.toContain("FATAL ERROR");
};

describe("non-ASCII text does not exhaust memory during redaction", () => {
  it("1.5 million U+FDFA (a 4.5 MB receipt) is handled at a 48 MB heap; the value is examined without being held in folded form", async () => {
    const w = await workspace();
    await writeReceiptWithNote(w, String.fromCharCode(0xfdfa).repeat(1_500_000));
    const generous = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=2048"] });
    expect(generous.code, generous.stderr).toBe(0);
    const w2 = await workspace();
    await writeReceiptWithNote(w2, String.fromCharCode(0xfdfa).repeat(1_500_000));
    const capped = await runDist(evalArgs(w2, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=48"] });
    noAbort(capped);
    expect(capped.code, capped.stderr).toBe(0);
  }, 180_000);

  it("3 million accented characters (a 6 MB receipt) at a 48 MB heap", async () => {
    const w = await workspace();
    await writeReceiptWithNote(w, "é".repeat(3_000_000));
    const capped = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=48"] });
    noAbort(capped);
    expect(capped.code, capped.stderr).toBe(0);
  }, 180_000);

  it("8 million U+FDFA (the reviewer's 24 MB receipt) at a 256 MB heap: exit 0, the unexaminable value is redacted whole", async () => {
    const w = await workspace();
    await writeReceiptWithNote(w, String.fromCharCode(0xfdfa).repeat(8_000_000));
    const capped = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(capped);
    expect(capped.code, capped.stderr).toBe(0);
    const { readFileSync } = await import("node:fs");
    const report = readFileSync(join(w.outputDir, "report.json"), "utf8");
    expect(report.length).toBeLessThan(200_000);
  }, 300_000);
});

describe("evaluate --json on a large report does not exhaust memory", () => {
  it("a 5,000-requirement, 5-repository manifest (800 KB) prints 9 MB of valid JSON at a 256 MB heap", async () => {
    const w = await makeWorkspace();
    made.push(w);
    const repositories = Array.from({ length: 5 }, (_, i) => ({ id: `repo-${i}` }));
    const requirements = Array.from({ length: 5000 }, (_, i) =>
      baseRequirement({ id: `REQ-${String(i).padStart(5, "0")}`, title: `Synthetic requirement number ${i}`, repositories: undefined }),
    );
    await writeFile(w.manifestPath, stringify(baseManifest({ repositories, requirements })));
    await writeRevisions(w, Object.fromEntries(repositories.map((r, i) => [r.id, String(i).padStart(40, "a")])));
    const r = await runDist(["evaluate", "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--now", NOW, "--json"], {
      nodeArgs: ["--max-old-space-size=256"],
    });
    noAbort(r);
    expect(r.code, r.stderr.slice(0, 300)).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(9_000_000);
    expect((JSON.parse(r.stdout) as { verdict: string }).verdict).toBe("unsatisfied");
  }, 300_000);

  it("the terminal escaper alone rewrites a 3 MB string, and one made only of unsafe characters, at a 48 MB / 160 MB heap", async () => {
    const script = `
      import { escapeJsonForTerminal } from ${JSON.stringify(new URL("../../dist/terminal.js", import.meta.url).href)};
      const plain = JSON.stringify("x".repeat(3_000_000));
      if (escapeJsonForTerminal(plain) !== plain) throw new Error("plain text changed");
      console.log("plain ok");
    `;
    const plain = await execFileAsync(process.execPath, ["--max-old-space-size=48", "--input-type=module", "-e", script], { maxBuffer: 1024 * 1024 });
    expect(plain.stdout).toContain("plain ok");
    const hostile = `
      import { escapeJsonForTerminal } from ${JSON.stringify(new URL("../../dist/terminal.js", import.meta.url).href)};
      const out = escapeJsonForTerminal(JSON.stringify(String.fromCharCode(0x200b).repeat(3_000_000)));
      if (out.length !== 3_000_000 * 6 + 2) throw new Error("unexpected length " + out.length);
      console.log("hostile ok");
    `;
    const bad = await execFileAsync(process.execPath, ["--max-old-space-size=160", "--input-type=module", "-e", hostile], { maxBuffer: 1024 * 1024 });
    expect(bad.stdout).toContain("hostile ok");
  }, 120_000);
});

describe("a JSON document of millions of tiny containers is refused, not parsed", () => {
  it("3 million empty arrays in a receipt (9 MB): exit 2 limit_json_containers at a 256 MB heap", async () => {
    const w = await workspace();
    await writeReceiptWithNote(w, "ok");
    const path = join(w.receiptsDir, "rcpt-hostile-1.receipt.json");
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync(path, "utf8").replace('"x-note":"ok"', `"x-note":[${"[],".repeat(3_000_000)}[]]`);
    await writeFile(path, doc);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect([r.code, errorCode(r)], r.stderr.slice(0, 300)).toEqual([2, "limit_json_containers"]);
  }, 180_000);

  it("the same in revisions.json (a 9 MB revisions file) is refused with the same code", async () => {
    const w = await workspace();
    await writeFile(w.revisionsPath, `{"schema_version":1,"note":[${"[],".repeat(3_000_000)}[]],"revisions":[]}`);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect([r.code, errorCode(r)], r.stderr.slice(0, 300)).toEqual([2, "limit_json_containers"]);
  }, 180_000);

  it("a manifest of the same shape written as JSON-in-YAML is refused by the YAML budget (control for the YAML shapes)", async () => {
    const w = await workspace();
    await writeFile(w.manifestPath, `[${"[],".repeat(1_000_000)}[]]`);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect(r.code).toBe(2);
    expect(["limit_manifest_size", "manifest_parse_error"]).toContain(errorCode(r));
  }, 180_000);
});

describe("control: a normal run under the same heap caps still works", () => {
  it("the passing workspace is accepted at 48 MB", async () => {
    const w = await workspace();
    await writeManifest(w, baseManifest());
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=48"] });
    expect([r.code, r.stderr].slice(0, 1)).toEqual([0]);
    void DIST_CLI;
  });
});
