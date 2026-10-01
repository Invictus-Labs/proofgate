import { createHash, randomBytes } from "node:crypto";
import { constants as fsc } from "node:fs";
import { rmSync } from "node:fs";
import { chmod, lstat, mkdir, open, opendir, realpath, rename, rm, statfs, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { ProofGateError, type ErrorCode } from "./errors.js";
import { MAX_DIRECTORY_DEPTH, type Limits } from "./limits.js";
import { compareStrings } from "./canonical.js";

/**
 * Filesystem confinement. Untrusted documents name files by relative path; this
 * module is the only place those names touch the disk. It rejects absolute
 * paths, `..`, URLs, symlinks (any symlink below the root, escaping or not),
 * and non-regular files, and enforces size and count limits before content is
 * read. It never follows a link and never fetches anything.
 */

export interface Root {
  /** realpath of the directory, computed once. */
  readonly real: string;
}

export interface TreeFile {
  rel: string;
  size: number;
}

const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function validateRelativePath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new ProofGateError("path_invalid", "path must be a non-empty string");
  }
  if (input.length > 512) throw new ProofGateError("path_invalid", "path is longer than 512 characters");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) throw new ProofGateError("path_invalid", "path contains control characters");
  if (URL_LIKE.test(input)) throw new ProofGateError("path_invalid", "URLs are never fetched; use a relative file path");
  if (input.includes("\\")) throw new ProofGateError("path_invalid", "path must use forward slashes");
  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) {
    throw new ProofGateError("path_absolute", "absolute paths are not allowed");
  }
  const segments = input.split("/");
  for (const segment of segments) {
    if (segment === "..") throw new ProofGateError("path_traversal", "path traversal ('..') is not allowed");
    if (segment === "" || segment === ".") {
      throw new ProofGateError("path_invalid", "path must not contain empty or '.' segments");
    }
  }
  return input;
}

export async function openRoot(dir: string, notFound: ErrorCode, what: string): Promise<Root> {
  let real: string;
  try {
    real = await realpath(dir);
    const st = await lstat(real);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new ProofGateError(notFound, `${what} is not a readable directory`);
  }
  return { real };
}

