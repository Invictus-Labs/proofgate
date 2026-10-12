// The kill rule shared by scripts/mutation-controls.mjs and scripts/e2e-mutation-controls.mjs.
//
// A mutant is KILLED only when the suite ran, went red and at least ONE TEST FAILED BY ASSERTION. Everything else that turns a run
// red proves nothing about the tests and is SUSPECT, which counts as a control that did not bite:
//   - a mutant that no longer compiles, a syntax error, a module that throws while it loads, a pack or build failure;
//   - a run in which every failing test TIMED OUT (a hang, a slow host) or hit an unexpected runtime error (a TypeError, a
//     ReferenceError: the mutant broke the code path, the test did not check a decision);
//   - a run that was killed (the wall-clock cap, a signal) or that wrote no result file.
// The decision is read from the test runner's own machine-readable result (vitest's JSON reporter, playwright's JSON reporter),
// never from text on stdout: a mutant can print anything, including a line that looks like a summary ("Tests  3 failed").
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text) {
  return text.replace(ANSI, "");
}

/**
 * The header of Playwright's own assertion message: `expect(received).toBe(expected) // Object.is equality`, `expect(locator).toHaveText(expected)`,
 * `expect(page).toHaveURL(expected)`, `expect(received).not.toBe(expected)`. A thrown message that merely starts with "expect(" (`expect(page) was never reached`) has no matcher.
 */
const PLAYWRIGHT_HEADER = /^expect\((?:received|locator|page|response|[A-Za-z_$][\w$.]*)\)\.(?:not\.)?(?:resolves\.|rejects\.)?to[A-Za-z]+\(/;
/** The first stack frame of a failed `rejects` / `resolves` assertion: vitest's own `_Assertion.__VITEST_REJECTS__` (or `__VITEST_RESOLVES__`) in its own package. A message that only NAMES that frame (no path into vitest's dist) is not one. */
const VITEST_CHAIN_FRAME = /^\s+at _Assertion\.__VITEST_(?:REJECTS|RESOLVES)__ \((?:file:\/\/)?[^)\n]*\/node_modules\/vitest\/dist\//;
/** The block that follows a Playwright assertion header: what was expected and received, or the locator. */
const PLAYWRIGHT_BLOCK = /^\s*[-+]?\s*(?:Expected|Received|Locator)\b/m;

/**
 * How one failing test failed: "assertion" (an expectation was false), "timeout", or "error" (anything else).
 *
 * An assertion is recognised by the STRUCTURE of the runner's message, and only at the START of it (the first line, or, for Playwright, the header that follows its label):
 * an Error that a helper throws can hold any word on any LINE of its message (`throw new Error("helper failed\nAssertionError: x")`, `"bad\nExpected: 1\nReceived: 2"`,
 * `"expect(page) was never reached"`), and none of those is a failed expectation.
 *   - vitest, chai and node:assert: the message starts with `AssertionError`; `Error: promise resolved ... instead of rejecting` and `Error: Snapshot ... mismatched` are vitest's own first lines;
 *     a failed `rejects` / `resolves` assertion starts with `Error: expected ...` and is recognised by vitest's own first stack frame (`at _Assertion.__VITEST_REJECTS__ (.../node_modules/vitest/dist/...)`);
 *   - Playwright: the message is `expect(received).toBe(expected) ...` followed by its Expected / Received / Locator block, or a label (one line or several, `Error: label`),
 *     a blank line, and then that header and block.
 * A timeout is read anywhere in the message; `expect.poll` and `vi.waitFor` give up with a message that says so, and that is SUSPECT, never a kill. vitest's `expect.poll` and `resolves`
 * failures start with `Error:` and read as errors (SUSPECT, the safe direction).
 */
export function classifyFailure(message) {
  const text = stripAnsi(String(message ?? "")).replace(/\r/g, "");
  if (/timed out in \d+ms|Test timeout of \d+ms exceeded|Hook timed out|Timeout of \d+ms exceeded|Timed out in waitFor|while waiting on the predicate/i.test(text)) return "timeout";
  const lines = text.split("\n");
  const first = lines.find((line) => line.trim() !== "") ?? "";
  if (/^AssertionError\b/.test(first)) return "assertion";
  if (/^(?:Error: )?promise (?:resolved|rejected) .{0,300} instead of (?:rejecting|resolving)/.test(first)) return "assertion";
  if (/^(?:Error: )?Snapshot .{1,120} mismatched/.test(first)) return "assertion";
  // `await expect(p).rejects.toMatchObject(...)` and `.resolves...` fail with a plain `Error: expected ... to match object ...` (no AssertionError header): vitest's own FIRST stack frame says so
  if (/^Error: /.test(first) && VITEST_CHAIN_FRAME.test(lines.find((line) => /^\s+at /.test(line)) ?? "")) return "assertion";
  // Playwright: the header is the first line (after `Error: `), or the first line after the label block (a label, then a blank line)
  let header = -1;
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start >= 0 && PLAYWRIGHT_HEADER.test(lines[start].replace(/^Error: /, ""))) header = start;
  else if (start >= 0 && /^Error: /.test(lines[start])) {
    const blank = lines.findIndex((line, i) => i > start && line.trim() === "");
    if (blank >= 0) {
      const next = lines.findIndex((line, i) => i > blank && line.trim() !== "");
      if (next >= 0 && PLAYWRIGHT_HEADER.test(lines[next])) header = next;
    }
  }
  if (header >= 0 && PLAYWRIGHT_BLOCK.test(lines.slice(header + 1).join("\n"))) return "assertion";
  return "error";
}

