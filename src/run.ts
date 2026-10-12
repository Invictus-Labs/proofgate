/**
 * The command implementation (`main`), free of process-level side effects so tests and embedders can import it. The
 * executable itself is `src/cli.ts`, which does nothing but run `main` unconditionally: an earlier version decided at import
 * time whether it "was the entry point" by comparing file paths, and `node dist/cli evaluate ...` (no `.js`) silently ran
 * nothing and exited 0.
 */
import { parseArgs } from "node:util";
import { exportBundle, restoreBundle } from "./bundle.js";
import { resolveClock } from "./clock.js";
import { refuseWhenStartedAsMain } from "./entry-guard.js";
import { ProofGateError, isProofGateError } from "./errors.js";
import { explainRequirement, findDecision } from "./explain.js";
import { evaluatePaths } from "./pipeline.js";
import { redactString } from "./redact.js";
import { readReport, serializeReport } from "./report.js";
import type { Report } from "./schemas.js";
import { escapeJsonForTerminal, neutralize as t } from "./terminal.js";
import { PROOFGATE_VERSION } from "./version.js";
import { renderReportHtml } from "./web/render.js";

// This module defines the commands; `dist/cli.js` runs them. Started as the main script it would do nothing and exit 0.
refuseWhenStartedAsMain(import.meta.url, "dist/run.js");

export interface CliIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Replaces the bundled HTML renderer (used by tests and embedders). */
  renderer?: (report: Report) => string;
}

const USAGE = `proofgate ${PROOFGATE_VERSION}

Usage:
  proofgate evaluate --manifest <requirements.yaml> --receipts <dir> --revisions <revisions.json>
                     [--output <report-dir>] [--replace] [--now <UTC ISO time>]
                     [--max-blob-bytes <n>] [--json]
  proofgate explain <REQ-ID> --report <report.json|report-dir> [--json]
  proofgate bundle export --report <report-dir> --manifest <file> --receipts <dir> --revisions <file>
                          --output <bundle-file> [--max-blob-bytes <n>] [--allow-secret-artifacts]
  proofgate bundle verify <bundle-file> [--max-blob-bytes <n>]
  proofgate bundle restore <bundle-file> --output <dir> [--max-blob-bytes <n>]
  proofgate connector <name> <operation>        (live connectors are not implemented; always exits 2)
  proofgate --version | --help

Exit codes: 0 every mandatory requirement PASS; 1 policy unsatisfied; 2 malformed input or internal error.
The evaluation clock can be fixed with --now or PROOFGATE_NOW for reproducible results.
`;

class UsageError extends ProofGateError {
  constructor(message: string) {
    super("cli_usage", message);
  }
}

function parseLimit(value: string | undefined): { maxBlobBytes?: number } {
  if (value === undefined) return {};
  if (!/^\d{1,15}$/.test(value) || Number(value) < 1) throw new UsageError("--max-blob-bytes must be a positive integer");
  return { maxBlobBytes: Number(value) };
}

function need(values: Record<string, unknown>, name: string): string {
  const v = values[name];
  if (typeof v !== "string" || v === "") throw new UsageError(`--${name} is required`);
  return v;
}

/**
 * Plain-text summary of an assessment. Every string that came from a document is neutralised (see src/terminal.ts),
 * so a hostile title or id can neither inject terminal escapes nor forge a line such as `verdict: ACCEPTED`.
 * Columns are sized to the longest id and status so they line up whatever the ids are.
 */
