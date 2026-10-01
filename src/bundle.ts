import { createHash } from "node:crypto";
import { constants as fsc } from "node:fs";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { assess } from "./evaluate.js";
import { canonicalize, compareStrings } from "./canonical.js";
import { ProofGateError } from "./errors.js";
import { asOutputError, removeQuietly, assertFreeSpace, assertOutputSeparate, ensurePrivateDir, isNoSpace, isTargetTaken, pathExists, readConfined, tempSibling, trackTemp, untrackTemp, validateRelativePath } from "./fsguard.js";
import { parseJsonStrict } from "./json.js";
import { withLimits, type Limits } from "./limits.js";
import { loadInputs, summarizeInputs, type InputPaths } from "./pipeline.js";
import { scanBufferForCredentials } from "./redact.js";
import { readReport, reportContentHash, serializeReport } from "./report.js";
import { assertSupportedVersion, commitSha, parseDocument, sha256Hex, utcTimestamp, uuid, type Report } from "./schemas.js";
import { PROOFGATE_VERSION, SCHEMA_VERSION } from "./version.js";

/**
 * Evidence bundle, format version 1 (a single uncompressed file, so there is
 * no decompression amplification):
 *
 *   PROOFGATE-BUNDLE 1\n
 *   <header: one line of canonical JSON, see bundleHeaderSchema>\n
 *   <entry bytes, concatenated in header order>
 *   PROOFGATE-END <sha256 of every preceding byte>\n
 *
 * The declared sizes are checked against the real file size before any entry is
 * read, so truncation is detected up front. Restore writes into a private
 * temporary directory, verifies every hash and re-evaluates the report from the
 * restored inputs, and only then renames the directory into place.
 */

export const BUNDLE_MAGIC = "PROOFGATE-BUNDLE";
export const BUNDLE_FORMAT = "proofgate.evidence-bundle";
export const BUNDLE_VERSION = 1;
const TRAILER_PREFIX = "PROOFGATE-END ";
const TRAILER_LENGTH = TRAILER_PREFIX.length + 64 + 1;
const MAX_HEADER_BYTES = 4 * 1024 * 1024;

const ROLES = ["report", "manifest", "revisions", "receipt", "artifact"] as const;

export const bundleHeaderSchema = z.strictObject({
  format: z.literal(BUNDLE_FORMAT),
  schema_version: z.literal(SCHEMA_VERSION),
  producer: z.strictObject({ name: z.literal("proofgate"), version: z.string() }),
  /** The report's evaluated_at, so the bundle bytes are reproducible. */
  created_at: utcTimestamp,
  assessment_id: uuid,
  report_content_hash: sha256Hex,
  manifest_hash: sha256Hex,
  policy_hash: sha256Hex,
  revisions_hash: sha256Hex,
  receipts_hash: sha256Hex,
  revisions: z.array(z.strictObject({ repository: z.string(), commit_sha: commitSha })),
  total_bytes: z.number().int().min(0),
  entries: z
    .array(z.strictObject({ path: z.string().min(1).max(512), size: z.number().int().min(0), sha256: sha256Hex, role: z.enum(ROLES) }))
    .min(3),
});
export type BundleHeader = z.infer<typeof bundleHeaderSchema>;

const ALLOWED_TOP = new Set(["manifest.json", "revisions.json"]);
/** The only two files a genuine bundle holds under `report/`; anything else there (a page that looks like the report's own) is refused. */
const REPORT_ENTRIES = new Set(["report/report.json", "report/report.sha256"]);

function comparable(report: Report): string {
  // Bookkeeping that legitimately differs between the original run and a re-evaluation is not part of the comparison. That
  // includes the PACKAGE version that wrote the report (a bundle written by 0.1.0 must verify under 0.1.1); the policy
  // engine version stays in, because a different rule set is a different decision.
  return canonicalize({ ...report, input_summary: null, supersedes: null, clock_source: null, engine: { ...report.engine, version: null } });
}

interface PlannedEntry {
  path: string;
  role: (typeof ROLES)[number];
  size: number;
  sha256: string;
  bytes?: Buffer;
  /** Artifact source below the receipts root. */
  artifact?: string;
}

export interface ExportOptions extends InputPaths {
  reportPath: string;
  outputFile: string;
  limits?: Partial<Limits>;
  /** Explicit consent to bundle artifacts that contain credential-shaped text. */
  allowSecretArtifacts?: boolean;
}

export interface ExportResult {
  outputFile: string;
  header: BundleHeader;
  bundleBytes: number;
}

