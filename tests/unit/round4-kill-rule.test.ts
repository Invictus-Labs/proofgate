/**
 * The kill rule shared by both mutation harnesses (scripts/kill-rule.mjs). History: round 2 found the end-to-end harness counting any
 * non-zero exit as a kill (a planted type error printed KILLED); round 3 fixed that by counting a "N failed" line and treating a run
 * whose failures were all timeouts as SUSPECT; the round-3 review then showed that this text-based rule still failed in four ways:
 * several tests that time out print ONE message for the group (so "timeouts < failed" and an all-timeout run was KILLED), a module
 * that prints a summary line and crashes was believed, a run whose tests all died of a runtime TypeError was KILLED, and a mutant
 * that hangs hung the harness. The rule now reads the runner's own JSON result and needs at least one test that failed BY ASSERTION.
 * These tests run REAL vitest processes on tiny scratch projects and check the classification, so the rule is proven against real
 * output. The wiring into both harnesses is pinned by reading their sources.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

interface Parsed {
  failed: number;
  assertions: number;
  timeouts: number;
  errors: number;
  suiteErrors: number;
  firstFailure: string | undefined;
}
interface Ran {
  code: number | null;
  timedOut: boolean;
  output: string;
  parsed?: Parsed;
  hung?: boolean;
}
interface KillRule {
  classify(result: { code: number | null; parsed?: Parsed }): string;
  classifyFailure(message: string): string;
  parseVitestJson(text: string): Parsed | undefined;
  parsePlaywrightJson(text: string): Parsed | undefined;
  readResult(path: string, parser: (text: string) => Parsed | undefined): Parsed | undefined;
  runWithCap(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ code: number | null; timedOut: boolean; output: string }>;
  describeResult(label: string, name: string, result: Ran): string;
}
const rule = (await import(/* @vite-ignore */ join(import.meta.dirname, "..", "..", "scripts", "kill-rule.mjs"))) as KillRule;
const ROOT = join(import.meta.dirname, "..", "..");

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Processes that a scratch run left behind: the pids that still hold the scratch directory (as a working directory or an open file). */
const leaked: string[] = [];
function holdersOf(dir: string): number[] {
  const r = spawnSync("lsof", ["-t", "+d", dir], { encoding: "utf8" });
  if (r.error !== undefined || r.status === null) return []; // no lsof here: the check is skipped, not passed off as done
  return r.stdout.split("\n").filter(Boolean).map(Number).filter((pid) => pid !== process.pid);
}

