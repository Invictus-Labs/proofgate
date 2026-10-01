import { stringify } from "yaml";
import { hashCanonical } from "../../src/canonical.js";
import { assess } from "../../src/evaluate.js";
import { parseManifestText } from "../../src/manifest.js";
import type { LoadedReceipt } from "../../src/receipt.js";
import { parseRevisionsText } from "../../src/revisions.js";
import { reportSchema, type Receipt, type Report } from "../../src/schemas.js";
import { NOW, NOW_MS, REPOS, isoAgo } from "./fixture.js";

/**
 * Synthetic reports for the renderer tests, QA and the demo script. They are produced by the real
 * decision engine (`assess`) from in-memory manifests and receipts under the fixed clock `NOW`, so
 * they are schema-valid, reconcile with their own decisions and are byte-for-byte reproducible.
 */

let counter = 0;
/** Receipt ids are opaque tokens (not UUIDs), which keeps raw UUIDs out of the golden files. */
const rid = (n: number): string => `rcpt-${String(n).padStart(4, "0")}`;

export function receipt(overrides: Partial<Receipt> = {}): LoadedReceipt {
  counter += 1;
  const r: Receipt = {
    receipt_id: rid(counter),
    requirement_ids: ["REQ-PASS"],
    repository: "api",
    commit_sha: REPOS.api,
    runner_id: "runner-synthetic-1",
    environment: "staging",
    test_level: "integration",
    execution_kind: "live",
    result: "pass",
    tests: { total: 12, passed: 12, failed: 0, skipped: 0 },
    artifact: { path: `artifacts/${rid(counter)}.xml`, sha256: "a".repeat(64) },
    finished_at: isoAgo(600),
    command: "npm test -- --run",
    extensions: null,
    ...overrides,
  };
  return {
    receipt: r,
    adapter: { name: "proofgate.receipt", version: 1, provenance: "native" },
    source_file: `${r.receipt_id}.receipt.json`,
    content_sha256: hashCanonical(r),
    source_document: {},
    artifact_size: 1,
  };
}

export function requirement(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Synthetic requirement ${id}`,
    severity: "mandatory",
    required_level: "integration",
    required_environment: "staging",
    max_age_seconds: 3600,
    repositories: ["api"],
    ...overrides,
  };
}

export function buildReport(requirements: Array<Record<string, unknown>>, receipts: LoadedReceipt[], extra: { manifestName?: string; now?: Date } = {}): Report {
  const manifest = parseManifestText(
    stringify({
      schema_version: 1,
      name: extra.manifestName ?? "demo-release-gate",
      repositories: [{ id: "api" }, { id: "web" }],
      requirements,
    }),
  );
  const revisions = parseRevisionsText(
    JSON.stringify({ schema_version: 1, revisions: [{ repository: "api", commit_sha: REPOS.api }, { repository: "web", commit_sha: REPOS.web }] }),
  );
  const report = assess({
    manifest,
    revisions,
    receipts,
    now: extra.now ?? new Date(NOW_MS),
    inputSummary: { files_scanned: receipts.length * 2 + 2, receipt_documents: receipts.length, metadata_bytes: 4096, artifact_bytes: receipts.length },
  });
  return reportSchema.parse(report);
}

/** Mandatory failures of every kind plus advisory and rejected-receipt cases: exit code 1. */
export function exit1Report(): Report {
  counter = 0;
  return buildReport(
    [
      requirement("REQ-PASS", { title: "Checkout API integration tests" }),
      requirement("REQ-FAIL", { title: "Payment capture integration tests" }),
      requirement("REQ-STALE", { title: "Inventory sync integration tests", max_age_seconds: 600 }),
      requirement("REQ-MISSING", { title: "Refund flow integration tests" }),
      requirement("REQ-PARTIAL", { title: "Cross-repository contract tests", repositories: ["api", "web"] }),
      requirement("REQ-DEFERRED", { title: "Vendor sandbox tests", deferred: { reason: "Vendor sandbox is unavailable this week" } }),
      requirement("REQ-ADV-PASS", { title: "Advisory lint gate", severity: "advisory", required_level: "unit" }),
      requirement("REQ-ADV-FAIL", { title: "Advisory accessibility audit", severity: "advisory" }),
    ],
    [
      receipt({ requirement_ids: ["REQ-PASS"] }),
      receipt({ requirement_ids: ["REQ-FAIL"], result: "fail", tests: { total: 10, passed: 8, failed: 2, skipped: 0 } }),
      receipt({ requirement_ids: ["REQ-STALE"], finished_at: isoAgo(600) }), // exactly at the boundary
      // A mocked run and a run on another commit both name REQ-MISSING but cannot count.
      receipt({ requirement_ids: ["REQ-MISSING"], execution_kind: "mocked" }),
      receipt({ requirement_ids: ["REQ-MISSING"], commit_sha: "f".repeat(40) }),
      receipt({ requirement_ids: ["REQ-PARTIAL"] }),
      receipt({ requirement_ids: ["REQ-DEFERRED"] }),
      receipt({ requirement_ids: ["REQ-ADV-PASS"], test_level: "unit" }),
      receipt({ requirement_ids: ["REQ-ADV-FAIL"], result: "partial", tests: { total: 5, passed: 3, failed: 0, skipped: 2 } }),
    ],
  );
}

/** Every mandatory requirement passes (advisory items are open): exit code 0. */
export function exit0Report(): Report {
  counter = 100;
  return buildReport(
    [
      requirement("REQ-PASS", { title: "Checkout API integration tests" }),
      requirement("REQ-E2E", { title: "Cross-repository end-to-end flow", repositories: ["api", "web"], required_level: "e2e" }),
      requirement("REQ-ADV-DEFERRED", { title: "Advisory load test", severity: "advisory", deferred: { reason: "Scheduled for the next release" } }),
    ],
    [
      receipt({ requirement_ids: ["REQ-PASS"] }),
      receipt({ requirement_ids: ["REQ-E2E"], repository: "api", test_level: "e2e" }),
      receipt({ requirement_ids: ["REQ-E2E"], repository: "web", commit_sha: REPOS.web, test_level: "e2e" }),
    ],
  );
}

/** No requirements at all (a hand-built document; the core refuses such a manifest). */
export function emptyReport(): Report {
  const base = exit0Report();
  return {
    ...base,
    verdict: "unsatisfied",
    exit_code: 1,
    summary: { total_requirements: 0, mandatory_requirements: 0, mandatory_passed: 0, mandatory_unsatisfied: 0, by_status: { PASS: 0, FAIL: 0, STALE: 0, MISSING: 0, PARTIAL: 0, DEFERRED: 0 } },
    requirements: [],
    receipts: [],
    revisions: [],
  };
}

export const FIXED_NOW = NOW;