/** Write a versioned evidence bundle for an existing report and the inputs that produced it. */
export async function exportBundle(options: ExportOptions): Promise<ExportResult> {
  const limits = withLimits(options.limits);
  const { report } = await readReport(options.reportPath);
  const inputs = await loadInputs(options, limits);

  // The bundle must be provable: the supplied inputs must reproduce the report exactly.
  const again = assess({
    manifest: inputs.manifest,
    revisions: inputs.revisions,
    receipts: inputs.receiptSet.receipts,
    now: new Date(report.evaluated_at),
    inputSummary: summarizeInputs(inputs),
  });
  if (comparable(again) !== comparable(report)) {
    throw new ProofGateError("bundle_input_mismatch", "the manifest, revisions and receipts do not reproduce this report; refusing to bundle inconsistent evidence");
  }

  const planned: PlannedEntry[] = [];
  const add = (path: string, role: PlannedEntry["role"], bytes: Buffer) =>
    planned.push({ path, role, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), bytes });

  add("report/report.json", "report", Buffer.from(serializeReport(report)));
  add("report/report.sha256", "report", Buffer.from(`${reportContentHash(report)}\n`));
  add("manifest.json", "manifest", Buffer.from(`${canonicalize(inputs.manifest.manifest)}\n`));
  add(
    "revisions.json",
    "revisions",
    Buffer.from(`${canonicalize({ schema_version: SCHEMA_VERSION, revisions: inputs.revisions.revisions })}\n`),
  );
  const receiptPaths = new Set<string>();
  for (const loaded of inputs.receiptSet.receipts) {
    receiptPaths.add(loaded.source_file);
    add(`receipts/${loaded.source_file}`, "receipt", Buffer.from(`${canonicalize(loaded.source_document)}\n`));
  }
  const artifacts = new Map<string, { size: number; sha256: string }>();
  for (const loaded of inputs.receiptSet.receipts) {
    const path = loaded.receipt.artifact.path;
    if (receiptPaths.has(path)) {
      throw new ProofGateError("bundle_entry_invalid", `artifact path ${path} collides with a receipt document`);
    }
    artifacts.set(path, { size: loaded.artifact_size, sha256: loaded.receipt.artifact.sha256 });
  }
  for (const [path, meta] of [...artifacts.entries()].sort(([a], [b]) => compareStrings(a, b))) {
    planned.push({ path: `receipts/${path}`, role: "artifact", size: meta.size, sha256: meta.sha256, artifact: path });
  }
  planned.sort((a, b) => compareStrings(a.path, b.path));

  const total = planned.reduce((sum, e) => sum + e.size, 0);
  if (planned.length > limits.maxFiles) {
    throw new ProofGateError("limit_file_count", `bundle would hold ${planned.length} entries, over the ${limits.maxFiles} limit`, { limit: limits.maxFiles });
  }
  if (total > limits.maxBlobBytes) {
    throw new ProofGateError("bundle_too_large", `bundle would hold ${total} bytes, over the ${limits.maxBlobBytes} byte cap (raise it explicitly with --max-blob-bytes)`, {
      limit: limits.maxBlobBytes,
    });
  }

  // Redaction covers documents, not opaque artifact bytes: refuse credential-shaped artifacts unless told otherwise.
  if (options.allowSecretArtifacts !== true) {
    const flagged: Array<{ path: string; patterns: string[] }> = [];
    for (const entry of planned) {
      if (entry.artifact === undefined) continue;
      const bytes = await readConfined(inputs.receiptSet.root, entry.artifact, limits.maxBlobBytes, "artifact_missing", "limit_blob_bytes");
      const patterns = scanBufferForCredentials(bytes);
      if (patterns.length > 0) flagged.push({ path: entry.artifact, patterns });
    }
    if (flagged.length > 0) {
      throw new ProofGateError(
        "bundle_secret_detected",
        `artifacts contain credential-shaped text (${flagged.map((f) => `${f.path}: ${f.patterns.join("/")}`).join("; ")}); redact them or pass --allow-secret-artifacts`,
        { artifacts: flagged },
      );
    }
  }

  const header: BundleHeader = {
    format: BUNDLE_FORMAT,
    schema_version: SCHEMA_VERSION,
    producer: { name: "proofgate", version: PROOFGATE_VERSION },
    created_at: report.evaluated_at,
    assessment_id: report.assessment_id,
    report_content_hash: reportContentHash(report),
    manifest_hash: report.manifest_hash,
    policy_hash: report.policy_hash,
    revisions_hash: report.revisions_hash,
    receipts_hash: report.receipts_hash,
    revisions: report.revisions,
    total_bytes: total,
    entries: planned.map(({ path, size, sha256, role }) => ({ path, size, sha256, role })),
  };

  const finalPath = resolve(options.outputFile);
  // A bundle written inside an input (or over one) would change the evidence it was built from.
  await assertOutputSeparate(finalPath, [
    ["the receipts directory", options.receiptsDir],
    ["the manifest", options.manifestPath],
    ["the revisions file", options.revisionsPath],
    ["the report", options.reportPath],
  ]);
  if (await pathExists(finalPath)) {
    throw new ProofGateError("bundle_target_exists", "the bundle output file already exists; choose a new path");
  }
  try {
    await ensurePrivateDir(dirname(finalPath));
  } catch (error) {
    throw asOutputError(error, "the bundle");
  }
  // Fail before writing anything if the destination clearly cannot hold the bundle.
  await assertFreeSpace(dirname(finalPath), total + 64 * 1024, "the evidence bundle");
  const temp = tempSibling(finalPath);
  trackTemp(temp);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temp, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, 0o600);
    const hash = createHash("sha256");
    let written = 0;
    const put = async (data: Buffer, hashed = true) => {
      if (hashed) hash.update(data);
      let offset = 0;
      while (offset < data.length) {
        const { bytesWritten } = await (handle as FileHandle).write(data, offset, data.length - offset);
        offset += bytesWritten;
      }
      written += data.length;
    };
    await put(Buffer.from(`${BUNDLE_MAGIC} ${BUNDLE_VERSION}\n${canonicalize(header)}\n`));
    for (const entry of planned) {
      const bytes =
        entry.bytes ??
        (await readConfined(inputs.receiptSet.root, entry.artifact as string, limits.maxBlobBytes, "artifact_missing", "limit_blob_bytes"));
      if (bytes.length !== entry.size || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
        throw new ProofGateError("artifact_hash_mismatch", `${entry.path} changed while the bundle was being written`);
      }
      await put(bytes);
    }
    await put(Buffer.from(`${TRAILER_PREFIX}${hash.digest("hex")}\n`), false);
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Never publish a bundle that verify and restore would refuse: a backup that can be written but not restored is worse than none
    // (the stored documents are redacted and restore redacts them again, so any redaction that is not a fixed point ends here).
    // The check extracts the bundle into a private scratch directory NEXT TO the output file (the destination has room for the bundle
    // already, and a read-only or small system temp directory is not the bundle's fault).
    try {
      await restoreBundle({ bundleFile: temp, limits, scratchDir: dirname(finalPath) });
    } catch (error) {
      if (error instanceof ProofGateError) {
        if (error.code === "output_unwritable") {
          throw new ProofGateError(
            error.code,
            `the bundle could not be checked before it was published, so nothing was published: ${error.message}; the check extracts a copy of the bundle next to the output file, so that directory needs free space for the bundle itself and for that copy (about twice its size, plus a small margin)`,
            error.detail,
          );
        }
        throw new ProofGateError(error.code, `the bundle was not published because it would not verify or restore: ${error.message}`, error.detail);
      }
      throw error;
    }
    await rename(temp, finalPath);
    return { outputFile: finalPath, header, bundleBytes: written };
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await removeQuietly(temp);
    if (error instanceof ProofGateError) throw error;
    const mapped = asOutputError(error, "the bundle");
    if (mapped instanceof ProofGateError) throw mapped;
    throw new ProofGateError("output_unwritable", `could not write the bundle: ${(error as Error).message}`);
  } finally {
    untrackTemp(temp);
  }
}

