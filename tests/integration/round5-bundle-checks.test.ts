/**
 * Review round 5 (logic P2 and security P3):
 *  - `bundle export` extracted the whole bundle into the system temp directory to verify it before publishing, so with a read-only or
 *    small TMPDIR the export failed (`output_unwritable ... would not verify or restore`, blaming the bundle); the round-3 tree exited 0. The
 *    check now extracts next to the output file.
 *  - a re-sealed bundle could swap the `role` of an entry, and a non-canonical magic (`PROOFGATE-BUNDLE 01`) was accepted.
 */
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleBundle, parseBundleBuffer } from "../helpers/bundle.js";
import { errorCode, evalArgs, runCli, runDist } from "../helpers/cli.js";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  for (const w of made) {
    try {
      chmodSync(join(w.dir, "ro-tmp"), 0o755);
    } catch {
      // not created in this test
    }
  }
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

async function exported(w: Workspace, name = "good.pgbundle"): Promise<string> {
  expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
  const bundle = join(w.dir, name);
  const r = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
  expect([r.code, errorCode(r)], r.stderr).toEqual([0, undefined]);
  return bundle;
}

describe("bundle export does not need the system temp directory", () => {
  it("with TMPDIR read-only the export still succeeds, verifies and restores; nothing is left next to the output", async () => {
    const w = await passingWorkspace();
    made.push(w);
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const readOnly = join(w.dir, "ro-tmp");
    mkdirSync(readOnly, { mode: 0o755 });
    chmodSync(readOnly, 0o555);
    const outDir = join(w.dir, "out-bundles");
    const bundle = join(outDir, "b.pgbundle");
    const r = await runDist(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle], { env: { TMPDIR: readOnly } });
    expect([r.code, r.stderr.slice(0, 300)]).toEqual([0, ""]);
    expect(existsSync(bundle)).toBe(true);
    expect(readdirSync(outDir)).toEqual(["b.pgbundle"]);
    // a read-only mode is ignored by a process that runs as root (a container): the claim that verify alone still needs a writable TMPDIR can only be checked where the mode is enforced
    let enforced = true;
    try {
      accessSync(readOnly, constants.W_OK);
      enforced = false;
    } catch {
      // the mode is enforced
    }
    if (enforced) expect((await runDist(["bundle", "verify", bundle], { env: { TMPDIR: readOnly } })).code).not.toBe(0); // verify-only still uses TMPDIR: documented
    chmodSync(readOnly, 0o755);
    expect((await runDist(["bundle", "verify", bundle])).code).toBe(0);
    expect((await runCli(["bundle", "restore", bundle, "--output", join(w.dir, "restored")])).code).toBe(0);
  });
});

