/**
 * Acceptance tests for the ProofGate core, one describe block per PRD flow
 * (section 5b). The AC -> test reconciliation lives in docs/qa/ac-matrix.md and
 * uses these describe/test titles as the test IDs.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { escapeHtml } from "../src/escape.js";
import { EnvelopeDeduper, parseEnvelope } from "../src/adapters/envelope.js";
import { ERROR_CODES } from "../src/errors.js";
import { REASON_DESCRIPTIONS } from "../src/reasons.js";
import { ROOT, errorCode, evalArgs, runCli, runDist } from "./helpers/cli.js";
import { indexFile } from "./helpers/test-index.js";
import { FAKE, FAKE_CONTEXT, GLUED_TEXT, PLANTED_VALUES } from "./helpers/fake-secrets.js";
import {
  NOW,
  NOW_MS,
  REPOS,
  baseManifest,
  baseRequirement,
  isoAgo,
  makeWorkspace,
  nextId,
  passingWorkspace,
  sha256,
  uuid,
  writeManifest,
  writeReceipt,
  writeRevisions,
  type Workspace,
} from "./helpers/fixture.js";

const workspaces: Workspace[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((w) => w.cleanup()));
});
async function track(ws: Workspace): Promise<Workspace> {
  workspaces.push(ws);
  return ws;
}
async function fresh(): Promise<Workspace> {
  return track(await passingWorkspace());
}

type AnyReport = {
  assessment_id: string;
  policy_hash: string;
  evaluated_at: string;
  exit_code: number;
  verdict: string;
  supersedes: { policy_changed: boolean; assessment_id: string } | null;
  requirements: Array<{
    id: string;
    status: string;
    evidence_status: string;
    reason_codes: string[];
    receipt_ids: string[];
    environments: string[];
    severity: string;
    per_repository: Array<{ repository: string; status: string; reason_codes: string[] }>;
    rejected_receipts: Array<{ receipt_id: string; reason_codes: string[] }>;
  }>;
  receipts: Array<{ receipt_id: string }>;
};
function loadReport(ws: Workspace): AnyReport {
  return JSON.parse(readFileSync(join(ws.outputDir, "report.json"), "utf8")) as AnyReport;
}
async function evaluate(ws: Workspace, extra: string[] = ["--now", NOW]) {
  return runCli(evalArgs(ws, extra));
}
function decision(report: AnyReport, id = "REQ-001") {
  const d = report.requirements.find((r) => r.id === id);
  if (!d) throw new Error(`no decision for ${id}`);
  return d;
}

/* ============================================================ AC-01 */
describe("AC-01 schema and artifact tamper", () => {
  it("accepts well-formed inputs with exit 0 (happy path control)", async () => {
    const ws = await fresh();
    const r = await evaluate(ws);
    expect(r.code).toBe(0);
    expect(decision(loadReport(ws)).status).toBe("PASS");
  });

  it("rejects a malformed manifest (invalid YAML) with exit 2 and manifest_parse_error", async () => {
    const ws = await fresh();
    await writeFile(ws.manifestPath, "requirements: [unclosed\n  - nope: : :");
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("manifest_parse_error");
    expect(existsSync(ws.outputDir)).toBe(false);
  });

  it("rejects a manifest that violates the schema with manifest_schema_invalid and names the field", async () => {
    const ws = await fresh();
    const m = baseManifest();
    delete (m as Record<string, unknown>).name;
    await writeManifest(ws, m);
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("manifest_schema_invalid");
    expect(r.stderr).toContain("name");
  });

  it("rejects unknown manifest fields instead of dropping them", async () => {
    const ws = await fresh();
    await writeManifest(ws, baseManifest({ surprise: true }));
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("manifest_unknown_field");
  });

  it("rejects duplicate requirement IDs, including case-only duplicates", async () => {
    const ws = await fresh();
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement(), baseRequirement({ title: "again" })] }));
    expect(errorCode(await evaluate(ws))).toBe("manifest_duplicate_requirement_id");
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement(), baseRequirement({ id: "req-001" })] }));
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("manifest_duplicate_requirement_id");
  });

  it("rejects a receipt that references an unknown requirement ID", async () => {
    const ws = await fresh();
    await writeReceipt(ws, { receipt: { requirement_ids: ["REQ-001", "REQ-404"] } });
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("receipt_unknown_requirement");
    expect(r.stderr).toContain("REQ-404");
  });

  it("rejects unknown repository references in the manifest and in receipts", async () => {
    const ws = await fresh();
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ repositories: ["ghost"] })] }));
    expect(errorCode(await evaluate(ws))).toBe("manifest_unknown_repository");
    await writeManifest(ws);
    await writeReceipt(ws, { receipt: { repository: "ghost" } });
    expect(errorCode(await evaluate(ws))).toBe("receipt_unknown_repository");
  });

  it("rejects a tampered artifact (hash mismatch) with exit 2 and writes no report", async () => {
    const ws = await fresh();
    const original = await readdir(join(ws.receiptsDir, "artifacts"));
    const file = join(ws.receiptsDir, "artifacts", original[0] as string);
    await writeFile(file, `${readFileSync(file, "utf8")} `);
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("artifact_hash_mismatch");
    expect(existsSync(ws.outputDir)).toBe(false);
  });

  it("detects a single flipped byte in an artifact (failure boundary)", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    const content = Buffer.from("0123456789abcdef");
    const receipt = await writeReceipt(ws, { artifact: content });
    const flipped = Buffer.from(content);
    flipped[7] = (flipped[7] as number) ^ 0x01;
    await writeFile(join(ws.receiptsDir, (receipt.artifact as { path: string }).path), flipped);
    expect(errorCode(await evaluate(ws))).toBe("artifact_hash_mismatch");
  });

  it("rejects a receipt whose artifact file is missing", async () => {
    const ws = await fresh();
    const [name] = await readdir(join(ws.receiptsDir, "artifacts"));
    await rm(join(ws.receiptsDir, "artifacts", name as string));
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("artifact_missing");
  });

  it("recomputes the artifact hash from the file rather than trusting the receipt", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { declaredSha256: sha256("something else entirely") });
    expect(errorCode(await evaluate(ws))).toBe("artifact_hash_mismatch");
  });

  it("rejects invalid JSON and non-object receipts with stable codes", async () => {
    const ws = await fresh();
    await writeFile(join(ws.receiptsDir, "broken.receipt.json"), "{ not json");
    expect(errorCode(await evaluate(ws))).toBe("receipt_invalid_json");
    await writeFile(join(ws.receiptsDir, "broken.receipt.json"), "[1,2,3]");
    expect(errorCode(await evaluate(ws))).toBe("receipt_schema_invalid");
  });

  it("rejects a duplicate receipt ID across files", async () => {
    const ws = await fresh();
    const dup = uuid(4242);
    await writeReceipt(ws, { receipt: { receipt_id: dup }, fileName: "a.receipt.json" });
    await writeReceipt(ws, { receipt: { receipt_id: dup }, fileName: "b.receipt.json", artifactPath: "artifacts/dup2.xml" });
    expect(errorCode(await evaluate(ws))).toBe("receipt_duplicate_id");
  });

  it("returns exit 2 (not 1) for a missing manifest, revisions or receipts directory", async () => {
    const ws = await fresh();
    await rm(ws.manifestPath);
    expect(errorCode(await evaluate(ws))).toBe("manifest_not_found");
    await writeManifest(ws);
    await rm(ws.revisionsPath);
    expect(errorCode(await evaluate(ws))).toBe("revisions_not_found");
    await writeRevisions(ws);
    await rm(ws.receiptsDir, { recursive: true });
    expect(errorCode(await evaluate(ws))).toBe("receipts_dir_not_found");
  });
});

/* ============================================================ AC-02 */
describe("AC-02 revision mismatch", () => {
  it("a receipt for commit A does not satisfy commit B even when branch names match", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    const commitA = REPOS.api;
    const commitB = "b".repeat(40);
    await writeRevisions(ws, { api: commitB, web: REPOS.web });
    await writeReceipt(ws, { receipt: { commit_sha: commitA, extensions: { branch: "main" } } });
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.status).toBe("MISSING");
    expect(d.reason_codes).toContain("revision_mismatch");
    expect(d.rejected_receipts[0]?.reason_codes).toContain("revision_mismatch");
    expect(d.receipt_ids).toEqual([]);
  });

  it("the same receipt satisfies commit A (control: the mismatch, not the receipt, was the cause)", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws, { api: REPOS.api, web: REPOS.web });
    await writeReceipt(ws, { receipt: { commit_sha: REPOS.api, extensions: { branch: "main" } } });
    expect((await evaluate(ws)).code).toBe(0);
  });

  it("a one-character difference in the SHA is a mismatch", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    const off = `${REPOS.api.slice(0, 39)}${REPOS.api.endsWith("0") ? "1" : "0"}`;
    await writeRevisions(ws, { api: off, web: REPOS.web });
    await writeReceipt(ws);
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    expect(decision(loadReport(ws)).reason_codes).toContain("revision_mismatch");
  });

  const twoRepoManifest = () =>
    baseManifest({ requirements: [baseRequirement({ repositories: ["api", "web"] })] });

  it("multi-repository gates require every declared SHA: one repository alone is PARTIAL", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, twoRepoManifest());
    await writeRevisions(ws);
    await writeReceipt(ws);
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.status).toBe("PARTIAL");
    expect(d.reason_codes).toContain("incomplete_repository_coverage");
    expect(d.per_repository.map((p) => `${p.repository}:${p.status}`)).toEqual(["api:PASS", "web:MISSING"]);
  });

  it("multi-repository gate passes only when both declared repositories match their SHAs", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, twoRepoManifest());
    await writeRevisions(ws);
    await writeReceipt(ws);
    await writeReceipt(ws, { receipt: { repository: "web", commit_sha: REPOS.web } });
    expect((await evaluate(ws)).code).toBe(0);
  });

  it("multi-repository gate with one wrong SHA stays unsatisfied and names the repository", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, twoRepoManifest());
    await writeRevisions(ws);
    await writeReceipt(ws);
    await writeReceipt(ws, { receipt: { repository: "web", commit_sha: "c".repeat(40) } });
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.per_repository.find((p) => p.repository === "web")?.reason_codes).toContain("revision_mismatch");
    expect(d.status).toBe("PARTIAL");
  });

  it("a receipt cannot borrow another repository's SHA", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, twoRepoManifest());
    await writeRevisions(ws);
    await writeReceipt(ws);
    // web receipt that carries the API commit
    await writeReceipt(ws, { receipt: { repository: "web", commit_sha: REPOS.api } });
    expect((await evaluate(ws)).code).toBe(1);
  });

  it("requires full 40-hex SHAs: short, uppercase and 64-hex values are rejected as exit 2", async () => {
    const ws = await fresh();
    for (const bad of [REPOS.api.slice(0, 12), REPOS.api.toUpperCase(), "a".repeat(64)]) {
      await writeRevisions(ws, { api: bad, web: REPOS.web });
      const r = await evaluate(ws);
      expect(r.code).toBe(2);
      expect(errorCode(r)).toBe("revisions_invalid_commit_sha");
    }
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { commit_sha: REPOS.api.slice(0, 7) } });
    expect(errorCode(await evaluate(ws))).toBe("receipt_invalid_commit_sha");
  });

  it("rejects a revision set that omits a declared repository or names an undeclared one", async () => {
    const ws = await fresh();
    await writeRevisions(ws, { api: REPOS.api });
    expect(errorCode(await evaluate(ws))).toBe("revisions_missing_repository");
    await writeRevisions(ws, { api: REPOS.api, web: REPOS.web, extra: "d".repeat(40) });
    expect(errorCode(await evaluate(ws))).toBe("revisions_unknown_repository");
    await writeFile(
      ws.revisionsPath,
      JSON.stringify({ schema_version: 1, revisions: [{ repository: "api", commit_sha: REPOS.api }, { repository: "api", commit_sha: REPOS.api }, { repository: "web", commit_sha: REPOS.web }] }),
    );
    expect(errorCode(await evaluate(ws))).toBe("revisions_duplicate_repository");
  });
});

