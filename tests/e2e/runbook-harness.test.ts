/**
 * The automated fresh-directory harness (scripts/runbook-smoke.mjs) executes docs/RUNBOOK-SMOKE.md verbatim against the
 * packed tarball. This is SUPPLEMENTAL evidence for AC-11: it never closes it, and these tests also pin that fact.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ROOT } from "../helpers/cli.js";
import { readPackInfo } from "./support/pack.js";

/** A process that could not be started or was killed is never reported as exit status 1, which means "policy unsatisfied". */
const SPAWN_FAILED = -1;

interface HarnessReceipt {
  kind: string;
  independent_human_drill: boolean;
  ac11_status: string;
  automatic_steps: number;
  manual_steps_not_executed: number;
  passed: number;
  failed: number;
  tarball_sha256: string;
  steps: Array<{ step: number | string; ok: boolean; problems: string[] }>;
}

const scratch = mkdtempSync(join(tmpdir(), "pg-harness-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function harness(extra: string[]): Promise<{ code: number; receipt: HarnessReceipt; stderr: string }> {
  const info = readPackInfo();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [join(ROOT, "scripts", "runbook-smoke.mjs"), "--tarball", info.tarball, "--json", ...extra],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, maxBuffer: 16 * 1024 * 1024, timeout: 240_000 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : SPAWN_FAILED;
        resolve({ code, receipt: JSON.parse(stdout) as HarnessReceipt, stderr });
      },
    );
  });
}

describe("runbook harness (supplemental evidence for AC-11, never the human drill)", () => {
  const runbook = readFileSync(join(ROOT, "docs", "RUNBOOK-SMOKE.md"), "utf8");

  it("executes every automatic command block of docs/RUNBOOK-SMOKE.md verbatim in an empty directory and all steps pass", async () => {
    const { code, receipt, stderr } = await harness([]);
    expect(code, JSON.stringify(receipt.steps.filter((s) => !s.ok))).toBe(0);
    expect(stderr).not.toContain("kept ");
    expect(receipt.failed).toBe(0);
    expect(receipt.automatic_steps).toBeGreaterThanOrEqual(15);
    expect(receipt.passed).toBe(receipt.automatic_steps);
    expect(receipt.manual_steps_not_executed).toBeGreaterThanOrEqual(2);
    expect(receipt.tarball_sha256).toBe(readPackInfo().sha256);
  });

  it("labels itself supplemental: it is not an independent human drill and AC-11 stays PENDING_HUMAN_RECEIPT", async () => {
    const { receipt } = await harness([]);
    expect(receipt.kind).toBe("supplemental-automated-runbook-run");
    expect(receipt.independent_human_drill).toBe(false);
    expect(receipt.ac11_status).toBe("PENDING_HUMAN_RECEIPT");
  });

  it("negative control: a runbook whose expected text is wrong makes the harness fail and name the step", async () => {
    const broken = join(scratch, "wrong-expectation.md");
    writeFileSync(broken, runbook.replace('expect="verdict: ACCEPTED (exit 0)"', 'expect="verdict: REJECTED"'));
    const { code, receipt } = await harness(["--runbook", broken]);
    expect(code).toBe(1);
    expect(receipt.failed).toBeGreaterThan(0);
    const failing = receipt.steps.filter((s) => !s.ok);
    expect(failing.map((s) => s.step)).toContain(7);
    expect(failing.flatMap((s) => s.problems).join("\n")).toContain("verdict: REJECTED");
  });

  it("negative control: a wrong release checksum is caught by the runbook's own verification step", async () => {
    const { code, receipt } = await harness(["--sha256", "0".repeat(64)]);
    expect(code).toBe(1);
    const failing = receipt.steps.filter((s) => !s.ok);
    expect(failing.map((s) => s.step)).toContain(3);
  });

  it("negative control: a runbook whose command is expected to fail but succeeds is reported", async () => {
    const broken = join(scratch, "wrong-exit.md");
    writeFileSync(broken, runbook.replace('<!-- smoke: expect="checksum ok" -->', '<!-- smoke: exit=1 expect="checksum ok" -->'));
    const { code, receipt } = await harness(["--runbook", broken]);
    expect(code).toBe(1);
    expect(receipt.steps.filter((s) => !s.ok).flatMap((s) => s.problems).join("\n")).toContain("expected 1");
  });
});
