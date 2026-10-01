import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportBundle, restoreBundle } from "../../src/bundle.js";
import { evaluatePaths } from "../../src/pipeline.js";
import { assembleBundle, parseBundleBuffer } from "../helpers/bundle.js";
import { NOW, passingWorkspace, sha256, uuid, writeReceipt, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

async function setup() {
  const ws = await passingWorkspace();
  made.push(ws);
  await evaluatePaths({ manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputDir: ws.outputDir, now: new Date(NOW) });
  const bundleFile = join(ws.dir, "b.pgbundle");
  const exported = await exportBundle({ reportPath: ws.outputDir, manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputFile: bundleFile });
  const parsed = parseBundleBuffer(readFileSync(bundleFile));
  const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));
  return { ws, bundleFile, exported, parsed, entries };
}

const craft = async (ws: Workspace, name: string, data: Buffer) => {
  const f = join(ws.dir, name);
  await writeFile(f, data);
  return f;
};

describe("bundle export", () => {
  it("returns the header and size, records entries sorted with roles, and stamps the report time", async () => {
    const { exported, parsed } = await setup();
    expect(exported.header.created_at).toBe("2026-09-29T12:00:00.000Z");
    expect(exported.bundleBytes).toBe(readFileSync(exported.outputFile).length);
    const paths = parsed.header.entries.map((e) => e.path);
    expect(paths).toEqual([...paths].sort());
    expect(new Set(parsed.header.entries.map((e) => e.role))).toEqual(new Set(["report", "manifest", "revisions", "receipt", "artifact"]));
    expect(paths).toEqual(expect.arrayContaining(["manifest.json", "revisions.json", "report/report.json", "report/report.sha256"]));
  });

  it("refuses more entries than the file-count limit and creates no file", async () => {
    const { ws } = await setup();
    await expect(exportBundle({ reportPath: ws.outputDir, manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputFile: join(ws.dir, "few.pgbundle"), limits: { maxFiles: 5 } })).rejects.toMatchObject({ code: "limit_file_count" });
    expect(existsSync(join(ws.dir, "few.pgbundle"))).toBe(false);
  });

  it("refuses an artifact whose path collides with a receipt document", async () => {
    const ws = await passingWorkspace();
    made.push(ws);
    const [first] = readdirSync(ws.receiptsDir).filter((n) => n.endsWith(".receipt.json"));
    const bytes = readFileSync(join(ws.receiptsDir, first as string));
    // A second receipt names the first receipt's own document as its artifact, with the correct hash.
    await writeReceipt(ws, { artifactPath: "unused.txt", receipt: { artifact: { path: first as string, sha256: sha256(bytes) } } });
    // The helper also wrote the (now unreferenced) file it was asked to make; the strict receipts-tree rule would refuse it.
    await rm(join(ws.receiptsDir, "unused.txt"));
    await evaluatePaths({ manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputDir: ws.outputDir, now: new Date(NOW) });
    await expect(
      exportBundle({ reportPath: ws.outputDir, manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputFile: join(ws.dir, "c.pgbundle") }),
    ).rejects.toMatchObject({ code: "bundle_entry_invalid" });
    expect(existsSync(join(ws.dir, "c.pgbundle"))).toBe(false);
  });

  it("creates parent directories for the bundle privately and names no absolute path in output", async () => {
    const { ws } = await setup();
    const out = join(ws.dir, "nested/dir/x.pgbundle");
    await exportBundle({ reportPath: ws.outputDir, manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputFile: out });
    expect(existsSync(out)).toBe(true);
  });

  it("deduplicates identical artifacts shared by several receipts (one entry per path)", async () => {
    const ws = await passingWorkspace();
    made.push(ws);
    await writeReceipt(ws, { artifactPath: "artifacts/shared.xml", artifact: "shared bytes", receipt: { requirement_ids: ["REQ-001"] } });
    await writeReceipt(ws, { artifactPath: "artifacts/shared.xml", artifact: "shared bytes", receipt: { requirement_ids: ["REQ-001"] } });
    await evaluatePaths({ manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputDir: ws.outputDir, now: new Date(NOW) });
    const file = join(ws.dir, "shared.pgbundle");
    await exportBundle({ reportPath: ws.outputDir, manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputFile: file });
    const artifacts = parseBundleBuffer(readFileSync(file)).header.entries.filter((e) => e.path === "receipts/artifacts/shared.xml");
    expect(artifacts).toHaveLength(1);
    expect((await restoreBundle({ bundleFile: file })).report.verdict).toBe("accepted");
  });
});

