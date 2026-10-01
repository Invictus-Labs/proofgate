# Gate evidence (rounds 1 to 6; the newest tree is described first)

## Rounds 3 to 6: no gate result is recorded yet

**No gate result is recorded for the round-3 tree or for the round-4 tree.** Every earlier review round found defects
that invalidated the gates of the tree it reviewed, so the full gates (the host gate `bash scripts/verify-quality.sh`, the same
gate in a Node 22.12 container, and the Docker smoke) are run once, on the final commit, after independent review has converged, and
their UTC start, end and exit lines are recorded here then. Until they are, no number in this file describes those trees.

**Acceptance status of the tested tree** (a gate result cannot change it): **AC-03 PARTIAL** until the zero-test and future-dated
evidence fixes are independently confirmed; **AC-06 PARTIAL** (the RunProof importer is verified against a labelled synthetic
fixture only; the upstream half is blocked and an owner decision is pending); **AC-11 PENDING_HUMAN_RECEIPT** (it needs a run of the
smoke runbook by an independent human). No criterion is waived.

What has been run on the round-3 and round-4 trees by the maintainer, at unit and targeted level only (no full suite, no full
mutation run, no packaged E2E, no browser smoke, no container, no Docker smoke): the targeted mutant runs listed in
`negative-controls.md`, the red-before runs of the new tests against an extract of the reviewed commit and their green runs on
the fix (counts in `review-round1-ledger.md`, "Round 3" and "Round 4"), the hygiene scan, and the content sanitiser. The round-3
maintainer runs (a full main-suite run with coverage, 1,794 tests, exit 0, at a history commit) are maintainer evidence for that
commit only.

Round 5 (the tree that follows the round-4 reviews): **no gate result is recorded for it either.** A regression run of the whole main suite
without coverage, through `scripts/run-with-cap.mjs`, at the end of round 5 (78 test files, 2,720 tests,
2,720 passed, 0 failed, exit 0, `--maxWorkers=2`) is maintainer evidence for that commit; the later commits changed only this document and the spelling
of literals in two test files and the two fixtures (the touched tests were run again: 145 of 145). **AC-09 is now PARTIAL** (see the matrix).
The per-file coverage floors have not been re-measured on this tree, and the full mutation run, the packaged end-to-end run, the browser
smoke, both gates and the Docker smoke have not been run.

