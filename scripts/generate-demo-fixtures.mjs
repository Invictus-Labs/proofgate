// Generates the synthetic demo fixtures in fixtures/demo/** and the descriptor fixtures/demo.json.
// Usage: node scripts/generate-demo-fixtures.mjs [--check]
//   (no flag) write the fixtures; --check exits 1 if any committed fixture differs from what would be generated.
//
// Everything is synthetic and deterministic: a fixed UTC clock, opaque receipt ids (no UUID literals), commit SHAs
// derived from fixed labels, artifact hashes computed here. No network, no accounts, no personal data.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLOCK = "2026-09-29T12:00:00Z";
const CLOCK_MS = Date.parse(CLOCK);
const sha1 = (label) => createHash("sha1").update(label).digest("hex");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const ago = (seconds) => new Date(CLOCK_MS - seconds * 1000).toISOString().replace(".000Z", "Z");

const COMMITS = { api: sha1("proofgate-demo-api-commit"), web: sha1("proofgate-demo-web-commit") };
const HOUR = 3600;
const DAY = 24 * HOUR;

const requirement = (id, title, severity, level, environment, repositories, extra = {}) => ({
  id,
  title,
  severity,
  required_level: level,
  required_environment: environment,
  max_age_seconds: DAY,
  repositories,
  ...extra,
});

const MANIFEST = {
  schema_version: 1,
  name: "demo-checkout-release-gate",
  repositories: [{ id: "api" }, { id: "web" }],
  requirements: [
    requirement("REQ-CHECKOUT-API", "Checkout API integration tests", "mandatory", "integration", "staging", ["api"]),
    requirement("REQ-CHECKOUT-E2E", "Checkout end-to-end journey across API and web", "mandatory", "e2e", "staging", ["api", "web"]),
    requirement("REQ-WEB-UNIT", "Web storefront unit tests", "mandatory", "unit", "ci", ["web"]),
    requirement("REQ-PAYMENT-SANDBOX", "Payment provider sandbox integration tests", "mandatory", "integration", "staging", ["api"]),
    requirement("REQ-DATA-MIGRATION", "Order schema migration tests", "mandatory", "integration", "staging", ["api"]),
    requirement("REQ-PERF-SMOKE", "Checkout performance smoke (advisory)", "advisory", "unit", "ci", ["api"]),
    requirement("REQ-VENDOR-SANDBOX", "Vendor sandbox contract tests (advisory)", "advisory", "integration", "staging", ["api"], {
      deferred: { reason: "vendor sandbox unavailable this sprint" },
    }),
  ],
};

const REVISIONS = {
  schema_version: 1,
  revisions: [
    { repository: "api", commit_sha: COMMITS.api },
    { repository: "web", commit_sha: COMMITS.web },
  ],
};

/** A receipt plus its artifact. `counts` = [total, passed, failed, skipped]. */
function receipt(id, requirementIds, repository, environment, level, result, counts, ageSeconds, options = {}) {
  const [total, passed, failed, skipped] = counts;
  const artifactPath = `artifacts/${id}.xml`;
  const artifact = `<testsuite name="${id}" tests="${total}" failures="${failed}" skipped="${skipped}"/>\n`;
  const doc = {
    schema_version: 1,
    receipt_id: id,
    requirement_ids: requirementIds,
    repository,
    commit_sha: options.commit ?? COMMITS[repository],
    runner_id: "synthetic-runner-1",
    environment,
    test_level: level,
    execution_kind: options.kind ?? "live",
    result,
    tests: { total, passed, failed, skipped },
    // The receipt always records the hash of the original bytes; a tampered fixture ships different bytes.
    artifact: { path: artifactPath, sha256: sha256(artifact) },
    finished_at: ago(ageSeconds),
    command: "synthetic test command (recorded as text, never executed)",
  };
  return { doc, artifactPath, artifact: options.tamperedArtifact ?? artifact };
}

const HAPPY_RECEIPTS = [
  receipt("rcpt-checkout-api-001", ["REQ-CHECKOUT-API"], "api", "staging", "integration", "pass", [42, 42, 0, 0], 3 * HOUR),
  receipt("rcpt-checkout-e2e-api-001", ["REQ-CHECKOUT-E2E"], "api", "staging", "e2e", "pass", [12, 12, 0, 0], 2 * HOUR),
  receipt("rcpt-checkout-e2e-web-001", ["REQ-CHECKOUT-E2E"], "web", "staging", "e2e", "pass", [12, 12, 0, 0], 2 * HOUR),
  receipt("rcpt-web-unit-001", ["REQ-WEB-UNIT"], "web", "ci", "unit", "pass", [230, 230, 0, 0], HOUR),
  receipt("rcpt-payment-sandbox-001", ["REQ-PAYMENT-SANDBOX"], "api", "staging", "integration", "pass", [18, 18, 0, 0], 4 * HOUR),
  receipt("rcpt-data-migration-001", ["REQ-DATA-MIGRATION"], "api", "staging", "integration", "pass", [9, 9, 0, 0], 5 * HOUR),
  receipt("rcpt-perf-smoke-001", ["REQ-PERF-SMOKE"], "api", "ci", "unit", "pass", [6, 6, 0, 0], HOUR),
];

