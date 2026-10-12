import { readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalize, hashCanonical } from "./canonical.js";
import { ProofGateError } from "./errors.js";
import { parseJsonStrict } from "./json.js";
import { ensurePrivateDir, pathExists, publishDirectory, removeQuietly, tempSibling, trackTemp, untrackTemp, writePrivateFile, asOutputError } from "./fsguard.js";
import { DEFAULT_LIMITS } from "./limits.js";
import { parseDocument, reportSchema, STATUSES, type Report } from "./schemas.js";

export const REPORT_FILE = "report.json";
export const REPORT_HASH_FILE = "report.sha256";
export const REPORT_HTML_FILE = "index.html";

/** Pretty-printed report.json with keys in canonical order and a trailing newline. */
export function serializeReport(report: Report): string {
  return `${JSON.stringify(JSON.parse(canonicalize(report)) as unknown, null, 2)}\n`;
}

/** Content hash of a report: sha256 of its canonical encoding (independent of formatting). */
export function reportContentHash(report: Report): string {
  return hashCanonical(report);
}

/**
 * Serialise a report for writing, refusing one that the readers (`explain`, `bundle export`, bundle restore) would
 * later refuse: report.json larger than the metadata limit. Called BEFORE the HTML page is rendered, so an evaluation
 * whose fan-out (requirements x repositories) produces an unreadable report fails early and cheaply with a clear reason
 * instead of writing hundreds of megabytes that no command can open.
 */
export function serializeReportWithinLimit(report: Report, maxBytes: number = DEFAULT_LIMITS.maxMetadataBytes): string {
  const json = serializeReport(report);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > maxBytes) {
    throw new ProofGateError(
      "limit_metadata_bytes",
      `the report would be ${bytes} bytes, over the ${maxBytes} byte limit that explain and bundle export accept; the requirements x repositories fan-out is too large, so split the policy`,
      { limit: maxBytes, bytes },
    );
  }
  return json;
}

/**
 * The report's own verdict, exit code and summary must follow from its decisions. A hand-edited report that flips
 * `verdict` to "accepted" while a mandatory requirement is FAIL is refused (`report_invalid`) instead of being explained
 * or bundled as if it were true.
 */
export function assertReportConsistent(report: Report): void {
  const problems: string[] = [];
  const decisions = report.requirements;
  const mandatory = decisions.filter((d) => d.severity === "mandatory");
  const passed = mandatory.filter((d) => d.status === "PASS").length;
  const accepted = mandatory.length > 0 && passed === mandatory.length;
  if (report.verdict !== (accepted ? "accepted" : "unsatisfied")) problems.push(`verdict "${report.verdict}" does not follow from the decisions`);
  if (report.exit_code !== (accepted ? 0 : 1)) problems.push(`exit_code ${report.exit_code} does not follow from the decisions`);
  const s = report.summary;
  if (s.total_requirements !== decisions.length) problems.push("summary.total_requirements");
  if (s.mandatory_requirements !== mandatory.length) problems.push("summary.mandatory_requirements");
  if (s.mandatory_passed !== passed) problems.push("summary.mandatory_passed");
  if (s.mandatory_unsatisfied !== mandatory.length - passed) problems.push("summary.mandatory_unsatisfied");
  for (const status of STATUSES) {
    if (s.by_status[status] !== decisions.filter((d) => d.status === status).length) problems.push(`summary.by_status.${status}`);
  }
  if (problems.length > 0) {
    throw new ProofGateError("report_invalid", `report.json contradicts itself (${problems.join("; ")}); it was edited or is damaged`);
  }
}

export interface ReadReportOptions {
  /** Require report.sha256 next to report.json (default true): a report without its hash cannot be shown to be unmodified. */
  requireHash?: boolean;
}

/**
 * Read and validate a report from a report.json path or a report directory.
 * report.sha256 must sit next to it and match the content hash (unless `requireHash: false`), the document must be
 * schema-valid with no repeated keys, and its verdict, exit code and summary must follow from its decisions.
 */