const EMPTY = { failed: 0, assertions: 0, timeouts: 0, errors: 0, suiteErrors: 0, firstFailure: undefined };

/** Read vitest's `--reporter=json` result; undefined when the text is not that report. */
export function parseVitestJson(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (report === null || typeof report !== "object" || !Array.isArray(report.testResults)) return undefined;
  const out = { ...EMPTY };
  for (const file of report.testResults) {
    const tests = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    if (tests.length === 0 && file.status === "failed") out.suiteErrors += 1;
    for (const test of tests) {
      if (test.status !== "failed") continue;
      out.failed += 1;
      const kind = classifyFailure((test.failureMessages ?? []).join("\n"));
      if (kind === "assertion") {
        out.assertions += 1;
        out.firstFailure ??= `${String(file.name ?? "").replace(/^.*\/tests\//, "tests/")} > ${test.fullName ?? test.title}`.slice(0, 220);
      } else if (kind === "timeout") out.timeouts += 1;
      else out.errors += 1;
    }
  }
  return out;
}

/** Read playwright's `--reporter=json` result; undefined when the text is not that report. */
export function parsePlaywrightJson(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (report === null || typeof report !== "object" || !Array.isArray(report.suites)) return undefined;
  const out = { ...EMPTY };
  out.suiteErrors = Array.isArray(report.errors) ? report.errors.length : 0;
  const visit = (suite, path) => {
    for (const child of suite.suites ?? []) visit(child, [...path, child.title]);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status === "passed" || result.status === "skipped") continue;
          out.failed += 1;
          const message = [result.error?.message, ...(result.errors ?? []).map((e) => e.message)].join("\n");
          const kind = result.status === "timedOut" ? "timeout" : classifyFailure(message);
          if (kind === "assertion") {
            out.assertions += 1;
            out.firstFailure ??= [...path, spec.title].filter(Boolean).join(" > ").slice(0, 220);
          } else if (kind === "timeout") out.timeouts += 1;
          else out.errors += 1;
        }
      }
    }
  };
  for (const suite of report.suites) visit(suite, [suite.title]);
  return out;
}

