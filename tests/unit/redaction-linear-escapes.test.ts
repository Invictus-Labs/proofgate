/**
 * Review round 6 (logic P0): `proofgate evaluate` hung on a short receipt string. The redactor's word-end check for a bracketed value,
 * `text.slice(end, tail).replace(/(?:\\+[nr]?|%0[AaDd])+$/, "")`, is the `(a+)+$` shape: `password=[]x` followed by N backslashes and a letter took 9 ms at
 * N=16, 97 ms at 20, 1,377 ms at 24 (14 times more for every 4 characters) and was still running after 20 s at N=40, as a receipt's `command` or as the flag form
 * `--password []x`. The same review suspected the other trailing-backslash strips (quadratic: `/\\+$/` retries at every backslash of a run) and a
 * regex test on a growing slice in the `-u` branch; a hostile-run audit of the whole redactor then found the sticky line-break, blank and indent matchers
 * (`\\+n`, `\\+t`) quadratic on a long run of backslashes too (3.9 s for 32,000 of them behind `password=`).
 *
 * Every check runs in a CHILD process with a hard wall clock and treats "still running" as a failed assertion (a synchronous hang cannot time out from inside
 * its own process).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const REDACT_URL = pathToFileURL(join(ROOT, "dist", "redact.js")).href;
const S = "Zx9Kq2Wm5Lp";
const SIZES = [20, 40, 200, 5_000, 100_000, 400_000];
const CAP_MS = 8_000;

/** Redacts one string in a child killed at the cap; undefined when it did not finish. */
function redactIsolated(input: string): string | undefined {
  // the text goes in on standard input: a megabyte of it does not fit in the environment of a child process
  const script = `import { readFileSync } from "node:fs"; import { redactString } from ${JSON.stringify(REDACT_URL)}; process.stdout.write(JSON.stringify(redactString(readFileSync(0, "utf8"))));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    timeout: CAP_MS,
    killSignal: "SIGKILL",
    env: { PATH: process.env.PATH ?? "" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? (JSON.parse(r.stdout) as string) : undefined;
}

const bs = (n: number): string => "\\".repeat(n);
const SHAPES: Array<[string, (n: number) => string, boolean]> = [
  // [name, builder, the secret S is in the text and must not survive]
  ["assignment: a bracket, then backslashes and a letter (the reproduction)", (n) => `password=[]${S}${bs(n)}y`, true],
  ["option: a bracket after a blank, then backslashes and a letter", (n) => `--password []${S}${bs(n)}y`, true],
  ["option with an equals sign", (n) => `--password=[]${S}${bs(n)}y`, true],
  ["a receipt command (JSON)", (n) => JSON.stringify({ command: `login password=[]${S}${bs(n)}y` }), true],
  ["assignment: a bracket, then escaped line breaks written as text", (n) => `password=[]${S}${"\\n".repeat(n)}y`, true],
  ["assignment: a bracket, then escaped carriage returns and line feeds", (n) => `token=[]${S}${"\\r\\n".repeat(n)}y`, true],
  ["assignment: a bracket, then percent-written line breaks", (n) => `token=[]${S}${"%0A".repeat(n)}y`, true],
  ["assignment: backslashes right after the separator", (n) => `password=${bs(n)}y`, false],
  ["assignment: backslashes, a letter and a quoted key", (n) => `token=${bs(n)}y":x`, false],
  ["YAML: a property, then backslashes", (n) => `password: &a${bs(n)}`, false],
  ["option: a word of backslashes", (n) => `--password ${bs(n)}y`, false],
  ["option: a bracket, then backslashes and a quote", (n) => `--password []${S}${bs(n)}"`, true],
  ["-u: a value with many quote marks in it", (n) => `-u ${'a"'.repeat(n)}`, false],
  ["two long runs of backslashes around an `r` (an escaped carriage return and line feed)", (n) => `password=x${bs(n)}r${bs(n)}y`, false],
  ["two long runs of backslashes around an `r` and an `n`", (n) => `password=${S}${bs(n)}r${bs(n)}n`, true],
  ["text-written blanks", (n) => `password=${"\\t".repeat(n)}y`, false],
  ["a run of backslashes and escaped line breaks in the middle of a value", (n) => `password=${S}${bs(n)}n${bs(n)}y`, true],
];

describe("termination: hostile runs of backslashes and escapes end in bounded time at every size", () => {
  it.each(SHAPES)("%s", (_name, build, mustHide) => {
    const failures: string[] = [];
    for (const n of SIZES) {
      const input = build(n);
      const out = redactIsolated(input);
      if (out === undefined) {
        failures.push(`no answer within ${CAP_MS} ms at N=${n} (${input.length} characters)`);
        break;
      }
      if (mustHide && out.includes(S)) failures.push(`the secret survived at N=${n}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
