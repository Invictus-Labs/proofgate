/**
 * Review round 6 (security addendum, tests reviewer, coordinator): a 256 KiB artifact of a hostile shape made `bundle export` run for 33 seconds, because the artifact scan
 * (`scanBufferForCredentials`) was super-linear, and only the scanner function was tested, not the command. This file runs the REAL command (the built `dist/cli.js`,
 * `bundle export` over a workspace whose receipt names a 256 KiB artifact, the artifact hash in the receipt) for the shapes of the reviews, each in a child killed at a hard
 * cap: a run that does not end is a failed assertion. The EXPECTED OUTCOME is fail closed: a credential-shaped artifact is REFUSED (exit 2, `bundle_secret_detected`, the
 * artifact named, no bundle file left behind, none of its text echoed), an ordinary artifact of the same size is exported (exit 0, a bundle file). The fixture is generated at
 * run time, nothing hostile is stored. The packed binary runs the same shapes in `tests/e2e/packaged-hostile-artifact.test.ts`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { errorCode, evalArgs, runDist } from "../helpers/cli.js";
import { B, expandPw } from "../helpers/redact-child.js";
import { NOW, passingWorkspace, writeReceipt, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

const SIZE = 256 * 1024;
/** [name, prefix, unit, tail, refused]: `refused` is false for a shape that holds no credential (the scanner finds nothing, and the artifact is exported: the point is that it ends). */
const RAW_SHAPES: Array<[string, string, string, string, boolean]> = [
  ["the review's shape: an option in a test report and 256 KiB of backslashes", "<testsuite>--@PW@ ", B, "x</testsuite>", true],
  ["a credential, empty brackets and a run of backslashes", "@PW@=[]a", B, "b", true],
  ["a credential and a run of backslashes", "@PW@=", B, "y", true],
  ["an option and a run of backslashes", "--@PW@ a", B, "x", true],
  ["chained options with no blank", "", "--@PW@=", "", true],
  ["the `-u` family", "", "=-u", "", false],
  ["a line break written as text in front of an option, repeated", "", "%0A--@PW@=", "", true],
  ["a braced value and escaped line breaks", "token: {}a", `${B}${B}n`, "x", true],
];
const SHAPES = RAW_SHAPES.map(([name, prefix, unit, tail, refused]) => [name, expandPw(prefix), expandPw(unit), expandPw(tail), refused] as const);
const exportArgs = (ws: Workspace, out: string): string[] => ["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", out];

async function exportOf(content: string) {
  const ws = await passingWorkspace();
  made.push(ws);
  await writeReceipt(ws, { artifactPath: "artifacts/big.txt", artifact: content });
  const evaluated = await runDist(evalArgs(ws, ["--now", NOW]), { timeoutMs: 120_000 });
  expect(evaluated.code, evaluated.stderr.slice(0, 300)).toBe(0);
  const out = join(ws.dir, "hostile.pgbundle");
  const started = process.hrtime.bigint();
  const exported = await runDist(exportArgs(ws, out), { timeoutMs: 90_000 });
  return { exported, out, seconds: Number(process.hrtime.bigint() - started) / 1e9 };
}

describe("bundle export over a 256 KiB artifact of a hostile shape ends, through the real command", () => {
  it.each(SHAPES.map((s) => [s[0], s] as const))("%s", async (_name, [, prefix, unit, tail, refused]) => {
    const { exported, out, seconds } = await exportOf(prefix + unit.repeat(Math.ceil(SIZE / unit.length)) + tail);
    if (!refused) {
      // no credential in it: exported, and it ended (a run killed at the cap is reported as -1)
      expect(exported.code, `killed at the cap (${seconds.toFixed(0)} s): ${exported.stderr.slice(0, 300)}`).toBe(0);
      expect(existsSync(out)).toBe(true);
      return;
    }
    // fail closed: refused, the artifact named, no bundle written (a run killed at the cap is reported as -1)
    expect(exported.code, `killed at the cap (${seconds.toFixed(0)} s) or not refused: ${exported.stderr.slice(0, 300)}`).toBe(2);
    expect(errorCode(exported)).toBe("bundle_secret_detected");
    expect(exported.stderr).toContain("artifacts/big.txt");
    expect(existsSync(out)).toBe(false);
    expect(exported.stdout + exported.stderr).not.toContain("Zx9Kq2Wm5Lp");
    // the shape of the review took 33 s at 256 KiB before the scanners were linear; it takes about a second now
    expect(seconds, "the export took too long").toBeLessThan(20);
  }, 300_000);

  it("the review's shape at 1 MiB and at 4,000,000 bytes (next to the 4 MiB string cap) is refused too", async () => {
    for (const size of [1_048_576, 4_000_000]) {
      const { exported, out, seconds } = await exportOf(expandPw("<testsuite>--@PW@ ") + B.repeat(size) + "x</testsuite>");
      expect(exported.code, `${size} bytes: killed at the cap (${seconds.toFixed(0)} s) or not refused: ${exported.stderr.slice(0, 300)}`).toBe(2);
      expect(errorCode(exported)).toBe("bundle_secret_detected");
      expect(existsSync(out)).toBe(false);
    }
  }, 600_000);

  it("CONTROL: an ordinary artifact of 256 KiB, 1 MiB and 4,000,000 bytes is exported", async () => {
    for (const size of [SIZE, 1_048_576, 4_000_000]) {
      const line = "200 OK in 12 ms\n";
      const { exported, out } = await exportOf(line.repeat(Math.ceil(size / line.length)));
      expect(exported.code, `${size} bytes: ${exported.stderr.slice(0, 300)}`).toBe(0);
      expect(existsSync(out)).toBe(true);
    }
  }, 600_000);

  it("a 256 KiB artifact that holds a real credential is refused, whatever hostile run surrounds it, and the credential is not echoed", async () => {
    const secret = "ghp_" + "Zx9Kq2Wm5Lp7Rt4Vb8Nc3Hd6Jf1Gs0Ya2Ue";
    const { exported, out } = await exportOf(`${expandPw("--@PW@ a")}${B.repeat(SIZE / 2)}x\n${secret}\n${B.repeat(SIZE / 2)}`);
    expect(exported.code).toBe(2);
    expect(errorCode(exported)).toBe("bundle_secret_detected");
    expect(existsSync(out)).toBe(false);
    expect(exported.stderr).not.toContain(secret);
  }, 300_000);
});
