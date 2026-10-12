/**
 * Review round 1, second wave (edge-case prober and conformance auditor): arguments that silently dropped evidence, an
 * output path that could move the operator's own inputs, a closed stdout or an uncaught exception that reported the
 * "policy unsatisfied" status by accident, output errors that were labelled internal errors, and ignored receipt-like
 * files. Tests that call the CLI fail on the delivered tree.
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DIST_CLI, errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, makeWorkspace, passingWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const workspaces: Workspace[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // already gone
    }
  }
  await Promise.all(workspaces.splice(0).map((w) => w.cleanup()));
  await Promise.all(scratch.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function pass(): Promise<Workspace> {
  const w = await passingWorkspace();
  workspaces.push(w);
  return w;
}
/** A workspace whose only receipt FAILS (two failing tests). */
async function failing(): Promise<Workspace> {
  const w = await makeWorkspace();
  workspaces.push(w);
  await writeManifest(w);
  await writeRevisions(w);
  await writeReceipt(w, { receipt: { result: "fail", tests: { total: 10, passed: 8, failed: 2, skipped: 0 } } });
  return w;
}

describe("every option takes exactly one value (no evidence is silently dropped)", () => {
  it("--receipts given twice is refused, in either order, even though one of the directories passes", async () => {
    const good = await pass();
    const bad = await failing();
    for (const dirs of [
      [bad.receiptsDir, good.receiptsDir],
      [good.receiptsDir, bad.receiptsDir],
    ]) {
      const out = join(good.dir, `out-${dirs[0] === bad.receiptsDir ? "bad-first" : "good-first"}`);
      const r = await runCli(["evaluate", "--manifest", good.manifestPath, "--receipts", dirs[0] as string, "--receipts", dirs[1] as string, "--revisions", good.revisionsPath, "--output", out, "--now", NOW]);
      expect(r.code, r.stderr).toBe(2);
      expect(errorCode(r)).toBe("cli_usage");
      expect(r.stderr).toContain("--receipts was given more than once");
      expect(r.stdout).not.toContain("ACCEPTED");
      expect(existsSync(out)).toBe(false);
    }
    // Controls: each directory alone gives its own honest verdict.
    expect((await runCli(evalArgs(good, ["--now", NOW]))).code).toBe(0);
    expect((await runCli(evalArgs({ ...bad, outputDir: join(bad.dir, "o") }, ["--now", NOW]))).code).toBe(1);
  });

  it("any repeated option is refused: --now, --output, --manifest, --revisions, --json", async () => {
    const w = await pass();
    for (const extra of [["--now", NOW], ["--json", "--json"], ["--output", join(w.dir, "again")], ["--manifest", w.manifestPath], ["--revisions", w.revisionsPath]]) {
      const r = await runCli(evalArgs(w, ["--now", NOW, ...extra]));
      expect(r.code, extra.join(" ")).toBe(2);
      expect(errorCode(r), extra.join(" ")).toBe("cli_usage");
    }
    expect(existsSync(w.outputDir)).toBe(false);
  });

  it("an empty value is refused for every path option", async () => {
    const w = await pass();
    for (const name of ["manifest", "receipts", "revisions", "output"]) {
      const args = evalArgs(w, ["--now", NOW]);
      args[args.indexOf(`--${name}`) + 1] = "";
      const r = await runCli(args);
      expect(r.code, name).toBe(2);
      expect(errorCode(r), name).toBe("cli_usage");
      expect(r.stderr, name).toContain(`--${name} must not be empty`);
    }
    expect(existsSync(w.outputDir)).toBe(false);
  });

  it("an empty --now and an empty PROOFGATE_NOW are clock_invalid, never the system clock", async () => {
    const w = await pass();
    const flag = await runCli(evalArgs(w, ["--now", ""]));
    expect([flag.code, errorCode(flag)]).toEqual([2, "clock_invalid"]);
    const env = await runCli(evalArgs(w), { PROOFGATE_NOW: "" });
    expect([env.code, errorCode(env)]).toEqual([2, "clock_invalid"]);
    expect(existsSync(w.outputDir)).toBe(false);
  });

  it("explain options are checked the same way (bundle export, verify and restore: see round4-bundle-flags)", async () => {
    const w = await pass();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const twice = await runCli(["explain", "REQ-001", "--report", w.outputDir, "--report", w.outputDir]);
    expect([twice.code, errorCode(twice)]).toEqual([2, "cli_usage"]);
    const empty = await runCli(["explain", "REQ-001", "--report", ""]);
    expect([empty.code, errorCode(empty)]).toEqual([2, "cli_usage"]);
  });
});

