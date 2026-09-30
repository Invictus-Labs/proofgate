#!/usr/bin/env node
// Render a synthetic demo report through the packaged CLI so QA can inspect index.html in a browser.
//
//   npm run build
//   node tests/helpers/render-demo.mjs <work-dir>          # exit code 1: mandatory requirements are unsatisfied
//   node tests/helpers/render-demo.mjs <work-dir> --pass   # exit code 0: every mandatory requirement passes
//
// <work-dir> must not exist. It receives inputs/ (manifest, revisions, receipts + artifacts) and report/
// (report.json, report.sha256, index.html). The clock is fixed, so the output is byte-for-byte reproducible.
// All data is synthetic. Nothing is fetched and nothing outside <work-dir> is written.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NOW = "2026-09-29T12:00:00Z";
const nowMs = Date.parse(NOW);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const pass = args.includes("--pass");
const target = args.find((a) => !a.startsWith("--"));
if (target === undefined) {
  console.error("usage: node tests/helpers/render-demo.mjs <work-dir> [--pass]");
  process.exit(64);
}
const work = resolve(target);
if (existsSync(work)) {
  console.error(`refusing to reuse an existing directory: ${work}`);
  process.exit(64);
}
if (!existsSync(join(root, "dist", "cli.js"))) {
  console.error("dist/cli.js is missing: run `npm run build` first");
  process.exit(64);
}

const sha = (label) => createHash("sha1").update(label).digest("hex");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const revisions = { api: sha("api-commit"), web: sha("web-commit") };
const ago = (seconds) => new Date(nowMs - seconds * 1000).toISOString();

const req = (id, title, extra = {}) => ({
  id,
  title,
  severity: "mandatory",
  required_level: "integration",
  required_environment: "staging",
  max_age_seconds: 3600,
  repositories: ["api"],
  ...extra,
});

let n = 0;
const rec = (extra) => {
  n += 1;
  return {
    receipt_id: `rcpt-${String(n).padStart(4, "0")}`,
    requirement_ids: ["REQ-PASS"],
    repository: "api",
    commit_sha: revisions.api,
    runner_id: "runner-synthetic-1",
    environment: "staging",
    test_level: "integration",
    execution_kind: "live",
    result: "pass",
    tests: { total: 12, passed: 12, failed: 0, skipped: 0 },
    finished_at: ago(600),
    command: "npm test -- --run",
    ...extra,
  };
};

const scenario = pass
  ? {
      requirements: [
        req("REQ-PASS", "Checkout API integration tests"),
        req("REQ-E2E", "Cross-repository end-to-end flow", { repositories: ["api", "web"], required_level: "e2e" }),
        req("REQ-ADV-DEFERRED", "Advisory load test", { severity: "advisory", deferred: { reason: "Scheduled for the next release" } }),
      ],
      receipts: [
        rec({}),
        rec({ requirement_ids: ["REQ-E2E"], test_level: "e2e" }),
        rec({ requirement_ids: ["REQ-E2E"], repository: "web", commit_sha: revisions.web, test_level: "e2e" }),
      ],
    }
  : {
      requirements: [
        req("REQ-PASS", "Checkout API integration tests"),
        req("REQ-FAIL", "Payment capture integration tests"),
        req("REQ-STALE", "Inventory sync integration tests", { max_age_seconds: 600 }),
        req("REQ-MISSING", "Refund flow integration tests"),
        req("REQ-PARTIAL", "Cross-repository contract tests", { repositories: ["api", "web"] }),
        req("REQ-DEFERRED", "Vendor sandbox tests", { deferred: { reason: "Vendor sandbox is unavailable this week" } }),
        req("REQ-ADV-PASS", "Advisory lint gate", { severity: "advisory", required_level: "unit" }),
        req("REQ-ADV-FAIL", "Advisory accessibility audit", { severity: "advisory" }),
      ],
      receipts: [
        rec({}),
        rec({ requirement_ids: ["REQ-FAIL"], result: "fail", tests: { total: 10, passed: 8, failed: 2, skipped: 0 } }),
        rec({ requirement_ids: ["REQ-STALE"] }),
        rec({ requirement_ids: ["REQ-MISSING"], execution_kind: "mocked" }),
        rec({ requirement_ids: ["REQ-MISSING"], commit_sha: "f".repeat(40) }),
        rec({ requirement_ids: ["REQ-PARTIAL"] }),
        rec({ requirement_ids: ["REQ-DEFERRED"] }),
        rec({ requirement_ids: ["REQ-ADV-PASS"], test_level: "unit" }),
        rec({ requirement_ids: ["REQ-ADV-FAIL"], result: "partial", tests: { total: 5, passed: 3, failed: 0, skipped: 2 } }),
      ],
    };

const inputs = join(work, "inputs");
const receiptsDir = join(inputs, "receipts");
mkdirSync(join(receiptsDir, "artifacts"), { recursive: true });
for (const r of scenario.receipts) {
  const artifact = `<testsuite name="synthetic" id="${r.receipt_id}"/>\n`;
  const path = `artifacts/${r.receipt_id}.xml`;
  writeFileSync(join(receiptsDir, path), artifact);
  const doc = { schema_version: 1, ...r, artifact: { path, sha256: sha256(artifact) } };
  writeFileSync(join(receiptsDir, `${r.receipt_id}.receipt.json`), `${JSON.stringify(doc, null, 2)}\n`);
}
// JSON is valid YAML, so the manifest is written as JSON.
writeFileSync(
  join(inputs, "requirements.yaml"),
  `${JSON.stringify({ schema_version: 1, name: pass ? "demo-release-gate-accepted" : "demo-release-gate", repositories: [{ id: "api" }, { id: "web" }], requirements: scenario.requirements }, null, 2)}\n`,
);
writeFileSync(
  join(inputs, "revisions.json"),
  `${JSON.stringify({ schema_version: 1, revisions: Object.entries(revisions).map(([repository, commit_sha]) => ({ repository, commit_sha })) }, null, 2)}\n`,
);

const output = join(work, "report");
const run = spawnSync(
  process.execPath,
  [join(root, "dist", "cli.js"), "evaluate", "--manifest", join(inputs, "requirements.yaml"), "--receipts", receiptsDir, "--revisions", join(inputs, "revisions.json"), "--output", output, "--now", NOW],
  { stdio: ["ignore", "inherit", "inherit"], env: { PATH: process.env.PATH ?? "" } },
);
console.log(`\nproofgate evaluate exit code: ${run.status} (${pass ? "expected 0" : "expected 1"})`);
console.log(`open in a browser: ${pathToFileURL(join(output, "index.html")).href}`);
process.exit(run.status === (pass ? 0 : 1) ? 0 : 1);
