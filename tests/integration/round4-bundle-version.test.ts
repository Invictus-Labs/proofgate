/**
 * Review round 3 (logic re-review P2): `comparable()` kept `report.engine.version`, so a bundle written by one package version
 * failed `bundle verify` and `bundle restore` under another with `bundle_reevaluation_mismatch`, and the documentation tells
 * the operator that code means "forged or damaged: do not use". A backup written by 0.1.0 must verify under 0.1.1. A change of
 * the POLICY ENGINE version is a different rule set and still cannot be re-evaluated, but it now says so instead.
 * The bundle is written by a module graph whose version constants are patched, and read by the real one.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  vi.doUnmock("../../src/version.js");
  vi.resetModules();
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

/** Run the CLI from a fresh module graph in which the version constants are replaced. */
async function runPatched(patch: { PROOFGATE_VERSION?: string; POLICY_ENGINE_VERSION?: number }, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  vi.resetModules();
  vi.doMock("../../src/version.js", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), ...patch }));
  const mod = (await import("../../src/run.js").catch(() => import("../../src/cli.js"))) as { main: (argv: string[], io: unknown) => Promise<number> };
  let stdout = "";
  let stderr = "";
  const code = await mod.main(args, { stdout: { write: (c: string) => (stdout += c) }, stderr: { write: (c: string) => (stderr += c) }, env: {} });
  vi.doUnmock("../../src/version.js");
  vi.resetModules();
  return { code, stdout, stderr };
}

async function bundleWrittenBy(patch: { PROOFGATE_VERSION?: string; POLICY_ENGINE_VERSION?: number }): Promise<{ w: Workspace; bundle: string }> {
  const w = await passingWorkspace();
  made.push(w);
  const ev = await runPatched(patch, evalArgs(w, ["--now", NOW]));
  expect(ev.code, ev.stderr).toBe(0);
  const bundle = join(w.dir, "b.pgbundle");
  const exp = await runPatched(patch, ["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
  expect(exp.code, exp.stderr).toBe(0);
  return { w, bundle };
}

describe("a bundle written by another package version", () => {
  it("control: the patched module really writes a different package version into the report", async () => {
    const { w } = await bundleWrittenBy({ PROOFGATE_VERSION: "0.0.1-older" });
    const report = JSON.parse((await import("node:fs")).readFileSync(join(w.outputDir, "report.json"), "utf8")) as { engine: { version: string } };
    expect(report.engine.version).toBe("0.0.1-older");
  });

  it("verifies and restores under this version (only the package version differs)", async () => {
    const { w, bundle } = await bundleWrittenBy({ PROOFGATE_VERSION: "0.0.1-older" });
    const verify = await runCli(["bundle", "verify", bundle]);
    expect([verify.code, errorCode(verify)], verify.stderr).toEqual([0, undefined]);
    const target = join(w.dir, "restored");
    const restore = await runCli(["bundle", "restore", bundle, "--output", target]);
    expect(restore.code, restore.stderr).toBe(0);
    expect(existsSync(join(target, "report", "report.json"))).toBe(true);
  });

  it("a different POLICY ENGINE version cannot be re-evaluated, and the message says why instead of calling the bundle damaged", async () => {
    const { bundle } = await bundleWrittenBy({ PROOFGATE_VERSION: "0.0.1-older", POLICY_ENGINE_VERSION: 1 });
    const verify = await runCli(["bundle", "verify", bundle]);
    expect([verify.code, errorCode(verify)]).toEqual([2, "bundle_reevaluation_mismatch"]);
    expect(verify.stderr).toContain("policy engine version 1");
    expect(verify.stderr).toContain("not known to be damaged");
    expect(verify.stderr).toContain("0.0.1-older");
  });

  it("control: an untampered same-version bundle verifies and a truncated copy is refused", async () => {
    const { w, bundle } = await bundleWrittenBy({});
    const { readFileSync, writeFileSync } = await import("node:fs");
    expect((await runCli(["bundle", "verify", bundle])).code).toBe(0);
    const bytes = readFileSync(bundle);
    const cut = join(w.dir, "cut.pgbundle");
    writeFileSync(cut, bytes.subarray(0, bytes.length - 40));
    expect((await runCli(["bundle", "verify", cut])).code).toBe(2);
  });
});
