import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { assess } from "./evaluate.js";
import { assertOutputSeparate, pathExists } from "./fsguard.js";
import { withLimits, type Limits } from "./limits.js";
import { parseManifestText, readInputFile, type LoadedManifest } from "./manifest.js";
import { loadReceiptSet, type ReceiptSet } from "./receipt.js";
import { REPORT_FILE, readReport, serializeReportWithinLimit, writeReportDirectory } from "./report.js";
import { checkRevisionsAgainstManifest, parseRevisionsText, type LoadedRevisions } from "./revisions.js";
import type { Report } from "./schemas.js";
import { ProofGateError } from "./errors.js";

export interface InputPaths {
  manifestPath: string;
  receiptsDir: string;
  revisionsPath: string;
  /** "json" only for the canonical manifest inside a restored evidence bundle; user manifests are YAML (which includes JSON). */
  manifestFormat?: "yaml" | "json";
}

export interface LoadedInputs {
  manifest: LoadedManifest;
  revisions: LoadedRevisions;
  receiptSet: ReceiptSet;
  metadataBytes: number;
}

/**
 * Load and validate all three inputs. Size and count limits are enforced before
 * any content is parsed; every failure is a ProofGateError (exit code 2).
 */
export async function loadInputs(paths: InputPaths, limitOverrides?: Partial<Limits>): Promise<LoadedInputs> {
  const limits = withLimits(limitOverrides);
  const manifestFormat = paths.manifestFormat ?? "yaml";
  const manifestFile = await readInputFile(paths.manifestPath, limits, "manifest_not_found", "the manifest", manifestFormat);
  const revisionsFile = await readInputFile(paths.revisionsPath, limits, "revisions_not_found", "the revisions");
  const used = manifestFile.bytes + revisionsFile.bytes;
  if (used > limits.maxMetadataBytes) {
    throw new ProofGateError("limit_metadata_bytes", `metadata is ${used} bytes, over the ${limits.maxMetadataBytes} byte limit`);
  }
  const manifest = parseManifestText(manifestFile.text, "manifest", limits.maxManifestBytes, manifestFormat);
  const revisions = parseRevisionsText(revisionsFile.text, "revisions");
  checkRevisionsAgainstManifest(revisions, manifest.manifest);
  const receiptSet = await loadReceiptSet(paths.receiptsDir, manifest.manifest, limits, used);
  return { manifest, revisions, receiptSet, metadataBytes: used + receiptSet.metadata_bytes };
}

export function summarizeInputs(inputs: LoadedInputs): Report["input_summary"] {
  return {
    files_scanned: inputs.receiptSet.files_scanned,
    receipt_documents: inputs.receiptSet.receipt_documents,
    metadata_bytes: inputs.metadataBytes,
    artifact_bytes: inputs.receiptSet.artifact_bytes,
  };
}

export interface EvaluateOptions extends InputPaths {
  outputDir?: string;
  /** Move an existing report at outputDir aside (never delete it) instead of failing. */
  replace?: boolean;
  now: Date;
  /** Where `now` came from (recorded in the report); defaults to "system". */
  clockSource?: Report["clock_source"];
  limits?: Partial<Limits>;
  /** Renders the static HTML report (index.html). The CLI always passes the bundled renderer. */
  renderHtml?: (report: Report) => string | Promise<string>;
}

export interface EvaluationResult {
  report: Report;
  exitCode: 0 | 1;
  outputDir?: string;
  /** Things the operator should know that do not change the verdict (for example receipt-looking files that were ignored). */
  notes: string[];
}

/** Full evaluation: load, decide, and (when an output directory is given) publish atomically. */
export async function evaluatePaths(options: EvaluateOptions): Promise<EvaluationResult> {
  let supersedes: Report["supersedes"] = null;
  let archiveSuffix: string | undefined;
  const finalPath = options.outputDir === undefined ? undefined : resolve(options.outputDir);
  if (options.outputDir !== undefined) {
    // Before anything is read or moved: the output may not be, contain or lie inside an input.
    await assertOutputSeparate(options.outputDir, [
      ["the receipts directory", options.receiptsDir],
      ["the manifest", options.manifestPath],
      ["the revisions file", options.revisionsPath],
    ]);
  }

  if (finalPath !== undefined && (await pathExists(finalPath))) {
    if (!options.replace) {
      throw new ProofGateError("output_exists", "the output directory already exists; choose a new path or pass --replace to archive it");
    }
    // --replace archives a PREVIOUS REPORT; it must never move an arbitrary directory that happens to be at the path.
    if (!(await pathExists(join(finalPath, REPORT_FILE)))) {
      throw new ProofGateError(
        "output_exists",
        "the output path exists but is not a ProofGate report directory (it has no report.json); --replace only archives a previous report, so nothing was moved",
      );
    }
    try {
      const prior = (await readReport(finalPath)).report;
      supersedes = { assessment_id: prior.assessment_id, manifest_hash: prior.manifest_hash, policy_hash: prior.policy_hash, policy_changed: false };
      archiveSuffix = prior.assessment_id;
    } catch (error) {
      if (!(error instanceof ProofGateError)) throw error;
      archiveSuffix = `unreadable-${randomBytes(4).toString("hex")}`;
    }
  }

  const inputs = await loadInputs(options, options.limits);
  if (supersedes !== null) supersedes.policy_changed = supersedes.policy_hash !== inputs.manifest.policy_hash;

  const report = assess({
    manifest: inputs.manifest,
    revisions: inputs.revisions,
    receipts: inputs.receiptSet.receipts,
    now: options.now,
    inputSummary: summarizeInputs(inputs),
    supersedes,
    ...(options.clockSource === undefined ? {} : { clockSource: options.clockSource }),
  });

  let published: string | undefined;
  if (finalPath !== undefined) {
    // Refuse a report that no reader could open BEFORE rendering the (larger) HTML page or writing anything.
    const json = serializeReportWithinLimit(report);
    const html = options.renderHtml === undefined ? undefined : await options.renderHtml(report);
    published = await writeReportDirectory(finalPath, report, {
      replace: options.replace === true,
      json,
      ...(html === undefined ? {} : { html }),
      ...(archiveSuffix === undefined ? {} : { archiveSuffix }),
    });
  }
  return { report, exitCode: report.exit_code, notes: inputs.receiptSet.notes, ...(published === undefined ? {} : { outputDir: published }) };
}
