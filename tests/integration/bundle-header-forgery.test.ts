/**
 * Review round 4 (logic P3): the bundle header repeats the revision set of the report. A bundle that was edited and re-sealed
 * (a new trailer over the edited bytes, which anyone who can write the file can compute) could carry a different revision set in its
 * header while the report and the restored inputs stayed consistent, and verify said OK. The header is now checked against the
 * report. (There is no signature: a forger who rewrites report, inputs and header together still produces a consistent bundle,
 * which is the documented "consistency, not honesty" limit; the fields that are masked from the re-evaluation comparison because
 * they depend on the build or the run - producer version, input summary, supersedes, clock source - are not cross-checked.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleBundle, parseBundleBuffer } from "../helpers/bundle.js";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

describe("the bundle header's revision set must be the report's", () => {
  it("a re-sealed bundle whose header lists another commit is refused; the same bundle unchanged verifies", async () => {
    const w = await passingWorkspace();
    made.push(w);
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const bundle = join(w.dir, "good.pgbundle");
    expect((await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle])).code).toBe(0);
    const parsed = parseBundleBuffer(readFileSync(bundle));
    const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));

    const same = join(w.dir, "same.pgbundle");
    writeFileSync(same, assembleBundle(parsed.header, entries));
    expect((await runCli(["bundle", "verify", same])).code).toBe(0);

    const revisions = (parsed.header.revisions as Array<{ repository: string; commit_sha: string }>).map((r, i) => (i === 0 ? { ...r, commit_sha: "f".repeat(40) } : r));
    const forged = join(w.dir, "forged.pgbundle");
    writeFileSync(forged, assembleBundle(parsed.header, entries, { headerOverrides: { revisions } }));
    const verify = await runCli(["bundle", "verify", forged]);
    expect([verify.code, errorCode(verify)], verify.stderr).toEqual([2, "bundle_reevaluation_mismatch"]);
    expect(verify.stderr).toContain("revisions");
    const restore = await runCli(["bundle", "restore", forged, "--output", join(w.dir, "restored-forged")]);
    expect(restore.code).toBe(2);
  });
});