/** Read a result file with the given parser; undefined when there is none or it is not the runner's own JSON. */
export function readResult(path, parser) {
  try {
    return parser(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Run a command with a wall-clock cap. The command gets its own process group, so on the cap the whole tree is killed (a mutant
 * that loops forever in a worker would otherwise outlive the wrapper). A run that hit the cap has `timedOut: true` and `code: null`.
 */
export function runWithCap(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const collect = (data) => {
      if (output.length < 4_000_000) output += data;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, timedOut, output: stripAnsi(output) });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        // a process forked while the first kill was being delivered is in the group too: the second kill takes it
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // nothing of the group is left
        }
      }
      resolve({ code: timedOut ? null : code, signal, timedOut, output: stripAnsi(output) });
    });
  });
}

/**
 * @param {{ code: number | null, parsed?: typeof EMPTY }} result `parsed` is the runner's own result; absent when there was none.
 * @returns {"KILLED" | "SURVIVED" | "SUSPECT"}
 */
export function classify({ code, parsed }) {
  if (code === 0) return "SURVIVED";
  if (code === null || parsed === undefined) return "SUSPECT";
  return parsed.assertions > 0 ? "KILLED" : "SUSPECT";
}

/** A mutant entry as { name, file, find, replace }: main entries are [name, file, find, replace], end-to-end entries carry the suite second. */
export function mutantFields(entry) {
  return entry.length === 5 ? { name: entry[0], file: entry[2], find: entry[3], replace: entry[4] } : { name: entry[0], file: entry[1], find: entry[2], replace: entry[3] };
}

/**
 * The instrument check: every mutant's target text must occur EXACTLY ONCE in its source file, the replacement must differ from it,
 * and ids must be unique. A target that no longer occurs (the source moved on) makes the harness unable to run that control, and
 * "all mutants killed" would then be a claim about a list that cannot run. `readSource(file)` returns the text of a source file.
 * @returns {{ checked: number, problems: string[] }}
 */
export function checkMutantTargets(mutants, readSource) {
  const problems = [];
  const ids = new Set();
  for (const entry of mutants) {
    const { name, file, find, replace } = mutantFields(entry);
    const id = String(name).split(" ")[0];
    if (ids.has(id)) problems.push(`${id}: the id is used twice`);
    ids.add(id);
    if (find === replace) {
      problems.push(`${name}: the replacement equals the target (a no-op)`);
      continue;
    }
    let text;
    try {
      text = readSource(file);
    } catch {
      problems.push(`${name}: ${file} cannot be read`);
      continue;
    }
    const count = text.split(find).length - 1;
    if (count !== 1) problems.push(`${name}: expected exactly one match of the mutation target in ${file}, found ${count}`);
  }
  return { checked: mutants.length, problems };
}

/** Prints the result of `checkMutantTargets` and returns the process exit code (1 when the instrument is broken). */
export function reportInstrumentCheck(label, result) {
  for (const problem of result.problems) console.log(`INSTRUMENT_BROKEN ${problem}`);
  console.log(`${label}: ${result.checked} mutants checked, ${result.problems.length} problems`);
  return result.problems.length === 0 ? 0 : 1;
}

/** One report line; the killing test is named so that a reviewer can see WHAT killed the mutant. */
export function describeResult(label, name, result) {
  const p = result.parsed ?? EMPTY;
  const counts = `${p.failed} failing tests: ${p.assertions} by assertion, ${p.timeouts} timed out, ${p.errors} other errors, ${p.suiteErrors} suite errors`;
  const killer = label === "KILLED" && p.firstFailure !== undefined ? `; first assertion failure: ${p.firstFailure}` : "";
  let why = "";
  if (label === "SUSPECT") {
    if (result.timedOut) why = " -- hit the wall-clock cap (a hang proves nothing)";
    else if (result.parsed === undefined) why = " -- no result from the test runner (a crash before any test)";
    else why = " -- no test failed by assertion (a timeout, a runtime error or a load failure proves nothing about the tests)";
  }
  return `${label.padEnd(8)} ${name} (exit ${result.code}, ${counts}${killer})${why}`;
}
