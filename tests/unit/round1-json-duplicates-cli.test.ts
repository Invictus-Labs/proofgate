/**
 * Review round 1 (owner-elevated): duplicate keys in receipts, revisions.json, report.json and the bundle header were
 * accepted with "last one wins", so {"result":"fail","result":"pass"} read as a pass. Each test here fails on the delivered tree.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, REPOS, baseManifest, makeWorkspace, passingWorkspace, sha256, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

describe("duplicate keys are rejected through the CLI (exit 2, json_duplicate_key), never resolved", () => {
  const made: Workspace[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((w) => w.cleanup()));
  });
  const fresh = async (): Promise<Workspace> => {
    const w = await passingWorkspace();
    made.push(w);
    return w;
  };

  it("a receipt {result: fail, result: pass} is refused instead of read as a pass", async () => {
    const ws = await fresh();
    const receiptFile = join(ws.receiptsDir, readdirSync(ws.receiptsDir).find((n) => n.endsWith(".receipt.json")) as string);
    const text = readFileSync(receiptFile, "utf8");
    // Same receipt, but it now visibly says fail first and pass last.
    await writeFile(receiptFile, text.replace('"result": "pass"', '"result": "fail",\n  "result": "pass"'));
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(r.code, r.stdout).toBe(2);
    expect(errorCode(r)).toBe("json_duplicate_key");
    expect(r.stderr).toContain("repeats the key");
  });

  it("a duplicate nested inside a receipt's extensions is refused too", async () => {
    const ws = await fresh();
    await writeReceipt(ws, { receipt: { receipt_id: "rcpt-nested" }, fileName: "nested.receipt.json" });
    const file = join(ws.receiptsDir, "nested.receipt.json");
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    doc.extensions = { "vendor.x": { a: 1 } };
    await writeFile(file, JSON.stringify(doc).replace('{"a":1}', '{"a":1,"a":2}'));
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(errorCode(r)).toBe("json_duplicate_key");
  });

  it("a revisions.json that lists a repository's commit twice under one key is refused", async () => {
    const ws = await fresh();
    await writeFile(ws.revisionsPath, `{"schema_version":1,"schema_version":1,"revisions":[{"repository":"api","commit_sha":"${REPOS.api}"},{"repository":"web","commit_sha":"${REPOS.web}"}]}`);
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("json_duplicate_key");
  });

  it("a JSON manifest with duplicate keys is refused by the YAML layer (manifest_parse_error)", async () => {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws, baseManifest());
    await writeFile(ws.manifestPath, JSON.stringify(baseManifest()).replace('"name":', '"name":"x","name":'));
    await writeRevisions(ws);
    await mkdir(ws.receiptsDir, { recursive: true });
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(errorCode(r)).toBe("manifest_parse_error");
  });

  it("explain refuses a report.json with a repeated key, even when report.sha256 is absent", async () => {
    const ws = await fresh();
    expect((await runCli(evalArgs(ws, ["--now", NOW]))).code).toBe(0);
    const file = join(ws.outputDir, "report.json");
    await writeFile(file, readFileSync(file, "utf8").replace('"verdict": "accepted"', '"verdict": "unsatisfied",\n  "verdict": "accepted"'));
    const r = await runCli(["explain", "REQ-001", "--report", file]);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("json_duplicate_key");
  });

  it("a bundle whose header repeats a key is refused before anything is written", async () => {
    const ws = await fresh();
    expect((await runCli(evalArgs(ws, ["--now", NOW]))).code).toBe(0);
    const bundle = join(ws.dir, "b.pgbundle");
    const exp = await runCli(["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", bundle]);
    expect(exp.code, exp.stderr).toBe(0);
    const buf = readFileSync(bundle);
    const first = buf.indexOf(0x0a);
    const second = buf.indexOf(0x0a, first + 1);
    const header = buf.toString("utf8", first + 1, second);
    const tampered = Buffer.concat([buf.subarray(0, first + 1), Buffer.from(`${header.slice(0, -1)},"assessment_id":"${sha256("x").slice(0, 8)}"}`), buf.subarray(second)]);
    const file = join(ws.dir, "dup.pgbundle");
    await writeFile(file, tampered);
    const target = join(ws.dir, "restored-dup");
    const r = await runCli(["bundle", "restore", file, "--output", target]);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("json_duplicate_key");
    expect(existsSync(target)).toBe(false);
  });
});
