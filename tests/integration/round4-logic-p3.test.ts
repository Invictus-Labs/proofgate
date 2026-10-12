/**
 * Review round 3 (logic re-review P3-1 to P3-4), treated as must-fix:
 *   P3-1  identifier fields were redacted BEFORE they were compared, so two different credential-looking values collapsed to one
 *         redacted text and matched (a receipt for another environment satisfied the requirement);
 *   P3-2  ENOENT was not an "output is unwritable" failure, so a missing TMPDIR blamed the bundle (bundle_corrupt);
 *   P3-3  a `__proto__` key on a RunProof run was silently dropped although the importer promises to preserve run fields;
 *   P3-4  `evaluate --replace` without `--output` was accepted and did nothing.
 * Every test that ends in a refusal fails on the round-2 tree BY ASSERTION (a different exit code or error code), not by a crash.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adaptRunproofDocument } from "../../src/adapters/runproof.js";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, baseManifest, baseRequirement, makeWorkspace, passingWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
  await Promise.all(scratch.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function pass(): Promise<Workspace> {
  const w = await passingWorkspace();
  made.push(w);
  return w;
}

/** Two different values that redact to the same text. Assembled from fragments so the file holds no credential-shaped literal. */
const looksLikeSecret = (letter: string): string => ["tok", "en=", letter.repeat(24)].join("");

describe("P3-1: an identifier that redaction would rewrite is refused, not compared in its redacted form", () => {
  it("control: the two values really do redact to the same text (this is the collision the fix must not allow)", async () => {
    const { redactString } = await import("../../src/redact.js");
    expect(redactString(looksLikeSecret("a"))).toBe(redactString(looksLikeSecret("b")));
    expect(redactString(looksLikeSecret("a"))).not.toBe(looksLikeSecret("a"));
  });

  it("a receipt for another environment does not satisfy a requirement whose environment looks like a credential", async () => {
    const w = await makeWorkspace();
    made.push(w);
    await writeManifest(w, baseManifest({ requirements: [baseRequirement({ required_environment: looksLikeSecret("a") })] }));
    await writeRevisions(w);
    await writeReceipt(w, { receipt: { environment: looksLikeSecret("b") } });
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(r.stdout).not.toContain("ACCEPTED");
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "manifest_schema_invalid"]);
    expect(r.stderr).toContain("required_environment");
  });

  it("a receipt whose environment looks like a credential is refused with a message that names the field (exit 2, not a silent mismatch)", async () => {
    const w = await pass();
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-env-1", environment: looksLikeSecret("c") } });
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "receipt_schema_invalid"]);
    expect(r.stderr).toContain("environment");
    expect(r.stderr).not.toContain("c".repeat(24));
  });

  it.each([
    ["receipt_id", (v: string) => ({ receipt_id: v })],
    ["repository", (v: string) => ({ repository: v })],
    ["requirement_ids", (v: string) => ({ requirement_ids: [v] })],
  ])("a credential-looking %s in a receipt is refused, not compared", async (field, make) => {
    const w = await pass();
    await writeReceipt(w, { receipt: { ...make(looksLikeSecret("d")) }, fileName: "planted.receipt.json" });
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
    expect(r.stdout).not.toContain("ACCEPTED");
    expect([r.code, errorCode(r)], `${field}: ${r.stderr}`).toEqual([2, "receipt_schema_invalid"]);
    expect(r.stderr, field).toContain("looks like a credential");
    expect(r.stderr).not.toContain("d".repeat(24));
  });

  it.each([
    ["a repository id", (v: string) => baseManifest({ repositories: [{ id: v }, { id: "web" }], requirements: [baseRequirement({ repositories: ["web"] })] })],
    ["a requirement id", (v: string) => baseManifest({ requirements: [baseRequirement({ id: v })] })],
  ])("a credential-looking %s in the manifest is refused", async (_label, make) => {
    const w = await makeWorkspace();
    made.push(w);
    await writeManifest(w, make(looksLikeSecret("e")));
    await writeRevisions(w);
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "manifest_schema_invalid"]);
    expect(r.stderr).toContain("looks like a credential");
    expect(r.stderr).not.toContain("e".repeat(24));
  });

  it("control: a credential in a free-text field (title, description, note) is still redacted, not refused", async () => {
    const w = await makeWorkspace();
    made.push(w);
    await writeManifest(w, baseManifest({ requirements: [baseRequirement({ title: `Checkout ${looksLikeSecret("f")}` })] }));
    await writeRevisions(w);
    await writeReceipt(w, { receipt: { extensions: { note: looksLikeSecret("g") } } });
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, r.stderr]).toEqual([0, expect.not.stringContaining("f".repeat(24))]);
    const report = readFileSync(join(w.outputDir, "report.json"), "utf8");
    expect(report).not.toContain("f".repeat(24));
    expect(report).not.toContain("g".repeat(24));
  });

  it("control: runner_id is reported, never compared, so a credential-looking value in it is redacted rather than refused", async () => {
    const w = await pass();
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-runner-1", runner_id: looksLikeSecret("h") }, fileName: "runner.receipt.json" });
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
    expect([r.code, r.stderr]).toEqual([0, expect.not.stringContaining("h".repeat(24))]);
    expect(readFileSync(join(w.dir, "second", "report.json"), "utf8")).not.toContain("h".repeat(24));
  });

  it("control: ordinary identifiers with dots, dashes, underscores and colons are compared as before", async () => {
    const w = await makeWorkspace();
    made.push(w);
    await writeManifest(w, baseManifest({ requirements: [baseRequirement({ id: "REQ.checkout-1_v2", required_environment: "eu-west.staging:blue" })] }));
    await writeRevisions(w);
    await writeReceipt(w, { receipt: { requirement_ids: ["REQ.checkout-1_v2"], environment: "eu-west.staging:blue" } });
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
  });
});