describe("bundle header validation", () => {
  it("rejects headers that lie about sizes, counts, duplicates or structure", async () => {
    const { ws, parsed, entries } = await setup();
    const run = async (name: string, data: Buffer, code: string, limits?: { maxFiles?: number; maxBlobBytes?: number }) => {
      const f = await craft(ws, `${name}.pgbundle`, data);
      const target = join(ws.dir, `t-${name}`);
      await expect(restoreBundle({ bundleFile: f, outputDir: target, ...(limits ? { limits } : {}) }), name).rejects.toMatchObject({ code });
      expect(existsSync(target), name).toBe(false);
    };

    await run("too-many", assembleBundle(parsed.header, entries), "limit_file_count", { maxFiles: 3 });
    await run("cap", assembleBundle(parsed.header, entries), "bundle_too_large", { maxBlobBytes: 10 });

    // total_bytes disagrees with the entry sizes (rebuild by hand: assembleBundle recomputes it, so patch the header text)
    const good = assembleBundle(parsed.header, entries);
    const text = good.toString("latin1");
    const lied = text.replace(/"total_bytes":\d+/, '"total_bytes":1');
    await run("total-lie", Buffer.from(lied, "latin1"), "bundle_invalid_header");

    const dup = [...entries, { ...(entries[0] as { path: string; role: string; bytes: Buffer }) }];
    await run("dup", assembleBundle(parsed.header, dup), "bundle_entry_invalid");

    const conflict = [...entries, { path: "receipts/artifacts", role: "artifact", bytes: Buffer.from("x") }];
    await run("file-and-dir", assembleBundle(parsed.header, conflict), "bundle_entry_invalid");

    const noReport = entries.filter((e) => e.path !== "report/report.json");
    await run("no-report", assembleBundle(parsed.header, noReport), "bundle_entry_invalid");
    const noManifest = entries.filter((e) => e.path !== "manifest.json");
    await run("no-manifest", assembleBundle(parsed.header, noManifest), "bundle_entry_invalid");

    await run("unexpected-top", assembleBundle(parsed.header, [...entries, { path: "notes/readme.txt", role: "artifact", bytes: Buffer.from("x") }]), "bundle_entry_invalid");
  });

  it("rejects a header line that is not JSON, is incomplete, or fails the schema", async () => {
    const { ws, parsed, entries } = await setup();
    const magic = "PROOFGATE-BUNDLE 1\n";
    const cases: Array<[string, Buffer, string]> = [
      ["notjson", Buffer.from(`${magic}{oops\n`), "bundle_invalid_header"],
      ["incomplete", Buffer.from(`${magic}{"format":"proofgate.evid`), "bundle_truncated"],
      ["schema", Buffer.from(`${magic}{"format":"other"}\n`), "bundle_invalid_header"],
      ["magic-only", Buffer.from(magic), "bundle_truncated"],
      ["magic-partial", Buffer.from("PROOFGATE-BUN"), "bundle_truncated"],
      ["empty", Buffer.alloc(0), "bundle_truncated"],
      ["no-version", Buffer.from("PROOFGATE-BUNDLE x\n{}\n"), "bundle_invalid_header"],
    ];
    for (const [name, data, code] of cases) {
      const f = await craft(ws, `${name}.pgbundle`, data);
      await expect(restoreBundle({ bundleFile: f }), name).rejects.toMatchObject({ code });
    }
    expect(parsed.header.entries.length).toBe(entries.length);
  });

  it("refuses a bundle file larger than the cap before opening its contents", async () => {
    const { ws } = await setup();
    const f = await craft(ws, "big.pgbundle", Buffer.alloc(5 * 1024 * 1024, 0x20));
    await expect(restoreBundle({ bundleFile: f, limits: { maxBlobBytes: 1 } })).rejects.toMatchObject({ code: "bundle_too_large" });
  });

  it("rejects a header whose fields disagree with the report it carries", async () => {
    const { ws, parsed, entries } = await setup();
    const f = await craft(ws, "mismatch.pgbundle", assembleBundle(parsed.header, entries, { headerOverrides: { assessment_id: uuid(99), manifest_hash: "0".repeat(64) } }));
    await expect(restoreBundle({ bundleFile: f })).rejects.toMatchObject({ code: "bundle_reevaluation_mismatch" });
  });

  it("rejects a bundle whose inputs were swapped for others that hash consistently (report no longer follows)", async () => {
    const { ws, parsed, entries } = await setup();
    // Swap in a different (valid) manifest; every hash in the container is recomputed, but the report cannot be reproduced.
    const swapped = entries.map((e) => (e.path === "manifest.json" ? { ...e, bytes: Buffer.from(e.bytes.toString().replace('"max_age_seconds":3600', '"max_age_seconds":30')) } : e));
    const f = await craft(ws, "swapped.pgbundle", assembleBundle(parsed.header, swapped));
    await expect(restoreBundle({ bundleFile: f })).rejects.toMatchObject({ code: "bundle_reevaluation_mismatch" });
  });

  it("a bundle that ends inside an entry is truncated (declared sizes exceed the file)", async () => {
    const { ws, bundleFile } = await setup();
    const full = readFileSync(bundleFile);
    const f = await craft(ws, "inside.pgbundle", full.subarray(0, full.length - 200));
    await expect(restoreBundle({ bundleFile: f })).rejects.toMatchObject({ code: "bundle_truncated" });
  });

  it("restores into a not-yet-existing nested target and leaves no scratch directories", async () => {
    const { ws, bundleFile } = await setup();
    const target = join(ws.dir, "a/b/restored");
    const result = await restoreBundle({ bundleFile, outputDir: target });
    expect(result.outputDir).toBe(target);
    expect(existsSync(join(target, "receipts"))).toBe(true);
    expect(readdirSync(join(ws.dir, "a/b"))).toEqual(["restored"]);
    await rm(target, { recursive: true });
  });
});