export async function readReport(path: string, options: ReadReportOptions = {}): Promise<{ report: Report; file: string }> {
  let file = path;
  try {
    const st = await stat(path);
    if (st.isDirectory()) file = join(path, REPORT_FILE);
  } catch {
    throw new ProofGateError("report_not_found", "report path does not exist");
  }
  let text: string;
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error("not a file");
    if (st.size > DEFAULT_LIMITS.maxMetadataBytes) {
      throw new ProofGateError("limit_metadata_bytes", `report is ${st.size} bytes, over the metadata limit`);
    }
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof ProofGateError) throw error;
    throw new ProofGateError("report_not_found", "report.json was not found or is not readable");
  }
  let raw: unknown;
  try {
    raw = parseJsonStrict(text, "report.json");
  } catch (error) {
    if (error instanceof ProofGateError) throw error;
    throw new ProofGateError("report_invalid", "report.json is not valid JSON");
  }
  const report = parseDocument(reportSchema, raw, "report", "report.json");
  const hashFile = join(resolve(file, ".."), REPORT_HASH_FILE);
  if (await pathExists(hashFile)) {
    const recorded = (await readFile(hashFile, "utf8")).trim().split(/\s+/)[0];
    if (recorded !== reportContentHash(report)) {
      throw new ProofGateError("report_invalid", "report.sha256 does not match report.json; the report was modified after it was written");
    }
  } else if (options.requireHash !== false) {
    throw new ProofGateError("report_invalid", "report.sha256 is missing next to report.json, so the report cannot be shown to be unmodified");
  }
  assertReportConsistent(report);
  return { report, file };
}

export interface WriteReportOptions {
  replace: boolean;
  html?: string;
  /** The serialised report.json (from serializeReportWithinLimit); serialised here when omitted. */
  json?: string;
  /** Archive suffix for a superseded report (its assessment id when known). */
  archiveSuffix?: string;
}

/** `<final>.superseded-<suffix>`, or with `-2`, `-3`, ... appended when that archive already exists (archives are never overwritten). */
async function uniqueArchivePath(finalPath: string, suffix: string): Promise<string> {
  const base = `${finalPath}.superseded-${suffix}`;
  if (!(await pathExists(base))) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new ProofGateError("output_exists", "too many archived reports next to the output path; remove some of the .superseded-* directories");
}

/**
 * Write the report directory next to its final location and rename it into
 * place, so a reader never sees a partial report. Owner-only permissions
 * (0700 directory, 0600 files). An existing directory is never overwritten: it
 * is an error, or with `replace` it is moved to `<output>.superseded-<id>` (a
 * counter is appended if that name is taken).
 */
export async function writeReportDirectory(outputDir: string, report: Report, options: WriteReportOptions): Promise<string> {
  const finalPath = resolve(outputDir);
  try {
    await ensurePrivateDir(resolve(finalPath, ".."));
  } catch (error) {
    throw asOutputError(error, "the report");
  }
  const temp = tempSibling(finalPath);
  trackTemp(temp);
  try {
    try {
      await ensurePrivateDir(temp);
    } catch (error) {
      throw asOutputError(error, "the report");
    }
    try {
      await writePrivateFile(join(temp, REPORT_FILE), options.json ?? serializeReport(report));
      await writePrivateFile(join(temp, REPORT_HASH_FILE), `${reportContentHash(report)}\n`);
      if (options.html !== undefined) await writePrivateFile(join(temp, REPORT_HTML_FILE), options.html);
    } catch (error) {
      await removeQuietly(temp);
      const code = (error as NodeJS.ErrnoException).code;
      const why = code === "ENOSPC" || code === "EDQUOT" ? "the disk or quota is full" : (error as Error).message;
      throw new ProofGateError("output_unwritable", `could not write the report: ${why}`);
    }
    let archiveTo: string | undefined;
    try {
      archiveTo = options.replace ? await uniqueArchivePath(finalPath, options.archiveSuffix ?? "previous") : undefined;
    } catch (error) {
      // No free archive name: the finished temporary report must not be left behind next to the output.
      await removeQuietly(temp);
      throw error;
    }
    await publishDirectory(temp, finalPath, archiveTo === undefined ? { existsCode: "output_exists" } : { existsCode: "output_exists", archiveTo });
    return finalPath;
  } finally {
    untrackTemp(temp);
  }
}
