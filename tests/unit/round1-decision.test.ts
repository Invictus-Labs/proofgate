/**
 * Review round 1 regression tests for the decision engine (findings L1 zero-test failures, L2 future-dated failures,
 * L6 requirement-level all_criteria_met, P6 quadratic receipt scan). Each test here fails on the delivered tree.
 */
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assess, classifyEvidence, decideRequirement, indexReceiptsByRequirement } from "../../src/evaluate.js";
import { hashCanonical } from "../../src/canonical.js";
import { parseManifestText } from "../../src/manifest.js";
import type { LoadedReceipt } from "../../src/receipt.js";
import { parseRevisionsText } from "../../src/revisions.js";
import type { NormalizedRequirement, Receipt } from "../../src/schemas.js";
import { evalArgs, runCli } from "../helpers/cli.js";
import { NOW, NOW_MS, REPOS, baseManifest, baseRequirement, isoAgo, passingWorkspace, uuid, writeReceipt, type Workspace } from "../helpers/fixture.js";

let n = 500;
function lr(overrides: Partial<Receipt> = {}): LoadedReceipt {
  n += 1;
  const receipt: Receipt = {
    receipt_id: uuid(n),
    requirement_ids: ["REQ-001"],
    repository: "api",
    commit_sha: REPOS.api,
    runner_id: "runner",
    environment: "staging",
    test_level: "integration",
    execution_kind: "live",
    result: "pass",
    tests: { total: 4, passed: 4, failed: 0, skipped: 0 },
    artifact: { path: "a.txt", sha256: "a".repeat(64) },
    finished_at: isoAgo(60),
    command: null,
    extensions: null,
    ...overrides,
  };
  return { receipt, adapter: { name: "proofgate.receipt", version: 1, provenance: "native" }, source_file: `${receipt.receipt_id}.receipt.json`, content_sha256: hashCanonical(receipt), source_document: {}, artifact_size: 1 };
}

const manifestOf = (reqs: Array<Record<string, unknown>>) => parseManifestText(stringify(baseManifest({ requirements: reqs })));
const revisions = parseRevisionsText(JSON.stringify({ schema_version: 1, revisions: [{ repository: "api", commit_sha: REPOS.api }, { repository: "web", commit_sha: REPOS.web }] }));
const req = (o: Record<string, unknown> = {}): NormalizedRequirement => manifestOf([baseRequirement(o)]).manifest.requirements[0] as NormalizedRequirement;
const decide = (r: NormalizedRequirement, receipts: LoadedReceipt[]) => decideRequirement(r, receipts, revisions, NOW_MS);
const zero = { total: 0, passed: 0, failed: 0, skipped: 0 };
const failing = { total: 4, passed: 3, failed: 1, skipped: 0 };
const FUTURE = new Date(NOW_MS + 5 * 60_000).toISOString();

describe("L1: a failing receipt with zero tests is a failure, never ignorable evidence", () => {
  it("classifies result=fail with total=0 as FAIL (not MISSING)", () => {
    const c = classifyEvidence(req(), lr({ result: "fail", tests: zero }), NOW_MS);
    expect(c.status).toBe("FAIL");
    expect(c.reasons).toContain("result_failed");
  });

  it("a fresh fail/zero-test receipt beside a passing receipt makes the requirement FAIL", () => {
    const d = decide(req(), [lr(), lr({ result: "fail", tests: zero })]);
    expect(d.status).toBe("FAIL");
    expect(d.reason_codes).toContain("result_failed");
    expect(d.reason_codes).toContain("conflicting_evidence");
  });

  it.each(["partial", "skipped"] as const)("a fresh zero-test result=%s beside a passing receipt keeps the requirement PARTIAL", (result) => {
    const d = decide(req(), [lr(), lr({ result, tests: zero })]);
    expect(d.status).toBe("PARTIAL");
    expect(d.reason_codes).toContain("zero_tests");
  });

  it("controls: a zero-test PASS claim is still ignorable beside real evidence, and alone it is MISSING", () => {
    expect(decide(req(), [lr(), lr({ result: "pass", tests: zero })]).status).toBe("PASS");
    const alone = decide(req(), [lr({ result: "pass", tests: zero })]);
    expect(alone.status).toBe("MISSING");
    expect(alone.reason_codes).toContain("zero_tests");
  });

  it("assess turns exit 0 into exit 1 when such a receipt is planted", () => {
    const manifest = manifestOf([baseRequirement()]);
    const run = (receipts: LoadedReceipt[]) =>
      assess({ manifest, revisions, receipts, now: new Date(NOW), inputSummary: { files_scanned: 1, receipt_documents: receipts.length, metadata_bytes: 1, artifact_bytes: 1 } });
    expect(run([lr()]).exit_code).toBe(0);
    expect(run([lr(), lr({ result: "fail", tests: zero })]).exit_code).toBe(1);
  });
});

