// End-to-end negative controls: apply one deliberate defect to a scratch copy of the repository, then run the PACKAGED
// executable E2E suite (or the browser smoke) against a tarball packed from that mutated copy. The suite must go red.
// scripts/mutation-controls.mjs proves the unit/integration suite bites; this proves the packaged-binary tests and the
// real-Chromium smoke bite too, i.e. that they exercise the shipped artifact and not a mock.
// Usage: npm run e2e-mutation-controls   (exit 0 only if the unmutated baseline is green and every mutant is killed)
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMutantTargets, classify, describeResult, parsePlaywrightJson, parseVitestJson, readResult, reportInstrumentCheck, runWithCap } from "./kill-rule.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Both suites write the runner's own JSON result to RESULT (relative to the scratch copy); the verdict is read from that file.
const RESULT = ".kill-rule-result.json";
const NODE_SUITE = ["npx", "vitest", "run", "--config", "vitest.e2e.config.ts", "tests/e2e/packaged-cli.test.ts", "--reporter=json", `--outputFile=${RESULT}`];
/** The packed `bundle export` over a hostile 256 KiB, 1 MiB and 4,000,000 byte artifact (each run capped at 60 s, a run that hits the cap fails an assertion). */
const ARTIFACT_SUITE = ["npx", "vitest", "run", "--config", "vitest.e2e.config.ts", "tests/e2e/packaged-hostile-artifact.test.ts", "--reporter=json", `--outputFile=${RESULT}`];
const BROWSER_SUITE = ["npx", "playwright", "test", "--reporter=json"];
/** Wall-clock cap for one suite run; a run that hits it is SUSPECT. */
const RUN_CAP_MS = 15 * 60 * 1000;

const MUTANTS = [
  ["E01 commit SHA comparison removed: packaged revision-mismatch flow (AC-02)", NODE_SUITE, "src/evaluate.ts", "r.commit_sha !== expectedSha", "false"],
  ["E02 artifact hash verification removed: packaged tamper flow (AC-01)", NODE_SUITE, "src/receipt.ts", "if (found !== receipt.artifact.sha256) {", "if (false) {"],
  ["E03 verdict always accepted: packaged planted-failure flow (AC-05)", NODE_SUITE, "src/evaluate.ts", "const accepted = mandatory.length > 0 && mandatoryPassed === mandatory.length;", "const accepted = true;"],
  ["E04 demo fixtures dropped from the published files: packaged tarball contents (AC-08)", NODE_SUITE, "package.json", '    "fixtures",\n', ""],
  ["E05 report escaping removed: browser smoke of hostile strings (AC-07/AC-09)", BROWSER_SUITE, "src/web/safe-html.ts", "return escapeHtml(displayText(value));", "return displayText(value);"],
  ["E06 tables forced wider than a phone: browser smoke layout at 375px", BROWSER_SUITE, "src/web/styles.ts", "table{border-collapse:collapse;width:100%;font-size:.9375rem}", "table{border-collapse:collapse;width:100%;min-width:900px;font-size:.9375rem}"],
  ["E07 stacked-card layout removed: browser smoke layout at 375px", BROWSER_SUITE, "src/web/styles.ts", "table.stack,table.stack tbody,table.stack tr,table.stack th,table.stack td{display:block;width:100%}", "table.stack{}"],
  ["E08 the word of a bracket group is stripped by the exponential trailing-escape regular expression again: the packed `bundle export` of a hostile artifact never ends (AC-09)", ARTIFACT_SUITE, "src/redact.ts", "stripTrailingBackslashes(text.slice(k, end))", "text.slice(k, end).replace(/(?:\\\\+[nr]?|%0[AaDd])+$/, \"\")"],
  ["E09 the word of a bracket group is stripped by `/\\\\+$/` again (quadratic): the packed `bundle export` of a 256 KiB hostile artifact takes tens of seconds (AC-09)", ARTIFACT_SUITE, "src/redact.ts", "stripTrailingBackslashes(text.slice(k, end))", "text.slice(k, end).replace(/\\\\+$/, \"\")"],
  ["E10 a credential-shaped artifact is no longer flagged by the artifact scan of `bundle export`: the packed export writes a bundle (AC-09)", ARTIFACT_SUITE, "src/bundle.ts", "if (patterns.length > 0) flagged.push({ path: entry.artifact, patterns });", "if (patterns.length > 1000000) flagged.push({ path: entry.artifact, patterns });"],
];

