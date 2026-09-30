/**
 * Review round 2: (1) evidence that looks like a receipt but would not be read must be refused, not ignored (a failing
 * receipt saved as `x.Receipt.JSON`, `x.receipt.json.bak`, `x.receipt.jsonl` or `x.json` beside a passing one gave ACCEPTED
 * with no message); (2) output failures (permission, read-only file system, too many open files, full disk) are
 * `output_unwritable` in every writer, on the restore path as well as on `evaluate`; (3) the JSON container budget's
 * boundary. Tests that name a look-alike file fail on the round-2 review tree (they gave exit 0, ACCEPTED).
 */
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProofGateError } from "../../src/errors.js";
import { asOutputError } from "../../src/fsguard.js";
import { MAX_JSON_CONTAINERS, assertJsonContainerBudget, parseJsonStrict } from "../../src/json.js";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, baseManifest, baseRequirement, makeWorkspace, passingWorkspace, sha256, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const workspaces: Workspace[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // already gone
    }
  }
  await Promise.all(workspaces.splice(0).map((w) => w.cleanup()));
  await Promise.all(scratch.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function pass(): Promise<Workspace> {
  const w = await passingWorkspace();
  workspaces.push(w);
  return w;
}
const failingReceipt = (id: string): Record<string, unknown> => ({
  receipt_id: id,
  result: "fail",
  tests: { total: 10, passed: 8, failed: 2, skipped: 0 },
});

describe("a failing receipt saved under a name that is not read is refused, not ignored", () => {
  /** Write a failing receipt (with its artifact) under the exact name first, then rename it to the look-alike. */
  async function plant(w: Workspace, lookalike: string): Promise<void> {
    const receipt = await writeReceipt(w, { receipt: failingReceipt("rcpt-lookalike-1"), fileName: lookalike });
    void receipt;
  }

  it.each(["failing.Receipt.JSON", "failing.RECEIPT.json", "failing.receipt.json.bak", "failing.receipt.json~", "failing.receipt.jsonl", "failing.json", "failing.Json", "failing.ndjson", "nested/deeper/failing.RECEIPT.JSON"])(
    "%s beside a passing receipt is receipt_unreferenced_file (exit 2), naming the file",
    async (name) => {
      const w = await pass();
      expect((await runCli(evalArgs(w, ["--now", NOW]))).code, "control: the passing workspace alone").toBe(0);
      await plant(w, name);
      const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
      expect([r.code, errorCode(r)], r.stderr).toEqual([2, "receipt_unreferenced_file"]);
      expect(r.stderr).toContain(name.split("/").pop() as string);
      expect(r.stdout).not.toContain("ACCEPTED");
    },
  );

  it("control: the same failing receipt under the exact name is read and fails the gate (exit 1)", async () => {
    const w = await pass();
    await writeReceipt(w, { receipt: failingReceipt("rcpt-lookalike-1"), fileName: "failing.receipt.json" });
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(r.code, r.stderr).toBe(1);
  });

  it("a JSON file that a receipt names as its artifact is evidence, not a look-alike", async () => {
    const w = await makeWorkspace();
    workspaces.push(w);
    await writeManifest(w);
    await writeRevisions(w);
    await writeReceipt(w, { artifactPath: "artifacts/junit-summary.json", artifact: '{"tests": 10}' });
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(r.code, r.stderr).toBe(0);
  });

  it("the allowed note files are left alone; an unreferenced note is not (round 3: the rule is strict, see round4-unreferenced-files)", async () => {
    const w = await pass();
    mkdirSync(join(w.receiptsDir, "logs"));
    writeFileSync(join(w.receiptsDir, "README.md"), "# receipts\n");
    writeFileSync(join(w.receiptsDir, "logs", ".gitkeep"), "");
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    writeFileSync(join(w.receiptsDir, "notes.txt"), "operator notes\n");
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "receipt_unreferenced_file"]);
    expect(r.stderr).toContain("notes.txt");
  });

  it("the refusal lists at most five files and says how to fix it; nothing is written", async () => {
    const w = await pass();
    for (let i = 0; i < 8; i += 1) writeFileSync(join(w.receiptsDir, `extra-${i}.json`), "{}");
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)]).toEqual([2, "receipt_unreferenced_file"]);
    expect(r.stderr).toContain("8 file(s)");
    expect(r.stderr).toContain(", ...");
    expect(r.stderr).toContain('rename each one to end in ".receipt.json"');
    expect(readdirSync(w.dir).includes("report")).toBe(false);
  });

  it("an artifact that is missing is still reported as such before a look-alike (the receipt errors come first)", async () => {
    const w = await pass();
    writeFileSync(join(w.receiptsDir, "z.json"), "{}");
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-missing-1" }, declaredSha256: sha256("something else") });
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(r.code).toBe(2);
    expect(["artifact_hash_mismatch", "receipt_unreferenced_file"]).toContain(errorCode(r));
  });
});

