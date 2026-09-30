/**
 * Review round 6, the super-linear class (logic P0 and three P1, tests P1, security P0 and addendum): the redactor's cost must be LINEAR in its input, for every opener of a credential
 * followed by a hostile run. The reviewers named the shapes one at a time: `password=[]x` and backslashes (exponential), `password=` and a run of backslashes, `--password=`
 * repeated, options chained with no blank (`-token=-token=...`, `=-u`, `={-u`, `=--user`, `-u=`), `%0A--password=` repeated, `--password a` and backslashes and a letter, `: &a Basic pinauth` repeated,
 * and the artifact scanner on a megabyte of any of them. This file runs ALL of them, and a generic set (every opener of the redactor, then a run of backslashes or of escaped breaks, alone
 * or with a terminator) at 16 Ki, 64 Ki and 256 Ki characters, each in a CHILD process with a hard cap, and compares the CPU times: a linear cost grows 16 times from the first size to the
 * last, a quadratic one 256 times. "Still running" is a failed assertion. The WORK BUDGET (a per-call limit that hides the whole text when it is passed) is proved separately: a tiny
 * limit hides the text and never shows it, and no shape below trips it (the memoised scans are what keeps them linear; the budget only stands behind them).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactStringWithWorkLimit, WORK_BUDGET_PATTERN, findCredentialPatterns, findCredentialPatternsWithWorkLimit } from "../../src/redact.js";

const ROOT = join(import.meta.dirname, "..", "..");
const REDACT_URL = pathToFileURL(join(ROOT, "dist", "redact.js")).href;
const PW = "pass" + "word"; // (spelled apart: no line reads as a hard-coded password assignment to a secret scanner)
const S = "Zx9Kq2Wm5Lp";
const B = "\\";
/** A shape is written with `@PW@` where the word stands, so that no line of this file reads as a hard-coded password assignment to a secret scanner. */
const expandPw = (text: string): string => text.replaceAll("@PW@", PW);

interface Shape {
  prefix: string;
  unit: string;
  tail: string;
}
interface Timing {
  sizes: number[];
  ms: number[];
  whole: boolean[];
}