describe("L2: a future-dated receipt never lets an older pass hide a failure", () => {
  it("an older pass plus a future-dated failing receipt is FAIL with receipt_from_future", () => {
    const d = decide(req(), [lr(), lr({ result: "fail", tests: failing, finished_at: FUTURE })]);
    expect(d.status).toBe("FAIL");
    expect(d.reason_codes).toEqual(expect.arrayContaining(["receipt_from_future", "tests_failed"]));
  });

  it("an older pass plus a future-dated partial receipt is PARTIAL", () => {
    const d = decide(req(), [lr(), lr({ result: "partial", tests: { total: 4, passed: 2, failed: 0, skipped: 2 }, finished_at: FUTURE })]);
    expect(d.status).toBe("PARTIAL");
    expect(d.reason_codes).toContain("receipt_from_future");
  });

  it("a lone future-dated failure is FAIL, not MISSING", () => {
    expect(decide(req(), [lr({ result: "fail", tests: failing, finished_at: FUTURE })]).status).toBe("FAIL");
  });

  it("controls: a future-dated PASS never counts and never blocks; identity mismatches stay rejected", () => {
    const withFuturePass = decide(req(), [lr(), lr({ finished_at: FUTURE })]);
    expect(withFuturePass.status).toBe("PASS");
    expect(withFuturePass.rejected_receipts.some((r) => r.reason_codes.includes("receipt_from_future"))).toBe(true);
    const lonePass = decide(req(), [lr({ finished_at: FUTURE })]);
    expect(lonePass.status).toBe("MISSING");
    const otherCommit = decide(req(), [lr(), lr({ result: "fail", tests: failing, finished_at: FUTURE, commit_sha: "f".repeat(40) })]);
    expect(otherCommit.status).toBe("PASS");
  });
});

describe("L6: requirement-level all_criteria_met is claimed only by a PASS", () => {
  it("a two-repository requirement with one passing and one failing repository does not list all_criteria_met", () => {
    const r = req({ repositories: ["api", "web"] });
    const d = decide(r, [lr(), lr({ repository: "web", commit_sha: REPOS.web, result: "fail", tests: failing })]);
    expect(d.status).toBe("FAIL");
    expect(d.reason_codes).not.toContain("all_criteria_met");
    expect(d.per_repository.find((p) => p.repository === "api")?.reason_codes).toContain("all_criteria_met");
  });

  it("PARTIAL by incomplete coverage does not list all_criteria_met; a full PASS does", () => {
    const r = req({ repositories: ["api", "web"] });
    const partial = decide(r, [lr()]);
    expect(partial.status).toBe("PARTIAL");
    expect(partial.reason_codes).not.toContain("all_criteria_met");
    expect(partial.reason_codes).toContain("incomplete_repository_coverage");
    const pass = decide(r, [lr(), lr({ repository: "web", commit_sha: REPOS.web })]);
    expect(pass.status).toBe("PASS");
    expect(pass.reason_codes).toContain("all_criteria_met");
  });
});

describe("P6: receipts are indexed by requirement once", () => {
  it("decisions are identical with and without the prebuilt index", () => {
    const reqs = Array.from({ length: 40 }, (_, i) => baseRequirement({ id: `REQ-${String(i).padStart(3, "0")}` }));
    const manifest = manifestOf(reqs);
    const receipts = Array.from({ length: 120 }, (_, i) =>
      lr({ requirement_ids: [`REQ-${String(i % 40).padStart(3, "0")}`, `REQ-${String((i * 7) % 40).padStart(3, "0")}`], result: i % 13 === 0 ? "fail" : "pass", tests: i % 13 === 0 ? failing : { total: 4, passed: 4, failed: 0, skipped: 0 } }),
    );
    const index = indexReceiptsByRequirement(receipts);
    for (const r of manifest.manifest.requirements) {
      expect(decideRequirement(r, receipts, revisions, NOW_MS, index)).toEqual(decideRequirement(r, receipts, revisions, NOW_MS));
    }
    expect([...index.values()].flat().length).toBeGreaterThan(120);
  });
});

describe("through the CLI (exit codes on real files)", () => {
  const made: Workspace[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((w) => w.cleanup()));
  });
  async function ws(): Promise<Workspace> {
    const w = await passingWorkspace();
    made.push(w);
    return w;
  }

  it("a passing workspace is exit 0; planting a fail/zero-test receipt flips it to exit 1", async () => {
    const w = await ws();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    await writeReceipt(w, { receipt: { result: "fail", tests: zero } });
    const r = await runCli(evalArgs(w, ["--now", NOW, "--replace"]));
    expect(r.code, r.stdout).toBe(1);
    const report = JSON.parse(readFileSync(join(w.outputDir, "report.json"), "utf8")) as { requirements: Array<{ status: string }> };
    expect(report.requirements[0]?.status).toBe("FAIL");
  });

  it("a future-dated failing receipt beside a passing one gives exit 1", async () => {
    const w = await ws();
    await writeReceipt(w, { receipt: { result: "fail", tests: failing, finished_at: FUTURE } });
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toContain("receipt_from_future");
  });
});