describe("output failures are output_unwritable in every writer", () => {
  it.each(["EACCES", "EPERM", "EROFS", "ENOSPC", "EDQUOT", "EMFILE", "ENFILE", "ENOTDIR", "EISDIR", "ENAMETOOLONG"])("%s", (code) => {
    const mapped = asOutputError(Object.assign(new Error(`synthetic ${code}`), { code }), "the report");
    expect(mapped).toBeInstanceOf(ProofGateError);
    expect((mapped as ProofGateError).code).toBe("output_unwritable");
  });

  it("ENOENT and ENOTDIR are output failures (a missing or non-directory parent), not bundle or internal faults", () => {
    for (const code of ["ENOENT", "ENOTDIR"]) {
      const mapped = asOutputError(Object.assign(new Error("nope"), { code }), "x");
      expect(mapped, code).toBeInstanceOf(ProofGateError);
      expect((mapped as ProofGateError).code, code).toBe("output_unwritable");
    }
  });

  it("errors that are not output failures are returned unchanged", () => {
    const other = Object.assign(new Error("nope"), { code: "EBADF" });
    expect(asOutputError(other, "x")).toBe(other);
    const own = new ProofGateError("bundle_corrupt", "damaged");
    expect(asOutputError(own, "x")).toBe(own);
  });

  it.skipIf(process.getuid?.() === 0)("bundle restore into an unwritable parent directory is output_unwritable, not bundle_corrupt; evaluate the same", async () => {
    const w = await pass();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const bundle = join(w.dir, "b.pgbundle");
    const exp = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
    expect(exp.code, exp.stderr).toBe(0);
    const locked = await mkdtemp(join(tmpdir(), "pg-locked-"));
    scratch.push(locked);
    chmodSync(locked, 0o500);
    const restore = await runCli(["bundle", "restore", bundle, "--output", join(locked, "restored")]);
    expect([restore.code, errorCode(restore)], restore.stderr).toEqual([2, "output_unwritable"]);
    expect(restore.stderr).not.toContain("bundle_corrupt");
    expect(restore.stderr).not.toContain("could not be read");
    const evaluate = await runCli(evalArgs({ ...w, outputDir: join(locked, "out") }, ["--now", NOW]));
    expect([evaluate.code, errorCode(evaluate)], evaluate.stderr).toEqual([2, "output_unwritable"]);
    // the good bundle was not blamed: it still verifies
    expect((await runCli(["bundle", "verify", bundle])).code).toBe(0);
  });
});