describe("--output may not be, contain or lie inside an input (and --replace never moves the operator's inputs)", () => {
  async function refused(w: Workspace, output: string, extra: string[] = []): Promise<void> {
    const args = evalArgs(w, ["--now", NOW, ...extra]);
    args[args.indexOf("--output") + 1] = output;
    const r = await runCli(args);
    expect(r.code, `${output}: ${r.stderr}`).toBe(2);
    expect(errorCode(r), output).toBe("output_overlaps_input");
  }
  function untouched(w: Workspace): void {
    expect(existsSync(w.manifestPath)).toBe(true);
    expect(existsSync(w.revisionsPath)).toBe(true);
    expect(existsSync(w.receiptsDir)).toBe(true);
    expect(readdirSync(w.receiptsDir).length).toBeGreaterThan(0);
    expect(readdirSync(w.dir).filter((n) => n.includes("superseded"))).toEqual([]);
  }

  it("refuses the receipts directory itself, with and without --replace", async () => {
    const w = await pass();
    await refused(w, w.receiptsDir);
    await refused(w, w.receiptsDir, ["--replace"]);
    untouched(w);
  });

  it("refuses a directory inside the receipts directory, and the parent that holds every input, with --replace", async () => {
    const w = await pass();
    await refused(w, join(w.receiptsDir, "report"), ["--replace"]);
    await refused(w, w.dir, ["--replace"]);
    await refused(w, join(w.dir, "..", w.dir.split("/").pop() as string), ["--replace"]);
    untouched(w);
  });

  it("refuses the manifest and revisions file paths, and a symlinked spelling of the receipts directory", async () => {
    const w = await pass();
    await refused(w, w.manifestPath, ["--replace"]);
    await refused(w, w.revisionsPath, ["--replace"]);
    const link = join(w.dir, "link-to-receipts");
    symlinkSync(w.receiptsDir, link);
    await refused(w, link, ["--replace"]);
    await refused(w, join(link, "new-report"));
    untouched(w);
  });

  it("refuses the current directory spelled '.', when it holds the inputs", async () => {
    const w = await pass();
    const cwd = process.cwd();
    process.chdir(w.dir);
    try {
      await refused(w, ".", ["--replace"]);
    } finally {
      process.chdir(cwd);
    }
    untouched(w);
  });

  it("control: a sibling directory and a not-yet-existing nested path are fine", async () => {
    const w = await pass();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const nested = { ...w, outputDir: join(w.dir, "out", "deeper", "report") };
    expect((await runCli(evalArgs(nested, ["--now", NOW]))).code).toBe(0);
    expect((await runCli(evalArgs(w, ["--now", NOW, "--replace"]))).code).toBe(0);
  });

  it("bundle export refuses to write its file inside the receipts directory or over an input", async () => {
    const w = await pass();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    for (const target of [join(w.receiptsDir, "x.pgbundle"), w.manifestPath, w.outputDir]) {
      const r = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", target]);
      expect(r.code, target).toBe(2);
      expect(errorCode(r), target).toBe("output_overlaps_input");
    }
    expect(readdirSync(w.receiptsDir).filter((n) => n.endsWith(".pgbundle"))).toEqual([]);
  });
});

describe("output failures are output_unwritable, not internal errors", () => {
  it.skipIf(process.getuid?.() === 0)("an unwritable parent directory", async () => {
    const w = await pass();
    const locked = await mkdtemp(join(tmpdir(), "pg-locked-"));
    scratch.push(locked);
    chmodSync(locked, 0o500);
    const r = await runCli(evalArgs({ ...w, outputDir: join(locked, "x") }, ["--now", NOW]));
    expect(r.code, r.stderr).toBe(2);
    expect(errorCode(r)).toBe("output_unwritable");
    expect(r.stderr).toContain("permission denied");
  });

  it("a parent that is a file", async () => {
    const w = await pass();
    writeFileSync(join(w.dir, "afile"), "x");
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "afile", "x") }, ["--now", NOW]));
    expect(r.code, r.stderr).toBe(2);
    expect(errorCode(r)).toBe("output_unwritable");
  });

  it("concurrent restores to one target: exactly one wins and every loser says bundle_target_exists", async () => {
    const w = await pass();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const bundle = join(w.dir, "b.pgbundle");
    expect((await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle])).code).toBe(0);
    const target = join(w.dir, "restored");
    const results = await Promise.all(Array.from({ length: 4 }, () => runCli(["bundle", "restore", bundle, "--output", target])));
    expect(results.filter((r) => r.code === 0).length).toBe(1);
    for (const r of results.filter((x) => x.code !== 0)) expect([r.code, errorCode(r)], r.stderr).toEqual([2, "bundle_target_exists"]);
    expect(readdirSync(w.dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });
});

