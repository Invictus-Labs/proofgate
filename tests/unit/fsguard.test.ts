import { execFileSync } from "node:child_process";
import { existsSync, statSync, symlinkSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProofGateError } from "../../src/errors.js";
import {
  ensurePrivateDir,
  hashConfined,
  openConfined,
  openRoot,
  pathExists,
  publishDirectory,
  readConfined,
  scanTree,
  tempSibling,
  validateRelativePath,
  writePrivateFile,
} from "../../src/fsguard.js";
import { DEFAULT_LIMITS, withLimits } from "../../src/limits.js";
import { sha256 } from "../helpers/fixture.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pg-fs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const codeOf = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ProofGateError) return error.code;
    throw error;
  }
  return "no-error";
};

describe("validateRelativePath", () => {
  it.each([
    ["a.txt", "a.txt"],
    ["dir/sub/file.xml", "dir/sub/file.xml"],
    ["dots.in.name..ok", "dots.in.name..ok"],
    ["sp ace/ok", "sp ace/ok"],
  ])("accepts %s", (input, expected) => {
    expect(validateRelativePath(input)).toBe(expected);
  });

  it.each([
    ["", "path_invalid"],
    ["a".repeat(513), "path_invalid"],
    ["nul\u0000byte", "path_invalid"],
    ["tab\tchar", "path_invalid"],
    ["back\\slash", "path_invalid"],
    ["https://example.invalid/x", "path_invalid"],
    ["file:///etc/passwd", "path_invalid"],
    ["a//b", "path_invalid"],
    ["a/./b", "path_invalid"],
    ["trailing/", "path_invalid"],
    ["/abs/path", "path_absolute"],
    ["C:/x", "path_absolute"],
    ["c:relative", "path_absolute"],
    ["..", "path_traversal"],
    ["a/../b", "path_traversal"],
    ["../x", "path_traversal"],
    ["a/b/..", "path_traversal"],
  ])("rejects %j as %s", (input, code) => {
    try {
      validateRelativePath(input);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ProofGateError).code).toBe(code);
    }
  });

  it("rejects non-strings", () => {
    expect(() => validateRelativePath(5)).toThrowError(/non-empty string/);
    expect(() => validateRelativePath(undefined)).toThrowError(/non-empty string/);
  });
});

describe("openRoot and scanTree", () => {
  it("rejects a missing path and a plain file as the root, with the caller's code", async () => {
    expect(await codeOf(() => openRoot(join(dir, "nope"), "receipts_dir_not_found", "the receipts path"))).toBe("receipts_dir_not_found");
    await writeFile(join(dir, "file"), "x");
    expect(await codeOf(() => openRoot(join(dir, "file"), "receipts_dir_not_found", "the receipts path"))).toBe("receipts_dir_not_found");
  });

  it("resolves a root that is itself reached through a symlink (the operator's own choice)", async () => {
    await mkdir(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "alias"));
    const root = await openRoot(join(dir, "alias"), "receipts_dir_not_found", "x");
    expect(root.real.endsWith("real")).toBe(true);
  });

  it("lists regular files sorted, with sizes, across nested directories", async () => {
    await mkdir(join(dir, "b/c"), { recursive: true });
    await writeFile(join(dir, "z.txt"), "zz");
    await writeFile(join(dir, "b/c/deep.txt"), "12345");
    await writeFile(join(dir, "a.txt"), "a");
    const root = await openRoot(dir, "receipts_dir_not_found", "x");
    expect(await scanTree(root, DEFAULT_LIMITS)).toEqual([
      { rel: "a.txt", size: 1 },
      { rel: "b/c/deep.txt", size: 5 },
      { rel: "z.txt", size: 2 },
    ]);
  });

  it("counts entries (files and directories) against the limit and stops early", async () => {
    for (let i = 0; i < 12; i += 1) await writeFile(join(dir, `f${i}`), "x");
    const root = await openRoot(dir, "receipts_dir_not_found", "x");
    expect(await codeOf(() => scanTree(root, withLimits({ maxFiles: 11 })))).toBe("limit_file_count");
    expect((await scanTree(root, withLimits({ maxFiles: 12 }))).length).toBe(12);
  });

  it("rejects symlinks of every kind and non-regular files", async () => {
    const root = await openRoot(dir, "receipts_dir_not_found", "x");
    await writeFile(join(dir, "target"), "t");
    symlinkSync(join(dir, "target"), join(dir, "l1"));
    expect(await codeOf(() => scanTree(root, DEFAULT_LIMITS))).toBe("path_symlink_rejected");
    await rm(join(dir, "l1"));
    await mkdir(join(dir, "sub"));
    symlinkSync(join(dir, "sub"), join(dir, "l2"));
    expect(await codeOf(() => scanTree(root, DEFAULT_LIMITS))).toBe("path_symlink_rejected");
    await rm(join(dir, "l2"));
    execFileSync("mkfifo", [join(dir, "pipe")]);
    expect(await codeOf(() => scanTree(root, DEFAULT_LIMITS))).toBe("path_not_regular_file");
  });

  it("rejects absurd directory nesting", async () => {
    let p = dir;
    for (let i = 0; i < 40; i += 1) p = join(p, "d");
    await mkdir(p, { recursive: true });
    const root = await openRoot(dir, "receipts_dir_not_found", "x");
    expect(await codeOf(() => scanTree(root, withLimits({ maxFiles: 100 })))).toBe("path_invalid");
  });
});