/* --------------------------------------------------------------- read/restore */

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

interface ParsedBundle {
  header: BundleHeader;
  headerBytes: number;
}

async function parseBundleHeader(handle: FileHandle, fileSize: number, limits: Limits): Promise<ParsedBundle> {
  const head = await readAt(handle, 0, Math.min(fileSize, MAX_HEADER_BYTES + 64));
  if (head.length === 0) throw new ProofGateError("bundle_truncated", "bundle file is empty");
  const magicPrefix = Buffer.from(`${BUNDLE_MAGIC} `);
  const compared = Math.min(head.length, magicPrefix.length);
  if (!head.subarray(0, compared).equals(magicPrefix.subarray(0, compared))) {
    throw new ProofGateError("bundle_invalid_header", "not a ProofGate evidence bundle");
  }
  const firstNl = head.indexOf(0x0a);
  if (firstNl === -1) {
    throw new ProofGateError(head.length < MAX_HEADER_BYTES ? "bundle_truncated" : "bundle_invalid_header", "bundle header is incomplete");
  }
  const magic = head.toString("utf8", 0, firstNl);
  const m = /^PROOFGATE-BUNDLE ([1-9][0-9]{0,5})$/.exec(magic);
  if (!m) throw new ProofGateError("bundle_invalid_header", "not a ProofGate evidence bundle");
  const version = Number(m[1]);
  if (version !== BUNDLE_VERSION) {
    throw new ProofGateError("bundle_unsupported_version", `bundle format version ${version} is not supported (this ProofGate reads version ${BUNDLE_VERSION})`, {
      found: version,
      supported: [BUNDLE_VERSION],
    });
  }
  const secondNl = head.indexOf(0x0a, firstNl + 1);
  if (secondNl === -1) {
    throw new ProofGateError(fileSize < MAX_HEADER_BYTES ? "bundle_truncated" : "bundle_invalid_header", "bundle header is incomplete");
  }
  let raw: unknown;
  try {
    raw = parseJsonStrict(head.toString("utf8", firstNl + 1, secondNl), "bundle header");
  } catch (error) {
    if (error instanceof ProofGateError) throw error;
    throw new ProofGateError("bundle_invalid_header", "bundle header is not valid JSON");
  }
  assertSupportedVersion(raw, "bundle", "bundle header");
  const header = parseDocument(bundleHeaderSchema, raw, "bundle", "bundle header");

  if (header.entries.length > limits.maxFiles) {
    throw new ProofGateError("limit_file_count", `bundle declares ${header.entries.length} entries, over the ${limits.maxFiles} limit`, { limit: limits.maxFiles });
  }
  const declared = header.entries.reduce((sum, e) => sum + e.size, 0);
  if (declared !== header.total_bytes) throw new ProofGateError("bundle_invalid_header", "bundle entry sizes do not add up to total_bytes");
  if (declared > limits.maxBlobBytes) {
    throw new ProofGateError("bundle_too_large", `bundle declares ${declared} bytes, over the ${limits.maxBlobBytes} byte cap`, { limit: limits.maxBlobBytes });
  }
  validateEntryPaths(header);
  return { header, headerBytes: secondNl + 1 };
}

