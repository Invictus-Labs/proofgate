#!/usr/bin/env bash
# ProofGate local quality gate. There is no remote CI: this script is the gate.
#
#   bash scripts/verify-quality.sh
#
# It runs every step below even when an earlier independent step fails, prints a per-step summary, and exits non-zero if
# ANY step failed or could not run. It never skips a step silently. It changes nothing in the repository except build
# output (dist/, coverage/, test-results/), and it packs and installs into a scratch directory outside the repository.
#
# Prerequisites: Node.js >= 22.12, `npm ci` done, and Chromium for the browser smoke (`npx playwright install chromium`).
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"
export NO_COLOR=1 FORCE_COLOR=0 CI=1
WORK="$(mktemp -d "${TMPDIR:-/tmp}/proofgate-gate.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

NAMES=()
RESULTS=()
SECONDS_TAKEN=()
DETAILS=()
FAILED=0

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# step <name> <command...>: streams output, records pass/fail, keeps a log for the summary.
step() {
  local name="$1"
  shift
  local log="$WORK/step-${#NAMES[@]}.log"
  echo
  echo "=== [$(now)] $name"
  echo "+ $*"
  local start=$SECONDS
  "$@" 2>&1 | tee "$log"
  local status=${PIPESTATUS[0]}
  local took=$((SECONDS - start))
  NAMES+=("$name")
  SECONDS_TAKEN+=("$took")
  DETAILS+=("$log")
  if [ "$status" -eq 0 ]; then
    RESULTS+=("PASS")
  else
    RESULTS+=("FAIL")
    FAILED=$((FAILED + 1))
    echo "--- $name FAILED (exit $status) ---"
  fi
  return 0
}

# fail_step <name> <message>: records a step that could not run. That counts as a failure, never as a pass.
fail_step() {
  NAMES+=("$1")
  RESULTS+=("FAIL")
  SECONDS_TAKEN+=("0")
  DETAILS+=("")
  FAILED=$((FAILED + 1))
  echo
  echo "=== [$(now)] $1"
  echo "$2"
}

# last_match <step index> <regex>: last line of the step log that matches (for the summary).
last_match() { grep -E "$2" "${DETAILS[$1]}" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]+//'; }

echo "ProofGate quality gate"
echo "started (UTC):  $(now)"
echo "commit:         $(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "working tree:   $(if [ -z "$(git status --porcelain 2>/dev/null)" ]; then echo clean; else echo "dirty ($(git status --porcelain | wc -l | tr -d ' ') changed paths)"; fi)"
echo "node / npm:     $(node --version) / $(npm --version)"
echo "platform:       $(uname -s) $(uname -m)"

# ---------------------------------------------------------------- 1. install check
install_check() {
  node -e "const [a, b] = process.versions.node.split('.').map(Number); if (a < 22 || (a === 22 && b < 12)) { console.error('Node 22.12 or newer is required, found ' + process.version); process.exit(1); }" || return 1
  if [ ! -d node_modules ]; then
    echo "node_modules is missing: run 'npm ci' first" >&2
    return 1
  fi
  # The lockfile must agree with package.json (npm ci would refuse otherwise) and the installed tree must be complete.
  npm ci --dry-run --ignore-scripts --no-audit --no-fund > /dev/null || { echo "package-lock.json is out of step with package.json" >&2; return 1; }
  npm ls --all > /dev/null || { echo "installed dependencies do not match the lockfile: run 'npm ci'" >&2; return 1; }
  echo "install check ok"
}
step "install check" install_check

# ---------------------------------------------------------------- 2-3. typecheck, build
step "typecheck" npx tsc -p tsconfig.json --noEmit
step "build" npm run build

# ---------------------------------------------------------------- 4. unit + integration + acceptance, coverage thresholds
# The suite runs under a wall-clock cap (TEST_CAP_MINUTES, default 60): a test that hangs in a synchronous loop cannot time out from
# inside its own process, and a gate that waits for it for ever would never report anything.
step "tests with coverage thresholds (90% statements/branches/functions/lines)" node scripts/run-with-cap.mjs "${TEST_CAP_MINUTES:-60}" npx vitest run --coverage