describe("confined reads", () => {
  it("reads and hashes a regular file, streaming", async () => {
    await mkdir(join(dir, "a"));
    const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
    await writeFile(join(dir, "a/big.bin"), big);
    const root = await openRoot(dir, "receipts_dir_not_found", "x");
    const h = await hashConfined(root, "a/big.bin", "artifact_missing");
    expect(h).toEqual({ sha256: sha256(big), size: big.length });
    const bytes = await readConfined(root, "a/big.bin", big.length, "artifact_missing", "limit_metadata_bytes");
    expect(bytes.equals(big)).toBe(true);
  });

  it("enforces the read limit before reading", async () => {
    await writeFile(join(dir, "f"), "0123456789");
    const root = await openRoot(dir, "receipts_dir_not_found", "x");
    expect(await codeOf(() => readConfined(root, "f", 9, "artifact_missing", "limit_metadata_bytes"))).toBe("limit_metadata_bytes");
    expect((await readConfined(root, "f", 10, "artifact_missing", "limit_metadata_bytes")).length).toBe(10);
  });

  it("reports missing files with the caller's code and refuses directories and links", async () => {
    await mkdir(join(dir, "d"));
    await writeFile(join(dir, "f"), "x");
    symlinkSync(join(dir, "f"), join(dir, "link"));
    const root = await openRoot(dir, "receipts_dir_not_found", "x");
    expect(await codeOf(() => openConfined(root, "nope", "artifact_missing"))).toBe("artifact_missing");
    expect(await codeOf(() => openConfined(root, "d", "artifact_missing"))).toBe("path_not_regular_file");
    expect(await codeOf(() => openConfined(root, "link", "artifact_missing"))).toBe("path_symlink_rejected");
    expect(await codeOf(() => openConfined(root, "f/child", "artifact_missing"))).toBe("path_not_regular_file");
    expect(await codeOf(() => openConfined(root, "../etc/hosts", "artifact_missing"))).toBe("path_traversal");
    expect(await codeOf(() => openConfined(root, "missing/dir/file", "artifact_missing"))).toBe("artifact_missing");
  });

  it("refuses a symlinked directory component", async () => {
    await mkdir(join(dir, "real"));
    await writeFile(join(dir, "real/secret.txt"), "s");
    symlinkSync(join(dir, "real"), join(dir, "hop"));
    const root = await openRoot(dir, "receipts_dir_not_found", "x");
    expect(await codeOf(() => openConfined(root, "hop/secret.txt", "artifact_missing"))).toBe("path_symlink_rejected");
  });
});

describe("output helpers", () => {
  it("creates private directories and files, and does not chmod directories it did not create", async () => {
    await chmod(dir, 0o755);
    await ensurePrivateDir(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o755);
    const fresh = join(dir, "x/y/z");
    await ensurePrivateDir(fresh);
    expect(statSync(fresh).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "x")).mode & 0o777).toBe(0o700);
    await writePrivateFile(join(fresh, "f"), "data");
    expect(statSync(join(fresh, "f")).mode & 0o777).toBe(0o600);
    await expect(writePrivateFile(join(fresh, "f"), "again")).rejects.toThrow();
    expect(await pathExists(join(fresh, "f"))).toBe(true);
    expect(await pathExists(join(fresh, "nope"))).toBe(false);
  });

  it("names temporary siblings next to the target", () => {
    const t = tempSibling(join(dir, "report"));
    expect(t.startsWith(join(dir, ".report.tmp-"))).toBe(true);
    expect(tempSibling(join(dir, "report"))).not.toBe(t);
  });

  it("publishes a fresh directory by rename", async () => {
    const tmp = tempSibling(join(dir, "out"));
    await mkdir(tmp);
    await writeFile(join(tmp, "f"), "1");
    await publishDirectory(tmp, join(dir, "out"), { existsCode: "output_exists" });
    expect(await readFile(join(dir, "out/f"), "utf8")).toBe("1");
    expect(existsSync(tmp)).toBe(false);
  });

  it("refuses to overwrite an existing target and cleans up the temporary directory", async () => {
    await mkdir(join(dir, "out"));
    await writeFile(join(dir, "out/keep"), "keep");
    const tmp = tempSibling(join(dir, "out"));
    await mkdir(tmp);
    expect(await codeOf(() => publishDirectory(tmp, join(dir, "out"), { existsCode: "output_exists" }))).toBe("output_exists");
    expect(await readFile(join(dir, "out/keep"), "utf8")).toBe("keep");
    expect(existsSync(tmp)).toBe(false);
  });

  it("archives (never deletes) the previous directory when asked, and refuses if the archive exists", async () => {
    await mkdir(join(dir, "out"));
    await writeFile(join(dir, "out/old"), "old");
    const tmp = tempSibling(join(dir, "out"));
    await mkdir(tmp);
    await writeFile(join(tmp, "new"), "new");
    await publishDirectory(tmp, join(dir, "out"), { existsCode: "output_exists", archiveTo: join(dir, "out.old") });
    expect(await readdir(join(dir, "out"))).toEqual(["new"]);
    expect(await readFile(join(dir, "out.old/old"), "utf8")).toBe("old");

    const tmp2 = tempSibling(join(dir, "out"));
    await mkdir(tmp2);
    expect(await codeOf(() => publishDirectory(tmp2, join(dir, "out"), { existsCode: "output_exists", archiveTo: join(dir, "out.old") }))).toBe("output_exists");
    expect(await readdir(join(dir, "out"))).toEqual(["new"]);
  });

  it("turns an unexpected rename failure into output_unwritable and removes the temp directory", async () => {
    const tmp = tempSibling(join(dir, "no-parent/out"));
    await mkdir(join(dir, "no-parent"));
    await mkdir(tmp);
    await rm(join(dir, "no-parent"), { recursive: true });
    expect(await codeOf(() => publishDirectory(tmp, join(dir, "no-parent/out"), { existsCode: "output_exists" }))).toBe("output_unwritable");
  });
});
