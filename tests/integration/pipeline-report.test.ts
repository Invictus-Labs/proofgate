import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { explainRequirement } from "../../src/explain.js";
import { evaluatePaths, loadInputs } from "../../src/pipeline.js";
import { readReport, reportContentHash, serializeReport } from "../../src/report.js";
import { canonicalize } from "../../src/canonical.js";
import { ROOT, errorCode, runCli } from "../helpers/cli.js";
import { NOW, baseManifest, baseRequirement, passingWorkspace, writeManifest, writeReceipt, makeWorkspace, writeRevisions, type Workspace } from "../helpers/fixture.js";

/** A process that could not be started or was killed is never reported as exit status 1, which means "policy unsatisfied". */
const SPAWN_FAILED = -1;

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});
const fresh = async () => {
  const ws = await passingWorkspace();
  made.push(ws);
  return ws;
};
const opts = (ws: Workspace, extra: Record<string, unknown> = {}) => ({
  manifestPath: ws.manifestPath,
  receiptsDir: ws.receiptsDir,
  revisionsPath: ws.revisionsPath,
  now: new Date(NOW),
  ...extra,
});

describe("evaluatePaths", () => {
  it("evaluates without writing when no output directory is given", async () => {
    const ws = await fresh();
    const result = await evaluatePaths(opts(ws));
    expect(result.exitCode).toBe(0);
    expect(result.outputDir).toBeUndefined();
    expect(existsSync(ws.outputDir)).toBe(false);
    expect(result.report.input_summary).toMatchObject({ receipt_documents: 1 });
  });

  it("writes report.json, report.sha256 and an optional HTML render, atomically and privately", async () => {
    const ws = await fresh();
    const result = await evaluatePaths(opts(ws, { outputDir: ws.outputDir, renderHtml: (r: { assessment_id: string }) => `<html>${r.assessment_id}</html>` }));
    expect(readdirSync(ws.outputDir).sort()).toEqual(["index.html", "report.json", "report.sha256"]);
    expect(statSync(join(ws.outputDir, "index.html")).mode & 0o777).toBe(0o600);
    const { report } = await readReport(ws.outputDir);
    expect(report.assessment_id).toBe(result.report.assessment_id);
    expect((await readFile(join(ws.outputDir, "report.sha256"), "utf8")).trim()).toBe(reportContentHash(report));
    // serialisation is canonical key order, pretty printed
    expect(readFileSync(join(ws.outputDir, "report.json"), "utf8")).toBe(serializeReport(report));
    expect(JSON.stringify(JSON.parse(readFileSync(join(ws.outputDir, "report.json"), "utf8")))).toBe(canonicalize(report));
  });

  it("supports an async renderer and creates missing parent directories privately", async () => {
    const ws = await fresh();
    const out = join(ws.dir, "deep/er/report");
    await evaluatePaths(opts(ws, { outputDir: out, renderHtml: async () => "<p>hi</p>" }));
    expect(readFileSync(join(out, "index.html"), "utf8")).toBe("<p>hi</p>");
    expect(statSync(join(ws.dir, "deep")).mode & 0o777).toBe(0o700);
  });

  it("leaves no temporary directory and no report behind when evaluation fails", async () => {
    const ws = await fresh();
    await writeFile(join(ws.receiptsDir, "bad.receipt.json"), "{");
    await expect(evaluatePaths(opts(ws, { outputDir: ws.outputDir }))).rejects.toMatchObject({ code: "receipt_invalid_json" });
    expect(existsSync(ws.outputDir)).toBe(false);
    expect(readdirSync(ws.dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  it("does not leave a half-written report if the renderer throws", async () => {
    const ws = await fresh();
    await expect(evaluatePaths(opts(ws, { outputDir: ws.outputDir, renderHtml: () => { throw new Error("render boom"); } }))).rejects.toThrow(/render boom/);
    expect(existsSync(ws.outputDir)).toBe(false);
  });

  it("refuses an existing output without --replace, before doing any work", async () => {
    const ws = await fresh();
    await mkdir(ws.outputDir);
    await writeFile(join(ws.outputDir, "keep"), "1");
    await expect(evaluatePaths(opts(ws, { outputDir: ws.outputDir }))).rejects.toMatchObject({ code: "output_exists" });
    expect(readFileSync(join(ws.outputDir, "keep"), "utf8")).toBe("1");
  });

  it("archives an unreadable previous output when replacing, never deleting it", async () => {
    const ws = await fresh();
    await mkdir(ws.outputDir);
    await writeFile(join(ws.outputDir, "report.json"), "{not json");
    const result = await evaluatePaths(opts(ws, { outputDir: ws.outputDir, replace: true }));
    expect(result.report.supersedes).toBeNull();
    const archives = readdirSync(ws.dir).filter((n) => n.startsWith("report.superseded-unreadable-"));
    expect(archives).toHaveLength(1);
    expect(readFileSync(join(ws.dir, archives[0] as string, "report.json"), "utf8")).toBe("{not json");
  });

  it("replacing an existing valid report of the same inputs records supersedes without a policy change", async () => {
    const ws = await fresh();
    const first = await evaluatePaths(opts(ws, { outputDir: ws.outputDir }));
    const second = await evaluatePaths(opts(ws, { outputDir: ws.outputDir, replace: true, now: new Date("2026-09-29T12:05:00Z") }));
    expect(second.report.supersedes).toMatchObject({ assessment_id: first.report.assessment_id, policy_changed: false });
    expect(second.report.assessment_id).not.toBe(first.report.assessment_id);
  });

  it("applies the cumulative metadata limit across manifest, revisions and receipts", async () => {
    const ws = await fresh();
    const manifestBytes = statSync(ws.manifestPath).size;
    const revisionBytes = statSync(ws.revisionsPath).size;
    const receiptBytes = readdirSync(ws.receiptsDir).filter((n) => n.endsWith(".receipt.json")).reduce((n, f) => n + statSync(join(ws.receiptsDir, f)).size, 0);
    const total = manifestBytes + revisionBytes + receiptBytes;
    await expect(loadInputs(opts(ws), { maxMetadataBytes: total - 1 })).rejects.toMatchObject({ code: "limit_metadata_bytes" });
    await expect(loadInputs(opts(ws), { maxMetadataBytes: manifestBytes + revisionBytes - 1 })).rejects.toMatchObject({ code: "limit_metadata_bytes" });
    expect((await loadInputs(opts(ws), { maxMetadataBytes: total })).metadataBytes).toBe(total);
  });

  it("ignores files that are not receipts (artifacts and notes) but still counts them", async () => {
    const ws = await fresh();
    await writeFile(join(ws.receiptsDir, "README.txt"), "notes");
    // Review rounds 2 and 3: this used to be "not-a-receipt.json". Any file that is neither a receipt, a referenced artifact
    // nor an allowed note name is now refused (`receipt_unreferenced_file`, tests/integration/round4-unreferenced-files.test.ts),
    // so the second ignored file here is a placeholder.
    await writeFile(join(ws.receiptsDir, ".gitkeep"), "");
    const result = await evaluatePaths(opts(ws));
    expect(result.exitCode).toBe(0);
    expect(result.report.input_summary.files_scanned).toBe(4); // artifact, receipt, README, .gitkeep (directories are not files)
    expect(result.report.input_summary.receipt_documents).toBe(1);
  });

  it("scans receipts in nested directories", async () => {
    const ws = await track(makeWorkspace());
    const w = await ws;
    await writeManifest(w);
    await writeRevisions(w);
    await writeReceipt(w, { fileName: "team/a/one.receipt.json", artifactPath: "team/a/evidence.txt" });
    expect((await evaluatePaths(opts(w))).exitCode).toBe(0);
  });
});

function track(p: Promise<Workspace>): Promise<Workspace> {
  return p.then((w) => {
    made.push(w);
    return w;
  });
}

describe("readReport", () => {
  it("accepts a report.json path or its directory; report.sha256 is required unless the caller opts out", async () => {
    const ws = await fresh();
    await evaluatePaths(opts(ws, { outputDir: ws.outputDir }));
    expect((await readReport(join(ws.outputDir, "report.json"))).report.verdict).toBe("accepted");
    expect((await readReport(ws.outputDir)).report.verdict).toBe("accepted");
    await rm(join(ws.outputDir, "report.sha256"));
    await expect(readReport(ws.outputDir)).rejects.toMatchObject({ code: "report_invalid" });
    await expect(readReport(join(ws.outputDir, "report.json"))).rejects.toMatchObject({ code: "report_invalid" });
    expect((await readReport(ws.outputDir, { requireHash: false })).report.verdict).toBe("accepted");
  });

  it("rejects missing, malformed, mis-versioned and tampered reports with stable codes", async () => {
    const ws = await fresh();
    await expect(readReport(join(ws.dir, "nowhere"))).rejects.toMatchObject({ code: "report_not_found" });
    await mkdir(join(ws.dir, "empty"));
    await expect(readReport(join(ws.dir, "empty"))).rejects.toMatchObject({ code: "report_not_found" });
    await writeFile(join(ws.dir, "bad.json"), "{");
    await expect(readReport(join(ws.dir, "bad.json"))).rejects.toMatchObject({ code: "report_invalid" });
    await writeFile(join(ws.dir, "future.json"), JSON.stringify({ schema_version: 2 }));
    await expect(readReport(join(ws.dir, "future.json"))).rejects.toMatchObject({ code: "unsupported_schema_version" });
    await writeFile(join(ws.dir, "shape.json"), JSON.stringify({ schema_version: 1 }));
    await expect(readReport(join(ws.dir, "shape.json"))).rejects.toMatchObject({ code: "report_invalid" });
    await evaluatePaths(opts(ws, { outputDir: ws.outputDir }));
    await writeFile(join(ws.outputDir, "report.sha256"), `${"0".repeat(64)}\n`);
    await expect(readReport(ws.outputDir)).rejects.toMatchObject({ code: "report_invalid" });
  });

  it("rejects an oversized report file before reading it", async () => {
    const ws = await fresh();
    await writeFile(join(ws.dir, "huge.json"), Buffer.alloc(26 * 1024 * 1024, 0x20));
    await expect(readReport(join(ws.dir, "huge.json"))).rejects.toMatchObject({ code: "limit_metadata_bytes" });
  });
});

describe("explainRequirement", () => {
  it("explains deferred, receipt-less and unindexed-receipt cases", async () => {
    const ws = await track(makeWorkspace());
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement(), baseRequirement({ id: "REQ-D", deferred: { reason: "vendor sandbox unavailable" } }), baseRequirement({ id: "REQ-M" })] }));
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { requirement_ids: ["REQ-001", "REQ-D"] } });
    const { report } = await evaluatePaths(opts(ws));
    const deferred = explainRequirement(report, "REQ-D");
    expect(deferred).toContain("REQ-D  DEFERRED");
    expect(deferred).toContain("deferred: vendor sandbox unavailable");
    expect(deferred).toContain("evidence alone would say: PASS");
    const missing = explainRequirement(report, "REQ-M");
    expect(missing).toContain("source receipts: none");
    expect(missing).toContain("no_receipt");
    // a report whose receipt index lost an entry still prints the id
    const trimmed = { ...report, receipts: [] };
    expect(explainRequirement(trimmed, "REQ-001")).toContain(report.requirements[0]?.receipt_ids[0] as string);
    expect(() => explainRequirement(report, "req-001")).toThrowError(/not in this report/);
  });
});

