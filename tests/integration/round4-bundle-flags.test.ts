/**
 * Review round 3 (tests re-review P2): only `explain` had a repeated-flag test, so removing the option check from `bundle export`
 * or from `bundle verify`/`restore` survived every test. `bundle export --receipts A --receipts B` is exactly the evidence-dropping
 * shape of the original repeated-flag P1: the bundle would be built from one directory while the operator believes it holds both.
 * Every option of the three subcommands is checked repeated and empty, in the `--x v` and `--x=v` spellings, and nothing is written.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});
function exportArgs(w: Workspace, output: string): string[] {
  return ["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", output];
}
async function evaluated(): Promise<{ w: Workspace; bundle: string }> {
  const w = await passingWorkspace();
  made.push(w);
  expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
  const bundle = join(w.dir, "good.pgbundle");
  const exported = await runCli(exportArgs(w, bundle));
  expect(exported.code, exported.stderr).toBe(0);
  return { w, bundle };
}

const EXPORT_OPTIONS = ["report", "manifest", "receipts", "revisions", "output", "max-blob-bytes"] as const;

describe("bundle export: every option is checked for repeats and empty values", () => {
  it.each(EXPORT_OPTIONS)("--%s twice is cli_usage and writes nothing (space and = spellings)", async (name) => {
    const { w } = await evaluated();
    const out = join(w.dir, `twice-${name}.pgbundle`);
    const values: Record<string, string> = { report: w.outputDir, manifest: w.manifestPath, receipts: w.receiptsDir, revisions: w.revisionsPath, output: out, "max-blob-bytes": "1000000" };
    const value = values[name] as string;
    const extra = name === "max-blob-bytes" ? ["--max-blob-bytes", "1000000"] : [];
    const base = exportArgs(w, out);
    for (const repeated of [[...base, ...extra, `--${name}`, value], [...base, ...extra, `--${name}=${value}`]]) {
      const r = await runCli(repeated);
      expect([r.code, errorCode(r)], `${repeated.slice(-2).join(" ")}: ${r.stderr}`).toEqual([2, "cli_usage"]);
      expect(r.stderr).toContain(`--${name}`);
      expect(existsSync(out), "no bundle is written").toBe(false);
    }
  });

  it("the evidence-dropping shape: --receipts given twice with a different directory is refused, not silently the last one", async () => {
    const { w } = await evaluated();
    const out = join(w.dir, "dropping.pgbundle");
    const r = await runCli([...exportArgs(w, out), "--receipts", join(w.dir, "elsewhere")]);
    expect([r.code, errorCode(r)]).toEqual([2, "cli_usage"]);
    expect(existsSync(out)).toBe(false);
  });

  it.each(EXPORT_OPTIONS.filter((o) => o !== "max-blob-bytes"))("an empty --%s is cli_usage", async (name) => {
    const { w } = await evaluated();
    const out = join(w.dir, `empty-${name}.pgbundle`);
    const args = exportArgs(w, out);
    args[args.indexOf(`--${name}`) + 1] = "";
    const r = await runCli(args);
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "cli_usage"]);
    expect(existsSync(out)).toBe(false);
  });

  it("--allow-secret-artifacts given twice is cli_usage", async () => {
    const { w } = await evaluated();
    const r = await runCli([...exportArgs(w, join(w.dir, "flag.pgbundle")), "--allow-secret-artifacts", "--allow-secret-artifacts"]);
    expect([r.code, errorCode(r)]).toEqual([2, "cli_usage"]);
  });

  it("control: the same arguments given once export", async () => {
    const { w } = await evaluated();
    const out = join(w.dir, "control.pgbundle");
    expect((await runCli(exportArgs(w, out))).code).toBe(0);
    expect(existsSync(out)).toBe(true);
  });
});

describe("bundle verify and restore: repeated and empty options are refused", () => {
  it("verify --max-blob-bytes twice is cli_usage", async () => {
    const { bundle } = await evaluated();
    const r = await runCli(["bundle", "verify", bundle, "--max-blob-bytes", "1000000", "--max-blob-bytes", "2000000"]);
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "cli_usage"]);
    const eq = await runCli(["bundle", "verify", bundle, "--max-blob-bytes=1000000", "--max-blob-bytes=2000000"]);
    expect([eq.code, errorCode(eq)], eq.stderr).toEqual([2, "cli_usage"]);
  });

  it("verify with an empty --max-blob-bytes is cli_usage", async () => {
    const { bundle } = await evaluated();
    const r = await runCli(["bundle", "verify", bundle, "--max-blob-bytes", ""]);
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "cli_usage"]);
  });

  it("restore --output twice is cli_usage and restores nothing", async () => {
    const { w, bundle } = await evaluated();
    const a = join(w.dir, "restored-a");
    const b = join(w.dir, "restored-b");
    for (const args of [["--output", a, "--output", b], [`--output=${a}`, `--output=${b}`]]) {
      const r = await runCli(["bundle", "restore", bundle, ...args]);
      expect([r.code, errorCode(r)], r.stderr).toEqual([2, "cli_usage"]);
      expect(existsSync(a) || existsSync(b), "nothing is restored").toBe(false);
    }
  });

  it("restore --max-blob-bytes twice and an empty --output are cli_usage", async () => {
    const { w, bundle } = await evaluated();
    const twice = await runCli(["bundle", "restore", bundle, "--output", join(w.dir, "r1"), "--max-blob-bytes", "1000000", "--max-blob-bytes", "2000000"]);
    expect([twice.code, errorCode(twice)], twice.stderr).toEqual([2, "cli_usage"]);
    const empty = await runCli(["bundle", "restore", bundle, "--output", ""]);
    expect([empty.code, errorCode(empty)], empty.stderr).toEqual([2, "cli_usage"]);
    expect(existsSync(join(w.dir, "r1"))).toBe(false);
  });

  it("control: verify and restore with each option once work", async () => {
    const { w, bundle } = await evaluated();
    expect((await runCli(["bundle", "verify", bundle, "--max-blob-bytes", "1000000"])).code).toBe(0);
    const target = join(w.dir, "restored-ok");
    expect((await runCli(["bundle", "restore", bundle, "--output", target])).code).toBe(0);
    expect(existsSync(target)).toBe(true);
  });
});
