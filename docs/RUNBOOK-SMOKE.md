# Synthetic smoke runbook

A fresh operator follows this page from top to bottom: install the packed release, run the synthetic demo, prove the
failure paths, export and restore an evidence bundle, and clean up. It needs no account, no server, no network access at
run time and no data of yours. Every command below is exact. Expected output follows each command.

**Time:** about 15 minutes. **Where it runs:** macOS or Linux, in a terminal with Node.js 22.12 or newer.

**Who may close AC-11 with this page:** only an independent human, using [HUMAN-DRILL.md](HUMAN-DRILL.md). The repository also
runs this runbook automatically (`npm run smoke:runbook`): that harness executes the command blocks below verbatim in an
empty directory and is **supplemental evidence only**. It is not a human drill and it does not satisfy AC-11.

## What you need before you start

- Node.js 22.12 or newer and npm (`node --version`).
- The release tarball, for example `proofgate-0.1.0.tgz`, and the SHA-256 handed over with it (there are no published release notes yet).
- A web browser, to look at one static page in step 17.

There is no server and no URL to visit: ProofGate is a command-line tool that writes files, and the report is a plain
HTML file that you open from disk. (If you ever serve a report directory over HTTP yourself, bind the server to
`localhost` only; the report needs no server.)

## Steps

