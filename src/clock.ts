import { ProofGateError } from "./errors.js";
import { isUtcTimestamp } from "./schemas.js";
import { neutralize } from "./terminal.js";

export const NOW_ENV = "PROOFGATE_NOW";

/** Where the evaluation instant came from; recorded in the report so a frozen clock is never invisible. */
export type ClockSource = "flag" | "env" | "system";

export interface Clock {
  now: Date;
  source: ClockSource;
}

/**
 * Resolve the evaluation instant and where it came from. Precedence: explicit value (`--now`), then the
 * PROOFGATE_NOW environment variable, then the system clock. A fixed value makes every result and hash reproducible,
 * but it also means the evidence is judged against a time that is not "now", so the source is reported.
 *
 * An explicit `--now` must be a strict UTC timestamp: an empty value is an error, not a silent fallback to the system
 * clock. The same holds for PROOFGATE_NOW: set but empty is an error, not "unset" (a shell that exports an empty variable
 * would otherwise silently judge against the wrong time source).
 */
export function resolveClock(explicit?: string, env: Record<string, string | undefined> = process.env, system: () => Date = () => new Date()): Clock {
  if (explicit !== undefined) return { now: parseFixed(explicit, "--now"), source: "flag" };
  const fromEnv = env[NOW_ENV];
  if (fromEnv !== undefined) return { now: parseFixed(fromEnv, NOW_ENV), source: "env" };
  return { now: system(), source: "system" };
}

function parseFixed(raw: string, name: string): Date {
  if (!isUtcTimestamp(raw)) {
    throw new ProofGateError("clock_invalid", `${name} must be a UTC timestamp like 2026-09-29T00:00:00Z, got "${neutralize(raw)}"`);
  }
  return new Date(raw);
}

/** Back-compatible helper: the instant only. */
export function resolveNow(explicit?: string, env: Record<string, string | undefined> = process.env, system: () => Date = () => new Date()): Date {
  return resolveClock(explicit, env, system).now;
}