/** Walk a directory tree without following links, enforcing the entry limit before any content is read. */
export async function scanTree(root: Root, limits: Limits): Promise<TreeFile[]> {
  const files: TreeFile[] = [];
  let entries = 0;
  const pending: Array<{ abs: string; rel: string; depth: number }> = [{ abs: root.real, rel: "", depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop() as { abs: string; rel: string; depth: number };
    if (current.depth > MAX_DIRECTORY_DEPTH) {
      throw new ProofGateError("path_invalid", `directory nesting deeper than ${MAX_DIRECTORY_DEPTH} levels`);
    }
    const names: string[] = [];
    const dir = await opendir(current.abs);
    for await (const entry of dir) {
      entries += 1;
      if (entries > limits.maxFiles) {
        throw new ProofGateError("limit_file_count", `more than ${limits.maxFiles} entries in the input directory`, {
          limit: limits.maxFiles,
        });
      }
      names.push(entry.name);
    }
    names.sort();
    for (const name of names) {
      const abs = join(current.abs, name);
      const rel = current.rel === "" ? name : `${current.rel}/${name}`;
      const st = await lstat(abs);
      if (st.isSymbolicLink()) {
        throw new ProofGateError("path_symlink_rejected", `symbolic links are not allowed: ${rel}`);
      }
      if (st.isDirectory()) pending.push({ abs, rel, depth: current.depth + 1 });
      else if (st.isFile()) files.push({ rel, size: st.size });
      else throw new ProofGateError("path_not_regular_file", `not a regular file or directory: ${rel}`);
    }
  }
  return files.sort((a, b) => compareStrings(a.rel, b.rel));
}

/**
 * Open a file below the root for reading. Every path component is checked with
 * lstat; the file itself is opened with O_NOFOLLOW and re-checked against the
 * lstat identity so a swap between check and open is detected.
 */
export async function openConfined(root: Root, rel: string, missing: ErrorCode): Promise<{ handle: FileHandle; size: number }> {
  validateRelativePath(rel);
  const segments = rel.split("/");
  let current = root.real;
  let finalStat: Awaited<ReturnType<typeof lstat>> | undefined;
  for (let i = 0; i < segments.length; i += 1) {
    current = join(current, segments[i] as string);
    let st: Awaited<ReturnType<typeof lstat>>;
    try {
      st = await lstat(current);
    } catch {
      throw new ProofGateError(missing, `file not found: ${rel}`);
    }
    if (st.isSymbolicLink()) throw new ProofGateError("path_symlink_rejected", `symbolic links are not allowed: ${rel}`);
    const last = i === segments.length - 1;
    if (last) {
      if (!st.isFile()) throw new ProofGateError("path_not_regular_file", `not a regular file: ${rel}`);
      finalStat = st;
    } else if (!st.isDirectory()) {
      throw new ProofGateError("path_not_regular_file", `path component is not a directory: ${rel}`);
    }
  }
  let handle: FileHandle;
  try {
    handle = await open(current, fsc.O_RDONLY | fsc.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw new ProofGateError("path_symlink_rejected", `symbolic links are not allowed: ${rel}`);
    throw new ProofGateError(missing, `file could not be opened: ${rel}`);
  }
  const opened = await handle.stat();
  if (!opened.isFile() || opened.ino !== finalStat?.ino || opened.dev !== finalStat?.dev) {
    await handle.close();
    throw new ProofGateError("path_not_regular_file", `file changed while being opened: ${rel}`);
  }
  return { handle, size: opened.size };
}

export async function readConfined(
  root: Root,
  rel: string,
  maxBytes: number,
  missing: ErrorCode,
  tooLarge: ErrorCode,
): Promise<Buffer> {
  const { handle, size } = await openConfined(root, rel, missing);
  try {
    if (size > maxBytes) throw new ProofGateError(tooLarge, `${rel} is ${size} bytes, over the ${maxBytes} byte limit`, { limit: maxBytes });
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return offset === size ? buffer : buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

/** Stream a confined file through sha256 without holding it in memory. */
export async function hashConfined(root: Root, rel: string, missing: ErrorCode): Promise<{ sha256: string; size: number }> {
  const { handle, size } = await openConfined(root, rel, missing);
  try {
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return { sha256: hash.digest("hex"), size: position };
  } finally {
    await handle.close();
  }
}

/* ------------------------------------------------------------- output helpers */

export function tempSibling(finalPath: string): string {
  return join(dirname(finalPath), `.${basename(finalPath)}.tmp-${randomBytes(6).toString("hex")}`);
}

/**
 * Temporary output paths that are still being written. A normal failure removes its own temp path; SIGINT/SIGTERM does
 * not run any `finally`, so the CLI's signal handlers call cleanupTempPathsSync() to remove what is in flight.
 */
const activeTemps = new Set<string>();
export function trackTemp(path: string): void {
  activeTemps.add(path);
}
export function untrackTemp(path: string): void {
  activeTemps.delete(path);
}
/** Synchronously remove every in-flight temporary path; returns how many were removed. */
export function cleanupTempPathsSync(): number {
  let removed = 0;
  for (const path of activeTemps) {
    rmSync(path, { recursive: true, force: true });
    removed += 1;
  }
  activeTemps.clear();
  return removed;
}

/** Free bytes for an unprivileged writer on the filesystem that holds `path` (nearest existing ancestor); undefined if unknown. */
export async function freeBytes(path: string): Promise<number | undefined> {
  let probe = path;
  for (;;) {
    try {
      await lstat(probe);
      break;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return undefined;
      probe = parent;
    }
  }
  try {
    const s = await statfs(probe);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return undefined;
  }
}

/**
 * Fail before any work if the destination clearly cannot hold `needed` bytes (plus 10% and 1 MiB of slack). When the
 * platform cannot report free space the check is skipped; a full disk is then still reported as output_unwritable.
 */
export async function assertFreeSpace(path: string, needed: number, what: string): Promise<void> {
  const free = await freeBytes(path);
  const required = Math.ceil(needed * 1.1) + 1024 * 1024;
  if (free !== undefined && free < required) {
    throw new ProofGateError("output_unwritable", `not enough free space for ${what}: about ${required} bytes are needed, ${free} are available`, { needed: required, free });
  }
}

/** True for the errno codes that mean "the disk or quota is full". */
export function isNoSpace(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOSPC" || code === "EDQUOT";
}

/** Create a directory that only the current user can enter (0700), including missing parents. Existing directories are left untouched. */
export async function ensurePrivateDir(path: string): Promise<void> {
  const created = await mkdir(path, { recursive: true, mode: 0o700 });
  // Only tighten directories this call created; never change permissions of a directory the user already had.
  if (created !== undefined) await chmod(path, 0o700);
}

export async function writePrivateFile(path: string, data: string | Uint8Array): Promise<void> {
  await writeFile(path, data, { mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
}

/**
 * Best-effort removal for a clean-up that runs while another error is being reported. `rm` with `force` only ignores ENOENT: a
 * path below a regular file fails it with ENOTDIR, and that must not replace the failure that is the real answer.
 */
export async function removeQuietly(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically publish a fully written temporary directory as `finalPath`.
 * Without `archiveTo` an existing target is an error (`existsCode`); with it the
 * previous directory is moved aside first so historical output is never
 * destroyed. The temporary directory is removed on any failure.
 */
export async function publishDirectory(
  tempPath: string,
  finalPath: string,
  options: { existsCode: ErrorCode; archiveTo?: string },
): Promise<void> {
  try {
    if (await pathExists(finalPath)) {
      if (options.archiveTo === undefined) {
        throw new ProofGateError(options.existsCode, `output already exists: ${basename(finalPath)} (choose a new path or pass --replace)`);
      }
      if (await pathExists(options.archiveTo)) {
        throw new ProofGateError(options.existsCode, `archive location already exists: ${basename(options.archiveTo)}`);
      }
      await rename(finalPath, options.archiveTo);
      try {
        await rename(tempPath, finalPath);
      } catch (error) {
        await rename(options.archiveTo, finalPath).catch(() => undefined);
        throw error;
      }
      return;
    }
    await rename(tempPath, finalPath);
  } catch (error) {
    await removeQuietly(tempPath);
    if (error instanceof ProofGateError) throw error;
    // Another run published the same path between the check and the rename: that is "already exists", not a broken disk.
    if (isTargetTaken(error)) throw new ProofGateError(options.existsCode, `output already exists: ${basename(finalPath)} (choose a new path or pass --replace)`);
    const mapped = asOutputError(error, basename(finalPath));
    if (mapped instanceof ProofGateError) throw mapped;
    throw new ProofGateError("output_unwritable", `could not publish ${basename(finalPath)}: ${(error as Error).message}`);
  }
}

/* ------------------------------------------------------------- output error mapping and overlap */

const UNWRITABLE_REASONS: Record<string, string> = {
  EACCES: "permission denied",
  EPERM: "permission denied",
  EROFS: "the file system is read-only",
  ENOSPC: "the disk or quota is full",
  EDQUOT: "the disk or quota is full",
  EMFILE: "too many open files",
  ENFILE: "too many open files",
  ENOENT: "a parent of the path does not exist or is not reachable",
  ENOTDIR: "a parent of the path is not a directory",
  EEXIST: "a parent of the path exists and is not a directory",
  EISDIR: "the path is a directory",
  ENAMETOOLONG: "the path is too long",
};

/**
 * Turn a failure to create or write output (permissions, read-only file system, full disk, bad parent) into the stable
 * `output_unwritable` error instead of an internal error. Anything else, and every ProofGateError, is returned unchanged.
 */
export function asOutputError(error: unknown, what: string): unknown {
  if (error instanceof ProofGateError) return error;
  const reason = UNWRITABLE_REASONS[(error as NodeJS.ErrnoException | undefined)?.code ?? ""];
  return reason === undefined ? error : new ProofGateError("output_unwritable", `could not write ${what}: ${reason}`);
}

/** True when a rename onto an existing, non-empty target failed because someone else got there first. */
export function isTargetTaken(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOTEMPTY" || code === "EEXIST";
}

/** realpath of the nearest existing ancestor plus the not-yet-existing rest, so a symlinked parent cannot hide an overlap. */
async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const rest: string[] = [];
  let probe = absolute;
  for (;;) {
    try {
      return join(await realpath(probe), ...rest.reverse());
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return absolute;
      rest.push(basename(probe));
      probe = parent;
    }
  }
}

/**
 * Refuse an output path that is, contains or lies inside one of the inputs. `--replace` would otherwise move the operator's
 * own receipts or manifest aside as a "previous report", and a report written inside the receipts directory would become
 * evidence of the next run. An empty path is refused too (it would mean the current directory).
 */
export async function assertOutputSeparate(output: string, inputs: ReadonlyArray<readonly [label: string, path: string]>): Promise<void> {
  if (output.trim() === "") throw new ProofGateError("cli_usage", "the output path must not be empty");
  const out = await canonicalPath(output);
  for (const [label, path] of inputs) {
    const input = await canonicalPath(path);
    if (out === input || out.startsWith(input + sep) || input.startsWith(out + sep)) {
      throw new ProofGateError(
        "output_overlaps_input",
        `the output path is, contains or lies inside ${label}; choose an output location that is separate from every input (nothing was moved or written)`,
      );
    }
  }
}