async function runScratch(testSource: string, capMs = 120_000): Promise<Ran> {
  const dir = mkdtempSync(join(tmpdir(), "pg-killrule-"));
  scratch.push(dir);
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "t"));
  writeFileSync(join(dir, "t", "a.test.ts"), testSource);
  writeFileSync(join(dir, "vitest.config.ts"), 'export default { test: { include: ["t/**/*.test.ts"], testTimeout: 300, hookTimeout: 300 } };\n');
  const resultPath = join(dir, ".kill-rule-result.json");
  try {
    // A capped run that does not end 20 s after its cap is a HANG of the wrapper itself (the cap killed the child but not what the child started,
    // which keeps the pipes open): reported as a result with `hung` set, so the test that expects the run to end fails by assertion.
    const hung = new Promise<Ran>((resolve) => setTimeout(() => resolve({ code: null, timedOut: false, output: "", hung: true }), capMs + 20_000));
    const r = await Promise.race([rule.runWithCap("npx", ["vitest", "run", "--reporter=json", `--outputFile=${resultPath}`], { cwd: dir, env: { ...process.env, CI: "1" }, timeoutMs: capMs }), hung]);
    const parsed = rule.readResult(resultPath, rule.parseVitestJson);
    return parsed === undefined ? r : { ...r, parsed };
  } finally {
    // The run must leave no process: whatever still holds THIS run's directory (a pid found by that, not by a name) is recorded, and stopped
    // after its command line is checked, so a failing test cannot leave a spinning worker behind.
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const pid of holdersOf(dir)) {
      const command = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
      if (!command.includes("vitest") && !command.includes(dir)) continue;
      leaked.push(`${pid}: ${command.slice(0, 120)}`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}
const header = 'import { it, expect, beforeAll } from "vitest";\nconst sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));\n';

describe("the shared kill rule, against real vitest runs", () => {
  it("a passing suite SURVIVES the mutant", async () => {
    const res = await runScratch(`${header}it("ok", () => expect(1).toBe(1));\n`);
    expect([res.code, rule.classify(res)]).toEqual([0, "SURVIVED"]);
  });

  it("a failing assertion KILLS, and the killing test is named", async () => {
    const res = await runScratch(`${header}it("the flow that bites", () => expect(1).toBe(2));\n`);
    expect(rule.classify(res)).toBe("KILLED");
    expect(res.parsed?.assertions).toBe(1);
    expect(res.parsed?.firstFailure).toContain("the flow that bites");
    expect(rule.describeResult("KILLED", "M00 x", res)).toContain("first assertion failure: ");
  });

  it("a syntax error is red with no failing test: SUSPECT, never KILLED", async () => {
    const res = await runScratch(`${header}it("x", () => { const = ; });\n`);
    expect(res.code === 0).toBe(false);
    expect(rule.classify(res)).toBe("SUSPECT");
  });

  it("a module that throws at load is SUSPECT (no test ran)", async () => {
    const res = await runScratch(`${header}throw new Error("load-time crash");\nit("x", () => {});\n`);
    expect(res.code === 0).toBe(false);
    expect(rule.classify(res)).toBe("SUSPECT");
  });

  it("three tests that ALL time out are SUSPECT (vitest prints one message for the group, so counting messages is not enough)", async () => {
    const source = `${header}for (const n of [1, 2, 3, 4]) it("hangs " + n, async () => { await sleep(3000); });\n`;
    const res = await runScratch(source);
    expect(res.parsed?.failed).toBe(4);
    expect(res.parsed?.timeouts).toBe(4);
    expect(res.parsed?.assertions).toBe(0);
    expect(rule.classify(res)).toBe("SUSPECT");
    expect(rule.describeResult("SUSPECT", "M00 x", res)).toContain("no test failed by assertion");
  });

  it("a hook that times out fails its tests as timeouts: SUSPECT", async () => {
    const res = await runScratch(`${header}beforeAll(async () => { await sleep(3000); });\nit("a", () => {});\nit("b", () => {});\n`);
    expect(rule.classify(res)).toBe("SUSPECT");
    expect(res.parsed?.assertions).toBe(0);
  });

  it("tests that all die of a runtime TypeError (the mutant broke the code path, nothing was checked) are SUSPECT", async () => {
    const source = `${header}it("a", () => { (null as unknown as { x: number }).x; });\nit("b", () => { (undefined as unknown as () => void)(); });\n`;
    const res = await runScratch(source);
    expect(res.parsed?.failed).toBe(2);
    expect(res.parsed?.errors).toBe(2);
    expect(res.parsed?.assertions).toBe(0);
    expect(rule.classify(res)).toBe("SUSPECT");
  });

  it("a module that PRINTS a summary line and then crashes is not believed", async () => {
    const source = `${header}console.log("Tests  3 failed | 0 passed (3)");\nconsole.log(" Test Files  1 failed (1)");\nprocess.exit(1);\nit("x", () => {});\n`;
    const res = await runScratch(source);
    expect(res.code === 0).toBe(false);
    expect(rule.classify(res)).toBe("SUSPECT");
    // and the same words in the runner's output are not a result: only its JSON is read
    expect(rule.classify({ code: 1, parsed: rule.parseVitestJson("Tests  3 failed | 0 passed (3)") })).toBe("SUSPECT");
  });

  it("timeouts beside a real assertion failure still KILL", async () => {
    const res = await runScratch(`${header}it("slow", async () => { await sleep(3000); });\nit("bites", () => expect(1).toBe(2));\n`);
    expect([res.parsed?.timeouts, res.parsed?.assertions, rule.classify(res)]).toEqual([1, 1, "KILLED"]);
  });

  it("a run that never ends (a synchronous loop) is killed at the wall-clock cap and is SUSPECT", async () => {
    const started = Date.now();
    const res = await runScratch(`${header}it("spins", () => { for (;;) { /* never yields */ } });\n`, 4000);
    expect(res.hung, "the capped run ended: the cap killed the whole group, not only its direct child").not.toBe(true);
    expect(res.timedOut).toBe(true);
    expect(res.code).toBeNull();
    expect(rule.classify(res)).toBe("SUSPECT");
    expect(Date.now() - started, "the cap ended the run").toBeLessThan(60_000);
    expect(rule.describeResult("SUSPECT", "M00 x", res)).toContain("wall-clock cap");
  }, 90_000);

  it("no scratch run above left a process behind (a run killed at its cap takes its worker with it, and the cap kills the group twice)", () => {
    expect(leaked).toEqual([]);
    const source = readFileSync(join(ROOT, "scripts", "kill-rule.mjs"), "utf8");
    expect(source).toMatch(/if \(timedOut\) \{[^}]*process\.kill\(-child\.pid, "SIGKILL"\)/);
  });
});

describe("classification of one failure, and of playwright's JSON result", () => {
  it.each([
    ["AssertionError: expected 1 to be 2 // Object.is equality", "assertion"],
    ["Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1", "assertion"],
    ["Error: Snapshot `x 1` mismatched", "assertion"],
    ["Error: Test timed out in 300ms.\nIf this is a long-running test, pass a timeout value", "timeout"],
    ["Error: Hook timed out in 300ms.", "timeout"],
    ["Error: Hook timed out", "timeout"], // (the alternative is not redundant: without `in Nms` only it matches)
    ["Test timeout of 30000ms exceeded.", "timeout"],
    ["TypeError: Cannot read properties of null (reading 'x')", "error"],
    ["ReferenceError: mutated is not defined", "error"],
    ["Error: spawn ENOENT", "error"],
    ["", "error"],
    // round 5, tests reviewer (P1 and P2): a LABELLED Playwright expect, a rejects that resolved, and errors that only look like assertions
    ["Error: horizontal page overflow at 375px\n\nexpect(received).toBe(expected) // Object.is equality\n\nExpected: 1\nReceived: 2", "assertion"],
    ["Error: card layout\n\nexpect(received).toEqual(expected) // deep equality\n\n- Expected  - 1\n+ Received  + 1", "assertion"],
    ["Error: expect(locator).toBeVisible()\n\nLocator: getByText('x')\nReceived: hidden", "assertion"],
    // repaired (round 6, tests reviewer): an assertion is read at the START of a message, and Playwright's header needs its own Expected / Received / Locator block behind it
    ["Error: page is blank\n\nexpect(received).toBeTruthy()\n\nReceived: 0", "assertion"],
    ["Error: label\n\nexpect(locator).toHaveCount(expected)\n\nLocator: locator('li')\nExpected: 3\nReceived: 2", "assertion"],
    ["Error: first line of the label\nsecond line\n\nexpect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1", "assertion"],
    ["\u001b[31mError: \u001b[39mexpect(\u001b[31mreceived\u001b[39m).toBe(\u001b[32mexpected\u001b[39m) // Object.is equality\n\nExpected: 2\nReceived: 1", "assertion"],
    ["\u001b[1;31mAssertionError: expected 1 to be 2\u001b[0m", "assertion"],
    // a thrown Error holds any word on any line of its message: none of these is a failed expectation
    ["Expected: 1\nReceived: 2", "error"],
    ["Error: expect(received).toBeTruthy()", "error"],
    ["Error: page is blank\n\nexpect(received).toBeTruthy()", "error"],
    ["Error: helper failed\nAssertionError: x", "error"],
    ["Error: bad\nExpected: 1\nReceived: 2", "error"],
    ["Error: expect(page) was never reached", "error"],
    ["Error: helper failed\n\nexpect(x).toBe(y) not reached", "error"],
    ["Error: wrapper: AssertionError happened", "error"],
    ["Error: Promise resolved, then the helper threw\npromise resolved \"1\" instead of rejecting", "error"],
    // expect.poll gives up with a message that says so (a timeout); vitest 5.0.2's vi.waitFor rethrows the LAST error its callback threw (an "error", see the captured probe
    // `v28 waitFor timeout`), and a message that says `Timed out in waitFor` is a timeout: none of these is ever a kill
    ["Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1\n\nCall Log:\n- Timeout 100ms exceeded while waiting on the predicate", "timeout"],
    ['AssertionError: promise resolved "1" instead of rejecting', "assertion"],
    ['promise resolved "1" instead of rejecting', "assertion"],
    ["Error: expected the config to be loaded before use", "error"],
    ["Error: startup failed, an AssertionError was swallowed here", "error"],
    ["Error: Timed out in waitFor!", "timeout"],
    // `await expect(p).rejects.toMatchObject(...)` fails as `Error: expected ... to match object ...`: vitest's own first stack frame says it is an assertion; a thrown look-alike does not
    ["Error: expected Error: coded { code: 'a' } to match object { code: 'b' }\n    at _Assertion.__VITEST_REJECTS__ (file:///x/node_modules/vitest/dist/chunks/index.js:2464:33)\n    at _Assertion.propertyGetter (file:///x/node_modules/chai/index.js:1570:27)", "assertion"],
    ["Error: expected { a: 1 } to match object { a: 2 }\n    at _Assertion.__VITEST_RESOLVES__ (/x/node_modules/vitest/dist/chunks/index.js:2435:33)", "assertion"],
    ["Error: expected { a: 1 } to match object { a: 2 }\n    at _Assertion.__VITEST_REJECTS__ (fake)", "error"],
    ["Error: expected { a: 1 } to match object { a: 2 }\n    at _Assertion.__VITEST_REJECTS__ (/x/src/helper.ts:1:1)\n    at /x/node_modules/vitest/dist/chunks/run.js:1:1", "error"],
    ["Error: helper\n    at helper (/x/tests/a.test.ts:3:9)\n    at _Assertion.__VITEST_REJECTS__ (/x/node_modules/vitest/dist/chunks/index.js:1:1)", "error"],
    ["expected { a: 1 } to match object { a: 2 }\n    at _Assertion.__VITEST_REJECTS__ (/x/node_modules/vitest/dist/chunks/index.js:1:1)", "error"],
  ])("%s", (message, kind) => {
    expect(rule.classifyFailure(message)).toBe(kind);
  });

  // Round 5 (tests P3): the rows above are written by hand. These are VERBATIM failure messages from the JSON result of real vitest runs
  // (the red-before runs of the round-4 and round-5 tests), so the classifier is also shown to read what the runner really prints.
  it.each([
    ["AssertionError: expected [ …(5) ] to deeply equal []", "assertion"],
    ["AssertionError: expected true to be false // Object.is equality", "assertion"],
    ["AssertionError: expected '# Human drill sheet (AC-11)\\n\\n**This…' to match /coordinator builds the tarball and co…/", "assertion"],
    ["AssertionError: expected 1 to be +0 // Object.is equality", "assertion"],
    ["AssertionError: expected [ +0, '' ] to deeply equal [ 2, undefined ]", "assertion"],
    ["TypeError: rule.runWithCap is not a function", "error"],
    ["Error: Test timed out in 60000ms.\nIf this is a long-running test, pass a timeout value as the last argument or configure it globally with \"testTimeout\".", "timeout"],
  ])("real runner text: %s", (message, kind) => {
    expect(rule.classifyFailure(message)).toBe(kind);
  });

  it("a crash of the spawned command counts as a kill only through its exit-code assertions: a weak kill, stated", () => {
    // A mutant that makes the packaged binary crash at load turns every subprocess test red at `expected 1 to be +0`. That is an
    // assertion failure, so the rule labels it KILLED although only "a dead binary is noticed" was checked. The rule cannot tell,
    // and the documents list it as a known weak kill (docs/qa/negative-controls.md).
    expect(rule.classify({ code: 1, parsed: { failed: 10, assertions: 10, timeouts: 0, errors: 0, suiteErrors: 0, firstFailure: "expected 1 to be +0" } })).toBe("KILLED");
  });

  it("playwright: an expect failure is an assertion, a timedOut result a timeout, anything else an error, and passed tests are ignored", () => {
    const report = {
      suites: [
        {
          title: "smoke.spec.ts",
          specs: [
            { title: "escapes hostile strings", tests: [{ results: [{ status: "failed", error: { message: "Error: expect(locator).toHaveText(expected)\n\nExpected: a" } }] }] },
            { title: "layout at 375px", tests: [{ results: [{ status: "timedOut", error: { message: "Test timeout of 30000ms exceeded." } }] }] },
            // a labelled expect, in the text of a real Playwright report: the label comes first, then a blank line, then the matcher
            { title: "no horizontal overflow", tests: [{ results: [{ status: "failed", error: { message: "Error: horizontal page overflow at 375px\n\nexpect(received).toBe(expected) // Object.is equality\n\nExpected: 1\nReceived: 2" } }] }] },
            { title: "crashes", tests: [{ results: [{ status: "failed", error: { message: "TypeError: x is not a function" } }] }] },
            { title: "fine", tests: [{ results: [{ status: "passed" }] }] },
          ],
        },
      ],
      errors: [],
    };
    const parsed = rule.parsePlaywrightJson(JSON.stringify(report));
    expect(parsed).toMatchObject({ failed: 4, assertions: 2, timeouts: 1, errors: 1, suiteErrors: 0 });
    expect(parsed?.firstFailure).toContain("escapes hostile strings");
    expect(rule.classify({ code: 1, parsed })).toBe("KILLED");
    const onlyTimeouts = rule.parsePlaywrightJson(JSON.stringify({ suites: [{ title: "s", specs: [{ title: "t", tests: [{ results: [{ status: "timedOut", error: { message: "x" } }] }] }] }], errors: [] }));
    expect(rule.classify({ code: 1, parsed: onlyTimeouts })).toBe("SUSPECT");
  });

  it("text that is not a runner result is not a result", () => {
    expect(rule.parseVitestJson("Tests  3 failed | 0 passed")).toBeUndefined();
    expect(rule.parsePlaywrightJson("{}")).toBeUndefined();
    expect(rule.classify({ code: 1 })).toBe("SUSPECT");
    expect(rule.classify({ code: null, parsed: { failed: 5, assertions: 5, timeouts: 0, errors: 0, suiteErrors: 0, firstFailure: "x" } })).toBe("SUSPECT");
    expect(rule.classify({ code: 0 })).toBe("SURVIVED");
  });
});

describe("a test file that fails with no test in it, and the process group of a capped run (round 5, tests reviewer)", () => {
  it("a file that fails before it holds a test is a suite error, and a run of only suite errors is SUSPECT (k13)", () => {
    const report = { testResults: [{ name: "/x/tests/a.test.ts", status: "failed", assertionResults: [], message: "Error: Cannot find module './gone.js'" }] };
    const parsed = rule.parseVitestJson(JSON.stringify(report));
    expect(parsed).toMatchObject({ failed: 0, assertions: 0, suiteErrors: 1 });
    expect(rule.classify({ code: 1, parsed })).toBe("SUSPECT");
    // a passing file with no tests is not a suite error
    expect(rule.parseVitestJson(JSON.stringify({ testResults: [{ name: "/x/b.test.ts", status: "passed", assertionResults: [] }] }))?.suiteErrors).toBe(0);
  });

  it("a capped run kills the whole process group: a grandchild that the command started does not outlive the cap (the orphan-worker defect)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pg-grandchild-"));
    scratch.push(dir);
    const pidFile = join(dir, "pid");
    const marker = `pg-grandchild-${Math.random().toString(36).slice(2)}`;
    const script = `const { spawn } = require('node:child_process'); const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ${JSON.stringify(marker)}], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setInterval(() => {}, 1000);`;
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    let grandchild = 0;
    try {
      const result = await rule.runWithCap(process.execPath, ["-e", script], { cwd: dir, env: process.env, timeoutMs: 1500 });
      expect(result.timedOut).toBe(true);
      grandchild = Number(readFileSync(pidFile, "utf8"));
      expect(grandchild).toBeGreaterThan(0);
      const until = Date.now() + 5000;
      while (alive(grandchild) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(alive(grandchild), "the grandchild is dead after the cap").toBe(false);
    } finally {
      // only the pid this test recorded, and only if `ps` still shows the marker it was started with
      if (grandchild > 0 && alive(grandchild)) {
        const ps = spawnSync("ps", ["-o", "command=", "-p", String(grandchild)], { encoding: "utf8" });
        if (ps.stdout.includes(marker)) process.kill(grandchild, "SIGKILL");
      }
    }
  }, 30_000);
});

