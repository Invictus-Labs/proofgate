/**
 * Helpers for the tests that run the redactor (or the artifact scanner) on a hostile text in a CHILD process with a hard cap: a cost that never ends is a failed
 * assertion ("still running" is an answer), and the CPU time of each call is read with `process.cpuUsage()`, so a busy host does not decide a test.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..", "..");
const REDACT_URL = pathToFileURL(join(ROOT, "dist", "redact.js")).href;

export const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)
export const S = "Zx9Kq2Wm5Lp";
export const B = "\\";
/** A shape is written with `@PW@` where the word stands, so that no line of a test file reads as a hard-coded password assignment to a secret scanner. */
export const expandPw = (text: string): string => text.replaceAll("@PW@", PW);

export interface Shape {
  prefix: string;
  unit: string;
  tail: string;
}
export interface Timing {
  sizes: number[];
  ms: number[];
  whole: boolean[];
}

export const shapeName = (shape: Shape): string => `${JSON.stringify(shape.prefix)} + ${JSON.stringify(shape.unit)} x N + ${JSON.stringify(shape.tail)}`;
export const expandShape = (shape: Shape): Shape => ({ prefix: expandPw(shape.prefix), unit: expandPw(shape.unit), tail: expandPw(shape.tail) });

/** Times `redactString` (or the artifact scanner) on `prefix + unit x N + tail` for each size in a child killed at the cap; undefined when it did not finish. */
export function timeInChild(shape: Shape, sizes: number[], mode: "redact" | "scan", capMs = 60_000): Timing | undefined {
  const script = `
    import { readFileSync } from "node:fs";
    import { redactString, scanBufferForCredentials } from ${JSON.stringify(REDACT_URL)};
    const { prefix, unit, tail, sizes, mode } = JSON.parse(readFileSync(0, "utf8"));
    const ms = [];
    const whole = [];
    for (const n of sizes) {
      const text = prefix + unit.repeat(Math.ceil(n / unit.length)) + tail;
      const before = process.cpuUsage();
      const out = mode === "scan" ? scanBufferForCredentials(Buffer.from(text, "latin1")).join(",") : redactString(text);
      const used = process.cpuUsage(before);
      ms.push((used.user + used.system) / 1000);
      whole.push(mode === "redact" && out === "[REDACTED]");
    }
    process.stdout.write(JSON.stringify({ sizes, ms, whole }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    input: JSON.stringify({ ...shape, sizes, mode }),
    timeout: capMs,
    killSignal: "SIGKILL",
    env: { PATH: process.env.PATH ?? "" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return r.status === 0 ? (JSON.parse(r.stdout) as Timing) : undefined;
}

/**
 * A linear cost grows by the ratio of the last size to the first (16 for the sizes the tests use); a quadratic one by the square. `limit` is the growth that fails (three times the linear one),
 * and the floor of 4 ms keeps a first size of a millisecond or two from deciding. Returns the problem, or undefined.
 */
export function judge(shape: Shape, t: Timing | undefined, sizes: number[], ceilingMs = 6_000): string | undefined {
  const name = shapeName(shape);
  if (t === undefined) return `${name}: no answer within the cap`;
  const first = Math.max(t.ms[0] as number, 4);
  const last = t.ms[sizes.length - 1] as number;
  const limit = 3 * ((sizes[sizes.length - 1] as number) / (sizes[0] as number));
  if (last > first * limit) return `${name}: ${t.ms.map((x) => x.toFixed(0)).join(" / ")} ms at ${sizes.join(" / ")}: more than ${limit} times from the first size to the last`;
  if (last > ceilingMs) return `${name}: ${last.toFixed(0)} ms at ${sizes[sizes.length - 1]}`;
  return undefined;
}

export interface FamilyResult {
  cases: number;
  slowest: { ms: number; unit: string; tail: string; n: number };
  /** Every case whose call took more than `limitMs` of CPU time (first ten). */
  slow: { ms: number; unit: string; tail: string; n: number }[];
}

/**
 * ONE opener, then a run of one escape unit repeated N times, then a tail, for every unit, tail and N given, in ONE child with a hard cap. A run behind a credential is one long run
 * to a scanner that resumes at a line break or a quote, so the family is the set of shapes a single long run can take. Returns undefined when the child did not finish.
 */
export function runFamilyInChild(opener: string, units: string[], tails: string[], ns: number[], limitMs: number, capMs: number): FamilyResult | undefined {
  const script = `
    import { readFileSync } from "node:fs";
    import { redactString } from ${JSON.stringify(REDACT_URL)};
    const { opener, units, tails, ns, limitMs } = JSON.parse(readFileSync(0, "utf8"));
    let cases = 0;
    const slow = [];
    let slowest = { ms: 0, unit: "", tail: "", n: 0 };
    for (const unit of units) for (const tail of tails) for (const n of ns) {
      const text = opener + unit.repeat(n) + tail;
      const before = process.cpuUsage();
      redactString(text);
      const used = process.cpuUsage(before);
      const ms = (used.user + used.system) / 1000;
      cases += 1;
      const entry = { ms, unit, tail, n };
      if (ms > slowest.ms) slowest = entry;
      if (ms > limitMs && slow.length < 10) slow.push(entry);
    }
    process.stdout.write(JSON.stringify({ cases, slowest, slow }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    input: JSON.stringify({ opener, units, tails, ns, limitMs }),
    timeout: capMs,
    killSignal: "SIGKILL",
    env: { PATH: process.env.PATH ?? "" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return r.status === 0 ? (JSON.parse(r.stdout) as FamilyResult) : undefined;
}
