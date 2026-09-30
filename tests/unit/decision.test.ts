import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { assess, classifyEvidence, combineStatuses, decideRequirement, disqualifiers } from "../../src/evaluate.js";
import { hashCanonical } from "../../src/canonical.js";
import { parseManifestText } from "../../src/manifest.js";
import type { LoadedReceipt } from "../../src/receipt.js";
import { parseRevisionsText } from "../../src/revisions.js";
import type { NormalizedRequirement, Receipt } from "../../src/schemas.js";
import { NOW, NOW_MS, REPOS, baseManifest, baseRequirement, isoAgo, uuid } from "../helpers/fixture.js";

let n = 0;
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
const decide = (r: NormalizedRequirement, receipts: LoadedReceipt[], now = NOW_MS) => decideRequirement(r, receipts, revisions, now);

describe("combineStatuses", () => {
  it.each([
    [["PASS"], "PASS"],
    [["PASS", "PASS"], "PASS"],
    [["FAIL", "PASS"], "FAIL"],
    [["FAIL", "MISSING"], "FAIL"],
    [["PARTIAL", "PASS"], "PARTIAL"],
    [["PASS", "MISSING"], "PARTIAL"],
    [["PASS", "STALE"], "PARTIAL"],
    [["STALE", "MISSING"], "STALE"],
    [["STALE", "STALE"], "STALE"],
    [["MISSING", "MISSING"], "MISSING"],
    [["PARTIAL", "MISSING"], "PARTIAL"],
    [["PARTIAL", "STALE"], "PARTIAL"],
  ] as const)("%j -> %s", (input, expected) => {
    expect(combineStatuses([...input])).toBe(expected);
  });
});

describe("disqualifiers", () => {
  const r = req();
  it("is empty for a receipt that matches on every identity axis", () => {
    expect(disqualifiers(r, REPOS.api, lr(), NOW_MS)).toEqual([]);
  });
  it("lists every failed axis at once", () => {
    const why = disqualifiers(r, "f".repeat(40), lr({ environment: "dev", test_level: "unit", execution_kind: "mocked", finished_at: isoAgo(-5) }), NOW_MS);
    expect(why).toEqual(["revision_mismatch", "environment_mismatch", "level_insufficient", "execution_kind_not_allowed", "receipt_from_future"]);
  });
  it("orders levels unit < integration < e2e", () => {
    expect(disqualifiers(req({ required_level: "e2e" }), REPOS.api, lr({ test_level: "integration" }), NOW_MS)).toEqual(["level_insufficient"]);
    expect(disqualifiers(req({ required_level: "unit" }), REPOS.api, lr({ test_level: "e2e" }), NOW_MS)).toEqual([]);
    expect(disqualifiers(req({ required_level: "integration" }), REPOS.api, lr({ test_level: "integration" }), NOW_MS)).toEqual([]);
  });
  it("a receipt finishing exactly at the evaluation instant is not from the future", () => {
    expect(disqualifiers(r, REPOS.api, lr({ finished_at: NOW }), NOW_MS)).toEqual([]);
    expect(disqualifiers(r, REPOS.api, lr({ finished_at: new Date(NOW_MS + 1).toISOString() }), NOW_MS)).toEqual(["receipt_from_future"]);
  });
});

describe("classifyEvidence", () => {
  const r = req({ max_age_seconds: 100 });
  const at = (result: Receipt["result"], tests: Receipt["tests"], age = 10) => classifyEvidence(r, lr({ result, tests, finished_at: isoAgo(age) }), NOW_MS);
  const t = (total: number, passed: number, failed: number, skipped: number) => ({ total, passed, failed, skipped });

  it("boundary: 99 s fresh, 100 s stale, 101 s stale", () => {
    expect(at("pass", t(2, 2, 0, 0), 99).status).toBe("PASS");
    expect(at("pass", t(2, 2, 0, 0), 100).status).toBe("STALE");
    expect(at("pass", t(2, 2, 0, 0), 101).status).toBe("STALE");
  });
  it("staleness outranks every content classification", () => {
    expect(at("fail", t(2, 0, 2, 0), 500).status).toBe("STALE");
    expect(at("pass", t(0, 0, 0, 0), 500).status).toBe("STALE");
  });
  it("classifies content", () => {
    expect(at("pass", t(0, 0, 0, 0))).toMatchObject({ status: "MISSING", reasons: ["zero_tests"] });
    expect(at("fail", t(3, 3, 0, 0))).toMatchObject({ status: "FAIL", reasons: ["result_failed"] });
    expect(at("fail", t(3, 1, 2, 0))).toMatchObject({ status: "FAIL", reasons: ["tests_failed"] });
    expect(at("pass", t(3, 2, 1, 0))).toMatchObject({ status: "FAIL", reasons: ["tests_failed", "result_contradicts_counts"] });
    expect(at("pass", t(3, 2, 0, 1))).toMatchObject({ status: "PARTIAL", reasons: ["tests_skipped"] });
    expect(at("partial", t(3, 3, 0, 0))).toMatchObject({ status: "PARTIAL", reasons: ["partial_result"] });
    expect(at("skipped", t(3, 0, 0, 3))).toMatchObject({ status: "PARTIAL", reasons: ["tests_skipped", "suite_skipped"] });
    expect(at("pass", t(3, 3, 0, 0))).toMatchObject({ status: "PASS", reasons: ["all_criteria_met"] });
  });
  it("treats passed < total (unaccounted tests) as partial even without skips", () => {
    expect(classifyEvidence(r, lr({ tests: { total: 3, passed: 2, failed: 0, skipped: 0 } }), NOW_MS).status).toBe("PARTIAL");
  });
});