describe("both harnesses apply the shared rule (a regression to a bare non-zero exit test is caught here)", () => {
  for (const file of ["mutation-controls.mjs", "e2e-mutation-controls.mjs"]) {
    it(`${file} reads the runner's JSON result, caps the run and counts anything but KILLED as a control that did not bite`, () => {
      const source = readFileSync(join(ROOT, "scripts", file), "utf8");
      expect(source).toContain('from "./kill-rule.mjs"');
      expect(source).toContain("classify(result)");
      expect(source).toContain("runWithCap(");
      expect(source).toContain("--reporter=json");
      expect(source).toMatch(/label !== "KILLED"\) bad \+= 1/);
      expect(source).not.toMatch(/const killed = result\.code !== 0;/);
      expect(source).not.toContain("measure(");
      expect(source).not.toContain("--reporter=dot");
    });
  }
});

describe("the classifier on CAPTURED failures of real runs (round 6: 39 vitest 5.0.2 and 21 Playwright 1.63.0 probes)", () => {
  interface Case {
    runner: string;
    probe: string;
    status: string;
    expected: "assertion" | "timeout" | "error";
    messages: string[];
  }
  const fixture = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "kill-rule-real-failures.json"), "utf8")) as { cases: Case[] };
  const cases = fixture.cases;

  it("the fixture holds the probes of both runners", () => {
    expect(cases.filter((c) => c.runner.startsWith("vitest")).length).toBe(39);
    expect(cases.filter((c) => c.runner.startsWith("playwright")).length).toBe(21);
    for (const kind of ["assertion", "timeout", "error"] as const) expect(cases.some((c) => c.expected === kind), kind).toBe(true);
  });

  it.each(cases.map((c) => [`${c.runner}: ${c.probe}`, c] as const))("%s is read as its expected class, through the runner's JSON result", (_name, c) => {
    const parsed =
      c.runner.startsWith("vitest")
        ? rule.parseVitestJson(JSON.stringify({ testResults: [{ name: "/x/tests/a.test.ts", status: "failed", assertionResults: [{ title: c.probe, fullName: c.probe, status: "failed", failureMessages: c.messages }] }] }))
        : rule.parsePlaywrightJson(JSON.stringify({ suites: [{ title: "f.spec.ts", specs: [{ title: c.probe, tests: [{ results: [{ status: c.status, error: { message: c.messages[0] }, errors: c.messages.slice(1).map((message) => ({ message })) }] }] }] }], errors: [] }));
    const want = { assertion: { assertions: 1, timeouts: 0, errors: 0 }, timeout: { assertions: 0, timeouts: 1, errors: 0 }, error: { assertions: 0, timeouts: 0, errors: 1 } }[c.expected];
    expect(parsed).toMatchObject({ failed: 1, ...want });
  });

  it("every captured message of a probe that is not a failed expectation is classified as it would be alone (the class does not depend on the parser)", () => {
    for (const c of cases.filter((x) => x.expected === "error")) for (const m of c.messages) expect(rule.classifyFailure(m), `${c.runner}: ${c.probe}`).toBe("error");
  });
});