export function formatEvaluation(report: Report, outputDir: string | undefined): string {
  const lines = [
    `ProofGate assessment ${t(report.assessment_id)}`,
    `evaluated at ${t(report.evaluated_at)}; manifest ${t(report.manifest_hash.slice(0, 12))}, policy ${t(report.policy_hash.slice(0, 12))}`,
    `verdict: ${t(report.verdict.toUpperCase())} (exit ${t(report.exit_code)})`,
  ];
  const rows = report.requirements.map((d) => ({ id: t(d.id), status: t(d.status), severity: t(d.severity), title: t(d.title), reasons: d.reason_codes.map(t) }));
  const idWidth = rows.reduce((w, r) => Math.max(w, r.id.length), 0);
  const statusWidth = rows.reduce((w, r) => Math.max(w, r.status.length), 0);
  const severityWidth = rows.reduce((w, r) => Math.max(w, r.severity.length), 0);
  for (const r of rows) {
    lines.push(`  ${r.id.padEnd(idWidth)}  ${r.status.padEnd(statusWidth)}  ${r.severity.padEnd(severityWidth)}  ${r.title}${r.reasons.length > 0 ? `  [${r.reasons.join(", ")}]` : ""}`);
  }
  const s = report.summary;
  lines.push(`mandatory: ${s.mandatory_passed}/${s.mandatory_requirements} passed`);
  if (report.supersedes !== null) {
    lines.push(`supersedes ${t(report.supersedes.assessment_id)}${report.supersedes.policy_changed ? " (policy changed)" : ""}`);
  }
  if (outputDir !== undefined) lines.push(`report written to ${t(outputDir)}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Every option takes exactly one value. `--receipts A --receipts B` used to evaluate only B and report PASS even when A held
 * a failing receipt: evidence dropped without a word. Repeats and empty values are usage errors. (`--now` is checked by the
 * clock, which gives an empty value its own stable code.)
 */
function checkOptionTokens(tokens: ReadonlyArray<{ kind: string; name?: string; value?: string | undefined }> | undefined): void {
  const seen = new Set<string>();
  for (const token of tokens ?? []) {
    if (token.kind !== "option" || token.name === undefined) continue;
    if (seen.has(token.name)) throw new UsageError(`--${token.name} was given more than once; each option takes exactly one value`);
    seen.add(token.name);
    if (token.name !== "now" && token.value === "") throw new UsageError(`--${token.name} must not be empty`);
  }
}

async function runEvaluate(args: string[], io: CliIo, env: Record<string, string | undefined>): Promise<number> {
  const { values, tokens } = parseArgs({
    args,
    strict: true,
    tokens: true,
    allowPositionals: false,
    options: {
      manifest: { type: "string" },
      receipts: { type: "string" },
      revisions: { type: "string" },
      output: { type: "string" },
      replace: { type: "boolean" },
      now: { type: "string" },
      "max-blob-bytes": { type: "string" },
      json: { type: "boolean" },
    },
  });
  checkOptionTokens(tokens);
  if (values.replace === true && values.output === undefined) {
    throw new UsageError("--replace only applies to an existing report directory; add --output <report-dir> (nothing is written without it)");
  }
  const clock = resolveClock(values.now, env, io.now);
  if (clock.source !== "system") {
    // A frozen clock judges the evidence against a time that is not "now"; say so, next to the (unchanged) stdout.
    io.stderr.write(
      `proofgate: note: the evaluation clock is fixed by ${clock.source === "flag" ? "--now" : "PROOFGATE_NOW"} (${clock.now.toISOString()}); the result is reproducible but not judged against the current time\n`,
    );
  }
  const output = values.output;
  // index.html is always produced by the bundled renderer (an embedder may inject another one).
  const renderHtml = output === undefined ? undefined : (io.renderer ?? renderReportHtml);
  const result = await evaluatePaths({
    manifestPath: need(values, "manifest"),
    receiptsDir: need(values, "receipts"),
    revisionsPath: need(values, "revisions"),
    now: clock.now,
    clockSource: clock.source,
    limits: parseLimit(values["max-blob-bytes"]),
    replace: values.replace === true,
    ...(output === undefined ? {} : { outputDir: output }),
    ...(renderHtml === undefined ? {} : { renderHtml }),
  });
  for (const note of result.notes) io.stderr.write(`${t(redactString(`proofgate: note: ${note}`))}\n`);
  if (output === undefined) {
    io.stderr.write("proofgate: note: no --output was given, so no report was written; only this summary was printed (add --output <dir> to keep report.json and index.html)\n");
  }
  io.stdout.write(values.json === true ? escapeJsonForTerminal(serializeReport(result.report)) : formatEvaluation(result.report, output));
  return result.exitCode;
}

async function runExplain(args: string[], io: CliIo): Promise<number> {
  const { values, positionals, tokens } = parseArgs({
    args,
    strict: true,
    tokens: true,
    allowPositionals: true,
    options: { report: { type: "string" }, json: { type: "boolean" } },
  });
  checkOptionTokens(tokens);
  if (positionals.length !== 1) throw new UsageError("explain takes exactly one requirement id");
  const { report } = await readReport(need(values, "report"));
  const id = positionals[0] as string;
  io.stdout.write(values.json === true ? `${escapeJsonForTerminal(JSON.stringify(findDecision(report, id), null, 2))}\n` : explainRequirement(report, id));
  return 0;
}

async function runBundle(args: string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "export") {
    const { values, tokens } = parseArgs({
      args: rest,
      strict: true,
      tokens: true,
      allowPositionals: false,
      options: {
        report: { type: "string" },
        manifest: { type: "string" },
        receipts: { type: "string" },
        revisions: { type: "string" },
        output: { type: "string" },
        "max-blob-bytes": { type: "string" },
        "allow-secret-artifacts": { type: "boolean" },
      },
    });
    checkOptionTokens(tokens);
    const result = await exportBundle({
      reportPath: need(values, "report"),
      manifestPath: need(values, "manifest"),
      receiptsDir: need(values, "receipts"),
      revisionsPath: need(values, "revisions"),
      outputFile: need(values, "output"),
      limits: parseLimit(values["max-blob-bytes"]),
      allowSecretArtifacts: values["allow-secret-artifacts"] === true,
    });
    io.stdout.write(
      `bundle written: ${t(need(values, "output"))}\nassessment ${t(result.header.assessment_id)}; ${result.header.entries.length} entries; ${result.bundleBytes} bytes\n`,
    );
    return 0;
  }
  if (sub === "verify" || sub === "restore") {
    const { values, positionals, tokens } = parseArgs({
      args: rest,
      strict: true,
      tokens: true,
      allowPositionals: true,
      options: { output: { type: "string" }, "max-blob-bytes": { type: "string" } },
    });
    checkOptionTokens(tokens);
    if (positionals.length !== 1) throw new UsageError(`bundle ${sub} takes exactly one bundle file`);
    if (sub === "verify" && values.output !== undefined) throw new UsageError("bundle verify does not take --output; use bundle restore");
    const outputDir = sub === "restore" ? need(values, "output") : undefined;
    const result = await restoreBundle({
      bundleFile: positionals[0] as string,
      limits: parseLimit(values["max-blob-bytes"]),
      ...(outputDir === undefined ? {} : { outputDir }),
    });
    io.stdout.write(
      `bundle ${sub === "verify" ? "verified" : "restored"}: assessment ${t(result.header.assessment_id)}; ${result.header.entries.length} entries; verdict ${t(result.report.verdict)}\n`,
    );
    if (outputDir !== undefined) io.stdout.write(`restored to ${t(outputDir)}\n`);
    return 0;
  }
  throw new UsageError("bundle needs a subcommand: export, verify or restore");
}

/**
 * Live connector operations are not part of the MVP: connections are disabled by
 * default and nothing is ever written back. Asking for one fails explicitly with a
 * stable code instead of silently doing nothing or pretending to be connected.
 */
function runConnector(args: string[]): number {
  const [name, operation] = args;
  throw new ProofGateError(
    "connector_disconnected",
    `connector ${JSON.stringify(name ?? "")} cannot run ${JSON.stringify(operation ?? "")}: no live connector is configured or implemented (connections are disabled by default; the RunProof importer reads local files only)`,
  );
}

/** Run the CLI and return the process exit code. Never throws. */
export async function main(argv: string[], io: CliIo = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  const env = io.env ?? process.env;
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
      (command === undefined ? io.stderr : io.stdout).write(USAGE);
      return command === undefined ? 2 : 0;
    }
    if (command === "--version" || command === "-v" || command === "version") {
      io.stdout.write(`${PROOFGATE_VERSION}\n`);
      return 0;
    }
    try {
      switch (command) {
        case "evaluate":
          return await runEvaluate(rest, io, env);
        case "explain":
          return await runExplain(rest, io);
        case "bundle":
          return await runBundle(rest, io);
        case "connector":
          return runConnector(rest);
        default:
          throw new UsageError(`unknown command "${command}"`);
      }
    } catch (error) {
      // node:util parseArgs failures are usage errors.
      if (!isProofGateError(error) && (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
        throw new UsageError((error as Error).message);
      }
      throw error;
    }
  } catch (error) {
    const code = isProofGateError(error) ? error.code : "internal_error";
    const message = isProofGateError(error) ? error.message : `unexpected failure: ${(error as Error).message ?? String(error)}`;
    // Redact secrets first, then neutralise terminal control characters: file names, keys and titles inside messages are untrusted.
    // Only the MESSAGE is redacted: the fixed prefix carries the stable code, and a code such as `bundle_secret_detected` would
    // otherwise be read as a credential name and lose its first word.
    io.stderr.write(`proofgate: error [${code}]: ${t(redactString(message))}\n`);
    if (code === "cli_usage") io.stderr.write("Run `proofgate --help` for usage.\n");
    return 2;
  }
}

