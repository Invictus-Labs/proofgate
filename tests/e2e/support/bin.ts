import { execFile } from "node:child_process";
import { join } from "node:path";
import { readPackInfo } from "./pack.js";

/** A process that could not be started or was killed is never reported as exit status 1, which means "policy unsatisfied". */
const SPAWN_FAILED = -1;
/** The longest any one packaged command may run in the E2E suite (the slowest legitimate one takes seconds). */
const EXEC_TIMEOUT_MS = 120_000;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Every command the suite runs, kept so a final test can scan all logs for planted secrets and personal paths. */
export const transcript: Array<{ args: string[]; code: number; stdout: string; stderr: string }> = [];

function exec(file: string, args: string[], cwd: string | undefined, env: Record<string, string>, timeoutMs: number = EXEC_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    // A hang in the packaged command (a spinning redactor) ends at the time limit: SIGKILL, reported as a spawn failure, never as a pass.
    execFile(file, args, { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : SPAWN_FAILED;
      resolve({ code, stdout, stderr });
    });
  });
}

/** Run the installed `proofgate` executable (node_modules/.bin/proofgate of the packed tarball) with a scrubbed environment. */
export async function runBin(args: string[], options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<RunResult> {
  const info = readPackInfo();
  const result = await exec(info.bin, args, options.cwd, { PATH: process.env.PATH ?? "", ...options.env }, options.timeoutMs);
  transcript.push({ args, ...result });
  return result;
}

/** Run the installed package's dist/cli.js directly under `node`, for Node flags such as --import. */
export async function runInstalledNode(nodeArgs: string[], args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Promise<RunResult> {
  const info = readPackInfo();
  const result = await exec(process.execPath, [...nodeArgs, join(info.packageDir, "dist", "cli.js"), ...args], options.cwd, { PATH: process.env.PATH ?? "", ...options.env });
  transcript.push({ args, ...result });
  return result;
}

export function evalArgs(ws: { manifestPath: string; receiptsDir: string; revisionsPath: string; outputDir: string }, extra: string[] = []): string[] {
  return ["evaluate", "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", ws.outputDir, ...extra];
}

export function errorCodeOf(result: RunResult): string | undefined {
  return /proofgate: error \[([a-z_]+)\]/.exec(result.stderr)?.[1];
}
