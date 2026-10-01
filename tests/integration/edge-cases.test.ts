import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareStrings } from "../../src/canonical.js";
import { exportBundle, restoreBundle } from "../../src/bundle.js";
import { main } from "../../src/run.js";
import { evaluatePaths } from "../../src/pipeline.js";
import { readReport, writeReportDirectory } from "../../src/report.js";
import { errorCode, runCli } from "../helpers/cli.js";
import { NOW, makeWorkspace, passingWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});
async function evaluated() {
  const ws = await passingWorkspace();
  made.push(ws);
  const result = await evaluatePaths({ manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputDir: ws.outputDir, now: new Date(NOW) });
  return { ws, report: result.report };
}

describe("compareStrings", () => {
  it("orders by UTF-16 code unit, independent of locale, and treats equal strings as equal", () => {
    expect(compareStrings("a", "b")).toBe(-1);
    expect(compareStrings("b", "a")).toBe(1);
    expect(compareStrings("a", "a")).toBe(0);
    expect(compareStrings("Z", "a")).toBe(-1); // uppercase sorts before lowercase, unlike localeCompare
    expect(["b", "B", "a", "A"].sort(compareStrings)).toEqual(["A", "B", "a", "b"]);
  });
});

describe("report writing edge cases", () => {
  it("archives under a generic suffix when replacing without a known previous assessment id", async () => {
    const { ws, report } = await evaluated();
    await writeReportDirectory(ws.outputDir, report, { replace: true });
    expect(existsSync(`${ws.outputDir}.superseded-previous`)).toBe(true);
    await expect(readReport(ws.outputDir)).resolves.toBeTruthy();
  });

  it("refuses a report.json that is a directory", async () => {
    const { ws } = await evaluated();
    const odd = join(ws.dir, "odd");
    await mkdir(join(odd, "report.json"), { recursive: true });
    await expect(readReport(odd)).rejects.toMatchObject({ code: "report_not_found" });
  });
});

describe("bundle edge cases", () => {
  async function bundled() {
    const { ws, report } = await evaluated();
    const file = join(ws.dir, "e.pgbundle");
    await exportBundle({ reportPath: ws.outputDir, manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputFile: file });
    return { ws, report, file };
  }

  it("export enforces the cap on the whole bundle, not only on artifacts", async () => {
    const { ws } = await evaluated();
    // Artifacts are ~60 bytes, so loading inputs succeeds; the report, manifest and receipts push the bundle over the cap.
    await expect(
      exportBundle({ reportPath: ws.outputDir, manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputFile: join(ws.dir, "capped.pgbundle"), limits: { maxBlobBytes: 200 } }),
    ).rejects.toMatchObject({ code: "bundle_too_large" });
    expect(existsSync(join(ws.dir, "capped.pgbundle"))).toBe(false);
  });

  it("a directory given as the bundle path is reported as not found", async () => {
    const { ws } = await bundled();
    await expect(restoreBundle({ bundleFile: ws.dir })).rejects.toMatchObject({ code: "bundle_not_found" });
  });

  it("a damaged trailer marker (right length, wrong text) is reported as a damaged trailer", async () => {
    const { ws, file } = await bundled();
    const text = readFileSync(file).toString("latin1").replace("PROOFGATE-END ", "PROOFGATE-ENX ");
    const bad = join(ws.dir, "trailer.pgbundle");
    await writeFile(bad, Buffer.from(text, "latin1"));
    await expect(restoreBundle({ bundleFile: bad })).rejects.toMatchObject({ code: "bundle_truncated" });
    expect(readdirSync(ws.dir).filter((n) => n.includes(".tmp-") || n.startsWith(".proofgate"))).toEqual([]);
  });
});

describe("CLI edge cases", () => {
  it("connector with missing arguments still fails explicitly", async () => {
    for (const args of [["connector"], ["connector", "runproof"]]) {
      const r = await runCli(args);
      expect(r.code).toBe(2);
      expect(errorCode(r)).toBe("connector_disconnected");
    }
  });

  it("a thrown non-Error value is reported as an internal error, never as success", async () => {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws);
    let err = "";
    const code = await main(["evaluate", "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", ws.outputDir, "--now", NOW], {
      stdout: { write: () => undefined },
      stderr: { write: (c: string) => (err += c) },
      env: {},
      renderer: () => {
        throw "boom";
      },
    });
    expect(code).toBe(2);
    expect(err).toContain("internal_error");
    expect(existsSync(ws.outputDir)).toBe(false);
  });

  it("falls back to process.env and the process streams when no io is supplied", async () => {
    const original = process.stdout.write.bind(process.stdout);
    let seen = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      seen += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      expect(await main(["--version"])).toBe(0);
    } finally {
      process.stdout.write = original;
    }
    expect(seen).toMatch(/^\d+\.\d+\.\d+/);
  });
});
