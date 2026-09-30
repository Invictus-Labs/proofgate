# Acceptance matrix: ProofGate (the MVP integration line and six rounds of review remediation)

Reconciles every acceptance criterion in `docs/prd/proofgate.md` section 5 to real test ids. **This is maintainer
evidence: the maintainers ran every command recorded here; nothing in this file is an independent review or QA receipt.**
Test ids are `file :: describe > test title` and resolve to real tests: the "AC index" tests in `tests/proofgate.spec.ts`
fail if any id below does not exist, and cross-check the ids of the main suite against `vitest list`. PRD placeholders such as
`<schema and artifact tamper>` in section 5b map to the `describe` blocks named `AC-NN <placeholder>` in
`tests/proofgate.spec.ts`. Titles produced by `it.each` or loops are referenced by their template title (`%s`,
`${width}`) and expand into several concrete tests.

Status vocabulary: **PASS** = every clause of the criterion has a test that ran and passed in the recorded run;
**PARTIAL** = part of the criterion is not covered or is only labelled-fixture evidence; **NOT RUN** = nothing executed;
**BLOCKED** = a named blocker; **PENDING_HUMAN_RECEIPT** = the criterion needs a receipt from an independent human that
does not exist yet. A PARTIAL, NOT RUN, BLOCKED or PENDING row is not a PASS, and no such row may be called PASS.

## Summary (provisional: maintainer evidence, no gate result is recorded for the current tree)

| AC | Flow (PRD 5b) | Status | Evidence layers | Gap or note |
| --- | --- | --- | --- | --- |
| AC-01 | schema and artifact tamper | PASS | core acceptance, packaged binary | none |
| AC-02 | revision mismatch | PASS | core acceptance, packaged binary | none |
| AC-03 | mock and empty suite controls | PARTIAL | core acceptance, packaged binary, decision properties | The reviewed tree let a failing zero-test receipt hide beside a passing one (P0). The fix has regression tests at unit, core and packaged level, metamorphic properties and mutation controls, but it was verified only by its maintainer: PARTIAL until an independent re-review confirms it. No agent waives this. |
| AC-04 | freshness boundaries | PASS | core acceptance, packaged binary | none |
| AC-05 | negative control and report reconciliation | PASS | core acceptance, report renderer, packaged binary, real browser | none |
| AC-06 | adapter compatibility | PARTIAL | core acceptance, packaged binary | Native versioned local-receipt adapter and the version policy are proven. The RunProof export importer is verified only against a labelled synthetic fixture, because RunProof has no export (blocked upstream); it is never presented as live. Whether fixture-only evidence satisfies the criterion's optional RunProof clause is an owner decision that has not been made. No agent waives it. |
| AC-07 | untrusted receipt isolation | PASS | core acceptance, report renderer, packaged binary, real browser | none |
| AC-08 | offline demo | PASS | core acceptance, demo fixtures, packaged binary | OS-level network denial ran on macOS (`sandbox-exec`) and, through Docker `--network none`, on Linux; see the run evidence below. The clause "live connector operations fail explicitly when disconnected" is nearly vacuous: no connector exists, the `connector` command always fails with `connector_disconnected`, and there is no connected branch to contrast it with. It proves the explicit failure, and makes no live-adapter claim. |
| AC-09 | redaction and hostile input | PARTIAL | core acceptance, report renderer, packaged binary, real browser, hostile-input matrix, heap-capped runs | Planted KNOWN shapes never survive at JSON nesting depth 0 to 8 (including values of any length, folded and UTF-16 spellings in artifacts); redaction is best effort and does not recognise a secret without a known shape or credential name; **the PRD clause "personal fields" is only partly met** (e-mail addresses are redacted; names, telephone numbers, addresses, IP addresses and host names are not); a long list of shapes is documented as NOT redacted, each pinned by a test, and whether any of them should be covered is an open owner decision (`docs/INTERFACES.md`, "What it does not redact"); short-prefix tokens behind a letter or digit (`sk-`, `key-`, `Bearer`) are not found (boundaries in `docs/INTERFACES.md`); the artifact scan does not decode base64, hex or compressed data and reads only the distinctive token shapes in a window that is mostly binary. The row is PARTIAL because every review round has found new leaking shapes in this area (the latest, in the tested tree of round 5, were regressions against earlier redactors: an option named Authorization, a name that only starts like a usage counter, a value that starts with a bracket; in the tree of round 6, a hang on a short receipt string and further shapes that leak, for example a value that starts with a bracket or a brace, which are fixed in the tree that follows and are not yet re-reviewed), and none of the fixes has been re-reviewed by someone who did not write it; it can only move to PASS on an independent re-review with no open finding. |
| AC-10 | portability and corruption | PASS | core acceptance, packaged binary | none |
| AC-11 | release documentation and fresh-operator drill | PENDING_HUMAN_RECEIPT | documentation, automated harness (supplemental only) | Needs a completed `docs/HUMAN-DRILL.md` sheet from an independent human. No agent may mark it PASS. |

## Run evidence

**The runs below are for the round-1 tested tree. The later rounds (2 to 6) change source, tests and scripts after it (see the ledger), so none of these numbers describe the current
tree. The gates that were run on the round-2 tree (the round-2 tree) are carried forward as history in `gate-evidence.md`; **no gate
result is recorded for the round-3, round-4 and round-5 trees** until the gates are run on the final commit and written there. The PASS
rows of this matrix are maintainer evidence and stay provisional until then and until an independent review confirms them.**

Full detail, with timestamps and per-step results, is in [`gate-evidence.md`](gate-evidence.md). Tested tree:
the round-1 tree in round 1 (created from the MVP integration line at
the reviewed tree to remediate independent review round 1, see
[`review-round1-ledger.md`](review-round1-ledger.md)); the final HEAD differs from it only by `docs/qa/` documentation. Every
run below started from the tested tree with a clean working tree, except where the row says otherwise.

| Run | Result |
| --- | --- |
| `bash scripts/verify-quality.sh` on the host, macOS arm64, Node v25.8.2 (2026-09-29T10:30:33Z to 10:45:41Z) | exit 0, all 12 steps PASS: 779 tests passed; coverage 97.13% statements, 95.69% branches, 98.21% functions, 97.83% lines; 55 of 55 mutants killed; 7 of 7 end-to-end mutants killed; packaged E2E 75 passed; browser smoke 28 passed |
| the same gate on the supported floor, `node:22.12` (Node v22.12.0, Linux aarch64), throwaway container (2026-09-29T10:47:33Z to 11:07:16Z) | exit 0, all 12 steps PASS: 778 passed and 1 skipped; 55 of 55 mutants killed; packaged E2E 74 passed and 1 skipped; real Linux Chromium smoke 28 passed. The skips are the macOS-only `sandbox-exec` network-deny check |
| Docker image build and synthetic run with `--network none` at the tested tree (2026-09-29T10:46:22Z), and `bash scripts/docker-smoke.sh` (11:07:36Z, working tree with the docs-only edits) | build exit 0; 10 of 10 checks passed; base image pinned by digest |
| hostile YAML through the real CLI in `node:22.12` containers with `--cpus=2 --memory=4g` at three heap sizes | every hostile shape refused with exit 2 in 120 to 220 ms; the reviewed commit aborted with a V8 out-of-memory error |
| `node scripts/runbook-smoke.mjs` (supplemental only) | 16 of 16 automatic steps passed, 2 manual steps not executed; AC-11 unchanged |

Limits of this evidence: one maintainer (the same author as the fixes), two hosts (macOS arm64 and Linux aarch64
in a container), both arm64, no x86_64 run; the RunProof importer is fixture-only; the OS-level network-deny sandbox test ran
on macOS only; benchmark timings are from a shared Docker VM and show two large outliers (`docs/BENCHMARK.md`); no independent
review or QA of the remediation has been done; the human drill for AC-11 has not been done.

## Per-criterion test ids

Every criterion lists (1) the core acceptance tests in `tests/proofgate.spec.ts`, (2) the same flow driven through the
**packaged executable** (`npm pack`, install into a fresh directory outside the repository, run the real `proofgate` binary),
and (3) supporting unit and integration tests.

### AC-01 - schema and artifact tamper

Reject malformed manifests, duplicate requirement IDs, unknown requirement references and tampered artifacts; exit 2 with a stable reason code.

Status: **PASS** (maintainer-run, not independently reviewed).

Core acceptance:

- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > accepts well-formed inputs with exit 0 (happy path control)`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects a malformed manifest (invalid YAML) with exit 2 and manifest_parse_error`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects a manifest that violates the schema with manifest_schema_invalid and names the field`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects unknown manifest fields instead of dropping them`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects duplicate requirement IDs, including case-only duplicates`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects a receipt that references an unknown requirement ID`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects unknown repository references in the manifest and in receipts`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects a tampered artifact (hash mismatch) with exit 2 and writes no report`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > detects a single flipped byte in an artifact (failure boundary)`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects a receipt whose artifact file is missing`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > recomputes the artifact hash from the file rather than trusting the receipt`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects invalid JSON and non-object receipts with stable codes`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > rejects a duplicate receipt ID across files`
- `tests/proofgate.spec.ts :: AC-01 schema and artifact tamper > returns exit 2 (not 1) for a missing manifest, revisions or receipts directory`

Packaged binary (`%s` expands to eight rejected inputs: malformed manifest, duplicate ids, unknown requirement reference, unknown repository, tampered artifact, missing artifact, invalid JSON, schema violation):

- `tests/e2e/packaged-cli.test.ts :: E2E AC-01 schema and artifact tamper (packaged binary) > happy path: exit 0, the report is written and the static page says ACCEPTED`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-01 schema and artifact tamper (packaged binary) > %s is rejected with exit 2, code %s, no report and nothing on stdout`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-01 schema and artifact tamper (packaged binary) > a single flipped byte in an artifact is detected (failure boundary)`

Supporting:

- `tests/unit/manifest-revisions.test.ts :: manifest parsing and normalisation`
- `tests/unit/adapters.test.ts :: native receipt adapter`
- `tests/unit/fsguard.test.ts :: validateRelativePath`

### AC-02 - revision mismatch

A receipt for commit A cannot satisfy commit B even when branch names match; multi-repository gates require all declared full SHAs.

Status: **PASS** (maintainer-run, not independently reviewed).

Core acceptance:

- `tests/proofgate.spec.ts :: AC-02 revision mismatch > a receipt for commit A does not satisfy commit B even when branch names match`
- `tests/proofgate.spec.ts :: AC-02 revision mismatch > the same receipt satisfies commit A (control: the mismatch, not the receipt, was the cause)`
- `tests/proofgate.spec.ts :: AC-02 revision mismatch > a one-character difference in the SHA is a mismatch`
- `tests/proofgate.spec.ts :: AC-02 revision mismatch > multi-repository gates require every declared SHA: one repository alone is PARTIAL`
- `tests/proofgate.spec.ts :: AC-02 revision mismatch > multi-repository gate passes only when both declared repositories match their SHAs`
- `tests/proofgate.spec.ts :: AC-02 revision mismatch > multi-repository gate with one wrong SHA stays unsatisfied and names the repository`
- `tests/proofgate.spec.ts :: AC-02 revision mismatch > a receipt cannot borrow another repository's SHA`
- `tests/proofgate.spec.ts :: AC-02 revision mismatch > requires full 40-hex SHAs: short, uppercase and 64-hex values are rejected as exit 2`
- `tests/proofgate.spec.ts :: AC-02 revision mismatch > rejects a revision set that omits a declared repository or names an undeclared one`

Packaged binary:

