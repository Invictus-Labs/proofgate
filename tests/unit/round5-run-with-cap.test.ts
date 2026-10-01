/**
 * Review round 5 (logic P0 follow-up): the quality gate ran the test suite with no wall-clock cap, so a test process that spins in a
 * synchronous loop (as the redactor did on `{"key":"value"}`) stalls the gate for ever instead of failing it. `scripts/run-with-cap.mjs`
 * is the cap: it kills the process group and exits 124.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "run-with-cap.mjs");
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL" });

describe("scripts/run-with-cap.mjs", () => {
  it("a command that spins in a synchronous loop is killed at the cap and the status is 124", () => {
    const started = Date.now();
    const r = run(["0.03", process.execPath, "-e", "while (true) {}"]);
    expect(r.status, `killed by ${r.signal}`).toBe(124);
    expect(r.stderr).toContain("did not finish within 0.03 minute(s)");
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it("the cap kills the whole process group: a grandchild that the command started is dead after the cap (the orphan-worker defect)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pg-cap-gc-"));
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
      const r = run(["0.03", process.execPath, "-e", script]);
      expect(r.status).toBe(124);
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
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("the exit status and the output of a command that finishes are passed through", () => {
    const ok = run(["1", process.execPath, "-e", "process.stdout.write('hello'); process.exit(0)"]);
    expect([ok.status, ok.stdout]).toEqual([0, "hello"]);
    const bad = run(["1", process.execPath, "-e", "process.stderr.write('oops'); process.exit(3)"]);
    expect([bad.status, bad.stderr]).toEqual([3, "oops"]);
  });

  it("a command that cannot start is not a pass, and a bad cap is a usage error", () => {
    expect(run(["1", "definitely-not-a-command-xyz"]).status).toBe(127);
    expect(run([]).status).toBe(2);
    expect(run(["0", process.execPath, "-e", ""]).status).toBe(2);
  });

  it("a cap that a timer cannot hold (it would fire at once) is a usage error, not an immediate timeout", () => {
    for (const cap of ["1e12", "Infinity", "35792", "NaN", "-1"]) expect(run([cap, process.execPath, "-e", ""]).status, cap).toBe(2);
    expect(run(["35791", process.execPath, "-e", "process.exit(0)"]).status).toBe(0);
  });

  describe("interrupting the wrapper stops the command and everything it started (no orphan)", () => {
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const waitFor = async (check: () => boolean, ms: number): Promise<boolean> => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return check();
    };

    // The command records its own pid, then either keeps running until it is stopped, or ignores SIGTERM (only the group kill ends it).
    let elapsed = 0; // how long the wrapper took to end after the signal was sent (the forwarded signal ends a plain command at once; the grace period is 5 s)
    async function interrupt(signal: NodeJS.Signals, ignoreTerm: boolean): Promise<{ code: number | null; childGone: boolean }> {
      const dir = mkdtempSync(join(tmpdir(), "pg-cap-"));
      const pidFile = join(dir, "pid");
      const script = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));${ignoreTerm ? "process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); process.on('SIGINT', () => {});" : ""} setInterval(() => {}, 1000);`;
      const wrapper = spawn(process.execPath, [SCRIPT, "5", process.execPath, "-e", script], { stdio: "ignore" });
      const exited = new Promise<number | null>((resolve) => wrapper.on("close", (code) => resolve(code)));
      let childPid = 0;
      try {
        expect(await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "", 15_000), "the command started").toBe(true);
        childPid = Number(readFileSync(pidFile, "utf8"));
        const sent = Date.now();
        wrapper.kill(signal);
        const code = await Promise.race([exited, new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000))]);
        elapsed = Date.now() - sent;
        const childGone = await waitFor(() => !alive(childPid), 5_000);
        return { code, childGone };
      } finally {
        // only the pid this test recorded, and only if it is still running
        if (childPid > 0 && alive(childPid)) process.kill(childPid, "SIGKILL");
        if (wrapper.exitCode === null) wrapper.kill("SIGKILL");
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it.each([
      ["SIGTERM", 143],
      ["SIGINT", 130],
      ["SIGHUP", 129],
    ] as const)("%s is forwarded, the command ends and the status is 128 + the signal", async (signal, expected) => {
      const r = await interrupt(signal, false);
      expect(r).toEqual({ code: expected, childGone: true });
      expect(elapsed, "the signal was passed on: the wrapper did not wait for the grace period").toBeLessThan(4000);
    }, 60_000);

    it("a command that ignores the signal is killed after the grace period", async () => {
      const r = await interrupt("SIGTERM", true);
      expect(r).toEqual({ code: 143, childGone: true });
      expect(elapsed, "a command that ignores the signal lives through the grace period, then the group is killed").toBeGreaterThanOrEqual(4000);
    }, 60_000);
  });

  it("the quality gate runs the test step through the cap", () => {
    const gate = readFileSync(join(ROOT, "scripts", "verify-quality.sh"), "utf8");
    expect(gate).toContain('node scripts/run-with-cap.mjs "${TEST_CAP_MINUTES:-60}" npx vitest run --coverage');
  });

  it("the packaged end-to-end suite and the browser smoke run through the cap too (a spinning packaged command must not stall the gate)", () => {
    const gate = readFileSync(join(ROOT, "scripts", "verify-quality.sh"), "utf8");
    expect(gate).toContain('node scripts/run-with-cap.mjs "${E2E_CAP_MINUTES:-30}" npx vitest run --config vitest.e2e.config.ts');
    expect(gate).toContain('node scripts/run-with-cap.mjs "${E2E_CAP_MINUTES:-30}" npx playwright test');
    const bin = readFileSync(join(ROOT, "tests", "e2e", "support", "bin.ts"), "utf8");
    // the default cap is EXEC_TIMEOUT_MS and a run that hits the cap is SIGKILLed; a caller may set a shorter one (the hostile-artifact test runs at 60 s)
    expect(bin).toMatch(/timeoutMs: number = EXEC_TIMEOUT_MS/);
    expect(bin).toMatch(/timeout: timeoutMs, killSignal: "SIGKILL"/);
  });
});
