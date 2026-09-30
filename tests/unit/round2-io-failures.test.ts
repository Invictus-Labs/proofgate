/**
 * Storage failures the real file system rarely produces on demand (full disk, permission errors, a raced rename, a failing
 * statfs). The node:fs/promises functions are wrapped so a chosen call fails with a chosen errno, and everything else runs for
 * real. Each failure must surface as the stable code that names the real cause (output_unwritable, bundle_target_exists,
 * bundle_not_found), never as an internal error or as a corrupt bundle, and must leave no temporary output behind.
 */
import { mkdtemp, readdir, rm, mkdir, symlink, writeFile as realWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fail = vi.hoisted(() => ({
  /** errno to raise for the next call of each function whose path argument contains the marker (".tmp-" by default). */
  rules: new Map<string, { code: string; match: string; times: number }>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const wrap = <K extends keyof typeof actual>(name: K, pathArg: (args: unknown[]) => string) =>
    (async (...args: unknown[]) => {
      const rule = fail.rules.get(name as string);
      if (rule !== undefined && rule.times > 0 && pathArg(args).includes(rule.match)) {
        rule.times -= 1;
        // "PRETEND_EXISTS": answer as if the path existed (for lstat), instead of failing.
        if (rule.code === "PRETEND_EXISTS") return (actual[name] as (...a: unknown[]) => unknown)("/");
        // "LSTAT_OF:<path>": answer lstat with the stats of another path (a symlink that "looked like" a regular file at check time).
        if (rule.code.startsWith("LSTAT_OF:")) return (actual[name] as (...a: unknown[]) => unknown)(rule.code.slice("LSTAT_OF:".length));
        // "SWAP_INO": answer lstat with a different inode, as if the file had been replaced between the check and the open.
        if (rule.code === "SWAP_INO") {
          const st = (await (actual[name] as (...a: unknown[]) => Promise<import("node:fs").Stats>)(...args)) as import("node:fs").Stats;
          return Object.assign(Object.create(Object.getPrototypeOf(st) as object) as object, st, { ino: st.ino + 1 });
        }
        throw Object.assign(new Error(`injected ${rule.code}`), { code: rule.code });
      }
      return (actual[name] as (...a: unknown[]) => unknown)(...args);
    }) as unknown as (typeof actual)[K];
  return {
    ...actual,
    writeFile: wrap("writeFile", (a) => String(a[0])),
    open: wrap("open", (a) => String(a[0])),
    rename: wrap("rename", (a) => String(a[0])),
    mkdir: wrap("mkdir", (a) => String(a[0])),
    statfs: wrap("statfs", (a) => String(a[0])),
    lstat: wrap("lstat", (a) => String(a[0])),
  };
});

const inject = (fn: string, code: string, match = ".tmp-", times = 1): void => {
  fail.rules.set(fn, { code, match, times });
};

import { exportBundle, restoreBundle } from "../../src/bundle.js";
import { assertFreeSpace, freeBytes, openConfined, openRoot, publishDirectory, tempSibling } from "../../src/fsguard.js";
import { evaluatePaths } from "../../src/pipeline.js";
import { writeReportDirectory } from "../../src/report.js";
import { makeWorkspace, passingWorkspace, NOW, type Workspace } from "../helpers/fixture.js";

const dirs: string[] = [];
const workspaces: Workspace[] = [];
beforeEach(() => fail.rules.clear());
afterEach(async () => {
  fail.rules.clear();
  await Promise.all(workspaces.splice(0).map((w) => w.cleanup()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function scratch(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "pg-iofail-"));
  dirs.push(d);
  return d;
}
async function pass(): Promise<Workspace> {
  const w = await passingWorkspace();
  workspaces.push(w);
  return w;
}
const inputs = (w: Workspace) => ({ manifestPath: w.manifestPath, receiptsDir: w.receiptsDir, revisionsPath: w.revisionsPath, now: new Date(NOW) });
const hidden = async (dir: string): Promise<string[]> => (await readdir(dir)).filter((n) => n.includes(".tmp-"));

describe("report output failures", () => {
  it("a full disk while writing the report is output_unwritable and leaves nothing behind", async () => {
    const w = await pass();
    inject("writeFile", "ENOSPC");
    await expect(evaluatePaths({ ...inputs(w), outputDir: w.outputDir })).rejects.toMatchObject({ code: "output_unwritable", message: expect.stringContaining("disk or quota is full") });
    expect(await hidden(w.dir)).toEqual([]);
  });

  it("any other write error is output_unwritable with the system's own message", async () => {
    const w = await pass();
    inject("writeFile", "EIO");
    await expect(evaluatePaths({ ...inputs(w), outputDir: w.outputDir })).rejects.toMatchObject({ code: "output_unwritable", message: expect.stringContaining("injected EIO") });
    expect(await hidden(w.dir)).toEqual([]);
  });

  it("creating the temporary report directory fails with EACCES: output_unwritable, permission denied", async () => {
    const w = await pass();
    inject("mkdir", "EACCES");
    await expect(evaluatePaths({ ...inputs(w), outputDir: w.outputDir })).rejects.toMatchObject({ code: "output_unwritable", message: expect.stringContaining("permission denied") });
  });

  it("running out of archive names (10,000 taken) is output_exists, not an endless loop", async () => {
    const w = await pass();
    const first = await evaluatePaths({ ...inputs(w), outputDir: w.outputDir });
    expect(first.exitCode).toBe(0);
    inject("lstat", "PRETEND_EXISTS", ".superseded-", 1_000_000);
    await expect(writeReportDirectory(w.outputDir, first.report, { replace: true, archiveSuffix: "taken" })).rejects.toMatchObject({ code: "output_exists", message: expect.stringContaining("too many archived reports") });
    expect(await hidden(w.dir)).toEqual([]);
  });
});

describe("bundle output failures", () => {
  async function exported(w: Workspace): Promise<string> {
    expect((await evaluatePaths({ ...inputs(w), outputDir: w.outputDir })).exitCode).toBe(0);
    const file = join(w.dir, "b.pgbundle");
    await exportBundle({ ...inputs(w), reportPath: w.outputDir, outputFile: file });
    return file;
  }

  it("a permission error while writing the bundle is output_unwritable; an unknown one keeps its message", async () => {
    const w = await pass();
    expect((await evaluatePaths({ ...inputs(w), outputDir: w.outputDir })).exitCode).toBe(0);
    inject("open", "EACCES");
    await expect(exportBundle({ ...inputs(w), reportPath: w.outputDir, outputFile: join(w.dir, "x.pgbundle") })).rejects.toMatchObject({ code: "output_unwritable", message: expect.stringContaining("permission denied") });
    inject("open", "EIO");
    await expect(exportBundle({ ...inputs(w), reportPath: w.outputDir, outputFile: join(w.dir, "y.pgbundle") })).rejects.toMatchObject({ code: "output_unwritable", message: expect.stringContaining("injected EIO") });
    expect(await hidden(w.dir)).toEqual([]);
  });

  it("a bundle that cannot be opened is bundle_not_found", async () => {
    const w = await pass();
    const file = await exported(w);
    inject("open", "EACCES", "b.pgbundle");
    await expect(restoreBundle({ bundleFile: file, outputDir: join(w.dir, "r") })).rejects.toMatchObject({ code: "bundle_not_found" });
  });

  it("a full disk while restoring is output_unwritable (not bundle_corrupt) and keeps nothing", async () => {
    const w = await pass();
    const file = await exported(w);
    inject("mkdir", "ENOSPC");
    await expect(restoreBundle({ bundleFile: file, outputDir: join(w.dir, "r1") })).rejects.toMatchObject({ code: "output_unwritable" });
    inject("open", "ENOSPC");
    await expect(restoreBundle({ bundleFile: file, outputDir: join(w.dir, "r2") })).rejects.toMatchObject({ code: "output_unwritable", message: expect.stringContaining("disk or quota is full") });
    expect(await hidden(w.dir)).toEqual([]);
  });

  it("a permission error while restoring is output_unwritable; an unknown I/O error is reported as what it is", async () => {
    const w = await pass();
    const file = await exported(w);
    inject("open", "EACCES");
    await expect(restoreBundle({ bundleFile: file, outputDir: join(w.dir, "r3") })).rejects.toMatchObject({ code: "output_unwritable", message: expect.stringContaining("permission denied") });
    inject("open", "EIO");
    await expect(restoreBundle({ bundleFile: file, outputDir: join(w.dir, "r4") })).rejects.toMatchObject({ code: "bundle_corrupt", message: expect.stringContaining("injected EIO") });
    expect(await hidden(w.dir)).toEqual([]);
  });

  it("a restore that loses the race for its target says bundle_target_exists", async () => {
    const w = await pass();
    const file = await exported(w);
    inject("rename", "ENOTEMPTY");
    await expect(restoreBundle({ bundleFile: file, outputDir: join(w.dir, "r5") })).rejects.toMatchObject({ code: "bundle_target_exists" });
    expect(await hidden(w.dir)).toEqual([]);
  });
});

describe("confined reads notice a file that changes while it is being opened", () => {
  async function root(): Promise<{ real: string }> {
    const d = await scratch();
    await realWriteFile(join(d, "victim.txt"), "evidence");
    return openRoot(d, "receipts_dir_not_found", "the receipts path");
  }

  it("a file swapped for a symlink between the check and the open is path_symlink_rejected (O_NOFOLLOW)", async () => {
    const r = await root();
    inject("open", "ELOOP", "victim.txt");
    await expect(openConfined(r, "victim.txt", "artifact_missing")).rejects.toMatchObject({ code: "path_symlink_rejected" });
  });

  it("O_NOFOLLOW itself refuses a symlink that passed the lstat check (the check is raced, the open flag is not)", async () => {
    const d = await scratch();
    await realWriteFile(join(d, "victim.txt"), "evidence");
    await symlink(join(d, "victim.txt"), join(d, "link.txt"));
    const r = await openRoot(d, "receipts_dir_not_found", "the receipts path");
    // Without the injected answer the lstat check already refuses the link; with it, only the open flag stands in the way.
    await expect(openConfined(r, "link.txt", "artifact_missing")).rejects.toMatchObject({ code: "path_symlink_rejected" });
    inject("lstat", `LSTAT_OF:${join(d, "victim.txt")}`, "link.txt", 1);
    await expect(openConfined(r, "link.txt", "artifact_missing")).rejects.toMatchObject({ code: "path_symlink_rejected" });
  });

  it("a file that cannot be opened is reported with the caller's 'missing' code", async () => {
    const r = await root();
    inject("open", "EACCES", "victim.txt");
    await expect(openConfined(r, "victim.txt", "artifact_missing")).rejects.toMatchObject({ code: "artifact_missing" });
  });

  it("a file replaced by another file between the check and the open (different inode) is refused", async () => {
    const r = await root();
    inject("lstat", "SWAP_INO", "victim.txt", 1);
    await expect(openConfined(r, "victim.txt", "artifact_missing")).rejects.toMatchObject({ code: "path_not_regular_file", message: expect.stringContaining("changed while being opened") });
    // control: without the swap the same read works
    const handle = await openConfined(r, "victim.txt", "artifact_missing");
    await handle.handle.close();
    expect(handle.size).toBe("evidence".length);
  });
});

describe("file system helpers", () => {
  it("free space that cannot be determined skips the preflight instead of failing it", async () => {
    const d = await scratch();
    inject("statfs", "ENOSYS", "", 5);
    expect(await freeBytes(d)).toBeUndefined();
    await expect(assertFreeSpace(d, 10 ** 15, "test")).resolves.toBeUndefined();
    fail.rules.clear();
    await expect(assertFreeSpace(d, 10 ** 18, "test")).rejects.toMatchObject({ code: "output_unwritable" });
  });

  it("publishing over an archived report rolls the archive back when the final rename fails", async () => {
    const d = await scratch();
    const finalPath = join(d, "report");
    await mkdir(finalPath);
    await realWriteFile(join(finalPath, "keep.txt"), "previous");
    const temp = tempSibling(finalPath);
    await mkdir(temp);
    await realWriteFile(join(temp, "new.txt"), "new");
    inject("rename", "EACCES", ".tmp-");
    await expect(publishDirectory(temp, finalPath, { existsCode: "output_exists", archiveTo: join(d, "report.superseded-x") })).rejects.toMatchObject({ code: "output_unwritable" });
    // the previous report is back where it was, and the archive name is free again
    expect((await readdir(finalPath)).sort()).toEqual(["keep.txt"]);
    expect((await readdir(d)).filter((n) => n.includes("superseded"))).toEqual([]);
  });

  it("a rename that loses a race for an existing final path is 'exists', not a disk error", async () => {
    const d = await scratch();
    const finalPath = join(d, "out");
    const temp = tempSibling(finalPath);
    await mkdir(temp);
    inject("rename", "ENOTEMPTY", ".tmp-");
    await expect(publishDirectory(temp, finalPath, { existsCode: "output_exists" })).rejects.toMatchObject({ code: "output_exists" });
  });
});