describe("a re-sealed bundle cannot change what an entry is, or how the format is spelled", () => {
  it("swapping the role of a receipt entry is refused; the same bundle unchanged verifies", async () => {
    const w = await passingWorkspace();
    made.push(w);
    const bundle = await exported(w);
    const parsed = parseBundleBuffer(readFileSync(bundle));
    const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));
    const same = join(w.dir, "same.pgbundle");
    writeFileSync(same, assembleBundle(parsed.header, entries));
    expect((await runCli(["bundle", "verify", same])).code).toBe(0);

    for (const [from, to] of [["receipt", "artifact"], ["artifact", "receipt"], ["report", "manifest"], ["manifest", "revisions"]] as const) {
      const index = entries.findIndex((e) => e.role === from);
      if (index === -1) continue;
      const swapped = entries.map((e, i) => (i === index ? { ...e, role: to } : e));
      const file = join(w.dir, `swapped-${from}-${to}.pgbundle`);
      writeFileSync(file, assembleBundle(parsed.header, swapped));
      const verify = await runCli(["bundle", "verify", file]);
      expect([verify.code, errorCode(verify)], `${from} -> ${to}: ${verify.stderr}`).toEqual([2, "bundle_entry_invalid"]);
      expect(verify.stderr).toContain(entries[index]?.path as string);
      expect((await runCli(["bundle", "restore", file, "--output", join(w.dir, `restored-${from}-${to}`)])).code).toBe(2);
    }
  });

  it.each(["PROOFGATE-BUNDLE 01", "PROOFGATE-BUNDLE 001", "PROOFGATE-BUNDLE 0"])("the magic %s is not the canonical spelling", async (magic) => {
    const w = await passingWorkspace();
    made.push(w);
    const bundle = await exported(w);
    const parsed = parseBundleBuffer(readFileSync(bundle));
    const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));
    const file = join(w.dir, "magic.pgbundle");
    writeFileSync(file, assembleBundle(parsed.header, entries, { magic }));
    const verify = await runCli(["bundle", "verify", file]);
    expect(verify.code).toBe(2);
    expect(errorCode(verify)).toBe("bundle_invalid_header");
  });

  it.each([
    ["report/report.sha256", "manifest"],
    ["revisions.json", "receipt"],
    ["manifest.json", "artifact"],
  ] as const)("the role of %s cannot be swapped to %s", async (path, role) => {
    const w = await passingWorkspace();
    made.push(w);
    const bundle = await exported(w);
    const parsed = parseBundleBuffer(readFileSync(bundle));
    const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));
    const file = join(w.dir, "role.pgbundle");
    writeFileSync(file, assembleBundle(parsed.header, entries.map((e) => (e.path === path ? { ...e, role } : e))));
    const verify = await runCli(["bundle", "verify", file]);
    expect([verify.code, errorCode(verify)], verify.stderr).toEqual([2, "bundle_entry_invalid"]);
  });

  it.each([
    ["report/index.html", "<script>1</script>"],
    ["report/extra.txt", "notes"],
    ["report/a/b/c.bin", "\u0001\u0002"],
  ])("a re-sealed bundle with an extra entry %s under report/ is refused by verify and by restore, and nothing is written", async (path, body) => {
    const w = await passingWorkspace();
    made.push(w);
    const bundle = await exported(w);
    const parsed = parseBundleBuffer(readFileSync(bundle));
    const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));
    const file = join(w.dir, "extra.pgbundle");
    writeFileSync(file, assembleBundle(parsed.header, [...entries, { path, role: "artifact", bytes: Buffer.from(body) }]));
    const verify = await runCli(["bundle", "verify", file]);
    expect([verify.code, errorCode(verify)], verify.stderr).toEqual([2, "bundle_entry_invalid"]);
    const target = join(w.dir, "restored-extra");
    const restore = await runCli(["bundle", "restore", file, "--output", target]);
    expect([restore.code, errorCode(restore)]).toEqual([2, "bundle_entry_invalid"]);
    expect(existsSync(target)).toBe(false);
  });

  it.each([
    ["PROOFGATE-BUNDLE 1000000", "bundle_invalid_header"],
    ["PROOFGATE-BUNDLE 100000", "bundle_unsupported_version"],
    ["PROOFGATE-BUNDLE 2", "bundle_unsupported_version"],
  ])("the magic %s is refused with %s", async (magic, code) => {
    const w = await passingWorkspace();
    made.push(w);
    const bundle = await exported(w);
    const parsed = parseBundleBuffer(readFileSync(bundle));
    const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));
    const file = join(w.dir, "version.pgbundle");
    writeFileSync(file, assembleBundle(parsed.header, entries, { magic }));
    const verify = await runCli(["bundle", "verify", file]);
    expect([verify.code, errorCode(verify)], verify.stderr).toEqual([2, code]);
  });

  it("control: the canonical magic verifies", async () => {
    const w = await passingWorkspace();
    made.push(w);
    const bundle = await exported(w);
    expect((await runCli(["bundle", "verify", bundle])).code).toBe(0);
  });
});