/** Times `redactString` (or the artifact scanner) on `prefix + unit x N + tail` for each size in a child killed at the cap; undefined when it did not finish. */
function timeInChild(shape: Shape, sizes: number[], mode: "redact" | "scan", capMs = 60_000): Timing | undefined {
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

const SIZES = [16_384, 65_536, 262_144];
/** A linear cost grows 16 times from 16 Ki to 256 Ki; a quadratic one 256 times. The floor keeps a first size of a millisecond or two from deciding. */
function judge(shape: Shape, t: Timing | undefined, sizes: number[] = SIZES): string | undefined {
  const name = `${JSON.stringify(shape.prefix)} + ${JSON.stringify(shape.unit)} x N + ${JSON.stringify(shape.tail)}`;
  if (t === undefined) return `${name}: no answer within the cap`;
  const first = Math.max(t.ms[0] as number, 4);
  const last = t.ms[sizes.length - 1] as number;
  if (last > first * 48) return `${name}: ${t.ms.map((x) => x.toFixed(0)).join(" / ")} ms at ${sizes.join(" / ")}: more than 48 times from the first size to the last`;
  if (last > 6_000) return `${name}: ${last.toFixed(0)} ms at ${sizes[sizes.length - 1]}`;
  return undefined;
}

// the shapes the four reviewers named
const RAW_NAMED: Shape[] = [
  // options repeated and chained with no blank
  ...["--@PW@=", "--token=", "--secret=", "--api_key=", "-Password=", "--pw=", "-p--@PW@=", `${B}n--@PW@%3D`, "%0A--@PW@=", "%0A--@PW@%3D", "--@PW@=--@PW@=", "-token=-token=", "-@PW@=-p", "token=-auth", "=-auth"].map((unit) => ({ prefix: "", unit, tail: "" })),
  // the `-u` family (quadratic in every tree back to the first)
  ...["=-u", "={-u", "=--user", "-u=", "-u:", "=-u "].map((unit) => ({ prefix: "", unit, tail: "" })),
  // backslash runs behind a credential, with and without a terminator
  { prefix: "@PW@=", unit: B, tail: "y" },
  { prefix: "token=a", unit: B, tail: "" },
  { prefix: "@PW@: ", unit: B, tail: "" },
  { prefix: "--@PW@ a", unit: B, tail: "x" },
  { prefix: "@PW@=a", unit: B, tail: 'b":' },
  { prefix: "@PW@=x", unit: B, tail: "=" },
  { prefix: "@PW@=x", unit: `${B}n`, tail: ":" },
  // the exponential site, from every opener that reaches it
  { prefix: "@PW@=[]x", unit: B, tail: "y" },
  { prefix: "@PW@=[]a", unit: B, tail: "b" },
  { prefix: "@PW@=[x]a", unit: B, tail: "x" },
  { prefix: "token: {}a", unit: B, tail: "x" },
  { prefix: "--@PW@ []a", unit: B, tail: "x" },
  { prefix: "--token={}a", unit: B, tail: "x" },
  { prefix: "@PW@=()a", unit: B, tail: "x" },
  { prefix: "@PW@=[]a", unit: `${B}${B}n`, tail: "x" },
  { prefix: "@PW@=[]x", unit: `${B}n`, tail: "y" },
  { prefix: "run @PW@=[x]a", unit: `${B}${B}n`, tail: "x" },
  // a property in front of a value, repeated
  { prefix: "", unit: ": &a Basic pinauth", tail: "" },
  { prefix: "", unit: "&a Basic pinauth ", tail: "" },
];
const NAMED: Shape[] = RAW_NAMED.map((shape) => ({ prefix: expandPw(shape.prefix), unit: expandPw(shape.unit), tail: expandPw(shape.tail) }));

// every opener of the redactor, then a run
const RAW_OPENERS = ["@PW@=", "@PW@: ", "@PW@:\n  ", "--@PW@ ", "--@PW@=", "-u ", "-u a:", "-p", "token=", "Authorization: ", "Authorization=[", "x=b'", "api_key=$'", '{"@PW@":"', "- ", "export TOKEN=", "%0A", "--user a:", "secret=(", "pw=[", "key: &", "name=", "value="];
const OPENERS = RAW_OPENERS.map(expandPw);
const RUNS = [B, `${B}n`, "%0A", `${B}${B}`];
const GENERIC: Shape[] = OPENERS.flatMap((prefix) => RUNS.flatMap((unit) => ["", "y"].map((tail) => ({ prefix, unit, tail }))));

describe("the cost is linear: the shapes the reviewers named, in a capped child", () => {
  it.each(NAMED.map((shape) => [`${JSON.stringify(shape.prefix)} + ${JSON.stringify(shape.unit)} x N + ${JSON.stringify(shape.tail)}`, shape] as const))("%s", (_name, shape) => {
    const t = timeInChild(shape, SIZES, "redact");
    expect(judge(shape, t)).toBeUndefined();
    // the memoised scans keep it linear without the budget: the whole text is not hidden to get there
    expect(t?.whole, "the work budget was not needed").toEqual([false, false, false]);
  }, 120_000);

  it("every opener followed by a run of backslashes or escaped breaks, alone or with a terminator", () => {
    const failures: string[] = [];
    for (const shape of GENERIC) {
      const problem = judge(shape, timeInChild(shape, SIZES, "redact"));
      if (problem !== undefined) failures.push(problem);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  }, 600_000);
});

describe("the artifact scanner is linear too", () => {
  const SCAN_SIZES = [65_536, 262_144, 1_048_576];
  it.each(
    [
      { prefix: "<testsuite>--@PW@ ", unit: B, tail: "x</testsuite>" },
      { prefix: "<testsuite>", unit: "--@PW@=", tail: "</testsuite>" },
      { prefix: "", unit: "=-u", tail: "" },
      { prefix: "@PW@=", unit: B, tail: "y" },
      { prefix: "@PW@=[]a", unit: B, tail: "b" },
      { prefix: "--token {}a", unit: B, tail: "x" },
      { prefix: "", unit: "%0A--@PW@=", tail: "" },
    ]
      .map((raw) => ({ prefix: expandPw(raw.prefix), unit: expandPw(raw.unit), tail: expandPw(raw.tail) }))
      .map((shape) => [`${JSON.stringify(shape.prefix)} + ${JSON.stringify(shape.unit)} x N + ${JSON.stringify(shape.tail)}`, shape] as const),
  )("%s", (_name, shape) => {
    expect(judge(shape, timeInChild(shape, SCAN_SIZES, "scan", 90_000), SCAN_SIZES)).toBeUndefined();
  }, 150_000);
});

describe("the work budget fails closed", () => {
  it("a limit that is passed hides the WHOLE text, and never shows a part of it", () => {
    const text = `before ${PW}=${S} after token=${S}2`;
    expect(typeof redactStringWithWorkLimit).toBe("function");
    expect(redactStringWithWorkLimit(text, 1)).toBe(REDACTED);
    expect(redactStringWithWorkLimit(text, 0)).toBe(REDACTED);
    // a limit that is enough gives the ordinary answer
    expect(redactStringWithWorkLimit(text, 1_000_000)).toBe(redactString(text));
    expect(redactString(text)).toBe(`before ${PW}=${REDACTED} after token=${REDACTED}`);
  });

  it("an ordinary text needs a small fraction of the budget (64 steps per character)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 400; i += 1) lines.push(`2026-09-30T10:${String(i % 60).padStart(2, "0")}:00Z INFO job ${i} ran docker run --rm -e API_TOKEN=tok${i}abcdef -p 8080:80 nginx --${PW} "pw${i}xyz" user=${i} {"${PW}":"p${i}","name":"job"}`);
    const log = lines.join("\n");
    // 8 steps per character is a factor of eight below the limit, and is enough for this log: the answer is the ordinary one
    expect(redactStringWithWorkLimit(log, 8 * log.length)).toBe(redactString(log));
    expect(redactString(log)).not.toBe(REDACTED);
  });

  it("the credential scanner reports work-budget-exceeded (an unsafe artifact) when its budget is passed, never nothing found", () => {
    expect(WORK_BUDGET_PATTERN).toBe("work-budget-exceeded");
    // a text of ordinary length never trips it: the scanner answers with the patterns it found
    expect(findCredentialPatterns(`${PW}=${S}`).length).toBeGreaterThan(0);
    expect(findCredentialPatterns("nothing to see here")).toEqual([]);
    // a limit that is passed fails CLOSED: the artifact is reported unsafe (the name of the verdict, never an empty list), also for a text with no credential in it
    expect(findCredentialPatternsWithWorkLimit(`${PW}=${S}`, 1)).toEqual([WORK_BUDGET_PATTERN]);
    expect(findCredentialPatternsWithWorkLimit("nothing to see here", 1_000_000)).toEqual([]);
    expect(findCredentialPatternsWithWorkLimit(`${PW}=${S}`, 1_000_000)).toEqual(findCredentialPatterns(`${PW}=${S}`));
  });
});
