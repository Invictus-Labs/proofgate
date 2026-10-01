// Synthetic 1,000-record workload for the deterministic core (PRD section 6, performance experiment).
// Usage: npm run benchmark   (builds first). Setup I/O is excluded from the timings.
// Runs the two 1,000-record shapes and three requirements x repositories fan-out shapes; docs/BENCHMARK.md records the results.
// To measure on the 2 CPU / 4 GB target, run it inside a container: docker run --rm --cpus=2 --memory=4g -v <repo>:/src:ro node:22.12 node /src/scripts/benchmark.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, arch, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePaths } from "../dist/pipeline.js";
import { exportBundle, restoreBundle } from "../dist/bundle.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-09-29T12:00:00Z");
const sha = (label) => createHash("sha1").update(label).digest("hex");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const id = (n) => `bench-receipt-${String(n).padStart(6, "0")}`;

/**
 * shape "default-limits": 1,000 requirements, 450 receipt files (each covering 2-3 requirements) and 450 artifacts,
 *   which stays inside the default 1,000-entry import limit.
 * shape "stress": 1,000 receipts each with its own artifact (2,000 files), run with the file-count limit raised
 *   through the library option.
 */
const SHAPES = {
  "default-limits": { requirements: 1000, repositories: 1, receipts: 450, perReceipt: "spread", maxFiles: undefined },
  stress: { requirements: 1000, repositories: 1, receipts: 1000, perReceipt: "one", maxFiles: 5000 },
  // Fan-out shapes: every requirement applies to every repository, so decisions = requirements x repositories.
  "fanout-1000x20": { requirements: 1000, repositories: 20, receipts: 600, perReceipt: "one", maxFiles: 5000 },
  "fanout-1000x50": { requirements: 1000, repositories: 50, receipts: 600, perReceipt: "one", maxFiles: 5000 },
  "fanout-2000x40": { requirements: 2000, repositories: 40, receipts: 600, perReceipt: "one", maxFiles: 5000 },
};

function build(shape) {
  const cfg = SHAPES[shape];
  const dir = mkdtempSync(join(tmpdir(), `pg-bench-${shape}-`));
  const receipts = join(dir, "receipts");
  mkdirSync(join(receipts, "a"), { recursive: true });
  const repoIds = Array.from({ length: cfg.repositories }, (_, i) => (cfg.repositories === 1 ? "api" : `repo-${String(i).padStart(3, "0")}`));
  const requirements = Array.from({ length: cfg.requirements }, (_, i) => ({
    id: `REQ-${String(i).padStart(4, "0")}`,
    title: `Synthetic requirement ${i}`,
    severity: i % 10 === 0 ? "advisory" : "mandatory",
    required_level: "integration",
    required_environment: "staging",
    max_age_seconds: 86400,
    repositories: repoIds,
  }));
  writeFileSync(join(dir, "requirements.json"), JSON.stringify({ schema_version: 1, name: "benchmark", repositories: repoIds.map((r) => ({ id: r })), requirements }));
  writeFileSync(join(dir, "revisions.json"), JSON.stringify({ schema_version: 1, revisions: repoIds.map((r) => ({ repository: r, commit_sha: sha(r) })) }));
  const count = cfg.receipts;
  for (let n = 0; n < count; n += 1) {
    const artifact = Buffer.alloc(4096, n % 251);
    writeFileSync(join(receipts, "a", `${n}.xml`), artifact);
    const repo = repoIds[n % repoIds.length];
    const ids = cfg.perReceipt === "one" ? [requirements[n % requirements.length].id] : [2 * n, 2 * n + 1, ...(n < 100 ? [900 + n] : [])].filter((i) => i < 1000).map((i) => requirements[i].id);
    writeFileSync(
      join(receipts, `${id(n)}.receipt.json`),
      JSON.stringify({
        schema_version: 1,
        receipt_id: id(n),
        requirement_ids: ids,
        repository: repo,
        commit_sha: sha(repo),
        runner_id: "bench-runner",
        environment: "staging",
        test_level: "integration",
        execution_kind: "live",
        result: "pass",
        tests: { total: 20, passed: 20, failed: 0, skipped: 0 },
        artifact: { path: `a/${n}.xml`, sha256: sha256(artifact) },
        finished_at: "2026-09-29T11:00:00Z",
      }),
    );
  }
  return { dir, receipts, records: cfg.requirements, receiptFiles: count, decisions: cfg.requirements * cfg.repositories };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];

const wanted = process.argv[2] === undefined ? Object.keys(SHAPES) : [process.argv[2]];
for (const shape of wanted) {
  const w = build(shape);
  const limits = SHAPES[shape].maxFiles === undefined ? undefined : { maxFiles: SHAPES[shape].maxFiles };
  const opts = (out) => ({
    manifestPath: join(w.dir, "requirements.json"),
    receiptsDir: w.receipts,
    revisionsPath: join(w.dir, "revisions.json"),
    now: NOW,
    ...(out ? { outputDir: out } : {}),
    ...(limits ? { limits } : {}),
  });
  const times = [];
  let last;
  for (let i = 0; i < 5; i += 1) {
    const out = join(w.dir, `report-${i}`);
    const t0 = process.hrtime.bigint();
    last = await evaluatePaths(opts(out));
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);

  const bundle = join(w.dir, "b.pgbundle");
  const tb0 = process.hrtime.bigint();
  await exportBundle({ ...opts(undefined), reportPath: join(w.dir, "report-0"), outputFile: bundle, ...(limits ? { limits } : {}) });
  const exportMs = Number(process.hrtime.bigint() - tb0) / 1e6;
  const tr0 = process.hrtime.bigint();
  await restoreBundle({ bundleFile: bundle, outputDir: join(w.dir, "restored"), ...(limits ? { limits } : {}) });
  const restoreMs = Number(process.hrtime.bigint() - tr0) / 1e6;

  let cliMs = null;
  if (shape === "default-limits") {
    const t = process.hrtime.bigint();
    execFileSync(process.execPath, [join(root, "dist", "cli.js"), "evaluate", "--manifest", join(w.dir, "requirements.json"), "--receipts", w.receipts, "--revisions", join(w.dir, "revisions.json"), "--output", join(w.dir, "report-cli"), "--now", NOW.toISOString()], { stdio: "ignore" });
    cliMs = Number(process.hrtime.bigint() - t) / 1e6;
  }
  results.push({
    shape,
    requirements: w.records,
    decisions: w.decisions,
    receipt_files: w.receiptFiles,
    verdict: last.report.verdict,
    report_json_mb: Math.round((statSync(join(w.dir, "report-4", "report.json")).size / 1024 / 1024) * 10) / 10,
    evaluate_ms: { runs: times.map((t) => Math.round(t)), median: Math.round(median(times)), min: Math.round(Math.min(...times)), max: Math.round(Math.max(...times)) },
    bundle_export_ms: Math.round(exportMs),
    bundle_restore_verify_ms: Math.round(restoreMs),
    cli_wall_ms_incl_node_startup: cliMs === null ? null : Math.round(cliMs),
    process_rss_mb_after_runs: rss,
  });
  rmSync(w.dir, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: `${platform()} ${release()} ${arch()}`,
      cpus: cpus().length,
      cpu_model: cpus()[0]?.model ?? "unknown",
      total_memory_gb: Math.round(totalmem() / 1024 ** 3),
      results,
    },
    null,
    2,
  ),
);
