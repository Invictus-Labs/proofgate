/**
 * Packaged-executable E2E for the artifact scan of `bundle export` (round 6, coordinator): the PACKED `proofgate` binary (an `npm pack` tarball installed outside the repository,
 * as `packaged-cli.test.ts` does) runs `evaluate` and then `bundle export` over a receipt whose artifact is hostile: the shape of the security review (`<testsuite>--password `,
 * a run of backslashes, `x</testsuite>`, the artifact hash in the receipt), which took 33 seconds at 256 KiB before the scanners were made linear, at 256 KiB, 1 MiB and
 * 4,000,000 bytes (next to the 4 MiB string cap). Each run is killed at a 60 second cap (SIGKILL of its own child, reported as -1). EXPECTED OUTCOME, fail closed: exit 2,
 * `proofgate: error [bundle_secret_detected]: artifacts contain credential-shaped text (artifacts/big.txt: ...)`, no bundle file, none of the artifact's text echoed; the
 * CONTROL, an ordinary artifact of the same sizes, exits 0 and writes the bundle. The fixtures are generated at run time; nothing hostile is stored. The elapsed seconds of
 * every run are part of each assertion message.
 *
 * Test IDs in docs/qa/ac-matrix.md have the form `file :: describe > test`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandPw } from "../helpers/redact-child.js";
import { NOW, passingWorkspace, writeReceipt, type Workspace } from "../helpers/fixture.js";
import { errorCodeOf, evalArgs, runBin } from "./support/bin.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

const CAP_MS = 60_000;
/** The shape of the review took 33 s at 256 KiB before the scanners were linear; it takes about a second now, so 20 s is a bound that a busy host does not reach and the old behaviour does. */
const LIMIT_S = 20;
const SIZES = [256 * 1024, 1_048_576, 4_000_000];

async function exportOf(content: string) {
  const ws = await passingWorkspace();
  made.push(ws);
  await writeReceipt(ws, { artifactPath: "artifacts/big.txt", artifact: content });
  const evaluated = await runBin(evalArgs(ws, ["--now", NOW]), { timeoutMs: CAP_MS });
  expect(evaluated.code, evaluated.stderr.slice(0, 300)).toBe(0);
  const out = join(ws.dir, "hostile.pgbundle");
  const started = process.hrtime.bigint();
  const exported = await runBin(["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", out], { timeoutMs: CAP_MS });
  return { exported, out, seconds: Number(process.hrtime.bigint() - started) / 1e9 };
}

describe("E2E AC-09 the artifact scan of the packaged bundle export ends and fails closed on a hostile artifact", () => {
  it.each(SIZES.map((size) => [`${size} bytes`, size] as const))("the security review's shape, %s of it: refused, never a hang", async (_name, size) => {
    const { exported, out, seconds } = await exportOf(expandPw("<testsuite>--@PW@ ") + "\\".repeat(size) + "x</testsuite>");
    const note = `${size} bytes: ${seconds.toFixed(1)} s, exit ${exported.code}: ${exported.stderr.slice(0, 200)}`;
    expect(exported.code, `killed at the ${CAP_MS / 1000} s cap or not refused; ${note}`).toBe(2);
    expect(errorCodeOf(exported), note).toBe("bundle_secret_detected");
    expect(exported.stderr, note).toContain("artifacts/big.txt");
    expect(existsSync(out), "no bundle file is left behind").toBe(false);
    expect(exported.stdout + exported.stderr).not.toContain("x</testsuite>");
    expect(seconds, note).toBeLessThan(LIMIT_S);
  });

  it.each(SIZES.map((size) => [`${size} bytes`, size] as const))("CONTROL: an ordinary artifact of %s is exported", async (_name, size) => {
    const line = "200 OK in 12 ms\n";
    const { exported, out, seconds } = await exportOf(line.repeat(Math.ceil(size / line.length)));
    expect(exported.code, `${size} bytes: ${seconds.toFixed(1)} s: ${exported.stderr.slice(0, 200)}`).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(seconds).toBeLessThan(LIMIT_S);
  });
});