describe("P3-2: ENOENT and ENOTDIR on an output or temp path are output_unwritable, never a verdict on the bundle", () => {
  async function exportBundle(w: Workspace): Promise<string> {
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const bundle = join(w.dir, "b.pgbundle");
    const exp = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
    expect(exp.code, exp.stderr).toBe(0);
    return bundle;
  }
  async function withTmpdir<T>(value: string, fn: () => Promise<T>): Promise<T> {
    const before = process.env.TMPDIR;
    process.env.TMPDIR = value;
    try {
      return await fn();
    } finally {
      if (before === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = before;
    }
  }

  it("bundle verify with TMPDIR below a dangling symlink (ENOENT on the temp path) is output_unwritable and does not blame the bundle", async () => {
    const w = await pass();
    const bundle = await exportBundle(w);
    const dangling = join(w.dir, "dangling");
    symlinkSync(join(w.dir, "nowhere"), dangling);
    const r = await withTmpdir(join(dangling, "tmp"), () => runCli(["bundle", "verify", bundle]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "output_unwritable"]);
    expect(r.stderr).not.toContain("bundle_corrupt");
    // the bundle itself is fine
    expect((await runCli(["bundle", "verify", bundle])).code).toBe(0);
  });

  it("bundle verify with TMPDIR pointing at a regular file is output_unwritable too", async () => {
    const w = await pass();
    const bundle = await exportBundle(w);
    const file = join(w.dir, "not-a-directory");
    await writeFile(file, "x");
    const r = await withTmpdir(file, () => runCli(["bundle", "verify", bundle]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "output_unwritable"]);
    expect(r.stderr).not.toContain("bundle_corrupt");
  });

  it("bundle restore into a path whose parent is a regular file is output_unwritable", async () => {
    const w = await pass();
    const bundle = await exportBundle(w);
    const file = join(w.dir, "a-file");
    await writeFile(file, "x");
    const r = await runCli(["bundle", "restore", bundle, "--output", join(file, "restored")]);
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "output_unwritable"]);
    expect(r.stderr).not.toContain("bundle_corrupt");
  });

  it("evaluate with an output path below a regular file is output_unwritable (not internal_error)", async () => {
    const w = await pass();
    const file = join(w.dir, "a-file");
    await writeFile(file, "x");
    const r = await runCli(evalArgs({ ...w, outputDir: join(file, "report") }, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "output_unwritable"]);
  });

  it("a damaged bundle is still bundle_corrupt or bundle_truncated: the mapping does not hide real bundle faults", async () => {
    const w = await pass();
    const bundle = await exportBundle(w);
    const bytes = readFileSync(bundle);
    const damaged = join(w.dir, "damaged.pgbundle");
    const copy = Buffer.from(bytes);
    copy[copy.length - 100] = copy[copy.length - 100]! ^ 0xff;
    await writeFile(damaged, copy);
    const r = await runCli(["bundle", "verify", damaged]);
    expect(r.code).toBe(2);
    expect(["bundle_corrupt", "bundle_truncated"]).toContain(errorCode(r));
  });
});

