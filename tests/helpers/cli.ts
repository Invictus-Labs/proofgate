import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { main } from "../../src/run.js";

/** A process that could not be started or was killed is never reported as exit status 1, which means "policy unsatisfied". */
const SPAWN_FAILED = -1;

const execFileAsync = promisify(execFile);
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DIST_CLI = join(ROOT, "dist", "cli.js");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI in-process with captured output. */
export async function runCli(args: string[], env: Record<string, string | undefined> = {}): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    stdout: { write: (c: string) => (stdout += c) },
    stderr: { write: (c: string) => (stderr += c) },
    env,
  });
  return { code, stdout, stderr };
}

/** Run the packaged executable (dist/cli.js) in a subprocess with a scrubbed environment. */
export async function runDist(args: string[], options: { cwd?: string; env?: Record<string, string>; nodeArgs?: string[]; timeoutMs?: number } = {}): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [...(options.nodeArgs ?? []), DIST_CLI, ...args], {
      cwd: options.cwd,
      env: { PATH: process.env.PATH ?? "", ...options.env },
      maxBuffer: 64 * 1024 * 1024,
      // a run that hits the cap is killed and reported as -1 (never as a policy result)
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs, killSignal: "SIGKILL" as const }),
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : SPAWN_FAILED, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

export function evalArgs(ws: { manifestPath: string; receiptsDir: string; revisionsPath: string; outputDir: string }, extra: string[] = []): string[] {
  return ["evaluate", "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", ws.outputDir, ...extra];
}

export function errorCode(result: CliResult): string | undefined {
  return /error \[([a-z_]+)\]/.exec(result.stderr)?.[1];
}