/* ============================================================ AC-03 */
describe("AC-03 mock and empty suite controls", () => {
  it("live-required requirements reject mocked receipts", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { execution_kind: "mocked" } });
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.status).toBe("MISSING");
    expect(d.reason_codes).toContain("execution_kind_not_allowed");
  });

  it("live-required requirements reject synthetic receipts", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { execution_kind: "synthetic" } });
    expect((await evaluate(ws)).code).toBe(1);
    expect(decision(loadReport(ws)).reason_codes).toContain("execution_kind_not_allowed");
  });

  it("a mocked receipt satisfies only a requirement that explicitly allows mocked evidence (control)", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ allowed_execution_kinds: ["live", "mocked"] })] }));
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { execution_kind: "mocked" } });
    expect((await evaluate(ws)).code).toBe(0);
  });

  it("a mocked pass cannot mask a missing live pass when both are supplied (mock never upgrades)", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { execution_kind: "mocked" } });
    await writeReceipt(ws, { receipt: { execution_kind: "live", result: "fail", tests: { total: 4, passed: 3, failed: 1, skipped: 0 } } });
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    expect(decision(loadReport(ws)).status).toBe("FAIL");
  });

  it("skipped tests keep the requirement unsatisfied (PARTIAL)", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { tests: { total: 10, passed: 9, failed: 0, skipped: 1 } } });
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.status).toBe("PARTIAL");
    expect(d.reason_codes).toContain("tests_skipped");
  });

  it("a partial result and a skipped suite are PARTIAL, never PASS", async () => {
    for (const [result, reason] of [
      ["partial", "partial_result"],
      ["skipped", "suite_skipped"],
    ] as const) {
      const ws = await track(await makeWorkspace());
      await writeManifest(ws);
      await writeRevisions(ws);
      await writeReceipt(ws, { receipt: { result } });
      expect((await evaluate(ws)).code).toBe(1);
      const d = decision(loadReport(ws));
      expect(d.status).toBe("PARTIAL");
      expect(d.reason_codes).toContain(reason);
    }
  });

  it("zero tests is MISSING, even when the receipt says pass", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { result: "pass", tests: { total: 0, passed: 0, failed: 0, skipped: 0 } } });
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.status).toBe("MISSING");
    expect(d.reason_codes).toContain("zero_tests");
  });

  it("zero tests with result fail, partial or skipped is never ignorable: alone and beside a passing receipt (review round 1, P0)", async () => {
    const zero = { total: 0, passed: 0, failed: 0, skipped: 0 };
    for (const [result, alone, beside] of [
      ["fail", "FAIL", "FAIL"],
      ["partial", "PARTIAL", "PARTIAL"],
      ["skipped", "PARTIAL", "PARTIAL"],
    ] as const) {
      const only = await track(await makeWorkspace());
      await writeManifest(only);
      await writeRevisions(only);
      await writeReceipt(only, { receipt: { result, tests: zero } });
      expect((await evaluate(only)).code, `${result} alone`).toBe(1);
      expect(decision(loadReport(only)).status, `${result} alone`).toBe(alone);

      const both = await track(await makeWorkspace());
      await writeManifest(both);
      await writeRevisions(both);
      await writeReceipt(both);
      await writeReceipt(both, { receipt: { result, tests: zero } });
      const r = await evaluate(both);
      expect(r.code, `${result} beside a pass: ${r.stdout}`).toBe(1);
      expect(decision(loadReport(both)).status, `${result} beside a pass`).toBe(beside);
    }
    // Control: a zero-test PASS claim beside real evidence is still ignorable.
    const control = await track(await makeWorkspace());
    await writeManifest(control);
    await writeRevisions(control);
    await writeReceipt(control);
    await writeReceipt(control, { receipt: { result: "pass", tests: zero } });
    expect((await evaluate(control)).code).toBe(0);
  });

  it("failed tests are FAIL, and a pass claim that contradicts its own counts is FAIL", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { result: "pass", tests: { total: 5, passed: 4, failed: 1, skipped: 0 } } });
    expect((await evaluate(ws)).code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.status).toBe("FAIL");
    expect(d.reason_codes).toEqual(expect.arrayContaining(["tests_failed", "result_contradicts_counts"]));
  });

  it("a wrong environment or a lower test level does not satisfy the requirement", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { environment: "production-mirror" } });
    await writeReceipt(ws, { receipt: { test_level: "unit" } });
    expect((await evaluate(ws)).code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.reason_codes).toEqual(expect.arrayContaining(["environment_mismatch", "level_insufficient"]));
  });

  it("a higher test level satisfies a lower required level", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { test_level: "e2e" } });
    expect((await evaluate(ws)).code).toBe(0);
  });
});

/* ============================================================ AC-04 */
describe("AC-04 freshness boundaries", () => {
  const MAX = 3600;
  async function withAge(ageSeconds: number): Promise<{ ws: Workspace; now: string }> {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ max_age_seconds: MAX })] }));
    await writeRevisions(ws);
    // finished exactly `ageSeconds` before NOW
    await writeReceipt(ws, { receipt: { finished_at: isoAgo(ageSeconds) } });
    return { ws, now: NOW };
  }

  it("age max-1 second is PASS", async () => {
    const { ws, now } = await withAge(MAX - 1);
    expect((await evaluate(ws, ["--now", now])).code).toBe(0);
    expect(decision(loadReport(ws)).status).toBe("PASS");
  });

  it("age exactly max_age_seconds is STALE", async () => {
    const { ws, now } = await withAge(MAX);
    const r = await evaluate(ws, ["--now", now]);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.status).toBe("STALE");
    expect(d.reason_codes).toContain("evidence_stale");
  });

  it("age max+1 second is STALE", async () => {
    const { ws, now } = await withAge(MAX + 1);
    expect((await evaluate(ws, ["--now", now])).code).toBe(1);
    expect(decision(loadReport(ws)).status).toBe("STALE");
  });

  it("the boundary is decided by the injected clock: the same receipt flips from PASS to STALE as --now advances", async () => {
    const { ws } = await withAge(0);
    const finished = NOW_MS;
    const at = (deltaSeconds: number) => new Date(finished + deltaSeconds * 1000).toISOString();
    expect((await evaluate(ws, ["--now", at(MAX - 1)])).code).toBe(0);
    await rm(ws.outputDir, { recursive: true });
    expect((await evaluate(ws, ["--now", at(MAX)])).code).toBe(1);
    await rm(ws.outputDir, { recursive: true });
    expect((await evaluate(ws, ["--now", at(MAX + 1)])).code).toBe(1);
  });

  it("sub-second precision holds at the boundary (999 ms under is fresh, exactly at is stale)", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ max_age_seconds: 10 })] }));
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { finished_at: "2026-09-29T11:59:50.001Z" } });
    expect((await evaluate(ws, ["--now", "2026-09-29T12:00:00.000Z"])).code).toBe(0);
    await rm(ws.outputDir, { recursive: true });
    expect((await evaluate(ws, ["--now", "2026-09-29T12:00:00.001Z"])).code).toBe(1);
  });

  it("a fresh passing receipt outranks an older stale one for the same revision", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { finished_at: isoAgo(86_400) } });
    await writeReceipt(ws, { receipt: { finished_at: isoAgo(30) } });
    expect((await evaluate(ws)).code).toBe(0);
  });

  it("receipts finished after the evaluation time are rejected, not trusted", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { finished_at: isoAgo(-120) } });
    expect((await evaluate(ws)).code).toBe(1);
    expect(decision(loadReport(ws)).reason_codes).toContain("receipt_from_future");
  });

  it("a fixed UTC clock makes reports byte-for-byte reproducible", async () => {
    const ws = await fresh();
    await evaluate(ws);
    const first = readFileSync(join(ws.outputDir, "report.json"), "utf8");
    await rm(ws.outputDir, { recursive: true });
    await evaluate(ws);
    expect(readFileSync(join(ws.outputDir, "report.json"), "utf8")).toBe(first);
    await rm(ws.outputDir, { recursive: true });
    await evaluate(ws, ["--now", "2026-09-29T12:00:01Z"]);
    const later = loadReport(ws);
    expect(later.evaluated_at).toBe("2026-09-29T12:00:01.000Z");
    expect(JSON.stringify(later)).not.toBe(JSON.stringify(JSON.parse(first)));
  });

  it("PROOFGATE_NOW fixes the clock and --now takes precedence; a malformed clock is exit 2", async () => {
    const ws = await fresh();
    const viaEnv = await runCli(evalArgs(ws), { PROOFGATE_NOW: NOW });
    expect(viaEnv.code).toBe(0);
    expect(loadReport(ws).evaluated_at).toBe("2026-09-29T12:00:00.000Z");
    await rm(ws.outputDir, { recursive: true });
    await runCli(evalArgs(ws, ["--now", "2026-09-29T12:30:00Z"]), { PROOFGATE_NOW: NOW });
    expect(loadReport(ws).evaluated_at).toBe("2026-09-29T12:30:00.000Z");
    await rm(ws.outputDir, { recursive: true });
    for (const bad of ["yesterday", "2026-09-29", "2026-09-29T12:00:00+02:00", "2026-13-40T00:00:00Z"]) {
      const r = await runCli(evalArgs(ws, ["--now", bad]));
      expect(r.code).toBe(2);
      expect(errorCode(r)).toBe("clock_invalid");
    }
  });

  it("a changed policy hash forces a new assessment and leaves the historical report immutable", async () => {
    const ws = await fresh();
    expect((await evaluate(ws)).code).toBe(0);
    const before = loadReport(ws);
    const beforeBytes = readFileSync(join(ws.outputDir, "report.json"), "utf8");

    // Tighten the policy: max_age_seconds 3600 -> 30 makes the 60 s old receipt stale.
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ max_age_seconds: 30 })] }));

    // Without --replace the historical report is protected.
    const refused = await evaluate(ws);
    expect(refused.code).toBe(2);
    expect(errorCode(refused)).toBe("output_exists");
    expect(readFileSync(join(ws.outputDir, "report.json"), "utf8")).toBe(beforeBytes);

    const replaced = await evaluate(ws, ["--now", NOW, "--replace"]);
    expect(replaced.code).toBe(1);
    const after = loadReport(ws);
    expect(after.policy_hash).not.toBe(before.policy_hash);
    expect(after.assessment_id).not.toBe(before.assessment_id);
    expect(after.supersedes).toMatchObject({ assessment_id: before.assessment_id, policy_changed: true });
    expect(decision(after).status).toBe("STALE");

    const archived = join(`${ws.outputDir}.superseded-${before.assessment_id}`, "report.json");
    expect(readFileSync(archived, "utf8")).toBe(beforeBytes);
  });

  it("a title-only change is not a policy change, but a rule change is", async () => {
    const ws = await fresh();
    await evaluate(ws);
    const first = loadReport(ws);
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ title: "Renamed but same rule" })] }));
    await evaluate(ws, ["--now", NOW, "--replace"]);
    const renamed = loadReport(ws);
    expect(renamed.policy_hash).toBe(first.policy_hash);
    expect(renamed.supersedes?.policy_changed).toBe(false);
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ required_environment: "production" })] }));
    await evaluate(ws, ["--now", NOW, "--replace"]);
    expect(loadReport(ws).policy_hash).not.toBe(first.policy_hash);
  });
});