// One of every status: PASS, PARTIAL, FAIL, STALE, MISSING (zero tests), and an advisory PARTIAL and DEFERRED.
const UNSATISFIED_RECEIPTS = [
  receipt("rcpt-checkout-api-001", ["REQ-CHECKOUT-API"], "api", "staging", "integration", "pass", [42, 42, 0, 0], 3 * HOUR),
  receipt("rcpt-checkout-e2e-api-001", ["REQ-CHECKOUT-E2E"], "api", "staging", "e2e", "pass", [12, 12, 0, 0], 2 * HOUR),
  receipt("rcpt-web-unit-001", ["REQ-WEB-UNIT"], "web", "ci", "unit", "fail", [230, 228, 2, 0], HOUR),
  receipt("rcpt-payment-sandbox-001", ["REQ-PAYMENT-SANDBOX"], "api", "staging", "integration", "pass", [18, 18, 0, 0], 2 * DAY),
  receipt("rcpt-data-migration-001", ["REQ-DATA-MIGRATION"], "api", "staging", "integration", "pass", [0, 0, 0, 0], 5 * HOUR),
  receipt("rcpt-perf-smoke-001", ["REQ-PERF-SMOKE"], "api", "ci", "unit", "partial", [6, 4, 0, 2], HOUR),
];

const TAMPERED_MANIFEST = {
  schema_version: 1,
  name: "demo-tampered-artifact",
  repositories: [{ id: "api" }],
  requirements: [requirement("REQ-CHECKOUT-API", "Checkout API integration tests", "mandatory", "integration", "staging", ["api"])],
};
const TAMPERED_RECEIPTS = [
  receipt("rcpt-checkout-api-001", ["REQ-CHECKOUT-API"], "api", "staging", "integration", "pass", [42, 42, 0, 0], 3 * HOUR, {
    tamperedArtifact: '<testsuite name="rcpt-checkout-api-001" tests="42" failures="0" skipped="0"/>\n<!-- edited after the receipt was written -->\n',
  }),
];

const DUPLICATE_MANIFEST = {
  schema_version: 1,
  name: "demo-duplicate-requirement-ids",
  repositories: [{ id: "api" }],
  requirements: [
    requirement("REQ-CHECKOUT-API", "Checkout API integration tests", "mandatory", "integration", "staging", ["api"]),
    requirement("REQ-CHECKOUT-API", "The same identifier declared twice", "mandatory", "unit", "ci", ["api"]),
  ],
};

const SCENARIOS = {
  happy: {
    description: "Every mandatory requirement has fresh, live, passing evidence for the exact revisions; one advisory requirement is DEFERRED and stays visible.",
    manifest: MANIFEST,
    revisions: REVISIONS,
    receipts: HAPPY_RECEIPTS,
    expect: {
      exit_code: 0,
      verdict: "accepted",
      statuses: {
        "REQ-CHECKOUT-API": "PASS",
        "REQ-CHECKOUT-E2E": "PASS",
        "REQ-WEB-UNIT": "PASS",
        "REQ-PAYMENT-SANDBOX": "PASS",
        "REQ-DATA-MIGRATION": "PASS",
        "REQ-PERF-SMOKE": "PASS",
        "REQ-VENDOR-SANDBOX": "DEFERRED",
      },
    },
  },
  unsatisfied: {
    description: "The same policy with planted problems: one requirement in every non-PASS status. Mandatory requirements are not satisfied, so the release is not accepted.",
    manifest: MANIFEST,
    revisions: REVISIONS,
    receipts: UNSATISFIED_RECEIPTS,
    expect: {
      exit_code: 1,
      verdict: "unsatisfied",
      statuses: {
        "REQ-CHECKOUT-API": "PASS",
        "REQ-CHECKOUT-E2E": "PARTIAL",
        "REQ-WEB-UNIT": "FAIL",
        "REQ-PAYMENT-SANDBOX": "STALE",
        "REQ-DATA-MIGRATION": "MISSING",
        "REQ-PERF-SMOKE": "PARTIAL",
        "REQ-VENDOR-SANDBOX": "DEFERRED",
      },
    },
  },
  tampered: {
    description: "An artifact was edited after its receipt recorded the hash. This is rejected as malformed input: exit 2, artifact_hash_mismatch, and no report is written.",
    manifest: TAMPERED_MANIFEST,
    revisions: { schema_version: 1, revisions: [{ repository: "api", commit_sha: COMMITS.api }] },
    receipts: TAMPERED_RECEIPTS,
    expect: { exit_code: 2, error_code: "artifact_hash_mismatch" },
  },
  duplicate: {
    description: "A manifest that declares one requirement id twice. Rejected as malformed input: exit 2, manifest_duplicate_requirement_id, and no report is written.",
    manifest: DUPLICATE_MANIFEST,
    revisions: { schema_version: 1, revisions: [{ repository: "api", commit_sha: COMMITS.api }] },
    receipts: [],
    expect: { exit_code: 2, error_code: "manifest_duplicate_requirement_id" },
  },
};