describe("decideRequirement (single repository)", () => {
  const r = req();

  it("MISSING with no_receipt when nothing names the requirement for the repository", () => {
    const d = decide(r, []);
    expect(d).toMatchObject({ status: "MISSING", reason_codes: ["no_receipt"], receipt_ids: [] });
    expect(d.per_repository).toEqual([{ repository: "api", expected_commit_sha: REPOS.api, status: "MISSING", reason_codes: ["no_receipt"], receipt_ids: [] }]);
  });

  it("receipts naming other requirements are invisible", () => {
    expect(decide(r, [lr({ requirement_ids: ["REQ-002"] })]).reason_codes).toEqual(["no_receipt"]);
  });

  it("MISSING with no_qualifying_receipt and the rejection reasons when receipts exist but none qualifies", () => {
    const bad = lr({ environment: "dev" });
    const d = decide(r, [bad]);
    expect(d.status).toBe("MISSING");
    expect(d.reason_codes).toEqual(["environment_mismatch", "no_qualifying_receipt"]);
    expect(d.rejected_receipts).toEqual([{ receipt_id: bad.receipt.receipt_id, repository: "api", reason_codes: ["environment_mismatch"] }]);
  });

  it("PASS lists every passing receipt as a source and their environments", () => {
    const a = lr();
    const b = lr({ test_level: "e2e" });
    const d = decide(r, [a, b]);
    expect(d.status).toBe("PASS");
    expect(d.receipt_ids).toEqual([a.receipt.receipt_id, b.receipt.receipt_id].sort());
    expect(d.environments).toEqual(["staging"]);
  });

  it("any qualifying failure wins over passes, flagged as conflicting evidence", () => {
    const pass = lr();
    const fail = lr({ result: "fail", tests: { total: 2, passed: 1, failed: 1, skipped: 0 } });
    const d = decide(r, [pass, fail]);
    expect(d.status).toBe("FAIL");
    expect(d.reason_codes).toEqual(["conflicting_evidence", "tests_failed"]);
    expect(d.receipt_ids).toEqual([fail.receipt.receipt_id]);
  });

  it("a failure alone is FAIL without the conflict marker", () => {
    expect(decide(r, [lr({ result: "fail", tests: { total: 2, passed: 1, failed: 1, skipped: 0 } })]).reason_codes).toEqual(["tests_failed"]);
  });

  it("partial beats pass; a stale failure is ignored when fresh passing evidence exists", () => {
    const pass = lr();
    const partial = lr({ tests: { total: 4, passed: 3, failed: 0, skipped: 1 } });
    expect(decide(r, [pass, partial]).status).toBe("PARTIAL");
    const staleFail = lr({ result: "fail", tests: { total: 4, passed: 0, failed: 4, skipped: 0 }, finished_at: isoAgo(90_000) });
    const d = decide(r, [pass, staleFail]);
    expect(d.status).toBe("PASS");
    expect(d.receipt_ids).toEqual([pass.receipt.receipt_id]);
  });

  it("a zero-test PASS claim proves nothing: ignored beside substantive evidence, MISSING alone (fail/partial/skipped are covered in round1-decision and the properties)", () => {
    const empty = lr({ tests: { total: 0, passed: 0, failed: 0, skipped: 0 } });
    expect(decide(r, [empty]).status).toBe("MISSING");
    expect(decide(r, [empty]).receipt_ids).toEqual([empty.receipt.receipt_id]);
    expect(decide(r, [empty, lr()]).status).toBe("PASS");
  });

  it("only-stale evidence is STALE and lists the stale receipts", () => {
    const old = lr({ finished_at: isoAgo(7200) });
    const d = decide(r, [old]);
    expect(d).toMatchObject({ status: "STALE", reason_codes: ["evidence_stale"], receipt_ids: [old.receipt.receipt_id] });
  });

  it("receipts for a repository the requirement does not cover are rejected", () => {
    const web = lr({ repository: "web", commit_sha: REPOS.web });
    const d = decide(r, [web]);
    expect(d.status).toBe("MISSING");
    expect(d.rejected_receipts).toEqual([{ receipt_id: web.receipt.receipt_id, repository: "web", reason_codes: ["repository_not_required"] }]);
  });

  it("DEFERRED overrides the status but keeps the evidence view", () => {
    const d = decide(req({ deferred: { reason: "waiting on vendor" } }), [lr()]);
    expect(d).toMatchObject({ status: "DEFERRED", evidence_status: "PASS", deferred_reason: "waiting on vendor" });
    expect(d.reason_codes).toEqual(["all_criteria_met", "requirement_deferred"]);
    expect(decide(req({ deferred: { reason: "x" } }), []).evidence_status).toBe("MISSING");
  });
});