# ---------------------------------------------------------------- 5. mutation controls
# The instrument check comes first: every mutant target must occur exactly once in the current sources, otherwise the list cannot run
# and "all mutants killed" would be a claim about a different list. A negative control proves that a broken target turns it red.
step "mutant targets match the sources (both lists, instrument check)" bash -c 'node scripts/mutation-controls.mjs --check && node scripts/e2e-mutation-controls.mjs --check'
instrument_negative_control() {
  local out
  for script in scripts/mutation-controls.mjs scripts/e2e-mutation-controls.mjs; do
    if out="$(MUTATION_CHECK_SELFTEST=1 node "$script" --check 2>&1)"; then
      echo "the instrument check of $script accepted a target that cannot match" >&2
      return 1
    fi
    case "$out" in *INSTRUMENT_BROKEN*) ;; *) echo "the instrument check of $script failed without naming the broken target" >&2; return 1 ;; esac
    echo "negative control: $script refuses a target that cannot match"
  done
}
step "instrument negative control (a broken mutant target must turn the check red)" instrument_negative_control
step "mutation controls (every seeded defect must turn the suite red)" node scripts/mutation-controls.mjs
step "end-to-end mutation controls (packaged binary and browser smoke must go red)" node scripts/e2e-mutation-controls.mjs

# ---------------------------------------------------------------- 6-8. drift and license checks
step "schema drift check" node scripts/generate-schemas.mjs --check
step "demo fixtures are current" node scripts/generate-demo-fixtures.mjs --check
step "dependency license check" node scripts/dependency-licenses.mjs --check

# ---------------------------------------------------------------- 9. secret and content hygiene
step "secret and content hygiene scan" node scripts/hygiene-scan.mjs

# ---------------------------------------------------------------- 10-11. packaged-CLI E2E and browser smoke, one shared tarball
if node scripts/pack-install.mjs > "$WORK/pack.json" 2> "$WORK/pack.err"; then
  export PROOFGATE_E2E_INFO="$WORK/pack.json"
  echo
  echo "packed and installed: $(node -e "const p = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')); console.log(p.filename + ' sha256 ' + p.sha256)" "$WORK/pack.json")"
  step "packaged-executable E2E + runbook harness (npm pack, fresh install outside the repository)" node scripts/run-with-cap.mjs "${E2E_CAP_MINUTES:-30}" npx vitest run --config vitest.e2e.config.ts
  if node -e "const { chromium } = require('@playwright/test'); const fs = require('node:fs'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)"; then
    step "browser smoke (real Chromium, file:// report, 375px and 1440px)" node scripts/run-with-cap.mjs "${E2E_CAP_MINUTES:-30}" npx playwright test
  else
    fail_step "browser smoke (real Chromium, file:// report, 375px and 1440px)" "Chromium is not installed for Playwright. Run: npx playwright install chromium"
  fi
else
  cat "$WORK/pack.err" >&2
  fail_step "packaged-executable E2E + runbook harness (npm pack, fresh install outside the repository)" "npm pack or the install into the scratch directory failed (see above)"
  fail_step "browser smoke (real Chromium, file:// report, 375px and 1440px)" "not run: the packed install it needs was not created"
fi

# ---------------------------------------------------------------- summary
echo
echo "=================================================================================================="
echo "SUMMARY  (finished $(now))"
echo "=================================================================================================="
for i in "${!NAMES[@]}"; do
  detail=""
  case "${NAMES[$i]}" in
    "tests with coverage"*) detail="$(last_match "$i" '^ *Tests +[0-9]+')" ;;
    "packaged-executable"*) detail="$(last_match "$i" '^ *Tests +[0-9]+')" ;;
    "browser smoke"*) detail="$(last_match "$i" '[0-9]+ passed')" ;;
    "mutation controls"*) detail="$(last_match "$i" 'mutants killed|did not bite')" ;;
    "end-to-end mutation controls"*) detail="$(last_match "$i" 'mutants killed|did not bite')" ;;
  esac
  printf '%-4s %5ss  %s%s\n' "${RESULTS[$i]}" "${SECONDS_TAKEN[$i]}" "${NAMES[$i]}" "${detail:+  [$detail]}"
done
echo "--------------------------------------------------------------------------------------------------"
if [ "$FAILED" -eq 0 ]; then
  echo "GATE: PASS  (all ${#NAMES[@]} steps passed)"
  echo "This is implementer evidence. It does not replace independent review or the human drill that AC-11 requires."
  exit 0
fi
echo "GATE: FAIL  ($FAILED of ${#NAMES[@]} steps failed or could not run)"
exit 1