describe("a receipt-looking file that would not be read is refused (review round 2: it used to be a stderr note)", () => {
  it("x.RECEIPT.JSON and x.Receipt.Json are receipt_unreferenced_file (exit 2), naming both files; an exact name is fine", async () => {
    const w = await pass();
    writeFileSync(join(w.receiptsDir, "extra.RECEIPT.JSON"), "{}");
    writeFileSync(join(w.receiptsDir, "other.Receipt.Json"), "{}");
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "receipt_unreferenced_file"]);
    expect(r.stderr).toContain("2 file(s)");
    expect(r.stderr).toContain("extra.RECEIPT.JSON");
    expect(r.stderr).toContain("other.Receipt.Json");
    const clean = await pass();
    expect((await runCli(evalArgs(clean, ["--now", NOW]))).code).toBe(0);
  });
});

describe("a symlinked receipts ROOT is followed, symlinks under it are refused (documented in docs/INTERFACES.md)", () => {
  it("evaluates through a symlinked root directory and still refuses a link inside it", async () => {
    const w = await pass();
    const link = join(w.dir, "receipts-link");
    symlinkSync(w.receiptsDir, link);
    const viaLink = { ...w, receiptsDir: link, outputDir: join(w.dir, "via-link") };
    expect((await runCli(evalArgs(viaLink, ["--now", NOW]))).code).toBe(0);
    symlinkSync(w.manifestPath, join(w.receiptsDir, "sneaky-link"));
    const r = await runCli(evalArgs({ ...viaLink, outputDir: join(w.dir, "via-link-2") }, ["--now", NOW]));
    expect([r.code, errorCode(r)]).toEqual([2, "path_symlink_rejected"]);
  });
});

describe("process-level failures never use exit status 1", () => {
  function run(args: string[], options: { destroyStdout?: boolean; nodeArgs?: string[] } = {}): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [...(options.nodeArgs ?? []), DIST_CLI, ...args], { env: { PATH: process.env.PATH ?? "" }, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      // `proofgate ... | true`: the reader goes away before the summary is written.
      if (options.destroyStdout === true) child.stdout.destroy();
      else child.stdout.resume();
      child.on("close", (code) => resolve({ code, stderr }));
    });
  }

  it("a closed stdout does not change the exit code: the verdict is still 0 (accepted) or 1 (unsatisfied), with no stack trace", async () => {
    const good = await pass();
    const bad = await failing();
    const ok = await run(evalArgs(good, ["--now", NOW]), { destroyStdout: true });
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.stderr).not.toMatch(/\n\s+at |EPIPE|internal_error/);
    const unsatisfied = await run(evalArgs(bad, ["--now", NOW]), { destroyStdout: true });
    expect(unsatisfied.code, unsatisfied.stderr).toBe(1);
    expect(unsatisfied.stderr).not.toMatch(/\n\s+at |EPIPE|internal_error/);
    // and the report was written in both cases
    expect(readFileSync(join(good.outputDir, "report.json"), "utf8")).toContain('"verdict"');
  });

  it("an exception that escapes the command is a one-line internal_error with exit 2, never 1 and never a stack trace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pg-crash-"));
    scratch.push(dir);
    const thrower = join(dir, "late-throw.cjs");
    // Fires after the command has finished but before the process exits (the timer keeps it alive).
    writeFileSync(thrower, "setTimeout(() => { throw new Error('late failure'); }, 500);\n");
    const good = await pass();
    const r = await run(evalArgs(good, ["--now", NOW]), { nodeArgs: ["--require", thrower] });
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toContain("proofgate: error [internal_error]: unexpected failure: late failure");
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});

describe("evaluate without --output says that nothing was written", () => {
  it("prints a one-line stderr note and still prints the summary", async () => {
    const w = await pass();
    const args = ["evaluate", "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--now", NOW];
    const r = await runCli(args);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verdict: ACCEPTED");
    expect(r.stderr).toContain("no --output was given, so no report was written");
    mkdirSync(join(w.dir, "with-output"));
    const withOutput = await runCli([...args, "--output", join(w.dir, "with-output", "r")]);
    expect(withOutput.stderr).not.toContain("no --output was given");
  });
});