/* ============================================================ AC-05 */
describe("AC-05 negative control and report reconciliation", () => {
  async function twoRequirementWorkspace(): Promise<Workspace> {
    const ws = await track(await makeWorkspace());
    await writeManifest(
      ws,
      baseManifest({
        requirements: [
          baseRequirement(),
          baseRequirement({ id: "REQ-002", title: "Web e2e checks", required_level: "e2e", repositories: ["web"] }),
          baseRequirement({ id: "REQ-003", title: "Advisory lint", severity: "advisory", repositories: ["api"] }),
        ],
      }),
    );
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { requirement_ids: ["REQ-001", "REQ-003"] } });
    await writeReceipt(ws, { receipt: { requirement_ids: ["REQ-002"], repository: "web", commit_sha: REPOS.web, test_level: "e2e" } });
    return ws;
  }

  it("reports every requirement with status, source receipt, environment and reason", async () => {
    const ws = await twoRequirementWorkspace();
    expect((await evaluate(ws)).code).toBe(0);
    const report = loadReport(ws);
    expect(report.requirements.map((d) => d.id)).toEqual(["REQ-001", "REQ-002", "REQ-003"]);
    for (const d of report.requirements) {
      expect(d.status).toBe("PASS");
      expect(d.receipt_ids.length).toBeGreaterThan(0);
      expect(d.environments).toEqual(["staging"]);
      expect(d.reason_codes).toContain("all_criteria_met");
      for (const id of d.receipt_ids) expect(report.receipts.map((r) => r.receipt_id)).toContain(id);
    }
  });

  it("reconciles: every mandatory requirement in the manifest appears in the report exactly once", async () => {
    const ws = await twoRequirementWorkspace();
    await evaluate(ws);
    const report = loadReport(ws) as AnyReport & { summary: { mandatory_requirements: number; total_requirements: number; by_status: Record<string, number> } };
    const ids = report.requirements.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(report.summary.total_requirements).toBe(3);
    expect(report.summary.mandatory_requirements).toBe(report.requirements.filter((d) => d.severity === "mandatory").length);
    expect(Object.values(report.summary.by_status).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("a planted mandatory failure changes exit 0 to exit 1 (seeded negative control)", async () => {
    const ws = await twoRequirementWorkspace();
    const green = await evaluate(ws);
    expect(green.code).toBe(0);
    await rm(ws.outputDir, { recursive: true });

    // Plant one failing mandatory requirement: nothing is wrong except this one line.
    const planted = baseManifest({
      requirements: [
        baseRequirement(),
        baseRequirement({ id: "REQ-002", title: "Web e2e checks", required_level: "e2e", repositories: ["web"] }),
        baseRequirement({ id: "REQ-003", title: "Advisory lint", severity: "advisory", repositories: ["api"] }),
        baseRequirement({ id: "REQ-PLANTED", title: "Planted mandatory failure", repositories: ["api"] }),
      ],
    });
    await writeManifest(ws, planted);
    const red = await evaluate(ws);
    expect(red.code).toBe(1);
    const report = loadReport(ws);
    expect(decision(report, "REQ-PLANTED").status).toBe("MISSING");
    expect(report.verdict).toBe("unsatisfied");
    expect(report.exit_code).toBe(1);
  });

  it("a planted FAIL receipt (not just a missing one) also flips exit 0 to exit 1", async () => {
    const ws = await twoRequirementWorkspace();
    expect((await evaluate(ws)).code).toBe(0);
    await rm(ws.outputDir, { recursive: true });
    await writeReceipt(ws, { receipt: { requirement_ids: ["REQ-002"], repository: "web", commit_sha: REPOS.web, test_level: "e2e", result: "fail", tests: { total: 3, passed: 2, failed: 1, skipped: 0 } } });
    expect((await evaluate(ws)).code).toBe(1);
    expect(decision(loadReport(ws), "REQ-002").status).toBe("FAIL");
  });

  it("an advisory failure is reported but does not change the exit code", async () => {
    const ws = await twoRequirementWorkspace();
    await rm(join(ws.receiptsDir), { recursive: true });
    await mkdir(ws.receiptsDir);
    await writeReceipt(ws, { receipt: { requirement_ids: ["REQ-001"] } });
    await writeReceipt(ws, { receipt: { requirement_ids: ["REQ-002"], repository: "web", commit_sha: REPOS.web, test_level: "e2e" } });
    const r = await evaluate(ws);
    expect(r.code).toBe(0);
    expect(decision(loadReport(ws), "REQ-003").status).toBe("MISSING");
  });

  it("DEFERRED never satisfies a mandatory gate, even with passing evidence", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement(), baseRequirement({ id: "REQ-D", title: "Deferred item", deferred: { reason: "vendor sandbox unavailable" } })] }));
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { requirement_ids: ["REQ-001", "REQ-D"] } });
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws), "REQ-D");
    expect(d.status).toBe("DEFERRED");
    expect(d.evidence_status).toBe("PASS");
    expect(d.reason_codes).toContain("requirement_deferred");
  });

  it("a manifest with no mandatory requirement is rejected rather than vacuously accepted", async () => {
    const ws = await fresh();
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ severity: "advisory" })] }));
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("manifest_no_mandatory_requirements");
  });

  it("explain prints receipt IDs, per-repository status and reason codes", async () => {
    const ws = await twoRequirementWorkspace();
    await evaluate(ws);
    const report = loadReport(ws);
    const explained = await runCli(["explain", "REQ-001", "--report", join(ws.outputDir, "report.json")]);
    expect(explained.code).toBe(0);
    expect(explained.stdout).toContain("REQ-001  PASS");
    for (const id of decision(report).receipt_ids) expect(explained.stdout).toContain(id);
    expect(explained.stdout).toContain("all_criteria_met");
    const unknown = await runCli(["explain", "REQ-NOPE", "--report", ws.outputDir]);
    expect(unknown.code).toBe(2);
    expect(errorCode(unknown)).toBe("explain_unknown_requirement");
    const json = await runCli(["explain", "REQ-001", "--report", ws.outputDir, "--json"]);
    expect(JSON.parse(json.stdout).id).toBe("REQ-001");
  });

  it("explain surfaces rejected receipts and their reasons for an unsatisfied requirement", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    const bad = await writeReceipt(ws, { receipt: { environment: "dev" } });
    await evaluate(ws);
    const explained = await runCli(["explain", "REQ-001", "--report", ws.outputDir]);
    expect(explained.stdout).toContain(bad.receipt_id as string);
    expect(explained.stdout).toContain("environment_mismatch");
  });

  it("the report directory is written atomically with owner-only permissions and a matching hash file", async () => {
    const ws = await fresh();
    await evaluate(ws);
    expect(statSync(ws.outputDir).mode & 0o777).toBe(0o700);
    for (const f of readdirSync(ws.outputDir)) expect(statSync(join(ws.outputDir, f)).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(ws.outputDir, "..")).filter((n) => n.includes(".tmp-"))).toEqual([]);
    // A tampered report is refused by explain.
    const file = join(ws.outputDir, "report.json");
    await chmod(file, 0o600);
    await writeFile(file, readFileSync(file, "utf8").replace('"PASS"', '"FAIL"'));
    const r = await runCli(["explain", "REQ-001", "--report", ws.outputDir]);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("report_invalid");
  });

  it("exit codes: unsatisfied is 1, malformed is 2, and usage errors are 2 with a stable code", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    expect((await evaluate(ws)).code).toBe(1); // no receipts at all
    const usage = await runCli(["evaluate", "--bogus"]);
    expect(usage.code).toBe(2);
    expect(errorCode(usage)).toBe("cli_usage");
    expect(errorCode(await runCli(["frobnicate"]))).toBe("cli_usage");
    expect(errorCode(await runCli(["evaluate", "--manifest", "x"]))).toBe("cli_usage");
  });
});