function validateEntryPaths(header: BundleHeader): void {
  const seen = new Set<string>();
  const dirs = new Set<string>();
  for (const entry of header.entries) {
    try {
      validateRelativePath(entry.path);
    } catch (error) {
      throw new ProofGateError("bundle_entry_invalid", `unsafe bundle entry path: ${(error as Error).message}`, { path: entry.path.slice(0, 80) });
    }
    const top = entry.path.split("/")[0] as string;
    const allowed = ALLOWED_TOP.has(entry.path) || top === "receipts" || REPORT_ENTRIES.has(entry.path);
    if (!allowed) throw new ProofGateError("bundle_entry_invalid", `unexpected bundle entry: ${entry.path}`);
    if (seen.has(entry.path)) throw new ProofGateError("bundle_entry_invalid", `duplicate bundle entry: ${entry.path}`);
    seen.add(entry.path);
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
  }
  for (const dir of dirs) {
    if (seen.has(dir)) throw new ProofGateError("bundle_entry_invalid", `bundle entry ${dir} is both a file and a directory`);
  }
  for (const required of ["report/report.json", "manifest.json", "revisions.json"]) {
    if (!seen.has(required)) throw new ProofGateError("bundle_entry_invalid", `bundle is missing ${required}`);
  }
}

export interface RestoreResult {
  header: BundleHeader;
  report: Report;
  /** Where the bundle was restored; undefined for verify-only runs. */
  outputDir?: string;
}

export interface RestoreOptions {
  bundleFile: string;
  /** Omit to verify without keeping anything. */
  outputDir?: string;
  limits?: Partial<Limits>;
  /** Where a verify-only run extracts (default: the system temp directory). `bundle export` checks next to the output file. */
  scratchDir?: string;
}

/**
 * Verify a bundle and (optionally) restore it. Nothing appears at the target
 * path unless every check passed; failures leave no partial state behind.
 */
