// Automated fresh-directory harness for docs/RUNBOOK-SMOKE.md.
//
// It executes the runbook's own command blocks, verbatim and in order, in one shell inside an empty temporary directory,
// against a real `npm pack` tarball, and checks the exit code and expected output that the runbook states.
// Blocks are marked in the runbook with an HTML comment directive placed right before the fenced `sh` block:
//
//   <!-- smoke: exit=1 expect="verdict: UNSATISFIED" expect="FAIL" absent="Traceback" -->
//   <!-- smoke: manual -->              (shown to a human operator, never executed here)
//
// {{version}} and {{clock}} inside expect/absent values are replaced with the package version and the demo clock.
// Usage: node scripts/runbook-smoke.mjs [--tarball <file> --sha256 <hex>] [--runbook <file>] [--keep] [--json]
//
// THIS IS SUPPLEMENTAL EVIDENCE ONLY. It is an automated run by the maintainer's tooling, not an independent human
// drill, and it can never close AC-11 (see docs/HUMAN-DRILL.md).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const runbook = readFileSync(option("--runbook") ?? join(root, "docs", "RUNBOOK-SMOKE.md"), "utf8");
const DEMO_CLOCK = JSON.parse(readFileSync(join(root, "fixtures", "demo.json"), "utf8")).clock;

// ---- parse the runbook ------------------------------------------------------------------------------------------
function parseDirective(text) {
  const out = { exit: 0, expect: [], absent: [], manual: false, id: undefined };
  const re = /(\w+)(?:=(?:"([^"]*)"|(\S+)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const value = m[2] ?? m[3];
    if (key === "manual") out.manual = true;
    else if (key === "exit") out.exit = Number(value);
    else if (key === "expect") out.expect.push(value);
    else if (key === "absent") out.absent.push(value);
    else if (key === "id") out.id = value;
    else throw new Error(`unknown smoke directive key: ${key}`);
  }
  return out;
}
const substitute = (s) => s.replaceAll("{{version}}", pkg.version).replaceAll("{{clock}}", DEMO_CLOCK);

const blocks = [];
const blockRe = /<!--\s*smoke:\s*([\s\S]*?)\s*-->\s*```sh\n([\s\S]*?)```/g;
let match;
while ((match = blockRe.exec(runbook)) !== null) {
  const d = parseDirective(match[1]);
  blocks.push({ n: blocks.length + 1, ...d, expect: d.expect.map(substitute), absent: d.absent.map(substitute), command: match[2].trimEnd() });
}
// The prose shows a concrete version for humans; it must match the package being tested.
if (!runbook.includes(`proofgate-${pkg.version}.tgz`) || !runbook.includes(`Expected: \`${pkg.version}\``)) {
  console.error(`runbook-smoke: docs/RUNBOOK-SMOKE.md does not mention version ${pkg.version} where the operator reads it; update the runbook`);
  process.exit(2);
}
const automatic = blocks.filter((b) => !b.manual);
if (automatic.length < 10) {
  console.error(`runbook-smoke: only ${automatic.length} automatic blocks found in docs/RUNBOOK-SMOKE.md; the runbook and this harness are out of step`);
  process.exit(2);
}

// ---- artifact under test: a real npm pack tarball, checksummed -----------------------------------------------------
let tarball = option("--tarball");
let sha256 = option("--sha256");
const work = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "proofgate-runbook-")));
if (tarball === undefined) {
  const info = JSON.parse(execFileSync(process.execPath, [join(root, "scripts", "pack-install.mjs"), "--no-install", "--out", join(work, "release")], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  tarball = info.tarball;
  sha256 = info.sha256;
} else if (sha256 === undefined) {
  sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
}

// ---- run every automatic block in ONE shell so `cd` persists, like a human's terminal session -------------------------
const scratch = join(work, "scratch"); // the directory the operator "already has"; the runbook creates proofgate-smoke inside it
const results = join(work, "results");
mkdirSync(scratch, { recursive: true });
mkdirSync(results, { recursive: true });
const script = ['set -u', `cd '${scratch}'`];
for (const b of automatic) {
  script.push(`{`, b.command, `} > '${join(results, `step-${b.n}.out`)}' 2>&1`, `echo $? > '${join(results, `step-${b.n}.exit`)}'`);
}
writeFileSync(join(work, "session.sh"), `${script.join("\n")}\n`);
const started = new Date();
const t0 = Date.now();
const session = spawnSync("/bin/sh", [join(work, "session.sh")], {
  // HOME is kept only so npm can use its normal cache for the two runtime dependencies; ProofGate itself never reads it.
  env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PROOFGATE_TARBALL: tarball, PROOFGATE_TARBALL_SHA256: sha256 },
  encoding: "utf8",
  timeout: 10 * 60 * 1000,
});
const elapsedMs = Date.now() - t0;

// ---- judge -------------------------------------------------------------------------------------------------------
const report = [];
let failed = 0;
for (const b of automatic) {
  let actualExit = -1;
  let output = "";
  try {
    actualExit = Number(readFileSync(join(results, `step-${b.n}.exit`), "utf8").trim());
    output = readFileSync(join(results, `step-${b.n}.out`), "utf8");
  } catch {
    // the shell died before this step ran
  }
  const problems = [];
  if (actualExit !== b.exit) problems.push(`exit ${actualExit}, expected ${b.exit}`);
  for (const e of b.expect) if (!output.includes(e)) problems.push(`missing expected text ${JSON.stringify(e)}`);
  for (const a of b.absent) if (output.includes(a)) problems.push(`found forbidden text ${JSON.stringify(a)}`);
  if (problems.length > 0) failed += 1;
  report.push({ step: b.n, id: b.id ?? null, command: b.command.split("\n")[0].slice(0, 100), expectedExit: b.exit, actualExit, ok: problems.length === 0, problems, output: problems.length > 0 ? output.slice(0, 1500) : undefined });
}
const leftover = readdirSync(scratch);
if (leftover.length > 0) {
  failed += 1;
  report.push({ step: "cleanup-check", ok: false, problems: [`the runbook's cleanup step left files behind: ${leftover.join(", ")}`] });
}

const receipt = {
  kind: "supplemental-automated-runbook-run",
  independent_human_drill: false,
  ac11_status: "PENDING_HUMAN_RECEIPT",
  started_at_utc: started.toISOString(),
  duration_ms: elapsedMs,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  package_version: pkg.version,
  tarball_sha256: sha256,
  automatic_steps: automatic.length,
  manual_steps_not_executed: blocks.filter((b) => b.manual).length,
  passed: automatic.length - report.filter((r) => typeof r.step === "number" && !r.ok).length,
  failed,
  steps: report.map(({ output: _omit, ...rest }) => rest),
};

if (flag("--json")) console.log(JSON.stringify(receipt, null, 2));
else {
  console.log(`runbook-smoke (supplemental automated run, NOT the human drill): ${receipt.passed}/${automatic.length} automatic steps passed, ${receipt.manual_steps_not_executed} manual step(s) not executed`);
  for (const r of report) console.log(`  ${r.ok ? "ok  " : "FAIL"} step ${String(r.step).padEnd(2)} ${r.command ?? ""}${r.problems.length ? `\n         ${r.problems.join("\n         ")}` : ""}`);
  for (const r of report.filter((x) => !x.ok && x.output)) console.log(`--- output of step ${r.step} ---\n${r.output}`);
  if (session.status !== 0) console.log(`session shell exit status ${session.status}`);
}
if (!flag("--keep")) rmSync(work, { recursive: true, force: true });
else console.error(`kept ${work}`);
process.exit(failed === 0 ? 0 : 1);