/* ============================================================ AC-06 */
describe("AC-06 adapter compatibility", () => {
  const fixturePath = join(import.meta.dirname, "fixtures", "runproof", "run-detail.fixture.json");
  const runproofFixture = () => JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, any>;

  async function withRunproof(mutate: (doc: Record<string, any>) => void, requirement: Record<string, unknown> = {}): Promise<Workspace> {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ max_age_seconds: 7200, ...requirement })] }));
    await writeRevisions(ws);
    const doc = runproofFixture();
    mutate(doc);
    await mkdir(join(ws.receiptsDir, "artifacts"), { recursive: true });
    await writeFile(join(ws.receiptsDir, "artifacts", "runproof-evidence.txt"), "runproof fixture evidence\n");
    await writeFile(join(ws.receiptsDir, "run.receipt.json"), JSON.stringify(doc));
    return ws;
  }

  it("imports a versioned local receipt JSON through the native adapter", async () => {
    const ws = await fresh();
    expect((await evaluate(ws)).code).toBe(0);
    const report = JSON.parse(readFileSync(join(ws.outputDir, "report.json"), "utf8"));
    expect(report.receipts[0].adapter).toEqual({ name: "proofgate.receipt", version: 1, provenance: "native" });
  });

  it("imports a RunProof export document, and a fixture is always synthetic: a live-required requirement rejects it", async () => {
    const ws = await withRunproof(() => undefined);
    const r = await evaluate(ws);
    expect(r.code).toBe(1);
    const d = decision(loadReport(ws));
    expect(d.reason_codes).toContain("execution_kind_not_allowed");
    const report = JSON.parse(readFileSync(join(ws.outputDir, "report.json"), "utf8"));
    expect(report.receipts[0]).toMatchObject({ execution_kind: "synthetic", adapter: { name: "runproof.run-detail", provenance: "fixture" } });
  });

  it("a fixture satisfies a requirement only when synthetic evidence is explicitly allowed", async () => {
    const ws = await withRunproof(() => undefined, { allowed_execution_kinds: ["synthetic"] });
    expect((await evaluate(ws)).code).toBe(0);
    expect(decision(loadReport(ws)).receipt_ids).toEqual(["run-nightly-20260929"]);
  });

  it("an operator-captured RunProof run bound as live can satisfy a live-required requirement", async () => {
    const ws = await withRunproof((doc) => {
      doc.source_kind = "operator_capture";
    });
    expect((await evaluate(ws)).code).toBe(0);
  });

  it("a RunProof run that is not verified stays unsatisfied (failed -> FAIL, unknown -> PARTIAL)", async () => {
    const failed = await withRunproof((doc) => {
      doc.source_kind = "operator_capture";
      doc.run.outcome = "failed";
      doc.run.checks[0].state = "fail";
    });
    expect((await evaluate(failed)).code).toBe(1);
    expect(decision(loadReport(failed)).status).toBe("FAIL");
    const unknown = await withRunproof((doc) => {
      doc.source_kind = "operator_capture";
      doc.run.outcome = "unknown";
      doc.run.checks[0].state = "unknown";
    });
    expect((await evaluate(unknown)).code).toBe(1);
    expect(decision(loadReport(unknown)).status).toBe("PARTIAL");
  });

  it("rejects a RunProof run that claims verified while a required check is not pass", async () => {
    const ws = await withRunproof((doc) => {
      doc.source_kind = "operator_capture";
      doc.run.checks[1].state = "unknown";
    });
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("runproof_outcome_mismatch");
  });

  it("rejects an unfinished RunProof run as evidence", async () => {
    const ws = await withRunproof((doc) => {
      doc.run.finished_at = null;
      doc.run.outcome = "pending";
    });
    expect(errorCode(await evaluate(ws))).toBe("runproof_run_unfinished");
  });

  it("unsupported major versions fail explicitly for receipts, RunProof documents, bundles and envelopes", async () => {
    const ws = await fresh();
    const [name] = readdirSync(ws.receiptsDir).filter((n) => n.endsWith(".receipt.json"));
    const file = join(ws.receiptsDir, name as string);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...doc, schema_version: 2, brand_new_field: "must not be silently dropped" }));
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("unsupported_schema_version");
    expect(r.stderr).toContain("schema_version 2");

    const rp = await withRunproof((d) => {
      d.schema_version = 2;
    });
    expect(errorCode(await evaluate(rp))).toBe("unsupported_schema_version");

    const wsManifest = await fresh();
    await writeFile(wsManifest.manifestPath, stringify({ ...baseManifest(), schema_version: 3 }));
    expect(errorCode(await evaluate(wsManifest))).toBe("unsupported_schema_version");

    expect(() => parseEnvelope({ ...validEnvelope(), schema_version: 2 })).toThrowError(/schema_version 2/);
  });

  it("unknown fields are rejected, never silently dropped (receipts and RunProof documents)", async () => {
    const ws = await fresh();
    await writeReceipt(ws, { receipt: { totally_new_field: 1 } });
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("receipt_unknown_field");
    expect(r.stderr).toContain("totally_new_field");
    const rp = await withRunproof((d) => {
      d.extra_top_level = true;
    });
    expect(errorCode(await evaluate(rp))).toBe("runproof_unknown_field");
  });

  it("preserves RunProof run fields ProofGate does not map, verbatim, in the receipt extensions", async () => {
    const ws = await withRunproof(() => undefined, { allowed_execution_kinds: ["synthetic"] });
    await evaluate(ws);
    // The bundle carries the adapter's normalised receipt source; extensions live on the receipt itself.
    const { adaptReceiptDocument } = await import("../src/adapters/index.js");
    const out = adaptReceiptDocument(runproofFixture(), "fixture");
    const ext = out.receipt.extensions as { runproof: { unmapped_run_fields: Record<string, unknown>; main_sha: string; checks: unknown[] } };
    expect(ext.runproof.main_sha).toBe("5e2f9af3310655116535b31ca99ab92210178431");
    expect(ext.runproof.unmapped_run_fields).toMatchObject({ workflow_name: "Nightly synthetic report", exit_code: 0, deadline_at: "2026-09-29T12:25:00.000Z" });
    expect(ext.runproof.checks).toHaveLength(2);
  });

  it("an unknown receipt format is an explicit error", async () => {
    const ws = await fresh();
    await writeFile(join(ws.receiptsDir, "x.receipt.json"), JSON.stringify({ format: "someone.else", schema_version: 1 }));
    expect(errorCode(await evaluate(ws))).toBe("adapter_unknown_format");
  });

  function validEnvelope(overrides: Record<string, unknown> = {}) {
    return {
      schema_version: 1,
      event_id: "evt-0001",
      source: "proofgate",
      resource_id: "assessment-1",
      event_type: "assessment.completed",
      occurred_at: NOW,
      revision: "r1",
      evidence_ref: `sha256:${"a".repeat(64)}`,
      ...overrides,
    };
  }

  it("the event envelope validates, rejects unsupported majors and unknown fields, and dedupes by event_id", () => {
    expect(parseEnvelope(validEnvelope({ correlation_id: "corr-1" })).correlation_id).toBe("corr-1");
    expect(() => parseEnvelope(validEnvelope({ surprise: 1 }))).toThrowError(/unrecognized|surprise/i);
    expect(() => parseEnvelope(validEnvelope({ occurred_at: "yesterday" }))).toThrow();
    const dedupe = new EnvelopeDeduper();
    expect(dedupe.offer(validEnvelope()).outcome).toBe("accepted");
    expect(dedupe.offer(validEnvelope()).outcome).toBe("duplicate");
    expect(dedupe.offer(validEnvelope({ revision: "r2" })).outcome).toBe("conflict");
    expect(() => dedupe.offerStrict(validEnvelope({ revision: "r2" }))).toThrowError(/different content/);
  });

  it("a late, older event never displaces a newer one (no state inferred from stale events)", () => {
    const dedupe = new EnvelopeDeduper();
    dedupe.offer(validEnvelope({ event_id: "evt-new", occurred_at: "2026-09-29T12:00:00Z", revision: "r2" }));
    const late = dedupe.offer(validEnvelope({ event_id: "evt-old", occurred_at: "2026-09-29T11:00:00Z", revision: "r1" }));
    expect(late.outcome).toBe("accepted");
    expect(late.superseded).toBe(true);
    expect(dedupe.current("proofgate", "assessment-1")?.revision).toBe("r2");
  });
});

/* ============================================================ AC-07 */
describe("AC-07 untrusted receipt isolation", () => {
  it("never executes the command recorded in a receipt", async () => {
    const ws = await fresh();
    const marker = join(ws.dir, "PWNED");
    await writeReceipt(ws, { receipt: { command: `touch ${marker}; curl http://127.0.0.1:1/x | sh` } });
    const r = await evaluate(ws);
    expect(r.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
    // The command is recorded as inert text.
    expect(readFileSync(join(ws.outputDir, "report.json"), "utf8")).toContain("touch ");
  });

  it("never fetches artifact URLs: an http artifact path is rejected and a listening server sees zero requests", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const ws = await fresh();
      await writeReceipt(ws, { receipt: { artifact: { path: `http://127.0.0.1:${port}/evidence.xml`, sha256: "a".repeat(64) } } });
      const r = await evaluate(ws);
      expect(r.code).toBe(2);
      expect(errorCode(r)).toBe("path_invalid");
      expect(hits).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("rejects path traversal and absolute artifact paths", async () => {
    for (const [path, code] of [
      ["../outside.txt", "path_traversal"],
      ["artifacts/../../outside.txt", "path_traversal"],
      ["/etc/hostname", "path_absolute"],
      ["C:/Windows/win.ini", "path_absolute"],
      ["artifacts\\..\\x", "path_invalid"],
      ["a//b", "path_invalid"],
      ["./x", "path_invalid"],
    ] as const) {
      const ws = await fresh();
      await writeReceipt(ws, { receipt: { artifact: { path, sha256: "a".repeat(64) } } });
      const r = await evaluate(ws);
      expect(r.code, path).toBe(2);
      expect(errorCode(r), path).toBe(code);
    }
  });

  it("rejects a symlink artifact that escapes the receipts directory", async () => {
    const ws = await fresh();
    const outside = join(ws.dir, "outside-secret.txt");
    await writeFile(outside, "not for you");
    symlinkSync(outside, join(ws.receiptsDir, "leak.txt"));
    await writeReceipt(ws, { receipt: { artifact: { path: "leak.txt", sha256: sha256("not for you") } } });
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("path_symlink_rejected");
  });

  it("rejects a symlinked directory, a symlinked receipt file, and a dangling symlink", async () => {
    for (const setup of ["dir", "receipt", "dangling"] as const) {
      const ws = await fresh();
      if (setup === "dir") {
        await mkdir(join(ws.dir, "elsewhere"));
        symlinkSync(join(ws.dir, "elsewhere"), join(ws.receiptsDir, "linked-dir"));
      } else if (setup === "receipt") {
        await writeFile(join(ws.dir, "real.receipt.json"), "{}");
        symlinkSync(join(ws.dir, "real.receipt.json"), join(ws.receiptsDir, "link.receipt.json"));
      } else {
        symlinkSync(join(ws.dir, "does-not-exist"), join(ws.receiptsDir, "dangling"));
      }
      const r = await evaluate(ws);
      expect(r.code, setup).toBe(2);
      expect(errorCode(r), setup).toBe("path_symlink_rejected");
    }
  });

  it("keeps hostile text inert: raw in report.json, safe after escapeHtml", async () => {
    const ws = await track(await makeWorkspace());
    const payload = `<img src=x onerror="alert(1)"><script>alert('x')</script>`;
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ title: payload })] }));
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { runner_id: payload, command: payload } });
    expect((await evaluate(ws)).code).toBe(0);
    const text = readFileSync(join(ws.outputDir, "report.json"), "utf8");
    // report.json is data: it must carry the raw string so the renderer, not the core, decides how to display it.
    expect(JSON.parse(text).requirements[0].title).toBe(payload);
    const escaped = escapeHtml(payload);
    expect(escaped).not.toMatch(/[<>"']/);
    expect(escaped).toContain("&lt;script&gt;");
  });

  it("escapeHtml neutralises every HTML metacharacter including quotes and backticks", () => {
    expect(escapeHtml(`<>&"'\``)).toBe("&lt;&gt;&amp;&quot;&#39;&#96;");
    expect(escapeHtml(42)).toBe("42");
  });
});