describe("decideRequirement (multi-repository)", () => {
  const r = req({ repositories: ["api", "web"] });
  const api = () => lr();
  const web = (o: Partial<Receipt> = {}) => lr({ repository: "web", commit_sha: REPOS.web, ...o });

  it("PASS needs both repositories", () => {
    expect(decide(r, [api(), web()]).status).toBe("PASS");
  });
  it("one repository passing and the other missing is PARTIAL with the coverage marker", () => {
    const d = decide(r, [api()]);
    expect(d.status).toBe("PARTIAL");
    expect(d.reason_codes).toContain("incomplete_repository_coverage");
    expect(d.reason_codes).toContain("no_receipt");
  });
  it("one failing repository fails the requirement even if the other passes", () => {
    expect(decide(r, [api(), web({ result: "fail", tests: { total: 1, passed: 0, failed: 1, skipped: 0 } })]).status).toBe("FAIL");
  });
  it("a stale repository beside a passing one is PARTIAL; all stale is STALE", () => {
    expect(decide(r, [api(), web({ finished_at: isoAgo(9000) })]).status).toBe("PARTIAL");
    expect(decide(r, [lr({ finished_at: isoAgo(9000) }), web({ finished_at: isoAgo(9000) })]).status).toBe("STALE");
  });
  it("uses the declared SHA of each repository independently", () => {
    const d = decide(r, [api(), web({ commit_sha: REPOS.api })]);
    expect(d.per_repository.find((p) => p.repository === "web")?.reason_codes).toContain("revision_mismatch");
  });
});

describe("assess (the assessment as a whole)", () => {
  const manifest = manifestOf([baseRequirement(), baseRequirement({ id: "REQ-002", severity: "advisory" })]);
  const input = (receipts: LoadedReceipt[], now = new Date(NOW), extra = {}) => ({
    manifest,
    revisions,
    receipts,
    now,
    inputSummary: { files_scanned: 0, receipt_documents: receipts.length, metadata_bytes: 0, artifact_bytes: 0 },
    ...extra,
  });

  it("is deterministic for fixed inputs and a fixed clock, and the id changes with any input", () => {
    const rc = [lr()];
    const a = assess(input(rc));
    expect(assess(input(rc))).toEqual(a);
    expect(assess(input(rc, new Date(NOW_MS + 1000))).assessment_id).not.toBe(a.assessment_id);
    expect(assess(input([lr()])).assessment_id).not.toBe(a.assessment_id);
    expect(assess({ ...input(rc), manifest: manifestOf([baseRequirement({ max_age_seconds: 30 })]) }).assessment_id).not.toBe(a.assessment_id);
  });

  it("summarises statuses and derives the verdict from mandatory requirements only", () => {
    const passing = assess(input([lr()]));
    expect(passing).toMatchObject({ verdict: "accepted", exit_code: 0 });
    expect(passing.summary).toMatchObject({ total_requirements: 2, mandatory_requirements: 1, mandatory_passed: 1, mandatory_unsatisfied: 0 });
    expect(passing.summary.by_status).toMatchObject({ PASS: 1, MISSING: 1 });
    const failing = assess(input([]));
    expect(failing).toMatchObject({ verdict: "unsatisfied", exit_code: 1 });
    expect(failing.summary.mandatory_unsatisfied).toBe(1);
  });

  it("carries the supersedes link and indexes every receipt with its adapter and content hash", () => {
    const rc = lr();
    const report = assess(input([rc], new Date(NOW), { supersedes: { assessment_id: uuid(1), manifest_hash: "a".repeat(64), policy_hash: "b".repeat(64), policy_changed: true } }));
    expect(report.supersedes?.policy_changed).toBe(true);
    expect(report.receipts[0]).toMatchObject({ receipt_id: rc.receipt.receipt_id, content_sha256: rc.content_sha256, adapter: { provenance: "native" }, artifact_path: "a.txt" });
    expect(report.engine).toMatchObject({ name: "proofgate", policy_version: 2 });
  });

  it("redacts secrets that reach the report even if they slipped past load-time redaction", () => {
    const leaky = lr({ runner_id: "token=abcdefghijklmnop" });
    const report = assess(input([leaky]));
    expect(JSON.stringify(report)).not.toContain("abcdefghijklmnop");
  });
});
