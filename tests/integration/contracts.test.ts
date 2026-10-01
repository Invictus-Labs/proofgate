import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, symlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES } from "../../src/errors.js";
import { REASON_DESCRIPTIONS } from "../../src/reasons.js";
import { PROOFGATE_VERSION, POLICY_ENGINE_VERSION } from "../../src/version.js";
import { evaluatePaths } from "../../src/pipeline.js";
import { exportBundle } from "../../src/bundle.js";
import { parseBundleBuffer } from "../helpers/bundle.js";
import { ROOT } from "../helpers/cli.js";
import { NOW, baseManifest, passingWorkspace, uuid, sha256, REPOS, type Workspace } from "../helpers/fixture.js";

const schema = (name: string) => JSON.parse(readFileSync(join(ROOT, "schemas", name), "utf8")) as object;
const ajv = () => new Ajv2020({ strict: false, allErrors: true });
const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

describe("published JSON Schemas", () => {
  it("match the runtime validators (no drift)", () => {
    const out = execFileSync(process.execPath, [join(ROOT, "scripts", "generate-schemas.mjs"), "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain("schemas match the runtime validators");
  });

  it("every schema file compiles and carries a versioned $id", () => {
    const files = readdirSync(join(ROOT, "schemas")).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(["event-envelope.json", "evidence-bundle.json", "manifest.json", "receipt.json", "report.json", "revisions.json", "runproof-run-detail.json"]);
    for (const f of files) {
      const doc = schema(f) as { $id: string };
      expect(doc.$id).toMatch(/^urn:proofgate:schema:[a-z-]+:1$/);
      expect(() => ajv().compile(doc), f).not.toThrow();
    }
  });

  it("accept real documents produced by the tool and reject hostile variants", async () => {
    const ws = await passingWorkspace();
    made.push(ws);
    const { report } = await evaluatePaths({ manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputDir: ws.outputDir, now: new Date(NOW) });
    const bundleFile = join(ws.dir, "s.pgbundle");
    await exportBundle({ reportPath: ws.outputDir, manifestPath: ws.manifestPath, receiptsDir: ws.receiptsDir, revisionsPath: ws.revisionsPath, outputFile: bundleFile });
    const header = parseBundleBuffer(readFileSync(bundleFile)).header;
    const receiptFile = readdirSync(ws.receiptsDir).find((f) => f.endsWith(".receipt.json")) as string;
    const receipt = JSON.parse(readFileSync(join(ws.receiptsDir, receiptFile), "utf8"));
    const revisions = JSON.parse(readFileSync(ws.revisionsPath, "utf8"));
    const runproof = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "runproof", "run-detail.fixture.json"), "utf8"));
    const envelope = { schema_version: 1, event_id: "e1", source: "proofgate", resource_id: "r1", event_type: "assessment.completed", occurred_at: NOW, revision: "1", evidence_ref: `sha256:${sha256("x")}` };

    const cases: Array<[string, unknown, (d: any) => unknown]> = [
      ["manifest.json", baseManifest(), (d) => ({ ...d, extra: 1 })],
      ["receipt.json", receipt, (d) => ({ ...d, extra: 1 })],
      ["revisions.json", revisions, (d) => ({ ...d, revisions: [{ repository: "api", commit_sha: "short" }] })],
      ["report.json", report, (d) => ({ ...d, verdict: "maybe" })],
      ["evidence-bundle.json", header, (d) => ({ ...d, entries: [] })],
      ["event-envelope.json", envelope, (d) => ({ ...d, schema_version: 2 })],
      ["runproof-run-detail.json", runproof, (d) => ({ ...d, source_kind: "live" })],
    ];
    for (const [file, good, break_] of cases) {
      const validate = ajv().compile(schema(file));
      expect(validate(good), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
      expect(validate(break_(good)), `${file} hostile variant`).toBe(false);
    }
  });

  it("the receipt schema requires a full 40-hex SHA and a 64-hex artifact hash", () => {
    const validate = ajv().compile(schema("receipt.json"));
    const good = { schema_version: 1, receipt_id: uuid(1), requirement_ids: ["REQ-1"], repository: "api", commit_sha: REPOS.api, runner_id: "r", environment: "e", test_level: "unit", execution_kind: "live", result: "pass", tests: { total: 1, passed: 1, failed: 0, skipped: 0 }, artifact: { path: "a", sha256: sha256("a") }, finished_at: NOW };
    expect(validate(good)).toBe(true);
    expect(validate({ ...good, commit_sha: REPOS.api.slice(0, 7) })).toBe(false);
    expect(validate({ ...good, artifact: { path: "a", sha256: "abc" } })).toBe(false);
  });
});

describe("packaged executable", () => {
  it("runs through a symlinked bin (as npm installs it) and reports its version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pg-bin-"));
    try {
      const link = join(dir, "proofgate");
      symlinkSync(join(ROOT, "dist", "cli.js"), link);
      const out = execFileSync(process.execPath, [link, "--version"], { encoding: "utf8" });
      expect(out.trim()).toBe(PROOFGATE_VERSION);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("declares a bin entry that points at the built CLI", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.bin).toEqual({ proofgate: "dist/cli.js" });
    expect(readFileSync(join(ROOT, "dist", "cli.js"), "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  });
});

describe("documented contracts", () => {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("package.json version and the compiled constant agree", () => {
    expect(JSON.parse(read("package.json")).version).toBe(PROOFGATE_VERSION);
    expect(POLICY_ENGINE_VERSION).toBe(2); // bumped by review round 1: decision rules changed
  });

  it("every stable error code is documented in docs/INTERFACES.md", () => {
    const doc = read("docs/INTERFACES.md");
    const missing = ERROR_CODES.filter((code) => !doc.includes(`\`${code}\``));
    expect(missing).toEqual([]);
  });

  it("every decision reason code is documented in docs/INTERFACES.md", () => {
    const doc = read("docs/INTERFACES.md");
    const missing = Object.keys(REASON_DESCRIPTIONS).filter((code) => !doc.includes(`\`${code}\``));
    expect(missing).toEqual([]);
  });

  it("the frozen schema documentation names every schema file", () => {
    const doc = read("docs/SCHEMAS.md");
    for (const f of readdirSync(join(ROOT, "schemas"))) expect(doc, f).toContain(`schemas/${f}`);
  });
});