- `tests/e2e/packaged-cli.test.ts :: E2E AC-02 revision mismatch (packaged binary) > a receipt for commit A cannot satisfy commit B: exit 1 and the receipt is listed as rejected`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-02 revision mismatch (packaged binary) > control: the same receipt satisfies commit A, so the mismatch alone was the cause`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-02 revision mismatch (packaged binary) > multi-repository gates need every declared SHA: one repository alone is PARTIAL, both is PASS`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-02 revision mismatch (packaged binary) > short, uppercase and 64-hex revisions are rejected as malformed input`

Supporting:

- `tests/unit/decision.test.ts :: disqualifiers`
- `tests/unit/decision.test.ts :: decideRequirement (multi-repository)`
- `tests/unit/decision.test.ts :: combineStatuses`
- `tests/unit/manifest-revisions.test.ts :: revisions`

### AC-03 - mock and empty suite controls

Live-required criteria reject mocked receipts; skipped and partial results remain unsatisfied; zero tests is MISSING.

Wording of the last clause, as implemented (stricter than the PRD sentence, never weaker): a zero-test receipt that CLAIMS `pass` is
MISSING (`zero_tests`); a zero-test `fail` is FAIL; a zero-test `partial` or `skipped` is PARTIAL. A non-pass zero-test receipt is
never ignorable, which is exactly what the P0 of review round 1 was about.

Status: **PARTIAL.** Every clause has passing tests, but the reviewed tree failed a clause in a way its tests could not
see: a `result: fail` receipt with zero tests was treated as ignorable evidence and could sit beside a passing receipt with
exit 0 (P0, review round 1). The fix (unit, core and packaged tests, metamorphic properties in
`tests/unit/round2-decision-properties.test.ts`, mutants M18 and M07-M08) is maintainer-verified only; AC-03 stays PARTIAL until
an independent re-review confirms it. See `review-round1-ledger.md`.

Core acceptance:

- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > live-required requirements reject mocked receipts`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > live-required requirements reject synthetic receipts`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > a mocked receipt satisfies only a requirement that explicitly allows mocked evidence (control)`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > a mocked pass cannot mask a missing live pass when both are supplied (mock never upgrades)`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > skipped tests keep the requirement unsatisfied (PARTIAL)`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > a partial result and a skipped suite are PARTIAL, never PASS`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > zero tests is MISSING, even when the receipt says pass`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > failed tests are FAIL, and a pass claim that contradicts its own counts is FAIL`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > a wrong environment or a lower test level does not satisfy the requirement`
- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > a higher test level satisfies a lower required level`

Packaged binary:

- `tests/e2e/packaged-cli.test.ts :: E2E AC-03 mock and empty suite controls (packaged binary) > mocked-vs-live: a live-required requirement rejects mocked and synthetic receipts`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-03 mock and empty suite controls (packaged binary) > a mocked receipt satisfies only a requirement that explicitly allows mocked evidence (control)`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-03 mock and empty suite controls (packaged binary) > zero tests is MISSING even when the receipt claims pass`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-03 mock and empty suite controls (packaged binary) > skipped and partial results stay PARTIAL, never PASS`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-03 mock and empty suite controls (packaged binary) > a wrong environment or a lower test level does not satisfy the requirement`

Supporting:

- `tests/unit/decision.test.ts :: classifyEvidence`
- `tests/unit/decision.test.ts :: decideRequirement (single repository)`

### AC-04 - freshness boundaries

At the max_age_seconds boundary evidence becomes STALE; a changed policy hash forces re-evaluation; a fixed UTC clock makes results reproducible.

Status: **PASS** (maintainer-run, not independently reviewed).

Core acceptance:

- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > age max-1 second is PASS`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > age exactly max_age_seconds is STALE`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > age max+1 second is STALE`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > the boundary is decided by the injected clock: the same receipt flips from PASS to STALE as --now advances`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > sub-second precision holds at the boundary (999 ms under is fresh, exactly at is stale)`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > a fresh passing receipt outranks an older stale one for the same revision`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > receipts finished after the evaluation time are rejected, not trusted`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > a fixed UTC clock makes reports byte-for-byte reproducible`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > PROOFGATE_NOW fixes the clock and --now takes precedence; a malformed clock is exit 2`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > a changed policy hash forces a new assessment and leaves the historical report immutable`
- `tests/proofgate.spec.ts :: AC-04 freshness boundaries > a title-only change is not a policy change, but a rule change is`

Packaged binary:

- `tests/e2e/packaged-cli.test.ts :: E2E AC-04 freshness boundaries (packaged binary) > stale-at-boundary: max-1 second is PASS, exactly max_age_seconds is STALE, max+1 is STALE`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-04 freshness boundaries (packaged binary) > the injected clock decides: the same receipt flips PASS to STALE as --now advances by one second`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-04 freshness boundaries (packaged binary) > a fixed UTC clock makes reports byte-for-byte reproducible, from PROOFGATE_NOW as well as --now`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-04 freshness boundaries (packaged binary) > a changed policy hash forces a new assessment; the historical report is moved, never overwritten`

Supporting:

- `tests/unit/decision.test.ts :: classifyEvidence`
- `tests/unit/clock-escape.test.ts :: clock`
- `tests/unit/manifest-revisions.test.ts :: manifest parsing and normalisation`
- `tests/integration/pipeline-report.test.ts :: evaluatePaths`

### AC-05 - negative control and report reconciliation

Report every mandatory requirement with status, source receipt, environment and reason; a planted mandatory failure changes exit 0 to exit 1.

Status: **PASS** (maintainer-run, not independently reviewed). The static report page is covered by renderer tests and by
the real-browser smoke.

Core acceptance:

- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > reports every requirement with status, source receipt, environment and reason`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > reconciles: every mandatory requirement in the manifest appears in the report exactly once`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > a planted mandatory failure changes exit 0 to exit 1 (seeded negative control)`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > a planted FAIL receipt (not just a missing one) also flips exit 0 to exit 1`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > an advisory failure is reported but does not change the exit code`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > DEFERRED never satisfies a mandatory gate, even with passing evidence`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > a manifest with no mandatory requirement is rejected rather than vacuously accepted`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > explain prints receipt IDs, per-repository status and reason codes`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > explain surfaces rejected receipts and their reasons for an unsatisfied requirement`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > the report directory is written atomically with owner-only permissions and a matching hash file`
- `tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation > exit codes: unsatisfied is 1, malformed is 2, and usage errors are 2 with a stable code`

Packaged binary:

- `tests/e2e/packaged-cli.test.ts :: E2E AC-05 negative control and report reconciliation (packaged binary) > reports every requirement once with status, source receipt, environment and reason; an advisory gap does not change exit 0`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-05 negative control and report reconciliation (packaged binary) > a planted mandatory failure changes exit 0 to exit 1 and the page from ACCEPTED to NO ACCEPTED RESULT (seeded negative control)`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-05 negative control and report reconciliation (packaged binary) > explain prints receipt ids, environment and reason codes; an unknown requirement is exit 2`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-05 negative control and report reconciliation (packaged binary) > explain refuses a report edited after the fact (report.sha256 no longer matches)`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-05 negative control and report reconciliation (packaged binary) > a manifest with no mandatory requirement is refused instead of being vacuously accepted`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-05 negative control and report reconciliation (packaged binary) > the three exit codes are distinct: 0 accepted, 1 unsatisfied, 2 malformed`

Report renderer (unit):

- `tests/unit/report-render.test.ts :: AC-05 report side: every requirement, status, source receipt, environment and reason`
- `tests/unit/report-render.test.ts :: verdict and exit-code meaning`
- `tests/unit/report-render.test.ts :: empty and 'no accepted result' states`
- `tests/unit/report-render-cli.test.ts :: evaluate writes the static HTML report > a planted mandatory failure changes exit 0 to exit 1 and the page changes from ACCEPTED to no accepted result`
- `tests/unit/report-render-cli.test.ts :: evaluate writes the static HTML report > exit 0: index.html is written privately, is exactly the rendering of report.json and shows ACCEPTED`

Real browser (Chromium, file://, report written by the installed CLI; empty policy and self-contradicting report come from the packaged renderer module):

- `tests/e2e/smoke.spec.ts :: states are explicit and never look like success > happy page: ACCEPTED, mandatory count, and the deferred advisory requirement stays visible`
- `tests/e2e/smoke.spec.ts :: states are explicit and never look like success > unsatisfied page: NO ACCEPTED RESULT, exit code 1, and every status is written out as text`
- `tests/e2e/smoke.spec.ts :: states are explicit and never look like success > empty state: no receipts supplied shows the explicit empty message and NO ACCEPTED RESULT`
- `tests/e2e/smoke.spec.ts :: states are explicit and never look like success > empty policy (renderer module, not the CLI): nothing to accept and nothing styled as success`
- `tests/e2e/smoke.spec.ts :: states are explicit and never look like success > self-contradicting report (renderer module, not the CLI): shown as not accepted with the reason`

Supporting:

- `tests/unit/decision.test.ts :: assess (the assessment as a whole)`
- `tests/integration/pipeline-report.test.ts :: explainRequirement`
- `tests/integration/pipeline-report.test.ts :: CLI surface`
- `tests/integration/reasons-explain.test.ts :: describeReason` (inherited names such as `constructor` and `__proto__` get the fallback text, never an inherited function)
- `tests/integration/reasons-explain.test.ts :: explain with a hand-edited report` (the same through the CLI `explain`, in process and through `dist/cli.js`)

### AC-06 - adapter compatibility

Import versioned local receipt JSON and optional RunProof export through adapters; unsupported major versions fail without silently dropping fields.

Status: **PARTIAL.** Native versioned local-receipt adapter and version policy proven; the RunProof export importer is
verified only against a labelled synthetic fixture (`source_kind: "fixture"`, always imported as `execution_kind: "synthetic"`)
because RunProof has no export (blocked upstream, no live RunProof import exists). The criterion calls the RunProof export
"optional"; whether fixture-only evidence satisfies that clause is an owner decision that is still pending. No agent waives
it, and the fixture is never relabelled as live anywhere. The importer now also honours the run's own `execution_status`
and `exit_code` (review round 1), which is again fixture-level evidence.

Core acceptance:

- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > imports a versioned local receipt JSON through the native adapter`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > imports a RunProof export document, and a fixture is always synthetic: a live-required requirement rejects it`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > a fixture satisfies a requirement only when synthetic evidence is explicitly allowed`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > an operator-captured RunProof run bound as live can satisfy a live-required requirement`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > a RunProof run that is not verified stays unsatisfied (failed -> FAIL, unknown -> PARTIAL)`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > rejects a RunProof run that claims verified while a required check is not pass`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > rejects an unfinished RunProof run as evidence`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > unsupported major versions fail explicitly for receipts, RunProof documents, bundles and envelopes`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > unknown fields are rejected, never silently dropped (receipts and RunProof documents)`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > preserves RunProof run fields ProofGate does not map, verbatim, in the receipt extensions`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > an unknown receipt format is an explicit error`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > the event envelope validates, rejects unsupported majors and unknown fields, and dedupes by event_id`
- `tests/proofgate.spec.ts :: AC-06 adapter compatibility > a late, older event never displaces a newer one (no state inferred from stale events)`

Packaged binary:

- `tests/e2e/packaged-cli.test.ts :: E2E AC-06 adapter compatibility (packaged binary) > imports a versioned local receipt through the native adapter and records its provenance`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-06 adapter compatibility (packaged binary) > a RunProof document labelled as a fixture is synthetic: a live-required requirement rejects it; allowing synthetic accepts it`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-06 adapter compatibility (packaged binary) > unsupported major versions fail with exit 2 and no report, for every document type`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-06 adapter compatibility (packaged binary) > unknown fields are rejected, never silently dropped`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-06 adapter compatibility (packaged binary) > an unknown receipt format is an explicit error`

Supporting:

- `tests/unit/adapters.test.ts :: RunProof adapter`
- `tests/unit/adapters.test.ts :: event envelope`
- `tests/unit/adapters.test.ts :: format routing`
- `tests/integration/contracts.test.ts :: published JSON Schemas`

### AC-07 - untrusted receipt isolation

Escape malicious report text; never execute receipt commands or fetch artifact URLs; traversal and symlink escapes are rejected.

Status: **PASS** (maintainer-run, not independently reviewed). "Escape malicious report text" is proven in the static
HTML by strict-tokenizer tests and by real Chromium.

Core acceptance:

- `tests/proofgate.spec.ts :: AC-07 untrusted receipt isolation > never executes the command recorded in a receipt`
- `tests/proofgate.spec.ts :: AC-07 untrusted receipt isolation > never fetches artifact URLs: an http artifact path is rejected and a listening server sees zero requests`
- `tests/proofgate.spec.ts :: AC-07 untrusted receipt isolation > rejects path traversal and absolute artifact paths`
- `tests/proofgate.spec.ts :: AC-07 untrusted receipt isolation > rejects a symlink artifact that escapes the receipts directory`
- `tests/proofgate.spec.ts :: AC-07 untrusted receipt isolation > rejects a symlinked directory, a symlinked receipt file, and a dangling symlink`
- `tests/proofgate.spec.ts :: AC-07 untrusted receipt isolation > keeps hostile text inert: raw in report.json, safe after escapeHtml`
- `tests/proofgate.spec.ts :: AC-07 untrusted receipt isolation > escapeHtml neutralises every HTML metacharacter including quotes and backticks`

Packaged binary (`%s` expands to five path shapes: parent traversal, nested traversal, absolute path, backslash, empty segment):

- `tests/e2e/packaged-cli.test.ts :: E2E AC-07 untrusted receipt isolation (packaged binary) > never executes the command recorded in a receipt`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-07 untrusted receipt isolation (packaged binary) > never fetches an artifact URL: it is rejected as an invalid path and a listening server sees zero requests`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-07 untrusted receipt isolation (packaged binary) > rejects %s in an artifact path with exit 2`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-07 untrusted receipt isolation (packaged binary) > rejects a symlink that escapes the receipts directory, a symlinked directory and a dangling symlink`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-07 untrusted receipt isolation (packaged binary) > rejects oversize input before it is parsed: blob cap, metadata cap and entry-count cap`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-07 untrusted receipt isolation (packaged binary) > hostile text stays inert: raw in report.json, visible text and no markup in the static page`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-07 untrusted receipt isolation (packaged binary) > prompt-injection text in fields is data: it neither changes the verdict nor the exit code`

Report renderer (unit; every corpus entry is a separate test):

- `tests/unit/report-render-security.test.ts :: hostile strings render as visible text only (attack corpus x every free-form field)`
- `tests/unit/report-render-security.test.ts :: hostile strings in structured positions (schema-invalid reports must still be inert)`
- `tests/unit/report-render-security.test.ts :: property-style fuzz (seeded, reproducible) > 600 random hostile strings x random fields keep every invariant`
- `tests/unit/report-render.test.ts :: receipts table > never links an artifact: the only href values are in-page anchors`
- `tests/unit/report-render.test.ts :: self-contained page: CSP, no scripts, no network, light/dark, narrow, print > ships a strict CSP meta tag that pins the inline stylesheet by hash and allows nothing else`
- `tests/unit/report-render.test.ts :: self-contained page: CSP, no scripts, no network, light/dark, narrow, print > contains no script, handler, external URL, style attribute or link element`
- `tests/unit/report-render-mutant.test.ts :: negative control: rendering with escaping disabled is detected > script tags, attribute breakouts and comments become violations`

Real browser (Chromium; `${width}` is 375 and 1440):

- `tests/e2e/smoke.spec.ts :: hostile strings render as visible text > at ${width}px the markup is shown literally and nothing executes, loads or links`
- `tests/e2e/smoke.spec.ts :: hostile strings render as visible text > planted secrets never reach the rendered page, its source or the console`
- `tests/e2e/smoke.spec.ts :: static report at ${width}px > ${scenario}: no page overflow, readable tables, zero console messages, no network`

Browser-smoke controls (the observers see real faults):

- `tests/e2e/smoke-controls.spec.ts :: controls: the smoke observers see real faults in real Chromium > a page that runs script is seen: the script element, the global it sets, the dialog and the console error`
- `tests/e2e/smoke-controls.spec.ts :: controls: the smoke observers see real faults in real Chromium > a page that loads an image over the network is seen as a request beyond the document`
- `tests/e2e/smoke-controls.spec.ts :: controls: the smoke observers see real faults in real Chromium > markup that is NOT escaped becomes a live element, which the smoke's 'dangerous element' count would catch`