/* ============================================================ AC-08 */
describe("AC-08 offline demo", () => {
  it("completes evaluate, explain and bundle export/verify/restore with every network primitive blocked and none attempted", async () => {
    const { denyNetwork } = await import("./helpers/deny-network.mjs");
    const denial = denyNetwork();
    try {
      const ws = await fresh();
      expect((await evaluate(ws)).code).toBe(0);
      expect((await runCli(["explain", "REQ-001", "--report", ws.outputDir])).code).toBe(0);
      const bundle = join(ws.dir, "out.pgbundle");
      const exported = await runCli(["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", bundle]);
      expect(exported.code, exported.stderr).toBe(0);
      expect((await runCli(["bundle", "verify", bundle])).code).toBe(0);
      expect((await runCli(["bundle", "restore", bundle, "--output", join(ws.dir, "restored")])).code).toBe(0);
    } finally {
      denial.restore();
    }
    expect(denial.attempts).toEqual([]);
  });

  it("the denial harness really blocks: a fetch and a socket attempt under it are refused and recorded (control)", async () => {
    const { denyNetwork } = await import("./helpers/deny-network.mjs");
    const denial = denyNetwork();
    try {
      await expect(fetch("http://127.0.0.1:9/")).rejects.toThrow(/denied/);
      const net = await import("node:net");
      expect(() => net.connect(9, "127.0.0.1")).toThrow(/denied/);
    } finally {
      denial.restore();
    }
    expect(denial.attempts.length).toBe(2);
  });

  it("the packaged CLI completes in a subprocess with network primitives stubbed out and an empty environment", async () => {
    const ws = await fresh();
    const log = join(ws.dir, "net.log");
    const r = await runDist(evalArgs(ws, ["--now", NOW]), {
      nodeArgs: ["--import", join(import.meta.dirname, "helpers", "deny-network.mjs")],
      env: { PROOFGATE_DENY_NETWORK: "1", PROOFGATE_NET_LOG: log },
    });
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(log)).toBe(false);
  });

  const sandbox = (() => {
    if (process.platform !== "darwin") return undefined;
    return existsSync("/usr/bin/sandbox-exec") ? "/usr/bin/sandbox-exec" : undefined;
  })();

  it.skipIf(sandbox === undefined)("runs the packaged CLI inside an OS-level network-deny sandbox (macOS sandbox-exec) and the sandbox provably denies sockets", async () => {
    const ws = await fresh();
    const profile = "(version 1)(allow default)(deny network*)";
    // Control: inside this profile a TCP connection must fail.
    const server = createServer((_q, res) => res.end("x"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const probe = await new Promise<number>((resolve) => {
      const p = spawn(sandbox as string, ["-p", profile, process.execPath, "-e", `require('net').connect(${port},'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(3))`]);
      p.on("close", (c) => resolve(c ?? -1));
    });
    await new Promise((resolve) => server.close(resolve));
    expect(probe).toBe(3);
    const code = await new Promise<number>((resolve) => {
      const p = spawn(sandbox as string, ["-p", profile, process.execPath, join(import.meta.dirname, "..", "dist", "cli.js"), ...evalArgs(ws, ["--now", NOW])], { env: { PATH: process.env.PATH ?? "" } });
      p.on("close", (c) => resolve(c ?? -1));
    });
    expect(code).toBe(0);
  });

  it("the core's source imports no network module and contains no telemetry endpoint", async () => {
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    await walk(join(import.meta.dirname, "..", "src"));
    expect(files.length).toBeGreaterThan(10);
    // Every way of naming a network-capable module: `from "x"`, a bare `import "x"`, `require("x")`, `import("x")`, with or
    // without the `node:` prefix (a side-effect import has no `from`, which the first version of this scan missed).
    const banned = /\b(?:import|require|from)\b[^\n]*["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns|cluster|child_process|worker_threads|inspector)(?:\/[a-z]+)?["']|\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\/(?!json-schema\.org)[a-z0-9.-]+\.(?:com|io|net|org|dev)\b/;
    // Control: the pattern must see each spelling (a scan that cannot go red proves nothing).
    for (const spelling of ['import "node:https";', "import x from 'node:net';", 'const t = require("tls");', 'await import("node:dgram");', 'import { request } from "node:http";', "import 'dns';"]) {
      expect(banned.test(spelling), spelling).toBe(true);
    }
    expect(banned.test('import { join } from "node:path";')).toBe(false);
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (banned.test(line)) offenders.push(`${f.split("src/")[1]}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the synthetic demo workflow needs no account, credentials or home directory", async () => {
    const ws = await fresh();
    const r = await runDist(evalArgs(ws, ["--now", NOW]), { env: { HOME: join(ws.dir, "no-such-home") } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("verdict: ACCEPTED");
  });

  it("live connector operations fail explicitly when disconnected", async () => {
    const r = await runCli(["connector", "runproof", "pull"]);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("connector_disconnected");
    expect(r.stderr).toContain("disabled by default");
  });
});

/* ============================================================ AC-09 */
describe("AC-09 redaction and hostile input", () => {
  async function plantedWorkspace(): Promise<Workspace> {
    const ws = await track(await makeWorkspace());
    await writeManifest(
      ws,
      baseManifest({
        requirements: [baseRequirement({ title: `Checkout ${FAKE.githubToken} flow` })],
        extensions: { note: `password: hunter2hunter2`, client_secret: FAKE.skToken },
      }),
    );
    await writeRevisions(ws);
    await writeReceipt(ws, {
      receipt: {
        runner_id: `${FAKE.email}`,
        command: `deploy --token ${FAKE.awsKey} --url ${FAKE.urlPassword} ${FAKE.assignment}`,
        extensions: {
          api_token: FAKE.slackToken,
          log: `${FAKE.bearer} and ${FAKE.jwt}`,
          key: FAKE.privateKey,
          google: FAKE.googleKey,
          stripe: FAKE.stripeKey,
          pat: FAKE.githubPat,
          // Shapes added after review round 1: header values, an Azure storage key, vendor tokens, word-glued tokens.
          curl: `curl -H 'Authorization: Basic ${FAKE_CONTEXT.basicAuthValue}' -H 'Authorization: Digest ${FAKE_CONTEXT.digestAuthValue}' -H 'Cookie: ${FAKE_CONTEXT.cookieValue}' https://example.invalid/`,
          azure: `DefaultEndpointsProtocol=https;AccountName=demo;${FAKE.azureAccountKey};EndpointSuffix=core.example.invalid`,
          glued: GLUED_TEXT,
          vendors: [FAKE.npmToken, FAKE.gitlabToken, FAKE.sendgridKey, FAKE.twilioKey, `note ${FAKE.jsonPasswordText}`, `built ${FAKE.wordGluedGithub} and ${FAKE.wordGluedAws}`].join(" | "),
        },
      },
    });
    return ws;
  }

  function allText(dir: string): string {
    let out = "";
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      out += f.isDirectory() ? allText(p) : readFileSync(p, "latin1");
    }
    return out;
  }

  it("planted secret tokens never reach report.json, the report directory, stdout or stderr", async () => {
    const ws = await plantedWorkspace();
    const r = await evaluate(ws);
    expect(r.code).toBe(0);
    const corpus = `${allText(ws.outputDir)}\n${r.stdout}\n${r.stderr}`;
    for (const secret of PLANTED_VALUES) expect(corpus, secret.slice(0, 12)).not.toContain(secret);
    expect(corpus).toContain("[REDACTED]");
    const json = await runCli(evalArgs(ws, ["--now", NOW, "--replace", "--json"]));
    for (const secret of PLANTED_VALUES) expect(json.stdout).not.toContain(secret);
  });

  it("secrets never appear in exported bundle documents or in error output", async () => {
    const ws = await plantedWorkspace();
    await evaluate(ws);
    const bundle = join(ws.dir, "planted.pgbundle");
    const exported = await runCli(["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", bundle]);
    expect(exported.code, exported.stderr).toBe(0);
    const bytes = readFileSync(bundle).toString("latin1");
    for (const secret of PLANTED_VALUES) expect(bytes).not.toContain(secret);

    // An invalid document whose *key names* are secrets: the error text must not echo them.
    const bad = await fresh();
    await writeReceipt(bad, { receipt: { [FAKE.githubToken]: 1 } });
    const r = await evaluate(bad);
    expect(r.code).toBe(2);
    expect(r.stderr).not.toContain(FAKE.githubToken);
  });

  it("validates size before processing: an oversize receipt set is refused without parsing anything", async () => {
    const ws = await fresh();
    // Not valid JSON: if the limit were checked after parsing we would see receipt_invalid_json instead.
    await writeFile(join(ws.receiptsDir, "huge.receipt.json"), Buffer.alloc(26 * 1024 * 1024, 0x20));
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("limit_metadata_bytes");
  });

  it("enforces the 1,000-entry limit before reading any file", async () => {
    const ws = await fresh();
    const dir = join(ws.receiptsDir, "many");
    await mkdir(dir);
    await Promise.all(Array.from({ length: 1001 }, (_, i) => writeFile(join(dir, `f${i}.txt`), "x")));
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("limit_file_count");
    // A directory at the limit is accepted (boundary control).
    await rm(dir, { recursive: true });
    await mkdir(dir);
    // Allowed note names only (every other unreferenced file is refused by the strict receipts-tree rule); a directory and its note count as two entries, so 450 pairs stay just under the limit.
    await Promise.all(Array.from({ length: 450 }, async (_, i) => {
      await mkdir(join(dir, `d${i}`));
      await writeFile(join(dir, `d${i}`, ".gitkeep"), "x");
    }));
    expect((await evaluate(ws)).code).toBe(0);
  });

  it("caps blob bytes before hashing and honours an explicit override", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { artifact: Buffer.alloc(4096, 1) });
    const refused = await evaluate(ws, ["--now", NOW, "--max-blob-bytes", "1024"]);
    expect(refused.code).toBe(2);
    expect(errorCode(refused)).toBe("limit_blob_bytes");
    const allowed = await evaluate(ws, ["--now", NOW, "--max-blob-bytes", "8192"]);
    expect(allowed.code).toBe(0);
    expect(errorCode(await evaluate(ws, ["--max-blob-bytes", "-5"]))).toBe("cli_usage");
  });

  it("rejects schema violations before any output is produced", async () => {
    const ws = await fresh();
    await writeReceipt(ws, { receipt: { tests: { total: 5, passed: 1, failed: 0, skipped: 0 } } });
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("receipt_schema_invalid");
    expect(existsSync(ws.outputDir)).toBe(false);
  });

  it("hostile prototype keys and deeply nested extensions are contained", async () => {
    const receiptWith = (extensions: string): string =>
      `{"schema_version":1,"receipt_id":"${nextId()}","requirement_ids":["REQ-001"],"repository":"api","commit_sha":"${REPOS.api}","runner_id":"r","environment":"staging","test_level":"integration","execution_kind":"live","result":"pass","tests":{"total":1,"passed":1,"failed":0,"skipped":0},"artifact":{"path":"artifacts/proto.txt","sha256":"${sha256("p")}"},"finished_at":"${isoAgo(5)}","extensions":${extensions}}`;
    // (1) `__proto__` and `constructor` keys alone: accepted as plain data, and nothing on Object.prototype changes. This is the
    //     case whose pollution assertion used to be unreachable (the deep nesting below tripped the depth limit first).
    const flat = await fresh();
    await writeFile(join(flat.receiptsDir, "proto.receipt.json"), receiptWith('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'));
    await writeFile(join(flat.receiptsDir, "artifacts", "proto.txt"), "p");
    const accepted = await evaluate(flat);
    expect(accepted.code, accepted.stderr).toBe(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.keys(Object.prototype)).toEqual([]);
    // (2) deep nesting is refused on its own, with its own code.
    const deep = await fresh();
    await writeFile(join(deep.receiptsDir, "proto.receipt.json"), receiptWith(`{"deep":${"[".repeat(40)}${"]".repeat(40)}}`));
    await writeFile(join(deep.receiptsDir, "artifacts", "proto.txt"), "p");
    const refused = await evaluate(deep);
    expect(refused.code).toBe(2);
    expect(errorCode(refused)).toBe("limit_json_depth");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("a YAML alias bomb in the manifest is refused as a parse error", async () => {
    const ws = await fresh();
    const lines = ["a0: &a0 [x]"];
    for (let i = 1; i < 12; i += 1) lines.push(`a${i}: &a${i} [${Array(10).fill(`*a${i - 1}`).join(",")}]`);
    await writeFile(ws.manifestPath, `${lines.join("\n")}\n`);
    const r = await evaluate(ws);
    expect(r.code).toBe(2);
    expect(["manifest_parse_error", "manifest_schema_invalid", "manifest_unknown_field"]).toContain(errorCode(r));
  });
});