describe("P3-3: a __proto__ key on a RunProof run is refused, never silently dropped", () => {
  const fixturePath = join(import.meta.dirname, "..", "fixtures", "runproof", "run-detail.fixture.json");
  const docWithProto = (): Record<string, any> => {
    const text = readFileSync(fixturePath, "utf8");
    const doc = JSON.parse(text) as Record<string, any>;
    doc.source_kind = "operator_capture";
    // JSON.parse (unlike an object literal) creates "__proto__" as an own data property, which is how a hostile file arrives.
    doc.run = JSON.parse(`{"__proto__":{"exit_code":1},"note":"kept",${JSON.stringify(doc.run).slice(1)}`);
    return doc;
  };
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return undefined;
  };

  it("control: the same run without the key imports and keeps its unmapped field", () => {
    const doc = docWithProto();
    delete (doc.run as Record<string, unknown>)["__proto__"];
    const out = adaptRunproofDocument(doc, "run.receipt.json");
    expect((out.receipt.extensions?.runproof as { unmapped_run_fields: Record<string, unknown> }).unmapped_run_fields.note).toBe("kept");
  });

  it("the adapter refuses a run that carries the key", () => {
    const doc = docWithProto();
    expect(Object.hasOwn(doc.run, "__proto__")).toBe(true);
    expect(codeOf(() => adaptRunproofDocument(doc, "run.receipt.json"))).toBe("runproof_schema_invalid");
  });

  it("the same document as a receipt file is refused end to end with a stable code", async () => {
    const w = await pass();
    const doc = docWithProto();
    // stringify drops nothing here: write the text by hand so the key is present in the file
    const text = JSON.stringify(doc).replace('"run":{', '"run":{"__proto__":{"exit_code":1},');
    await mkdir(w.receiptsDir, { recursive: true });
    await writeFile(join(w.receiptsDir, "proto.receipt.json"), text);
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
    expect(r.stdout).not.toContain("ACCEPTED");
    expect(r.code).toBe(2);
    expect(["runproof_schema_invalid", "json_duplicate_key"]).toContain(errorCode(r));
  });
});

describe("P3-4: --replace only means something with --output", () => {
  it("evaluate --replace without --output is a usage error and writes nothing", async () => {
    const w = await pass();
    const r = await runCli(["evaluate", "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--replace", "--now", NOW]);
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "cli_usage"]);
    expect(r.stderr).toContain("--output");
    expect(r.stdout).toBe("");
  });

  it("control: --replace with --output over an existing report still works, and without --replace the second run is refused", async () => {
    const w = await pass();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(2);
    expect((await runCli(evalArgs(w, ["--now", NOW, "--replace"]))).code).toBe(0);
  });

  it("control: evaluate without --output and without --replace still prints the summary", async () => {
    const w = await pass();
    const r = await runCli(["evaluate", "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--now", NOW]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("ACCEPTED");
  });
});
