# Negative controls

A green test suite proves little unless it can also go red. ProofGate uses three kinds of control.

## 1. Seeded negative control in the acceptance tests

`tests/proofgate.spec.ts :: AC-05 negative control and report reconciliation`

- `a planted mandatory failure changes exit 0 to exit 1 (seeded negative control)`: a fully green two-requirement
  workspace exits 0; the only change is one extra mandatory requirement with no evidence, and the same command exits 1.
- `a planted FAIL receipt (not just a missing one) also flips exit 0 to exit 1`.

## 2. Positive controls inside the tests

Tests that would pass for the wrong reason carry a twin that proves the cause:

- `AC-02 ... the same receipt satisfies commit A (control: the mismatch, not the receipt, was the cause)`.
- `AC-03 ... a mocked receipt satisfies only a requirement that explicitly allows mocked evidence (control)`.
- `AC-08 ... the denial harness really blocks: a fetch and a socket attempt under it are refused and recorded (control)`,
  and the macOS sandbox test first proves the sandbox denies a TCP connection before trusting a "completed offline" result.
- `AC-09 ... enforces the 1,000-entry limit` also asserts that a directory below the limit is accepted.

## 3. Mutation-style controls (`npm run mutation-controls`)

`scripts/mutation-controls.mjs` copies the repository to a scratch directory, applies **one** deliberate defect (an exact,
single-occurrence text replacement; the script fails if the target text is not found exactly once), runs the whole suite and
requires it to fail. It first runs the unmutated copy and requires it to be green, so a red result is attributable to the
mutation and not to the harness.

How to verify a control bites: run `npm run mutation-controls`; each line is `KILLED` (suite red, count of failing tests
shown) or `SURVIVED` (the tests cannot detect that defect). The script exits non-zero if any mutant survives.

Result recorded on the final tree of this stage (see the stage report for the exact run): baseline green with 0 failing
tests; all 17 mutants KILLED at the core stage (M17 added at the MVP stage). M18 to M55 were added in round 1 for the round-1
review findings (see `review-round1-ledger.md`); on the tested tree of that branch all 55 mutants were KILLED. The counts in the
table are the failing tests of that run, so they change when tests are added.

| ID | Defect injected | Acceptance criterion protected | Failing tests when injected |
| --- | --- | --- | --- |
| M01 | commit SHA comparison removed | AC-02 | 11 |
| M02 | artifact hash verification removed | AC-01 | 4 |
| M03 | staleness boundary `>=` relaxed to `>` | AC-04 | 8 |
| M04 | DEFERRED counted as a pass | AC-05 | 3 |
| M05 | mocked/synthetic execution kind allowed | AC-03 | 8 |
| M06 | symlink rejection removed from the tree scan | AC-07 | 3 |
| M07 | zero tests no longer MISSING | AC-03 | 7 |
| M08 | skipped/partial results allowed to pass | AC-03 | 9 |
| M09 | path traversal check removed | AC-07 | 7 |
| M10 | secret redaction disabled | AC-09 | 58 |
| M11 | multi-repository gate satisfied by any one repository | AC-02 | 14 |
| M12 | bundle re-evaluation check removed | AC-10 | 2 |
| M13 | verdict always accepted | AC-05 | 38 |
| M14 | environment match ignored | AC-03 | 4 |
| M15 | truncation check removed from bundle restore | AC-10 | 1 |
| M16 | unsupported schema version accepted | AC-06 | 8 |
| M17 | reason-code lookup resolves inherited object members (`constructor`, `__proto__`) | AC-05 (`explain`) | 10 |
| M18 | failing zero-test receipt downgraded to MISSING again | round 1 (L1, AC-03/AC-05) | 6 |
| M19 | future-dated failing receipt ignored again | round 1 (L2, AC-04/AC-05) | 4 |
| M20 | requirement-level all_criteria_met claimed by non-PASS requirements | round 1 (L6) | 3 |
| M21 | RunProof failed execution or non-zero exit code ignored | round 1 (L3, AC-06) | 7 |
| M22 | RunProof running/missing execution accepted as evidence | round 1 (L3, AC-06) | 3 |
| M23 | duplicate JSON keys accepted in receipts | round 1 (S7) | 2 |
| M24 | duplicate-key detector never reports | round 1 (S7) | 15 |
| M25 | duplicate JSON keys accepted in revisions.json | round 1 (S7) | 1 |
| M26 | duplicate JSON keys accepted in report.json | round 1 (S7) | 1 |
| M27 | duplicate JSON keys accepted in the bundle header | round 1 (S7) | 1 |
| M28 | YAML manifest byte cap removed | round 1 (S1/P1) | 2 |
| M29 | YAML structure budget removed | round 1 (S1/P1) | 5 |
| M30 | YAML aliases allowed again | round 1 (S1) | 1 |
| M31 | restored bundle without receipts left without a receipts directory | round 1 (round 1) | 1 |
| M32 | bundle manifest parsed as YAML under the YAML budget | round 1 (S1) | 1 |
| M33 | explain prints untrusted text raw | round 1 (S2) | 2 |
| M34 | error messages printed to the terminal without neutralising | round 1 (S2) | 3 |
| M35 | evaluate summary prints the title raw | round 1 (S2) | 2 |
| M36 | --json output leaves bidi and C1 characters raw | round 1 (S2) | 3 |
| M37 | --replace moves any existing directory | round 1 (P2) | 1 |
| M38 | archive names can collide again | round 1 (P2) | 2 |
| M39 | empty --now falls back to the system clock | round 1 (P2) | 1 |
| M40 | no stderr note when the clock is frozen | round 1 (P2) | 1 |
| M41 | report.json read without checking it against its own decisions | round 1 (P2) | 2 |
| M42 | report.sha256 no longer required | round 1 (P2) | 2 |
| M43 | report size ceiling removed | round 1 (P2) | 2 |
| M44 | free-space preflight removed | round 1 (P2) | 1 |
| M45 | interrupted runs leave temporary output behind | round 1 (P2) | 1 |
| M46 | object key text not redacted | round 1 (S3) | 2 |
| M47 | token boundary back to \b so TOKEN_ghp_... slips through | round 1 (S3) | 6 |
| M48 | private-key blocks over 8,000 characters swallow the text after them | round 1 (S3) | 1 |
| M49 | quoted JSON key not recognised as an assignment | round 1 (S3) | 4 |
| M50 | zero-width / fullwidth folding removed | round 1 (S3) | 2 |
| M51 | artifact scan no longer stops at the first hit | round 1 (P2) | 3 |
| M52 | PGP private-key blocks not recognised | round 1 (S3) | 2 |
| M53 | receipt file names not redacted in report and bundle paths | round 1 (S3) | 1 |
| M54 | lowercase pass key not sensitive | round 1 (S3) | 1 |
| M55 | redacted keys may collapse and overwrite each other | round 1 (S3) | 1 |

**M56 to M77** (second wave of round 1: option handling, output safety, EPIPE, mapped output errors, the tests-reviewer survivors; M66 has its
own row further down) are listed here so that every mutant of the harness has a row. They were killed in the full mutation run of the
round-2 gate (101 of 101, see `gate-evidence.md`); per-mutant failing-test counts were not tabulated then.