// The manifest is written as YAML by hand-rolled serialisation of a fixed shape, so this script has no dependency
// and the committed file is readable and stable.
function yamlScalar(value) {
  return /^[A-Za-z0-9_.-]+$/.test(value) && !/^(true|false|null|yes|no|on|off|\d.*)$/i.test(value) ? value : JSON.stringify(value);
}
function manifestYaml(m) {
  const lines = ["# Synthetic demo policy. Generated by scripts/generate-demo-fixtures.mjs; do not edit by hand.", `schema_version: ${m.schema_version}`, `name: ${yamlScalar(m.name)}`, "repositories:"];
  for (const r of m.repositories) lines.push(`  - id: ${yamlScalar(r.id)}`);
  lines.push("requirements:");
  for (const r of m.requirements) {
    lines.push(`  - id: ${yamlScalar(r.id)}`);
    lines.push(`    title: ${JSON.stringify(r.title)}`);
    lines.push(`    severity: ${r.severity}`);
    lines.push(`    required_level: ${r.required_level}`);
    lines.push(`    required_environment: ${yamlScalar(r.required_environment)}`);
    lines.push(`    max_age_seconds: ${r.max_age_seconds}`);
    lines.push(`    repositories: [${r.repositories.map(yamlScalar).join(", ")}]`);
    if (r.deferred) lines.push(`    deferred:`, `      reason: ${JSON.stringify(r.deferred.reason)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Map of relative path -> file content for everything this script owns. */
function build() {
  const files = new Map();
  const scenarios = {};
  for (const [name, s] of Object.entries(SCENARIOS)) {
    const base = `fixtures/demo/${name}`;
    files.set(`${base}/requirements.yaml`, manifestYaml(s.manifest));
    files.set(`${base}/revisions.json`, `${JSON.stringify(s.revisions, null, 2)}\n`);
    for (const r of s.receipts) {
      files.set(`${base}/receipts/${r.doc.receipt_id}.receipt.json`, `${JSON.stringify(r.doc, null, 2)}\n`);
      files.set(`${base}/receipts/${r.artifactPath}`, r.artifact);
    }
    if (s.receipts.length === 0) files.set(`${base}/receipts/README.txt`, "This scenario intentionally contains no receipts: the manifest is rejected before receipts are read.\n");
    scenarios[name] = { description: s.description, directory: `demo/${name}`, expect: s.expect };
  }
  const descriptor = {
    schema_version: 1,
    name: "proofgate-synthetic-demo",
    synthetic: true,
    note: "Synthetic, account-free fixtures. Receipt ids are opaque; commit SHAs are derived from fixed labels; nothing here is customer data.",
    clock: CLOCK,
    command_pattern: "proofgate evaluate --manifest <dir>/requirements.yaml --receipts <dir>/receipts --revisions <dir>/revisions.json --output <report-dir> --now <clock>",
    scenarios,
  };
  files.set("fixtures/demo.json", `${JSON.stringify(descriptor, null, 2)}\n`);
  return files;
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(relative(root, p));
  }
  return out;
}

const files = build();
if (process.argv.includes("--check")) {
  const problems = [];
  for (const [path, content] of files) {
    const abs = join(root, path);
    if (!existsSync(abs)) problems.push(`missing ${path}`);
    else if (readFileSync(abs).toString("utf8") !== content) problems.push(`differs ${path}`);
  }
  for (const existing of listFiles(join(root, "fixtures/demo"))) if (!files.has(existing)) problems.push(`unexpected ${existing}`);
  if (problems.length > 0) {
    console.log(`demo fixtures are stale:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`demo fixtures are current (${files.size} files)`);
} else {
  rmSync(join(root, "fixtures/demo"), { recursive: true, force: true });
  for (const [path, content] of files) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  console.log(`wrote ${files.size} demo fixture files`);
}