Supporting:

- `tests/unit/fsguard.test.ts :: openRoot and scanTree`
- `tests/unit/fsguard.test.ts :: confined reads`
- `tests/unit/clock-escape.test.ts :: escapeHtml`

### AC-08 - offline demo

Synthetic demo works without paid accounts or mandatory telemetry; an outbound-denied test completes the deterministic core; live connector operations fail explicitly when disconnected.

Status: **PASS** (maintainer-run, not independently reviewed). The synthetic demo is `fixtures/demo.json` and
`fixtures/demo/**`; its fixed clock and expected results are asserted in process and through the packaged binary.

Core acceptance:

- `tests/proofgate.spec.ts :: AC-08 offline demo > completes evaluate, explain and bundle export/verify/restore with every network primitive blocked and none attempted`
- `tests/proofgate.spec.ts :: AC-08 offline demo > the denial harness really blocks: a fetch and a socket attempt under it are refused and recorded (control)`
- `tests/proofgate.spec.ts :: AC-08 offline demo > the packaged CLI completes in a subprocess with network primitives stubbed out and an empty environment`
- `tests/proofgate.spec.ts :: AC-08 offline demo > runs the packaged CLI inside an OS-level network-deny sandbox (macOS sandbox-exec) and the sandbox provably denies sockets`
- `tests/proofgate.spec.ts :: AC-08 offline demo > the core's source imports no network module and contains no telemetry endpoint`
- `tests/proofgate.spec.ts :: AC-08 offline demo > the synthetic demo workflow needs no account, credentials or home directory`
- `tests/proofgate.spec.ts :: AC-08 offline demo > live connector operations fail explicitly when disconnected`

Demo fixtures:

- `tests/proofgate.spec.ts :: AC-08 synthetic demo fixtures (fixtures/demo.json) > is labelled synthetic, uses a fixed UTC clock and names four scenarios`
- `tests/proofgate.spec.ts :: AC-08 synthetic demo fixtures (fixtures/demo.json) > scenario %s evaluates in process to the documented exit code and statuses`
- `tests/proofgate.spec.ts :: AC-08 synthetic demo fixtures (fixtures/demo.json) > the unsatisfied scenario shows every status, so no requirement state is untested by the demo`
- `tests/proofgate.spec.ts :: AC-08 synthetic demo fixtures (fixtures/demo.json) > committed demo data carries no UUID literal, personal path, e-mail address or credential-shaped text`

Packaged binary (`%s` expands to happy, unsatisfied, tampered and duplicate):

- `tests/e2e/packaged-cli.test.ts :: E2E AC-08 offline core (packaged binary) > evaluate, explain and the bundle round trip complete with every network primitive stubbed out and none attempted`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-08 offline core (packaged binary) > control: the deny harness really blocks (a fetch under it fails and is recorded)`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-08 offline core (packaged binary) > the installed binary completes inside an OS-level network-deny sandbox with the same report hash as an unrestricted run`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-08 offline core (packaged binary) > needs no account, credentials or home directory`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-08 offline core (packaged binary) > live connector operations fail explicitly when disconnected: exit 2, connector_disconnected, nothing attempted`
- `tests/e2e/packaged-cli.test.ts :: E2E synthetic demo fixtures (fixtures/demo.json) shipped in the tarball > the descriptor is labelled synthetic and uses the fixed demo clock`
- `tests/e2e/packaged-cli.test.ts :: E2E synthetic demo fixtures (fixtures/demo.json) shipped in the tarball > scenario %s gives the documented exit code and report contents`

Supporting:

- `tests/integration/edge-cases.test.ts :: CLI edge cases`
- The denial harness itself: `tests/helpers/deny-network.mjs`.

### AC-09 - redaction and hostile input

Validate size and schema before processing; planted secret tokens never appear in logs or exported reports; malicious HTML renders as text.

Status: **PARTIAL.** Every clause has passing tests, but the redaction clause is best effort with a documented list of shapes that are not redacted (an open owner decision), and every review round has found new leaking shapes; no independent re-review of the current fixes exists. "Malicious HTML renders as text" is proven in real
Chromium. Every file emitted by the packaged binary (report directory, superseded copy, bundle, restored tree) and every
command's stdout and stderr is scanned for the planted secrets.

Core acceptance:

- `tests/proofgate.spec.ts :: AC-09 redaction and hostile input > planted secret tokens never reach report.json, the report directory, stdout or stderr`
- `tests/proofgate.spec.ts :: AC-09 redaction and hostile input > secrets never appear in exported bundle documents or in error output`
- `tests/proofgate.spec.ts :: AC-09 redaction and hostile input > validates size before processing: an oversize receipt set is refused without parsing anything`
- `tests/proofgate.spec.ts :: AC-09 redaction and hostile input > enforces the 1,000-entry limit before reading any file`
- `tests/proofgate.spec.ts :: AC-09 redaction and hostile input > caps blob bytes before hashing and honours an explicit override`
- `tests/proofgate.spec.ts :: AC-09 redaction and hostile input > rejects schema violations before any output is produced`
- `tests/proofgate.spec.ts :: AC-09 redaction and hostile input > hostile prototype keys and deeply nested extensions are contained`
- `tests/proofgate.spec.ts :: AC-09 redaction and hostile input > a YAML alias bomb in the manifest is refused as a parse error`

Packaged binary:

- `tests/e2e/packaged-cli.test.ts :: E2E AC-09 redaction and hostile input (packaged binary) > planted secrets never reach any emitted file, stdout, stderr, the JSON output, the bundle or the restored tree`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-09 redaction and hostile input (packaged binary) > secrets in error paths are redacted too: a receipt whose key name is a token does not echo it`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-09 redaction and hostile input (packaged binary) > export refuses an artifact that contains a credential-shaped string unless explicitly allowed`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-07 untrusted receipt isolation (packaged binary) > rejects oversize input before it is parsed: blob cap, metadata cap and entry-count cap`
- `tests/e2e/packaged-cli.test.ts :: E2E transcript hygiene > no command run by this suite printed a planted secret, the operator's home directory or a stack trace`

Report renderer and real browser:

- `tests/unit/report-render-cli.test.ts :: evaluate writes the static HTML report > hostile text planted in the inputs is shown as text and planted secrets never reach the page`
- `tests/unit/report-render-security.test.ts :: invisible and reordering characters are made visible > bidi overrides, zero-width characters and NUL are shown as [U+XXXX] in the rendered text`
- `tests/unit/report-render-security.test.ts :: very long strings are bounded but never silently dropped > cuts each string at the display limit with a visible marker; output stays small`
- `tests/e2e/smoke.spec.ts :: hostile strings render as visible text > at ${width}px the markup is shown literally and nothing executes, loads or links`
- `tests/e2e/smoke.spec.ts :: hostile strings render as visible text > planted secrets never reach the rendered page, its source or the console`

Gate-level controls:

- `tests/integration/hygiene-scan.test.ts :: hygiene scan negative controls` (the repository's own secret and content scan goes red on every planted rule)

Supporting:

- `tests/unit/redact.test.ts :: redaction of credential-shaped text`
- `tests/unit/redact.test.ts :: key-name redaction`
- `tests/unit/redact.test.ts :: credential scanning of opaque bytes`
- `tests/unit/fsguard.test.ts :: output helpers`

### AC-10 - portability and corruption

Export a versioned evidence bundle and restore/read it in a clean installation with matching hashes; truncated or unsupported exports fail without partial accepted state.

Status: **PASS** (maintainer-run, not independently reviewed). "Clean installation" is exercised for real: the tarball
from `npm pack` is installed into a fresh directory, the bundle is restored in a second, clean directory, and the restored
inputs are re-evaluated with the installed binary.

Core acceptance:

- `tests/proofgate.spec.ts :: AC-10 portability and corruption > exports a versioned bundle and restores it with matching hashes; the restored inputs re-evaluate to the identical report`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > restore output is owner-only (0700 directories, 0600 files)`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > bundle verify reports success without leaving anything behind`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > truncated bundles fail at sampled cut points with no restored state and no temp leftovers (every structural boundary: round2-boundaries.test.ts)`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > a tampered artifact byte (same size) is refused as bundle_corrupt (which layer caught it is pinned in round2-boundaries.test.ts)`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > a damaged trailer checksum, trailing garbage and a corrupted header are all refused`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > unsupported bundle versions fail explicitly (container version and header schema version)`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > a crafted bundle with a traversal or absolute entry path is refused before anything is written`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > a bundle whose report no longer follows from its own inputs is refused even when every hash is internally consistent`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > restore never overwrites an existing target and export never overwrites an existing bundle`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > export refuses inputs that do not reproduce the report`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > export refuses artifacts containing credential-shaped text unless explicitly allowed`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > enforces the bundle size cap with an explicit override`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > bundles are reproducible: the same report and inputs produce byte-identical bundles`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > extensions and adapter provenance survive the round trip verbatim`
- `tests/proofgate.spec.ts :: AC-10 portability and corruption > restoring a missing bundle file is an explicit error`

Packaged binary:

- `tests/e2e/packaged-cli.test.ts :: E2E AC-10 portability and corruption (packaged binary) > exports a versioned bundle and restores it in a second, clean directory with matching hashes; the restored inputs reproduce the report`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-10 portability and corruption (packaged binary) > a truncated bundle fails at sampled cut points with exit 2, no restored state and no partial directory`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-10 portability and corruption (packaged binary) > a tampered byte, a damaged trailer and trailing garbage are refused with bundle_corrupt and leave nothing behind`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-10 portability and corruption (packaged binary) > an unsupported bundle version (container or header schema) is refused with a stable code`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-10 portability and corruption (packaged binary) > a crafted bundle with a traversal entry and a forged verdict is refused before anything is written`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-10 portability and corruption (packaged binary) > restore never overwrites an existing directory and export never overwrites an existing bundle`
- `tests/e2e/packaged-cli.test.ts :: packaged tarball > is a real npm pack tarball with a recorded SHA-256, installed by copy into a directory outside the repository`
- `tests/e2e/packaged-cli.test.ts :: packaged tarball > packs exactly what was built: every installed dist file equals the repository build byte for byte`

Supporting:

- `tests/integration/bundle-internals.test.ts :: bundle export`
- `tests/integration/bundle-internals.test.ts :: bundle header validation`
- `tests/integration/edge-cases.test.ts :: bundle edge cases`

### AC-11 - release documentation and fresh-operator drill

Release documentation includes installation, upgrade, backup, restore and failure diagnosis; a fresh operator can execute the synthetic smoke procedure.

Status: **PENDING_HUMAN_RECEIPT.** AC-11 is Human + E2E and requires a receipt from an independent human non-builder
following the runbook in a fresh sandbox, recording all assistance, step outcomes and a cleanup receipt (PRD section 9).
**No agent may mark it PASS or satisfied, and no acceptance waiver is authorized.** The runbook, the drill sheet and the
automated harness exist; the human drill has not been run.

What exists (documentation half; it does not satisfy the criterion):

- `docs/OPERATIONS.md` (install, upgrade, backup, restore, failure diagnosis with every reason code, retention),
  `docs/RUNBOOK-SMOKE.md` (the smoke procedure), `docs/HUMAN-DRILL.md` (the drill sheet and where to send it),
  `docs/RELEASE.md`, `README.md`.
- `tests/proofgate.spec.ts :: AC index: the PRD 5b flows and the acceptance matrix resolve to real tests > the operator documents exist and cover install, upgrade, backup, restore, failure diagnosis and retention`
- `tests/proofgate.spec.ts :: AC index: the PRD 5b flows and the acceptance matrix resolve to real tests > the failure-diagnosis tables list every stable error code and every decision reason code`
- `tests/proofgate.spec.ts :: AC index: the PRD 5b flows and the acceptance matrix resolve to real tests > the smoke runbook is executable by the harness: every step has an expected result and the manual steps are marked`
- `tests/proofgate.spec.ts :: AC index: the PRD 5b flows and the acceptance matrix resolve to real tests > AC-11 is PENDING_HUMAN_RECEIPT: no agent-run evidence, the automated harness included, may mark it satisfied`

Supplemental evidence only: the automated fresh-directory harness (`scripts/runbook-smoke.mjs`, `npm run smoke:runbook`)
packs the project, checksums the tarball, and executes the runbook's command blocks **verbatim and in order** in an empty
temporary directory, checking each step's exit code and expected text. It is not a human drill and cannot close AC-11:

- `tests/e2e/runbook-harness.test.ts :: runbook harness (supplemental evidence for AC-11, never the human drill) > executes every automatic command block of docs/RUNBOOK-SMOKE.md verbatim in an empty directory and all steps pass`
- `tests/e2e/runbook-harness.test.ts :: runbook harness (supplemental evidence for AC-11, never the human drill) > labels itself supplemental: it is not an independent human drill and AC-11 stays PENDING_HUMAN_RECEIPT`
- `tests/e2e/runbook-harness.test.ts :: runbook harness (supplemental evidence for AC-11, never the human drill) > negative control: a runbook whose expected text is wrong makes the harness fail and name the step`
- `tests/e2e/runbook-harness.test.ts :: runbook harness (supplemental evidence for AC-11, never the human drill) > negative control: a wrong release checksum is caught by the runbook's own verification step`
- `tests/e2e/runbook-harness.test.ts :: runbook harness (supplemental evidence for AC-11, never the human drill) > negative control: a runbook whose command is expected to fail but succeeds is reported`

To close AC-11: an independent human completes the sheet in `docs/HUMAN-DRILL.md` and the release maintainer attaches it here.

## Round-1 remediation tests

Added for the findings of independent review round 1 (`review-round1-ledger.md` maps each finding to its fix commit, its RED proof at
the reviewed tree and its mutation control). They belong to the criteria named in each heading; none changes a status in the summary table.

### Decision engine (P0 zero-test failure, P1 future-dated failure, requirement-level `all_criteria_met`, receipt index): AC-03, AC-04, AC-05

- `tests/unit/round1-decision.test.ts :: L1: a failing receipt with zero tests is a failure, never ignorable evidence > classifies result=fail with total=0 as FAIL (not MISSING)`
- `tests/unit/round1-decision.test.ts :: L1: a failing receipt with zero tests is a failure, never ignorable evidence > a fresh fail/zero-test receipt beside a passing receipt makes the requirement FAIL`
- `tests/unit/round1-decision.test.ts :: L1: a failing receipt with zero tests is a failure, never ignorable evidence > a fresh zero-test result=%s beside a passing receipt keeps the requirement PARTIAL`
- `tests/unit/round1-decision.test.ts :: L1: a failing receipt with zero tests is a failure, never ignorable evidence > controls: a zero-test PASS claim is still ignorable beside real evidence, and alone it is MISSING`
- `tests/unit/round1-decision.test.ts :: L1: a failing receipt with zero tests is a failure, never ignorable evidence > assess turns exit 0 into exit 1 when such a receipt is planted`
- `tests/unit/round1-decision.test.ts :: L2: a future-dated receipt never lets an older pass hide a failure > an older pass plus a future-dated failing receipt is FAIL with receipt_from_future`
- `tests/unit/round1-decision.test.ts :: L2: a future-dated receipt never lets an older pass hide a failure > an older pass plus a future-dated partial receipt is PARTIAL`
- `tests/unit/round1-decision.test.ts :: L2: a future-dated receipt never lets an older pass hide a failure > a lone future-dated failure is FAIL, not MISSING`
- `tests/unit/round1-decision.test.ts :: L2: a future-dated receipt never lets an older pass hide a failure > controls: a future-dated PASS never counts and never blocks; identity mismatches stay rejected`
- `tests/unit/round1-decision.test.ts :: L6: requirement-level all_criteria_met is claimed only by a PASS > a two-repository requirement with one passing and one failing repository does not list all_criteria_met`
- `tests/unit/round1-decision.test.ts :: L6: requirement-level all_criteria_met is claimed only by a PASS > PARTIAL by incomplete coverage does not list all_criteria_met; a full PASS does`
- `tests/unit/round1-decision.test.ts :: P6: receipts are indexed by requirement once > decisions are identical with and without the prebuilt index`
- `tests/unit/round1-decision.test.ts :: through the CLI (exit codes on real files) > a passing workspace is exit 0; planting a fail/zero-test receipt flips it to exit 1`
- `tests/unit/round1-decision.test.ts :: through the CLI (exit codes on real files) > a future-dated failing receipt beside a passing one gives exit 1`

### RunProof importer honours `execution_status` and `exit_code`: AC-06

- `tests/unit/round1-runproof.test.ts :: adaptRunproofDocument honours the run's own execution result > control: a succeeded run with exit code 0 and verified checks passes`
- `tests/unit/round1-runproof.test.ts :: adaptRunproofDocument honours the run's own execution result > execution_status %s with outcome verified is a failure, not a pass`
- `tests/unit/round1-runproof.test.ts :: adaptRunproofDocument honours the run's own execution result > a non-zero exit code (%s) on a run that claims success is a failure`
- `tests/unit/round1-runproof.test.ts :: adaptRunproofDocument honours the run's own execution result > exit code null or absent does not by itself fail a succeeded run`
- `tests/unit/round1-runproof.test.ts :: adaptRunproofDocument honours the run's own execution result > execution_status %s is rejected with runproof_execution_incomplete`
- `tests/unit/round1-runproof.test.ts :: adaptRunproofDocument honours the run's own execution result > a failed run with no required checks is a failure, not a skipped (ignorable) suite`
- `tests/unit/round1-runproof.test.ts :: adaptRunproofDocument honours the run's own execution result > only the latest evaluation's checks count, and earlier evaluations are preserved verbatim`
- `tests/unit/round1-runproof.test.ts :: through the CLI > a succeeded, verified run is accepted (exit 0)`
- `tests/unit/round1-runproof.test.ts :: through the CLI > a failed run that claims verified is not accepted (exit 1), a running run is malformed input (exit 2)`

### Duplicate JSON keys are refused: AC-01, AC-06, AC-09

- `tests/unit/round1-json-duplicates.test.ts :: findDuplicateKey > parseJsonStrict throws a stable error for duplicates, SyntaxError for invalid JSON, and returns the value otherwise`
- `tests/unit/round1-json-duplicates.test.ts :: findDuplicateKey > is linear: a large document with many distinct keys and deep arrays is checked quickly`
- `tests/unit/round1-json-duplicates-cli.test.ts :: duplicate keys are rejected through the CLI (exit 2, json_duplicate_key), never resolved > a receipt {result: fail, result: pass} is refused instead of read as a pass`
- `tests/unit/round1-json-duplicates-cli.test.ts :: duplicate keys are rejected through the CLI (exit 2, json_duplicate_key), never resolved > a duplicate nested inside a receipt's extensions is refused too`
- `tests/unit/round1-json-duplicates-cli.test.ts :: duplicate keys are rejected through the CLI (exit 2, json_duplicate_key), never resolved > a revisions.json that lists a repository's commit twice under one key is refused`
- `tests/unit/round1-json-duplicates-cli.test.ts :: duplicate keys are rejected through the CLI (exit 2, json_duplicate_key), never resolved > a JSON manifest with duplicate keys is refused by the YAML layer (manifest_parse_error)`
- `tests/unit/round1-json-duplicates-cli.test.ts :: duplicate keys are rejected through the CLI (exit 2, json_duplicate_key), never resolved > explain refuses a report.json with a repeated key, even when report.sha256 is absent`
- `tests/unit/round1-json-duplicates-cli.test.ts :: duplicate keys are rejected through the CLI (exit 2, json_duplicate_key), never resolved > a bundle whose header repeats a key is refused before anything is written`

### Hostile and oversize YAML manifests are refused with exit 2: AC-07, AC-09

- `tests/unit/round1-yaml-limits.test.ts :: hostile YAML manifests are refused before the parser can exhaust memory (packaged CLI, 256 MB heap) > %s: exit 2 with a stable code, no abort, in bounded time`
- `tests/unit/round1-yaml-limits.test.ts :: assertYamlWithinBudget and parseManifestText > counts an upper estimate of structure: the budget boundary is exact, and quoted text counts too`
- `tests/unit/round1-yaml-limits.test.ts :: assertYamlWithinBudget and parseManifestText > refuses text over the byte cap before looking at it, counting bytes not characters`
- `tests/unit/round1-yaml-limits.test.ts :: assertYamlWithinBudget and parseManifestText > any alias is refused with an explicit reason; anchors alone are harmless`
- `tests/unit/round1-yaml-limits.test.ts :: assertYamlWithinBudget and parseManifestText > a 1,500-requirement manifest that lists 50 repositories per requirement still parses (documented capacity)`
- `tests/unit/round1-yaml-limits.test.ts :: assertYamlWithinBudget and parseManifestText > the canonical JSON manifest of a bundle is parsed as strict JSON, so its expanded repository lists need no YAML budget`
- `tests/unit/round1-yaml-limits.test.ts :: assertYamlWithinBudget and parseManifestText > a runaway recursion in the parser is a stable manifest_parse_error, not an internal error`
- `tests/unit/round1-yaml-limits.test.ts :: manifest size limits through the in-process CLI > a 5 MB manifest is refused by size before it is read`
- `tests/unit/round1-yaml-limits.test.ts :: manifest size limits through the in-process CLI > the 25 MB metadata limit still applies to receipts and is unaffected by the tighter manifest cap`
- `tests/unit/round1-yaml-limits.test.ts :: bundle round trip of a manifest whose default repository lists expand beyond the YAML budget > restores a bundle of 700 requirements x 40 default repositories (the normalised manifest.json is parsed as JSON)`

### Terminal output neutralisation: AC-07, AC-09

- `tests/unit/round1-terminal.test.ts :: plain-text output of the CLI is neutralised > evaluate: a title with an ESC sequence and a forged verdict line prints one verdict line and no raw control characters`
- `tests/unit/round1-terminal.test.ts :: plain-text output of the CLI is neutralised > explain: title, environment, runner id and deferral reason cannot inject escapes or forge lines`
- `tests/unit/round1-terminal.test.ts :: plain-text output of the CLI is neutralised > explain --json stays valid JSON with the control characters escaped by JSON itself`
- `tests/unit/round1-terminal.test.ts :: plain-text output of the CLI is neutralised > stderr: a file name with ESC and a newline cannot forge a second error line or recolour the terminal`
- `tests/unit/round1-terminal.test.ts :: plain-text output of the CLI is neutralised > stderr: a hostile --now value, unknown command and unknown requirement id are neutralised too`
- `tests/unit/round1-terminal.test.ts :: plain-text output of the CLI is neutralised > control: harmless output is byte-for-byte what it was (no over-escaping of normal ids and titles)`
- `tests/unit/round1-terminal-unit.test.ts :: neutralize > leaves ordinary text, punctuation and non-ASCII letters alone, and bounds very long strings visibly`
- `tests/unit/round1-terminal-unit.test.ts :: escapeJsonForTerminal > escapes bidi, zero-width, C1 and separator characters (astral ones as surrogate pairs) and parses back to the same value`
- `tests/unit/round1-terminal-unit.test.ts :: escapeJsonForTerminal > leaves ordinary text and non-ASCII letters untouched`

### Redaction of keys, file names, boundaries and many more shapes, with bounded cost: AC-09

- `tests/unit/round1-redaction.test.ts :: token boundaries: a credential glued to a word or underscore is still a credential > a token longer than any fixed cap is redacted whole, not just its first 255 characters`
- `tests/unit/round1-redaction.test.ts :: token boundaries: a credential glued to a word or underscore is still a credential > does not eat letters glued in front of a look-alike (a boundary is required before the prefix)`
- `tests/unit/round1-redaction.test.ts :: credential shapes that were unknown > keeps the surrounding text readable (the flag name and the rest of the line survive)`
- `tests/unit/round1-redaction.test.ts :: credential shapes that were unknown > a private key of any length is redacted: PEM over 8,000 characters, PGP blocks, and a header without a footer`
- `tests/unit/round1-redaction.test.ts :: credential shapes that were unknown > text that hides a token with zero-width characters or fullwidth letters is folded and redacted`
- `tests/unit/round1-redaction.test.ts :: credential shapes that were unknown > is idempotent over the whole corpus and never grows a redacted string`
- `tests/unit/round1-redaction.test.ts :: key names > treats %s as sensitive`
- `tests/unit/round1-redaction.test.ts :: key names > does not treat %s as sensitive`
- `tests/unit/round1-redaction.test.ts :: key names > the KEY TEXT is redacted too, and two secret-looking keys do not overwrite each other`
- `tests/unit/round1-redaction.test.ts :: cost is bounded on hostile input > 24 MB of repeated private-key headers is one pass (it was ~600 ms per MB)`
- `tests/unit/round1-redaction.test.ts :: cost is bounded on hostile input > 24 MB of a credential keyword with nothing after it, and 24 MB of name characters, stay linear`
- `tests/unit/round1-redaction.test.ts :: cost is bounded on hostile input > scanBufferForCredentials stops at the first window that shows a credential`
- `tests/unit/round1-redaction.test.ts :: cost is bounded on hostile input > findCredentialPatterns names patterns but never returns the matched text`
- `tests/unit/round1-redaction.test.ts :: file names, extension keys and bundle entries never carry a planted secret > a token in a receipt file name, an extension key or a key with a word prefix does not reach report.json, index.html, the bundle, the restored tree or any output`
- `tests/unit/round1-redaction.test.ts :: file names, extension keys and bundle entries never carry a planted secret > an error that names such a file does not echo the token (packaged binary)`

### `--replace`, clock provenance, report self-consistency, report size ceiling, free space, interrupted runs: AC-04, AC-05, AC-10

- `tests/integration/round1-output-safety.test.ts :: --replace only archives a previous report, and archive names never collide > refuses to move a directory that is not a ProofGate report (no report.json) and leaves it untouched`
- `tests/integration/round1-output-safety.test.ts :: --replace only archives a previous report, and archive names never collide > a second and third --replace with identical inputs and a fixed clock each succeed with distinct archives`
- `tests/integration/round1-output-safety.test.ts :: --replace only archives a previous report, and archive names never collide > an unreadable previous report (report.json present but damaged) is still archived, never deleted`
- `tests/integration/round1-output-safety.test.ts :: the evaluation clock is never invisible > the report records where the clock came from: flag, env or system`
- `tests/integration/round1-output-safety.test.ts :: the evaluation clock is never invisible > warns on stderr when --now or PROOFGATE_NOW freezes the clock, and leaves stdout unchanged`
- `tests/integration/round1-output-safety.test.ts :: the evaluation clock is never invisible > --now with an empty value is an error, never a silent fallback to the system clock; an empty PROOFGATE_NOW is an error too`
- `tests/integration/round1-output-safety.test.ts :: the evaluation clock is never invisible > re-evaluating a bundle does not depend on how the original clock was supplied`
- `tests/integration/round1-output-safety.test.ts :: report.json must be self-consistent and carry its hash > a report edited to say accepted while a mandatory requirement fails is refused by explain and bundle export`
- `tests/integration/round1-output-safety.test.ts :: report.json must be self-consistent and carry its hash > summary counts that do not follow from the decisions are refused too`
- `tests/integration/round1-output-safety.test.ts :: report.json must be self-consistent and carry its hash > a report without report.sha256 is refused (it cannot be shown to be unmodified), by directory and by file path`
- `tests/integration/round1-output-safety.test.ts :: report.json must be self-consistent and carry its hash > control: an honest, untouched report is explained normally`
- `tests/integration/round1-output-safety.test.ts :: report size ceiling (enforced before the HTML page is rendered) > serializeReportWithinLimit refuses a report larger than the limit that the readers accept`
- `tests/integration/round1-output-safety.test.ts :: report size ceiling (enforced before the HTML page is rendered) > an evaluation whose requirements x repositories fan-out makes report.json unreadable fails early, writes nothing and names the reason`
- `tests/integration/round1-output-safety.test.ts :: free space and temporary output > assertFreeSpace refuses an impossible size before anything is written, and passes a tiny one`
- `tests/integration/round1-output-safety.test.ts :: free space and temporary output > isNoSpace recognises ENOSPC and EDQUOT only`
- `tests/integration/round1-output-safety.test.ts :: free space and temporary output > cleanupTempPathsSync removes exactly the tracked in-flight paths`
- `tests/integration/round1-output-safety.test.ts :: free space and temporary output > SIGTERM in the middle of a bundle restore leaves no temporary directory behind and exits 143`

### Case-folded receipt ids, envelope sources, schema timestamp patterns, documents shipped in the package: AC-06, AC-11

- `tests/integration/round1-misc.test.ts :: receipt ids are compared case-insensitively > two receipt documents whose ids differ only in case are refused (exit 2, receipt_duplicate_id)`
- `tests/integration/round1-misc.test.ts :: receipt ids are compared case-insensitively > control: distinct ids are accepted`
- `tests/integration/round1-misc.test.ts :: the event envelope de-duplicates per source > two sources may reuse an event id: neither is a duplicate or a conflict of the other`
- `tests/integration/round1-misc.test.ts :: the event envelope de-duplicates per source > the strict variant names the source in the conflict`
- `tests/integration/round1-misc.test.ts :: the published JSON Schemas carry the UTC timestamp pattern > receipt.json rejects finished_at %s`
- `tests/integration/round1-misc.test.ts :: the published JSON Schemas carry the UTC timestamp pattern > every timestamp field in the published schemas has a pattern`
- `tests/integration/round1-misc.test.ts :: the package ships the documents its README links to > every relative markdown link in README.md points at a file that is in the packed tarball`

### Second wave: metamorphic decision properties (random receipt sets: non-passing receipts never improve a decision, failing and future-dated failing receipts force FAIL, order never matters): AC-03, AC-04, AC-05

- `tests/unit/round2-decision-properties.test.ts :: decision engine properties > P1: adding a matching non-passing receipt never turns a non-PASS into PASS`
- `tests/unit/round2-decision-properties.test.ts :: decision engine properties > P2: a matching fresh failing receipt forces FAIL, alone or beside anything`
- `tests/unit/round2-decision-properties.test.ts :: decision engine properties > P3: a matching non-passing receipt, fresh or future-dated, never leaves the requirement at PASS`
- `tests/unit/round2-decision-properties.test.ts :: decision engine properties > P4: a matching failing receipt dated after now is held as FAIL, never dropped in favour of an older pass`
- `tests/unit/round2-decision-properties.test.ts :: decision engine properties > P5: the order of the receipts never changes the decision`
- `tests/unit/round2-decision-properties.test.ts :: decision engine properties > P6: a zero-test pass proves nothing: alone it is MISSING, beside a set it changes nothing`
- `tests/unit/round2-decision-properties.test.ts :: decision engine properties > the generator really produces every kind of decision (the properties are not vacuous)`

### Second wave: vendor-token, Azure key, Authorization and cookie redaction; every shape also detected by the artifact scanner: AC-09

- `tests/unit/round2-redaction-shapes.test.ts :: credential shapes found by the prober are redacted > %s`
- `tests/unit/round2-redaction-shapes.test.ts :: credential shapes found by the prober are redacted > the same shapes are redacted inside object values and object keys`
- `tests/unit/round2-redaction-shapes.test.ts :: credential shapes found by the prober are redacted > the artifact scanner (bundle export) detects every one of them`
- `tests/unit/round2-redaction-shapes.test.ts :: credential shapes found by the prober are redacted > ordinary text near these shapes is left alone`

### Second wave: one value per option, output separate from inputs, EPIPE and uncaught errors never exit 1, output errors mapped, ignored receipt-like files, symlinked root: AC-01, AC-07, AC-10

- `tests/integration/round2-cli-safety.test.ts :: every option takes exactly one value (no evidence is silently dropped) > --receipts given twice is refused, in either order, even though one of the directories passes`
- `tests/integration/round2-cli-safety.test.ts :: every option takes exactly one value (no evidence is silently dropped) > any repeated option is refused: --now, --output, --manifest, --revisions, --json`
- `tests/integration/round2-cli-safety.test.ts :: every option takes exactly one value (no evidence is silently dropped) > an empty value is refused for every path option`
- `tests/integration/round2-cli-safety.test.ts :: every option takes exactly one value (no evidence is silently dropped) > an empty --now and an empty PROOFGATE_NOW are clock_invalid, never the system clock`
- `tests/integration/round2-cli-safety.test.ts :: every option takes exactly one value (no evidence is silently dropped) > explain options are checked the same way (bundle export, verify and restore: see round4-bundle-flags)`
- `tests/integration/round2-cli-safety.test.ts :: --output may not be, contain or lie inside an input (and --replace never moves the operator's inputs) > refuses the receipts directory itself, with and without --replace`
- `tests/integration/round2-cli-safety.test.ts :: --output may not be, contain or lie inside an input (and --replace never moves the operator's inputs) > refuses a directory inside the receipts directory, and the parent that holds every input, with --replace`
- `tests/integration/round2-cli-safety.test.ts :: --output may not be, contain or lie inside an input (and --replace never moves the operator's inputs) > refuses the manifest and revisions file paths, and a symlinked spelling of the receipts directory`
- `tests/integration/round2-cli-safety.test.ts :: --output may not be, contain or lie inside an input (and --replace never moves the operator's inputs) > refuses the current directory spelled '.', when it holds the inputs`
- `tests/integration/round2-cli-safety.test.ts :: --output may not be, contain or lie inside an input (and --replace never moves the operator's inputs) > control: a sibling directory and a not-yet-existing nested path are fine`
- `tests/integration/round2-cli-safety.test.ts :: --output may not be, contain or lie inside an input (and --replace never moves the operator's inputs) > bundle export refuses to write its file inside the receipts directory or over an input`
- `tests/integration/round2-cli-safety.test.ts :: output failures are output_unwritable, not internal errors > a parent that is a file`
- `tests/integration/round2-cli-safety.test.ts :: output failures are output_unwritable, not internal errors > concurrent restores to one target: exactly one wins and every loser says bundle_target_exists`
- `tests/integration/round2-cli-safety.test.ts :: a receipt-looking file that would not be read is refused (review round 2: it used to be a stderr note) > x.RECEIPT.JSON and x.Receipt.Json are receipt_unreferenced_file (exit 2), naming both files; an exact name is fine`
- `tests/integration/round2-cli-safety.test.ts :: a symlinked receipts ROOT is followed, symlinks under it are refused (documented in docs/INTERFACES.md) > evaluates through a symlinked root directory and still refuses a link inside it`
- `tests/integration/round2-cli-safety.test.ts :: process-level failures never use exit status 1 > a closed stdout does not change the exit code: the verdict is still 0 (accepted) or 1 (unsatisfied), with no stack trace`
- `tests/integration/round2-cli-safety.test.ts :: process-level failures never use exit status 1 > an exception that escapes the command is a one-line internal_error with exit 2, never 1 and never a stack trace`
- `tests/integration/round2-cli-safety.test.ts :: evaluate without --output says that nothing was written > prints a one-line stderr note and still prints the summary`

### Second wave: zero-test fail, partial and skipped at core and packaged level: AC-03

- `tests/proofgate.spec.ts :: AC-03 mock and empty suite controls > zero tests with result fail, partial or skipped is never ignorable: alone and beside a passing receipt (review round 1, P0)`
- `tests/e2e/packaged-cli.test.ts :: E2E AC-03 mock and empty suite controls (packaged binary) > zero tests with result fail, partial or skipped is never ignorable, alone or beside a passing receipt (review round 1, P0)`

## Round-2 remediation tests

Independent re-review of the round-1 fixes (a history commit) found more defects; round 2 (cut from the round-2 review tree) fixes
them. Each test below fails on the round-2 review tree (the RED output is pasted in `review-round1-ledger.md`, section "Re-review wave"),
except the controls each group says so for. These are maintainer tests, not independent receipts.

### A recorded RunProof exit code must be an integer (P1): AC-06, AC-03

- `tests/unit/round3-runproof-exit-code.test.ts :: a recorded exit_code that is not an integer is never read as 'no exit code'`
- `tests/unit/round3-runproof-exit-code.test.ts :: through the CLI: a string exit code is malformed input (exit 2), never ACCEPTED`

### Long secret values are redacted whole, quoted values end at their closing quote, new shapes, folded key names, artifact scanner views: AC-09

- `tests/unit/round3-redaction-shapes.test.ts :: values of any length are consumed whole (P1: only the first 300 characters were redacted)`
- `tests/unit/round3-redaction-shapes.test.ts :: where a value ends`
- `tests/unit/round3-redaction-shapes.test.ts :: credential shapes that were still unknown (P2)`
- `tests/unit/round3-redaction-shapes.test.ts :: key names, including folded spellings (P2)`
- `tests/unit/round3-redaction-shapes.test.ts :: the bundle artifact scanner examines encodings that hide a credential (P2)`
- `tests/unit/round3-redaction-shapes.test.ts :: hidden credentials in strings`
- `tests/unit/round3-redaction-shapes.test.ts :: key redaction is linear (P2: it recomputed redactString(key) inside the collision loop)`

### Hostile-input performance matrix (every pattern shape at 64, 128 and 256 KB, scaling ratio plus a generous ceiling) and the randomized planted-secret property: AC-09, AC-07

- `tests/unit/round3-redaction-scaling.test.ts :: hostile-input matrix: every pattern shape at 1, 2 and 3.5 MiB (linear scaling, generous ceiling) > %s`
- `tests/unit/round3-redaction-scaling.test.ts :: hostile-input matrix: every pattern shape at 1, 2 and 3.5 MiB (linear scaling, generous ceiling) > the artifact scanner and object-key redaction scale the same way on the same shapes`
- `tests/unit/round3-redaction-scaling.test.ts :: property: planted secrets never survive, whatever surrounds or hides them`

### Terminal and page text rewriting without per-character string building: AC-07, AC-09

- `tests/unit/round3-terminal-escape.test.ts :: escapeJsonForTerminal is the old per-character rewrite, faster and in bounded memory`
- `tests/unit/round3-terminal-escape.test.ts :: displayText and neutralize (report page and terminal text)`

### Heap-capped runs of the packaged executable (non-ASCII redaction, `--json`, JSON of millions of tiny containers): AC-09, AC-07

- `tests/integration/round3-hostile-memory.test.ts :: non-ASCII text does not exhaust memory during redaction`
- `tests/integration/round3-hostile-memory.test.ts :: evaluate --json on a large report does not exhaust memory`
- `tests/integration/round3-hostile-memory.test.ts :: a JSON document of millions of tiny containers is refused, not parsed`
- `tests/integration/round3-hostile-memory.test.ts :: control: a normal run under the same heap caps still works` (control, passes on the round-2 review tree)

### Look-alike receipt files refused, output errors mapped in every writer, JSON container budget, values JSON cannot express: AC-01, AC-06, AC-07, AC-10

- `tests/integration/round3-input-refusals.test.ts :: a failing receipt saved under a name that is not read is refused, not ignored`
- `tests/integration/round3-input-refusals.test.ts :: output failures are output_unwritable in every writer` (the restore and evaluate cases pass on the round-2 review tree; EMFILE and ENFILE do not)
- `tests/integration/round3-input-refusals.test.ts :: the JSON container budget`
- `tests/integration/round3-input-refusals.test.ts :: values JSON cannot express are refused with a stable code instead of an internal error`

### Round 3: the executable always runs, strict receipts tree, bundle version and policy messages: AC-01, AC-10, AC-05

- `tests/integration/round4-cli-entry.test.ts :: the executable always runs, however it is started (a failing receipt must give UNSATISFIED, exit 1)`
- `tests/integration/round4-unreferenced-files.test.ts :: every file in the receipts tree is a receipt, a named artifact or an allowed note`
- `tests/integration/round4-bundle-version.test.ts :: a bundle written by another package version`

### Round 3: redaction of glued and escaped prefixes, escaped quotes, idempotency, key segmenting, new forms, oversize strings, window and chunk straddles, round trips, memory shapes: AC-09

- `tests/unit/round4-redaction-fail-open.test.ts :: a token behind a separator, or behind an escape that stands for one, is redacted (every shape)`
- `tests/unit/round4-redaction-fail-open.test.ts :: escaped quotes (JSON inside a JSON string) do not shield a value`
- `tests/unit/round4-redaction-fail-open.test.ts :: a value that merely contains a credential word and ends in a colon is a secret, not the next key (round-2 regression)`
- `tests/unit/round4-redaction-fail-open.test.ts :: redaction is idempotent (a bundle restores by redacting again and comparing)`
- `tests/unit/round4-redaction-fail-open.test.ts :: key names: every non-alphanumeric character separates segments, and strong words inside one segment count`
- `tests/unit/round4-redaction-fail-open.test.ts :: assignments: blanks, line breaks and long names do not hide a value`
- `tests/unit/round4-redaction-fail-open.test.ts :: credential forms that the documents implied but the redactor did not know`
- `tests/unit/round4-redaction-fail-open.test.ts :: oversize strings and keys are redacted whole (the process must not run out of memory)`
- `tests/unit/round4-redaction-boundaries.test.ts :: a secret hidden by zero-width characters straddles a fold chunk boundary at every offset`
- `tests/unit/round4-redaction-boundaries.test.ts :: the artifact scanner finds a secret at every offset around the 1 MiB window boundary`
- `tests/integration/round4-redaction-roundtrip.test.ts :: hostile receipts survive evaluate -> export -> verify -> restore with nothing planted left`
- `tests/integration/round4-redaction-roundtrip.test.ts :: receipt files whose NAMES look like credentials`
- `tests/integration/round4-redaction-memory.test.ts :: hostile redaction shapes at a 256 MB heap end in a verdict, not an abort`

### Round 3: JSON container and value budgets, identifiers, output errors, RunProof __proto__, --replace, repeated bundle flags, minor survivors: AC-01, AC-06, AC-09, AC-10

- `tests/integration/round4-json-budget.test.ts :: the container budget counts objects and arrays alike, at exactly the limit`
- `tests/integration/round4-json-budget.test.ts :: the value budget counts array elements, object members and containers`
- `tests/integration/round4-json-budget.test.ts :: the budget runs before JSON.parse`
- `tests/integration/round4-json-budget.test.ts :: hostile documents under a heap cap end in a refusal, never an abort`
- `tests/integration/round4-logic-p3.test.ts :: P3-1: an identifier that redaction would rewrite is refused, not compared in its redacted form`
- `tests/integration/round4-logic-p3.test.ts :: P3-2: ENOENT and ENOTDIR on an output or temp path are output_unwritable, never a verdict on the bundle`
- `tests/integration/round4-logic-p3.test.ts :: P3-3: a __proto__ key on a RunProof run is refused, never silently dropped`
- `tests/integration/round4-logic-p3.test.ts :: P3-4: --replace only means something with --output`
- `tests/integration/round4-bundle-flags.test.ts :: bundle export: every option is checked for repeats and empty values`
- `tests/integration/round4-bundle-flags.test.ts :: bundle verify and restore: repeated and empty options are refused`
- `tests/integration/round4-minor-survivors.test.ts :: D03: an object key too long to examine is sensitive, in ASCII and in non-ASCII text`
- `tests/integration/round4-minor-survivors.test.ts :: D05 and D14: a JWT segment needs 8 characters, not 7 and not 9`
- `tests/integration/round4-minor-survivors.test.ts :: C04: a closed stderr does not turn a verdict into an internal error`

### Round 3: mutation harness kill rule and documentation pins: AC-05, AC-11, AC-03, AC-06

- `tests/unit/round4-kill-rule.test.ts :: the shared kill rule, against real vitest runs`
- `tests/unit/round4-kill-rule.test.ts :: both harnesses apply the shared rule (a regression to a bare non-zero exit test is caught here)`
- `tests/integration/round4-doc-pins.test.ts :: acceptance statuses that no agent may flip`
- `tests/integration/round4-doc-pins.test.ts :: the redaction documents enumerate what is covered and what is not`
- `tests/integration/round4-doc-pins.test.ts :: limits and refusals that belong to round 3 are documented where an operator looks`

### Round 4: redaction at every JSON nesting depth, object-level fixed point, pair objects, invisible characters, artifact scan: AC-09

- `tests/unit/redaction-depth-generative.test.ts :: every secret, in every template, at JSON nesting depth 0 to 8, is gone and the result is a fixed point`
- `tests/unit/redaction-depth-generative.test.ts :: a value that itself contains a quote, at depth 1 to 3 (conformance F1: 15 of 32 shapes leaked their tail)`
- `tests/unit/redaction-depth-generative.test.ts :: the value ends where its closing quote is (precision: what follows a redacted value is kept)`
- `tests/unit/redaction-depth-generative.test.ts :: mixed depths and ambiguous quote runs fail closed (the value runs on to the end of its line, never less)`
- `tests/unit/redaction-depth-generative.test.ts :: runs of 1 to 127 backslashes before a quote (the round-3 cap was 8)`
- `tests/unit/redaction-object-fixed-point.test.ts :: the reviewers' keys are fixed points at object level`
- `tests/unit/redaction-object-fixed-point.test.ts :: pair objects, tuples and argument lists redact the value by its name`
- `tests/unit/redaction-object-fixed-point.test.ts :: concatenated and compound key names are sensitive`
- `tests/unit/redaction-object-fixed-point.test.ts :: the redaction marker itself is stable`
- `tests/unit/redaction-forms-round4.test.ts :: separators and keywords that were not recognised`
- `tests/unit/redaction-forms-round4.test.ts :: every invisible code point splits nothing`
- `tests/unit/redaction-forms-round4.test.ts :: the artifact scan does not take random binary for a password flag`
- `tests/unit/redaction-forms-round4.test.ts :: Slack token families`
- `tests/unit/redaction-limits-exact.test.ts :: blanks around a separator: 64 are read, 65 are not (documented)`
- `tests/unit/redaction-limits-exact.test.ts :: the size cap: a string or key of exactly 4 MiB is examined, one character more is replaced whole`
- `tests/unit/redaction-limits-exact.test.ts :: the extensions nesting limit: 16 levels are accepted, 17 are refused`
- `tests/unit/redaction-limits-exact.test.ts :: secret or token at the END of a name segment, with or without digits`
- `tests/unit/redaction-limits-exact.test.ts :: compound and concatenated key names that were found unrecognised`
- `tests/integration/redaction-depth-e2e.test.ts :: planted secrets, every template x every secret x depth 0 to 8, never reach any output`
- `tests/integration/redaction-depth-e2e.test.ts :: keys that only become credential-looking after redaction round-trip through a bundle`
- `tests/unit/redaction-classes-round4b.test.ts :: class 1: pairs in every order and shape, as text at depth 0..8`
- `tests/unit/redaction-classes-round4b.test.ts :: class 1: pairs in every order and shape, as objects at depth 0..8`
- `tests/unit/redaction-classes-round4b.test.ts :: class 1: the output keeps the keys and only the value is replaced (exact output at depth 0..8)`
- `tests/unit/redaction-classes-round4b.test.ts :: class 1: the same pairs written with single quotes (a Python repr), at depth 0..8`
- `tests/unit/redaction-classes-round4b.test.ts :: class 1: documented limits of the pair reader`
- `tests/unit/redaction-classes-round4b.test.ts :: class 2: YAML next-line values and list items at depth 0..8 (text inside JSON strings)`
- `tests/unit/redaction-classes-round4b.test.ts :: class 3: percent-encoded separators at layers 0..4`
- `tests/unit/redaction-classes-round4b.test.ts :: class 4: the whole key is tested for credential words`
- `tests/unit/redaction-classes-round4b.test.ts :: class 5: idempotence on short mixed shapes`
- `tests/unit/redaction-classes-round4b.test.ts :: class 6: invisible code points of the newest blocks split no token`
- `tests/unit/redaction-classes-round4b.test.ts :: class 7: an own __proto__ key is data`
- `tests/unit/round3-redaction-scaling.test.ts :: hostile-input matrix: every pattern shape at 1, 2 and 3.5 MiB (linear scaling, generous ceiling)` (20 shapes added for pairs, lists and percent escapes)
- `tests/integration/round4-doc-pins.test.ts :: round 4: the acceptance statuses of the tested tree are stated in the gate evidence, and the new behaviour is documented`

### Round 4: library modules refuse to start as the command, export verifies before publishing, header check, aggregate budget, YAML, RunProof strictness, identifiers: AC-01, AC-06, AC-09, AC-10

- `tests/unit/entry-guard.test.ts :: isStartedAsMain`
- `tests/unit/entry-guard.test.ts :: refuseWhenStartedAsMain`
- `tests/integration/entry-forms.test.ts :: a library module started as the main script refuses, it never exits 0 without evaluating`
- `tests/integration/entry-forms.test.ts :: the documented forms are unchanged, and a library import runs nothing`
- `tests/integration/bundle-export-self-verify.test.ts :: bundle export refuses to publish a bundle that verify would refuse`
- `tests/integration/bundle-header-forgery.test.ts :: the bundle header's revision set must be the report's`
- `tests/integration/limits-and-errors-round4.test.ts :: the JSON budgets cover all receipt documents together`
- `tests/integration/limits-and-errors-round4.test.ts :: a YAML mapping with tens of thousands of keys is parsed in linear time`
- `tests/integration/limits-and-errors-round4.test.ts :: error lines and identifiers`
- `tests/unit/runproof-strictness.test.ts :: a required definition that failed earlier and is absent from the latest evaluation is refused`
- `tests/unit/runproof-strictness.test.ts :: an exit status under another spelling is refused, never read as no exit status`
- `tests/unit/runproof-strictness.test.ts :: a __proto__ key inside a check is refused like the one on the run`
- `tests/unit/identifier-paths.test.ts :: the lists hold every field that is compared or reported as an identifier`
- `tests/unit/identifier-paths.test.ts :: an identifier that cannot even be serialised is a schema error, not an internal error`
- `tests/integration/identifier-runproof.test.ts :: a RunProof wrapper with a credential-looking identifier is refused with the field named`

### Round 4: the kill rule of both mutation harnesses reads the runners' JSON results: AC-05

- `tests/unit/round4-kill-rule.test.ts :: classification of one failure, and of playwright's JSON result`

### Round 5: the redactor that never returned, one quoted-value reader, no leak regression against the earlier redactors, fail-closed anchors and tags, the artifact scan on binary data: AC-09

- `tests/unit/redaction-termination.test.ts :: termination: ordinary text that contains the scanners' own words is returned unchanged, in bounded time`
- `tests/unit/redaction-termination.test.ts :: termination: a property test over ordinary and hostile strings, with a per-call time cap`
- `tests/unit/redaction-termination.test.ts :: termination: the packaged command`
- `tests/unit/redaction-termination.test.ts :: no module-level global or sticky regex is driven across a call that can re-enter the redactor`
- `tests/unit/redaction-quoting-matrix.test.ts :: options and -u, every quoting style, at JSON nesting depth 0 to 8`
- `tests/unit/redaction-quoting-matrix.test.ts :: URL user information: a password that holds an @ or a slash`
- `tests/unit/redaction-quoting-matrix.test.ts :: pairs: any label that names a credential, any value shape, a long distance`
- `tests/unit/redaction-quoting-matrix.test.ts :: Python prefixes, blank and comment lines after a key, percent-encoded backslashes`
- `tests/unit/redaction-quoting-matrix.test.ts :: usage counters and statuses are not credentials, in text and as keys`
- `tests/unit/redaction-quoting-matrix.test.ts :: key names: short and digit-suffixed credential names, with the ambiguous ones listed`
- `tests/unit/redaction-quoting-matrix.test.ts :: the artifact scan: text is scanned in full, binary only for distinctive shapes`
- `tests/unit/redaction-alternatives.test.ts :: multi-line flow lists and block lists with blank or comment lines`
- `tests/unit/redaction-alternatives.test.ts :: escapes that stand for a line break or a blank, in front of and after a key`
- `tests/unit/redaction-alternatives.test.ts :: pair labels: judged as written and as redacted, and of any length`
- `tests/unit/redaction-alternatives.test.ts :: key names that the whole-key and suffix rules must keep finding`
- `tests/unit/redaction-fix5.test.ts :: YAML block scalars and node properties after a credential key, at nesting depth 0 to 8`
- `tests/unit/redaction-fix5.test.ts :: assignment operators next to =`
- `tests/unit/redaction-fix5.test.ts :: options: -p=S and a prefix in front of the name`
- `tests/unit/redaction-fix5.test.ts :: shapes that are NOT redacted (documented in docs/INTERFACES.md, pinned here)`
- `tests/unit/redaction-precision.test.ts :: percent escapes in ordinary text keep their escapes (the decoded copy is only returned when it shows a credential)`
- `tests/unit/redaction-precision.test.ts :: the value of a name/value pair may be an object or an array: every element is replaced, not the first word`
- `tests/unit/redaction-precision.test.ts :: user information: an at sign before the password is not the end of it`
- `tests/unit/redaction-no-regression.test.ts :: no leak regression against the earlier redactors (frozen fixture: ${seed})`
- `tests/unit/redaction-no-regression.test.ts :: precision: anchors, tags and colons beside NON-credential names are left alone`

### Round 5: bundle export verifies beside its output, entry roles and canonical magic, RunProof `status`, manifest keys: AC-01, AC-06, AC-10

- `tests/integration/round5-bundle-checks.test.ts :: bundle export does not need the system temp directory`
- `tests/integration/round5-bundle-checks.test.ts :: a re-sealed bundle cannot change what an entry is, or how the format is spelled`
- `tests/unit/runproof-strictness.test.ts :: an exit status under another spelling is refused, never read as no exit status`
- `tests/unit/runproof-strictness.test.ts :: round 5: the checks are examined at every index, not only the first`
- `tests/unit/round5-manifest-keys.test.ts :: YAML keys that collide as JSON keys are duplicates`

### Round 5: the mutation harnesses check their own targets, the gate caps every step that can hang, the controls table has a row for every mutant: AC-05

- `tests/unit/round5-mutant-targets.test.ts :: the mutant lists match the sources they mutate`
- `tests/unit/round5-mutant-targets.test.ts :: the instrument check goes red on a broken instrument`
- `tests/unit/round5-mutant-targets.test.ts :: both harnesses expose the check on the command line (no build, no tests)`
- `tests/unit/round5-mutant-targets.test.ts :: the quality gate runs the instrument check before the mutation controls, with a negative control`
- `tests/unit/round5-run-with-cap.test.ts :: scripts/run-with-cap.mjs`

### Round 6: the option reader and containers, bracket values, parent and child keys, delimiters and escapes, YAML `#` lines, scheme words, argv, the differentials: AC-09

- `tests/unit/redaction-options-round5.test.ts :: an Authorization option is redacted to the end of its line, whatever its value looks like`
- `tests/unit/redaction-options-round5.test.ts :: a credential option with a Python prefix, a shell $ prefix, a bracket, a brace, a parenthesis or a tag`
- `tests/unit/redaction-options-round5.test.ts :: the assignment step reads {...} and (...) under a credential key as a whole value`
- `tests/unit/redaction-options-round5.test.ts :: what the differential against both earlier redactors found in the option reader`
- `tests/unit/redaction-shapes-round5b.test.ts :: an unquoted value ends at a line break written as text when another NAME= follows`
- `tests/unit/redaction-shapes-round5b.test.ts :: a credential-named parent key, and a word that is another credential's name, do not swallow the quoted value behind them`
- `tests/unit/redaction-shapes-round5b.test.ts :: a block scalar behind an anchor or a tag is redacted with the tag`
- `tests/unit/redaction-shapes-round5b.test.ts :: short credential names that the key-name rule knows are looked for in text as well (one rule for both)`
- `tests/unit/redaction-shapes-round5b.test.ts :: a name/value pair whose name only becomes a credential name once it is redacted`
- `tests/unit/redaction-boundaries-round5.test.ts :: user information: reach, user length, empty password, angle brackets`
- `tests/unit/redaction-boundaries-round5.test.ts :: percent escapes that end or start a value are decoded when a credential shape is present (and only then)`
- `tests/unit/redaction-security-round5.test.ts :: P1: a name that merely starts like a usage counter is a credential name`
- `tests/unit/redaction-security-round5.test.ts :: P1: a value that starts with a bracket is a list only when the bracket closes and stands alone`
- `tests/unit/redaction-security-round5.test.ts :: P2: a credential-named parent hands its credential-named child to the child's own reader`
- `tests/unit/redaction-security-round5.test.ts :: P2: an unquoted value ends where the next NAME= starts, whatever wrote the break`
- `tests/unit/redaction-security-round5.test.ts :: P2: the percent-decoded copy knows the rest of the separators`
- `tests/unit/redaction-security-round5.test.ts :: P2: a credential key with an object or an array value`
- `tests/unit/redaction-security-round5.test.ts :: P2: argv and options that take user:password`
- `tests/unit/redaction-security-round5.test.ts :: P2: a YAML value line that starts with #, >#, or |#`
- `tests/unit/redaction-security-round5.test.ts :: an unquoted scheme word takes the credential behind it`
- `tests/unit/redaction-security-round5.test.ts :: minimal shapes of the differential against both earlier trees`
- `tests/unit/redaction-security-round5.test.ts :: differential families: what an earlier redactor hid, this one hides`
- `tests/unit/redaction-text-newline-options.test.ts :: an option after a line break written as text is read like one after a real line break`
- `tests/unit/redaction-text-newline-options.test.ts :: precision: ordinary command lines gain no hit from a text-written break that a real line break does not give`
- `tests/unit/redaction-unclosed-prefix.test.ts :: a quote that never closes after a Python prefix or a shell $ is a value to the end of its line > the value ends at the end of its line, the next line is its own`
- `tests/unit/redaction-unclosed-prefix.test.ts :: a quote that never closes after a Python prefix or a shell $ is a value to the end of its line > after an option, in a JSON string and with a text-written line break behind it`
- `tests/unit/redaction-unclosed-prefix.test.ts :: a quote that never closes after a Python prefix or a shell $ is a value to the end of its line > a closing quote on a LATER line is not the closing quote of the value (the round-5 redactor hid these too)`
- `tests/unit/redaction-unclosed-prefix.test.ts :: a quote that never closes after a Python prefix or a shell $ is a value to the end of its line > a prefixed string that CLOSES is redacted whatever is glued behind its closing quote (the round-5 redactor hid these; a whitelist of following characters lost them)`
- `tests/unit/redaction-unclosed-prefix.test.ts :: a quote that never closes after a Python prefix or a shell $ is a value to the end of its line > controls: a prefixed string that closes on its line, a plain unclosed quote and a dangling prefix keep their behaviour`
- `tests/unit/redaction-authorization-array.test.ts :: an Authorization key whose array starts on the next line is one value > the value ends at the closing bracket: the lines after it are their own`
- `tests/unit/redaction-authorization-array.test.ts :: an Authorization key whose array starts on the next line is one value > a brace or a parenthesis that starts the value and runs past the line is read whole too`
- `tests/unit/redaction-authorization-array.test.ts :: an Authorization key whose array starts on the next line is one value > a JSON document written as text, an object and an array of objects`
- `tests/unit/redaction-authorization-array.test.ts :: an Authorization key whose array starts on the next line is one value > YAML and environment layouts`
- `tests/unit/redaction-authorization-array.test.ts :: an Authorization key whose array starts on the next line is one value > controls: the one-line array, the block list, the other keys and a scheme on the line keep their behaviour`
- `tests/unit/redaction-authorization-array.test.ts :: an Authorization key whose array starts on the next line is one value > precision: a bracket that is not an Authorization value's array adds no hit, and an unclosed bracket is read like the one of every other key`
- `tests/unit/redaction-linear-escapes.test.ts :: termination: hostile runs of backslashes and escapes end in bounded time at every size`
- `tests/unit/regex-static-audit.test.ts :: no regular expression of src/ backtracks exponentially or retries at every start of a long run > the audit sees the redactor's expressions (a lexer that finds none would pass everything)`
- `tests/unit/regex-static-audit.test.ts :: no regular expression of src/ backtracks exponentially or retries at every start of a long run > every flagged expression stands on the allow-list, and every entry of the list still matches one`
- `tests/unit/regex-static-audit.test.ts :: no regular expression of src/ backtracks exponentially or retries at every start of a long run > the analyser flags the shapes it is meant to flag, and only those`
- `tests/unit/regex-static-audit.test.ts :: no regular expression of src/ backtracks exponentially or retries at every start of a long run > the audit flags every PLANT (the trailing-strip regular expressions of the mutation list put back into src/redact.ts) and flags nothing more on the clean text`
- `tests/unit/regex-static-audit.test.ts :: no regular expression of src/ backtracks exponentially or retries at every start of a long run > the lexer finds literals, string sources and template sources, and skips strings, comments and divisions`
- `tests/unit/redaction-prefixed-values.test.ts :: a prefixed quoted value is redacted whole, whatever its text looks like`
- `tests/unit/redaction-prefixed-values.test.ts :: a prefixed quoted value is redacted whole, whatever its text looks like > the shapes of the reports, exactly`
- `tests/unit/redaction-prefixed-values.test.ts :: a prefixed quoted value is redacted whole, whatever its text looks like > in a JSON document, a command and an option`
- `tests/unit/redaction-prefixed-values.test.ts :: a prefixed quoted value is redacted whole, whatever its text looks like > controls: a label with a word glued behind its closing quote is still not the value, and ordinary prefixed text keeps its shape`
- `tests/unit/redaction-bracket-values.test.ts :: a value that starts with a bracket is read to the end of its token`
- `tests/unit/redaction-bracket-values.test.ts :: a value that starts with a bracket is read to the end of its token > the shapes of the report, exactly`
- `tests/unit/redaction-bracket-values.test.ts :: a value that starts with a bracket is read to the end of its token > a generated password (a fixed seed, printable characters without quotes and blanks) is gone in every context`
- `tests/unit/redaction-bracket-values.test.ts :: a value that starts with a bracket is read to the end of its token > as an object value and as a list element`
- `tests/unit/redaction-bracket-values.test.ts :: a value that starts with a bracket is read to the end of its token > controls: what follows a closed bracket and belongs to the text around it stays`
- `tests/unit/redaction-usage-counters.test.ts :: one shared rule for the usage counters of text and of object keys`
- `tests/unit/redaction-usage-counters.test.ts :: one shared rule for the usage counters of text and of object keys > every retained counter is exempt in BOTH forms`
- `tests/unit/redaction-usage-counters.test.ts :: one shared rule for the usage counters of text and of object keys > the two rules agree on every combination of a credential word and a qualifier (they are one definition)`
- `tests/unit/redaction-usage-counters.test.ts :: one shared rule for the usage counters of text and of object keys > only a WHOLE name is a counter, in both forms: a counter with a word in front of it is hidden (conservative: the round-5 key rule exempted a counter anywhere in a name)`
- `tests/unit/redaction-review6-options.test.ts :: a glued -p is not an option's name`
- `tests/unit/redaction-review6-options.test.ts :: a glued -p is not an option's name > a real glued password is still a glued password`
- `tests/unit/redaction-review6-options.test.ts :: an option after any written line break is read`
- `tests/unit/redaction-review6-options.test.ts :: a YAML block list: an item that ends in a colon does not take the next item`
- `tests/unit/redaction-review6-options.test.ts :: a YAML block list: an item that ends in a colon does not take the next item > both items are values`
- `tests/unit/redaction-review6-options.test.ts :: a YAML block list: an item that ends in a colon does not take the next item > a dangling label still hands its value over when the next line is not a list item`
- `tests/unit/redaction-review6-options.test.ts :: options with brackets`
- `tests/unit/redaction-review6-options.test.ts :: options with brackets > --Authorization= and a bracket that runs past its line`
- `tests/unit/redaction-review6-options.test.ts :: options with brackets > an option value that is a bracket and runs on is the whole word`
- `tests/unit/redaction-work-bound.test.ts :: the cost is linear: the shapes the reviewers named, in a capped child`
- `tests/unit/redaction-work-bound.test.ts :: the cost is linear: the shapes the reviewers named, in a capped child > every opener followed by a run of backslashes or escaped breaks, alone or with a terminator`
- `tests/unit/redaction-work-bound.test.ts :: the artifact scanner is linear too`
- `tests/unit/redaction-work-bound.test.ts :: the work budget fails closed`
- `tests/unit/redaction-work-bound.test.ts :: the work budget fails closed > a limit that is passed hides the WHOLE text, and never shows a part of it`
- `tests/unit/redaction-work-bound.test.ts :: the work budget fails closed > an ordinary text needs a small fraction of the budget (64 steps per character)`
- `tests/unit/redaction-work-bound.test.ts :: the work budget fails closed > the credential scanner reports work-budget-exceeded (an unsafe artifact) when its budget is passed, never nothing found`
- `tests/unit/redaction-space-options.test.ts :: an option's value after a blank is hidden when it reads as a label (the repros of the review)`
- `tests/unit/redaction-space-options.test.ts :: an option's value after a blank is hidden when it reads as a label (the repros of the review) > the three repros`
- `tests/unit/redaction-space-options.test.ts :: an option's value after a blank is hidden when it reads as a label (the repros of the review) > a header option with a key of that shape`
- `tests/unit/redaction-space-options.test.ts :: a short letters-only value that holds a credential word in camel case, given to an option after a blank, is hidden`
- `tests/unit/redaction-space-options.test.ts :: a short letters-only value with a credential word in camel case inside a quoted header is hidden (the closing quote is not the opening of a value)`
- `tests/unit/redaction-space-options.test.ts :: a dangling label that an option's value takes takes its own value too`
- `tests/unit/redaction-space-options.test.ts :: CONTROLS: a genuine name after an option is still left to its own reader`
- `tests/unit/redaction-space-options.test.ts :: CONTROLS: a genuine name after an option is still left to its own reader > the option that stands alone, a flag after it, and a name with a value behind it`
- `tests/unit/redaction-space-options.test.ts :: CONTROLS: a genuine name after an option is still left to its own reader > a value on the next line that ends in a hyphen and a credential word is a value, not a name (it was pinned as readable before)`
- `tests/unit/redaction-space-options.test.ts :: CONTROLS: a genuine name after an option is still left to its own reader > a name with nothing behind it after an option is the option's value (the option reader hands a name over only when a value stands behind it)`
- `tests/unit/redaction-space-options.test.ts :: CONTROLS: a genuine name after an option is still left to its own reader > the forms that were always hidden stay hidden (glued value, assignment, plain word)`
- `tests/integration/redaction-space-options-drill.test.ts :: a key that reads as a label, given to an option after a blank, reaches no output of the built CLI`
- `tests/unit/redaction-nested-hash.test.ts :: a hash line deeper than its credential key is the value, at depth 0 to 3`
- `tests/unit/redaction-nested-hash.test.ts :: a hash line deeper than its credential key is the value, at depth 0 to 3 > the lines below the hash line that are deeper than the key are part of the value too`
- `tests/unit/redaction-nested-hash.test.ts :: a hash line deeper than its credential key is the value, at depth 0 to 3 > a list dash in front of the key and a quoted key count: the key starts where its item starts`
- `tests/unit/redaction-nested-hash.test.ts :: a hash line deeper than its credential key is the value, at depth 0 to 3 > line breaks written as text (inside a JSON string, or percent-encoded) do not hide the value`
- `tests/unit/redaction-nested-hash.test.ts :: CONTROLS: a real comment stays readable where it was, and a key that is not a credential's is left alone`
- `tests/unit/redaction-nested-hash.test.ts :: CONTROLS: a real comment stays readable where it was, and a key that is not a credential's is left alone > a hash line at the key's column or to its left is a comment (the value is what follows it)`
- `tests/unit/redaction-nested-hash.test.ts :: CONTROLS: a real comment stays readable where it was, and a key that is not a credential's is left alone > comments under keys that are not credentials, and before the first key, are untouched`
- `tests/unit/redaction-nested-hash.test.ts :: CONTROLS: a real comment stays readable where it was, and a key that is not a credential's is left alone > the legacy shapes are as they were: a column-0 hash line is a comment, a hash value with nothing indented behind it is the value`
- `tests/unit/redaction-nested-hash.test.ts :: the cost of the rule is linear`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > a bracketed Authorization value that spans lines, with a word glued behind the closing bracket, hides the list and not the word after it`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > a line break written inside a password ends the value: what follows it is read as the next pair`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > an option value that starts with a greater-than sign and is followed by a pair is read as an empty value: S stays`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > a connection string is split at a semicolon and a name: a password that holds one hides only the part in front of it`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > a blank inside an element of a JSON array ends the option value at the blank, and a raw at-sign in user information ends it at the last one in front of another stop character`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > garbled label chains that the tree before the final review hid and this one leaves (found by the final differential; the reviewed round-5 tree leaves them too): the secret is the value of a second name`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > a truncated percent escape behind a long option name is not a glued secret any more: nothing follows it, nothing is hidden`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > random printable passwords that hold a break and then a name and an equals sign show their tail (three in 120,000; 847 more were hidden than before)`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > two random printable passwords of the connection-string class show their tail after a comma, a semicolon and a name (an earlier redactor hid them whole)`
- `tests/unit/redaction-known-limits-final.test.ts :: KNOWN LIMITS (final review): shapes that stay readable, pinned to today's output > a glued -p with a quoted value shows it, and the dotted usage counters differ between text and object keys`
- `tests/unit/redaction-long-run-family.test.ts :: one opener, one long run of one escape unit, one tail (every opener by nine units by five tails by four lengths), in a capped child`
- `tests/unit/redaction-long-run-family.test.ts :: growth of the shapes of the later rules, 16 Ki to 256 Ki characters, in a capped child`
- `tests/unit/redaction-long-run-family.test.ts :: the largest examined text (4 MB) ends, and the cost grows with the input, in a capped child`
- `tests/integration/bundle-export-hostile-artifact.test.ts :: bundle export over a 256 KiB artifact of a hostile shape ends, through the real command`
- `tests/integration/bundle-export-hostile-artifact.test.ts :: bundle export over a 256 KiB artifact of a hostile shape ends, through the real command > the review's shape at 1 MiB and at 4,000,000 bytes (next to the 4 MiB string cap) is refused too`
- `tests/integration/bundle-export-hostile-artifact.test.ts :: bundle export over a 256 KiB artifact of a hostile shape ends, through the real command > CONTROL: an ordinary artifact of 256 KiB, 1 MiB and 4,000,000 bytes is exported`
- `tests/integration/bundle-export-hostile-artifact.test.ts :: bundle export over a 256 KiB artifact of a hostile shape ends, through the real command > a 256 KiB artifact that holds a real credential is refused, whatever hostile run surrounds it, and the credential is not echoed`
- `tests/e2e/packaged-hostile-artifact.test.ts :: E2E AC-09 the artifact scan of the packaged bundle export ends and fails closed on a hostile artifact`
- Supporting unit tests that no criterion names but that the decision and the report rest on (canonical JSON, which every hash is computed over, and the report page's colour contrast): `tests/unit/canonical.test.ts :: canonical JSON v1`, `tests/unit/report-render-style.test.ts :: contrast (WCAG AA, 4.5:1 for text)`
- `tests/unit/redaction-no-regression-reviewed.test.ts :: no leak regression against the redactor that the round-5 reviewers reviewed (frozen fixture: reviewed tree)`

### Round 6: the kill rule, the capped run and its scratch runs, the cap wrapper's signals, the instrument check of a normal run: AC-05

- `tests/unit/round4-kill-rule.test.ts :: a test file that fails with no test in it, and the process group of a capped run (round 5, tests reviewer)`
- `tests/unit/round4-kill-rule.test.ts :: the shared kill rule, against real vitest runs`
- `tests/unit/round4-kill-rule.test.ts :: classification of one failure, and of playwright's JSON result`
- `tests/unit/round4-kill-rule.test.ts :: the classifier on CAPTURED failures of real runs (round 6: 39 vitest 5.0.2 and 21 Playwright 1.63.0 probes)`
- `tests/unit/round5-run-with-cap.test.ts :: scripts/run-with-cap.mjs > interrupting the wrapper stops the command and everything it started (no orphan)`
- `tests/unit/round5-mutant-targets.test.ts :: a normal run of a harness checks its targets first, before any baseline or mutant`

## Negative controls (the suites can go red)

See `docs/qa/negative-controls.md`. In short: `npm run mutation-controls` (388 seeded defects against the unit, integration and
acceptance suite), `npm run e2e-mutation-controls` (10 seeded defects against the packaged-binary suite and the browser smoke,
each run against a tarball packed from the mutated copy), the seeded planted-failure controls inside the tests
(`AC-05 ... (seeded negative control)`, in the core suite and through the packaged binary), the observer controls for the
browser smoke, and `tests/integration/hygiene-scan.test.ts` for the secret and content scan.