// The instrument check (see scripts/mutation-controls.mjs): `--check` runs only this; a normal run does it before any baseline.
if (process.env.MUTATION_CHECK_SELFTEST === "1") MUTANTS.push(["ZZ-SELFTEST a target that does not occur", NODE_SUITE, "src/cli.ts", "this text does not occur in the sources\u0000", "x"]);
{
  const checked = reportInstrumentCheck("end-to-end mutation controls", checkMutantTargets(MUTANTS, (file) => readFileSync(join(root, file), "utf8")));
  if (checked !== 0 || process.argv.includes("--check")) process.exit(checked);
}

function scratch() {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "pg-e2e-mutation-")));
  const items = ["src", "tests", "schemas", "scripts", "docs", "fixtures", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "vitest.config.ts", "vitest.e2e.config.ts", "playwright.config.ts"];
  items.push("README.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "LICENSE", "Dockerfile", ".dockerignore");
  for (const item of items) cpSync(join(root, item), join(dir, item), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  return dir;
}

async function run(dir, command) {
  const env = { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", PLAYWRIGHT_JSON_OUTPUT_NAME: join(dir, RESULT) };
  delete env.PROOFGATE_E2E_INFO; // every run must pack the (mutated) copy itself
  const r = await runWithCap(command[0], command.slice(1), { cwd: dir, env, timeoutMs: RUN_CAP_MS });
  const playwright = command[1] === "playwright";
  return { ...r, parsed: readResult(join(dir, RESULT), playwright ? parsePlaywrightJson : parseVitestJson) };
}

// MUTATION_ONLY=E08,E09 runs those mutants only (a probe while a test is written); the report then says it was a selection and never "all ... killed".
const only = (process.env.MUTATION_ONLY ?? "").split(",").map((id) => id.trim()).filter((id) => id !== "");
const selected = only.length === 0 ? MUTANTS : MUTANTS.filter(([name]) => only.includes(String(name).split(" ")[0]));
if (selected.length === 0) {
  console.error(`MUTATION_ONLY names no mutant of this list: ${only.join(", ")}`);
  process.exit(2);
}
let bad = 0;
for (const suite of [...new Set(selected.map((entry) => entry[1]))]) {
  const dir = scratch();
  const baseline = await run(dir, suite);
  console.log(`baseline (unmutated) ${suite.slice(1, 3).join(" ")}: exit ${baseline.code}, ${baseline.parsed?.failed ?? "no result"} failing`);
  rmSync(dir, { recursive: true, force: true });
  if (baseline.code !== 0) {
    console.error(`baseline is not green for ${suite.join(" ")}; the controls would be meaningless\n${baseline.output.slice(-1500)}`);
    process.exit(1);
  }
}

for (const [name, suite, file, find, replace] of selected) {
  const dir = scratch();
  const path = join(dir, file);
  const text = readFileSync(path, "utf8");
  const count = text.split(find).length - 1;
  if (count !== 1) {
    console.log(`FAIL ${name}: expected exactly one match of the mutation target in ${file}, found ${count}`);
    bad += 1;
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  writeFileSync(path, text.replace(find, () => replace));
  const result = await run(dir, suite);
  // A mutant is killed only by a test that FAILS BY ASSERTION: a pack, build, type or syntax failure, a timeout, a runtime error
  // in the mutated code and a hung run all exit non-zero without one and prove nothing about the packaged suite (SUSPECT,
  // counted as a control that did not bite). The verdict comes from the runner's JSON result, not from printed text.
  const label = classify(result);
  console.log(describeResult(label, name, result));
  if (label !== "KILLED") bad += 1;
  rmSync(dir, { recursive: true, force: true });
}
console.log(bad === 0 ? (selected.length === MUTANTS.length ? `all ${MUTANTS.length} end-to-end mutants killed` : `${selected.length} selected end-to-end mutants killed (a selection, not the whole list)`) : `${bad} end-to-end control(s) did not bite`);
process.exit(bad === 0 ? 0 : 1);