Round 6 (the tree that follows the round-5 reviews): **no gate result is recorded for it either** (no `bash scripts/verify-quality.sh`, no container run, no Docker smoke, no full mutation run, no packaged end-to-end run, no browser smoke).
What exists is maintainer evidence, and it is stated for the commit it was made at. An earlier run of the main suite (82 test files, 3,102 tests, one failure: a timing ratio of the scaling matrix on a host with a load average above 18) was made at an intermediate tree that no longer exists;
it was followed by changes to the redactor, to three test files and to the fixtures, so it describes nothing that is shipped and is not counted. The run that counts was made at the commit that holds the review fixes of round 6 (the work budget, the memoised scans, the shared counter rule, the prefixed and
bracket-led values, the option names): the whole main suite WITH coverage through `scripts/run-with-cap.mjs` (`vitest run --coverage`: 93 test files including `tests/proofgate.spec.ts` and the integration files, 3,372 tests, 3,372 passed, 0 failed, exit 0, every per-file floor
met: all files 98.7% statements, 97.24% branches, 99.23% functions, 99.63% lines; `src/redact.ts` 98.74%, 97.33%, 98.98%, 99.79%). The commits after it change documents only (the tests that read the documents were run again after them, and the AC index reconciliation and the vocabulary pins are among them).
The timing cases of that suite (the scaling matrix and the growth assertion of the depth matrix) measure the CPU time of the process, not wall time, so a busy host does not fail them: the host load average was above 290 during the round-6 work, and before that change two of them failed at random shapes under it.
The FINAL run of the main suite of round 6 was made at the tree that holds all the fixes described in the ledger (the nested hash line, the artifact scan's work limit, the repaired kill rule, the packed export tests): the whole main suite WITH coverage through `scripts/run-with-cap.mjs` (`vitest run --coverage --maxWorkers=2`, under `nice`: 97 test files, 3,628 tests, 3,628 passed, 0 failed, exit 0; all files 98.72% statements, 97.29% branches, 99.49% functions, 99.59% lines; `src/redact.ts` 98.78%, 97.42%, 100%, 99.7%; the floors of 90% lines and branches are met). The commits after it change documents only. The packed-binary plants E08 to E10 were run through the end-to-end harness on their own (a selection: all three killed by assertion); the packaged end-to-end run as a whole, the browser smoke and both gates were not run.
The mutation controls were run one mutant at a time against the test files that target them (390 in the main list; the instrument check reports 0 problems in both harnesses); the full mutation run, the packaged end-to-end run, the browser smoke, both gates and the Docker smoke have not been run. **AC-09 stays PARTIAL.**

Limits of the evidence: one maintainer, one host (macOS arm64, Node 25.8.2 with Node 22.12 in a container for two measurements),
the human drill for AC-11 not done, redaction best effort, and no independent receipt for these trees.

## Round 2: gates run at the round-2 tree (history: an earlier tree)

The commit that records these results was made in round 2 and is not an ancestor of the later rounds' trees, which were cut from the round-1 tree and change source, tests and scripts: **this table describes the round-2 tree, not the current tree.** The round-2 line was cut from the round-2 review tree, whose full gates had never been run. **Tested tree:
the round-2 tree**: every run below started from it with a clean working tree (`git status` empty) and
no code was changed while a gate ran. The commit that records these results follows it and changes only `docs/qa/`. The sections
further down are the gates of the earlier tree, the round-1 tree, in round 1; **they do not describe the round-2 fixes**.
All of this is maintainer evidence; none of it is an independent review or QA receipt. The full logs of the three runs are
not part of the repository.

| Run | UTC start to end | Result |
| --- | --- | --- |
| Host gate `bash scripts/verify-quality.sh`, macOS arm64, Node v25.8.2, npm 11.11.1, run in the background with a log file | 2026-09-29T14:24:09Z to 15:01:29Z | `GATE_EXIT=0`, all 12 steps PASS: install check, typecheck, build, tests with coverage (1,102 passed; statements 97.66%, branches 96.29%, functions 97.47%, lines 98.79%), **all 101 mutants killed** (1,894 s, each by a failing test), all 7 end-to-end mutants killed (261 s), schema drift, demo fixtures, dependency licenses, hygiene, packaged E2E and runbook harness (76 passed, tarball SHA-256 `ff363145bf8972a2c9410240d765d14d54d3a1094c487ea936d4003b576d8f23`), browser smoke (28 passed) |
| The same gate on the supported floor in a throwaway container: image `node:22.12-bookworm-slim@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213` (the Dockerfile's pinned base), Node v22.12.0, npm 10.9.0, Linux aarch64, on a clean `git archive` of the tested tree (a scratch `git init` for the hygiene scan), `npm ci` and `npx playwright install --with-deps chromium` first | 2026-09-29T15:02:43Z to 16:10:36Z | `GATE_EXIT=0` (inner gate exit 0), all 12 steps PASS: 1,099 passed and 3 skipped (the two `chmod`-based unwritable-directory tests skip when the user is root, and the macOS-only sandbox test), **all 101 mutants killed** (3,536 s), all 7 end-to-end mutants killed (408 s), packaged E2E 75 passed and 1 skipped (tarball SHA-256 `ee68b826c2d67ee55321be1ae3ed40b3c548efcf6a74fec69f20d619488ddaa0`, a different npm version so a different archive), browser smoke 28 passed in Linux Chromium; the same coverage figures |
| `bash scripts/docker-smoke.sh proofgate:smoke` (Docker 29.8.0, host arm64) from the clean tested tree | 2026-09-29T16:10:58Z to 16:11:38Z | `GATE_EXIT=0`, "docker smoke: PASS", 10 of 10 checks (network disabled, unprivileged user, tampered artifact and duplicate id exit 2, bundle export/verify/restore/reproduce, truncated bundle refused and nothing restored) |

The two gates were run one at a time on a host whose load average was above 100 (other jobs share it), which is why the container
mutation run took about twice as long as the host run. Before them, at unit level: `npx vitest run tests/unit tests/integration
tests/proofgate.spec.ts` (41 files, 1,102 tests, 2026-09-29T14:16:46Z to 14:17:28Z), the targeted mutant checks in
`negative-controls.md`, and the RED runs at a clean extract of the round-2 review tree pasted in `review-round1-ledger.md`.

Limits of this evidence: one maintainer, two hosts (both arm64, no x86_64 run), the human drill for AC-11 not done, AC-03 and
AC-06 still PARTIAL, redaction still best effort, and no independent review or QA of this branch yet.

## Round 1 (the round-1 tree)

Maintainer evidence recorded by the author of the fixes. **Nothing here is an independent review or QA receipt**;
an independent reviewer must re-run the gate and the RED commands in `review-round1-ledger.md`. Timestamps are from the system
clock (`date -u`), not estimated. The branch was created from the MVP integration line at the reviewed tree,
which was left unchanged.

**Tested tree: the round-1 tree**, the tree that every run below started from with a clean working
tree (the gate header prints it). Everything after it on the branch is documentation under `docs/qa/` (this file, the run
table and the added test ids in `ac-matrix.md`, and the mutant table in `negative-controls.md`); no source, test, script,
fixture or package file changes.

## 1. Full local gate on the host (Node 25), at the tested tree

Command: `bash scripts/verify-quality.sh` (run in the background, exit status logged, `GATE_EXIT=0`). Exit code **0**, all 12
steps PASS. Started 2026-09-29T10:30:33Z, finished 2026-09-29T10:45:41Z. macOS (Darwin arm64), Node v25.8.2, npm 11.11.1.
Packed tarball `proofgate-0.1.0.tgz`, SHA-256 `715ec745d6de8895ae0b0188cfc867fc70b8a01c3a241ba1e7715b873e38d104`.

| Step | Result | Detail |
| --- | --- | --- |
| install check | PASS | Node floor, lockfile in step with `package.json`, installed tree complete |
| typecheck | PASS | strict TypeScript over sources and tests |
| build | PASS | |
| tests with coverage thresholds | PASS | 779 passed, 0 failed; statements 97.13%, branches 95.69%, functions 98.21%, lines 97.83% (thresholds 90% each) |
| mutation controls | PASS | baseline green; **all 55 mutants killed** (17 before round 1, 38 added: `negative-controls.md`) |
| end-to-end mutation controls | PASS | both baselines green; all 7 mutants killed |
| schema drift check | PASS | |
| demo fixtures are current | PASS | |
| dependency license check | PASS | 105 packages, 0 disallowed |
| secret and content hygiene scan | PASS | 16 rules, 187 files |
| packaged-executable E2E + runbook harness | PASS | 75 passed, 0 skipped: tarball packed with `npm pack`, installed into a fresh directory outside the repository |
| browser smoke | PASS | 28 passed in real Chromium from `file://`, 375 px and 1440 px |

Step durations: tests 14 s, mutation controls 620 s, end-to-end mutation controls 240 s, packaged E2E 22 s, browser smoke 7 s.

## 2. Full local gate on the supported Node floor (Node 22.12, Linux)

The same `bash scripts/verify-quality.sh` inside a throwaway `node:22.12` container (`docker run --rm`), on a clean
`git archive` of the tested tree (a scratch `git init` inside the container lets the hygiene scan list files). `npm ci` and
`npx playwright install --with-deps chromium` ran first. Started 2026-09-29T10:47:33Z, finished 2026-09-29T11:07:16Z.
Node v22.12.0, npm 10.9.0, Linux aarch64. Gate exit code **0**, all 12 steps PASS.

| Step | Result | Detail |
| --- | --- | --- |
| tests with coverage thresholds | PASS | 778 passed, **1 skipped**, 0 failed |
| mutation controls | PASS | all 55 mutants killed (654 s) |
| end-to-end mutation controls | PASS | all 7 mutants killed (363 s) |
| packaged-executable E2E + runbook harness | PASS | 74 passed, **1 skipped**, 0 failed; tarball SHA-256 `56ca6054ce42f8489b9d1bf3476a8cc6e795bdf9de33181215193eb862a852ae` (a different npm version than on the host, so a different archive) |
| browser smoke | PASS | 28 passed in Linux Chromium |
| every other step | PASS | install check, typecheck, build, schema drift, demo fixtures, dependency licenses, hygiene |

The two skips are the same check in two suites, the macOS-only run inside `sandbox-exec` (there is no `/usr/bin/sandbox-exec`
on Linux); on Linux the in-process and preload network-denial tests ran and passed, and the Docker runs below use `--network none`.

## 3. Docker image build and synthetic smoke

- Build of the repository Dockerfile at the tested tree (clean tree), 2026-09-29T10:46:22Z to 10:47:31Z: build exit 0, image size
  361,536,775 bytes, user `node`, entrypoint `proofgate`. Run with `--network none`: `--version` prints `0.1.0`; the happy
  path exits 0, the planted-problems fixture exits 1, the tampered artifact exits 2; inside one container the report,
  bundle export, verify, restore and re-evaluation work and give the same `assessment_id`, and a truncated bundle is refused
  with exit 2 and nothing restored. The base image is now pinned by digest
  (`node:22.12-bookworm-slim@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213`).
- `bash scripts/docker-smoke.sh` (Docker 29.8.0, host arm64), 2026-09-29T11:07:36Z to 11:07:53Z: exit 0, 10 of 10 checks
  passed, unprivileged user. It builds from the working tree, which at that moment was the tested tree plus the uncommitted
  `docs/qa/` edits described above (the image copies `docs/`), so that image's documentation differs from the tested tree
  and nothing else does.

## 4. Hostile-YAML regression in containers (round-1 item 4)

`node:22.12`, `--cpus=2 --memory=4g --network none`, the real CLI on generated manifests, at `--max-old-space-size` 128 MB,
256 MB and Node's default: every hostile shape (3 MB of `[`, a 24 MB block sequence, a 24 MB flow sequence, an alias
expansion) was refused with exit 2 and a stable code in 120 to 220 ms, and the reviewed tree aborted with a V8
out-of-memory error (SIGABRT) after 16 s and 28 s on the first two shapes. The full table is in `review-round1-ledger.md`.
A legitimate manifest at the node budget needs roughly 150 to 190 MB of heap (128 MB was not enough).

## 5. Benchmark in the 2 CPU / 4 GB container

`docs/BENCHMARK.md`: three rounds of five timings per shape, min/median/max, including fan-out shapes, and the two large
outliers observed while another container was busy. Recorded 2026-09-29T10:07Z to 10:12Z.

## 6. Automated runbook harness (supplemental evidence for AC-11, NOT the human drill)

`node scripts/runbook-smoke.mjs`, 2026-09-29T11:07Z on the host: exit 0, 16 of 16 automatic steps passed, 2 manual steps not
executed by the harness. The runbook was also executed by the harness inside both packaged-E2E steps above.
**AC-11 remains PENDING_HUMAN_RECEIPT**: only a completed `docs/HUMAN-DRILL.md` sheet from an independent human can close it.

## 7. Static checks on the outgoing content

- The content sanitiser (`--scope public`) over every changed `.md`, `.ts`, `.json` file and `sec-scan` over the repository ran
  after the last commit; `sec-scan`'s sensitivity is unproven, so a clean result is not evidence that no secret exists.
- `scripts/hygiene-scan.mjs` (16 rules, including invisible or bidirectional control characters and internal ticket
  references) is a gate step and was clean at the tested tree.

## 8. Deviations and disclosures

- The first full host gate on this branch, at a history commit, **failed three steps** and is not counted as evidence. Causes, all
  in the test and script layers and none in product code: (1) the mutation control M10 targeted a source line that the
  redaction rewrite had removed (retargeted, and the control bites: 58 failing tests); (2) the packaged-binary E2E suite (a
  separate vitest configuration that I had not re-run after the CLI change) expected the error line to be the first line of
  stderr, but `--now` now prints a one-line note first; expected the runbook's requirement columns to keep single spaces,
  which are now aligned; and expected `--now` and `PROOFGATE_NOW` to produce byte-identical reports, although `clock_source`
  now differs (`flag` versus `env`); (3) the end-to-end mutation controls refuse to run when their baseline is red, which
  followed from (2). The expectations were updated in the round-1 tree. The final gate ran 12 of 12 PASS on both
  platforms.
- Behaviour changes a consumer must know about: policy engine version 2 changes every `policy_hash`; reports gain
  `clock_source`; `--now` prints a stderr note; error codes `limit_manifest_size`, `json_duplicate_key` and
  `runproof_execution_incomplete` are new and `manifest_invalid_commit_sha` (never raised) is gone. All are in `CHANGELOG.md`.
- The benchmark's largest single timings (50.6 s and 15.8 s) exceed the 30 s reference; they happened during contention
  from another container and are reported as observed in `docs/BENCHMARK.md`, not averaged away.