/* ============================================================ AC-10 */
describe("AC-10 portability and corruption", () => {
  async function bundled(): Promise<{ ws: Workspace; bundle: string }> {
    const ws = await fresh();
    expect((await evaluate(ws)).code).toBe(0);
    const bundle = join(ws.dir, "evidence.pgbundle");
    const r = await runCli(bundleExportArgs(ws, bundle));
    expect(r.code, r.stderr).toBe(0);
    return { ws, bundle };
  }
  function bundleExportArgs(ws: Workspace, out: string, extra: string[] = []): string[] {
    return ["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", out, ...extra];
  }
  const leftovers = (dir: string) => readdirSync(dir).filter((n) => n.includes(".tmp-") || n.startsWith(".verify") || n.startsWith(".proofgate"));

  it("exports a versioned bundle and restores it with matching hashes; the restored inputs re-evaluate to the identical report", async () => {
    const { ws, bundle } = await bundled();
    const restored = join(ws.dir, "restored");
    const r = await runCli(["bundle", "restore", bundle, "--output", restored]);
    expect(r.code, r.stderr).toBe(0);
    const original = JSON.parse(readFileSync(join(ws.outputDir, "report.json"), "utf8"));
    const copy = JSON.parse(readFileSync(join(restored, "report", "report.json"), "utf8"));
    expect(copy).toEqual(original);
    const header = JSON.parse(readFileSync(join(restored, "bundle.json"), "utf8"));
    expect(header.schema_version).toBe(1);
    expect(header.assessment_id).toBe(original.assessment_id);
    for (const e of header.entries) expect(sha256(readFileSync(join(restored, e.path)))).toBe(e.sha256);

    // Clean installation: evaluate straight from the restored tree with the packaged CLI and a fresh clock pin.
    const again = join(ws.dir, "again");
    const e = await runDist(["evaluate", "--manifest", join(restored, "manifest.json"), "--receipts", join(restored, "receipts"), "--revisions", join(restored, "revisions.json"), "--output", again, "--now", original.evaluated_at], { cwd: ws.dir });
    expect(e.code, e.stderr).toBe(0);
    const reproduced = JSON.parse(readFileSync(join(again, "report.json"), "utf8"));
    expect(reproduced.assessment_id).toBe(original.assessment_id);
    expect(reproduced.requirements).toEqual(original.requirements);
  });

  it("restore output is owner-only (0700 directories, 0600 files)", async () => {
    const { ws, bundle } = await bundled();
    const restored = join(ws.dir, "restored");
    await runCli(["bundle", "restore", bundle, "--output", restored]);
    expect(statSync(restored).mode & 0o777).toBe(0o700);
    expect(statSync(join(restored, "receipts")).mode & 0o777).toBe(0o700);
    expect(statSync(join(restored, "manifest.json")).mode & 0o777).toBe(0o600);
    expect(statSync(bundle).mode & 0o777).toBe(0o600);
  });

  it("bundle verify reports success without leaving anything behind", async () => {
    const { ws, bundle } = await bundled();
    const before = readdirSync(ws.dir).sort();
    const r = await runCli(["bundle", "verify", bundle]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verified");
    expect(readdirSync(ws.dir).sort()).toEqual(before);
  });

  it("truncated bundles fail at sampled cut points with no restored state and no temp leftovers (every structural boundary: round2-boundaries.test.ts)", async () => {
    const { ws, bundle } = await bundled();
    const full = readFileSync(bundle);
    const cuts = [0, 5, 20, 100, Math.floor(full.length / 3), Math.floor(full.length / 2), full.length - 70, full.length - 1];
    for (const cut of cuts) {
      const truncated = join(ws.dir, `cut-${cut}.pgbundle`);
      await writeFile(truncated, full.subarray(0, cut));
      // A nested, not-yet-existing target: a truncated bundle must be refused before any directory is created for it.
      const target = join(ws.dir, `nest-${cut}`, "sub", "target");
      const r = await runCli(["bundle", "restore", truncated, "--output", target]);
      expect(r.code, `cut ${cut}`).toBe(2);
      expect(["bundle_truncated", "bundle_invalid_header"], `cut ${cut}: ${r.stderr}`).toContain(errorCode(r));
      expect(existsSync(target), `cut ${cut}`).toBe(false);
      expect(existsSync(join(ws.dir, `nest-${cut}`)), `cut ${cut}: no directory may be created before the truncation is detected`).toBe(false);
    }
    expect(leftovers(ws.dir)).toEqual([]);
  });

  it("a tampered artifact byte (same size) is refused as bundle_corrupt (which layer caught it is pinned in round2-boundaries.test.ts)", async () => {
    const { ws, bundle } = await bundled();
    const buf = Buffer.from(readFileSync(bundle));
    const { parseBundleBuffer } = await import("./helpers/bundle.js");
    const parsed = parseBundleBuffer(buf);
    const idx = parsed.header.entries.findIndex((e) => e.role === "artifact");
    const start = buf.indexOf(parsed.bodies[idx] as Buffer);
    buf[start + 3] = (buf[start + 3] as number) ^ 0xff;
    const tampered = join(ws.dir, "tampered.pgbundle");
    await writeFile(tampered, buf);
    const target = join(ws.dir, "tampered-restore");
    const r = await runCli(["bundle", "restore", tampered, "--output", target]);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("bundle_corrupt");
    expect(existsSync(target)).toBe(false);
    expect(leftovers(ws.dir)).toEqual([]);
  });

  it("a damaged trailer checksum, trailing garbage and a corrupted header are all refused", async () => {
    const { ws, bundle } = await bundled();
    const full = readFileSync(bundle);
    const cases: Array<[string, Buffer, string[]]> = [
      ["trailer", Buffer.concat([full.subarray(0, full.length - 3), Buffer.from("00\n")]), ["bundle_corrupt"]],
      ["garbage", Buffer.concat([full, Buffer.from("extra")]), ["bundle_corrupt"]],
      ["header", Buffer.from(full.toString("latin1").replace('"assessment_id"', '"assessment_ib"'), "latin1"), ["bundle_invalid_header"]],
      ["not-a-bundle", Buffer.from("PK\u0003\u0004 zip file"), ["bundle_invalid_header"]],
    ];
    for (const [name, data, codes] of cases) {
      const f = join(ws.dir, `${name}.pgbundle`);
      await writeFile(f, data);
      const target = join(ws.dir, `t-${name}`);
      const r = await runCli(["bundle", "restore", f, "--output", target]);
      expect(r.code, name).toBe(2);
      expect(codes, `${name}: ${r.stderr}`).toContain(errorCode(r));
      expect(existsSync(target), name).toBe(false);
    }
  });

  it("unsupported bundle versions fail explicitly (container version and header schema version)", async () => {
    const { ws, bundle } = await bundled();
    const { parseBundleBuffer, assembleBundle } = await import("./helpers/bundle.js");
    const full = readFileSync(bundle);
    const parsed = parseBundleBuffer(full);
    const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));

    const futureMagic = join(ws.dir, "future-magic.pgbundle");
    await writeFile(futureMagic, assembleBundle(parsed.header, entries, { magic: "PROOFGATE-BUNDLE 2" }));
    const a = await runCli(["bundle", "verify", futureMagic]);
    expect(errorCode(a)).toBe("bundle_unsupported_version");

    const futureSchema = join(ws.dir, "future-schema.pgbundle");
    await writeFile(futureSchema, assembleBundle(parsed.header, entries, { headerOverrides: { schema_version: 2 } }));
    const b = await runCli(["bundle", "verify", futureSchema]);
    expect(errorCode(b)).toBe("unsupported_schema_version");
    expect(existsSync(join(ws.dir, "target"))).toBe(false);
  });

  it("a crafted bundle with a traversal or absolute entry path is refused before anything is written", async () => {
    const { ws, bundle } = await bundled();
    const { parseBundleBuffer, assembleBundle } = await import("./helpers/bundle.js");
    const parsed = parseBundleBuffer(readFileSync(bundle));
    const base = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));
    for (const evil of ["receipts/../../escape.txt", "/tmp/escape.txt", "receipts/a//b", "outside.txt"]) {
      const f = join(ws.dir, "evil.pgbundle");
      await rm(f, { force: true });
      await writeFile(f, assembleBundle(parsed.header, [...base, { path: evil, role: "artifact", bytes: Buffer.from("pwn") }]));
      const target = join(ws.dir, "evil-target");
      const r = await runCli(["bundle", "restore", f, "--output", target]);
      expect(r.code, evil).toBe(2);
      expect(errorCode(r), evil).toBe("bundle_entry_invalid");
      expect(existsSync(target)).toBe(false);
      expect(existsSync(join(ws.dir, "..", "escape.txt"))).toBe(false);
    }
  });

  it("a bundle whose report no longer follows from its own inputs is refused even when every hash is internally consistent", async () => {
    const { ws, bundle } = await bundled();
    const { parseBundleBuffer, assembleBundle } = await import("./helpers/bundle.js");
    const { canonicalize, hashCanonical } = await import("../src/canonical.js");
    const parsed = parseBundleBuffer(readFileSync(bundle));
    const entries = parsed.header.entries.map((e, i) => ({ path: e.path, role: e.role, bytes: parsed.bodies[i] as Buffer }));
    // Forge: flip the verdict/status in the report, then recompute report.sha256 and the header hash.
    const rIdx = entries.findIndex((e) => e.path === "report/report.json");
    const report = JSON.parse((entries[rIdx] as { bytes: Buffer }).bytes.toString("utf8"));
    report.requirements[0].status = "FAIL";
    report.verdict = "unsatisfied";
    report.exit_code = 1;
    // Keep the forged report self-consistent (summary follows the decisions) so that only the re-evaluation can catch it.
    report.summary.mandatory_passed -= 1;
    report.summary.mandatory_unsatisfied += 1;
    report.summary.by_status.PASS -= 1;
    report.summary.by_status.FAIL += 1;
    (entries[rIdx] as { bytes: Buffer }).bytes = Buffer.from(`${JSON.stringify(JSON.parse(canonicalize(report)), null, 2)}\n`);
    const hIdx = entries.findIndex((e) => e.path === "report/report.sha256");
    (entries[hIdx] as { bytes: Buffer }).bytes = Buffer.from(`${hashCanonical(report)}\n`);
    const forged = join(ws.dir, "forged.pgbundle");
    await writeFile(forged, assembleBundle(parsed.header, entries, { headerOverrides: { report_content_hash: hashCanonical(report) } }));
    const r = await runCli(["bundle", "verify", forged]);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("bundle_reevaluation_mismatch");
  });

  it("restore never overwrites an existing target and export never overwrites an existing bundle", async () => {
    const { ws, bundle } = await bundled();
    const target = join(ws.dir, "precious");
    await mkdir(target);
    await writeFile(join(target, "keep.txt"), "keep");
    const r = await runCli(["bundle", "restore", bundle, "--output", target]);
    expect(errorCode(r)).toBe("bundle_target_exists");
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("keep");
    expect(errorCode(await runCli(bundleExportArgs(ws, bundle)))).toBe("bundle_target_exists");
  });

  it("export refuses inputs that do not reproduce the report", async () => {
    const { ws } = await bundled();
    await writeReceipt(ws, { receipt: { result: "fail", tests: { total: 2, passed: 0, failed: 2, skipped: 0 } } });
    const r = await runCli(bundleExportArgs(ws, join(ws.dir, "second.pgbundle")));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("bundle_input_mismatch");
    expect(existsSync(join(ws.dir, "second.pgbundle"))).toBe(false);
  });

  it("export refuses artifacts containing credential-shaped text unless explicitly allowed", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { artifact: `<log>token ${FAKE.githubToken} leaked</log>` });
    await evaluate(ws);
    const refused = await runCli(bundleExportArgs(ws, join(ws.dir, "s.pgbundle")));
    expect(refused.code).toBe(2);
    expect(errorCode(refused)).toBe("bundle_secret_detected");
    expect(refused.stderr).not.toContain(FAKE.githubToken);
    const allowed = await runCli(bundleExportArgs(ws, join(ws.dir, "s.pgbundle"), ["--allow-secret-artifacts"]));
    expect(allowed.code, allowed.stderr).toBe(0);
  });

  it("enforces the bundle size cap with an explicit override", async () => {
    const { ws, bundle } = await bundled();
    const small = await runCli(["bundle", "verify", bundle, "--max-blob-bytes", "10"]);
    expect(errorCode(small)).toBe("bundle_too_large");
    const exportSmall = await runCli(bundleExportArgs(ws, join(ws.dir, "tiny.pgbundle"), ["--max-blob-bytes", "10"]));
    expect(["bundle_too_large", "limit_blob_bytes"]).toContain(errorCode(exportSmall));
    expect((await runCli(["bundle", "verify", bundle, "--max-blob-bytes", "10000000"])).code).toBe(0);
  });

  it("bundles are reproducible: the same report and inputs produce byte-identical bundles", async () => {
    const { ws, bundle } = await bundled();
    const again = join(ws.dir, "again.pgbundle");
    await runCli(bundleExportArgs(ws, again));
    expect(readFileSync(again).equals(readFileSync(bundle))).toBe(true);
  });

  it("extensions and adapter provenance survive the round trip verbatim", async () => {
    const ws = await track(await makeWorkspace());
    await writeManifest(ws);
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { extensions: { "vendor.x": { nested: [1, 2, { three: 3 }], text: "café ☃" } } } });
    await evaluate(ws);
    const bundle = join(ws.dir, "ext.pgbundle");
    expect((await runCli(bundleExportArgs(ws, bundle))).code).toBe(0);
    const restored = join(ws.dir, "ext-restored");
    expect((await runCli(["bundle", "restore", bundle, "--output", restored])).code).toBe(0);
    const [file] = readdirSync(join(restored, "receipts")).filter((n) => n.endsWith(".receipt.json"));
    const doc = JSON.parse(readFileSync(join(restored, "receipts", file as string), "utf8"));
    expect(doc.extensions).toEqual({ "vendor.x": { nested: [1, 2, { three: 3 }], text: "café ☃" } });
  });

  it("restoring a missing bundle file is an explicit error", async () => {
    const r = await runCli(["bundle", "verify", "/nonexistent/none.pgbundle"]);
    expect(errorCode(r)).toBe("bundle_not_found");
  });
});