describe("CLI surface", () => {
  it("prints help and version", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("proofgate evaluate");
    const none = await runCli([]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("Usage");
    expect((await runCli(["--version"])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await runCli(["help"])).code).toBe(0);
    expect((await runCli(["version"])).code).toBe(0);
  });

  it("evaluate --json prints the report and exit code follows the verdict", async () => {
    const ws = await fresh();
    const r = await runCli(["evaluate", "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--now", NOW, "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).verdict).toBe("accepted");
    expect(existsSync(ws.outputDir)).toBe(false);
  });

  it("uses the injected renderer for index.html and reports the replace/supersede lines", async () => {
    const ws = await fresh();
    let out = "";
    const io = { stdout: { write: (c: string) => (out += c) }, stderr: { write: () => undefined }, env: {}, renderer: () => "<html>ok</html>" };
    const { main } = await import("../../src/run.js");
    const args = ["evaluate", "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", ws.outputDir, "--now", NOW];
    expect(await main(args, io)).toBe(0);
    expect(readFileSync(join(ws.outputDir, "index.html"), "utf8")).toBe("<html>ok</html>");
    out = "";
    expect(await main([...args, "--replace"], io)).toBe(0);
    expect(out).toContain("supersedes");
    expect(out).toContain("report written to");
  });

  it("with the bundled web renderer present, report.json, report.sha256 and index.html are written", async () => {
    const ws = await fresh();
    await runCli(["evaluate", "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", ws.outputDir, "--now", NOW]);
    expect(readdirSync(ws.outputDir).sort()).toEqual(["index.html", "report.json", "report.sha256"]);
  });

  it("the renderer is part of the program, not an optional hook: the compiled CLI always writes index.html, and the page matches report.json", async () => {
    // Earlier versions probed for an optional dist/web/render.js; that hook is gone (a missing renderer now fails at
    // startup instead of silently producing a report without a page).
    const ws = await fresh();
    const r = await runNodeScript(join(ROOT, "dist", "cli.js"), ["evaluate", "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", ws.outputDir, "--now", NOW]);
    expect(r.code).toBe(0);
    expect(readdirSync(ws.outputDir).sort()).toEqual(["index.html", "report.json", "report.sha256"]);
    const { report } = await readReport(ws.outputDir);
    expect(readFileSync(join(ws.outputDir, "index.html"), "utf8")).toContain(report.assessment_id);
  });

  it("reports usage errors for every command", async () => {
    const cases: string[][] = [
      ["explain"],
      ["explain", "A", "B", "--report", "x"],
      ["explain", "A"],
      ["bundle"],
      ["bundle", "frobnicate"],
      ["bundle", "verify"],
      ["bundle", "verify", "a", "b"],
      ["bundle", "verify", "a", "--output", "x"],
      ["bundle", "restore", "a"],
      ["bundle", "export", "--report", "r"],
      ["evaluate", "--manifest"],
      ["evaluate", "--max-blob-bytes", "abc", "--manifest", "m", "--receipts", "r", "--revisions", "v"],
      ["evaluate", "extra-positional"],
    ];
    for (const args of cases) {
      const r = await runCli(args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(errorCode(r), args.join(" ")).toBe("cli_usage");
    }
  });

  it("maps unexpected failures to exit 2 with internal_error, redacts the message and leaves no report", async () => {
    const ws = await fresh();
    const { main } = await import("../../src/run.js");
    let err = "";
    const code = await main(["evaluate", "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", ws.outputDir, "--now", NOW], {
      stdout: { write: () => undefined },
      stderr: { write: (c: string) => (err += c) },
      env: {},
      renderer: () => {
        throw new Error("password=hunter2hunter2");
      },
    });
    expect(code).toBe(2);
    expect(err).toContain("error [internal_error]");
    expect(err).not.toContain("hunter2hunter2");
    expect(existsSync(ws.outputDir)).toBe(false);
  });
});

function runNodeScript(script: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { env: { PATH: process.env.PATH ?? "" } }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : SPAWN_FAILED;
      resolve({ code, stdout, stderr });
    });
  });
}