| ID | Defect injected | Finding | Evidence |
| --- | --- | --- | --- |
| M56 | Twilio API keys no longer recognised | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M57 | unquoted Authorization value stops at its first quote again (Digest parameters leak) | round 1, second wave | 2 (`the redaction unit files`) |
| M58 | Azure AccountKey / shared access signature not treated as credential names | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M59 | AWS key id glued to a letter slips through again | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M60 | an option given twice is accepted again: the last value silently wins | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M61 | empty path option values accepted | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M62 | --output may overlap an input (--replace can move the operator's inputs) | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M63 | stdout EPIPE is an uncaught exception again (exit status 1 by accident) | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M64 | uncaught exceptions escape as status 1 with a stack trace | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M65 | output errno codes not mapped to output_unwritable | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M67 | an empty PROOFGATE_NOW selects the system clock | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M68 | a losing parallel restore is reported as a corrupt bundle | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M69 | no note when --output is omitted | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M70 | the per-entry hash of a bundle is not checked (only the whole-file checksum) | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M71 | the blob cap is off by one: exactly the cap fails | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M72 | environment names compared case-insensitively | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M73 | assess accepts a report with no mandatory requirement | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M74 | a URL as an artifact path loses its own refusal | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M75 | manifest and revisions no longer count together against the metadata limit | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M76 | a finished temporary report is left behind when no archive name is free | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |
| M77 | confined files opened without O_NOFOLLOW (a symlink swapped in after the lstat check is followed) | round 1, second wave | killed in the round-2 gate run at the round-2 tree (101 of 101 mutants; the per-mutant counts are in that run's output) |

**M78 to M101 and the retargeted M36, M46, M50, M51, M54, M55, M57, M58, M66** were added or moved in round 2 for the
round-2 findings (`review-round1-ledger.md`, "Re-review wave"). The harness now counts a mutant as killed only when at least one
TEST fails (a mutant that no longer compiles, or a crashed worker, is reported as `SUSPECT` and fails the run). The counts below
come from a **targeted** run that applied one mutant to a scratch copy and ran only the test file(s) written to kill it, by the
maintainer, before any full run; they are not the full-suite counts, and no full mutation run of this branch is recorded yet.

| ID | Defect injected | Finding | Targeted run (failing tests, file) |
| --- | --- | --- | --- |
| M66 | receipt-looking files that would not be read are ignored again | round 2 (look-alike files) | 11 (`round3-input-refusals`, `round2-cli-safety`) |
| M78 | a RunProof `exit_code` that is not an integer is no longer refused | round 2 logic P1 | 15 (`round3-runproof-exit-code`) |
| M79 | the JWT scanner rescans the whole run from every `eyJ` start | round 2 security P1 (quadratic) | 3 (`round3-redaction-scaling`) |
| M80 | unquoted secret values cut at 300 characters again | round 2 security P1 | 5 (`round3-redaction-shapes`) |
| M81 | quoted secret values cut at 300 characters again | round 2 security P1 | 1 (`round3-redaction-shapes`) |
| M82 | a quoted value ends at its first space again ("correct horse battery staple" leaks its tail) | round 2 security P2 | 3 (`the redaction unit files`) |
| M83 | redaction folds the whole string at once | round 2 security P1 (OOM) | 2 (`round3-hostile-memory`) |
| M84 | the folded-text budget is removed | round 2 security P1 (OOM) | 1 (`round3-redaction-shapes`) |
| M85 | the JSON container budget is removed | round 2 security P2 | 2 (`round3-input-refusals`) |
| M86 | colliding redacted keys recompute `redactString(key)` and restart their counter | round 2 security P2 (quadratic) | 1 (`round3-redaction-shapes`) |
| M87 | folded key names are not tested | round 2 security P2 | 6 (`round3-redaction-shapes`) |
| M88 | assignment names judged by keyword substring only | round 2 security P2 | 4 (`round3-redaction-shapes`) |
| M89 | a `pass` segment in a longer key name is sensitive only in lowercase | round 2 security P2 | 4 (`round3-redaction-shapes`) |
| M90 | the artifact scan no longer decodes UTF-16 | round 2 security P2 | 6 (`round3-redaction-shapes`) |
| M91 | the artifact scan no longer folds UTF-8 text | round 2 security P2 | 1 (`round3-redaction-shapes`) |
| M92 | a short `Bearer` token with a digit is not recognised | round 2 security P2 | 1 (`round3-redaction-shapes`) |
| M93 | Twilio account SIDs are not recognised | round 2 security P2 | 1 (`round3-redaction-shapes`) |
| M94 | DigitalOcean, Shopify and Mailgun keys are not recognised | round 2 security P2 | 3 (`round3-redaction-shapes`) |
| M95 | a stray credential word swallows the key of the next pair | property test finding | 1 (`round3-redaction-shapes`) |
| M96 | terminal escaping cuts a chunk inside a surrogate pair | round 2 security P1 (`--json`) | 1 (`round3-terminal-escape`) |
| M97 | values JSON cannot express reach the canonical encoder again | round 2 security P3 | 9 (`round3-input-refusals`) |
| M98 | `EMFILE` and `ENFILE` are not `output_unwritable` | round 2 conformance P1 / security P2 | 2 (`round3-input-refusals`) |
| M99 | the camelCase `exitCode` of a RunProof run is ignored | round 2 logic P1 | 1 (`round3-runproof-exit-code`) |
| M100 | the terminal escaper builds its output one character at a time again | round 2 security P1 (`--json` OOM) | 2 (`round3-hostile-memory`) |
| M101 | the acceptance matrix records AC-06 as PASS again | round 2 conformance and logic P1 | 2 (`tests/proofgate.spec.ts`, AC index) |

**M102 to M147 and the retargeted M10, M12, M47, M49, M53, M54, M58, M76, M81, M82, M88, M89, M94, M95, M128** were added or moved in
round 3 for the round-3 findings (`review-round1-ledger.md`, "Round 3"). The harnesses share one kill rule
(`scripts/kill-rule.mjs`): a mutant is killed only by a failing test, a run in which every failure is a timeout is `SUSPECT`, and
the killing test is named in the output. The counts are from targeted runs (one mutant applied to a scratch copy, only the named
test files run); they are not full-suite counts. The full 147-mutant run is a gate step and is recorded in `gate-evidence.md`.

| ID | Defect injected | Finding | Targeted run (failing tests, file) |
| --- | --- | --- | --- |
| M102 | the executable runs `main()` only when argv[1] ends in `.js` again (`node dist/cli evaluate` exits 0 having done nothing) | round 3 logic P1 | 6 (`round4-cli-entry`) |
| M103 | unreferenced files are refused by an extension heuristic again | round 3 logic P2 | 45 (`round4-unreferenced-files`) |
| M104 | the package version is part of the bundle re-evaluation comparison again | round 3 logic P2 | 1 (`round4-bundle-version`) |
| M105 | a policy engine change is reported as a generic re-evaluation mismatch again | round 3 logic P2 | 1 (`round4-bundle-version`) |
| M106 | a distinctive-prefix token needs a boundary again (`ghp_` after a letter, digit or escape) | round 3 security P2, tests P1 | 15 (`round4-redaction-fail-open`) |
| M107 | the `sk-ant-` prefix needs a boundary again | round 3 tests P1 | 3 (`round4-redaction-fail-open`) |
| M108 | `isNextKey` tests the credential words as a substring of the whole quoted value | round 3 security P2 (regression) | 1 (`round4-redaction-fail-open`) |
| M109 | redaction runs one round only (not a fixed point) | round 3 security P2 | 3 (`round4-redaction-fail-open`, `round4-redaction-roundtrip`) |
| M110 | a string over the size cap is examined instead of replaced | round 3 security P2 | 1 (`round4-redaction-fail-open`) |
| M111 | an oversize key is not sensitive | round 3 security P2 | 1 (`round4-minor-survivors`) |
| M112 | a key whose folded form cannot be examined is not sensitive (D03) | round 3 tests P3 | 2 (`round4-minor-survivors`) |
| M113 | dotted, bracketed and spaced key names are one segment again (spring.datasource.password keeps its value) | round 3 security P2 | 3 (`the redaction unit files`) |
| M114 | assignment blanks limited to 3 again | round 3 security P2 | 6 (`round4-redaction-fail-open`) |
| M115 | YAML next-line values are not followed past the indentation (key:\n  value keeps the value) | round 3 security P2 | 19 (`the redaction unit files`) |
| M116 | escaped quotes limited to one backslash | round 3 security P2 | 1 (`round4-redaction-fail-open`) |
| M117 | a name/value pair object does not redact its value by the name | round 3 security P2 | 1 (`round4-redaction-fail-open`) |
| M118 | a header name after a stray keyword is eaten with one word again (the Digest response leaks) | seeded property test finding | 1 (`the redaction unit files`) |
| M119 | JWT header length boundary 8 becomes 9 (D14) | round 3 tests P3 | 3 (`round4-minor-survivors`) |
| M120 | JWT signature length boundary 8 becomes 9 (D05) | round 3 tests P3 | 3 (`round4-minor-survivors`) |
| M121 | the fold carry is 4 KiB again | round 3 tests and security P3 | 1 (`round4-redaction-boundaries`) |
| M122 | the UTF-16 layout needs 16 ASCII-range units again | round 3 security P3 | 2 (`round4-redaction-boundaries`) |
| M123 | a small-constant quadratic scan is added to assignment redaction | round 3 tests P2 (scaling test strength) | 2 (`round3-redaction-scaling`) |
| M124 | the JSON value budget is removed | round 3 security P2 | 6 (`round4-json-budget`) |
| M125 | array elements are not counted as values | round 3 security P2 | 6 (`round4-json-budget`) |
| M126 | objects are not counted as containers (J02) | round 3 tests P2 | 5 (`round4-json-budget`) |
| M127 | `JSON.parse` runs before the budget (J04) | round 3 tests P2 | 3 (`round4-json-budget`) |
| M128 | receipt file names that redaction changed are used as entry names again | round 3 security P2 | 1 (`round4-redaction-roundtrip`) |
| M129 | receipt identifiers are compared after redaction again | round 3 logic P3-1 | 4 (`round4-logic-p3`) |
| M130 | manifest identifiers are compared after redaction again | round 3 logic P3-1 | 3 (`round4-logic-p3`) |
| M131 | the receipt environment is dropped from the identifier check | round 3 logic P3-1 | 1 (`round4-logic-p3`) |
| M132 | ENOENT is not an output failure | round 3 logic P3-2 | 1 (`round3-input-refusals`) |
| M133 | a clean-up failure replaces the real error (ENOTDIR from `rm`) | round 3 logic P3-2 | 2 (`round4-logic-p3`) |
| M134 | a RunProof run with a `__proto__` field is imported again | round 3 logic P3-3 | 1 (`round4-logic-p3`) |
| M135 | `--replace` without `--output` is accepted again | round 3 logic P3-4 | 1 (`round4-logic-p3`) |
| M136 | `bundle export` does not check repeated or empty options (C02) | round 3 tests P2 | 8 (`round4-bundle-flags`) |
| M137 | `bundle verify` and `restore` do not check repeated or empty options (C03) | round 3 tests P2 | 3 (`round4-bundle-flags`) |
| M138 | the executable does not handle a closed stderr (C04) | round 3 tests P3 | 1 (`round4-minor-survivors`) |
| M139 | a bare CR is not a YAML line break in the node estimate | round 3 security P3 | 1 (`round4-minor-survivors`) |
| M140 | the end-to-end harness counts only a surviving mutant as a miss | round 3 tests P2 | 1 (`round4-kill-rule`) |
| M141 | the main harness counts only a surviving mutant as a miss | round 3 tests P2 | 1 (`round4-kill-rule`) |
| M144 | the README says AC-03 is PASS | round 3 tests P3 (X3) | 1 (`round4-doc-pins`) |
| M145 | the README says AC-11 is PASS | round 3 tests P3 (X4) | 1 (`round4-doc-pins`) |
| M146 | the CHANGELOG says AC-11 is PASS | round 3 tests P3 (X5) | 1 (`round4-doc-pins`) |
| M147 | the gate evidence says AC-11 is satisfied | round 3 tests P3 (X6) | 1 (`round4-doc-pins`) |

**M148 to M229 and the retargeted M23, M34, M58, M81, M115, M116, M117, M127, M142, M143** were added or moved in round 4
for the round-4 findings (`review-round1-ledger.md`, "Round 4"). The kill rule changed too: both harnesses now read the test
runner's own JSON result and count a mutant as killed only when at least one test FAILS BY ASSERTION; a run whose failures are all
timeouts or runtime errors, a run that crashed, printed a summary and died, hit the wall-clock cap or wrote no result is
`SUSPECT` (`scripts/kill-rule.mjs`). Three mutants of this set were first `SUSPECT` because their replacement did not
type-check (the build failed, no test ran) and were rewritten; that is the rule doing its job. The counts are from targeted runs
(one mutant applied to a scratch copy, only the named test files run); they are not full-suite counts. The full 390-mutant
run is a gate step and is recorded in `gate-evidence.md` when it has been run.

**Status of the claim, dated (targeted-run evidence only):** M148 to M229 were each killed by a failing assertion in targeted runs at the round-4 tree.
That commit has the redactor that never returned on `{"key":"value"}`, so those runs show what each test asserts, not that the tree was sound.
The mutants that round 5 added (M230 to M274) and the ones it retargeted because their targets no longer occurred in `src/redact.ts`
(M57, M82, M115, M123, M151, M152, M229 in the first pass; M115, M152, M155, M164, M171, M195, M205, M215, M217, M221, M224, M231, M238 and M244
again after the second redactor change) were killed in single-mutant targeted runs, one mutant applied to a scratch copy of the tree at the
round-5 redactor (56 of 56 mutants of the final set, each by at least one failing assertion, none by a timeout or a crash). The
full mutation run (main and end-to-end, 390 and 10 entries) is a gate step and has NOT been run on this tree: until it is recorded, nothing
here says "all mutants killed". Both harnesses have an instrument check (`--check`, run first by the harness and by the quality gate, with a
negative control) and the main suite asserts that every target of both lists occurs exactly once and that every mutant has a row in this table
(`tests/unit/round5-mutant-targets.test.ts`). A mutant whose only detector is a crash of the spawned command counts as KILLED by the rule
(the tests catch it with an exit-code assertion): that is a weak kill, named as such in `round4-kill-rule`.

**M275 to M390** were added in round 6: the option reader's Authorization, container, tag and prefix rules (M275 to M279), objects under a credential
key (M280), the private-key scanner (M281), the option reader's bounded work (M282), constants of the user-information reader and the percent
escapes that survived a wider run in the round-5 tests review (M283 to M289), the kill rule's labelled Playwright expect (M290), the bundle `report/`
entries, RunProof verdict spellings and manifest collection keys (M291 to M293), the cap wrapper's signals and process group (M294, M295, M296, M317),
and the redactor rules of the round-5 security report and of the planted-secret differentials (M297 to M316, M318), and the option reader after a text-written line break (M319, M320), and the unclosed and the closed prefixed string (M321 to M323) and the Authorization value that starts with a bracket (M324, M325) and the trailing escape strips and line-break matchers of the redactor (M326 to M333), and the review fixes that followed them: the work budget and the memoised scans (M334 to M337), the one shared rule for the usage counters (M338 to M340), prefixed values (M341, M342), bracket-led values (M343, M344), glued option names and the break set (M345, M346), the YAML list dash (M347), the option forms of the bracket rules (M348, M349), the RunProof verdict words (M350) the kill rule's bare timeout (M351) and the repaired kill rule (M352 to M358: a message is read at its start, Playwright's header needs its own block, colour codes with `;`, a poll that gave up) and the plants of the trailing-strip regular expressions (M359 to M365: the exponential and the quadratic expression put back at each of the four places that strip a run, found by the termination family and by the static audit), the scanner's work budget (M366), the nested hash lines (M367 to M373) the recognition of failed `rejects` assertions (M374 to M376) and the option values that read as labels (M377 to M388), the quoted password after `-u user:` (M389) and the padded key followed by a delimiter (M390). Each of the 116 was killed by
at least one failing assertion in a single-mutant targeted run (M275 to M318 at intermediate states of the round-6 redactor, M319 to M390 at the final one). M285, M286, M290, M294, M296, M344 (no test where an escape behind a bracket decided), M346 (its first replacement was an invalid regular expression) and M249 (after its target moved, the files that killed it were not in the run) first survived or were
`SUSPECT` (a run that timed out instead of failing an assertion; a mutant whose alternative was redundant) and got a stronger test or a retarget.
The twenty-two older mutants whose target text changed (M10, M57, M81, M82, M113, M118, M148, M152, M153, M156, M211, M212, M213, M229, M115, M181, M240, M244, M249, M253, M254, M256) were retargeted and killed
again. The full mutation run (main and end-to-end, 390 and 10 entries) has NOT been run on this tree.

**M245 to M274** were added in round 5 for the redactor that never returned (M245), the readers that the round-4 security review found
missing (options, user information, pair values, labels, multi-line lists, blank and comment lines, Python prefixes, usage counters),
the bundle and adapter changes (M266 to M270) and the three leaks that differentials against the previous redactor found (M271 to M274).
Eight of them survived their first targeted run (M164, M221, M246, M248, M249, M250, M251, M259 with the older tests); each got a test
(`redaction-precision`) that fails by assertion with the mutant and passes without it.

**M195 to M229** were added for the second security review of the same round (name/value pairs in every order and shape, block and
bracketed lists, percent-encoded separators, whole-key names); each was killed in a targeted run by at least one assertion failure of
`redaction-classes-round4b` (the table below lists the counts). M225 first survived: the overlap case was not exercised until a test with one
name before the value and one after it was added.

| ID | Defect injected | Finding | Targeted run (failing tests by assertion, file) |
| --- | --- | --- | --- |
| M142 | the shared kill rule counts every red run that has a result as a kill (a TypeError-only run is KILLED) | round 4 tests P1 | 7 (`round4-kill-rule`) |
| M143 | the shared kill rule counts a run of only timeouts and runtime errors as a kill | round 4 tests P1 | 3 (`round4-kill-rule`) |
| M148 | a quoted value closes at a run of exactly r backslashes again (a credential that itself contains a quote leaks its tail at depth 1 and deeper) | round 4 conformance F1, security P1-1 | 3 (`redaction-depth-generative`) |
| M149 | a run of backslashes in front of a quote is capped at 8 again (JSON nested 4 layers deep fails open) | round 4 security P1-1 | 12 (`redaction-depth-generative`) |
| M150 | letters of a separator escape stay in the name (`a\npwd=S`, `%0Apwd=S` are not recognised) | round 4 security P1-3 | 8 (`redaction-depth-generative`) |
| M151 | a hash rocket is read as `=` and the value `>` again | round 4 security P2 | 3 (`redaction-forms-round4`) |
| M152 | a YAML next line written as text is not followed (`password:\n    S` inside JSON text) | round 4 security P1-3 | 24 (`the redaction unit files`) |
| M153 | line breaks and tabs written as text are matched with ONE backslash only (a second nesting layer hides the next-line value) | round 4 security P1-3 | 2 (`redaction-depth-generative`) |
| M154 | object keys are judged as written only (a key that becomes credential-looking after redaction keeps its value: not a fixed point) | round 4 security P1-2, logic P2-1 | 13 (`redaction-object-fixed-point`) |
| M155 | pair objects ({name,value}, {Name,Value}, {ParameterKey,ParameterValue}, {header,value}) keep their value | round 4 security P2 | 45 (`the redaction unit files`) |
| M156 | the element after a credential name in a list (`["--password", "S"]`) is kept | round 4 security P2 | 2 (`redaction-object-fixed-point, redaction-security-round5`) |
| M157 | the text-level name/value pair scanner does nothing (a Kubernetes-style pair inside JSON text keeps its value at depth 1 and deeper) | round 4 security P2 | 1 (`redaction-depth-generative`) |
| M158 | only the hand-picked invisible characters are folded away again (4,186 of 4,206 split a token) | round 4 security P2 | 2 (`redaction-forms-round4`) |
| M159 | the assignment step is not run for connection_string (the literal prefilter lacks the word) | round 4 security P2 | 2 (`redaction-forms-round4`) |
| M160 | the artifact scan asks the password-flag shape of random binary again | round 4 security P2 | 1 (`redaction-forms-round4`) |
| M161 | U+FFFD counts as printable text again (a UTF-8 view of random bytes looks like text) | round 4 security P2 | 1 (`redaction-forms-round4`) |
| M162 | concatenated key names (secretkey, tokenvalue, signingkey, ...) are not credential names | round 4 security P2, logic P3 | 7 (`redaction-object-fixed-point, redaction-limits-exact`) |
| M163 | pass or pwd glued to a word (dbpass, userpass, adminpwd) is not a credential name | round 4 security P2 | 10 (`redaction-object-fixed-point, redaction-limits-exact`) |
| M164 | a flag with blanks after the = (`--password = S`) is not read (the value is taken to be the blank) | round 4 security P2 | 3 (`the redaction unit files`) |
| M165 | Slack tokens are only the a, b, p, r, s families again | round 4 security P3 | 4 (`redaction-forms-round4`) |
| M166 | the assignment keyword list lacks connection_string and ssh_key again (they are only JSON key names) | round 4 security P2 | 3 (`redaction-forms-round4`) |
| M167 | the aggregate JSON budget over all receipt documents is removed (8 receipts of 490,000 objects abort a 256 MB heap) | round 4 security P2 | 4 (`limits-and-errors-round4`) |
| M168 | receipts are parsed without the shared aggregate budget | round 4 security P2 | 2 (`limits-and-errors-round4`) |
| M169 | a duplicate YAML key is no longer refused (the parser's own check is off) | round 4 security P2 | 6 (`limits-and-errors-round4`) |
| M170 | the quadratic duplicate-key check of the YAML parser is on again (40,000 keys take 10 s) | round 4 security P2 | 1 (`limits-and-errors-round4`) |
| M171 | bundle export publishes without verifying (a bundle that verify and restore refuse) | round 4 security P1-2, logic P2-1 | 1 (`bundle-export-self-verify`) |
| M172 | dist/run.js started as the main script does nothing and exits 0 again | round 4 logic P2-2 | 4 (`entry-forms`) |
| M173 | dist/index.js started as the main script does nothing and exits 0 again (node . and node dist) | round 4 logic P2-2 | 6 (`entry-forms`) |
| M174 | the entry point is recognised only by its exact path (node dist, node dist/index, node . are missed) | round 4 logic P2-2 | 8 (`entry-forms, entry-guard`) |
| M175 | a required RunProof definition that is absent from the latest evaluation is ignored | round 4 logic P3 | 1 (`runproof-strictness`) |
| M176 | an exit status under another spelling is ignored | round 4 logic P3 | 7 (`runproof-strictness`) |
| M177 | a __proto__ key inside a check is dropped silently again | round 4 logic P3 | 1 (`runproof-strictness`) |
| M178 | the whole error line is redacted again (bundle_secret_detected loses its first word) | round 4 security P3 | 1 (`limits-and-errors-round4`) |
| M179 | an identifier nested hundreds of thousands of levels deep is an internal error again | round 4 security P3 | 2 (`identifier-paths`) |
| M180 | the bundle header's revision set is not checked against the report | round 4 logic P3 | 1 (`bundle-header-forgery`) |
| M181 | the kill rule no longer recognises a timeout (a run of only timeouts looks like other errors, and is still SUSPECT: the count check must notice) | round 4 tests P1 | 5 (`round4-kill-rule`) |
| M182 | the kill rule counts every failing test as an assertion failure | round 4 tests P1 | 3 (`round4-kill-rule`) |
| M183 | the JSON value limit is raised to 5 million (a 3.3 million value document is not refused) | round 4 tests P2 | 1 (`round4-json-budget`) |
| M184 | the blanks allowed around a separator are 65 instead of 64 | round 4 tests P3 | 4 (`redaction-limits-exact`) |
| M185 | an allowed note name is matched by extension (any .md file is a note again) | round 4 tests P2 | 2 (`round4-unreferenced-files`) |
| M186 | the receipt suffix is matched without regard to case (x.RECEIPT.JSON is neither read nor refused) | round 4 tests P2 | 3 (`round4-unreferenced-files`) |
| M187 | run.id is not an identifier field | round 4 tests P2 | 1 (`identifier-paths`) |
| M188 | binding.environment is not an identifier field | round 4 tests P2 | 2 (`identifier-paths, identifier-runproof`) |
| M189 | only the first element of an array of objects is checked | round 4 tests P2 | 4 (`identifier-paths`) |
| M190 | the per-requirement repositories are not identifier fields | round 4 tests P2 | 1 (`identifier-paths`) |
| M191 | binding.requirement_ids is not an identifier field | round 4 tests P2 | 2 (`identifier-paths, identifier-runproof`) |
| M192 | the aggregate value budget over all receipts is nine million instead of three | round 4 tests P2 | 1 (`limits-and-errors-round4`) |
| M193 | the aggregate container budget over all receipts is two million instead of one | round 4 tests P2 | 3 (`limits-and-errors-round4`) |
| M194 | the extensions nesting limit is 17 instead of 16 | round 4 tests P3 | 2 (`redaction-limits-exact`) |
| M195 | the whole-key test no longer knows webhook | round 4, second security review B4 (whole-key names) | 6 (`the redaction unit files`) |
| M196 | the whole-key test loses the uri spelling of a connection name | round 4, second security review B4 (whole-key names) | 3 (`redaction-classes-round4b`) |
| M197 | the whole-key test loses the vendor name stripe | round 4, second security review B4 (whole-key names) | 5 (`redaction-classes-round4b`) |
| M198 | the whole-key test is never asked | round 4, second security review B4 (whole-key names) | 21 (`redaction-classes-round4b`) |
| M199 | the whole-key test keeps the separators | round 4, second security review B4 (whole-key names) | 13 (`redaction-classes-round4b`) |
| M200 | the assignment keywords lose webhook | round 4, second security review B4 (whole-key names) | 1 (`redaction-classes-round4b`) |
| M201 | the assignment keywords lose the uri spelling | round 4, second security review B4 (whole-key names) | 1 (`redaction-classes-round4b`) |
| M202 | the assignment prefilter loses uri and key | round 4, second security review B4 (whole-key names) | 1 (`redaction-classes-round4b`) |
| M203 | a YAML list item value starts at the blank after the dash | round 4, second security review B2 (block and bracketed lists) | 4 (`redaction-classes-round4b`) |
| M204 | the other items of a block list are not read | round 4, second security review B2 (block and bracketed lists) | 1 (`redaction-classes-round4b`) |
| M205 | a nested bracket does not open a level | round 4, second security review B2 (block and bracketed lists) | 2 (`the redaction unit files`) |
| M206 | a quote in a plain list is not a string | round 4, second security review B2 (block and bracketed lists) | 2 (`redaction-classes-round4b`) |
| M207 | an escaped quote in a nested list is not a string | round 4, second security review B2 (block and bracketed lists) | 1 (`redaction-classes-round4b`) |
| M208 | percent escapes are undone twice, not three times | round 4, second security review B3 (percent-encoded separators) | 1 (`redaction-classes-round4b`) |
| M209 | an encoded percent sign is not decoded | round 4, second security review B3 (percent-encoded separators) | 3 (`redaction-classes-round4b`) |
| M210 | the decoded copy is never used | round 4, second security review B3 (percent-encoded separators) | 14 (`redaction-classes-round4b`) |
| M211 | a lowercase %3d is not a separator | round 4, second security review B3 (percent-encoded separators) | 2 (`redaction-classes-round4b`) |
| M212 | an encoded double quote, hash and dollar sign are not decoded | round 4, second security review B3 (percent-encoded separators) | 3 (`redaction-classes-round4b, redaction-security-round5`) |
| M213 | an encoded at sign is not decoded | round 4, second security review B3 (percent-encoded separators) | 3 (`redaction-classes-round4b`) |
| M214 | the artifact scan never reads a decoded copy | round 4, second security review B3 (percent-encoded separators) | 2 (`redaction-classes-round4b`) |
| M215 | the value key is looked for one character away only | round 4, second security review B1 (pairs in every order and shape) | 42 (`the redaction unit files`) |
| M216 | the pair window does not grow with the escape overhead | round 4, second security review B1 (pairs in every order and shape) | 14 (`redaction-classes-round4b`) |
| M217 | a brace between the name and the value does not end the search | round 4, second security review B1 (pairs in every order and shape) | 4 (`the redaction unit files`) |
| M218 | braces inside a plain string end the search | round 4, second security review B1 (pairs in every order and shape) | 2 (`redaction-classes-round4b`) |
| M219 | braces inside an escaped string end the search | round 4, second security review B1 (pairs in every order and shape) | 2 (`redaction-classes-round4b`) |
| M220 | a session cookie called sid is not a credential name | round 4, second security review B1 (pairs in every order and shape) | 4 (`redaction-classes-round4b`) |
| M221 | a session cookie name is not a credential name (list elements) | round 4, second security review B1 (pairs in every order and shape) | 6 (`the redaction unit files`) |
| M222 | the value key of a single-quoted pair is looked for with double quotes | round 4, second security review B1 (pairs in every order and shape) | 4 (`redaction-classes-round4b`) |
| M223 | a list element can follow anything (a string that is a value is a label) | round 4, second security review B1 (pairs in every order and shape) | 5 (`redaction-classes-round4b`) |
| M224 | the list pair scan does not look at the value as the next label | round 4, second security review B1 (pairs in every order and shape) | 10 (`the redaction unit files`) |
| M225 | overlapping redactions are written twice | round 4, second security review B1 (pairs in every order and shape) | 1 (`redaction-classes-round4b`) |
| M226 | the value key before the name is never looked for | round 4, second security review B1 (pairs in every order and shape) | 10 (`redaction-classes-round4b`) |
| M227 | the FIRST value key before the name is taken, not the nearest | round 4, second security review B1 (pairs in every order and shape) | 2 (`redaction-classes-round4b`) |
| M228 | a YAML list is not marked as a list | round 4, second security review B2 (block and bracketed lists) | 1 (`redaction-classes-round4b`) |
| M229 | a bracketed value is read as a word | round 4, second security review B2 (block and bracketed lists) | 5 (`redaction-classes-round4b`) |
| M230 | a block scalar header is not recognised (the block under `password: |` keeps its value) | round 5, R5, YAML block scalars and node properties | 21 (`redaction-fix5`) |
| M231 | anchors and tags in front of a value are not skipped | round 5, R5, YAML block scalars and node properties | 7 (`the redaction unit files`) |
| M232 | a block ends after its first line | round 5, R5, YAML block scalars and node properties | 6 (`redaction-fix5`) |
| M233 | a blank line ends a block | round 5, R5, YAML block scalars and node properties | 2 (`redaction-fix5`) |
| M234 | a block with no indentation is not treated as ambiguous (fail closed) | round 5, R5, YAML block scalars and node properties | 1 (`redaction-fix5`) |
| M235 | an explicit indentation digit is ignored | round 5, R5, YAML block scalars and node properties | 1 (`redaction-fix5`) |
| M236 | ?= and += are not assignment operators | round 5, R5, assignment operators (?=, +=, :=) | 5 (`redaction-fix5`) |
| M237 | := is a YAML colon again (a marker beside a visible secret) | round 5, R5, assignment operators (?=, +=, :=) | 2 (`redaction-fix5`) |
| M238 | a hyphenated option name (`--db-password`, `--client-secret`) is not read | round 5, R5, options (--db-password S, -p=S) | 14 (`the redaction unit files`) |
| M239 | -p=SECRET is not read | round 5, R5, options (--db-password S, -p=S) | 2 (`redaction-fix5`) |
| M240 | a value that ends in a colon takes the next word with it | round 5, R5, YAML block scalars and node properties | 1 (`redaction-fix5, redaction-security-round5`) |
| M241 | the first character of a block is read as a quote | round 5, R5, YAML block scalars and node properties | 1 (`redaction-fix5`) |
| M242 | the value after a tag on its own line is not followed | round 5, R5, YAML block scalars and node properties | 1 (`redaction-fix5`) |
| M243 | line breaks written as text do not end a block line | round 5, R5, YAML block scalars and node properties | 2 (`redaction-fix5`) |
| M244 | a comment after a block header is not skipped | round 5, R5, YAML block scalars and node properties | 2 (`redaction-fix5`) |
| M245 | every scan shares one global regular expression again (a re-entrant call resets its position and the pair scan never ends) | round 5, logic P0 (the redactor that never returned on `{"key":"value"}`) | 19 (`redaction-termination`) |
| M246 | an @ before the password start counts as the end of the userinfo (the redaction span runs backwards) | round 5, security P2 (user information: last `@`, slash, port shape, scheme-less) | 1 (`the redaction unit files`) |
| M247 | a port-shaped part before the first slash is treated as a password with a slash in it | round 5, security P2 (user information: last `@`, slash, port shape, scheme-less) | 1 (`the redaction unit files`) |
| M248 | a password that holds a slash is looked for 8 characters past the slash only | round 5, security P2 (user information: last `@`, slash, port shape, scheme-less) | 1 (`the redaction unit files`) |
| M249 | -u and --user redact a value without a colon (a bare user name) | round 5, security P1 (options with quoted values at any nesting depth) | 5 (`the redaction unit files`) |
| M250 | an object value of a name/value pair is read as a word | round 5, security P2 (name/value pairs: values, labels, value first, other objects) | 2 (`the redaction unit files`) |
| M251 | an array value of a name/value pair is read as a word | round 5, security P2 (name/value pairs: values, labels, value first, other objects) | 1 (`the redaction unit files`) |
| M252 | a bracketed value ends at its first line break (a multi-line flow list keeps its later elements) | round 5, tests P1 (multi-line flow lists, blank and comment lines) | 6 (`the redaction unit files`) |
| M253 | blank lines after a key are not skipped | round 5, tests P1 (multi-line flow lists, blank and comment lines) | 8 (`the redaction unit files`) |
| M254 | comment lines between a key and its value are not skipped | round 5, tests P1 (multi-line flow lists, blank and comment lines) | 2 (`the redaction unit files`) |
| M255 | the short-shape steps also run on binary data (the artifact scan reports random bytes) | round 5, logic P2 (the artifact scan and random binary data) | 2 (`the redaction unit files`) |
| M256 | a Python string prefix (b'S', u"S") is not skipped | round 5, security P2 and P3 (Python prefix, usage counters) | 4 (`the redaction unit files`) |
| M257 | usage counters (input_tokens, prompt_tokens) are redacted as credentials | round 5, security P2 and P3 (Python prefix, usage counters) | 2 (`the redaction unit files`) |
| M258 | a pair label of more than 20 characters is not a credential name (a long parameter path) | round 5, security P2 (name/value pairs: values, labels, value first, other objects) | 7 (`the redaction unit files`) |
| M259 | a pair label may span lines | round 5, security P2 (name/value pairs: values, labels, value first, other objects) | 2 (`the redaction unit files`) |
| M260 | the value key before the name (value first) is not looked for | round 5, security P2 (name/value pairs: values, labels, value first, other objects) | 32 (`the redaction unit files`) |
| M261 | a value key before the name in another object is taken as this pair's value | round 5, security P2 (name/value pairs: values, labels, value first, other objects) | 3 (`the redaction unit files`) |
| M262 | a value key after the name in another object is taken as this pair's value | round 5, security P2 (name/value pairs: values, labels, value first, other objects) | 2 (`the redaction unit files`) |
| M263 | a user name of more than 3 characters is not read in scheme-less user information | round 5, security P2 (user information: last `@`, slash, port shape, scheme-less) | 4 (`the redaction unit files`) |
| M264 | a password with a quote or a backslash in it is not read up to its first @ | round 5, security P2 (user information: last `@`, slash, port shape, scheme-less) | 1 (`the redaction unit files`) |
| M265 | the closing quote of a quoted option value is left behind | round 5, security P1 (options with quoted values at any nesting depth) | 5 (`the redaction unit files`) |
| M266 | bundle export verifies in the system temporary directory again (a read-only or full one fails the export) | round 5, logic P2 (export verifies beside the output, not in TMPDIR) | 1 (`round5-bundle-checks, bundle-export-self-verify`) |
| M267 | the role of a bundle entry is not checked against its path | round 5, security P3 (bundle entry role and canonical magic) | 1 (`round5-bundle-checks`) |
| M268 | a bundle magic line with a leading zero in the version is accepted | round 5, security P3 (bundle entry role and canonical magic) | 3 (`round5-bundle-checks`) |
| M269 | a RunProof run with a plain status field is imported | round 5, logic P3 (a RunProof `status` field) | 4 (`runproof-strictness`) |
| M270 | manifest keys are compared by their original type (1 and '1' are two keys) | round 5, logic P3 (manifest keys compared as JSON keys) | 6 (`round5-manifest-keys`) |
| M271 | a value that starts with & or ! right after the colon is skipped as a YAML property (`password:&S` leaks) | round 5, differential against the previous redactor (a value that starts with ! or & is a value; an option followed by a colon) | 1 (`the redaction unit files`) |
| M272 | a property that ends its line takes no indented line below it (`password: !!str &a` then the value) | round 5, differential against the previous redactor (a value that starts with ! or & is a value; an option followed by a colon) | 2 (`the redaction unit files`) |
| M273 | a property with no block scalar behind it is skipped as before (the secret behind a lone ! or & stays) | round 5, differential against the previous redactor (a value that starts with ! or & is a value; an option followed by a colon) | 3 (`the redaction unit files`) |
| M274 | a colon after a credential option is read as the start of its value (`--api_key :'S` keeps the secret) | round 5, differential against the previous redactor (a value that starts with ! or & is a value; an option followed by a colon) | 2 (`the redaction unit files`) |
| M275 | an unquoted Authorization option value ends at the next blank again (`--Authorization=Basic S`, a list, an object keep their tail) | round 6, conformance P1 and tests P1 (options: an Authorization value, containers, tags, prefixes) | 5 (`the redaction unit files`) |
| M276 | any option that merely contains the word authorization takes the rest of the line (`--authorization-mode=Node,RBAC --bind-address=...`) | round 6, conformance P1 and tests P1 (options: an Authorization value, containers, tags, prefixes) | 3 (`redaction-options-round5, redaction-security-round5`) |
| M277 | an unquoted option value that starts with a bracket, brace or parenthesis is cut at the first blank or quote | round 6, conformance P1 and tests P1 (options: an Authorization value, containers, tags, prefixes) | 8 (`the redaction unit files`) |
| M278 | an option value that starts with ! or & is cut at the first blank or quote | round 6, conformance P1 and tests P1 (options: an Authorization value, containers, tags, prefixes) | 3 (`the redaction unit files`) |
| M279 | a Python prefix or a shell $ in front of an option's quote is not part of the value | round 6, conformance P1 and tests P1 (options: an Authorization value, containers, tags, prefixes) | 6 (`the redaction unit files`) |
| M280 | the assignment step reads only a bracketed list as a whole, not {...} or (...) | round 6, conformance P2 (an object or array value under a credential key, in text) | 7 (`the redaction unit files`) |
| M281 | the private-key scanner shares one global regular expression again | round 6, conformance P3 (the static re-entrancy test and the private-key scanner) | 2 (`redaction-termination`) |
| M282 | the work budget of the option reader's container scan is empty (every container runs to the end of the text) | round 6, tests P1 and P2 (the option reader's work is bounded) | 15 (`the redaction unit files`) |
| M283 | a password that holds a slash is looked for 256 characters past the slash only | round 6, tests P2 (leak-direction survivors: constants of the user-information reader) | 2 (`the redaction unit files`) |
| M284 | a user name of more than 50 characters is not read in scheme-less user information | round 6, tests P2 (leak-direction survivors: constants of the user-information reader) | 2 (`the redaction unit files`) |
| M285 | %3B (a semicolon) is not decoded in percent-encoded text | round 6, tests P2 (leak-direction survivors: percent escapes) | 1 (`redaction-boundaries-round5`) |
| M286 | %7D (a closing brace) is not decoded in percent-encoded text | round 6, tests P2 (leak-direction survivors: percent escapes) | 1 (`redaction-boundaries-round5`) |
| M287 | %09 (a tab) is not decoded in percent-encoded text | round 6, tests P2 (leak-direction survivors: percent escapes) | 1 (`the redaction unit files`) |
| M288 | angle brackets are part of a user-information password | round 6, tests P2 (leak-direction survivors: constants of the user-information reader) | 1 (`the redaction unit files`) |
| M289 | an empty password before the at sign is read (a user name without a password is redacted) | round 6, tests P2 (leak-direction survivors: constants of the user-information reader) | 2 (`the redaction unit files`) |
| M290 | the kill rule does not recognise a Playwright expect at the start of a line (a labelled expect: a label, a blank line, then expect()) | round 6, tests P1 (a labelled Playwright expect) | 4 (`round4-kill-rule`) |
| M291 | a bundle may hold any entry under report/ again | round 6, logic P2 (bundle entries under report/) | 3 (`round5-bundle-checks`) |
| M292 | RunProof verdict fields are matched by their exact lower-case spelling only | round 6, logic P3 (RunProof verdict spellings) | 11 (`runproof-strictness`) |
| M293 | a collection key in a YAML manifest is skipped by the duplicate-key pass | round 6, logic P3 (manifest collection keys) | 4 (`round5-manifest-keys`) |
| M294 | the cap wrapper does not pass an interrupt on to the process group | round 6, conformance P2 and tests P2 (run-with-cap: signals and the process group) | 3 (`round5-run-with-cap`) |
| M295 | the cap wrapper kills only its direct child at the cap (a grandchild survives) | round 6, conformance P2 and tests P2 (run-with-cap: signals and the process group) | 1 (`round5-run-with-cap`) |
| M296 | the kill rule's capped run kills only its direct child (an orphaned worker keeps spinning) | round 6, tests P2 (the kill rule kills the whole group, twice, and the scratch runs leave no process) | 2 (`round4-kill-rule`) |
| M297 | a credential name that only starts like a usage counter is exempt again (TOKEN_PERSONAL, TOKEN_MAX_SECRET) | round 6, security P1 (a name that only starts like a usage counter) | 6 (`redaction-security-round5`) |
| M298 | a closed bracket followed by text is a list only (`[S]tail` keeps its tail) | round 6, security P1 (a value that starts with a bracket) | 9 (`redaction-security-round5`) |
| M299 | the marker of an earlier pass is read as a bracket value with text behind it (`password=abc,foo=x` loses its second pair) | round 6, differential against the round-4 tree (the marker of an earlier pass) | 1 (`redaction-security-round5`) |
| M300 | a delimiter ends a value in front of any word and an equals sign (`token:>#S=` keeps its tail) | round 6, security P2 (delimiters and escapes that end an unquoted value) | 8 (`redaction-security-round5`) |
| M301 | a name that holds a blank counts as a credential's name in front of a delimiter (`>#S Bearer=`) | round 6, security P2 (delimiters and escapes that end an unquoted value) | 1 (`redaction-security-round5`) |
| M302 | a credential-named parent swallows its credential-named child again (`credentials:` then `password:` then `S`) | round 6, security P2 (a credential-named parent and its child) | 4 (`redaction-security-round5`) |
| M303 | a value line that starts with a hash is read up to its first blank only (`# S` keeps S) | round 6, security P2 (YAML value lines that start with #, >#, |#) | 1 (`redaction-security-round5`) |
| M304 | a hash line is always a comment (`DB_PASSWORD:` then an indented `#S` keeps S) | round 6, security P2 (YAML value lines that start with #, >#, |#) | 5 (`redaction-security-round5`) |
| M305 | `>#S` and `|#S` are block scalar headers again | round 6, security P2 (YAML value lines that start with #, >#, |#) | 2 (`redaction-security-round5`) |
| M306 | a scheme word takes no credential behind it (`token: Bearer S` keeps S) | round 6, differential against the round-3 tree (scheme words) | 5 (`redaction-security-round5`) |
| M307 | a glued -uNAME:PASS is not read (`curl -uadmin:S`) | round 6, security P2 (argv -u, glued -uNAME:PASS, a number after a credential option) | 3 (`redaction-security-round5`) |
| M308 | the argv element after -u or --user is kept | round 6, security P2 (argv -u, glued -uNAME:PASS, a number after a credential option) | 2 (`redaction-security-round5`) |
| M309 | a number after a credential option in a list is kept | round 6, security P2 (argv -u, glued -uNAME:PASS, a number after a credential option) | 1 (`redaction-security-round5`) |
| M310 | a pipe written as %7C does not end a value in front of the next NAME= | round 6, security P2 (delimiters and escapes that end an unquoted value) | 1 (`redaction-security-round5`) |
| M311 | a blank written as text between a separator and a quote is not skipped (`db_password:%20"S"`) | round 6, security P2 (the percent-decoded copy: `name:%20"S"`) | 2 (`redaction-security-round5`) |
| M312 | a quoted value that never closes hands nothing to the next line (`password=>'token:` then `S`) | round 6, planted-secret differential against the earlier trees (dangling names, glued options, quoted keys) | 1 (`redaction-security-round5`) |
| M313 | a credential's name and an equals sign as the value takes no next word (`Bearer:auth= S`) | round 6, planted-secret differential against the earlier trees (dangling names, glued options, quoted keys) | 2 (`redaction-security-round5`) |
| M314 | an option value glued in front of a credential's name keeps its front part (`-pass S;Bearer:`) | round 6, planted-secret differential against the earlier trees (dangling names, glued options, quoted keys) | 5 (`redaction-security-round5`) |
| M315 | a name glued behind an empty bracket is taken into the bracket's value (`[]2PASSWORD =S`) | round 6, planted-secret differential against the earlier trees (dangling names, glued options, quoted keys) | 1 (`redaction-security-round5`) |
| M316 | a quoted key behind punctuation (`Bearer=-auth":S`) is eaten with its front part | round 6, planted-secret differential against the earlier trees (dangling names, glued options, quoted keys) | 2 (`redaction-security-round5`) |
| M317 | the kill rule's capped run does not kill the group a second time when the cap fired | round 6, tests P2 (the kill rule kills the whole group, twice, and the scratch runs leave no process) | 1 (`round4-kill-rule`) |
| M318 | the next line after a dangling name is taken up to its first word even when that word is a credential's own label | round 6, planted-secret differential against the earlier trees (dangling names, glued options, quoted keys) | 3 (`redaction-security-round5`) |
| M319 | the option reader does not accept a line break written as text in front of an option (`a=1\n--password S` leaks) | round 6, class A of the ChangeRadar-derived check (an option after a line break written as text) | 13 (`redaction-text-newline-options`) |
| M320 | the glued -p rule does not accept a line break written as text in front of the option (`a=1\n-pS` leaks) | round 6, class A of the ChangeRadar-derived check (an option after a line break written as text) | 7 (`redaction-text-newline-options`) |
| M321 | a quote that never closes after a Python prefix or a shell dollar sign is not a value (`password=b'S` in a cut log keeps S) | round 6, differential against the round-5 reviewed tree | 11 (`redaction-unclosed-prefix`) |
| M322 | a prefixed quote whose closing quote stands on a later line is taken as closed (`password=b'S` then a line with another quote keeps S) | round 6, differential against the round-5 reviewed tree | 1 (`redaction-unclosed-prefix`) |
| M323 | a closed prefixed string is skipped only when a space or closing bracket stands behind its closing quote (`token=b'S'x`, `b'S'.decode()`, `b'S'\| cat` keep S) | round 6, planted differential against the round-5 reviewed tree | 1 (`redaction-unclosed-prefix`) |
| M324 | an Authorization value that starts with a bracket ends at the end of its line (`Authorization: [` then the elements on the next lines keeps them) | round 6, final differential against the round-5 reviewed tree | 13 (`redaction-authorization-array`) |
| M325 | an Authorization value reads a bracket past its line but not a brace or a parenthesis (`Authorization={` then the members on the next lines keeps them) | round 6, final differential against the round-5 reviewed tree | 1 (`redaction-authorization-array`) |
| M326 | the word-end check of a bracketed value is the exponential regex again (`password=[]x` and 24 backslashes take 1.4 s, 40 never finish) | round 6, review P0 (a hang on a short receipt string) and the audit of every regular expression | 8 (`redaction-linear-escapes`, `regex-static-audit`) |
| M327 | the run-end memo of the line-break and blank matchers is off (quadratic on a long run of backslashes behind a credential) | round 6, review P0 (a hang on a short receipt string) and the audit of every regular expression | 10 (`redaction-linear-escapes`, `regex-static-audit`) |
| M328 | a blank written as `\t` (backslashes and `t`) no longer ends a value in front of the next credential's NAME= | round 6, review P0 (a hang on a short receipt string) and the audit of every regular expression | 10 (`redaction-linear-escapes`, `regex-static-audit`) |
| M329 | the trailing break-escape strip does not know `%0A` and `%0D` | round 6, review P0 (a hang on a short receipt string) and the audit of every regular expression | 27 (redaction unit files, `redaction-linear-escapes`, `regex-static-audit`) |
| M330 | the trailing backslashes of a word are not stripped | round 6, review P0 (a hang on a short receipt string) and the audit of every regular expression | 29 (redaction unit files, `redaction-linear-escapes`, `regex-static-audit`) |
| M331 | the word-end check of a bracketed value strips only backslashes that a letter follows | round 6, review P0 (a hang on a short receipt string) and the audit of every regular expression | 29 (redaction unit files, `redaction-linear-escapes`, `regex-static-audit`) |
| M332 | the blank check after a YAML property does not know `%20` | round 6, review P0 (a hang on a short receipt string) and the audit of every regular expression | 27 (redaction unit files, `redaction-linear-escapes`, `regex-static-audit`) |
| M333 | the second run of backslashes of an escaped `\r\n` shares the memo slot of the first (quadratic when both runs are long) | round 6, review P0 (a hang on a short receipt string) and the audit of every regular expression | 4 (`redaction-linear-escapes`) |
| M334 | the work budget never runs out (a scan that goes super-linear is not stopped, and the whole text is never hidden) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | 1 (`redaction-work-bound`) |
| M335 | a call that runs out of work shows its text instead of hiding all of it (the budget fails open) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | 1 (`redaction-work-bound`) |
| M336 | the end of an option's word is measured again at every option in it (`--password=` repeated is quadratic) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-work-bound` |
| M337 | the next colon is searched again at every option (`=-u` repeated is quadratic) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-work-bound` |
| M338 | a counter with a qualifier that can name a credential is exempt again (`token_per_user`) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-usage-counters` |
| M339 | the singular `input_token` is a counter again (GitHub Actions passes an input as `INPUT_TOKEN`) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-usage-counters` |
| M340 | the object-key rule does not know the usage counters (`max_tokens` as a key is hidden) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-usage-counters` |
| M341 | a prefixed string that looks like a label is left in the clear whatever stands behind it (a padded base64 secret keeps its value) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-prefixed-values` |
| M342 | the SQL prefixes `X'` and `U&'` are not prefixes | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-prefixed-values` |
| M343 | a closer and a semicolon behind a bracket end the value whatever follows them | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-bracket-values` |
| M344 | an escape behind a bracket continues the token (the next level of a JSON string is swallowed) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-bracket-values` |
| M345 | a glued -p whose text is an option name and a colon is a glued secret again (`-passD: S`) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-review6-options` |
| M346 | the option reader does not know `\u000a`, `\x0a` and `%0B` as line breaks | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-review6-options` |
| M347 | a dangling label in a YAML block list takes the next item's dash | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-review6-options` |
| M348 | the option form of an Authorization value that starts with a bracket ends at the end of its line | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-review6-options` |
| M349 | an option value that starts with a bracket ends with the bracket (`--token={x}!u;y=` keeps its tail) | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `redaction-review6-options` |
| M350 | the RunProof importer does not refuse a run field `conclusion` | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `runproof-strictness` |
| M351 | the kill rule does not recognise a bare `Hook timed out` as a timeout | round 6, review fixes (super-linear scanners, prefixed values, bracket-led values, counters, option names) | `round4-kill-rule` |
| M352 | the classifier reads `AssertionError` on any line of a failure message (a thrown Error whose second line says it is a kill) | round 6, kill-rule repair (first-line anchoring, Playwright block, real-run fixtures) | `round4-kill-rule` |
| M353 | a Playwright header with no Expected / Received / Locator block behind it is an assertion (a thrown `expect(received).toBeTruthy()` is a kill) | round 6, kill-rule repair (first-line anchoring, Playwright block, real-run fixtures) | `round4-kill-rule` |
| M354 | an `Expected:` line anywhere in a failure message is an assertion | round 6, kill-rule repair (first-line anchoring, Playwright block, real-run fixtures) | `round4-kill-rule` |
| M355 | the colour codes of a message are stripped only when they hold no `;` (Playwright prints `1;31`) | round 6, kill-rule repair (first-line anchoring, Playwright block, real-run fixtures) | `round4-kill-rule` |
| M356 | a label in front of a Playwright header needs no blank line behind it (a multi-line label is no longer found) | round 6, kill-rule repair (first-line anchoring, Playwright block, real-run fixtures) | `round4-kill-rule` |
| M357 | an `expect.poll` that gave up (`while waiting on the predicate`) is an assertion | round 6, kill-rule repair (first-line anchoring, Playwright block, real-run fixtures) | `round4-kill-rule` |
| M358 | vitest's `promise resolved ... instead of rejecting` is read on any line of a message | round 6, kill-rule repair (first-line anchoring, Playwright block, real-run fixtures) | `round4-kill-rule` |
| M359 | the option word's trailing escapes are stripped by `(?:\\+[nr]?\|%0[AaDd])+$` again (the defect's own regular expression in a second place: exponential on a short receipt string) | round 6, plants of the trailing-strip regular expressions (termination family, static audit) | `redaction-long-run-family` |
| M360 | the option word's trailing escapes are stripped by `/\\+$/` again (quadratic on a run of backslashes that does not end the text) | round 6, plants of the trailing-strip regular expressions (termination family, static audit) | `redaction-long-run-family` |
| M361 | the trailing escaped breaks of a glued label are stripped by `(?:\\+[nr]\|%0[AaDd])+$` again | round 6, plants of the trailing-strip regular expressions (termination family, static audit) | `redaction-long-run-family` |
| M362 | the key at the end of a value is read after `/\\+$/` strips its backslashes again (quadratic) | round 6, plants of the trailing-strip regular expressions (termination family, static audit) | `redaction-long-run-family` |
| M363 | the key at the end of a value is read after the exponential trailing-escape regular expression again | round 6, plants of the trailing-strip regular expressions (termination family, static audit) | `redaction-long-run-family` |
| M364 | the word of a bracket group is stripped by `/\\+$/` again (quadratic) | round 6, plants of the trailing-strip regular expressions (termination family, static audit) | `redaction-long-run-family` |
| M365 | the word of a bracket group is stripped by the exponential trailing-escape regular expression again | round 6, plants of the trailing-strip regular expressions (termination family, static audit) | `redaction-long-run-family` |
| M366 | the artifact scan fails OPEN when its work budget is passed (an empty list instead of `work-budget-exceeded`) | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `redaction-work-bound` |
| M367 | a `#` line at the column of its credential key is the value (a real comment at the key's column is redacted) | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `redaction-nested-hash` |
| M368 | a `#` line deeper than its credential key is read as a comment again (the value under a nested key leaks) | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `redaction-nested-hash` |
| M369 | a list dash in front of a key does not count as indentation (`- password:` then a deeper `#` line leaks) | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `redaction-nested-hash` |
| M370 | the lines below a deeper `#` value that are deeper than the key are not part of the value | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `redaction-nested-hash` |
| M371 | a quoted key's indentation is not read (`"password":` then a deeper `#` line leaks) | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `redaction-nested-hash` |
| M372 | the value of a deeper `#` line runs over lines that are not deeper than the key (the next key is redacted too) | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `redaction-nested-hash` |
| M373 | a line break written as text is not found in front of the key (a nested key in a JSON string is not indented) | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `redaction-nested-hash` |
| M374 | a failed `rejects` / `resolves` assertion (vitest's own first stack frame) is not recognised: a kill reads as an error | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `round4-kill-rule` |
| M375 | the `rejects` frame rule does not require the frame to point into vitest's own package | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `round4-kill-rule` |
| M376 | the `rejects` frame is looked for on any line of the message, not its first stack frame | round 6, final fixes (scanner budget, nested hash lines, rejects assertions) | `round4-kill-rule` |
| M377 | a value that only reads as a label is judged by its shape again: the length and digit rule of a name is gone (a random key that holds a credential word is read as another credential's name) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M378 | a name after an option is left to its own reader although nothing stands behind it (`--token password:` keeps its value; the named-word rule) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M379 | a word that is nothing but a name and a separator after an option is left to its own reader although nothing stands behind it (the tail rule) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M380 | a header value that reads as a label is handed over to the reader of that "name" (`-H 'X-Api-Key: V'`) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M381 | the tail of an option's value that reads as a label is handed over to the reader of that "name" (`--token V`) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M382 | the word after an option that reads as a label is handed over when its shape is not a name's (the named-word rule) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M383 | a name after an option that a value follows after a blank may hold camel-case humps again (the tail rule: a random key is handed over as a name) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M384 | a name after an option that a value follows after a blank may hold camel-case humps again (the named-word rule) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M385 | a quote behind a header value that closes the string the key stands in is read as the opening of a value again (`-H 'X-Api-Key: V='`) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M386 | base64 padding (`==`) counts as a value glued to the separator again (the shared glued-value test: a padded key with camel-case humps is handed over as a name) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M387 | a name that starts right behind a base64 character, or behind the colon of `-u user:password`, is a name again (the tail of the value is cut there and the rest stays) | final security review (P1: an option's value after a blank that reads as a label) | `redaction-space-options` |
| M388 | a dangling label that an option's value takes (`--token e: password: S`) does not take its own value (the chain stops after the label) | final security review (P2: dangling-label chains after an option) | `redaction-space-options` |
| M389 | a quote right after the colon of `curl -u admin:"S"` does not open the password (the word ends at the quote and the password behind it stays readable) | closeout (P1: a quoted password after `-u user:` was readable in every earlier tree) | `redaction-space-options` |
| M390 | a padding `=` or `==` that only delimiters follow (`--token abcJwtDef==, next`) counts as a value glued to the separator again (the key body stays readable and only the padding is hidden) | closeout (padded-key regression against the reviewed comparator) | `redaction-space-options` |

History worth keeping: the first run of M15 **survived**. Removing the up-front declared-size check changed nothing
observable, because later checks still reported truncation with the same error code. The property that check exists for is
"refuse before doing any work", so the truncation test now uses a not-yet-existing nested restore target and asserts that no
directory is created before the truncation is detected. M15 is killed by that assertion.

Limits: 390 hand-picked mutants are not exhaustive mutation testing; they target the decisions the PRD calls out. Mutants
are text substitutions on the source, run against the full suite on the maintainer's host only.

## 4. End-to-end mutation controls (`npm run e2e-mutation-controls`)

Since round 3 the end-to-end harness uses the same kill rule as the main harness (`scripts/kill-rule.mjs`): a mutant is killed only when a test fails; a pack, build, type or syntax failure, or a run whose every failure is a timeout, is `SUSPECT` and counts as a control that did not bite. Before, any non-zero exit counted, so a planted type error printed KILLED with 0 failing tests.

`scripts/e2e-mutation-controls.mjs` proves that the packaged-binary suite (`tests/e2e/packaged-cli.test.ts`) and the
real-Chromium smoke (`tests/e2e/smoke*.spec.ts`) exercise the **shipped artifact**, not a mock. It copies the repository to a
scratch directory, applies one defect, and then runs the e2e suite there, which packs and installs a tarball from the
**mutated** copy before driving the installed binary or opening its reports in a browser. It first requires both unmutated
baselines to be green.

| ID | Defect injected | Suite that must go red |
| --- | --- | --- |
| E01 | commit SHA comparison removed | packaged binary (AC-02) |
| E02 | artifact hash verification removed | packaged binary (AC-01) |
| E03 | verdict always accepted | packaged binary (AC-05 planted failure) |
| E04 | demo fixtures dropped from the published `files` | packaged binary (tarball contents) |
| E05 | report escaping removed | browser smoke (hostile strings, AC-07/AC-09) |
| E06 | tables forced wider than a phone | browser smoke (layout at 375 px) |
| E07 | stacked-card layout for narrow screens removed | browser smoke (layout at 375 px) |
| E08 | the word of a bracket group is stripped by the exponential regular expression again | packaged binary: `bundle export` of a hostile artifact (AC-09) |
| E09 | the word of a bracket group is stripped by `/\\+$/` again (quadratic) | packaged binary: `bundle export` of a 256 KiB hostile artifact (AC-09) |
| E10 | a credential-shaped artifact is no longer flagged by the artifact scan of `bundle export` | packaged binary: a credential-shaped artifact is refused (AC-09) |

## 5. Controls for the controls

- `tests/e2e/smoke-controls.spec.ts` feeds real Chromium four deliberately bad pages (script that runs, image loaded over
  the network, table wider than the phone, unescaped markup) and requires the smoke's observers to see each fault.
- `tests/e2e/runbook-harness.test.ts` runs the automated runbook harness against three broken runbooks (wrong expected text,
  wrong exit code, wrong checksum) and requires it to fail and to name the step.
- `tests/integration/hygiene-scan.test.ts` plants every credential, path, e-mail, UUID and forbidden-file rule in a scratch
  directory and requires the repository's secret and content scan to find it, and to stay quiet on clean input.
- The "AC index" tests in `tests/proofgate.spec.ts` fail if the acceptance matrix names a test that does not exist, or marks
  AC-11 as anything but `PENDING_HUMAN_RECEIPT`.

## 6. Mutants reviewed and judged equivalent (or covered by another layer)

An independent tests review of the first round's tree listed mutants that survived a wider run than the one above. The ones that
now have a test are M70 to M77 in the table (entry hash, exact blob cap, case-sensitive environment, no vacuous accept, the
combined metadata limit, the URL refusal, the archive-name clean-up, `O_NOFOLLOW`). The rest are kept out of the table on
purpose, with the reason:

| Reviewer's mutant | Why it is not in the table |
| --- | --- |
| `--replace` refusal in the pipeline (L12) | The refusal is duplicated by `publishDirectory`, which refuses an existing target on its own; M37 removes the pipeline's own check (only-a-report) and is killed, and the other layer is covered by the archive tests. Removing one of two independent guards is not observable until the other is removed too. |
| `chmod` after `mkdir` in `ensurePrivateDir` (L10) | `mkdir` is given mode 0700 already; the `chmod` only matters under an unusual umask. The 0700/0600 assertions in the core and packaged suites would catch a missing mode, but this line alone changes nothing on a normal umask: an equivalent mutant on the platforms tested. |
| load-time redaction in `receipt.ts` (E11) | The reviewer's own packaged-binary run killed it (its test E5), and the planted-secret test in `tests/proofgate.spec.ts` covers it at the core level; it survives only when a run is restricted to the unit files. |

A survivor that is not in this table is a gap, not a judgement call.