/* ============================================================ synthetic demo fixtures (stage 2b) */
describe("AC-08 synthetic demo fixtures (fixtures/demo.json)", () => {
  type Scenario = { directory: string; expect: { exit_code: number; verdict?: string; statuses?: Record<string, string>; error_code?: string } };
  const descriptor = JSON.parse(readFileSync(join(ROOT, "fixtures", "demo.json"), "utf8")) as { synthetic: boolean; clock: string; scenarios: Record<string, Scenario> };

  it("is labelled synthetic, uses a fixed UTC clock and names four scenarios", () => {
    expect(descriptor.synthetic).toBe(true);
    expect(descriptor.clock).toBe("2026-09-29T12:00:00Z");
    expect(Object.keys(descriptor.scenarios).sort()).toEqual(["duplicate", "happy", "tampered", "unsatisfied"]);
  });

  it.each(["happy", "unsatisfied", "tampered", "duplicate"])("scenario %s evaluates in process to the documented exit code and statuses", async (name) => {
    const scenario = descriptor.scenarios[name] as Scenario;
    const dir = join(ROOT, "fixtures", scenario.directory);
    const out = join(await scratchDir(), "report");
    const r = await runCli(["evaluate", "--manifest", join(dir, "requirements.yaml"), "--receipts", join(dir, "receipts"), "--revisions", join(dir, "revisions.json"), "--output", out, "--now", descriptor.clock]);
    expect(r.code, r.stderr).toBe(scenario.expect.exit_code);
    if (scenario.expect.exit_code === 2) {
      expect(errorCode(r)).toBe(scenario.expect.error_code);
      expect(existsSync(out)).toBe(false);
    } else {
      const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8")) as AnyReport;
      expect(report.verdict).toBe(scenario.expect.verdict);
      expect(Object.fromEntries(report.requirements.map((d) => [d.id, d.status]))).toEqual(scenario.expect.statuses);
    }
  });

  it("the unsatisfied scenario shows every status, so no requirement state is untested by the demo", () => {
    const statuses = new Set(Object.values((descriptor.scenarios.unsatisfied as Scenario).expect.statuses ?? {}));
    for (const s of ["PASS", "FAIL", "STALE", "MISSING", "PARTIAL", "DEFERRED"]) expect(statuses.has(s), s).toBe(true);
  });

  it("committed demo data carries no UUID literal, personal path, e-mail address or credential-shaped text", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else files.push(join(dir, e.name));
      }
    };
    walk(join(ROOT, "fixtures"));
    expect(files.length).toBeGreaterThan(30);
    const bad = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/Users\/|\/home\/|@[a-z0-9-]+\.[a-z]{2,}|BEGIN [A-Z ]*PRIVATE|\b(?:AKIA|ghp_|xox[bp]-|sk-)/i;
    for (const f of files) expect(bad.test(readFileSync(f, "utf8")), f).toBe(false);
  });
});