Steps 1 to 16 and 18 are commands. Step 17 is something you look at with your eyes. Run every command in the same
terminal window, one after the other: they share the working directory and the `PATH` you set in step 3. If a step's output
differs from what is shown, stop, and write down the step number and what you saw (see the failure table in
[OPERATIONS.md](OPERATIONS.md#failure-diagnosis)).

### Step 1. Check Node.js

<!-- smoke: expect="node ok" -->
```sh
node -e "const [a, b] = process.versions.node.split('.').map(Number); if (a < 22 || (a === 22 && b < 12)) { console.error('Node 22.12 or newer is required, found ' + process.version); process.exit(1); } console.log('node ok ' + process.version);"
```

Expected: `node ok` followed by your Node version.

### Step 2. Tell the runbook where the release files are

<!-- smoke: manual -->
```sh
export PROOFGATE_TARBALL="/absolute/path/to/proofgate-0.1.0.tgz"
export PROOFGATE_TARBALL_SHA256="paste-the-sha256-handed-over-with-the-tarball"
```

Use the **absolute** path of the tarball you were given (a relative path stops working in step 3, which changes
directory first). The checksum is handed to you together with the tarball, by the person who built it, through a channel
other than the tarball itself; there are no published release notes yet. Write down the commit SHA you were handed with
the tarball (it is recorded on your drill receipt); a tarball rebuilt from any other commit has a different hash. The automatic harness supplies both values
itself.

### Step 3. Create an empty working directory and verify the tarball

<!-- smoke: expect="checksum ok" -->
```sh
mkdir proofgate-smoke && cd proofgate-smoke && node -e "const c = require('node:crypto'), f = require('node:fs'), p = require('node:path'); const file = process.env.PROOFGATE_TARBALL, want = process.env.PROOFGATE_TARBALL_SHA256; const fail = (m) => { console.error('STOP: ' + m); process.exit(1); }; if (!file || !want) fail('set PROOFGATE_TARBALL and PROOFGATE_TARBALL_SHA256 first (step 2)'); if (!p.isAbsolute(file)) fail('PROOFGATE_TARBALL must be an absolute path, it is: ' + file); let bytes; try { bytes = f.readFileSync(file); } catch (e) { fail('cannot read the tarball at ' + file + ' (' + e.code + ')'); } const h = c.createHash('sha256').update(bytes).digest('hex'); if (h !== want) fail('CHECKSUM MISMATCH: the tarball hashes to ' + h); console.log('checksum ok ' + h);"
```

Expected: `checksum ok` and the 64-character hash. If you see `STOP: CHECKSUM MISMATCH`, stop: do not install a tarball whose
hash does not match the one you were given. (`shasum -a 256 <file>` or `sha256sum <file>` prints the same hash.) Any other
`STOP:` line names the variable or path to fix; run `cd ..` and remove `proofgate-smoke` before trying again.

### Step 4. Install the tarball into the empty directory

<!-- smoke: expect="added" -->
```sh
npm init -y > /dev/null && npm install --no-audit --no-fund "$PROOFGATE_TARBALL"
```

Expected: `added 3 packages` (ProofGate plus its two runtime dependencies). This is the only step that uses the network, to
fetch those two dependencies; nothing is fetched afterwards.

### Step 5. Put the installed command on your PATH and check the version

<!-- smoke: expect="{{version}}" -->
```sh
export PATH="$PWD/node_modules/.bin:$PATH" && proofgate --version
```

Expected: `0.1.0`. Use this exact form rather than `npx proofgate`, so nothing can be resolved from the registry by
name.

### Step 6. Copy the synthetic demo fixtures

<!-- smoke: expect="happy" expect="unsatisfied" expect="tampered" expect="duplicate" -->
```sh
cp -R node_modules/proofgate/fixtures ./fixtures && ls fixtures/demo
```

Expected: four directories: `duplicate happy tampered unsatisfied`. They are synthetic: opaque receipt ids, commit
hashes derived from fixed labels, and a fixed evaluation clock of `2026-09-29T12:00:00Z`.

### Step 7. Happy path: every mandatory requirement passes (exit 0)

<!-- smoke: exit=0 expect="exit code: 0" expect="verdict: ACCEPTED (exit 0)" expect="mandatory: 5/5 passed" expect="REQ-VENDOR-SANDBOX" expect="DEFERRED" expect="report written to out/happy" -->
```sh
proofgate evaluate --manifest fixtures/demo/happy/requirements.yaml --receipts fixtures/demo/happy/receipts --revisions fixtures/demo/happy/revisions.json --output out/happy --now 2026-09-29T12:00:00Z; echo "exit code: $?"
```

Expected: `verdict: ACCEPTED (exit 0)`, seven requirement lines (five `PASS` mandatory, one `PASS` advisory, and the advisory
`REQ-VENDOR-SANDBOX` shown as `DEFERRED`: a deferral is visible and never counts as a pass), `mandatory: 5/5 passed`,
and `exit code: 0`. Because `--now` fixes the clock, stderr also shows one line starting `proofgate: note: the evaluation clock is
fixed by --now`; that is expected, and the report records `clock_source` as `flag`. Requirement columns are aligned to the
longest id.

### Step 8. Look at what was written

<!-- smoke: expect="index.html" expect="report.json" expect="report.sha256" -->
```sh
ls out/happy
```

Expected: `index.html`, `report.json` and `report.sha256`. The report directory is created atomically and is private to your
user (mode 0700). `report.sha256` holds the hash of the report's **canonical JSON form** (sorted keys, no whitespace), not of the bytes of
`report.json`, so `shasum -a 256 out/happy/report.json` prints a different value; that is expected. `proofgate explain` recomputes
the canonical hash and refuses a report that no longer matches it.

### Step 9. Ask why a requirement passed

<!-- smoke: expect="REQ-CHECKOUT-E2E  PASS" expect="rcpt-checkout-e2e-api-001" expect="rcpt-checkout-e2e-web-001" expect="all_criteria_met" -->
```sh
proofgate explain REQ-CHECKOUT-E2E --report out/happy
```

Expected: `PASS`, the reason code `all_criteria_met`, and the two source receipts (one per repository) with the exact commit
each one covers.

### Step 10. Planted problems: the release is not accepted (exit 1)

<!-- smoke: exit=0 expect="exit code: 1" expect="verdict: UNSATISFIED (exit 1)" expect="mandatory: 1/5 passed" expect="REQ-WEB-UNIT" expect="FAIL" expect="STALE" expect="MISSING" expect="PARTIAL" expect="DEFERRED" -->
```sh
proofgate evaluate --manifest fixtures/demo/unsatisfied/requirements.yaml --receipts fixtures/demo/unsatisfied/receipts --revisions fixtures/demo/unsatisfied/revisions.json --output out/unsatisfied --now 2026-09-29T12:00:00Z; echo "exit code: $?"
```

Expected: `verdict: UNSATISFIED (exit 1)` and one requirement in every non-PASS state: `FAIL` (two failing tests), `STALE`
(evidence older than its limit), `MISSING` (a run that executed zero tests), `PARTIAL` (skipped tests, or only one of two
repositories covered), `DEFERRED`. `mandatory: 1/5 passed`, then `exit code: 1`. The report is still written. Uncertain
states never become success.

### Step 11. Ask why the failing requirement failed

<!-- smoke: expect="REQ-WEB-UNIT  FAIL" expect="tests_failed" expect="rcpt-web-unit-001" -->
```sh
proofgate explain REQ-WEB-UNIT --report out/unsatisfied
```

Expected: reason code `tests_failed` and the receipt that carried the failure.

### Step 12. A tampered artifact is refused (exit 2, no report)

<!-- smoke: exit=0 expect="artifact_hash_mismatch" expect="exit code: 2" expect="no report written" -->
```sh
proofgate evaluate --manifest fixtures/demo/tampered/requirements.yaml --receipts fixtures/demo/tampered/receipts --revisions fixtures/demo/tampered/revisions.json --output out/tampered --now 2026-09-29T12:00:00Z; echo "exit code: $?"; test ! -e out/tampered && echo "no report written"
```

Expected: `proofgate: error [artifact_hash_mismatch]` naming the receipt and the two different hashes, then `exit code: 2` and
`no report written`. Malformed or tampered input never produces a report that could be mistaken for a result.

### Step 13. A manifest with a duplicate requirement id is refused (exit 2)

<!-- smoke: exit=0 expect="manifest_duplicate_requirement_id" expect="exit code: 2" -->
```sh
proofgate evaluate --manifest fixtures/demo/duplicate/requirements.yaml --receipts fixtures/demo/duplicate/receipts --revisions fixtures/demo/duplicate/revisions.json --output out/duplicate --now 2026-09-29T12:00:00Z; echo "exit code: $?"
```

Expected: `proofgate: error [manifest_duplicate_requirement_id]` and `exit code: 2`.

### Step 14. Export an evidence bundle

<!-- smoke: expect="bundle written: out/happy.pgbundle" expect="18 entries" -->
```sh
proofgate bundle export --report out/happy --manifest fixtures/demo/happy/requirements.yaml --receipts fixtures/demo/happy/receipts --revisions fixtures/demo/happy/revisions.json --output out/happy.pgbundle
```

Expected: `bundle written: out/happy.pgbundle` and `18 entries`. The bundle is one file that you can copy to another machine.

### Step 15. Verify and restore the bundle, then reproduce the result from the restored files

<!-- smoke: expect="bundle verified" expect="bundle restored" expect="report written to out/again" expect="assessment ids match" -->
```sh
proofgate bundle verify out/happy.pgbundle && proofgate bundle restore out/happy.pgbundle --output restored && proofgate evaluate --manifest restored/manifest.json --receipts restored/receipts --revisions restored/revisions.json --output out/again --now 2026-09-29T12:00:00.000Z && test "$(grep '"assessment_id"' out/happy/report.json)" = "$(grep '"assessment_id"' out/again/report.json)" && echo "assessment ids match"
```

Expected: `bundle verified`, `bundle restored`, a fresh evaluation from the restored files that is `ACCEPTED`, and finally
`assessment ids match`: the restored copy reproduces the original assessment, so the hashes agree.

### Step 16. A truncated bundle is refused and leaves nothing behind

<!-- smoke: exit=0 expect="bundle_truncated" expect="exit code: 2" expect="nothing restored" -->
```sh
size=$(wc -c < out/happy.pgbundle); head -c $((size / 2)) out/happy.pgbundle > out/truncated.pgbundle; proofgate bundle restore out/truncated.pgbundle --output out/never; echo "exit code: $?"; test ! -e out/never && echo "nothing restored"
```

Expected: `proofgate: error [bundle_truncated]: bundle is <n> bytes but its header declares <2n>`, `exit code: 2` and
`nothing restored`. A damaged bundle never leaves a partially accepted state.

### Step 17. Open the static report in a browser (look, do not type)

<!-- smoke: manual -->
```sh
open out/unsatisfied/index.html    # macOS; on Linux use: xdg-open out/unsatisfied/index.html
```

Look for all of the following, then narrow the window to phone width and look again:

1. A banner reading **NO ACCEPTED RESULT** with exit code 1, and a list of the mandatory requirements that are not PASS.
2. A table with seven requirements. Each status is written as a word (`PASS`, `FAIL`, `STALE`, `MISSING`, `PARTIAL`,
   `DEFERRED`) as well as being colored.
3. On a narrow window the tables turn into stacked cards; there is no sideways scrolling of the whole page.
4. Nothing loads from the internet and nothing asks for permission. (The page contains no script and no external link.)

### Step 18. Clean up

<!-- smoke: expect="cleanup done" -->
```sh
cd .. && rm -rf proofgate-smoke && test ! -e proofgate-smoke && echo "cleanup done"
```

Expected: `cleanup done`. The tool wrote only inside `proofgate-smoke`; removing that directory removes everything, including
the report and the restored copy. If you exported the environment variables in step 2, close the terminal or unset them.

## When to stop

If any step fails or shows something different from the expected text, stop and write the step number and the exact text.
Do not retry until it works: a failing step is a finding. The [failure diagnosis table](OPERATIONS.md#failure-diagnosis) lists
every reason code with what it means and what to do next.