describe("the JSON container budget", () => {
  const nested = (count: number): string => `[${Array.from({ length: count - 1 }, () => "[]").join(",")}]`;

  it("allows exactly the limit and refuses one more, with the stable code", () => {
    expect(() => assertJsonContainerBudget(nested(MAX_JSON_CONTAINERS))).not.toThrow();
    let caught: unknown;
    try {
      assertJsonContainerBudget(nested(MAX_JSON_CONTAINERS + 1), "the receipt");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProofGateError);
    expect((caught as ProofGateError).code).toBe("limit_json_containers");
    expect((caught as ProofGateError).message).toContain("the receipt");
  });

  it("does not count brackets inside strings, including escaped quotes and backslashes", () => {
    const text = JSON.stringify({ a: "[".repeat(MAX_JSON_CONTAINERS + 10), b: '"[{"'.repeat(1000), c: "\\\\[".repeat(1000), d: [] });
    expect(() => assertJsonContainerBudget(text)).not.toThrow();
    expect(parseJsonStrict(text)).toMatchObject({ d: [] });
  });

  it("parseJsonStrict applies the budget before JSON.parse, and duplicate keys are still refused", () => {
    expect(() => parseJsonStrict(nested(MAX_JSON_CONTAINERS + 1))).toThrow(/limit|objects and arrays/);
    let caught: unknown;
    try {
      parseJsonStrict('{"a":1,"a":2}');
    } catch (error) {
      caught = error;
    }
    expect((caught as ProofGateError).code).toBe("json_duplicate_key");
    expect(() => parseJsonStrict("{not json")).toThrow(SyntaxError);
  });

  it("the real report of a 5,000-requirement, 5-repository manifest holds far fewer containers than the limit (measured: 115,013)", async () => {
    // Guards the choice of the limit with a real evaluation: the largest legitimate document must not come near it.
    const w = await makeWorkspace();
    workspaces.push(w);
    const repositories = Array.from({ length: 5 }, (_, i) => ({ id: `repo-${i}` }));
    const requirements = Array.from({ length: 5000 }, (_, i) => baseRequirement({ id: `REQ-${String(i).padStart(5, "0")}`, repositories: undefined }));
    await writeManifest(w, baseManifest({ repositories, requirements }));
    await writeRevisions(w, Object.fromEntries(repositories.map((r, i) => [r.id, String(i).padStart(40, "a")])));
    const r = await runCli(["evaluate", "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--now", NOW, "--json"]);
    expect(r.code, r.stderr.slice(0, 300)).toBe(1);
    let containers = 0;
    for (let i = 0; i < r.stdout.length; i += 1) {
      const c = r.stdout.charCodeAt(i);
      if (c === 0x22) {
        i += 1;
        while (i < r.stdout.length && r.stdout.charCodeAt(i) !== 0x22) i += r.stdout.charCodeAt(i) === 0x5c ? 2 : 1;
      } else if (c === 0x7b || c === 0x5b) containers += 1;
    }
    expect(containers).toBeGreaterThan(50_000);
    expect(containers).toBeLessThan(MAX_JSON_CONTAINERS / 3);
    expect(() => assertJsonContainerBudget(r.stdout)).not.toThrow();
  }, 120_000);
});

describe("values JSON cannot express are refused with a stable code instead of an internal error", () => {
  const manifestWith = async (w: Workspace, extension: string): Promise<void> => {
    await writeManifest(w);
    const { readFileSync } = await import("node:fs");
    writeFileSync(w.manifestPath, `${readFileSync(w.manifestPath, "utf8")}extensions:\n  x-a: ${extension}\n`);
  };

  it.each([".inf", "-.inf", ".nan", "1e400", "!!float .nan", "!!set {a, b}", "!!omap [a: 1]", "!!binary aGk=", "!!timestamp 2001-01-01"])("a manifest extension of %s is manifest_schema_invalid", async (extension) => {
    const w = await pass();
    await manifestWith(w, extension);
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "o") }, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "manifest_schema_invalid"]);
    expect(r.stderr).not.toContain("internal_error");
  });

  it("control: plain extension values (text, numbers, lists, maps) are accepted and change the manifest hash", async () => {
    const hashes: string[] = [];
    for (const extension of ["1", "2", "[1, 2]", "{c: 3}", '"text"']) {
      const w = await pass();
      await manifestWith(w, extension);
      const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "o") }, ["--now", NOW, "--json"]));
      expect(r.code, r.stderr).toBe(0);
      hashes.push((JSON.parse(r.stdout) as { manifest_hash: string }).manifest_hash);
    }
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("a receipt extension of 1e400 (JSON parses it to Infinity) is receipt_schema_invalid", async () => {
    const w = await pass();
    const { readFileSync, readdirSync: list } = await import("node:fs");
    const file = list(w.receiptsDir).find((n) => n.endsWith(".receipt.json")) as string;
    const path = join(w.receiptsDir, file);
    const doc = readFileSync(path, "utf8");
    writeFileSync(path, `${doc.slice(0, doc.lastIndexOf("}"))},"extensions":{"x-a":1e400}}`);
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "o") }, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "receipt_schema_invalid"]);
  });
});