async function scratchDir(): Promise<string> {
  return (await track(await makeWorkspace())).dir;
}

/* ============================================================ AC index (stage 2b) */
describe("AC index: the PRD 5b flows and the acceptance matrix resolve to real tests", () => {
  const matrix = readFileSync(join(ROOT, "docs", "qa", "ac-matrix.md"), "utf8");
  const prd = readFileSync(join(ROOT, "docs", "prd", "proofgate.md"), "utf8");
  const specTitles = indexFile(join(ROOT, "tests", "proofgate.spec.ts"));

  const ID = /`((?:tests)\/[A-Za-z0-9_./-]+\.(?:test|spec)\.ts) :: ([^`\n]+)`/g;
  const references = [...matrix.matchAll(ID)].map((m) => ({ file: m[1] as string, id: m[2] as string }));

  it("every PRD 5b acceptance placeholder has a describe block named for it in this file, in AC order", () => {
    const placeholders = [...prd.matchAll(/\| (AC-\d\d) \| [^|]+\| `tests\/proofgate\.spec\.ts :: <([^>]+)>`/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(placeholders.length).toBe(10);
    const describes = specTitles.filter((t) => t.kind === "describe" && !t.id.includes(" > ")).map((t) => t.id);
    for (const p of placeholders) expect(describes, p).toContain(p);
    expect(describes.filter((d) => /^AC-\d\d /.test(d)).slice(0, 10)).toEqual(placeholders);
  });

  it("every PRD 5b flow-and-failure row is one of those describe blocks", () => {
    const flows = [...prd.matchAll(/^\| ([a-z][a-z ]+) \| (?:Reject|A receipt|Live-required|At max_age|Report every|Import versioned|Escape malicious)/gm)].map((m) => m[1] as string);
    expect(flows.length).toBe(7);
    const describes = specTitles.filter((t) => t.kind === "describe").map((t) => t.id);
    for (const flow of flows) expect(describes.some((d) => d.endsWith(` ${flow}`)), flow).toBe(true);
  });

  it("the matrix names many test ids and every one resolves to a real describe or test title in the named file", () => {
    expect(references.length).toBeGreaterThan(150);
    const cache = new Map<string, Set<string>>();
    const unresolved: string[] = [];
    for (const { file, id } of references) {
      if (!cache.has(file)) cache.set(file, new Set(indexFile(join(ROOT, file)).map((t) => t.id)));
      if (!(cache.get(file) as Set<string>).has(id)) unresolved.push(`${file} :: ${id}`);
    }
    expect(unresolved).toEqual([]);
  });

  it("every matrix test id that the vitest runner can list is also known to the real runner (the static index is not trusted alone)", () => {
    const out = execFileSync("npx", ["vitest", "list", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, VITEST: "", CI: "1" } });
    const listed = new Map<string, Set<string>>();
    for (const t of JSON.parse(out) as Array<{ name: string; file: string }>) {
      const file = t.file.slice(ROOT.length + 1);
      if (!listed.has(file)) listed.set(file, new Set());
      (listed.get(file) as Set<string>).add(t.name);
    }
    const inMainConfig = references.filter((r) => listed.has(r.file));
    expect(inMainConfig.length).toBeGreaterThan(100);
    const isDescribe = (r: { file: string; id: string }): boolean => indexFile(join(ROOT, r.file)).some((t) => t.id === r.id && t.kind === "describe");
    const unknownToRunner = inMainConfig.filter((r) => !isDescribe(r) && !(listed.get(r.file) as Set<string>).has(r.id) && !/sandbox-exec/.test(r.id));
    expect(unknownToRunner.map((r) => `${r.file} :: ${r.id}`)).toEqual([]);
  }, 120_000);

  const sections = (): Map<string, string> => {
    const out = new Map<string, string>();
    const parts = matrix.split(/^### (AC-\d\d)\b/m);
    for (let i = 1; i < parts.length; i += 2) out.set(parts[i] as string, parts[i + 1] as string);
    return out;
  };

  it("every criterion AC-01..AC-10 lists acceptance tests in this file and in the packaged-binary end-to-end suite", () => {
    const s = sections();
    for (let n = 1; n <= 10; n += 1) {
      const key = `AC-${String(n).padStart(2, "0")}`;
      const body = s.get(key);
      expect(body, `${key} section`).toBeDefined();
      expect(body, key).toContain("tests/proofgate.spec.ts ::");
      expect(body, key).toContain("tests/e2e/packaged-cli.test.ts ::");
    }
  });

  it("uses only the honest status vocabulary in the summary table", () => {
    const rows = [...matrix.matchAll(/^\| (AC-\d\d) \| ([^|]+) \| ([A-Z_ ]+?) \|/gm)];
    expect(rows.map((r) => r[1])).toEqual(["AC-01", "AC-02", "AC-03", "AC-04", "AC-05", "AC-06", "AC-07", "AC-08", "AC-09", "AC-10", "AC-11"]);
    for (const r of rows) expect(["PASS", "PARTIAL", "NOT RUN", "BLOCKED", "PENDING_HUMAN_RECEIPT"], `${r[1]}: ${r[3]}`).toContain(r[3]);
  });

  it("AC-11 is PENDING_HUMAN_RECEIPT: no agent-run evidence, the automated harness included, may mark it satisfied", () => {
    const row = /^\| AC-11 \|[^\n]*$/m.exec(matrix)?.[0] ?? "";
    expect(row).toContain("PENDING_HUMAN_RECEIPT");
    expect(row).not.toMatch(/\| PASS \|/);
    const section = sections().get("AC-11") ?? "";
    expect(section).toContain("PENDING_HUMAN_RECEIPT");
    expect(section).toMatch(/supplemental/i);
    expect(section).not.toMatch(/Status:\s*\*{0,2}PASS/);
    const drill = readFileSync(join(ROOT, "docs", "HUMAN-DRILL.md"), "utf8");
    expect(drill).toContain("the only thing that can close acceptance criterion AC-11");
    expect(drill).toContain("Assistance given");
    expect(drill).toContain("Cleanup receipt");
    // Review round 2 (conformance P1): the sheet must tie the drill to the FINAL commit and say what does not count.
    expect(drill).toContain("Source commit the tarball was built from");
    expect(drill).toContain("**A drill on any other commit does not count**");
    expect(drill).toMatch(/docs-only commit changes the tarball bytes/);
    expect(drill).toMatch(/maintainer builds the tarball and computes its SHA-256 personally/);
    expect(drill).toMatch(/step 4 needs network access/);
    expect(drill).toContain("Evidence kept");
  });

  it("AC-03, AC-06 and AC-09 stay PARTIAL until independently resolved: AC-06 names its upstream blocker and pending owner decision, and the documents agree", () => {
    const rowOf = (ac: string): string => new RegExp(`^\\| ${ac} \\|[^\\n]*$`, "m").exec(matrix)?.[0] ?? "";
    for (const ac of ["AC-03", "AC-06", "AC-09"]) {
      expect(rowOf(ac), ac).toMatch(/\| PARTIAL \|/);
      expect(rowOf(ac), ac).not.toMatch(/\| PASS \|/);
      expect(sections().get(ac) ?? "", `${ac} section`).toMatch(/Status: \*\*PARTIAL\.\*\*/);
    }
    const ac06 = sections().get("AC-06") ?? "";
    expect(ac06).toMatch(/blocked upstream/i);
    expect(ac06).toMatch(/owner decision/i);
    const adapters = readFileSync(join(ROOT, "docs", "ADAPTERS.md"), "utf8");
    expect(adapters).toContain("AC-06 is PARTIAL");
    expect(adapters).toMatch(/BLOCKED upstream/);
    expect(adapters).toMatch(/owner decision[^.]*pending/i);
    expect(readFileSync(join(ROOT, "README.md"), "utf8")).toContain("**AC-06 is PARTIAL**");
    // The redaction row carries the best-effort caveat that README, SECURITY and INTERFACES already carry.
    expect(rowOf("AC-09")).toMatch(/best effort/i);
    expect(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")).toMatch(/redact[^\n]*best effort/i);
  });

  it("the operator documents exist and cover install, upgrade, backup, restore, failure diagnosis and retention", () => {
    for (const f of ["README.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "docs/OPERATIONS.md", "docs/RUNBOOK-SMOKE.md", "docs/HUMAN-DRILL.md", "docs/RELEASE.md", "Dockerfile", ".dockerignore"]) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
    }
    const ops = readFileSync(join(ROOT, "docs", "OPERATIONS.md"), "utf8");
    for (const heading of ["## Install", "## Upgrade", "## Backup", "## Restore", "## Failure diagnosis", "## Retention"]) expect(ops, heading).toContain(heading);
  });

  it("the failure-diagnosis tables list every stable error code and every decision reason code", () => {
    const ops = readFileSync(join(ROOT, "docs", "OPERATIONS.md"), "utf8");
    const missingErrors = ERROR_CODES.filter((c) => !ops.includes(`| \`${c}\` |`));
    const missingReasons = Object.keys(REASON_DESCRIPTIONS).filter((c) => !ops.includes(`| \`${c}\` |`));
    expect({ missingErrors, missingReasons }).toEqual({ missingErrors: [], missingReasons: [] });
  });

  it("the smoke runbook is executable by the harness: every step has an expected result and the manual steps are marked", () => {
    const runbook = readFileSync(join(ROOT, "docs", "RUNBOOK-SMOKE.md"), "utf8");
    const blocks = [...runbook.matchAll(/<!-- smoke: ([^>]*?) -->\s*```sh\n/g)].map((m) => m[1] as string);
    const fences = [...runbook.matchAll(/```sh\n/g)].length;
    expect(blocks.length, "every sh block is preceded by a smoke directive").toBe(fences);
    expect(blocks.filter((b) => b.includes("manual")).length).toBeGreaterThanOrEqual(2);
    expect(blocks.filter((b) => !b.includes("manual") && !/expect=/.test(b))).toEqual([]);
  });
});