export async function restoreBundle(options: RestoreOptions): Promise<RestoreResult> {
  const limits = withLimits(options.limits);
  const bundlePath = resolve(options.bundleFile);
  let fileSize: number;
  try {
    const st = await stat(bundlePath);
    if (!st.isFile()) throw new Error("not a file");
    fileSize = st.size;
  } catch {
    throw new ProofGateError("bundle_not_found", "the bundle file was not found");
  }
  // Fail before doing any work if the file itself is over the cap.
  if (fileSize > limits.maxBlobBytes + MAX_HEADER_BYTES + TRAILER_LENGTH) {
    throw new ProofGateError("bundle_too_large", `bundle file is ${fileSize} bytes, over the ${limits.maxBlobBytes} byte cap (raise it explicitly with --max-blob-bytes)`, {
      limit: limits.maxBlobBytes,
    });
  }
  const finalDir = options.outputDir === undefined ? undefined : resolve(options.outputDir);
  if (finalDir !== undefined && (await pathExists(finalDir))) {
    throw new ProofGateError("bundle_target_exists", "the restore target already exists; choose a new path");
  }

  const handle = await open(bundlePath, fsc.O_RDONLY | fsc.O_NOFOLLOW).catch(() => {
    throw new ProofGateError("bundle_not_found", "the bundle file could not be opened");
  });
  // Restore extracts next to the target so the final rename stays on one filesystem; verify-only uses the system temp dir.
  const scratchRoot = options.scratchDir === undefined ? tmpdir() : resolve(options.scratchDir);
  const temp = tempSibling(finalDir ?? join(scratchRoot, "proofgate-verify"));
  trackTemp(temp);
  try {
    const { header, headerBytes } = await parseBundleHeader(handle, fileSize, limits);
    // Extraction needs the declared bytes on the destination filesystem: fail before writing rather than mid-way.
    await assertFreeSpace(finalDir === undefined ? scratchRoot : dirname(finalDir), header.total_bytes + 64 * 1024, finalDir === undefined ? "the verification copy" : "the restored files");
    const expected = headerBytes + header.total_bytes + TRAILER_LENGTH;
    if (fileSize < expected) {
      throw new ProofGateError("bundle_truncated", `bundle is ${fileSize} bytes but its header declares ${expected}`, { expected, actual: fileSize });
    }
    if (fileSize > expected) {
      throw new ProofGateError("bundle_corrupt", `bundle has ${fileSize - expected} unexpected trailing bytes`);
    }

    await ensurePrivateDir(temp);
    const overall = createHash("sha256");
    overall.update(await readAt(handle, 0, headerBytes));
    let position = headerBytes;
    const chunkSize = 1024 * 1024;
    for (const entry of header.entries) {
      const target = join(temp, entry.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const out = await open(target, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, 0o600);
      try {
        const entryHash = createHash("sha256");
        let remaining = entry.size;
        while (remaining > 0) {
          const chunk = await readAt(handle, position, Math.min(chunkSize, remaining));
          if (chunk.length === 0) throw new ProofGateError("bundle_truncated", "bundle ended inside an entry");
          entryHash.update(chunk);
          overall.update(chunk);
          await out.write(chunk);
          position += chunk.length;
          remaining -= chunk.length;
        }
        if (entryHash.digest("hex") !== entry.sha256) {
          throw new ProofGateError("bundle_corrupt", `entry ${entry.path} does not match its recorded hash`, { path: entry.path });
        }
      } finally {
        await out.close();
      }
    }
    const trailer = (await readAt(handle, position, TRAILER_LENGTH)).toString("utf8");
    const match = new RegExp(`^${TRAILER_PREFIX}([0-9a-f]{64})\\n$`).exec(trailer);
    if (!match) throw new ProofGateError("bundle_truncated", "bundle trailer is missing or damaged");
    if (match[1] !== overall.digest("hex")) throw new ProofGateError("bundle_corrupt", "bundle checksum does not match its contents");

    await writeFile(join(temp, "bundle.json"), `${JSON.stringify(header, null, 2)}\n`, { mode: 0o600 });
    // A report with no receipts (every requirement MISSING) has a bundle without a receipts entry; the restored tree
    // still needs an (empty) receipts directory to be re-evaluated and to be evaluable afterwards.
    await mkdir(join(temp, "receipts"), { recursive: true, mode: 0o700 });
    const report = await verifyRestored(temp, header, limits);

    if (finalDir === undefined) {
      await rm(temp, { recursive: true, force: true });
      return { header, report };
    }
    await ensurePrivateDir(dirname(finalDir));
    await rename(temp, finalDir);
    return { header, report, outputDir: finalDir };
  } catch (error) {
    await removeQuietly(temp);
    if (error instanceof ProofGateError) throw error;
    // Two restores to the same target: the loser must say the target exists, not blame the bundle.
    if (isTargetTaken(error)) throw new ProofGateError("bundle_target_exists", "the restore target already exists; choose a new path");
    // A full disk, a read-only target or a missing permission says nothing about the bundle: do not blame it (bundle_corrupt).
    if (isNoSpace(error)) throw new ProofGateError("output_unwritable", "the disk or quota is full while restoring; free space and run the restore again (nothing was kept)");
    const mapped = asOutputError(error, finalDir === undefined ? "the verification copy" : "the restored files");
    if (mapped instanceof ProofGateError) throw mapped;
    throw new ProofGateError("bundle_corrupt", `bundle could not be read: ${(error as Error).message}`);
  } finally {
    untrackTemp(temp);
    await handle.close();
  }
}

/** Semantic checks on the extracted tree: header agrees with the report, and the report re-derives from the restored inputs. */
/** The role an entry must have, from its path (the header repeats it; a re-sealed bundle could swap it). undefined: a path with no fixed role. */
function roleForPath(path: string): (typeof ROLES)[number] | undefined {
  if (path === "report/report.json" || path === "report/report.sha256") return "report";
  if (path === "manifest.json") return "manifest";
  if (path === "revisions.json") return "revisions";
  if (path.startsWith("receipts/")) return path.endsWith(".receipt.json") ? "receipt" : "artifact";
  return undefined;
}

async function verifyRestored(dir: string, header: BundleHeader, limits: Limits): Promise<Report> {
  const wrongRole = header.entries.find((entry) => {
    const expected = roleForPath(entry.path);
    return expected !== undefined && expected !== entry.role;
  });
  if (wrongRole !== undefined) {
    throw new ProofGateError("bundle_entry_invalid", `entry ${wrongRole.path} is recorded with the role "${wrongRole.role}" but its path says "${roleForPath(wrongRole.path)}"`, { path: wrongRole.path });
  }
  const { report } = await readReport(join(dir, "report"));
  const mismatched = (
    [
      ["assessment_id", header.assessment_id, report.assessment_id],
      ["manifest_hash", header.manifest_hash, report.manifest_hash],
      ["policy_hash", header.policy_hash, report.policy_hash],
      ["revisions_hash", header.revisions_hash, report.revisions_hash],
      ["receipts_hash", header.receipts_hash, report.receipts_hash],
      ["report_content_hash", header.report_content_hash, reportContentHash(report)],
      ["created_at", header.created_at, report.evaluated_at],
      // The header repeats the revision set for readers who do not open the report; a re-sealed bundle could change it alone.
      ["revisions", canonicalize(header.revisions), canonicalize(report.revisions)],
    ] as const
  ).filter(([, a, b]) => a !== b);
  if (mismatched.length > 0) {
    throw new ProofGateError("bundle_reevaluation_mismatch", `bundle header disagrees with its report: ${mismatched.map((m) => m[0]).join(", ")}`);
  }
  const inputs = await loadInputs(
    { manifestPath: join(dir, "manifest.json"), receiptsDir: join(dir, "receipts"), revisionsPath: join(dir, "revisions.json"), manifestFormat: "json" },
    limits,
  );
  const again = assess({
    manifest: inputs.manifest,
    revisions: inputs.revisions,
    receipts: inputs.receiptSet.receipts,
    now: new Date(report.evaluated_at),
    inputSummary: summarizeInputs(inputs),
  });
  if (comparable(again) !== comparable(report)) {
    if (report.engine.policy_version !== again.engine.policy_version) {
      // Not damage and not forgery: the decision rules changed between the writing build and this one, so the same inputs
      // legitimately give a different policy hash. Say so instead of telling the operator the backup is bad.
      throw new ProofGateError(
        "bundle_reevaluation_mismatch",
        `the bundle was written under policy engine version ${report.engine.policy_version} (ProofGate ${report.engine.version}); this build evaluates under version ${again.engine.policy_version}, so its re-evaluation cannot reproduce the report. The bundle is not known to be damaged: verify it with the ProofGate version that wrote it`,
        { written_policy_version: report.engine.policy_version, current_policy_version: again.engine.policy_version },
      );
    }
    throw new ProofGateError("bundle_reevaluation_mismatch", "re-evaluating the restored inputs does not reproduce the bundled report");
  }
  return report;
}
