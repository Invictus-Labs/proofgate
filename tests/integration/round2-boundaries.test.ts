/**
 * Tests-reviewer, round 1: mutants that survived because a test could not tell two defences apart or never sat on a
 * boundary. Each test here pins one of them:
 *   A22  the per-entry hash of a bundle is checked (not only the whole-file checksum)
 *   --   truncation at EVERY structural boundary of a bundle, not a sample of cuts
 *   A38  the blob cap is exact: N bytes pass, N - 1 fail
 *   A63  environment names are compared exactly (case-sensitive)
 *   A17  a report is never "accepted" when no mandatory requirement exists (defence in depth behind the manifest check)
 *   L2   the manifest and revisions count together against the metadata limit
 *   A30  a URL as an artifact path is refused as a URL (its own message), not as a side effect of another rule
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { assess } from "../../src/evaluate.js";
import { validateRelativePath } from "../../src/fsguard.js";
import { parseManifestText } from "../../src/manifest.js";
import { loadInputs } from "../../src/pipeline.js";
import { parseRevisionsText } from "../../src/revisions.js";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { parseBundleBuffer, resealTrailer } from "../helpers/bundle.js";
import { NOW, REPOS, baseManifest, baseRequirement, makeWorkspace, passingWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const workspaces: Workspace[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((w) => w.cleanup()));
});
async function pass(): Promise<Workspace> {
  const w = await passingWorkspace();
  workspaces.push(w);
  return w;
}
async function bundled(): Promise<{ ws: Workspace; bundle: string }> {
  const ws = await pass();
  expect((await runCli(evalArgs(ws, ["--now", NOW]))).code).toBe(0);
  const bundle = join(ws.dir, "evidence.pgbundle");
  const r = await runCli(["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", bundle]);
  expect(r.code, r.stderr).toBe(0);
  return { ws, bundle };
}
const leftovers = (dir: string): string[] => readdirSync(dir).filter((n) => n.includes(".tmp-") || n.startsWith(".verify") || n.startsWith(".proofgate"));

describe("bundle integrity layers are distinguishable (A22)", () => {
  it("an entry edited by someone who also recomputes the trailer is caught by the entry hash, and says so", async () => {
    const { ws, bundle } = await bundled();
    const buf = Buffer.from(readFileSync(bundle));
    const parsed = parseBundleBuffer(buf);
    const idx = parsed.header.entries.findIndex((e) => e.role === "artifact");
    const start = buf.indexOf(parsed.bodies[idx] as Buffer);
    buf[start + 3] = (buf[start + 3] as number) ^ 0xff;
    const file = join(ws.dir, "resealed.pgbundle");
    await writeFile(file, resealTrailer(buf));
    const target = join(ws.dir, "resealed-restore");
    const r = await runCli(["bundle", "restore", file, "--output", target]);
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "bundle_corrupt"]);
    expect(r.stderr).toContain("does not match its recorded hash");
    expect(existsSync(target)).toBe(false);
    expect(leftovers(ws.dir)).toEqual([]);
  });

  it("a header edit that leaves every entry intact is caught by the whole-file checksum, and says so", async () => {
    const { ws, bundle } = await bundled();
    const text = readFileSync(bundle).toString("latin1");
    const edited = text.replace(/("created_at":"20)26/, "$125");
    expect(edited).not.toBe(text);
    const file = join(ws.dir, "header-edit.pgbundle");
    await writeFile(file, Buffer.from(edited, "latin1"));
    const target = join(ws.dir, "header-edit-restore");
    const r = await runCli(["bundle", "restore", file, "--output", target]);
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "bundle_corrupt"]);
    expect(r.stderr).toContain("bundle checksum does not match");
    expect(existsSync(target)).toBe(false);
  });
});

describe("truncation is refused at every structural boundary of a bundle", () => {
  it("cuts at the end of the magic line, the header, every entry start and end, and the trailer, each with its neighbours", async () => {
    const { ws, bundle } = await bundled();
    const full = readFileSync(bundle);
    const first = full.indexOf(0x0a);
    const second = full.indexOf(0x0a, first + 1);
    const parsed = parseBundleBuffer(full);
    const boundaries = new Set<number>([0, 1, first, first + 1, second, second + 1]);
    let pos = second + 1;
    for (const entry of parsed.header.entries) {
      boundaries.add(pos);
      pos += entry.size;
      boundaries.add(pos);
    }
    for (let back = 1; back <= 80; back += 3) boundaries.add(full.length - back); // through the trailer
    const cuts = [...boundaries].flatMap((b) => [b - 1, b, b + 1]).filter((c) => c >= 0 && c < full.length);
    expect(new Set(cuts).size).toBeGreaterThan(30);
    for (const cut of new Set(cuts)) {
      const file = join(ws.dir, "cut.pgbundle");
      await writeFile(file, full.subarray(0, cut));
      const target = join(ws.dir, `nest-${cut}`, "sub", "target");
      const r = await runCli(["bundle", "restore", file, "--output", target]);
      expect(r.code, `cut ${cut}`).toBe(2);
      expect(["bundle_truncated", "bundle_invalid_header"], `cut ${cut}: ${r.stderr}`).toContain(errorCode(r));
      expect(existsSync(join(ws.dir, `nest-${cut}`)), `cut ${cut}: nothing may be created`).toBe(false);
      expect((await runCli(["bundle", "verify", file])).code, `verify cut ${cut}`).toBe(2);
    }
    expect(leftovers(ws.dir)).toEqual([]);
  });
});

describe("the blob cap is exact (A38)", () => {
  it("artifacts totalling exactly the cap pass; one byte over fails with limit_blob_bytes", async () => {
    const ws = await makeWorkspace();
    workspaces.push(ws);
    await writeManifest(ws);
    await writeRevisions(ws);
    const content = "x".repeat(2048);
    await writeReceipt(ws, { artifact: content });
    const exact = await runCli(evalArgs(ws, ["--now", NOW, "--max-blob-bytes", String(content.length)]));
    expect(exact.code, exact.stderr).toBe(0);
    const over = await runCli(evalArgs({ ...ws, outputDir: join(ws.dir, "over") }, ["--now", NOW, "--max-blob-bytes", String(content.length - 1)]));
    expect([over.code, errorCode(over)]).toEqual([2, "limit_blob_bytes"]);
  });
});

describe("environment names are compared exactly (A63)", () => {
  it("a receipt for 'Staging' does not satisfy a requirement for 'staging' (and 'staging ' does not either)", async () => {
    for (const environment of ["Staging", "STAGING", "staging "]) {
      const ws = await makeWorkspace();
      workspaces.push(ws);
      await writeManifest(ws);
      await writeRevisions(ws);
      await writeReceipt(ws, { receipt: { environment } });
      const r = await runCli(evalArgs(ws, ["--now", NOW, "--json"]));
      expect(r.code, environment).toBe(1);
      const decision = (JSON.parse(r.stdout) as { requirements: Array<{ status: string; rejected_receipts: Array<{ reason_codes: string[] }> }> }).requirements[0];
      expect(decision?.status, environment).not.toBe("PASS");
      expect(decision?.rejected_receipts.flatMap((x) => x.reason_codes), environment).toContain("environment_mismatch");
    }
  });
});

describe("no accepted verdict without a mandatory requirement (A17)", () => {
  it("assess itself returns unsatisfied when a manifest with no mandatory requirement reaches it", () => {
    const parsed = parseManifestText(stringify(baseManifest({ requirements: [baseRequirement()] })));
    // The manifest loader refuses this shape; assess must not depend on that.
    (parsed.manifest.requirements[0] as { severity: string }).severity = "advisory";
    const revisions = parseRevisionsText(JSON.stringify({ schema_version: 1, revisions: [{ repository: "api", commit_sha: REPOS.api }, { repository: "web", commit_sha: REPOS.web }] }));
    const report = assess({
      manifest: parsed,
      revisions,
      receipts: [],
      now: new Date(NOW),
      inputSummary: { files_scanned: 0, receipt_documents: 0, metadata_bytes: 0, artifact_bytes: 0 },
      supersedes: null,
    });
    expect(report.verdict).toBe("unsatisfied");
    expect(report.exit_code).toBe(1);
  });
});

describe("the manifest and the revisions count together against the metadata limit (L2)", () => {
  it("each alone is under the limit, together they are over it: limit_metadata_bytes; at the exact sum it passes", async () => {
    const ws = await pass();
    const manifestBytes = readFileSync(ws.manifestPath).length;
    const revisionsBytes = readFileSync(ws.revisionsPath).length;
    const paths = { manifestPath: ws.manifestPath, revisionsPath: ws.revisionsPath, receiptsDir: ws.receiptsDir };
    const receiptBytes = readdirSync(ws.receiptsDir)
      .filter((n) => n.endsWith(".receipt.json"))
      .reduce((n, f) => n + readFileSync(join(ws.receiptsDir, f)).length, 0);
    // Room for the receipts, but one byte short of manifest + revisions together.
    await expect(loadInputs(paths, { maxMetadataBytes: manifestBytes + revisionsBytes - 1 })).rejects.toMatchObject({ code: "limit_metadata_bytes" });
    await expect(loadInputs(paths, { maxMetadataBytes: manifestBytes + revisionsBytes + receiptBytes })).resolves.toBeDefined();
    expect(manifestBytes).toBeLessThan(manifestBytes + revisionsBytes - 1);
  });

  it("the size limit is enforced before the manifest is parsed: an unparsable manifest over the combined limit reports the limit", async () => {
    const ws = await makeWorkspace();
    workspaces.push(ws);
    await writeFile(ws.manifestPath, "{ this is: [not, valid yaml\n".repeat(20));
    await writeRevisions(ws);
    const manifestBytes = readFileSync(ws.manifestPath).length;
    const revisionsBytes = readFileSync(ws.revisionsPath).length;
    const paths = { manifestPath: ws.manifestPath, revisionsPath: ws.revisionsPath, receiptsDir: ws.receiptsDir };
    const limit = Math.max(manifestBytes, revisionsBytes) + 1;
    expect(limit).toBeLessThan(manifestBytes + revisionsBytes);
    await expect(loadInputs(paths, { maxMetadataBytes: limit })).rejects.toMatchObject({ code: "limit_metadata_bytes" });
    // Control: with room for both, the same manifest is reported for what it is.
    await expect(loadInputs(paths, { maxMetadataBytes: manifestBytes + revisionsBytes })).rejects.toMatchObject({ code: "manifest_parse_error" });
    expect(revisionsBytes).toBeLessThan(manifestBytes + revisionsBytes - 1);
  });
});

describe("a URL as an artifact path is refused as a URL (A30)", () => {
  it.each(["https://example.invalid/a.xml", "file:///etc/hosts", "s3://bucket/key", "ftp://x/y"])("%s", (path) => {
    expect(() => validateRelativePath(path)).toThrowError(/URLs are never fetched/);
  });
  it("a relative path that merely contains a colon is not called a URL", () => {
    expect(validateRelativePath("artifacts/run:1/report.xml")).toBe("artifacts/run:1/report.xml");
  });
});
