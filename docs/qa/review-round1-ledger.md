# Round-1 review remediation ledger

Independent review round 1 examined the MVP integration line at the reviewed tree. Every finding was fixed in
round 1 (on a line cut from that commit, which was left unchanged), or is listed at the end with a written reason.

Method for each P0 and P1: (1) a regression test was written, (2) it was run against a scratch copy of the tree at
the reviewed tree (extracted with `git archive`, new tests and helpers copied in) and **failed** (the RED proof, pasted below),
(3) it was run on the fix and **passes**, and (4) a mutation control that reintroduces the defect was added to
`scripts/mutation-controls.mjs` and must be killed by the suite (`docs/qa/negative-controls.md`). Fixes never weaken or
delete an existing test; where a test pinned old behaviour (policy engine version, report goldens) it was updated in the
same commit and said so.

**Commit ids.** The working history of this repository is squashed before publication, so its commit ids would not resolve for a reader and are not repeated in these documents: a tree is named by the round that produced it (the reviewed tree, the round-2 tree, the round-3 tree, the round-4 tree), "a history commit" stands for one commit of that working history, and evidence is given as test ids, mutant ids and dated counts. Reviewers' file names and line numbers refer to the reviewed tree.

## P0 and P1 findings

| # | Sev | Finding and source | Fix commit | Regression test | Mutation control |
| --- | --- | --- | --- | --- | --- |
| 1 | P0 | A fresh `result=fail` receipt with `total=0` was downgraded to MISSING and dropped, so it could sit beside a passing receipt and the gate exited 0. Also: zero-test `partial`/`skipped` beside a pass was ignored. Source: logic reviewer (`src/evaluate.ts:67`). | a history commit (policy engine version 2; pin follow-up a history commit) | `tests/unit/round1-decision.test.ts` (`L1: a failing receipt with zero tests is a failure, never ignorable evidence`, and the two CLI tests under `through the CLI`) | M18 (zero-test shortcut restored ahead of the fail check) |
| 2 | P1 | A failing receipt whose `finished_at` was after `--now` was ignored as `receipt_from_future`, so an older pass won. A future-dated failing or partial receipt that matches the revision now holds the requirement at FAIL or PARTIAL; a future-dated pass still counts for nothing. Source: logic reviewer (`src/evaluate.ts:55`). | a history commit | `tests/unit/round1-decision.test.ts` (`L2: a future-dated receipt never lets an older pass hide a failure`) | M19 (future-dated failure ignored again) |
| 3 | P1 | The RunProof importer ignored `execution_status` and `exit_code`: a run with `failed`, `running` or `missing` execution and `outcome: verified` became a pass. `failed` or a non-zero `exit_code` is now a `fail` result; `running`/`missing` is refused (`runproof_execution_incomplete`). The P3 that only the latest evaluation's checks count is documented in `docs/ADAPTERS.md`. Source: logic reviewer (`src/adapters/runproof.ts:52`). | a history commit | `tests/unit/round1-runproof.test.ts` (`adaptRunproofDocument honours the run's own execution result`, `through the CLI`) | M21 (failed execution or non-zero exit ignored), M22 (running/missing accepted) |
| 4 | P1 | Hostile or large YAML inside the 25 MB metadata limit (alias fan-out, 3 MB of `[`, a 24 MB block sequence) aborted the process with a V8 out-of-memory error (exit 134) instead of exit 2. The manifest is now capped at 4 MiB, budgeted at 150,000 structure nodes before the parser runs, aliases are refused, the bundle's own `manifest.json` is read as strict JSON, and every refusal is exit 2 with `limit_manifest_size`, `manifest_parse_error` or `limit_metadata_bytes`. Source: security reviewer P1-1 and performance reviewer P1 (`src/manifest.ts`). | a history commit | `tests/unit/round1-yaml-limits.test.ts` (hostile shapes under a 256 MB heap cap, byte cap, node budget, alias refusal, legitimate maximum-size manifest still accepted, bundle round trip) | M28 (byte cap removed), M29 (node budget removed), M30 (aliases allowed), M32 (bundle manifest under the YAML budget) |
| 5 | P1 | Untrusted strings (titles, ids, runner ids, environments, file names, reasons, error text) reached the terminal raw, so escape sequences and newlines could forge a `verdict: ACCEPTED` line. Every printed untrusted string now goes through `src/terminal.ts`; `--json` output escapes the same characters inside the JSON strings. Source: security reviewer P1-2 (`src/cli.ts`, `src/explain.ts`). | a history commit | `tests/unit/round1-terminal.test.ts`, `tests/unit/round1-terminal-unit.test.ts` | M33 (explain prints raw), M34 (error line raw), M35 (evaluate summary raw), M36 (`--json` leaves bidi/C1 raw) |
| 6 | P1 | Redaction skipped object keys, missed tokens preceded by `_` or another word character, ignored receipt file names and bundle paths, and had many uncovered shapes (`npm_`, `glpat-`, `SG.`, `hf_`, `ya29.`, webhook URLs, PGP blocks, PEM blocks over 8,000 characters, `--password x`, quoted-key JSON, short passwords, zero-width-split and fullwidth tokens, more key names). Keys, file names and bundle paths are redacted, boundaries use lookbehind, scanning is bounded, and the documentation now calls redaction best effort. Source: security reviewer P1-3 and P2 shape gaps (`src/redact.ts`). | a history commit | `tests/unit/round1-redaction.test.ts` (61 tests), `tests/unit/redact.test.ts` (adjusted) | M46-M55 (keys, boundary, PEM cap, quoted key, folding, first-hit stop, PGP, file names, lowercase `pass`, key collision) |
| 7 | P1 | Receipts, revisions, reports and bundle headers accepted duplicate object keys with last-wins semantics, so `{"result":"fail","result":"pass"}` was a pass. All four now refuse them with the stable code `json_duplicate_key` (exit 2). Source: security reviewer P2 (owner-elevated), duplicate JSON keys (`src/receipt.ts` and others). | a history commit | `tests/unit/round1-json-duplicates.test.ts`, `tests/unit/round1-json-duplicates-cli.test.ts` | M23-M27 (one per reader, plus the detector itself) |

### Pasted RED proofs (test file run against the tree at the reviewed tree, then against the fix)

The RED run is `npx vitest run <file>` in a scratch copy of the reviewed tree with only the new test files and helpers added; a
file that cannot import a module the fix introduced (`src/terminal.ts`) fails as a whole. Every `×` line is a failing test.
The GREEN line is the same command in the fix tree at the time of the fix commit.

#### Item 1 (P0): `r1-decision`

```text
# RED at the reviewed tree
 ❯ tests/unit/round1-decision.test.ts (15 tests | 13 failed) 111ms
   ❯ L1: a failing receipt with zero tests is a failure, never ignorable evidence (6)
     × classifies result=fail with total=0 as FAIL (not MISSING) 11ms
     × a fresh fail/zero-test receipt beside a passing receipt makes the requirement FAIL 2ms
     × a fresh zero-test result=partial beside a passing receipt keeps the requirement PARTIAL 1ms
     × a fresh zero-test result=skipped beside a passing receipt keeps the requirement PARTIAL 2ms
     × assess turns exit 0 into exit 1 when such a receipt is planted 2ms
   ❯ L2: a future-dated receipt never lets an older pass hide a failure (4)
     × an older pass plus a future-dated failing receipt is FAIL with receipt_from_future 1ms
     × an older pass plus a future-dated partial receipt is PARTIAL 1ms
     × a lone future-dated failure is FAIL, not MISSING 1ms
   ❯ L6: requirement-level all_criteria_met is claimed only by a PASS (2)
     × a two-repository requirement with one passing and one failing repository does not list all_criteria_met 1ms
     × PARTIAL by incomplete coverage does not list all_criteria_met; a full PASS does 1ms
   ❯ P6: receipts are indexed by requirement once (1)
     × decisions are identical with and without the prebuilt index 11ms
   ❯ through the CLI (exit codes on real files) (2)
     × a passing workspace is exit 0; planting a fail/zero-test receipt flips it to exit 1 48ms
     × a future-dated failing receipt beside a passing one gives exit 1 27ms
 ❯ tests/unit/round1-decision.test.ts:52:22
 ❯ tests/unit/round1-decision.test.ts:58:22
 ❯ tests/unit/round1-decision.test.ts:65:22
 ❯ tests/unit/round1-decision.test.ts:81:72
 ❯ tests/unit/round1-decision.test.ts:88:22
 ❯ tests/unit/round1-decision.test.ts:94:22
 ❯ tests/unit/round1-decision.test.ts:99:97
 ❯ tests/unit/round1-decision.test.ts:118:32
 ❯ tests/unit/round1-decision.test.ts:126:38
 ❯ tests/unit/round1-decision.test.ts:141:19
 ❯ tests/unit/round1-decision.test.ts:165:30
 ❯ tests/unit/round1-decision.test.ts:174:30
 Test Files  1 failed (1)
      Tests  13 failed | 2 passed (15)
# GREEN on the fix
Test Files  1 passed (1)
Tests  15 passed (15)
```

#### Item 2 (P1): `r1-decision`

```text
# RED at the reviewed tree
 ❯ tests/unit/round1-decision.test.ts (15 tests | 13 failed) 111ms
   ❯ L1: a failing receipt with zero tests is a failure, never ignorable evidence (6)
     × classifies result=fail with total=0 as FAIL (not MISSING) 11ms
     × a fresh fail/zero-test receipt beside a passing receipt makes the requirement FAIL 2ms
     × a fresh zero-test result=partial beside a passing receipt keeps the requirement PARTIAL 1ms
     × a fresh zero-test result=skipped beside a passing receipt keeps the requirement PARTIAL 2ms
     × assess turns exit 0 into exit 1 when such a receipt is planted 2ms
   ❯ L2: a future-dated receipt never lets an older pass hide a failure (4)
     × an older pass plus a future-dated failing receipt is FAIL with receipt_from_future 1ms
     × an older pass plus a future-dated partial receipt is PARTIAL 1ms
     × a lone future-dated failure is FAIL, not MISSING 1ms
   ❯ L6: requirement-level all_criteria_met is claimed only by a PASS (2)
     × a two-repository requirement with one passing and one failing repository does not list all_criteria_met 1ms
     × PARTIAL by incomplete coverage does not list all_criteria_met; a full PASS does 1ms
   ❯ P6: receipts are indexed by requirement once (1)
     × decisions are identical with and without the prebuilt index 11ms
   ❯ through the CLI (exit codes on real files) (2)
     × a passing workspace is exit 0; planting a fail/zero-test receipt flips it to exit 1 48ms
     × a future-dated failing receipt beside a passing one gives exit 1 27ms
 ❯ tests/unit/round1-decision.test.ts:52:22
 ❯ tests/unit/round1-decision.test.ts:58:22
 ❯ tests/unit/round1-decision.test.ts:65:22
 ❯ tests/unit/round1-decision.test.ts:81:72
 ❯ tests/unit/round1-decision.test.ts:88:22
 ❯ tests/unit/round1-decision.test.ts:94:22
 ❯ tests/unit/round1-decision.test.ts:99:97
 ❯ tests/unit/round1-decision.test.ts:118:32
 ❯ tests/unit/round1-decision.test.ts:126:38
 ❯ tests/unit/round1-decision.test.ts:141:19
 ❯ tests/unit/round1-decision.test.ts:165:30
 ❯ tests/unit/round1-decision.test.ts:174:30
 Test Files  1 failed (1)
      Tests  13 failed | 2 passed (15)
# GREEN on the fix
Test Files  1 passed (1)
Tests  15 passed (15)
```

#### Item 3 (P1): `r1-runproof`

```text
# RED at the reviewed tree
 ❯ tests/unit/round1-runproof.test.ts (13 tests | 9 failed) 58ms
   ❯ adaptRunproofDocument honours the run's own execution result (11)
     × execution_status failed with outcome verified is a failure, not a pass 3ms
     × a non-zero exit code (1) on a run that claims success is a failure 1ms
     × a non-zero exit code (2) on a run that claims success is a failure 0ms
     × a non-zero exit code (137) on a run that claims success is a failure 0ms
     × a non-zero exit code (-1) on a run that claims success is a failure 0ms
     × execution_status running is rejected with runproof_execution_incomplete 1ms
     × execution_status missing is rejected with runproof_execution_incomplete 0ms
     × a failed run with no required checks is a failure, not a skipped (ignorable) suite 0ms
   ❯ through the CLI (2)
     × a failed run that claims verified is not accepted (exit 1), a running run is malformed input (exit 2) 8ms
 ❯ tests/unit/round1-runproof.test.ts:31:28
 ❯ tests/unit/round1-runproof.test.ts:36:28
 ❯ tests/unit/round1-runproof.test.ts:51:61
 ❯ tests/unit/round1-runproof.test.ts:56:28
 ❯ tests/unit/round1-runproof.test.ts:92:67
 Test Files  1 failed (1)
      Tests  9 failed | 4 passed (13)
# GREEN on the fix
Test Files  1 passed (1)
Tests  13 passed (13)
```

#### Item 4 (P1): `r1-yaml`

```text
# RED at the reviewed tree
 ❯ tests/unit/round1-yaml-limits.test.ts (14 tests | 10 failed) 16930ms
   ❯ hostile YAML manifests are refused before the parser can exhaust memory (packaged CLI, 256 MB heap) (6)
     × 3 MB of unclosed [: exit 2 with a stable code, no abort, in bounded time 2987ms
     × a 3 MB block sequence of '- 1': exit 2 with a stable code, no abort, in bounded time 2677ms
     × a 3 MB flow sequence: exit 2 with a stable code, no abort, in bounded time 1789ms
     × a 24 MB block sequence (over the byte cap): exit 2 with a stable code, no abort, in bounded time 2022ms
     × a deeply indented block nest: exit 2 with a stable code, no abort, in bounded time 593ms
   ❯ assertYamlWithinBudget and parseManifestText (5)
     × counts an upper estimate of structure: the budget boundary is exact, and quoted text counts too 9ms
     × refuses text over the byte cap before looking at it, counting bytes not characters 1ms
     × any alias is refused with an explicit reason; anchors alone are harmless 13ms
   ❯ manifest size limits through the in-process CLI (2)
     × a 5 MB manifest is refused by size before it is read 98ms
   ❯ bundle round trip of a manifest whose default repository lists expand beyond the YAML budget (1)
     × restores a bundle of 700 requirements x 40 default repositories (the normalised manifest.json is parsed as JSON) 5766ms
 ❯ tests/unit/round1-yaml-limits.test.ts:50:44
 ❯ tests/unit/round1-yaml-limits.test.ts:50:44
 ❯ tests/unit/round1-yaml-limits.test.ts:50:44
 ❯ tests/unit/round1-yaml-limits.test.ts:50:44
 ❯ tests/unit/round1-yaml-limits.test.ts:51:26
 ❯ tests/unit/round1-yaml-limits.test.ts:61:60
 ❯ tests/unit/round1-yaml-limits.test.ts:67:71
 ❯ tests/unit/round1-yaml-limits.test.ts:76:87
 ❯ tests/unit/round1-yaml-limits.test.ts:105:26
 ❯ tests/unit/round1-yaml-limits.test.ts:130:30
 Test Files  1 failed (1)
      Tests  10 failed | 4 passed (14)
# GREEN on the fix
Test Files  1 passed (1)
Tests  14 passed (14)
```

#### Item 5 (P1): `r1-terminal`

```text
# RED at the reviewed tree
 ❯ tests/unit/round1-terminal-unit.test.ts (0 test)
 ❯ tests/unit/round1-terminal.test.ts (6 tests | 5 failed) 134ms
   ❯ plain-text output of the CLI is neutralised (6)
     × evaluate: a title with an ESC sequence and a forged verdict line prints one verdict line and no raw control characters 68ms
     × explain: title, environment, runner id and deferral reason cannot inject escapes or forge lines 15ms
     × explain --json stays valid JSON with the control characters escaped by JSON itself 15ms
     × stderr: a file name with ESC and a newline cannot forge a second error line or recolour the terminal 16ms
     × stderr: a hostile --now value, unknown command and unknown requirement id are neutralised too 3ms
 ❯ tests/unit/round1-terminal-unit.test.ts:6:1
 ❯ tests/unit/round1-terminal.test.ts:56:37
 ❯ tests/unit/round1-terminal.test.ts:71:43
 ❯ tests/unit/round1-terminal.test.ts:85:37
 ❯ tests/unit/round1-terminal.test.ts:112:38
 ❯ tests/unit/round1-terminal.test.ts:123:41
 Test Files  2 failed (2)
      Tests  5 failed | 1 passed (6)
# GREEN on the fix
Test Files  2 passed (2)
Tests  19 passed (19)
```

#### Item 6 (P1): `r1-redaction`

```text
# RED at the reviewed tree
 ❯ tests/unit/round1-redaction.test.ts (61 tests | 42 failed) 17770ms
   ❯ token boundaries: a credential glued to a word or underscore is still a credential (10)
     × redacts <a planted credential glued to a word> 8ms
     × redacts <a planted credential glued to a word> 0ms
     × redacts <a planted credential glued to a word> 0ms
     × redacts <a planted credential glued to a word> 0ms
     × redacts <a planted credential glued to a word> 0ms
     × a token longer than any fixed cap is redacted whole, not just its first 255 characters 0ms
   ❯ credential shapes that were unknown (24)
     × redacts a npm token 0ms
     × redacts a GitLab token 0ms
     × redacts a SendGrid key 0ms
     × redacts a Hugging Face token 0ms
     × redacts a Google OAuth token 0ms
     × redacts a Slack webhook 0ms
     × redacts a Discord webhook 6ms
     × redacts a Teams webhook 0ms
     × redacts a CLI flag with a value 0ms
     × redacts a CLI flag quoted 0ms
     × redacts a glued -p password 0ms
     × redacts a Cookie header 0ms
     × redacts a Set-Cookie header 0ms
     × redacts a signature parameter 0ms
     × redacts a JSON password with a quoted key 0ms
     × redacts a single-quoted key 0ms
     × redacts a a short password value 0ms
     × redacts a Authorization Basic with a space 0ms
     × keeps the surrounding text readable (the flag name and the rest of the line survive) 5ms
     × a private key of any length is redacted: PEM over 8,000 characters, PGP blocks, and a header without a footer 2ms
     × text that hides a token with zero-width characters or fullwidth letters is folded and redacted 1ms
   ❯ key names (21)
     × treats auth as sensitive 0ms
     × treats passphrase as sensitive 0ms
     × treats pass as sensitive 0ms
     × treats jwt as sensitive 0ms
     × treats signature as sensitive 0ms
     × treats connectionString as sensitive 0ms
     × treats connection_string as sensitive 0ms
     × treats secrets as sensitive 0ms
     × treats tokens as sensitive 0ms
     × treats sshKey as sensitive 0ms
     × treats ssh_key as sensitive 0ms
     × treats client_secrets as sensitive 0ms
     × the KEY TEXT is redacted too, and two secret-looking keys do not overwrite each other 1ms
   ❯ cost is bounded on hostile input (4)
     × 24 MB of repeated private-key headers is one pass (it was ~600 ms per MB) 15376ms
   ❯ file names, extension keys and bundle entries never carry a planted secret (2)
     × a token in a receipt file name, an extension key or a key with a word prefix does not reach report.json, index.html, the bundle, the restored tree or any output 1002ms
 ❯ tests/unit/round1-redaction.test.ts:39:17
 ❯ tests/unit/round1-redaction.test.ts:39:17
 ❯ tests/unit/round1-redaction.test.ts:39:17
 ❯ tests/unit/round1-redaction.test.ts:39:17
 ❯ tests/unit/round1-redaction.test.ts:39:17
 ❯ tests/unit/round1-redaction.test.ts:45:43
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:78:27
 ❯ tests/unit/round1-redaction.test.ts:83:74
 ❯ tests/unit/round1-redaction.test.ts:91:49
 ❯ tests/unit/round1-redaction.test.ts:99:41
 ❯ tests/unit/round1-redaction.test.ts:120:33
 ❯ tests/unit/round1-redaction.test.ts:131:37
 ❯ tests/unit/round1-redaction.test.ts:147:47
 ❯ tests/unit/round1-redaction.test.ts:211:105
 Test Files  1 failed (1)
      Tests  42 failed | 19 passed (61)
# GREEN on the fix
Test Files  1 passed (1)
Tests  61 passed (61)
```

#### Item 7 (P1): `r1-json`

```text
# RED at the reviewed tree
 ❯ tests/unit/round1-json-duplicates.test.ts (0 test)
 ❯ tests/unit/round1-json-duplicates-cli.test.ts (6 tests | 5 failed) 199ms
   ❯ duplicate keys are rejected through the CLI (exit 2, json_duplicate_key), never resolved (6)
     × a receipt {result: fail, result: pass} is refused instead of read as a pass 105ms
     × a duplicate nested inside a receipt's extensions is refused too 24ms
     × a revisions.json that lists a repository's commit twice under one key is refused 15ms
     × explain refuses a report.json with a repeated key, even when report.sha256 is absent 16ms
     × a bundle whose header repeats a key is refused before anything is written 31ms
 ❯ tests/unit/round1-json-duplicates.test.ts:6:1
 ❯ tests/unit/round1-json-duplicates-cli.test.ts:30:30
 ❯ tests/unit/round1-json-duplicates-cli.test.ts:43:26
 ❯ tests/unit/round1-json-duplicates-cli.test.ts:50:20
 ❯ tests/unit/round1-json-duplicates-cli.test.ts:71:20
 ❯ tests/unit/round1-json-duplicates-cli.test.ts:91:26
 Test Files  2 failed (2)
      Tests  5 failed | 1 passed (6)
# GREEN on the fix
Test Files  2 passed (2)
Tests  25 passed (25)
```

### Item 4, container proof (hostile YAML through the real CLI)

`node:22.12` container, `--cpus=2 --memory=4g --network none`, `evaluate` on a generated hostile manifest, run on the fix
and, for comparison, on the reviewed tree build. `heap` is `--max-old-space-size` (`default` is Node's own limit inside the
4 GB container). At the reviewed tree the process aborts with a V8 out-of-memory error (`SIGABRT`, exit 134 from a shell) after 16 to 28
seconds; on the fix every hostile shape is refused with exit 2 and a stable code in about 150 to 250 ms, at every heap size
tried, including 128 MB. Recorded 2026-09-29 by a local script that is not part of the repository.

```text
--- fix, --max-old-space-size=0
open    3 MB heap=0: exit=2 signal=null    168 ms  proofgate: error [limit_manifest_size]
block  24 MB heap=0: exit=2 signal=null    172 ms  proofgate: error [limit_manifest_size]
flow   24 MB heap=0: exit=2 signal=null    145 ms  proofgate: error [limit_manifest_size]
alias   1 MB heap=0: exit=2 signal=null    157 ms  proofgate: error [manifest_parse_error]
--- fix, --max-old-space-size=256
open    3 MB heap=256: exit=2 signal=null    216 ms  proofgate: error [limit_manifest_size]
block  24 MB heap=256: exit=2 signal=null    171 ms  proofgate: error [limit_manifest_size]
flow   24 MB heap=256: exit=2 signal=null    140 ms  proofgate: error [limit_manifest_size]
alias   1 MB heap=256: exit=2 signal=null    121 ms  proofgate: error [manifest_parse_error]
--- fix, --max-old-space-size=128
open    3 MB heap=128: exit=2 signal=null    136 ms  proofgate: error [limit_manifest_size]
block  24 MB heap=128: exit=2 signal=null    135 ms  proofgate: error [limit_manifest_size]
flow   24 MB heap=128: exit=2 signal=null    149 ms  proofgate: error [limit_manifest_size]
alias   1 MB heap=128: exit=2 signal=null    142 ms  proofgate: error [manifest_parse_error]
--- fix, --max-old-space-size=0
legit   1 MB heap=0: exit=2 signal=null   2514 ms  proofgate: error [limit_metadata_bytes]
--- fix, --max-old-space-size=256
legit   1 MB heap=256: exit=2 signal=null   2495 ms  proofgate: error [limit_metadata_bytes]
--- fix, --max-old-space-size=192
legit   1 MB heap=192: exit=2 signal=null   2760 ms  proofgate: error [limit_metadata_bytes]
--- fix, --max-old-space-size=128
legit   1 MB heap=128: exit=null signal=SIGABRT   1526 ms  proofgate: note: the evaluation clock is fixed by --now (2026-09-29T12:00:00.000Z); the result is rep
--- base, --max-old-space-size=0
open    3 MB heap=0: exit=null signal=SIGABRT  16498 ms  <--- Last few GCs --->
block  24 MB heap=0: exit=null signal=SIGABRT  28363 ms  <--- Last few GCs --->
```

The last rows show a legitimate manifest of 2,000 requirements x 50 repositories (100,000 pairs): it parses within the node
budget, and is then refused by the report-size ceiling (`limit_metadata_bytes`, the report would be 28.8 MB, over 25 MB);
at `--max-old-space-size=128` even that legitimate manifest exhausts the heap, so about 150 to 190 MB of heap is what a manifest
at the node budget needs (the documented figure is "well under 256 MB").

## P2 and P3 findings

`tests` names the test that fails on the reviewed tree unless the row says otherwise; the RED run of those files is pasted below the table.
"Mutation" is given where one was added; a P2 or P3 without one is covered by its test alone.

| Finding | Source | Fix commit | Test | Mutation |
| --- | --- | --- | --- | --- |
| `--replace` moved any existing directory | logic P2 | a history commit | `round1-output-safety.test.ts` (`--replace only archives a previous report`) | M37 |
| Second `--replace` under a fixed clock collided on the archive name (`output_exists`); identical inputs failed | logic P2, consistency P2, security P3 | a history commit | same file, second test | M38 |
| Requirement-level `all_criteria_met` on FAIL or PARTIAL | logic P2 | a history commit | `round1-decision.test.ts` (`L6`) | M20 |
| `readReport`/`explain` did not cross-check verdict, exit code and summary; accepted a report without `report.sha256` | logic P2, security P3 | a history commit | `round1-output-safety.test.ts` (`report.json must be self-consistent and carry its hash`) | M41, M42 |
| Receipt ids compared case-sensitively (requirement ids are folded) | logic P3 | a history commit | `round1-misc.test.ts` (`receipt ids are compared case-insensitively`) | none |
| Event envelope de-duplicated by `event_id` alone | logic P3 | a history commit | `round1-misc.test.ts` (`the event envelope de-duplicates per source`) | none |
| Fixed clock was invisible; `--now ''` fell back silently | logic P3, security P2 | a history commit | `round1-output-safety.test.ts` (`the evaluation clock is never invisible`) | M39, M40 |
| Published JSON Schemas dropped the UTC timestamp pattern | consistency P2 | a history commit | `round1-misc.test.ts` (`the published JSON Schemas carry the UTC timestamp pattern`); the rules a schema cannot express are listed in `docs/SCHEMAS.md` | none |
| ENOSPC/EDQUOT reported as `bundle_corrupt`; no free-space preflight | perf P2, security P2 | a history commit | `round1-output-safety.test.ts` (`free space and temporary output`) | M44 |
| SIGINT/SIGTERM left temporary directories behind | perf P2 | a history commit | same file (`SIGTERM in the middle of a bundle restore`) | M45 |
| Evaluation within the declared limits wrote a report no command could read (85.7 MB `report.json`, 152.7 MB `index.html`) | perf P2 | a history commit | same file (`report size ceiling`); `docs/BENCHMARK.md` documents the ceiling | M43 |
| Quadratic scan in `decideRequirement` | perf P2 | a history commit | `round1-decision.test.ts` (`P6: receipts are indexed by requirement once`) | none |
| Redaction and credential scan polynomial on hostile text; docs claimed linear time | perf P2 | a history commit | `round1-redaction.test.ts` (bounded-time cases) | M51 |
| README, SECURITY, CHANGELOG, RELEASE, DEPENDENCY-LICENSES called the licence and maintainer an open decision while the repository is public MIT | consistency P2 | a history commit | wording; the README carries the licence-decision note (MIT, holder matches the public RunProof and ScopeGuard repositories, link to the dependency audit) | n/a |
| Packed-tarball documents linked to files that were not shipped | consistency P2 | a history commit | `round1-misc.test.ts` (`the package ships the documents its README links to`); this test is green only once this ledger exists | none |
| "Optional report layer" wording; `loadRenderer` swallowed `ERR_MODULE_NOT_FOUND` | consistency P2 | a history commit (code), a history commit (`docs/REPORT.md`, `docs/OPERATIONS.md`) | the existing report tests plus the packaged E2E; the renderer is a static import | n/a |
| Two PRD requirements ("allowed content types", "fail before work when capacity is insufficient") neither implemented nor listed | consistency P2 | a history commit | documented as MVP deviations in `docs/SCHEMAS.md` (the capacity one is now largely met: statfs preflight, report ceiling, limits) | n/a |
| CLI text columns misaligned | consistency P2 | a history commit | `round1-terminal.test.ts` and the golden/CLI tests | none |
| Dead error code `manifest_invalid_commit_sha` | consistency P2 | a history commit | `tests/integration/contracts.test.ts` (every stable error code is documented in `docs/INTERFACES.md`); the code, `KIND_CODES` and the documentation rows were removed together | none |
| Internal theme comment and a ticket number in the PRD html/md/diagram copies | security P2 | a history commit | `scripts/hygiene-scan.mjs` rule `internal board or ticket reference`, `tests/integration/hygiene-scan.test.ts`; requirement text untouched | n/a |
| Unused exports (`STABLE_ERROR_CODES`, `outputName`, `ManifestInput`, `RevisionsInput`) | consistency P3 | history commits | typecheck | n/a |
| `engines >=22.12` versus the test toolchain excluding Node 25 (`EBADENGINE`) | consistency P3 | a history commit | documented in `docs/OPERATIONS.md` | n/a |
| Dockerfile used a mutable tag | consistency P3, security P3 | a history commit | base image pinned by digest; `docker build` and the image smoke are part of the gate | n/a |
| `docs/BENCHMARK.md`: one quiet-machine run, wrong hardware, Darwin kernel called macOS | perf P3, consistency P3 | a history commit | replaced by container measurements (3 rounds x 5 timings, min/median/max) and fan-out shapes | n/a |
| `REPORT.md` not in the README table; repository-only commands; optional-hook wording | consistency P3 | a history commit | wording (the README table already lists it) | n/a |
| INTERFACES redaction key list omitted `passwd`, `pwd`, `apikey`; `unsupported_schema_version` only for integers | consistency P3 | history commits | `docs/INTERFACES.md`, `docs/OPERATIONS.md` (integer versions) | n/a |
| Terminal escapes from receipts (logic P2) | logic P2 | a history commit | item 5 above | M33-M36 |

### Pasted RED proofs for the P2 and P3 test files

```text
# round1-output-safety.test.ts, RED at the reviewed tree
 ❯ tests/integration/round1-output-safety.test.ts (17 tests | 14 failed) 5640ms
   ❯ --replace only archives a previous report, and archive names never collide (3)
     × refuses to move a directory that is not a ProofGate report (no report.json) and leaves it untouched 95ms
     × a second and third --replace with identical inputs and a fixed clock each succeed with distinct archives 52ms
   ❯ the evaluation clock is never invisible (4)
     × the report records where the clock came from: flag, env or system 18ms
     × warns on stderr when --now or PROOFGATE_NOW freezes the clock, and leaves stdout unchanged 34ms
     × --now with an empty value is an error, never a silent fallback to the system clock; an empty PROOFGATE_NOW is unset 61ms
   ❯ report.json must be self-consistent and carry its hash (4)
     × a report edited to say accepted while a mandatory requirement fails is refused by explain and bundle export 39ms
     × summary counts that do not follow from the decisions are refused too 60ms
     × a report without report.sha256 is refused (it cannot be shown to be unmodified), by directory and by file path 44ms
   ❯ report size ceiling (enforced before the HTML page is rendered) (2)
     × serializeReportWithinLimit refuses a report larger than the limit that the readers accept 2ms
     × an evaluation whose requirements x repositories fan-out makes report.json unreadable fails early, writes nothing and names the reason 3193ms
   ❯ free space and temporary output (4)
     × assertFreeSpace refuses an impossible size before anything is written, and passes a tiny one 2ms
     × isNoSpace recognises ENOSPC and EDQUOT only 0ms
     × cleanupTempPathsSync removes exactly the tracked in-flight paths 2ms
     × SIGTERM in the middle of a bundle restore leaves no temporary directory behind and exits 143 1788ms
 ❯ tests/integration/round1-output-safety.test.ts:39:20
 ❯ tests/integration/round1-output-safety.test.ts:52:43
 ❯ tests/integration/round1-output-safety.test.ts:78:69
 ❯ tests/integration/round1-output-safety.test.ts:91:25
 ❯ tests/integration/round1-output-safety.test.ts:101:20
 ❯ tests/integration/round1-output-safety.test.ts:140:20
 ❯ tests/integration/round1-output-safety.test.ts:151:86
 ❯ tests/integration/round1-output-safety.test.ts:160:28
 ❯ tests/integration/round1-output-safety.test.ts:175:60
 ❯ tests/integration/round1-output-safety.test.ts:187:44
 ❯ tests/integration/round1-output-safety.test.ts:199:18
 ❯ tests/integration/round1-output-safety.test.ts:205:12
 ❯ tests/integration/round1-output-safety.test.ts:218:5
 ❯ tests/integration/round1-output-safety.test.ts:254:25
 Test Files  1 failed (1)
      Tests  14 failed | 3 passed (17)
# GREEN on the fix
Test Files  1 passed (1)
Tests  17 passed (17)
```

```text
# round1-misc.test.ts, RED at the reviewed tree
 ❯ tests/integration/round1-misc.test.ts (11 tests | 10 failed) 824ms
   ❯ receipt ids are compared case-insensitively (2)
     × two receipt documents whose ids differ only in case are refused (exit 2, receipt_duplicate_id) 49ms
   ❯ the event envelope de-duplicates per source (2)
     × two sources may reuse an event id: neither is a duplicate or a conflict of the other 2ms
     × the strict variant names the source in the conflict 2ms
   ❯ the published JSON Schemas carry the UTC timestamp pattern (6)
     × receipt.json rejects finished_at yesterday 25ms
     × receipt.json rejects finished_at 2026-09-29 11ms
     × receipt.json rejects finished_at 2026-09-29T12:00:00+02:00 12ms
     × receipt.json rejects finished_at 2026-09-29 12:00:00Z 7ms
     × receipt.json rejects finished_at 2026-09-29T12:00:00.1234Z 7ms
     × every timestamp field in the published schemas has a pattern 2ms
   ❯ the package ships the documents its README links to (1)
     × every relative markdown link in README.md points at a file that is in the packed tarball 692ms
 ❯ tests/integration/round1-misc.test.ts:28:20
 ❯ tests/integration/round1-misc.test.ts:60:77
 ❯ tests/integration/round1-misc.test.ts:70:81
 ❯ tests/integration/round1-misc.test.ts:94:31
 ❯ tests/integration/round1-misc.test.ts:102:26
 ❯ tests/integration/round1-misc.test.ts:115:21
 Test Files  1 failed (1)
      Tests  10 failed | 1 passed (11)
# GREEN on the fix: 10 pass; the README-links test needed this ledger to exist (it passes once this file is committed)
```

## Second wave: fold-ins from the independent QA, edge-case, conformance and tests reviews

These arrived after the first remediation was gated (the round-1 tree). Same method: a test that fails on the reviewed tree where
the defect existed there, and a mutation control. RED numbers below are for the new test file run against a scratch copy of
the reviewed tree (new helpers copied in); a pin for a mutant that already passed on the reviewed tree says so and names the mutant that proves
it bites (`scripts/mutation-controls.mjs`; the full 77-mutant run is recorded in `gate-evidence.md`).

| Finding | Source | Fix commit | Test | RED at the reviewed tree | Mutation |
| --- | --- | --- | --- | --- | --- |
| P1 credential shapes: Twilio keys, Azure `AccountKey=`, `Authorization: Digest/Basic` values, cookies, JSON password in free text, tokens glued to a word (`build_ghp_...`, `xAKIA...`); the planted-secret list only held shapes the redactor already knew | edge-case review | a history commit | `tests/unit/round2-redaction-shapes.test.ts`; `tests/helpers/fake-secrets.ts` (new shapes plus `FAKE_CONTEXT`); planted workspace in `tests/proofgate.spec.ts` | 14 of 15 fail (four of them, Twilio, Azure, Digest and a glued AWS key id, also failed on the round-1 tip the round-1 tree) | M56, M57, M58, M59 |
| P2 an option given twice evaluated only the last value (`--receipts A --receipts B` dropped a failing `A` and reported PASS); empty values; empty `--now` and empty `PROOFGATE_NOW` | edge-case review | a history commit | `tests/integration/round2-cli-safety.test.ts` (failing-directory-first and -last scenarios) | 17 of 19 fail (whole file) | M60, M61, M67 |
| P2 `--output` equal to, containing or inside an input let `--replace` move the operator's own receipts and manifest aside; empty `--output` | edge-case review | a history commit | same file (`--output may not be, contain or lie inside an input`), including `.` and a symlinked spelling | included above | M62 |
| P2 an unhandled stdout EPIPE (`evaluate ... \| true`) and any uncaught exception exited 1, the code for "policy unsatisfied", with a stack trace | edge-case review | a history commit | same file (`process-level failures never use exit status 1`: closed stdout for an accepted and an unsatisfied run, and a late uncaught exception) | included above | M63, M64 |
| P3 `EACCES`/`EROFS`/`ENOTDIR` on the output parent reported as `internal_error`; a losing parallel restore reported as a corrupt bundle | edge-case review, conformance review | a history commit | same file (`output failures are output_unwritable`), and `tests/unit/round2-io-failures.test.ts` | included above; io file 9 of 16 fail | M65, M68 |
| P2 receipt-looking files with a wrong-case suffix (`x.RECEIPT.JSON`) silently ignored | conformance | a history commit | same file (`a receipt-looking file that is not read is named on stderr`) | included above | M66 |
| P3 `evaluate` without `--output` printed a verdict and wrote nothing without saying so | conformance | a history commit | same file | included above | M69 |
| P2 symlinked receipts root followed, links under it refused: documented and tested | conformance | a history commit | same file (`a symlinked receipts ROOT is followed`), `docs/INTERFACES.md` | passes on the reviewed tree (the behaviour was right, the documentation was missing) | n/a |
| Metamorphic decision properties: non-passing receipts never improve a decision, failing and future-dated failing receipts force FAIL, order never matters, a zero-test pass proves nothing | tests reviewer | a history commit | `tests/unit/round2-decision-properties.test.ts` (400 seeded rounds per property) | 3 of 7 fail; the P0/P1 mutants M18, M19, M07 and M08 are killed by this file alone | M07, M08, M18, M19 (checked against the properties) |
| Zero-test fail/partial/skipped had no test at core and packaged level; `decision.test.ts` title overstated | tests reviewer | a history commit | `tests/proofgate.spec.ts` and `tests/e2e/packaged-cli.test.ts` (`zero tests with result fail, partial or skipped is never ignorable`) | core test fails on the reviewed tree (`fail alone: expected 'MISSING' to be 'FAIL'`); the packaged variant drives the same code through the installed binary | M18 |
| P2 requirement details stacked into about 20,900 px of cards at 375 px | conformance | a history commit | `tests/unit/round2-report-details.test.ts`; regenerated goldens | 3 of 3 fail | none (layout) |
| Survivors A22 (entry hash), A38 (blob cap `>` vs `>=`), A63 (environment case), A17 (vacuous accept), L2 (combined limit), A30 (URL guard), A34 (`O_NOFOLLOW`) | tests reviewer | a history commit | `tests/integration/round2-boundaries.test.ts`, `tests/unit/round2-io-failures.test.ts` | boundaries: 0 of 13 fail on the reviewed tree (they pin defences that existed); each pin kills its mutant | M70-M75, M77 |
| A real defect found while writing the storage-failure tests: a finished temporary report directory was left behind when no archive name was free | this remediation | a history commit | `tests/unit/round2-io-failures.test.ts` (`running out of archive names`) | fails on the reviewed tree | M76 |
| Weak tests: `explain` refusal used garbage JSON (never reached the hash check); only 8 truncation cuts; prototype-key test hit the depth limit first; static network scan missed `import "node:https"`; spawn failures reported as status 1; per-file coverage floors | tests reviewer | a history commit | edited tests in `tests/e2e/packaged-cli.test.ts`, `tests/proofgate.spec.ts`, helpers; `vitest.config.ts` (per-file floors, verified to be enforced) | n/a (test strength) | n/a |
| AC-06 must be PARTIAL (fixture-only RunProof importer); AC-03 PARTIAL until independently confirmed; AC-08 connector clause is nearly vacuous | conformance, tests reviewer | history commits | `tests/proofgate.spec.ts` AC-index tests (the matrix vocabulary and ids) | n/a | n/a |
| Documentation: runbook step 3 (absolute path, readable failure), no "release notes" that do not exist, drill sheet gains source commit and evidence-retention fields, tarball SHA-256 is toolchain-specific, redaction limits (bare hex keys and free-text passwords are not redacted), `report.sha256` is a canonical-JSON hash, demo clock note, status wording, licence holder line, PRD copy status line | QA runner, conformance | a history commit | runbook step 3 snippet exercised for unset, relative, unreadable, mismatching and matching input | n/a | n/a |

Requirement-details measurement (real Chromium, `file://`, the unsatisfied demo report): page height at 375 px went from 20,798 px
to 19,883 px and at 1,440 px stays 7,375 px; the detail cards themselves went from 4,133 px to 3,218 px. That is a modest gain, not the
dramatic collapse asked for: without script the page cannot fold by width, so a cleanly passing requirement is folded on every width and
the rest stay open (five of the seven demo requirements need attention). The remaining height is the requirements table and the receipts
table stacked as cards; folding those is left as a follow-up.

## Not changed, and why

- **Bundle export reads an artifact fully into memory twice** (perf P3: a 245 MB artifact took 667 MB RSS). Bounded by the
  250 MB blob cap and well inside 4 GB; streaming the credential scan in overlapping windows would add a boundary-spanning
  edge case to the one path that must not miss a credential. Left as is; recorded in `docs/BENCHMARK.md`.
- **Redaction runs three times over the data** (perf P3). Now that each pass is bounded, this is a constant factor and not a
  risk; merging the passes would couple three otherwise independent checks.
- **`hashConfined` reads to end of file rather than to the `lstat` size, `O_NOFOLLOW` covers only the final path
  component, and a hard link to an outside file is accepted when its hash matches** (security P3). All three need a local
  writer racing the run, or the file's owner, which is the documented trust model (`docs/OPERATIONS.md`, security notes:
  the local OS user is trusted and the receipts directory must not be writable by another party while ProofGate runs).
- **The RunProof importer drops a `__proto__` key from a run** (security P3). The key is dropped, never used, and no
  decision reads it; the alternative (refusing the document) would reject a run over a field ProofGate ignores anyway.
- **`supersedes.assessment_id` can equal the new report's own id** when identical inputs are re-evaluated under a fixed clock
  (logic P3, consistency P3). This follows from the assessment id being a deterministic hash of the inputs, which is what
  makes bundle re-evaluation checkable; the archive name no longer depends on it.
- **PRD section 7 "territories" and the `n/a` status wording differ from the implementation** (consistency P3). The PRD copy is
  a frozen source document; this round only removed the internal theme comment and the ticket number and did not change
  requirement text. The differences remain; a PRD revision, not this branch, is where they get resolved.
- **The author e-mail in public history** (security P2) is the accepted convention, the same as the public RunProof and
  ScopeGuard repositories. No change.

## Re-review wave: independent re-review of the round-1 fixes, fixed in round 2

Three independent reviewers re-reviewed the round-1 fix (conformance, logic and
security; their reports are not kept in the repository). The round-1 line then moved on to
the round-2 review tree (a second wave written afterwards by the same author; its full gates were **never
run**). The round-2 line was cut from the round-2 review tree and leaves both earlier lines unchanged.

Every finding is mapped below. **IN the round-2 review tree** means the fix already existed there and was re-verified by the current
maintainer by running its regression test or a probe against a clean extract of the round-2 review tree (the probe output is pasted under
"Probes at the round-2 review tree"). **NOT YET** means the defect was still present at the round-2 review tree (shown by a RED run or a probe) and is fixed
here. **PARTLY IN** is both: the part that existed is named, and the rest is fixed here.

Fix commits in round 2 (all after the round-2 review tree):

- a commit of the working history: linear-time redaction steps (`src/redact.ts`), chunked folding, terminal and page text rewriting, `src/charclass.ts`;
- a commit of the working history: RunProof integer exit codes, JSON container budget, values JSON cannot express, look-alike receipt files, `EMFILE`;
  the tests for both commits, and the regenerated `schemas/runproof-run-detail.json`;
- commits of the working history: tests, the AC index tests, the look-alike change in `pipeline-report.test.ts`, key-block and password
  literals built from fragments so the secret scanner stays clean;
- a commit of the working history: mutation controls M78 to M101 and the retargeted controls, and the stricter kill rule;
- the commit that adds this section: documentation (README, INTERFACES, OPERATIONS, SECURITY, SCHEMAS, ADAPTERS, RELEASE, HUMAN-DRILL, BENCHMARK, CHANGELOG,
  the acceptance matrix, negative controls) and this ledger section.

### Mapping table

| # | Sev | Finding (source) | At the round-2 review tree | Fix in round 2 | Regression test | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| CF-1 | P1 | AC-06 recorded PASS although the RunProof importer is fixture-only (conform, logic) | **IN**: a history commit set AC-06 and AC-03 to PARTIAL; verified by reading the matrix at the round-2 review tree (row and section say PARTIAL). What was missing is the pinned assertion and the "BLOCKED upstream, owner decision pending" wording in ADAPTERS and README | the docs commit (docs) and the new AC index test | `tests/proofgate.spec.ts :: AC index ... > AC-03 and AC-06 stay PARTIAL until independently resolved ...` (RED at the round-2 review tree: ADAPTERS and README lack the blocker wording) | M101 |
| CF-2 | P1 | Drill sheet: tarball from the FINAL SHA, source-commit field, who computes the checksum, transcript retention (conform) | **PARTLY IN**: a history commit added the source-commit field, the retention field and "the person who builds the tarball computes the checksum". NOT YET: "a drill on any other commit, docs-only commits included, does not count", "step 4 needs network access" | the docs commit `docs/HUMAN-DRILL.md` | AC index test `AC-11 is PENDING_HUMAN_RECEIPT ...` (new assertions on the sheet; RED at the round-2 review tree) | none (documentation) |
| CF-3 | P1 | `bundle restore` into an unwritable target reports `bundle_corrupt`; `evaluate` reports `internal_error` (conform, security P2) | **IN**: a history commit maps EACCES/EROFS/EPERM/ENOTDIR/... to `output_unwritable` in restore, evaluate and export. Probe at the round-2 review tree: restore exit 2 `output_unwritable`, evaluate exit 2 `output_unwritable`. NOT YET: `EMFILE` and `ENFILE` | a history commit | `round3-input-refusals :: output failures are output_unwritable in every writer` (restore and evaluate cases pass at the round-2 review tree, the EMFILE and ENFILE cases fail) | M65 (existing), M98 |
| CF-4 | P2 | Runbook step 2 does not say the tarball path must be absolute; step 3 fails with a stack trace (conform) | **IN**: a history commit; verified by reading `docs/RUNBOOK-SMOKE.md` steps 2 and 3 at the round-2 review tree (absolute path stated, readable `STOP:` messages) | none needed | `tests/e2e/runbook-harness.test.ts` (existing) | none |
| CF-5 | P2 | RELEASE says 17 mutation-control defects, the repo has more (conform) | NOT YET | the docs commit RELEASE names the two scripts and no number | none (documentation) | none |
| CF-6 | P2 | SCHEMAS versioning policy vs the new required `clock_source` without a bump (conform, logic P2) | NOT YET | the docs commit documented pre-release exception in `docs/SCHEMAS.md`; earlier pre-release reports and bundles must be regenerated | none (documentation) | none |
| CF-7 | P2 | AC-09 row and CHANGELOG lack the best-effort caveat (conform) | NOT YET | the docs commit matrix AC-09 row, CHANGELOG line | AC index test `AC-03 and AC-06 stay PARTIAL ...` (also asserts the caveat) | none |
| CF-8 | P2 | "Mission Control" in the public PRD copies and `docs/ADAPTERS.md` (conform) | NOT YET | the docs commit `docs/ADAPTERS.md` genericised. **The two PRD copies (`docs/prd/proofgate.md`, `.html`) are NOT changed**: they are frozen source documents and changing the sentence changes requirement text. Owner decision (genericise the copies, or accept the name) is still open | none | none |
| CF-9 | P2 | BENCHMARK quotes another reviewer's 2.8 s with no receipt (conform) | NOT YET | the docs commit sentence removed; the page also says its figures predate the redaction rewrite and were not re-measured | none (documentation) | none |
| CF-10 | P3 | README "Zero tests is MISSING" (conform) | NOT YET | the docs commit README and OPERATIONS say a zero-test `pass` claim is MISSING, `fail` is FAIL, `partial`/`skipped` is PARTIAL | none (documentation) | none |
| CF-11 | P3 | INTERFACES prose omits `apikey` (conform) | NOT YET | the docs commit | none (documentation) | none |
| CF-12 | P3 | Docs do not say `--output` omitted writes no report (conform) | NOT YET | the docs commit `docs/INTERFACES.md` | none (documentation; the stderr note has M69) | M69 (existing) |
| CF-13 | P3 | Drill prep omits network for step 4 (conform) | NOT YET | the docs commit (with CF-2) | AC-11 test | none |
| CF-14 | P3 | `"private": true` blocks `npm publish`, undocumented (conform) | NOT YET | the docs commit RELEASE note | none (documentation) | none |
| CF-15 | P3 | ADAPTERS pins RunProof `5e2f9af`, public main is `e442ea6` (conform) | NOT YET | the docs commit pin note added | none (documentation) | none |
| LG-1 | P1 | A repeated single-value flag keeps the last value: `--receipts A(failing) --receipts B(passing)` is ACCEPTED (logic, security P1) | **IN**: a history commit. Probe at the round-2 review tree: `--receipts unsatisfied --receipts happy` and the reverse order both exit 2 `cli_usage`, `accepted=false`; `round2-cli-safety` passes | none needed | `round2-cli-safety :: every option takes exactly one value ...` (existing, 5 tests) | M60, M61, M67 (existing) |
| LG-2 | P1 | RunProof `exit_code` non-numeric (`"1"`, true, {}, [], "") imports as PASS (logic) | NOT YET | a history commit `src/schemas.ts` (`exit_code`/`exitCode`: integer or null), `src/adapters/runproof.ts` | `round3-runproof-exit-code` (RED: 15 of 16 fail at the round-2 review tree) | M78, M99 |
| LG-3 | P1 | EPIPE on stdout exits 1 with a stack trace (logic, security P2) | **IN**: a history commit. Probe at the round-2 review tree: through a closed stdout an accepted run exits 0 and an unsatisfied run exits 1, no stack; `round2-cli-safety` (closed stdout, uncaught exception) passes | none needed | `round2-cli-safety :: process-level failures never use exit status 1` (existing) | M63, M64 (existing) |
| LG-4 | P1 | AC-06 PASS (logic) | same as CF-1 | | | |
| LG-5 | P2 | Look-alike receipt files silently ignored: `x.Receipt.JSON`, `.bak`, `.jsonl`, `x.json` (logic, conform) | **PARTLY IN**: a history commit names a wrong-case suffix in a stderr note (verdict unchanged). Probe at the round-2 review tree: `x.Receipt.JSON` exit 0 with a note; `x.receipt.json.bak`, `x.receipt.jsonl`, `x.json` exit 0 with nothing | a history commit `src/receipt.ts`: refused with the new code `receipt_lookalike_file` (exit 2); a JSON file that a receipt names as its artifact is allowed | `round3-input-refusals :: a failing receipt saved under a name that is not read is refused, not ignored` (RED: 9 names give exit 0), `round2-cli-safety` (updated) | M66 (retargeted) |
| LG-6 | P2 | `clock_source` required at schema 1 breaks old reports; undocumented (logic) | NOT YET | the docs commit (CF-6) | none (documentation) | none |
| LG-7 | P2 | AC-03 wording: zero-test fail is FAIL, partial/skipped PARTIAL, pass claim MISSING (logic) | NOT YET | the docs commit matrix AC-03, README, OPERATIONS | none (documentation; the behaviour is tested by `round1-decision` and `round2-decision-properties`) | M07, M18 (existing) |
| LG-8 | P3 | `--replace` archives any directory holding a `report.json`, even a bogus one, and loses `supersedes` provenance (logic) | NOT YET | **NOT changed.** Archiving is a move, never a delete, and the alternative (refusing to replace a damaged report) would block the operator from replacing exactly the output that needs replacing. The bogus report is kept as `<output>.superseded-unreadable-<id>` | none | none |
| SC-1 | P1 | Repeated `--receipts` drops evidence (security) | **IN** (LG-1) | | | |
| SC-2 | P1 | JWT regex quadratic: `'eyJ_'.repeat(n)`, 256 KB = 19.6 s; regression (security) | NOT YET (probe at the round-2 review tree: 64 KB 1.13 s) | a history commit JWT found by a scanner that measures each run once and resumes after it; every other pattern audited | `round3-redaction-scaling :: hostile-input matrix ...` (RED: `jwt: eyJ_ repeated` 53 s, `jwt: eyJ- repeated` 63 s, `non-ASCII: jwt with zero-width` 36 s) | M79 |
| SC-3 | P1 | Non-ASCII fold: `out += ch` plus NFKC; 8M U+FDFA (24 MB receipt) exits 134 at a 256 MB heap; regression (security) | NOT YET (RED: the process is killed by an abort at 48 MB and at 256 MB; the test helper reports a killed process as -1, a shell shows 134) | a history commit chunked folding cut at points where NFKC cannot change the result, chunks examined with a carried tail and never held whole, folded budget of 32 Mi characters (over it the string is redacted whole), `String.replace` instead of per-character loops | `round3-hostile-memory :: non-ASCII text does not exhaust memory during redaction` (3 tests), `round3-redaction-shapes :: hidden credentials in strings` | M83, M84, M50 |
| SC-4 | P1 | Assignment and flag values redacted only to 300 characters; the tail is printed (security) | NOT YET (probe at the round-2 review tree: all five forms leak the last 30 characters) | a history commit values consumed whole; quoted values end at the closing quote; `Authorization` to end of line | `round3-redaction-shapes :: values of any length are consumed whole ...`, `where a value ends` | M80, M81, M82, M57 |
| SC-5 | P1 | `--json` per-character escaping needs about 46 bytes per character; a 5,000-requirement report exits 134 at 256 MB; regression (security) | NOT YET (RED: aborted at 256 MB, no output) | a history commit `escapeJsonForTerminal` rewrites with `String.replace` per 256 KB piece and an array join; the page's `displayText` the same | `round3-hostile-memory :: evaluate --json on a large report does not exhaust memory` (2 tests), `round3-terminal-escape` (differential against the old implementation) | M96, M100, M36 |
| SC-6 | P2 | EPIPE (security) | **IN** (LG-3) | | | |
| SC-7 | P2 | `--replace` archives the operator's own inputs when `--output` contains them (security) | **IN**: a history commit. Probe at the round-2 review tree: `--output` containing the inputs with `--replace` exits 2 `output_overlaps_input`, inputs still in place | none needed | `round2-cli-safety :: --output may not be, contain or lie inside an input ...` (existing, 6 tests) | M62 (existing) |
| SC-8 | P2 | Key redaction quadratic: `redactString(key)` recomputed in the collision loop (security) | NOT YET (RED: 20,000 keys took 186 s) | a history commit redacted key computed once, per-base counter | `round3-redaction-shapes :: key redaction is linear ...` | M86, M55 |
| SC-9 | P2 | Credential shapes still unredacted and partial values (security) | **PARTLY IN**: at the round-2 review tree `SK`+32 hex, `AccountKey=`, `Authorization: Digest` and a letter-glued `AKIA` are redacted (a history commit; probe output below). NOT YET: `AC`+32 hex, `pwd=`, `DB_PASS=`, `private_key=`, `private_key_id`, Docker `auth`, `dop_v1_`, `shpat_`, `key-<32 hex>`, short `Bearer`, `{"password": "a b c"}` (tail printed), `password=abc;def` (tail printed) | a history commit all of them; `xAKIA` glued to a letter stays redacted | `round3-redaction-shapes :: credential shapes that were still unknown (P2)`, `where a value ends` | M88, M89, M92, M93, M94, M95, M58, M59 |
| SC-10 | P2 | Key-name layer does not fold (zero-width, soft hyphen, fullwidth; `accountKey`, `dbPass`) (security) | NOT YET (probe at the round-2 review tree: all six unchanged) | a history commit key names also tested in folded form; `account_key`, `shared_access_key`, `pass` in longer names | `round3-redaction-shapes :: key names, including folded spellings (P2)` | M87, M89, M54 |
| SC-11 | P2 | Bundle artifact scanner misses zero-width-split, fullwidth and UTF-16 credentials (security) | NOT YET (probe at the round-2 review tree: `[]` for all three) | a history commit each 1 MiB window also read as UTF-8 with hidden characters removed and fullwidth letters folded, and as UTF-16 (both byte orders, both alignments) when it holds a run of UTF-16 ASCII; base64, hex, percent-encoding and compression are documented as not covered | `round3-redaction-shapes :: the bundle artifact scanner examines encodings that hide a credential (P2)` | M90, M91 |
| SC-12 | P2 | JSON of many tiny containers (3M empty arrays, 9 MB) exits 134 at 256 MB (security) | NOT YET (RED: aborted at 256 MB) | a history commit `src/json.ts`: containers counted in one pass before `JSON.parse`, limit 500,000, code `limit_json_containers` (receipts, revisions, reports, bundle headers) | `round3-hostile-memory :: a JSON document of millions of tiny containers is refused, not parsed`, `round3-input-refusals :: the JSON container budget` | M85 |
| SC-13 | P2 | Only ENOSPC was un-mislabelled (security) | **PARTLY IN** (CF-3) | a history commit EMFILE and ENFILE | as CF-3 | M98 |
| SC-14 | P3 | Redaction rewrites token-looking identifiers, making the document invalid (a requirement id or repository name that contains an `sk-` prefixed word of 20 or more characters) (security) | NOT YET | **NOT changed.** The document is refused (exit 2, fail closed) rather than an identifier that looks like a credential being printed into a report. A skip-list for schema-constrained fields would make a real token used as an id appear in the report. The message names the field | none | none |
| SC-15 | P3 | `.inf`, `.nan`, `1e400` in extensions give `internal_error`; `!!set`/`!!omap` collapse in the hash (security) | NOT YET (probe at the round-2 review tree: exit 2 `internal_error` for the first three; `!!set {a, b}`, `!!set {c}` and `!!omap` give one manifest hash) | a history commit `assertPlainJson`: `manifest_schema_invalid` / `receipt_schema_invalid` for Infinity/NaN and for YAML `!!set`, `!!omap`, `!!binary`, `!!timestamp` | `round3-input-refusals :: values JSON cannot express are refused with a stable code ...` (9 manifest cases, one receipt case) | M97 |

**Count.** 38 mapped findings (15 conformance, 8 logic, 15 security). NOT YET at the end of this branch: **0** with a code or
documentation fix outstanding. Deliberately **not changed, with reasons above: 3** (LG-8, SC-14, and the PRD-copy half of CF-8).
Findings already in the round-2 review tree and re-verified: CF-3 (restore/evaluate), CF-4, LG-1, LG-3, SC-7 in full, and CF-1, CF-2, LG-5, SC-9,
SC-13 in part. LG-4, SC-1 and SC-6 are duplicates of CF-1, LG-1 and LG-3.

### What still cannot be claimed

- Nothing in this branch is an independent receipt. The heavy gates (host gate, Node 22.12 gate, Docker smoke) were not run by
  the maintainer before this section was written; see `gate-evidence.md` for what has been run.
- AC-03 and AC-06 stay PARTIAL (AC-06 regardless: the RunProof half is blocked upstream and the owner decision is pending). AC-11
  stays `PENDING_HUMAN_RECEIPT`.
- The mutation controls M78 to M101 were checked by targeted runs only (`negative-controls.md`); the full 101-mutant run is a gate
  step.
- **Design deviation, stated plainly.** The design called for `src/redact.ts` to be ONE linear pass. It is a fixed pipeline of about
  25 steps, each linear on its own (bounded quantifiers, runs that a match consumes whole, scanners that resume after what they
  consumed, literal-prefix guards), run one after another; that is linear in the text, but it is not a single scan. Merging them
  into one automaton was not done: it would couple 25 independently tested shapes and change which shape wins where two overlap,
  for no measured gain. The claim "linear" rests on the hostile-input matrix and the property test, not on a proof.
- Redaction remains best effort: no secret without a known shape or name is recognised, base64/hex/percent-encoded or compressed
  credentials in artifacts are not found, and the hostile-input matrix proves scaling on the shapes it lists, not for every
  possible pattern.

### Probes at the round-2 review tree (single CLI runs against a clean extract of the commit)

Redaction probe (`redactString` and friends from the the round-2 review tree build; times are for one call):

```text
jwt 64k (eyJ_ x 16384)            1127 ms       (32 KB: 276 ms; the reviewer measured 19.6 s at 256 KB)
long value after password=, "client_secret": ", Authorization: Basic, token:, --password:   the last 30 characters of a 600-character value are printed (LEAK)
20,000 distinct token-shaped keys 186 s (test run); 1,000 keys 366 ms
shape twilioSK (SK+32 hex)                 "[REDACTED]"                                   IN
shape AccountKey=<86 chars>==;             "AccountKey=[REDACTED];"                       IN
shape Authorization: Digest username=...   "Authorization: [REDACTED]"                   IN
shape AC+32 hex, pwd=, DB_PASS=, private_key=, "private_key_id", Docker "auth", dop_v1_, shpat_, key-<32 hex>, "Bearer abc123":   UNREDACTED (each)
shape {"password": "correct horse battery staple"}   {"password": "[REDACTED] horse battery staple"}
shape password=abc;defghi                            password=[REDACTED];defghi
isSensitiveKey: pass<zero-width>word, fullwidth password, to<soft hyphen>ken, accountKey, AccountKey, dbPass:   false (each)
scanBufferForCredentials: token split by zero-width, in fullwidth letters, as UTF-16LE:   [] (each)
```

Single-CLI probes of the findings that the round-2 review tree already claims to fix (demo fixtures, fixed clock):

```text
1 repeated --receipts (unsatisfied then happy): exit 2 code cli_usage accepted=false
1 repeated --receipts (happy then unsatisfied): exit 2 code cli_usage accepted=false
1 control: happy alone exit 0, unsatisfied alone exit 1
2 EPIPE (accepted): cli=0
2 EPIPE (unsatisfied): cli=1
3 --replace with --output containing the inputs: first exit 0, second exit 2 code output_overlaps_input, inputs still there=true
4 export exit 0; restore into unwritable parent: exit 2 code output_unwritable; evaluate: exit 2 code output_unwritable
5 look-alike x.Receipt.JSON: exit 0 code - note=true
5 look-alike x.receipt.json.bak: exit 0 code - note=false
5 look-alike x.receipt.jsonl: exit 0 code - note=false
5 look-alike x.json: exit 0 code - note=false
```

Extension probe (manifest with `extensions: {x-a: <value>}`, the round-2 review tree build): `.inf`, `.nan` and `1e400` exit 2 with
`internal_error: canonical JSON cannot encode a non-finite number`; `!!set {a, b}`, `!!set {c}` and `!!omap [a: 1]` all exit 0 with the same manifest hash.

### RED at the round-2 review tree, GREEN in round 2

Method as above: the new and changed test files were copied into a clean `git archive` extract of the round-2 review tree (with its own
`node_modules` link) and each was run there with `npx vitest run <file>`; every `×` line is a failing test at the round-2 review tree.
GREEN is the same file on this branch.

```text
# RED at the round-2 review tree: npx vitest run tests/unit/round3-runproof-exit-code.test.ts   (2026-09-29T14:04:26.808Z to 2026-09-29T14:04:37.026Z)
  FAIL exit_code the string '1' is runproof_schema_invalid, not a pass
  FAIL exit_code the string '137' is runproof_schema_invalid, not a pass
  FAIL exit_code the string '0' is runproof_schema_invalid, not a pass
  FAIL exit_code the boolean true is runproof_schema_invalid, not a pass
  FAIL exit_code the boolean false is runproof_schema_invalid, not a pass
  FAIL exit_code an empty object is runproof_schema_invalid, not a pass
  FAIL exit_code an empty array is runproof_schema_invalid, not a pass
  FAIL exit_code the empty string is runproof_schema_invalid, not a pass
  FAIL exit_code a non-integer number is runproof_schema_invalid, not a pass
  FAIL the camelCase spelling is checked the same way
  FAIL exit_code the string '1'
  FAIL exit_code the boolean true
  FAIL exit_code an empty object
  FAIL exit_code an empty array
  FAIL exit_code the empty string
Tests  15 failed | 1 passed (16)
```

```text
# RED at the round-2 review tree: npx vitest run tests/unit/round3-redaction-shapes.test.ts   (2026-09-29T14:04:37.027Z to 2026-09-29T14:09:00.363Z)
  FAIL password=
  FAIL quoted JSON client_secret
  FAIL Authorization: Basic
  FAIL token:
  FAIL --password
  FAIL quoted --secret
  FAIL glued -p password
  FAIL a 100,000 character value
  FAIL Cookie header
  FAIL URL password
  FAIL the text before and after a long value is untouched
  FAIL a quoted value ends at its closing quote and may contain spaces
  FAIL an unterminated quoted value ends at the end of the line
  FAIL an unquoted value contains ';' and ',' unless another name=value pair follows (a connection string)
  FAIL a stray credential word does not swallow the key of the next pair and leave that pair's value in the clear
  FAIL Twilio account SID
  FAIL DigitalOcean token
  FAIL Shopify admin token
  FAIL Mailgun key
  FAIL pwd=
  FAIL DB_PASS=
  FAIL dbPass:
  FAIL private_key=
  FAIL private_key_id
  FAIL Docker auth
  FAIL a short Bearer token
  FAIL is idempotent for the new shapes and never grows a redacted string by more than a constant
  FAIL treats accountKey as sensitive
  FAIL treats AccountKey as sensitive
  FAIL treats account_key as sensitive
  FAIL treats dbPass as sensitive
  FAIL treats DB_PASS as sensitive
  FAIL treats the folded key "pass[U+200B]word" as sensitive
  FAIL treats the folded key "to[U+00AD]ken" as sensitive
  FAIL treats the folded key "[U+FF50][U+FF41][U+FF53][U+FF53][U+FF57][U+FF4F][U+FF52][U+FF44]" as sensitive
  FAIL treats the folded key "[U+FF43][U+FF4C][U+FF49][U+FF45][U+FF4E][U+FF54][U+FF3F][U+FF53][U+FF45][U+FF43][U+FF52][U+FF45][U+FF54]" as sensitive
  FAIL treats the folded key "api[U+200B]_[U+200B]key" as sensitive
  FAIL treats the folded key "Account[U+200B]Key" as sensitive
  FAIL finds a token split by zero-width characters, in fullwidth letters, and in UTF-8 text around non-ASCII characters
  FAIL finds a token written as UTF-16LE
  FAIL finds a token written as UTF-16BE
  FAIL finds a token written as UTF-16LE with a byte-order mark
  FAIL finds a token written as UTF-16LE starting at an odd offset
  FAIL finds a token written as UTF-16BE starting at an odd offset
  FAIL finds a token written as UTF-16LE, PowerShell style, with the token deep inside a larger file
  FAIL text that would fold to more than the budget is redacted whole instead of exhausting memory
  FAIL 20,000 distinct token-shaped keys redact in well under a second per thousand, and stay distinct
Tests  47 failed | 29 passed (76)
```

```text
# RED at the round-2 review tree: npx vitest run tests/unit/round3-terminal-escape.test.ts   (2026-09-29T14:09:00.370Z to 2026-09-29T14:09:08.288Z)
Tests  7 passed (7)
```

```text
# RED at the round-2 review tree: npx vitest run tests/unit/round3-redaction-scaling.test.ts   (2026-09-29T14:09:08.289Z to 2026-09-29T14:13:03.033Z)
  FAIL jwt: eyJ_ repeated
  FAIL jwt: eyJ- repeated
  FAIL non-ASCII: jwt with zero-width
  FAIL the artifact scanner and object-key redaction scale the same way on the same shapes
  FAIL 1,500 random documents (seeded), each with one to three planted secrets in three disguises
  FAIL the same documents inside object values, object keys and arrays
Tests  6 failed | 85 passed (91)
```

```text
# RED at the round-2 review tree: npx vitest run tests/integration/round3-input-refusals.test.ts   (2026-09-29T14:13:03.035Z to 2026-09-29T14:13:13.563Z)
  FAIL failing.Receipt.JSON beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL failing.RECEIPT.json beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL failing.receipt.json.bak beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL failing.receipt.json~ beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL failing.receipt.jsonl beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL failing.json beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL failing.Json beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL failing.ndjson beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL nested/deeper/failing.RECEIPT.JSON beside a passing receipt is receipt_lookalike_file (exit 2), naming the file
  FAIL the refusal lists at most five files and says how to fix it; nothing is written
  FAIL EMFILE
  FAIL ENFILE
  FAIL allows exactly the limit and refuses one more, with the stable code
  FAIL does not count brackets inside strings, including escaped quotes and backslashes
  FAIL parseJsonStrict applies the budget before JSON.parse, and duplicate keys are still refused
  FAIL the real report of a 5,000-requirement, 5-repository manifest holds far fewer containers than the limit (measured: 115,013)
  FAIL a manifest extension of .inf is manifest_schema_invalid
  FAIL a manifest extension of -.inf is manifest_schema_invalid
  FAIL a manifest extension of .nan is manifest_schema_invalid
  FAIL a manifest extension of 1e400 is manifest_schema_invalid
  FAIL a manifest extension of !!float .nan is manifest_schema_invalid
  FAIL a manifest extension of !!set {a, b} is manifest_schema_invalid
  FAIL a manifest extension of !!omap [a: 1] is manifest_schema_invalid
  FAIL a manifest extension of !!binary aGk= is manifest_schema_invalid
  FAIL a manifest extension of !!timestamp 2001-01-01 is manifest_schema_invalid
  FAIL a receipt extension of 1e400 (JSON parses it to Infinity) is receipt_schema_invalid
Tests  26 failed | 15 passed (41)
```

```text
# RED at the round-2 review tree: npx vitest run tests/integration/round3-hostile-memory.test.ts   (2026-09-29T14:13:13.563Z to 2026-09-29T14:13:27.628Z)
  FAIL 1.5 million U+FDFA (a 4.5 MB receipt) is handled at a 48 MB heap; the value is examined without being held in folded form
  FAIL 3 million accented characters (a 6 MB receipt) at a 48 MB heap
  FAIL 8 million U+FDFA (the reviewer's 24 MB receipt) at a 256 MB heap: exit 0, the unexaminable value is redacted whole
  FAIL a 5,000-requirement, 5-repository manifest (800 KB) prints 9 MB of valid JSON at a 256 MB heap
  FAIL the terminal escaper alone rewrites a 3 MB string, and one made only of unsafe characters, at a 48 MB / 160 MB heap
  FAIL 3 million empty arrays in a receipt (9 MB): exit 2 limit_json_containers at a 256 MB heap
  FAIL the same in revisions.json (a 9 MB revisions file) is refused with the same code
Tests  7 failed | 2 passed (9)
```

```text
# RED at the round-2 review tree: npx vitest run tests/integration/round2-cli-safety.test.ts   (2026-09-29T14:13:27.628Z to 2026-09-29T14:13:35.576Z)
  FAIL x.RECEIPT.JSON and x.Receipt.Json are receipt_lookalike_file (exit 2), naming both files; an exact name is fine
Tests  1 failed | 18 passed (19)
```

```text
# RED at the round-2 review tree: npx vitest run tests/proofgate.spec.ts -t "AC-03 and AC-06 stay PARTIAL"   (2026-09-29T14:13:35.577Z to 2026-09-29T14:13:37.597Z)
  FAIL AC-03 and AC-06 stay PARTIAL until independently resolved: AC-06 names its upstream blocker and pending owner decision, and the documents agree
Tests  1 failed | 124 skipped (125)
```

```text
# GREEN in round 2 (unit + integration + core acceptance suites; NOT the packaged E2E, mutation controls, browser smoke or Docker, which are gate steps)
npx vitest run tests/unit tests/integration tests/proofgate.spec.ts   (2026-09-29T14:16:46Z to 2026-09-29T14:17:28Z)
Test Files 41 passed (41)
Tests 1102 passed (1102)
```

The one existing test that failed on the first green run, `tests/integration/pipeline-report.test.ts :: evaluatePaths > ignores files that are not receipts (artifacts and notes) but still counts them`, had **pinned the old behaviour** (an ignored `not-a-receipt.json`); it now ignores a `.log` file instead, and the JSON case is covered by `round3-input-refusals`. Nothing else was weakened or deleted. `round2-cli-safety`'s "named on stderr" test was replaced by the refusal test for the same reason.


## Round 3: independent re-review of the round-2 tree (the round-2 fixes), fixed in round 3

Four independent reviewers (conformance, logic, tests and mutation, security) re-reviewed
the round-2 tree. The round-3 line was cut from that tree and leaves the earlier lines unchanged. The fixes were made in ten commits of the
working history (executable entry, strict receipts tree, bundle version, redaction and JSON value budget, identifiers, output errors,
`__proto__`, `--replace` and file names, tests and the shared kill rule, documentation, golden pages and the scaling bound, mutation controls and
coverage floors, a scanner-clean fixture); the code tree of this section is the round-3 tree, and the commits after it change documents only.

**Evidence classes used below.** *executed-red*: the new test file was copied alone into an extract of the round-2 tree and failed there BY
ASSERTION (never by an import, type or spawn error; the runner counts only failures whose message is an assertion). *authored-only*:
the test passes at the round-2 tree (the behaviour was already right, or the test guards new code that cannot be exercised there); it is
tied to a mutant that a failing test kills instead. *not-available*: the test cannot run at the round-2 tree at all (a module or export is
missing). *shim-dependent*: a test that fails at the round-2 tree partly because it imports an export that does not exist there.
Mutants count as killed only by a failing test (`scripts/kill-rule.mjs`).

### Mapping table (47 findings: 16 conformance, 7 logic, 12 tests, 12 security)

| # | Sev | Finding (source) | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| CF3-1 | P2 | Runbook step 2 points at a commit that gate-evidence cannot name (conform) | FIXED (docs): the step says "the commit SHA you were handed with the tarball", recorded on the receipt | none (documentation) | docs-only | none |
| CF3-2 | P2 | HUMAN-DRILL: recording the receipt is itself a docs commit that invalidates the drill (conform) | FIXED (docs): recording only the AC-11 row, the drilled commit and the tarball hash is the one permitted commit after a drill | the existing AC-11 test pins the surrounding rules | docs-only | none |
| CF3-3 | P2 | "never ignored silently" overclaims: `x.receipt.yaml`, `x.receipt.jso`, ... exit 0 (conform, logic P2) | FIXED (code + docs): a history commit every file in the receipts tree must be a receipt, a named artifact or an allowed note; `receipt_unreferenced_file` replaces `receipt_lookalike_file` | `round4-unreferenced-files` | **executed-red 56 of 71** (log below); the 15 controls pass at the round-2 tree by design | M103, M66 |
| CF3-4 | P2 | "personal fields" (PRD) only partly met, the not-redacted list omits them (conform) | FIXED (docs): not-redacted list in INTERFACES, SECURITY, OPERATIONS, README; the AC-09 row states the PRD gap | `round4-doc-pins` | **executed-red 4 of 7** | none |
| CF3-5 | P3 | "Knox" appears in README as well as LICENSE (conform) | **NOT CHANGED**: the README quotes the LICENSE holder line; the reviewer accepted it as the same line | none | n/a | none |
| CF3-6 | P3 | CHANGELOG preamble omits the pre-release schema exception (conform) | FIXED (docs) | none (documentation) | docs-only | none |
| CF3-7 | P3 | gate-evidence and SECURITY carry no AC-06 PARTIAL statement (conform) | FIXED in the evidence commit (`gate-evidence.md` records the AC statuses of the tested tree); SECURITY does not discuss acceptance criteria and is unchanged | `round4-doc-pins` (AC-03, AC-06 and AC-11 wording in README, CHANGELOG, gate evidence) | authored-only (the statements existed) | M144 to M147 |
| CF3-8 | P3 | "single-pass" wording in the ledger and BENCHMARK (conform) | FIXED (docs): "linear-time steps" | none (documentation) | docs-only | none |
| CF3-9 | P3 | OPERATIONS says `--replace` moves only "a ProofGate report.json" (conform) | FIXED (docs): any file named `report.json` qualifies; a damaged or foreign one is archived as `superseded-unreadable` | none (documentation; behaviour unchanged, see LG-8) | docs-only | none |
| CF3-10 | P3 | SC-14 refusal message says "invalid format" for an id that redaction rewrote (conform) | FIXED (code): a history commit compared identifiers are refused with a message that says the value looks like a credential and names the field (still fail-closed) | `round4-logic-p3 :: P3-1` | **executed-red** (the message assertions fail at the round-2 tree) | M129, M130, M131 |
| CF3-11 | P3 | "MISSING: only zero-test evidence" imprecise (conform) | FIXED (docs, and the wording in `src/evaluate.ts`, `src/web/guidance.ts`, `docs/REPORT.md`): zero-test pass claims; the three golden pages were regenerated | the golden snapshots in `report-render.test.ts` | authored-only (wording) | none |
| CF3-12 | P3 | SCHEMAS and REPORT lack "best effort" (conform) | FIXED (docs) | none (documentation) | docs-only | none |
| CF3-13 | P3 | Dockerfile comment says the image installs the same tarball as a release but omits CONTRIBUTING.md (conform) | FIXED: `COPY ... CONTRIBUTING.md` | the Docker gate (build) | not-available as a unit test | none |
| CF3-14 | P3 | Internal workflow vocabulary in public docs (conform) | PARTLY: the ledger is neutralised here; `gate-evidence.md` is rewritten in the evidence commit | none | docs-only | none |
| CF3-15 | P3 | Upgrade and Backup do not say earlier pre-release reports and bundles are refused (conform) | FIXED (docs) | none (documentation) | docs-only | none |
| CF3-16 | P3 | BENCHMARK figures have no raw receipt (conform, optional) | **NOT CHANGED**: the page already says it predates the redaction rewrite and is not re-measured | none | n/a | none |
| LG3-1 | P1 | `isDirectRun()`: `node dist/cli evaluate ...` (no `.js`) is a silent no-op, exit 0 (logic) | FIXED: a history commit `src/cli.ts` runs `main` unconditionally; `main` moved to `src/run.ts` | `round4-cli-entry` (built binary through `node dist/cli`, `dist/cli.js`, bin symlink, relative path, path with spaces, no-extension argv[1], `--import`) | **executed-red 6 of 8**: 5 by behaviour, and 1 (the library import) only because `run.js` does not exist at the round-2 tree (shim-dependent); the 2 controls pass there | M102 |
| LG3-2 | P2 | look-alike heuristic gaps (logic) | FIXED: as CF3-3 | as CF3-3 | executed-red 56 of 71 | M103, M66 |
| LG3-3 | P2 | `comparable()` keeps `engine.version`: a bundle written by 0.1.0 fails under 0.1.1 (logic) | FIXED: a history commit the package version is masked; a policy engine change is reported by its own message | `round4-bundle-version` (patched version) | **executed-red 2 of 4** | M104, M105 |
| LG3-4 | P3 | identifiers compared after redaction (logic P3-1) | FIXED: a history commit `src/identifiers.ts`; `runner_id` is only reported, never compared, so it stays redacted, not refused | `round4-logic-p3 :: P3-1` | **executed-red** (7 of the 11 red tests in that file) | M129, M130, M131 |
| LG3-5 | P3 | ENOENT and ENOTDIR not output failures (logic P3-2) | FIXED: a history commit ENOENT mapped; a clean-up failure (`rm` on a path below a file: ENOTDIR) no longer replaces the real error | `round4-logic-p3 :: P3-2`, `round3-input-refusals` | **executed-red** for ENOTDIR (2 CLI tests: the real error was replaced by `internal_error`) and for the ENOENT mapping unit test; the dangling-symlink `TMPDIR` CLI test is authored-only (the CLI already answered `output_unwritable` there on this host) | M132, M133 |
| LG3-6 | P3 | `__proto__` on a RunProof run dropped (logic P3-3) | FIXED: a history commit refused with `runproof_schema_invalid` | `round4-logic-p3 :: P3-3` | executed-red 1 (adapter); the end-to-end receipt-file test is authored-only | M134 |
| LG3-7 | P3 | `--replace` without `--output` accepted (logic P3-4) | FIXED: a history commit `cli_usage` | `round4-logic-p3 :: P3-4` | **executed-red 1** | M135 |
| TS3-1 | P1 | glued-token boundary (tests) | FIXED: a history commit (= SC3-1); the planted set now holds every prefix in front of every token shape (`tests/helpers/fake-secrets.ts`: 14 prefixes x 11 shapes) | `round4-redaction-fail-open`, `round4-redaction-roundtrip`, `proofgate.spec :: AC-09` | **executed-red**: fail-open 367 of 501 (a few of those fail because they use the new `MAX_REDACT_STRING` export: shim-dependent), planted forms 1, round trip 8 of 9 | M106, M107 |
| TS3-2 | P2 | scaling test passes a quadratic implementation (tests) | FIXED: history commits sizes 1, 2 and 3.5 MiB, floor 25 ms, growth bound 7 with the fastest of four runs | `round3-redaction-scaling` | **authored-only** (the reviewed code is linear, so the test is green there); M123 (a stride-1024 quadratic scan) is killed by assertion | M123 |
| TS3-3 | P2 | JSON tests: objects, parse order, hostile object case (tests) | FIXED: a history commit boundary tests for arrays, objects and values at exactly the limit, a `JSON.parse` spy, order, a message check, heap-capped 3M `{}` at 128 MB and 12M numbers at 256 MB | `round4-json-budget` | executed-red 6 of 13 (**shim-dependent**: five use the new `MAX_JSON_VALUES` export; the behavioural one is the 12M-number run, which aborts V8 at the round-2 tree). The object boundary, spy and heap-capped object tests are authored-only (green at the round-2 tree, which already has the container budget) and are killed by M124 to M127 | M124, M125, M126, M127 |
| TS3-4 | P2 | e2e mutation harness kill rule (tests) | FIXED: a history commit `scripts/kill-rule.mjs` used by both harnesses | `round4-kill-rule` (real vitest processes) | **not-available at the round-2 tree** (the module does not exist); authored-only; killed by M140 to M143. The seven e2e mutants themselves are re-run at the gate | M140, M141, M142, M143 |
| TS3-5 | P2 | bundle repeated-flag tests (tests) | FIXED: a history commit every option of export, verify and restore, both spellings, empty values | `round4-bundle-flags` | **authored-only** (the product was already correct: 19 of 19 pass at the round-2 tree); killed by M136, M137 | M136, M137 |
| TS3-6 | P2 | `.json5` look-alike unpinned (tests) | FIXED: `failing.json5` is in the strict-rule names | `round4-unreferenced-files` | executed-red (part of the 56) | M103 |
| TS3-7 | P3 | low-heap tests do not discriminate on Node 25.8.2 (tests) | PARTLY: on this host M83 (whole-string fold) and M100 (per-character escaping) are killed at 256 MB by the existing hostile-memory tests; the reviewer's Q04 and T04 variants were not reproduced and no test was resized; the Node 22.12 numbers come from the gate | `round3-hostile-memory` | not-available (Node 22.12 discrimination is measured at the gate) | M83, M100 |
| TS3-8 | P3 | per-file coverage floors missing (tests) | FIXED: a history commit `vitest.config.ts` floors for run, schemas, explain, escape, errors, reasons, identifiers, adapters, web; `cli.ts` is excluded with the reason written in the config (it runs only in the built binary) | the coverage run | verified: the full coverage run exits 0 at the configured floors | none |
| TS3-9 | P3 | doc pins for AC-03 and AC-11 statements (tests) | FIXED: a history commit | `round4-doc-pins` | authored-only for the README, CHANGELOG and gate-evidence statements (they were correct); killed by M144 to M147 | M144 to M147 |
| TS3-10 | P3 | minor survivors D02, D03, D05, D14, C04, C07 (tests) | FIXED for D03, D05, D14, C04 (`round4-minor-survivors`); **D02 and C07 not killed**: D02 (the fold cut ignoring a combining-mark join) can only over-redact, never leak, and C07 (an empty-output guard) is unreachable through the CLI | `round4-minor-survivors` | executed-red 2 of 10 for the file (the D05 and D14 boundary cases and the C04 test pass at the round-2 tree: authored-only) | M112, M119, M120, M138 |
| TS3-11 | P3 | FOLD_CARRY gap (tests, security P3) | FIXED: a history commit carry 64 KiB | `round4-redaction-boundaries` | **executed-red** (the 5,000-character header case) | M121 |
| TS3-12 | P3 | harness does not log the killing test; MUTATION_JOBS timing (tests) | FIXED: a history commit the output names the first failing test; a run whose every failure is a timeout is `SUSPECT`; the harness comment says to rerun with `MUTATION_JOBS=1` | `round4-kill-rule` | as TS3-4 | M143 |
| SC3-1 | P2 | tokens behind a letter, digit or escape are not redacted (security) | FIXED: a history commit distinctive prefixes have no boundary; the short prefixes `sk-`, `key-`, `SK`, `AC`, `Bearer` keep one and accept the escapes; documented | as TS3-1 | executed-red | M106, M107 |
| SC3-2 | P2 | key names: dotted, bracketed, colon, spaced, concatenated (security) | FIXED: a history commit every non-alphanumeric run separates segments; strong words inside one segment count | `round4-redaction-fail-open :: key names ...` | executed-red (part of the 367) | M113, M54, M89 |
| SC3-3 | P2 | `isNextKey` substring regression (security) | FIXED: a history commit only a whole credential name counts, quoted values only; an unquoted value ending in a colon is redacted with the next word | `round4-redaction-fail-open :: a value that merely contains a credential word ...` | executed-red. **Corrected in round 4**: the round-3 claim that escaped quotes no longer shield a value "at any depth" was wrong for a credential that itself contains a quote and for JSON nested four or more layers deep (Round 4, S1 and C1) | M108, M95 |
| SC3-4 | P2 | redaction not idempotent, bundle cannot be restored (security) | FIXED: a history commit applied to a fixed point (six rounds, else replaced whole) | `round4-redaction-fail-open :: redaction is idempotent`, `round4-redaction-roundtrip` | **executed-red** (round trip seeds 3 and 4 fail `bundle verify` at the round-2 tree) | M109 |
| SC3-5 | P2 | assignment recognition limits: blanks, next line, name length (security) | FIXED: a history commit 64 blanks, YAML next-line values, names 80 characters each side | `round4-redaction-fail-open :: assignments ...` | executed-red | M114, M115, M116, M88 |
| SC3-6 | P2 | memory bound counts containers only; short-match text and long keys abort V8 (security) | FIXED: a history commit value budget (`limit_json_values`), strings and keys over 4 MiB replaced whole | `round4-json-budget`, `round4-redaction-memory` | **executed-red**: 12M numbers abort at the round-2 tree; memory shapes 3 or 4 of 4 depending on the run (the 23 MB `token=a` string is at the edge of the 256 MB heap) | M110, M111, M124, M125 |
| SC3-7 | P2 | receipt file names redacted then used as entry names: collisions, dropped suffix (security) | FIXED: a history commit names become `redacted-<16 hex of content>.receipt.json` | `round4-redaction-roundtrip :: receipt files whose NAMES look like credentials` | **executed-red** (`bundle verify` fails with `bundle_entry_invalid` at the round-2 tree) | M128, M53 |
| SC3-8 | P2 | credential forms the docs imply are not redacted (security) | FIXED: a history commit the forms listed by the reviewer (test names in `round4-redaction-fail-open :: credential forms ...`) | that describe block | executed-red (part of the 367) | none dedicated; covered by M10 |
| SC3-9 | P3 | hidden JWT beyond the 4 KiB carry; the artifact scan window overlap is 16 KiB (security) | PARTLY: fixed for the fold carry (64 KiB); **the 16 KiB scan overlap is NOT CHANGED** and is a documented limit in INTERFACES | `round4-redaction-boundaries` | executed-red for the carry | M121 |
| SC3-10 | P3 | `report.json` and bundle entries hold raw C1, bidi and line-separator characters (security) | **NOT CHANGED**: `report.json` is a raw data file by design (INTERFACES says so); `--json` output, the terminal and the page all escape; nothing renders it unescaped | none | n/a | none |
| SC3-11 | P3 | UTF-16 decoded only after 16 ASCII-range units (security) | FIXED: a history commit run of 4 | `round4-redaction-boundaries :: a short secret inside non-ASCII UTF-16 text` | executed-red | M122 |
| SC3-12 | P3 | YAML node estimate ignores a bare CR (security) | FIXED: a history commit | `round4-minor-survivors :: YAML node estimate ...` | executed-red (part of the 2 red tests in that file) | M139 |

**Count.** 47 findings. Fixed by a code or test change with a regression test: 30 (CF3-3, CF3-10, LG3-1 to LG3-7, TS3-1 to TS3-6,
TS3-8 to TS3-12, SC3-1 to SC3-8, SC3-11, SC3-12). Fixed by documentation or wording only: 11 (CF3-1, 2, 4, 6, 7, 8, 9, 11, 12, 13, 15).
Partly fixed: 3 (CF3-14, TS3-7, SC3-9). **Not changed, with reasons: 3** (CF3-5, CF3-16, SC3-10). Two parts of fixed rows are also
not fixed: D02 and C07 in TS3-10 (equivalent for the decision) and the 16 KiB artifact-scan overlap in SC3-9. Carried over from round 2 and
unchanged: LG-8, SC-14 (its message is improved by CF3-10) and the PRD-copy half of CF-8; the reviewers accepted those three as documented.

### RED at the round-2 tree and GREEN in round 3

RED: each new or changed test file was copied ALONE (plus `tests/helpers/fake-secrets.ts` where imported) into a `git archive` extract
of the round-2 tree (the reviewed tree, `node_modules` linked) and run with
`npx vitest run <file>` (JSON reporter). Counts are tests / passed / failed BY ASSERTION / failed otherwise; UTC times are the run's.

```text
tests/integration/round4-cli-entry.test.ts           8 / 2 / 6 / 0      2026-09-29T16:16:50Z to 16:16:57Z
tests/integration/round4-unreferenced-files.test.ts  71 / 15 / 56 / 0   2026-09-29T16:20:11Z to 16:20:15Z
tests/integration/round4-bundle-version.test.ts      4 / 2 / 2 / 0      2026-09-29T16:22:30Z to 16:22:32Z
tests/integration/round4-logic-p3.test.ts            22 / 11 / 11 / 0   2026-09-29T17:28:03Z to 17:28:04Z
tests/integration/round3-input-refusals.test.ts      42 / 29 / 13 / 0   2026-09-29T17:28:04Z to 17:28:06Z (12 strict-rule tests, 1 ENOENT mapping)
tests/integration/round4-redaction-memory.test.ts    4 / 0 / 4 / 0      2026-09-29T17:28:06Z to 17:28:10Z (an earlier run at 16:50Z gave 3 of 4: the 23 MB `token=a` case is at the edge of the 256 MB heap)
tests/proofgate.spec.ts (glued planted forms)        125 / 122 / 3 / 0  2026-09-29T17:28:10Z to 17:28:13Z (1 real: the bundle holds glued tokens; 2 are the AC index tests that cannot resolve matrix ids of files not copied into the extract, an isolation artifact and not evidence)
tests/unit/round4-redaction-fail-open.test.ts        501 / 134 / 367 / 0  2026-09-29T17:20:57Z to 17:20:58Z
tests/integration/round4-minor-survivors.test.ts     10 / 8 / 2 / 0     2026-09-29T17:20:58Z to 17:20:59Z
tests/integration/round4-bundle-flags.test.ts        19 / 19 / 0 / 0    (authored-only)
tests/integration/round4-doc-pins.test.ts            7 / 3 / 4 / 0      2026-09-29T17:21:00Z to 17:21:01Z
tests/unit/round3-redaction-scaling.test.ts          91 / 91 / 0 / 0    (authored-only)
tests/unit/round4-kill-rule.test.ts                  not-available: suite error (scripts/kill-rule.mjs does not exist)
tests/unit/round4-redaction-boundaries.test.ts       13 / 10 / 3 / 0    2026-09-29T17:24:11Z to 17:24:16Z
tests/integration/round4-redaction-roundtrip.test.ts 9 / 1 / 8 / 0      2026-09-29T17:24:17Z to 17:24:18Z
tests/integration/round4-json-budget.test.ts         13 / 7 / 6 / 0     2026-09-29T17:24:18Z to 17:24:20Z
```

GREEN: `npx vitest run <the 16 files above> --reporter=json` on the clean tree at a history commit,
2026-09-29T17:22:44Z to 17:23:47Z, exit 0: **949 tests, 949 passed, 0 failed**. Per file: `proofgate.spec.ts` 125, `round3-input-refusals` 42,
`round4-bundle-flags` 19, `round4-bundle-version` 4, `round4-cli-entry` 8, `round4-doc-pins` 7, `round4-json-budget` 13,
`round4-logic-p3` 22, `round4-minor-survivors` 10, `round4-redaction-memory` 4, `round4-redaction-roundtrip` 9,
`round4-unreferenced-files` 71, `round3-redaction-scaling` 91, `round4-kill-rule` 10, `round4-redaction-boundaries` 13,
`round4-redaction-fail-open` 501. The whole main suite with coverage on the tree at a history commit (the later commit changes one fixture
literal): 54 files, 1,794 tests, exit 0 at the configured per-file floors (statements, branches, functions and lines each at or above 90).

Targeted mutant runs (one mutant applied to a scratch copy, only the named files run) are in `negative-controls.md`: 46 new mutants
(M102 to M147) and 15 retargeted ones, all killed by a failing test in those runs. The first targeted run found six weak spots that
were fixed in the tests, not in the mutants: M76 (wrong file selected), M88, M108, M122, M123 and M128 survived until the tests were
strengthened; M10, M109, M110 and M127 were `SUSPECT` (a type error, or a failed assertion that printed megabytes and crashed the worker)
until the mutants and the assertions were rewritten.

### Findings about the findings

- `limit_json_values` rests on a measurement: at the round-2 tree a receipt whose `extensions` hold 12 million plain numbers (a 24 MB text) aborts V8 at
  `--max-old-space-size=256` in the packaged binary, although `JSON.parse` alone parses the same text at 256 MB on Node 22.12 and on Node 25.8.2.
  The pipeline's copies (redaction, canonical form) need more than `JSON.parse` does; the multiplier was not measured. The budget (1,500,000 values) is checked
  before parsing.
- The seeded property test found a fail-open in the new code itself (`pass : Authorization: Digest ...` ate the header name and left the digest response);
  it is fixed (M118) and pinned.
- Two accepted limits found by the round-trip property test: an AWS key id directly followed by a letter or digit is not redacted (its trailing boundary keeps
  ordinary words out), and neither are `sk-`, `key-`, `SK`, `AC` or `Bearer` directly after a letter or digit. Both are documented in `docs/INTERFACES.md`.

### What this round still cannot claim

- Nothing here is an independent receipt: the maintainer wrote the fixes, the tests and the mutants. AC-03 and AC-06 stay PARTIAL; AC-11 stays
  `PENDING_HUMAN_RECEIPT`.
- The full 147-mutant run, the seven end-to-end mutants, the packaged E2E, the browser smoke, the Node 22.12 gate and the Docker smoke are gate
  steps; their results, or their absence, are recorded in `gate-evidence.md`.
- Node 22.12 heap behaviour of the low-heap tests is measured at the gate only (TS3-7).

## Round 4: independent re-review of the round-3 tree (the round-3 fixes), fixed in round 4

Four independent reviewers (conformance, logic, tests and mutation, security) re-reviewed the round-3 tree
(code tree a history commit). The round-4 line was cut from it and leaves the earlier lines unchanged. Three
review rounds in a row had found the same redaction family in a new shape each time (a cap, an escape, a value holding a quote), so
this round generalised the rules and proved each one over a generated space (27 embedding templates x 4 secret shapes x nesting
depth 0 to 8, all the outputs of the tool) instead of adding the reported shape. Fix commits, all after the round-3 tree: a history commit
(entry modules, export verification, aggregate budget, YAML, RunProof, error line), a history commit (header check, wording), a history commit
(redaction), a history commit (kill rule and test strengthening), history commits (test strengthening after targeted mutant runs),
a history commit (documentation), a history commit (gate evidence and pins). Evidence classes are those of Round 3 (executed-red, authored-only,
not-available, shim-dependent).

### Mapping table (44 findings: security 14, logic 8, conformance 10, tests 12)

| # | Sev | Finding (source) | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | P1 | `backslashRun` reads at most 8 backslashes and returns 0 beyond: JSON nested four or more layers deep fails open for quoted keys and values (security P1) | FIXED: a history commit a quoted value is delimited by arithmetic on the whole backslash run (`m = c * (r + 1) + r`, even `c` closes, odd `c` is a quote inside the value; a run that fits neither is part of the value, so the value runs to the end of its line: fail closed), unbounded and linear | `redaction-depth-generative` (27 templates x 4 secret shapes x depth 0 to 8, runs of 1 to 127 backslashes, a hostile 2M run), `redaction-depth-e2e` (all outputs of evaluate, `--json`, export, verify, restore) | **executed-red**: depth-generative 33 of 52, e2e 14 of 16 | M148, M149, M116, M81 |
| S2 | P1 | Redaction is not idempotent for object keys: `pass<token>` keeps its value on pass 1 and loses it on pass 2, so export writes a bundle that verify and restore refuse (security P1; logic P2-1, a regression against the round-2 tree) | FIXED: a history commit a key is judged as written AND as redacted (joint fixed point, also for pair names); a history commit `bundle export` verifies the bundle before publishing and never leaves a file that verify would refuse | `redaction-object-fixed-point` (the reviewers' keys x 4 tokens x 4 shapes, 3,000 seeded random documents), `redaction-depth-e2e` (receipt and manifest extension keys through the whole cycle), `bundle-export-self-verify` (non-idempotent redaction is refused, nothing published) | **executed-red**: object-fixed-point 36 of 58, self-verify 1 of 2, e2e (part of the 14) | M154, M171 |
| S3 | P1 | Assignment names and values do not treat an escape that stands for a separator (`\n`, `\t`, `\r\n`, `%0A`, `%20`, `%09`) as a boundary; YAML next-line values inside JSON text keep the value (security P1) | FIXED: a history commit the letters of a leading escape are not part of the name; a line break written as text, and tabs or spaces written as text, are skipped after `key:`, at any depth | `redaction-depth-generative` templates (newline, tab, CRLF, `%0A`, `%20`, `%09`, `\u000a`, YAML next line as text), `redaction-depth-e2e` | executed-red (part of the 33 and the 14) | M150, M152, M153, M115 |
| S4 | P2 | `=>` is read as `=` and the value `>` (security P2) | FIXED: a history commit | `redaction-forms-round4`, depth templates | executed-red (part of the 22) | M151 |
| S5 | P2 | A flag with blanks around `=` swallows the `=` (security P2) | FIXED: a history commit | `redaction-forms-round4`, depth templates | executed-red | M164 |
| S6 | P2 | The assignment keywords are narrower than the documented key list (connection_string, ssh_key, jwt, bearer) (security P2) | FIXED: a history commit keywords and the literal prefilter follow the list; the forms test uses a secret that holds no credential word so the prefilter is what is tested | `redaction-forms-round4` | executed-red | M159, M166 |
| S7 | P2 | Invisible characters outside the hand-picked list split a token (4,262 of 4,284 code points) (security P2) | FIXED: a history commit the hiding class is `\p{Default_Ignorable_Code_Point}` plus `\p{Cf}` plus the named ranges | `redaction-forms-round4` (every such code point, token and keyword) | **executed-red** (4,186 of 4,206 survive at the round-3 tree) | M158 |
| S8 | P2 | `bundle export` refuses large random or compressed artifacts because the password-flag shape matches random bytes (security P2) | FIXED: a history commit the weak shapes (`-pXXXXX`, `-u user:password`) are asked of text windows only (85% printable, U+FFFD not printable); strong token shapes still trip on binary | `redaction-forms-round4` (random and gzip buffers of 4 KB to 1 MB, real text, binary holding a real token) | executed-red | M160, M161 |
| S9 | P2 | The container and value budgets are per document: eight receipts of 490,000 objects abort V8 at 256 MB (security P2) | FIXED: a history commit aggregate budgets over all receipt documents (1,000,000 containers, 3,000,000 values) | `limits-and-errors-round4` (in process; heap-capped 8 receipts; limits pinned from both sides) | executed-red 6 of 14 (the heap-capped 8-receipt case aborts at the round-3 tree) | M167, M168, M192, M193 |
| S10 | P2 | The 150,000-node YAML budget does not bound parse time: 70,000 keys in one mapping took 68 s (security P2) | FIXED: a history commit the parser's quadratic duplicate-key check is off and the same rule is applied in one linear pass (40,000 keys: about 0.2 s instead of 10 s) | `limits-and-errors-round4` (timing, duplicates still refused) | executed-red (part of the 6) | M169, M170 |
| S11 | P2 | Key-name and pair recognition narrower than the observed shapes (`dbpass`, `userpass`, `secretkey`, `{key,value}`, `{Name,Value}`, `{ParameterKey,ParameterValue}`, tuple lists, argv arrays, `{header,value}`) (security P2) | FIXED: a history commit name lists, `pass`/`pwd` glued to a word, case-insensitive pair shapes as objects and as text at any depth, list elements after a credential name. **Not covered, and documented as such**: `:=`, `->`, XML element and attribute forms, `tool -p x` (space); percent-encoded separators were listed here first and are read since the second security review of the round (B3 below) | `redaction-object-fixed-point`, `redaction-limits-exact` | executed-red (part of the 36 and the 16) | M155, M156, M157, M162, M163, M117 |
| S12 | P3 | The error line is redacted as a whole and loses the first word of `bundle_secret_detected` (security P3) | FIXED: a history commit only the message is redacted | `limits-and-errors-round4` | executed-red (part of the 6) | M178, M34 |
| S13 | P3 | Slack `xoxc-`, `xoxd-`, `xoxo-` are not recognised (security P3) | FIXED: a history commit `xox[a-z]-` | `redaction-forms-round4` | executed-red | M165 |
| S14 | P3 | An identifier nested hundreds of thousands of levels deep is an internal error (security P3, read not run) | FIXED: a history commit a serialisation failure is a schema error naming the field. **Only real on Node 22.12** (there `JSON.stringify` overflows at about 5,000 levels; Node 25.8.2 copes with 499,000), so on the host the end-to-end test is authored-only and the branch is exercised by a simulated overflow | `identifier-paths` (simulated), `limits-and-errors-round4` (end to end) | executed-red for the simulation (2 of 29); the end-to-end case is authored-only on this Node and red on Node 22.12 by construction | M179 |
| L1 | P2 | = S2 (logic P2-1, a regression against the round-2 tree) | FIXED: see S2 | see S2 | see S2 | M154, M171 |
| L2 | P2 | `node .`, `node dist`, `node dist/index.js`, `node dist/run.js` run nothing and exit 0 on a failing tree (logic P2-2) | FIXED: a history commit the library modules recognise "started as the main script" by node's own entry resolution (file, `.js`, directory through `main` or `index.js`, real paths) and exit 2 with a message; imported, they do nothing | `entry-forms` (8 forms, symlink, other working directory, the documented forms unchanged, library import silent), `entry-guard` | **executed-red** 9 of 11; entry-guard not-available at the round-3 tree (module missing) | M172, M173, M174 |
| L3 | P3 | RunProof: a required definition that failed in an earlier evaluation and is absent from the latest one is dropped (logic P3) | FIXED: a history commit refused with `runproof_outcome_mismatch` | `runproof-strictness` | executed-red (part of the 9) | M175 |
| L4 | P3 | RunProof: exit spellings other than `exit_code` and `exitCode` are ignored (logic P3) | FIXED: a history commit refused with `runproof_schema_invalid` | `runproof-strictness` | executed-red | M176 |
| L5 | P3 | `__proto__` inside `run.checks[]` is dropped silently (logic P3) | FIXED: a history commit refused, like the one on the run | `runproof-strictness` | executed-red | M177 |
| L6 | P3 | Bundle header revisions and masked report fields can be forged in a re-sealed bundle (logic P3) | PARTLY: a history commit the header's revision set is checked against the report on verify and restore. The fields masked from the re-evaluation comparison (producer version, input summary, `supersedes`, `clock_source`) are NOT cross-checked: there is no signature, so a check of derived fields would not make a forged bundle honest; documented as the consistency-not-honesty limit | `bundle-header-forgery` | **executed-red** 1 of 1 | M180 |
| L7 | P3 | Ledger rows CF3-7 and CF3-14 claim an evidence commit that does not exist (logic P3) | FIXED (docs): `gate-evidence.md` carries the AC statuses, states that no gate result exists for these trees, and the ledger rows are corrected | `round4-doc-pins` | executed-red (part of the 4 of 7 at round 3; the round 4 pins are new) | M147 |
| L8 | P3 | `receipt.ts` says nothing is ignored silently while allowed-name content is ignored; `ReceiptSet.notes` is never filled (logic P3) | FIXED (comment and docs): the allow-list is stated to mean "not evidence, never read" in the code comment and in INTERFACES | none (documentation) | docs-only | none |
| C1 | P2 | A credential value that contains a quote inside doubly encoded JSON leaks its tail (conformance F1; 15 of 32 shapes) | FIXED: = S1 (six value shapes x depth 0 to 3, plus an exact-output precision test that pins where the value ends) | `redaction-depth-generative` | executed-red | M148 |
| C2 | P2 | Internal workflow vocabulary in the ledger and gate evidence (conformance F2) | FIXED (docs): the ledger and `gate-evidence.md` are worded for a public reader; the drill sheet names the role that builds the tarball in its own rules | `round4-doc-pins` (no such vocabulary in the ledger, gate evidence, matrix or controls) | authored-only (docs) | none |
| C3 | P2 | CF3-7 relies on gate-evidence AC lines that do not exist (conformance F3) | FIXED (docs): AC-03 PARTIAL, AC-06 PARTIAL, AC-11 PENDING_HUMAN_RECEIPT are stated in `gate-evidence.md` and pinned | `round4-doc-pins` | authored-only (docs) | M144 to M147 |
| C4 | P2 | The matrix and the gate evidence stop at round 2 and do not carry the round 2 gate table (conformance F4; tests P2 f) | FIXED (docs): the round 2 table is carried forward as history, labelled as a different lineage; both documents say no gate result exists for rounds 3 and 4 until one is recorded | `round4-doc-pins` | authored-only (docs) | none |
| C5 | P3 | Concatenated key names where secret or token is not last (conformance P3) | FIXED: = S11 | `redaction-object-fixed-point`, `redaction-limits-exact` | executed-red | M162, M163 |
| C6 | P3 | The round 2 CHANGELOG entry names `receipt_unreferenced_file` (it was `receipt_lookalike_file` at the round-2 tree) (conformance P3) | FIXED (docs): restored, with a note of the round 3 rename | none | docs-only | none |
| C7 | P3 | CHANGELOG still says "zero tests is MISSING" (conformance P3) | FIXED (docs) | none | docs-only | none |
| C8 | P3 | BENCHMARK says the rewrite "does not add any" work (conformance P3) | FIXED (docs): rounds 2 to 4 named, the 11% single-shape measurement of a reviewer quoted, tables still not re-measured | none | docs-only | none |
| C9 | P3 | INTERFACES says embedders can pass a renderer to `main`, which is unreachable (conformance P3) | FIXED (docs): `dist/run.js` is not library surface and refuses to start as a script | none | docs-only | none |
| C10 | P3 | HUMAN-DRILL and RELEASE disagree on which tarball is released after the receipt commit (conformance P3) | FIXED (docs): both say the released tarball is rebuilt from the receipt commit and the AC-11 row states both hashes | none | docs-only | none |
| T1 | P1 | The timeouts-only guard fails when several tests time out (one message per group); a fake summary, a TypeError-only run and a hang were not handled (tests P1) | FIXED: a history commit both harnesses read the runners' JSON results; a kill needs a test that fails by assertion; timeouts, runtime errors, crashes, fake summaries and hangs (wall-clock cap, process group killed) are SUSPECT; playwright's JSON is read the same way | `round4-kill-rule` (real vitest runs: four tests that all time out, a hook timeout, TypeError-only, a module that prints a summary and dies, a synchronous loop at a 4 s cap) | 24 tests: 2 red by assertion at the round-3 tree, 22 not-available there (the new API does not exist: shim-dependent) | M142, M143, M181, M182, M140, M141 |
| T2 | P2 | The unreferenced-file name suite never isolates the name rule (each bad receipt has its own orphan artifact) (tests P2 a) | FIXED: a history commit the planted receipt names the artifact the passing receipt already names, so only the receipts-tree rule can refuse | `round4-unreferenced-files` | authored-only (71 of 71 pass at the round-3 tree, which refuses either way) | M185, M186, M103 |
| T3 | P2 | Identifier tests cover single-element arrays and some fields only (tests P2 b) | FIXED: a history commit one case per path of both lists with the bad value at index 1, plus RunProof bindings end to end | `identifier-paths`, `identifier-runproof` | authored-only for the paths (27 of 29 pass at the round-3 tree), the bindings pass there too | M187 to M191 |
| T4 | P2 | `limit_json_values` position pinned only at 12M (tests P2 c) | FIXED: a history commit heap-capped 2M refused and 1.4M accepted at 256 MB, plus the aggregate value budget from both sides | `round4-json-budget`, `limits-and-errors-round4` | authored-only | M183, M192 |
| T5 | P2 | The 8-backslash cap survives (tests P2 d) | FIXED: = S1 | `redaction-depth-generative` | executed-red | M149, M116 |
| T6 | P2 | Separators `=>`, `:=`, `->` and XML, `-p x`, `%3D` (tests P2 e) | PARTLY: `=>` fixed (S4). **Listed as not redacted, with reasons**: `:=` and `->` need a separator grammar that has no credential-name boundary to key on, XML needs an element and attribute scanner, and `tool -p x` (space) is indistinguishable from ordinary text; each is in the "does not redact" list of INTERFACES and pinned there | `round4-doc-pins` | authored-only (docs) | none |
| T7 | P2 | `gate-evidence.md` has no round 3 content (tests P2 f) | FIXED (docs): = C4 | `round4-doc-pins` | authored-only | none |
| T8 | P3 | Kill-rule tests for a fake summary and a TypeError-only run (tests P3) | FIXED: = T1 | `round4-kill-rule` | see T1 | M142, M182 |
| T9 | P3 | LG3-1 ledger wording (tests P3) | FIXED (docs): "5 of 8 by behaviour and 1 by a missing module" in the round 3 row | none | docs-only | none |
| T10 | P3 | The scaling matrix detects a quadratic at stride 1024 only (tests P3) | DOCUMENTED, not changed: a quadratic scan with a smaller constant (strides of 2048 and up cost less than the noise of the linear cost at 3.5 MiB) is not detected by any timing ratio that stays stable on a loaded host; the linear shape of every step is argued in `src/redact.ts` and checked by the matrix at the threshold M123 shows | `round3-redaction-scaling` | n/a | M123 |
| T11 | P3 | Exact-boundary pins (blanks, name reach, size cap, `secret2`, rounds, depth 16) and the spellings `userpwd`, `encryptionKey`, `masterKey` (tests P3) | PARTLY: pinned from both sides: blanks 64 and 65, the 4 MiB cap for strings and keys, trailing digits after `secret` or `token`, the extensions depth 16 and 17, the compound spellings, the hook-timeout alternative of the kill rule. **Not pinned because not observable through a public function**: the 80-character reach of the name walk (the keyword that started the walk decides) and the six-round settle limit (it can only replace a text that would have been redacted further) | `redaction-limits-exact`, `round4-kill-rule` | executed-red 16 of 54 for the pins that concern new behaviour | M184, M194, M162, M163 |
| T12 | P3 | The main mutation harness has no wall-clock limit on a run: one mutant that loops forever hangs the gate (tests P3) | FIXED: a history commit the main harness runs every suite through the shared `runWithCap` (process group killed at `MUTATION_RUN_CAP_MINUTES`, default 30; the end-to-end harness caps at 15 minutes), and a run that hit the cap has no exit status and is SUSPECT | `round4-kill-rule` (a synchronous loop at a 4 s cap is killed and is SUSPECT; both harnesses are read for `runWithCap`) | shim-dependent (the test and the shared cap did not exist at the round-3 tree; the cap is exercised by a real run that never ends) | M142 |

**Count.** 44 findings (several are the same defect reported by two reviewers and are listed once per report; the tests report's headline
says four P2 findings, its list holds six). Fixed by a code or test
change with a regression test: 28. Fixed by documentation or wording only: 13. Partly fixed: 3 (L6, T6, T11). **Not fixed, with reasons**:
the shapes `:=`, `->`, XML forms and `tool -p x` (S11, T6: no credential-name boundary to key on, or
indistinguishable from ordinary text; listed and pinned in the not-redacted list), name/value pairs written as YAML or TOML lines and
percent escapes nested more than three levels (B1, B3 below: listed and pinned); the fields masked from the bundle comparison (L6:
no signature exists); quadratics with a smaller constant than the scaling matrix detects (T10); the two limits that no public
function can observe (T11). Carried over unchanged and accepted by the reviewers in round 3: CF3-5, CF3-16, SC3-10, LG-8, SC-14, the
PRD-copy half of CF-8.

### Second security review of the same round (classes B1 to B7)

A further independent security review of another product's redactor named seven classes that this redactor had to be tested for as well;
they were probed against a history commit first (the rows marked held needed no code change) and the classes that leaked were fixed afterwards. Every class is tested at JSON nesting depth 0 to 8, as text and as an object, in
`tests/unit/redaction-classes-round4b.test.ts` (172 tests).

| # | Sev | Class | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | P1 | Name/value pairs in every order and shape: value before name, an intervening key (AWS SSM `Type`), path-shaped names, cookie pairs, ECS `valueFrom` beside `value`, tuple lists, argv arrays, object pairs at depth >= 1 | FIXED: the pair scanner finds the name key, then the value key before or after it in the same object (a window of one KiB plus the escape overhead of the layer; a brace found outside strings ends the search, so a neighbouring pair is never taken); single quotes (a Python repr) are read like double quotes; session cookie names count as credential names; a list element after a credential name is redacted even when the element before it is a flag. **Not read, documented and pinned**: a pair written as YAML or TOML lines (`name:` on one line, `value:` on the next) | `redaction-classes-round4b` (classes 1: text, objects, exact output, single quotes, limits) | executed-red at the round-3 tree (see the counts below) | M215 to M227 |
| B2 | P1 | YAML next-line value after `key:` at depth 2 to 4, with and without a list dash | FIXED for the list forms that leaked: a YAML block list under a credential key (every item) and a bracketed list (`[a, b]`, `["a","b"]`, nested, brackets inside strings ignored) are redacted item by item; the plain next-line value held | `redaction-classes-round4b` (class 2) | executed-red (list forms); the plain next-line value was **held** at the round-3 tree and is pinned | M203 to M207, M228, M229 |
| B3 | P2 | Percent-encoded separators (`%3D`, `%3A`, `%22`, `%40`, `%20`, `%2F`) defeat every assignment, header and URL userinfo shape | FIXED: text that holds a percent escape of a separator is examined once more with those escapes decoded (three levels); the decoded, redacted copy is returned only when it revealed a credential, so nothing is mapped back onto the original and no tail can be left, and text that names no credential keeps its escapes (controls: ordinary percent-encoded URLs, random bytes stuffed with escapes). The artifact scan reads the same decoded copy. **Documented and pinned limit**: escapes nested more than three levels are not read | `redaction-classes-round4b` (class 3, artifact scan, precision controls) | executed-red | M208 to M214 |
| B4 | P2 | The whole lower-cased key is tested for credential words, not only its segments (`database_url`, `redis_url`, `webhook_url`, `stripeKey`, `slack_webhook`, `mongodb_uri`, `connection_url`) | FIXED: with separators removed the key must not contain a credential word, a connection URL or DSN name, `webhook`, or a vendor name followed by `key`; the assignment keywords and prefilter follow. `PGPASSWORD`, `dbpass`, `userpass`, `adminpwd`, `DB_PASS`, `smtp_pass`, `passcode`, `signingkey`, `encryption_key`, `master_key`, `ssh_key`, `secretkey`, `cookies` and `Auth` were **held** and are pinned; ordinary keys (`primary_key`, `keyboard`, `author`, `redis_host`, `callback_url`) are controls | `redaction-classes-round4b` (class 4) | executed-red for the keys that leaked | M195 to M202 |
| B5 | P2 | Idempotence on short mixed shapes (`AKIA...EXAMPLEsk-<24>`, `hf_` after an uppercase token, `password=bearer\nabcdefghijk=>`) | HELD: `redactString` is a fixed point by construction (at most six passes, a text that does not settle is replaced whole); pinned by every ordered pair of 16 pieces with 8 joins and 3,000 seeded random triples and quadruples | `redaction-classes-round4b` (class 5) | **held** at the round-3 tree (all pass there) | none needed |
| B6 | P3 | `U+13430` to `U+1343F` and `U+FFF9` to `U+FFFB` are not folded | HELD: the hiding class is `\p{Default_Ignorable_Code_Point}` plus `\p{Cf}`; pinned for these ranges, for every `\p{Cf}` code point, and inside a key and an assignment | `redaction-classes-round4b` (class 6) | **held** at the round-3 tree | none needed |
| B7 | P3 | An own `__proto__` key is dropped silently | HELD: keys are copied with `Object.fromEntries`, which defines an own property; the value is kept, redacted by its content, and no prototype is touched; pinned at depth 0 to 8 | `redaction-classes-round4b` (class 7) | **held** at the round-3 tree | none needed |

Red before, green after: `tests/unit/redaction-classes-round4b.test.ts` (172 tests, with its helper) run alone against an extract of
the round-3 tree: **118 fail by assertion**, 54 pass (the held classes, the controls and the pinned limits); the 13 templates added to the shared
template list make `redaction-depth-generative` fail by assertion in 46 of 65 tests and `redaction-depth-e2e` in 14 of 16 at the round-3 tree
(none of the counted failures is an import, type or spawn error). On the fix tree: 172 of 172, 65 of 65 and 16 of 16 pass, and the
regression run of every unit test file plus the near integration files (48 files, 1,921 tests, `--maxWorkers=2`) passes. The 35 new
mutants (M195 to M229) are each killed by at least one assertion failure in a targeted run on the fix tree; M225 first survived and a
test with one name before and one after the value now kills it. Timing: the 3 MiB adversarial inputs of the scaling matrix (runs of `{`,
`"name"`, `%3D`, quotes, 255 backslashes before every quote, repeated pair and list openings) stay linear (20 shapes added to
`round3-redaction-scaling`).

**Not run until the gates are authorised:** the full main suite with coverage (per-file coverage floors are not re-measured
on this tree), the full mutation run, the end-to-end mutants, the packaged E2E, the browser smoke, both gates and the Docker smoke.

### RED before, GREEN after (evidence)

RED: each new or changed test file was copied ALONE (plus its two shared helpers) into a `git archive` extract of
the round-3 tree (the reviewed tree, `node_modules` linked) and run with `npx vitest run <file>`
(JSON reporter, 2026-09-29T19:53Z to 19:55Z). Counts are tests / passed / failed BY ASSERTION / failed otherwise.

```text
tests/unit/redaction-depth-generative.test.ts        52 / 19 / 33 / 0
tests/unit/redaction-object-fixed-point.test.ts      58 / 22 / 36 / 0
tests/unit/redaction-forms-round4.test.ts            31 / 9 / 22 / 0
tests/unit/redaction-limits-exact.test.ts            54 / 38 / 16 / 0
tests/unit/runproof-strictness.test.ts               11 / 2 / 9 / 0
tests/unit/identifier-paths.test.ts                  29 / 27 / 2 / 0    (27 authored-only)
tests/unit/round4-kill-rule.test.ts                  24 / 0 / 2 / 22    (22 shim-dependent: the new API does not exist)
tests/unit/entry-guard.test.ts                       not-available: suite error (src/entry-guard.ts does not exist)
tests/integration/redaction-depth-e2e.test.ts        16 / 2 / 14 / 0
tests/integration/entry-forms.test.ts                11 / 2 / 9 / 0
tests/integration/bundle-export-self-verify.test.ts  2 / 1 / 1 / 0
tests/integration/limits-and-errors-round4.test.ts   14 / 8 / 6 / 0
tests/integration/bundle-header-forgery.test.ts      1 / 0 / 1 / 0
tests/integration/identifier-runproof.test.ts        4 / 4 / 0 / 0      (authored-only)
tests/integration/round4-unreferenced-files.test.ts  71 / 71 / 0 / 0    (authored-only: isolation)
tests/integration/round4-json-budget.test.ts         15 / 15 / 0 / 0    (authored-only: pins)
```

In total 151 tests fail BY ASSERTION at the round-3 tree (33 + 36 + 22 + 16 + 9 + 2 + 2 + 14 + 9 + 1 + 6 + 1); none of the counted failures is an
import, type or spawn error.

GREEN: the same 17 files on the fix (`npx vitest run --maxWorkers=2 <files> --reporter=json`, tree at a history commit, 2026-09-29T20:00:46Z
to 20:01:07Z, exit 0): **419 tests, 419 passed, 0 failed** (redaction-depth-generative 52, redaction-object-fixed-point 58,
redaction-forms-round4 31, redaction-limits-exact 54, runproof-strictness 11, identifier-paths 29, round4-kill-rule 24,
entry-guard 14, redaction-depth-e2e 16, entry-forms 11, bundle-export-self-verify 2, limits-and-errors-round4 14,
bundle-header-forgery 1, identifier-runproof 4, round4-unreferenced-files 71, round4-json-budget 15, round4-doc-pins 12). A regression
run of every unit test file plus the integration files near the changed code and the core acceptance suite (57 files, **1,944
tests, exit 0**, `--maxWorkers=2`, at a history commit) passed as well. **Not run until the gates are authorised: the full
main suite with coverage (so the per-file coverage floors are NOT re-measured on this tree), the full mutation run, the
end-to-end mutants, the packaged E2E, the browser smoke, both gates and the Docker smoke.**

Mutants: the 47 new mutants (M148 to M194) and the retargeted ones were run against the named test files in targeted runs. The first
run left four alive (M148, M159, M179, M183) and made three SUSPECT because their replacement did not type-check (M167, M175, M177:
the build failed and no test ran). The tests were strengthened (an exact-output precision test, a forms test whose secret holds no
credential word, a simulated serialisation overflow, a 2 million value pin below the aggregate budget) or the mutants rewritten, and
every one of them is now killed by a failing test (counts in `negative-controls.md`). That three mutants which only failed to compile
were reported SUSPECT and not KILLED is the behaviour the new kill rule exists for.

## Round 5: independent reviews of the round-4 tree (conformance, security, logic, tests)

Four independent reviews of the round-4 tree (the round-4 tree). The conformance review found no defect in
product behaviour it could show as a false FIXED, two problems in the evidence, and documented promises and wording that did not hold (F1 to
F11 below); the security, logic and tests reviews follow in the next section (one P0, the redactor that never returned). Fix commits after
the round-4 tree: history commits (redactor), a history commit (mutation instrument), a history commit (bundle, adapter, manifest, gate cap), then the
tests and the documents. Evidence classes are those of Round 3.

| # | Sev | Finding | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | P1 | Four mutants (M57, M82, M115, M123) no longer occur in `src/redact.ts` after the redactor changed, so the harness exits 1 while the documents say all are killed | FIXED: retargeted (and M151, M152, M229, orphaned by this round's redactor change); `--check` in both harnesses (run first by the harness), a gate step with a negative control, and a main-suite test over both lists; the claim is dated (targeted runs at a named commit; full run pending) | `round5-mutant-targets` (both lists match exactly once, ids unique, the checker goes red on a missing, a duplicate, a repeated and a no-op target, both harnesses exit 1 under `MUTATION_CHECK_SELFTEST=1`, the gate script orders the check before the mutation controls) | executed at the round-4 tree: the occurrence check reports 4 problems (M57, M82, M115, M123); the test file itself is shim-dependent there (`--check` does not exist) | M57, M82, M115, M123, M151, M152, M229 killed at a history commit |
| F2 | P1 | The acceptance matrix names a test id that omits its describe, so two reconciliation tests of the core suite fail | FIXED: the id is the describe title; the core suite runs 125 of 125 | `proofgate.spec` (AC index reconciliation) | executed: 2 failed, 123 passed at the round-4 tree (reviewer); recorded again after the fix | none |
| F3 | P2 | YAML block scalars and node properties after a credential key leak (`password: \|`, `>-`, `\|+`, `&a S`, `!!str S`, `api_key: \|\r\n  S`), a form the interface document says is found | FIXED: a history commit a block scalar is redacted to the end of its indented block (blank lines belong to it; an unindented first line runs to the end of the text; an explicit indentation digit takes every indented line), anchors and tags are skipped, at any nesting depth; `?=`, `+=` and `:=` are assignment operators (a marker no longer sits beside a visible secret), `-p=S` and `--db-password S` are read | `redaction-fix5` (20 block and property templates x depth 0 to 8, exact outputs at depth 0 and at every depth, operators, options, controls) | **executed-red**: 37 of 80 fail by assertion at the round-4 tree (65 tests at the time of the first run; the rest are controls and pins) | M230 to M244 |
| F4 | P2 | Process narrative is still in shipped files (a section that counted edits, notes on how the review was run, role names in the drill rules) and the pin covers only six words | FIXED: the sections and sentences are removed or reworded, the role name is "the maintainer", the pin covers the wider vocabulary in every shipped document | `round4-doc-pins` (round 5 block) | **executed-red** (4 of 17 fail by assertion at the round-4 tree) | none |
| F5 | P2 | The list of shapes that are not redacted misses shapes a reviewer found (`PASSWORD ?= S`, `+= S`, `-p=S`, `--db-password S`, `ENV PASSWORD S`, scheme-less `//user:S@host`, typed assignment, JSON-escaped and look-alike key names, PowerShell `-Password`, object pairs with other key spellings, short names) and gives a wrong reason for `:=` | PARTLY: `?=`, `+=`, `:=`, `-p=S` and `--db-password S` are fixed (F3); the rest are listed in the interface document and SECURITY, each pinned by a test that expects it to stay unredacted; the wrong reason is gone (`:=` is fixed). **Whether any of the listed shapes should be covered is an open decision for the owner; a reviewer's ruling is advisory** | `redaction-fix5` (the not-redacted block), `round4-doc-pins` | executed-red (the operators and options) and authored-only (the pins of the listed limits) | none |
| F6 | P3 | SECURITY and README state fewer limits than the interface document; the masked bundle fields are not pinned | FIXED: SECURITY lists the shapes and the masked-field limit, README points at the list, both are pinned | `round4-doc-pins` | executed-red (part of the 4) | none |
| F7 | P3 | The ledger maps 43 findings; the four round-3 review reports hold 44 (the main harness had no wall-clock limit) | FIXED: row T12, the count is 44, and the tests headline (four P2, six in its list) is noted | `round4-doc-pins`, `round4-kill-rule` | docs-only | M142 |
| F8 | P3 | The AC-09 row says rounds 1 and 2 found defects, and the Summary carries no provisional marker | FIXED: "rounds 1 to 4", and the Summary heading says its rows are provisional | `proofgate.spec` | docs-only | none |
| F9 | P3 | The upstream claim in ADAPTERS names three of the four changed files | FIXED: the fourth (one documentation file) is named; no source file changed | none | docs-only | none |
| F10 | P3 | A whole AWS documentation sample, glued to a word, is a literal in a test | FIXED: assembled from fragments (`hygiene-scan` clean). History of earlier lines still holds it: a release must be a squash whose history is checked | `round1-redaction` | authored-only | none |
| F11 | P3 | The kill claim is carried forward without a date or tree and is false for four entries | FIXED: dated in every document, the full run is stated as pending, and a pin keeps "all mutants killed" out | `round4-doc-pins` | executed-red (part of the 4) | none |

### Round 5, the security, logic and tests reviews of the round-4 tree (37 findings: security 16, logic 6 including the P0, tests 15; with the 11 conformance findings above, 48)

The three later reports on the same tree found, in addition to the conformance findings above: security one P1 (options with quoted values),
eight P2 and seven P3; logic one P0 (a redactor that never returned), two P2 and three P3; tests three P1, seven P2 and five P3 (its first
two P1 are the conformance F1). Evidence classes as in Round 3: **executed-red** = fails by assertion in an isolated, capped run
against an extract of the round-4 tree (`node scripts/run-with-cap.mjs` around the runner; a hang is a failed assertion); **regression pin** = green at
the round-4 tree and pinned so that a later change cannot lose it; **authored-only** = a pin of a stated limit; **docs-only**.

| # | Sev | Finding | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | P0 | The redactor never returned on `{"key":"value"}`, `{"name":"default_value"}`, `{'key':'value'}`, `{"Name":"Value"}`, `{"ParameterKey":"ParameterValue"}`, `{"name":"valueFrom"}`, `{"name":"value","value":"x"}`, `{"header":"value"}`, and `proofgate evaluate` spun on a receipt whose command is `curl -d '{"key": "value"}' ...` (SIGTERM ignored) | FIXED: every scan uses its own copy of its patterns (`fresh`); a static test refuses any other module-level global or sticky pattern; the analysis is in the section below | `redaction-termination` (every hang string of the report and the curl receipt, in a child process with a hard cap, the same strings at nesting depth 1 to 6, a 100,000-string property run, an object run, the packaged `evaluate`, the static check), `redaction-no-regression` | **executed-red**: 20 of 30 fail by assertion at the round-4 tree (each "hang" is the cap being hit) | M245 killed by 19 assertions |
| S1 | P1 | Options with a double-quoted value leak at nesting depth 2 or more (`run --password \\\"S\\\"`), `-u "user:S"` at depth 1 or more, an escaped quote in the secret leaks its tail, and `--Authorization="S"` regressed from the round-3 tree | FIXED: options, `-u`/`--user`, user information, pairs and lists read their values with the same layer arithmetic as assignments (`quotedValueEnd`); compound option names are judged by the key-name rule | `redaction-quoting-matrix` (every step family x every quoting style x depth 0 to 8, escaped quote inside the secret, `--Authorization=`), `redaction-depth-generative`, `redaction-precision` | **executed-red**: 76 of 104, 16 of 83 and 10 of 29 fail by assertion at the round-4 tree | M238, M249, M164, M265 |
| S2 | P2 | `%5C` and `%5F` are not decoded, so percent-encoded JSON with an escaped quote leaks | FIXED: `%5C %5F %2D %2E` join the decoded set; ordinary escapes (`my%2Dfile.txt`, `1%2E2%2E3`, `C:%5Cusers%5C...`) keep their form unless a credential shape appears | `redaction-quoting-matrix` (percent cases), `redaction-precision` (controls) | executed-red (part of the 76) | none (the constant is covered by the matrix) |
| S3 | P2 | A name/value pair is recognised only for labels of a fixed shape (spaces, brackets, `$`, more than 80 characters leak) | FIXED: the label is judged by the key-name rule, as written and as redacted, when it is a single line of up to 1,100 characters; longer or multi-line labels are a documented limit | `redaction-alternatives`, `redaction-fix5` (limits), `redaction-precision` | executed-red (part of the 10 and 37) | M258, M259 |
| S4 | P2 | The pair vocabulary is fixed (`{label, value}`, `{name, data}`, `{k, v}`, ...) | NOT FIXED, by decision: listed in the interface document and in SECURITY, pinned by a test that expects it to stay unredacted. **Open owner decision** | `redaction-fix5` (not-redacted block) | authored-only | none |
| S5 | P2 | Text pairs: a value-first pair leaks past about 1 KiB, an object or array value is not read, more than 3 blanks stop the match, a nested object between the keys ends the search | FIXED: window 4 KiB (plus escape overhead), object and array values are taken whole, 64 blanks, a nested object is stepped over and an object boundary ends the search; beyond the window is a documented limit | `redaction-alternatives`, `redaction-precision` (exact outputs), `redaction-fix5` | executed-red (part of the 10 and 10) | M215, M217, M250, M251, M260, M261, M262 |
| S6 | P2 | Compound option names are not redacted (`--client-secret S`, `--access-token S`, `--db-password S`, `--api_key S`) | FIXED with S1 | `redaction-quoting-matrix`, `redaction-fix5` | executed-red | M238 |
| S7 | P2 | A password with `/` or `@` in user information leaks; the scheme-less `//user:S@host` is never read | FIXED: the password ends at the last `@` before the first `/`, `?`, `#`, quote, backslash or blank, else the first `@`, else the last `@` of the token within 512 characters (a slash in the password); scheme-less form read; e-mail, `git@host:path`, `a@b/c`, URLs with `@` in the query stay; linear (binary search over `@` positions) | `redaction-quoting-matrix`, `redaction-precision`, `round3-redaction-scaling` (user-information shapes) | executed-red (part of the 76) | M246, M247, M248, M263, M264 |
| S8 | P2 | Python `b'S'`, YAML block scalars and tags, blank and comment lines, escaped tab padding, folded multi-line quote, more than 64 blanks | FIXED: prefixes, block scalars (conformance F3), blank and comment lines; NOT FIXED and listed, pinned: more than 64 blanks, a tab written as text around `=`, a folded multi-line quoted value | `redaction-fix5`, `redaction-alternatives` | executed-red / authored-only (the limits) | M253, M254, M256 |
| S9 | P2 | The artifact scan refuses random binary data (the `assignment` step is not gated) | FIXED (also logic L3): every short-shape step is gated on a mostly-text window | `redaction-quoting-matrix` (binary controls) | executed-red | M255 |
| S10 | P3 | A text key longer than about 88 characters is not recognised | NOT FIXED: the name is read for 80 characters around its keyword so that the scan stays linear, and a text key that long is not a credential name in practice; listed and pinned (object keys of any length are read whole). Open owner decision | `redaction-fix5` | authored-only | none |
| S11 | P3 | Control characters, no-break space, the Braille blank split a keyword or a token | NOT FIXED: characters that no reader folds (controls, no-break space, Braille blank) could be folded only at the price of changing what a keyword is; the invisible and format characters that can hide a token are folded; listed and pinned (now including the no-break space and the Braille blank). Open owner decision | `redaction-fix5` | authored-only | none |
| S12 | P3 | Usage counters (`input_tokens`, `pass_rate`) are redacted | FIXED: the exemption covers the common spellings in text and objects | `redaction-alternatives` | executed-red | M257 |
| S13 | P3 | A single-quoted Python string with `\'` inside JSON text ends early | NOT FIXED: `quotedValueEnd` counts the escapes of the double quote that JSON adds; a single-quoted string escapes its own quote another way, and a value that holds `\'` inside JSON text is a shape a real Python repr produces only for strings that hold both quote kinds; listed and pinned. Open owner decision | `redaction-fix5` | authored-only | none |
| S14 | P3 | The bundle magic accepts `PROOFGATE-BUNDLE 01`; entry roles are not verified | FIXED: canonical magic, role cross-checked against the path | `round5-bundle-checks` | **executed-red**: 5 of 6 fail by assertion at the round-4 tree | M267, M268 |
| S15 | P3 | Hard links are accepted and not documented | DOCUMENTED (a limit; the receipts tree is the operator's own) | `round4-doc-pins` | docs-only | none |
| S16 | P3 | Digit-suffixed short names (`pass1`, `pwd1`) and a few names are not judged sensitive | FIXED for the digit-suffixed ones; the rest is listed and pinned (S4 group) | `redaction-fix5` | executed-red / authored-only | none |
| L2 | P2 | `bundle export` needs a writable, large system temporary directory (a read-only `TMPDIR` fails it with a message that blames the bundle) | FIXED: the export verifies next to the output file, so no `TMPDIR` is involved | `round5-bundle-checks`, `bundle-export-self-verify` | executed-red (part of the 5 of 6 of `round5-bundle-checks`; `bundle-export-self-verify` holds at the round-4 tree) | M171, M266 |
| L3 | P2 | The artifact scan still flags random binary data (`signature-parameter`, `assignment`, `url-credentials` run on raw bytes) | FIXED with S9 | `redaction-quoting-matrix` | executed-red | M255 |
| L4 | P3 | A RunProof run with a plain `status` field imports as a pass | FIXED: refused, documented in the adapters document | `runproof-strictness` | **executed-red**: 4 of 19 fail by assertion at the round-4 tree | M269 |
| L5 | P3 | The interface document does not name entry `role` and `engine.version` among the bundle fields that are not cross-checked | FIXED: `role` is now checked; `engine.version` is named | `round4-doc-pins` | docs-only | none |
| L6 | P3 | Duplicate YAML keys are compared by value, so `1` and `'1'` are two keys but one JSON key | FIXED: compared as `String(key)` | `round5-manifest-keys` | **executed-red**: 6 of 8 fail by assertion at the round-4 tree | M270 |
| T3 | P1 | Multi-line YAML flow lists and a blank line inside a block list leak | FIXED (block scalars: conformance F3) | `redaction-alternatives` | executed-red (10 of 38) | M252, M253, M254 |
| T4 | P2 | 22 leak-direction mutants survive the named tests (`%0D%0A`, `\u000a`, `\x0a`, `\b`, tab after a dash, nested list item, `%5B %5D`, pair name judged as written only, `hmacKey`, `serverpass`, label and window sizes, a raw quote in an escaped value) | FIXED: one leak test per alternative, in text and object form | `redaction-alternatives` | executed-red (10 of 38 fail at the round-4 tree; the rest pin behaviour that already held) | M195, M205, M221, M224 and the alternatives of the report |
| T5 | P2 | A crash of the spawned command counts as KILLED (only through exit-code assertions) | DOCUMENTED as a weak kill and pinned (the rule cannot tell them apart without a decision-value assertion) | `round4-kill-rule` | authored-only | M142, M143 |
| T6 | P2 | The per-document container limit is unpinned upward (700,000 survives) | FIXED: heap-capped pins at 600,000 refused and 480,000 accepted | `limits-and-errors-round4`, `round4-json-budget` | authored-only (pins) | J5 (end-to-end list) |
| T7 | P2 | RunProof strictness is proven only for the first check | FIXED: the dropped definition and the `__proto__` check at index 1 or later | `runproof-strictness` | authored-only (the new index >= 1 pins hold at the round-4 tree; the mutants were alive) | M175, M177 |
| T8 | P2 | The controls table has 208 rows for 229 mutants | FIXED: a row for every mutant (274), a test that every mutant has a row | `round5-mutant-targets` | shim-dependent at the round-4 tree (there is no `--check` there); green on the fix | none |
| T9 | P2 | AC-09 is PASS while a leak class and a long not-redacted list stand | FIXED: AC-09 is PARTIAL, gap text refreshed, pinned | `proofgate.spec` (AC-03, AC-06 and AC-09 stay PARTIAL) | docs-only | none |
| T10 | P2 | The matrix names a test without its describe; SECURITY lists two of the unfixed shapes | FIXED: the id has its describe; SECURITY lists the shapes and defers to the interface document for the complete list | `round4-doc-pins`, `proofgate.spec` | executed-red (part of the 4) | none |
| T11 | P3 | The kill-rule tests use synthetic failure messages | FIXED: one real vitest message per case | `round4-kill-rule` | authored-only | M182 |
| T12 | P3 | `vitest.config.ts` comment and the missing floor for the entry guard | FIXED | `entry-guard` (in-process refusal) | authored-only | none |
| T13 | P3 | Timing assertions use absolute bounds | FIXED: ratios | `redaction-depth-generative`, `limits-and-errors-round4` | authored-only | none |
| T14 | P3 | Boundary survivors (the guard's code, a 99% text gate, the fold budget, `passcode`, the escape-run window, depth 32) | NOT FIXED: low priority, boundary cases with no leak; listed here as open | none | none | none |
| T15 | P3 | A run killed by the cap leaves `pg-killrule-*` scratch directories | NOT FIXED: a process killed with SIGKILL cannot clean up after itself; the directories hold no data | none | none | none |

The conformance findings F1 to F11 above and the rows here cover every finding of the four reports (the conformance report: 11; security: 16;
logic: 6; tests: 15, of which T1 and T2 are F1). Two rows changed while they were written: the first fix of anchors and tags (skipped as YAML
properties) lost secrets that begin with `!` or `&`, and a later differential found more, so the rule is fail-closed (next section).

### The redactor that never returned: why 1,921 tests and 229 mutants missed it

- Every pair test used a label that names a credential (`DB_PASSWORD`, `password`); judging such a label runs the redactor on the label and the
  nested call does not reach the bad path a second time. No test fed the redactor ordinary text that merely contains the words `key`, `name`,
  `value` or `header`. The 229 mutants change the reader's decisions, not its termination, and a test that loops in a synchronous loop cannot
  time out from inside its own process, so even a test that had reached the loop would have hung the suite, not failed it.
- A shared global pattern was iterated by a scan that called the redactor again through the label check; the nested call reset the position of
  the outer loop. The fix is a private copy per scan; the static test lists every module-level global or sticky pattern and allows only
  single-use sticky ones, so a new shared pattern fails the suite at once.
- Guards now in place: termination checks run in a child process with a hard wall-clock cap (a hang is a failed assertion); a 100,000-string
  property run over the scanners' own words and marks; the gate's test step runs under `scripts/run-with-cap.mjs`, so a hang cannot pass the
  gate by never finishing; the packaged `proofgate evaluate` on the curl receipt.

### Differentials against the round-3 tree (scratch evidence) and the frozen fixtures

A differential between the redactor of the round-3 tree and the current one over random strings built from the scanners' own words and marks (100,000
strings, three seeds) found three leaks introduced by round 5 itself, each fixed and each turned into a permanent test:
(1) YAML anchors and tags skipped as properties left `password:&S` and `token:!S`; (2) the same skip left `passwd:\n  &S` and `password: !S word`;
(3) the option reader took `--api_key :'S` for an option with the value `:`. The fix is fail-closed: a value that starts with an anchor or a tag is
redacted to the end of its line (and an indented line below when the anchor or tag ends its line; a block scalar behind it is a block), and a colon
after an option is an assignment separator. The permanent tests are two frozen fixtures of 600 generated inputs each (seeds 5150 and 777), every
input holding a planted secret that the redactor of the round-3 tree hid, which the current redactor must hide too (`redaction-no-regression`).
The final differential, 100,000 fresh strings with a new seed (424242): 98,769 equal, **0 redacted less**, 1,228 redacted more (1,206 by the
percent-decoding of the second pass, 2 in block scalars, 1 in user information, 19 by the option reader taking the next line's word after an
option at the end of a line), 3 with the same number of markers and different spans.

### Red before, green after (round 5, all four reports)

Red: each new or changed test file alone (plus its two support files) in an extract of the round-4 tree, run through
`scripts/run-with-cap.mjs` with the JSON reporter. Counts are tests / passed / failed BY ASSERTION / failed otherwise:

```text
tests/unit/redaction-termination.test.ts           30 / 10 / 20 / 0
tests/unit/redaction-quoting-matrix.test.ts        104 / 28 / 76 / 0
tests/unit/redaction-alternatives.test.ts          38 / 28 / 10 / 0
tests/unit/redaction-fix5.test.ts                  80 / 43 / 37 / 0
tests/unit/redaction-depth-generative.test.ts      83 / 67 / 16 / 0
tests/unit/redaction-precision.test.ts             29 / 19 / 10 / 0
tests/unit/redaction-no-regression.test.ts         12 / 12 / 0 / 0    (regression pin: green at the round-4 tree, red on the round-5 tree before its own fixes)
```

Green: the same files on the fix, plus `round3-redaction-scaling`, `round5-mutant-targets` and `round4-doc-pins`, and the regression run recorded in
`gate-evidence.md` when it has been made. **Not run until the gates are authorised:** the full main suite with coverage (per-file floors are
not re-measured on this tree), the full mutation run (main and end-to-end), the packaged end-to-end run, the browser smoke, both gates and the
Docker smoke. Mutants: 274 in the main list (`--check`: 274 checked, 0 problems) and 7 end-to-end (7 checked, 0 problems); M230 to M274 and the
retargeted ones were killed in single-mutant targeted runs at the round-5 redactor; the full run has not been made.

## Round 6: independent reviews of the round-5 tree (conformance, security, logic, tests)

Four independent reviews of the round-5 tree found 66 items: conformance 24 (one P1, eight P2, fifteen P3), tests 18 (three P1, seven P2, eight P3; its
headline says eight P2, its list holds seven), logic 7 (two P2, five P3) and security 17 (two P1, eight P2, seven P3; its headline says eight P3, its list
holds seven). Both P1 findings of the security review and the one of the conformance review (two of the three of the tests review are the same defect
in another form) were regressions: the round-5 redactor hid less than an earlier one on a shape that the earlier one hid. Every item below is either
FIXED with a test or LISTED with the reason and a pin; nothing is waived on a reviewer's behalf, and the listed shapes are open decisions for the owner.
Evidence classes are those of Round 3 and Round 5: **executed-red** = fails by assertion in an isolated, capped run against an extract of the round-5 tree
(`node scripts/run-with-cap.mjs` around the runner; a hang is a failed assertion); **regression pin**; **authored-only** = a pin of a stated limit;
**docs-only**. Commit-id policy: no shipped document names a commit of the working history (a squashed public history cannot resolve them); trees are named by the
round that reviewed them, and a test refuses a 7 to 40 digit hexadecimal token in any shipped document.

### Conformance review of the round-5 tree (24 findings)

| # | Sev | Finding | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | P1 | An option named `Authorization` glued to `=` and followed by `[`, `{`, `b'`, `$'`, `u"` or a tag is not redacted; the round-3 tree hid all of them and the frozen fixtures did not cover the family | FIXED: the value of an option whose name ends in `Authorization` (also `-userAuthorization`, `-Authorization-`) runs to the end of the line, an option value that starts with a bracket, brace, parenthesis, anchor or tag is read as a whole, a Python prefix or a shell `$` in front of a quote is part of the value; the fixtures are derived from BOTH earlier trees (three of them) | `redaction-options-round5`, `redaction-no-regression` (fixtures 3, 4 and 5) | executed-red | M275 to M279 |
| C2 | P2 | The not-redacted list misses YAML forms (`password: correct S battery`, a plain multi-line scalar, `- - S`, `'it''s S'`, a complex key) and the documents claim every listed shape is pinned | LISTED: added to the interface document and SECURITY, each pinned by a test that expects it to stay unredacted. Open owner decision | `redaction-fix5` (not-redacted block) | authored-only | none |
| C3 | P2 | Python and shell literal forms leak and are unlisted (triple quotes, `('S')`, adjacent literals, `$"S x"`, escaped blanks, line continuation) | FIXED for an option value and for a quote after a Python prefix or `$`; LISTED and pinned: triple quotes, adjacent literals, `$"S x"` after an assignment, backslash-escaped blanks, a line continuation. Open owner decision | `redaction-options-round5`, `redaction-fix5` | executed-red / authored-only | M279 |
| C4 | P2 | An object or array value under a credential key is not redacted as JSON text (`{"secret": {"a": {"b": "S"}}}`, `PASSWORDS=(a S)`), although `redactValue` hides it | FIXED: a `{...}` or `(...)` value under a credential key is read whole in text, at any depth | `redaction-security-round5` | executed-red | M280 |
| C5 | P2 | `--name N --value V`, `set NAME VALUE`, `gh secret set`, Python tuple pairs and several option spellings leak and are unlisted | LISTED and pinned (a command line that names the credential in one word and gives it in another). Open owner decision | `redaction-fix5` | authored-only | none |
| C6 | P2 | The claim that every listed shape is pinned is false for a no-break space, `<add key="password" value="S"/>` and the Braille blank | FIXED: the three pins exist and the list names the Braille blank | `redaction-fix5` | executed (pins) | none |
| C7 | P2 | The acceptance matrix has no evidence for round 5 and still says four rounds | FIXED: Round 5 and Round 6 sections of the matrix, "rounds 3 to 6" | `proofgate.spec` (AC index reconciliation) | docs-only | none |
| C8 | P2 | 60 commit ids of the working history in shipped documents | FIXED: none remains; policy above; a pin refuses a hexadecimal token of 7 to 40 digits in every shipped document | `round4-doc-pins` | executed-red | none |
| C9 | P2 | `run-with-cap` does not forward SIGINT, SIGTERM or SIGHUP, so an interrupted gate leaves an orphan | FIXED: the three signals go to the process group, a 5 s grace period, exit 128 plus the signal; a cap above 2^31 - 1 ms is a usage error | `round5-run-with-cap` (signals, elapsed times, a grandchild, the cap range) | executed-red | M294, M295 |
| C10 | P3 | Escaped and encoded spellings of a separator or of key letters (`=`, `\x3d`, `%77`, `&#61;`, `&quot;`, a split JSON key) leak and are unlisted | LISTED and pinned | `redaction-fix5` | authored-only | none |
| C11 | P3 | Text and object key rules disagree (`mnemonic`, `seed_phrase`, `pw`, session cookie names, ...) | FIXED for the short names that the key rule knows and that are credential words in text (`pw`, `pswd`, `tls_key`, `privkey`, `id_rsa`, `storepass`, `mnemonic`, `client-key-data`, `keypass`); LISTED and pinned for the rest (`seed_phrase`, `unseal_key`, `recovery_code`, `Pass`, a `sha256=` hub signature, session cookie names as text). Open owner decision | `redaction-shapes-round5b`, `redaction-fix5` | executed-red / authored-only | none |
| C12 | P3 | Markup and SQL forms leak (`<input name="password" value="S">`, `IDENTIFIED BY 'S'`) | LISTED and pinned | `redaction-fix5` | authored-only | none |
| C13 | P3 | The round-5 headline counts are wrong | FIXED (37 and seven) | none | docs-only | none |
| C14 | P3 | Rows S10, S11, S13 are NOT FIXED with no reason | FIXED: a reason for each, marked open owner decisions | none | docs-only | none |
| C15 | P3 | M142 and M143 have two rows each | FIXED: one row per mutant, and a test that says so | `round5-mutant-targets` | executed-red | none |
| C16 | P3 | The gate table of the release document omits the instrument check, its negative control and the wall-clock cap | FIXED | none | docs-only | none |
| C17 | P3 | The benchmark page does not mention the redactor changes and uses process wording | FIXED | none | docs-only | none |
| C18 | P3 | A garbled sentence and a Docker tag name that carries the history | FIXED | none | docs-only | none |
| C19 | P3 | The operations document mentions a restore with no `--output`, and the verify message blames "restored files" | FIXED: the clause is gone, the message names "the verification copy" | `round5-bundle-checks` | executed-red | none |
| C20 | P3 | Both PRD pages import a diagram library from a CDN | FIXED: the import is removed | none | docs-only | none |
| C21 | P3 | The shipped PRD copy carries internal workflow text | FIXED: the frozen copy is marked as not part of the software | none | docs-only | none |
| C22 | P3 | The static re-entrancy test misses `PRIVATE_KEY_BEGIN` (a shared global pattern in a loop), multi-line and constructed patterns and other files | FIXED: `PRIVATE_KEY_BEGIN` works on a private copy, the declaration finder reads multi-line and constructed patterns in every source file, and a single-use sticky pattern is named in the allow-list | `redaction-termination` | executed-red | M281 |
| C23 | P3 | The packaged-E2E helper has no timeout, the packaged E2E and browser smoke steps are not under the cap, `run-with-cap 1e12` exits 124 at once | FIXED: timeout and kill signal in the helper, both steps run through the cap, a cap above 2^31 - 1 ms is refused | `round5-run-with-cap` | executed-red | none |
| C24 | P3 | Build-process vocabulary remains in shipped files | FIXED: a wording pass; the pin covers the wider vocabulary | `round4-doc-pins` | executed-red | none |

### Tests review of the round-5 tree (18 findings)

| # | Sev | Finding | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | P1 | The round-5 redactor redacts less than the round-4 one on 106 of 110,000 generated strings (an option followed by `=>`, `=[`, `+=` and `?=` swallowing, a tag before a block, `Authorization:` and a block on an escaped line) | FIXED with C1: every one of those shapes is read again, in the fixtures and in named tests | `redaction-options-round5`, `redaction-shapes-round5b`, `redaction-no-regression` | executed-red | M275 to M279 |
| T2 | P1 | Ordinary shapes leak in every tree: a `.env` body inside a JSON string whose second value is quoted, a YAML parent key over a quoted child, an escaped newline that regressed against the round-3 tree | FIXED: a value ends at a line break written as text in front of the next `NAME=`, a credential-named parent leaves its child to the child's own reader, a block scalar behind a tag is redacted with the tag | `redaction-shapes-round5b` (47 tests) | executed-red | M302 |
| T3 | P1 | The kill rule calls a labelled Playwright `expect(x, "label")` failure an error | FIXED: classification by the structure of the message (a line that starts with `expect(`, an Expected / Received block, `AssertionError`, a snapshot mismatch, a `promise resolved ... instead of rejecting`); real Playwright and vitest messages are rows of the test | `round4-kill-rule` | executed-red | M290 |
| T4 | P2 | The vitest classifier calls some assertion failures errors and some crashes assertions | FIXED with T3 (messages taken from real runs) | `round4-kill-rule` | executed-red | M290 |
| T5 | P2 | The static no-shared-regex test scans one file for one declaration shape | FIXED with C22 | `redaction-termination` | executed-red | M281 |
| T6 | P2 | The documentation pin checks the counts 229 and 244, not the current one | FIXED: the pin knows every count of a tree that was reviewed, and the count of the list is compared with the count of the rows | `round4-doc-pins`, `round5-mutant-targets` (318) | executed-red | none |
| T7 | P2 | The documents say short key names count; in assignment text they do not | FIXED (with C11) | `redaction-shapes-round5b`, `redaction-fix5` | executed-red | none |
| T8 | P2 | Leak-direction survivors of the round-5 redactor against the redaction unit files | FIXED: twelve boundary tests and the mutants below; the mutants that stayed alive in the wider run (M285, M286) got a stronger test | `redaction-boundaries-round5`, `redaction-security-round5` | executed-red (boundaries: green at the round-5 tree, pins) | M283 to M289 |
| T9 | P2 | The process-group kill of `run-with-cap` and of `kill-rule.runWithCap` is unpinned | FIXED: a grandchild is dead after the cap, an interrupt is passed on, the capped run of the kill rule kills the group twice, and the scratch runs stop and report any process that still holds their directory | `round5-run-with-cap`, `round4-kill-rule` | executed-red | M294, M295, M296, M317 |
| T10 | P2 | The frozen fixtures pin one narrow class | FIXED: fixture 3 (option forms), 4 (option neighbours) and 5 (reviewer shapes, 982 inputs) derived from BOTH earlier trees, and the differential is permanent (`redaction-no-regression`) | `redaction-no-regression` | executed-red | none |
| T11 | P3 | Nothing pins that a normal harness run checks its targets first | FIXED: each harness is run without `--check` on a target that cannot match and must stop before any baseline | `round5-mutant-targets` | executed-red | none |
| T12 | P3 | Bundle entry and header survivors (roles of `report/report.sha256` and `revisions.json`, magic versions of six and seven digits, the free-space check) | FIXED | `round5-bundle-checks` | executed-red | M267, M268, M291 |
| T13 | P3 | A failed test file with no tests is not counted as a suite error | FIXED | `round4-kill-rule` | executed-red | none |
| T14 | P3 | The 4 MiB slowdown bound is 20 s, more than ten times the normal cost | LISTED: kept generous so that a loaded host does not fail it; growth is bounded separately by the scaling matrix (1, 2 and 3.5 MiB) and by the per-shape table below (4 and 16 times). Open owner decision | `redaction-termination`, `round3-redaction-scaling` | authored-only | none |
| T15 | P3 | 140 of 455 matrix ids resolve by describe prefix or template title; two name a macOS-only skipped test | LISTED: the matrix says how such ids are read; the two macOS-only ids are named as such | `proofgate.spec` (AC index) | docs-only | none |
| T16 | P3 | Two SECURITY pins were shortened to fragments | FIXED: the full phrases are pinned again | `round4-doc-pins` | executed-red | none |
| T17 | P3 | Two timing bounds became ratios with floors of 200 ms and 50 ms | LISTED: a ratio without a floor is unstable at small sizes; the matrix at 1 MiB and above carries the growth claim. Open owner decision | `limits-and-errors-round4` | authored-only | none |
| T18 | P3 | Coverage was not run at the reviewed tree | LISTED: the coverage step is a step of the quality gate and has not been run on this tree (it needs the owner's go); the threshold configuration is unchanged | none | docs-only | none |

### Logic review of the round-5 tree (7 findings)

| # | Sev | Finding | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | P2 | Object-level redaction is not a fixed point when a pair's name only becomes a credential label once it is redacted | FIXED: the label is judged as written and as redacted | `redaction-shapes-round5b`, `redaction-object-fixed-point` | executed-red | M155 |
| L2 | P2 | `validateEntryPaths` allows any entry under `report/` with any role | FIXED: an allowlist of the report entries | `round5-bundle-checks` | executed-red | M291 |
| L3 | P3 | The RunProof exit-status refusal is a denylist | FIXED: verdict-like keys are normalised (case, separators) before the comparison | `runproof-strictness` (17 spellings) | executed-red | M292 |
| L4 | P3 | The duplicate-key pass skips non-scalar keys, so a repeated collection key is accepted | FIXED: a Map key must be a scalar, not a list or a mapping | `round5-manifest-keys` | executed-red | M293 |
| L5 | P3 | 276 rows for 274 mutants | FIXED (C15) | `round5-mutant-targets` | executed-red | none |
| L6 | P3 | The static guard is narrower than the interface document says | FIXED (C22) | `redaction-termination` | executed-red | M281 |
| L7 | P3 | The self-verify message says the free space equals the bundle size | FIXED: "about twice its size, plus a small margin" | `round5-bundle-checks` | executed-red | none |

### Security review of the round-5 tree (17 findings)

| # | Sev | Finding | Fix | Regression test | Evidence | Mutation |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | P1 | The usage-counter exemption ends in `\w*`, so `TOKEN_PERSONAL`, `TOKEN_MAX_SECRET`, `token_used_password` are not redacted (less than the round-3 and round-4 trees) | FIXED: the exemption is a whole-name list of counter spellings, text and object rule agree | `redaction-security-round5` | executed-red | M297 |
| S2 | P1 | A value that starts with `[` is read as a list, so `DB_PASSWORD=[S]tail`, `password=[]S`, `token=[a],tail`, `Authorization: [a]tail` keep the part behind the bracket (less than the round-3 tree) | FIXED: a bracketed value is a list when it closes and stands alone, else the bracket and the word behind it; a closed bracket in front of another credential's name leaves that name to its own reader; the marker of an earlier pass is never read as a bracket value | `redaction-security-round5` | executed-red | M298, M299, M315 |
| S3 | P2 | A credential-named parent key swallows its credential-named child (value on the next line, a block scalar, a list) | FIXED: the child is left to its own reader, also across a line break written as text | `redaction-security-round5` | executed-red | M302, M312, M313, M318 |
| S4 | P2 | An unquoted value does not end at an escape for a separator or at `\|`, `)`, `}`, `]`, `&`, `#`, `/`, `<br>` in front of the next credential's `NAME=` | FIXED for `\t`, `%20`, `%7C`, `%3E`, `%23`, `%3F`, `%2B`, `%21`, `\|`, `)`, `}`, `]`, `<`, `&`, `#`, `<br>`: they end a value in front of a credential-named pair whose credential word is a whole segment; LISTED: `/` is not a delimiter (a base64 secret holds it), and a delimiter in front of a name that is not a credential name stays in the value | `redaction-security-round5` | executed-red | M300, M301, M310 |
| S5 | P2 | The percent-decoded copy does not decode `%7C`, `%3E`, `%23`, `%3F`, `%2B`, `%21`, and `name:%20"S"` keeps its quoted value | FIXED: the decoded set is wider, a blank written as text in front of a quote is skipped | `redaction-security-round5` | executed-red | M212, M213, M285, M286, M311 |
| S6 | P2 | A credential key with an object value in text is redacted only up to its `{` | FIXED (C4) | `redaction-security-round5` | executed-red | M280 |
| S7 | P2 | argv `-u` and `user:pass` as the next element, and a glued `-uadmin:S`, are not read | FIXED: the element after `-u` or `--user` that holds a colon, a number after a credential option, and a glued `-uNAME:PASS` (read after its colon) | `redaction-security-round5` | executed-red | M307, M308, M309 |
| S8 | P2 | Object-level redaction is not a fixed point when a pair label changes under redaction | FIXED (L1) | `redaction-shapes-round5b` | executed-red | M155 |
| S9 | P2 | A YAML value line that starts with `#`, `>#` or `\|#` is read as a comment or a block header | FIXED: a `#` line with no indented line behind it is the value, `>#` and `\|#` are not headers, a comment after a header needs a blank in front of it | `redaction-security-round5` | executed-red | M303, M304, M305 |
| S10 | P2 | The "does not redact" list is not complete | FIXED: the list names every shape found by the four reports and by this round's differentials, each pinned | `redaction-security-round5` (known limits), `redaction-fix5` | authored-only | none |
| S11 | P3 | Session cookie names count only inside pairs | LISTED and pinned (as plain object keys `sid`, `PHPSESSID` keep their value). Open owner decision | `redaction-security-round5` | authored-only | none |
| S12 | P3 | `--password=<value with a space or an escaped quote>` inside a JSON array leaks the tail | LISTED and pinned: an unquoted option value ends at a blank | `redaction-security-round5` | authored-only | none |
| S13 | P3 | A credential-named option that takes no value or a path redacts the next word | LISTED and pinned: fail closed, the word behind `--password-stdin` or `--token-file` is redacted with it | `redaction-security-round5` | authored-only | none |
| S14 | P3 | User information with a raw `@` followed by another stop character ends at the last `@` before that character | LISTED and pinned. Open owner decision | `redaction-security-round5` | authored-only | none |
| S15 | P3 | A re-sealed bundle can carry extra entries under `report/` | FIXED (L2) | `round5-bundle-checks` | executed-red | M291 |
| S16 | P3 | The read-only `TMPDIR` claim holds for `bundle export` only; `bundle verify` still extracts to `TMPDIR` | FIXED: the operations document and the verify message say so | `round5-bundle-checks` | docs-only | none |
| S17 | P3 | Informational: the artifact scan runs at about 4.5 MB per second on random data | LISTED: no change, the scan is linear; noted for the operator | none | docs-only | none |

### Red before, green after (round 6)

Seventeen test files that this round added or changed, run against an extract of the round-5 tree with the current tests laid over it
(`node scripts/run-with-cap.mjs`, JSON result, a hang is a failed test): 794 tests, 589 pass, **205 fail by assertion**, none by timeout or crash. Per file (tests / passed /
failed by assertion): `redaction-options-round5` 44 / 12 / 32, `redaction-shapes-round5b` 47 / 10 / 37, `redaction-security-round5` 147 / 60 / 87 (the file was
first committed with 92 tests, 62 of them red at the previous commit, and grew as the differentials found more shapes), `redaction-no-regression` 18 / 15 / 3,
`redaction-fix5` 141 / 140 / 1, `redaction-termination` 31 / 29 / 2, `round4-kill-rule` 46 / 35 / 11, `round5-run-with-cap` 11 / 5 / 6, `round5-bundle-checks` 15 / 12 / 3,
`round5-manifest-keys` 12 / 8 / 4, `runproof-strictness` 37 / 24 / 13, `round5-mutant-targets` 19 / 17 / 2, `round4-doc-pins` 19 / 15 / 4; `redaction-boundaries-round5` (12), `redaction-object-fixed-point` (58),
`round1-redaction` (61) and `round3-redaction-shapes` (76) are green at the round-5 tree (regression pins). The red-before run was one JSON-reporter run of these
files in one process group under a 40-minute cap.

### Differentials at the round-6 tree (generated strings, new seeds)

The differential is a permanent test (`redaction-no-regression`, five frozen fixtures derived from both earlier redactors) and a scratch harness run once more on
fresh seeds against the round-3 tree, the round-4 tree and an intermediate tree of this round ("intermediate tree": an earlier state of this round's work, with no commit to cite, so its numbers cannot be reproduced; NOT the round-5 tree that was
reviewed, which is a comparator in the passes below), in three generator styles, 100,000 strings each. What follows is a count, not a
claim of "no leak": the remainder is classified below and every class is an open decision for the owner.

- **Noise** (random words and marks from the scanners' own vocabulary; seed 20261101; LESS = the round-6 output holds fewer markers than the earlier tree's).
  Against the round-3 tree: 92,726 same, 3,203 more, **509 less**, 3,562 other; against the round-4 tree: 96,415 / 279 / **362** / 2,944; against the intermediate tree:
  99,491 / 93 / **11** / 405. Every LESS was shrunk to a minimal string: 38 distinct shapes, 26 of them a keyword and a separator with no value (an earlier tree put a marker
  on nothing: `auth=>`, `secret:%0A`, `Authorization:` and an escaped line break), 12 a marker that two earlier spans merged into one (more text is redacted, fewer markers
  are counted). No shape was found where an earlier tree hid text that this one shows. The run found one regression of this round's own change (`password=abc,foo=x` lost
  its second pair on the second pass, because the marker of the first pass was read as a bracket value with text behind it); it is fixed and pinned.
- **Planted secret** (one secret in a random assignment, option or pair shape between noise; seed 20261102): an earlier tree hid the secret in 46,311 (round 3), 55,229
  (round 4) and 70,839 (intermediate tree) strings; the round-6 tree leaks it in **47, 19 and 13** of them. Shrunk to 56 distinct minimal shapes.
- **Structured** (the shapes of the four reports composed at random: parent keys, brackets, gaps and delimiters, escape layers, argv, YAML lines, scheme words,
  percent forms; seed 20261103): hidden by an earlier tree (round 3, round 4, intermediate tree) in 23,821 / 40,900 / 39,899 strings; leaked by the round-6 tree in **79, 165 and 48**. Shrunk to 190 distinct minimal shapes.

The remainder, by class (each class has a minimal string pinned in `redaction-security-round5`, "KNOWN LIMITS"; none is waived):
1. a `#` line at column 0 that an indented line follows (`secret:` / `#S` / ` t`): YAML reads the `#` line as a comment and the indented line as the value (70 of the 190 structured shapes);
2. a credential keyword whose value is another credential's name with a blank before the separator (`Bearer:auth =S`, `-uc:token =S`) (18 structured, 13 planted);
3. an empty or label-like quoted value with a word glued to its closing quote (`Authorization=>""S`, `credential:=" apikey:"S`);
4. a chain of dangling labels (`password:= Authorization:a S`, `token:` / `passwd: : \pass: S`);
5. a secret written with a hyphen and a credential word behind a delimiter (`|#S-credential=`);
6. a keyword that ends in `Authorization` with a block header at the end of its line (`BearerAuthorization:x secret:|`);
7. an option named `Authorization` followed by a hyphen and a qualifier (`-Authorization-e=a S`), which must stay as narrow as `--authorization-mode=Node,RBAC`;
8. `//Authorization:x@host` (the host is not a credential), and glued or escaped quote noise (`credential=>"\auth":S`);
9. the value of a name that is not a credential's, behind a line break written as text (`apikey:M%0At=S`: `S` is the value of `t`, which an earlier tree redacted together with the rest).

### Second pass: options after a text-written line break, the quadratic families, and the reviewed round-5 tree as comparator

A check that a sibling redactor's reviewers ran against this lineage (line-start forms after a line break written as text, and quadratic scanners) was run on the
round-6 tree with the same secret and the same shapes.

- **Options after a text-written line break (leak, fixed).** `a=1` and a backslash and an `n`, then `--password S`, `--pw S`, `-p=S` or `-pS` leaked, while a real newline, `%0A`
  and no lead hid them: the two option openers (the option reader and the glued `-p` rule) demanded that no letter or digit stand in front of the dash, and the `n` of a
  text-written break is a letter. Both openers now accept a preceding `\n`, `\r`, `\t`, `%0A`, `%09` or `%0D`. Tests (`redaction-text-newline-options`, 60 tests: seven leads by
  eight option forms, the output, precision): 19 fail by assertion at the tree before the change, all pass after; mutants M319 and M320 are killed by assertion.
  The keys `pw`, `pswd`, `password`, `secret`, `api_key`, `passwd`, `token`, `DB_PASSWORD` were already read after every lead. Not part of this fix, and listed with pins as before:
  `pin`, `sid` and `otp` (ambiguous short names), `ENV PASSWORD S` and `ARG PASSWORD S` (Dockerfile), the bare `name=DB_PASSWORD value=S` pair.
- **False hits.** On 30 ordinary command lines (`docker run --rm -p 8080:80 nginx`, `git commit -m fix --no-verify`, `open -p 8080`, `turn --pw`, ...) in every pair and five text leads
  (4,500 joins) a text-written break gave more hits than a real newline in 60 joins before the change and in the same 60 after it: the change adds no hit (no line alone is
  hit). The suite pins the equivalence for 20 of those lines.
- **Quadratic scanners (none among these seven shapes; the fourth and the fifth pass found others, in a run of backslashes behind a credential and in options repeated with no blank between them).** Time in ms at 32 / 128 / 512 KiB and growth at 4 / 16 times: `token:!` repeated 0.6 / 2.0 / 7.5 (3.5 / 12.8); `Authorization:=!token%20` 0.3 / 2.6 / 4.1
  (8.4 / 13.1; a 0.3 ms base); `value=` 0.4 / 1.8 / 9.2 (4.1 / 20.8); `: #%3D["DB_PASSWORD` 7.8 / 25.5 / 107.2 (3.3 / 13.8); `:= #bearerxapi_key` 2.6 / 12.4 / 31.4 (4.7 / 11.9);
  `#Basic pin=|` 1.8 / 4.1 / 16.4 (2.3 / 9.2); `name: password` followed by 512 KiB of backslashes 0.9 / 5.1 / 12.8 (5.5 / 13.8). Measured shapes only: these seven, growth at 16 times between 9 and 21 (a ratio near 16 is linear); the shapes that were not measured carry no claim.
- **Small differential after the change** (seeds 20261201, 20261202, 20261203; 100,000 strings per style; comparators: the round-3 tree, the round-4 tree, the reviewed round-5 tree
  and the tree just before the change). Noise: fewer markers than the tree just before the change in 0 strings (same 99,969, more 21, other 10); than the round-5 tree in 19; than the
  round-3 and round-4 trees in 509 and 327 (classified as above). Planted: the tree just before the change hid 83,965 strings and the new tree leaks 6 of them; structured: 84,061 and 108.
  Every one of those 114 (38 minimal shapes) is one class that is older than the change: a long single-dash option name glued to noise (`-passD: S`, `\n-pass%3D S`, `-password%3A"S"`), in
  which the `-pSECRET` rule swallows the name that the assignment reader needs; with a blank or a real newline in front the same strings leaked before the change, and a text-written
  break in front used to escape by accident. Listed with a pin (`redaction-security-round5`, "KNOWN LIMITS"), not fixed.

### Third pass: the reviewed round-5 tree as the binding comparator, three changes, and a correction of the record

**Correction.** The differentials of the first pass above, and the changelog entry that summarises them, called their third comparator "the round-5 tree". It was not: it was an
intermediate tree of this round (an earlier state of the work, with no commit to cite). The tree that the round-5 reviewers reviewed is the comparator of every number in this pass (and of the "reviewed round-5 tree" numbers of the second
pass). The label was wrong, was found by the maintainer, and is corrected here; the first-pass numbers stay as measured, against the comparator they name.

The final differentials ran at the last tree (seeds 20270411 planted, 20270422 structured, 20270433 noise; 100,000 strings per style), against the round-3 tree, the round-4 tree, the reviewed
round-5 tree, the tree that the round-6 reviewers reviewed and a later intermediate tree. Every leak and every LESS was
shrunk to a minimal string: 74 planted, 194 structured and 67 noise shapes (266 distinct leak shapes in all).

| comparator | planted: it hid / leaked now | structured: it hid / leaked now | noise: same / more / less / other |
| --- | --- | --- | --- |
| round-3 tree | 46,329 / 43 | 23,878 / 96 | 92,421 / 3,244 / 552 / 3,783 |
| round-4 tree | 55,252 / 25 | 41,116 / 231 | 96,128 / 340 / 424 / 3,108 |
| **reviewed round-5 tree (binding)** | 65,355 / **11** | 36,529 / **94** | 99,294 / 108 / **25** / 573 |
| the tree that the round-6 reviewers reviewed | 83,846 / 35 | 84,075 / 113 | 99,746 / 20 / 44 / 190 |
| a later intermediate tree | 86,759 / **0** | 84,787 / **0** | 100,000 / 0 / **0** / 0 |

The method to judge a noise LESS ("fewer markers") to hide nothing that an earlier tree hid: the shrunk string is printed with both outputs; a LESS counts as marker-only when the text that
the new output shows and the old one hid is made only of the scanners' own vocabulary (a keyword, a separator, a Python prefix and a quote, an option name), never of a value.

What the comparison against the reviewed round-5 tree found, and what was done:

- **Fixed (three changes in `src/redact.ts`, each red-first by assertion, each with mutants killed by assertion).** (1) A quote that never closes after a Python prefix or a shell `$`
  (`password=b'S`, `token: u"S`, `key=$'S`, the secret last in its line or text: a truncated log). The round-6 redactor left it, the reviewed tree hid it: 1,782 of 65,691 planted and
  221 of 36,166 structured strings at the first run. The value now runs to the end of its line; a closing quote on a later line is not a closing quote of the value.
  Tests `redaction-unclosed-prefix` (7 prefixes by 4 separators by 7 keys by 4 tails by nesting depth 0 to 3, exact outputs, controls); mutants M321, M322. (2) A closed prefixed string
  with anything glued behind its closing quote (`token=b'S'"`, `b'S'.decode()`, `b'S'| cat`, `b'S':1`, `b'S'%20`, the closing quote of a JSON string): the first change had kept a list of
  characters that may follow, and the list lost 1,704 planted strings that the reviewed tree hid; the list is gone, a closed string is redacted whatever is glued to it. Mutants M323 and
  the retargeted M256. (3) A multi-line array under `Authorization` (`"Authorization": [` then `"S"` and `]`, `Authorization: [` then `S`, `authorization=[` then `S]`,
  `Proxy-Authorization`, `Authorization=[` then `Basic S]`): the reviewed tree hid it; every other tree, including the the tree that the round-6 reviewers reviewed, left the elements, because the
  `Authorization` branch takes "the rest of the line" before it looks for a bracket. It now takes the line or the whole bracket, whichever is longer (never less than the line);
  `token`, `apikey` and the other keys read the same bracket already. Tests `redaction-authorization-array` (10 layouts by 9 keys by 4 separators by nesting depth 0 to 3, a JSON document
  as text, an object, YAML and environment layouts, braces and parentheses, controls, precision): 13 of 16 fail at the tree before the change; mutants M324, M325 and the
  retargeted M57, M229, M280. Precision: an unclosed bracket under `Authorization` is read exactly like an unclosed bracket under `token` (asserted), and no line without an Authorization key
  changes; the differential shows 0 strings hidden by the previous tree and leaked now and 0 LESS against it (the change only adds hidden text).
- **Listed with a pin, not plausible, open for the owner** (the plain forms are hidden, only garbled ones are not; each class has exact strings in `redaction-security-round5`, "KNOWN LIMITS"):
  a long single-dash option name glued to noise after a real or a text-written line break (`\n-passD: S`, `\n-pass%3D S`, `\n-p%pwd= S`; the plain `-password: S`, `-pass: S`, `-pwd=S`,
  `-password="S"` and `-password S`, with a blank, a real newline or a text-written break in front, are hidden, and `\n-password S` (a leak in the reviewed tree) is hidden now);
  an option `-u1`/`-ux` whose user is a credential's name; a secret with a credential's name and separator glued behind it (`token=Sapikey':`, `-passwd S-auth=`, `apikey:` then `S-password:`);
  chains of dangling labels and brackets that hold a label; an empty or label-like quoted value, or a closed `$'M'` / `b'M'` / `u"a"` behind `Authorization`, with a word glued to the closing
  quote (the same as a plain `password='M'S`, which every tree left); `TOKEN=%0AN=S` and `password:e\nn=S` (the secret is the value of another name).
- **LESS against the tree that the round-6 reviewers reviewed: 22 shapes, all noise, all marker-only**: a keyword, a separator and a dangling prefix with a quote and nothing behind it (`auth=b'`, `Bearer=u"`: the
  tree that the round-6 reviewers reviewed put a marker on the letter `b`; the reviewed tree shows `b'` as it does now), and merged markers (`secret=b'Authorization:$`: more text is under one marker). No shape where the tree that the round-6 reviewers reviewed hid text that this one shows.
- **Cost.** `src/redact.ts` at the end of round 6: 112,616 bytes, 2,032 lines, 81 functions, 30 module patterns, 9 step objects written out (the glued `-p` rule is one of them now; the pipeline has the same steps as before) (the reviewed round-5 tree: 76,289 bytes, 1,465 lines, 56 functions, 26 patterns; the tree that the round-6 reviewers reviewed: 95,245 bytes and 1,725 lines).
  CPU time in ms at 64 KiB / 256 KiB / 1 MiB of one hostile shape repeated (the host load average was above 290, so CPU time, not wall time, is reported): prefix shapes: `b'S' ` closed
  16.4 / 55.7 / 74.7, unclosed 3.5 / 26.4 / 65.4, quotes alternating 4.5 / 21.9 / 63.6, prefix and quote only 10.6 / 26.6 / 67.8, unclosed on many lines 5.3 / 28.8 / 71.2, `$'` unclosed
  7.5 / 31.9 / 71.6, a long gap to the closing quote 1.8 / 10.8 / 54.6 (a 1.8 ms base); Authorization brackets: `Authorization: [ x` 15.6 / 24.6 / 45.0, `Authorization=[` 5.8 / 13.9 / 28.8,
  `[` then newline 4.7 / 10.1 / 46.8, `{` 1.2 / 7.7 / 16.1, `(` 4.3 / 12.3 / 53.2, eight nested brackets 2.7 / 10.8 / 44.4, `Proxy-Authorization:[a,` 2.0 / 5.5 / 24.0, closed pairs 14.0 / 22.0 / 107.3
  (the tree before the change took 16 to 165 ms at 1 MiB for the same strings): linear. The scaling matrix of `round3-redaction-scaling` failed at two shapes on the first full run of a host at that load and passed on its own rerun.

### Fourth pass: a hang on a short receipt string (review round 6, logic P0), and an audit of every regular expression

**Finding (P0, reproduced by the reviewer).** `proofgate evaluate` hung on a short attacker-controlled receipt string. The word-end check of a bracketed value, `text.slice(end, tail).replace(/(?:\\+[nr]?|%0[AaDd])+$/, "")`,
is the `(a+)+$` shape: a quantified group that holds an unbounded quantifier, and a tail that fails. `password=[]x`, N backslashes and a letter, as a receipt's `command` or as the flag form `--password []x` (which reaches
the same function): 9 ms at N=16, 97 ms at 20, 1,377 ms at 24 (about 14 times more for every 4 characters), and still running after 20 s at N=40 (53 characters); the reviewed round-5 tree took 0.6 s.
The redactor runs on every string a receipt stores, so this was a denial of service by receipt content.

**Cause and class.** Three more spellings of the same idea were in the redactor, and an audit found what a reading did not: the `/\\+$/` strips of a word (two places; quadratic: the expression retries at every backslash
of a run that does not end the text), `/(?:\\+[nr]|%0[AaDd])+$/` (same shape as the P0 without the optional letter), the YAML blank check `/(?:[ \t]|\\+t|%09|%20)$/` (quadratic; found only by the hostile-run audit below),
and the two sticky matchers that read a line break or a blank written as text (`\\+n`, `\\+t`), which a value scan calls at every position of a run of backslashes (quadratic: 3.9 s for 32,000 backslashes behind `password=`).

**Fix, without hiding less.** The trailing strips are linear scans from the end of the word (`stripTrailingBackslashes`, `stripTrailingBreakEscapes(word, bare)`, `endsWithBlank`), with no regular expression that has an end anchor.
The two sticky matchers are written by hand for the backslash case (`lineBreakLength`, `valueGapLength`): a run of backslashes is scanned once and its end is remembered, so a value scan that asks at every position of one run costs one
pass (two memo slots, because an escaped `\r\n` holds two runs). A first version bounded the run at 64 backslashes; the existing depth-8 tests (runs of 128 at eight layers of JSON nesting) failed at once, so the bound was dropped for the memo: there
is no limit on a run. Equivalence with the code it replaces, byte-identical output on: 8,949,776 strings (every string of up to five tokens of the escape alphabet, `\`, `n`, `r`, `t`, `%0A`, `%0d`, `%20`, blank, `x`, `:`, `=`, both quotes, `u000a`, `y`,
behind eleven prefixes that reach the changed code); 39,520 strings with runs of 1 to 300 backslashes in front of every escape letter (one run, and two runs around an `r`), behind 13 prefixes and eight tails; and 70 probe shapes
with runs of 1 to 200 backslashes. (The old redactor cannot be run on the bracket prefixes at those run lengths: it does not finish.) The `-u` branch's `/[:=]$/.test(text.slice(at, e))` (the review's suspect) was measured
linear before and after in this engine and is replaced by a two-character check anyway.

**Tests.** `redaction-linear-escapes` (17 hostile shapes at N = 20, 40, 200, 5,000, 100,000 and 400,000, each in a CHILD with an 8 s hard cap, "still running" counts as a failed assertion, and the secret must be hidden where the shape holds one): 15 of the 17
fail at the tree before the fix (the other two, quote marks and `\t` units, were not super-linear there), all pass after. `regex-static-audit` (see below): its expression check fails at that tree with four unlisted hits. Mutants M326 to M333 and the
retargeted M153 are killed by assertion (occurrence check: 0 broken).

**Method of the empirical time audits.** Besides the static audit below, the round-6 fixes were searched for with `scripts/fuzz-redaction-time.mjs` (node only, no package of the repository, run by hand under
`scripts/run-with-cap.mjs`, not a step of the gate): `regex` runs every static expression of `src/` on hostile runs of one character or one short unit (63 units, three tails) and flags an exponential one (a run of 24 over 30 ms) or a super-linear
one (4 times the input over 7 times the time and over 120 ms); `functions <dir> A|B|C` runs `redactString` on 25 to 30 prefixes that reach a reader, 40 to 63 units and four tails, at 22 characters, 8,000 and 32,000 (set C also runs the artifact
scanner). The gate's own evidence for the same classes is `redaction-long-run-family`, `redaction-work-bound`, `redaction-linear-escapes` and `round3-redaction-scaling`; the script finds shapes, the tests keep them found.

**Audit of every regular expression of `src/`** (`node scripts/regex-audit.mjs --all` lists them all, with line, pattern and shape; `tests/unit/regex-static-audit.test.ts` runs it): 134 regular expressions at the tree before the fix, 129 after (literals and `new RegExp`
with a literal or a template source; a small lexer, not a JavaScript parser). Shapes flagged: E (a group quantified without a small bound that holds an unbounded quantifier or an alternation), T (an unbounded run in front of `$` with no start
anchor), D (a dynamic source). Verdicts:

| where (at the time) | pattern | shape | verdict |
| --- | --- | --- | --- |
| `redact.ts` 358 | `(?:\\+[nr]?\|%0[AaDd])+$` | E, exponential | the P0: replaced by `stripTrailingBreakEscapes` |
| `redact.ts` 678 | `(?:\\+[nr]\|%0[AaDd])+$` | E | replaced by `stripTrailingBreakEscapes` |
| `redact.ts` 663, 1455 | `\\+$` | T, quadratic | replaced by `stripTrailingBackslashes` |
| `redact.ts` 579 | `(?:[ \t]\|\\+t\|%09\|%20)$` | not flagged statically, quadratic by hostile run | replaced by `endsWithBlank` |
| `redact.ts` 499, 420 | the sticky line-break and blank matchers (`\\+n`, `\\+r\\+n`, `\\+t`, ...) | not flagged statically, quadratic by hostile run | hand-written for backslashes, run end remembered (exact) |
| `redact.ts` 672 | `[:=](?:\\+[nr]\|%0[AaDd])*$` | E | allow-listed: applied to a slice of at most 24 characters |
| `redact.ts` 56 | `(?:secret\|token)s?\d*$` | T | allow-listed: a match must start at the word, so no run is re-entered; applied to one name |
| `redact.ts` 41, 1214 | `new RegExp(re.source, re.flags)`, `new RegExp(source, "gi")` | D | allow-listed: a private copy of an audited expression; built from bounded quantifiers only |
| `redact.ts` 501 | `\\+t\|%09\|%20` (indent, sticky, at most `MAX_BLANKS` calls per line) | not super-linear by hostile run | left as it was |
| the other 122 expressions (the token patterns, `bundle.ts`, `charclass.ts`, the option, pair and YAML readers, ...) | | no flagged shape | the hostile-run audit below found nothing in them |

The audit is static and heuristic; the same review round therefore had a second, empirical one. **Hostile-run audit.** Every static expression (132 at the tree before the fix, the two dynamic sources excluded) against some 60 units (single characters, `\\n`, `%0A`, quote pairs, `$'`, `b'`, ...) repeated and a failing tail, at
24 characters (exponential) and at 20,000 and 80,000 (super-linear), 24,759 probes: five expressions flagged (the ones replaced above, with the two sticky matchers found below), none after the fix (127 expressions, 23,814 probes). Then `redactString` itself: 59 prefixes that reach a reader (`password=`, `--password `, `-u `,
`Authorization: [`, `x=b'`, YAML property and list forms, ...) times 69 units times 4 tails, at 8,000 / 32,000 and 20,000 / 80,000 characters: 65 flagged at the tree before the fix (the P0 and its class, all on backslash runs), 0 after (16,284 probes).

**Cost after the fix.** CPU time in ms (the host load average was above 290, so not wall time). Before, at 8 KiB / 16 KiB / 32 KiB (for the exponential shapes at N = 10 / 14 / 18, where the blow-up has not started: it starts at 20); after, at 64 KiB / 256 KiB / 1 MiB:
`password=[]x` + backslashes + `y`: 2.6 / 0.4 / 2.9, then 12 / 23 / 27; `--password []x`: 1.6 / 0.2 / 4.0, then 1.8 / 5.3 / 22; `password=[]x` + `\n` text units: 271 / 1,004 / 3,959, then 9.9 / 27 / 64;
`token=[]x` + `%0A`: 103 / 366 / 1,368, then 23 / 30 / 128; `password=` + backslashes: 241 / 946 / 3,828, then 2.8 / 6.1 / 35; `token=` + backslashes + `y":x`: 249 / 1,093 / 4,238, then 1.7 / 5.8 / 24; `password: &a` + backslashes: 41 / 149 / 548,
then 3.0 / 3.9 / 8.6; `--password` + a word of backslashes: 30 / 129 / 447, then 3.5 / 4.6 / 7.9; `-u` + quote marks: 0.4 / 0.5 / 0.9, then 1.8 / 12 / 28 (the growth 4 and 16 times: 6.8 and 15.8 from a 1.8 ms base, 3.5 from 256 KiB to 1 MiB). Linear.
**Regression check at the final tree** (seeds 20270611, 20270622, 20270633; 100,000 strings per style; comparator: the last reviewed tree, the one with the defect): planted, 86,798 strings hidden by it and 0 leaked now; structured, 84,526 and 0;
noise, 100,000 same, 0 fewer markers, 0 more. The fix changes what is redacted on no string that the differential generates (the same comparison against the reviewed round-5 tree gives the numbers and the classes of the third pass: 17 planted and
84 structured leaks, 33 noise strings with fewer markers, every one in a pinned class).

### Fifth pass: the four reviews of the round-6 tree

Four independent reviews of the round-6 tree (logic, security, tests, conformance) found, besides the hang of the fourth pass, a family of super-linear scanners, three regressions against the reviewed round-5 tree and a list of smaller items.
Every item below is fixed with a test that fails at the tree that was reviewed, or is listed with a pinned string; none is waived. (The report of the tests review was still open when this was written; what it had reported by then is included.)

| Finding | Status | Test and mutants |
| --- | --- | --- |
| The exponential `(?:\\+[nr]?\|%0[AaDd])+$` (logic P0, security P0) and the quadratic trailing strips, line-break and blank matchers | FIXED (fourth pass) | `redaction-linear-escapes`, `regex-static-audit`; M326 to M333 |
| `redactFlags`: an option's word is measured again at every option in it (`--password=`, `--token=`, `--secret=`, `-Password=`, `--pw=`, `-p--password=`, `%0A--password=` repeated, chained options `-token=-token=`, `=-auth`; the `=-u`, `={-u`, `=--user`, `-u=` family, quadratic at every tree back to the first round) | FIXED: the end of a blank-free word and the next colon are each measured once per region and remembered (`wordEnd`, `nextChar`) | `redaction-work-bound` (every shape the four reports name, then every opener followed by a run of backslashes or escaped breaks, at 16 Ki, 64 Ki and 256 Ki in a capped child; the artifact scanner at 64 Ki, 256 Ki and 1 Mi); M336, M337 |
| A property in front of a value, repeated (`: &a Basic pinauth`): measured before the name was judged | FIXED: the name is judged first | `redaction-work-bound`; behaviour identical on the differential |
| A per-call work budget that fails closed (the structural answer to the class) | NEW: every scan that walks a run is counted against `64` steps per character of the input plus `65,536`; a call that passes it hides the WHOLE text (the credential scanner reports `work-budget-exceeded`). An ordinary log needs 0.32 steps per character, no shape of the tests trips it | `redaction-work-bound` (a tiny limit hides, never shows; nothing trips); M334, M335 |
| A Python-prefixed value that looks like a label (`password=b'c2VjcmV0cGFzcw=='`, `API_TOKEN=u'...=='`, a secret that ends in `=` or `:`) was left and its prefix redacted (logic P1, security P1; a regression against the reviewed tree: 2,859 of 150,000 realistic secrets) | FIXED: a label-shaped prefixed string is a label only when a word stands glued behind its closing quote; prefixes `f`, `fr`, `rf`, `N'`, `E'`, `X'`, `U&'` added (in front of a plain or escaped quote only) | `redaction-prefixed-values` (17 prefixes by 7 bodies by 6 keys by 4 separators by depth 0 to 3); M256, M341, M342 |
| A value that starts with a bracket ended at a closer or delimiter behind it (`password=(,NI<ON);r#T-=J*`, `{$F}]r|VK*~l)%JcV`, `()}IK5I1Y`; 86 of 400,000 random printable passwords) (security P1, a regression against the reviewed tree) | FIXED: the token runs on unless the next character is a blank or the end, a quote, an escaped quote or break, or a closer that is itself followed by a blank, a closer or a quote (a `;` also when a credential's `NAME=` follows); the colon-less variants (`password=[]\S`, `[a]]S`, `token:[]}S`) are read the same way; an option value that starts with a bracket is at least the whole word | `redaction-bracket-values` (19 values by 8 contexts by depth 0 to 2, a generated-password run, controls); M343, M344, M349 |
| The usage counters were two lists, and the text one had grown (`TOKEN_USER`, `TOKEN_SECOND`, `token_day`, `TOKEN_MONTH`, `TOKEN_CALLS`, `TOKEN_REQUESTS`, `TOKEN_MINUTE`, `TOKEN_REQUEST`, the singular `INPUT_TOKEN`, `MAX_TOKEN`: 132 names visible in text and hidden as keys) (logic P2, security P1, P2) | FIXED: one definition (`COUNTER_SOURCE`), narrow, whole names only, plural LLM token counts and counting words; a word that can qualify a credential is not a counter. A counter with a word in front of it (`openai_total_tokens`) is hidden in both forms now (the key rule used to exempt it) | `redaction-usage-counters` (ambiguous names hidden in both forms, counters exempt in both, a grid that fails if the two rules diverge); M338 to M340 |
| `%09-password%20'S'`: a percent-escape lead let the glued `-pSECRET` rule take the option's name (logic P2) | FIXED: a glued `-p` whose text is a credential option's name followed by a percent escape or a colon is left to the option reader (this also fixes `-passD: S`, `-password%3A"S"`, `-pApiKey: S`, `-pAuthorization: S` after any lead, which were listed limits) | `redaction-review6-options`; M320, M345 |
| Options after `\u000a`, `\x0a`, `%0B`, `%0C`, `\f`, `\v`, `\u0009`, `\x09` stayed in the clear (security P3) | FIXED: the option reader and the glued rule know the breaks that the line reader knows | `redaction-review6-options`; M319, M346 |
| A YAML list item that ends in `:` took the next item's dash (security P2) | FIXED | `redaction-review6-options`; M347 |
| `--Authorization=[` and its elements on the next line (conformance P3) | FIXED: the option form reads the bracket like the assignment form | `redaction-review6-options`; M348 |
| The RunProof importer refused 13 verdict names; `conclusion`, `exit_signal`, `error`, `errors`, `success_count` imported beside a success (logic P3) | FIXED by extending the list (documented as a list of names, not a proof) | `runproof-strictness`; M350 |
| A redundant alternative in the kill rule's timeout test (logic P3) | PINNED: a bare `Hook timed out` is a timeout | `round4-kill-rule`; M351 |
| The scaling matrix and a timing assertion measured wall time; a host load average above 290 failed them | FIXED: CPU time of the process | `round3-redaction-scaling`, `redaction-depth-generative` |
| The five frozen fixtures came from the round-3 and round-4 trees, none from the reviewed round-5 tree (conformance P3) | FIXED: a sixth, of 900 inputs that the reviewed tree hid | `redaction-no-regression-reviewed` |
| The matrix named 15 test ids without their describe block; the AC index reconciliation failed (conformance P1) | FIXED: ids as `describe > title`; every id is checked against the repository's indexer before a commit | `tests/proofgate.spec.ts :: AC index` |
| A secret that ends in a credential's name and a colon (`-pSapikey:`), a bracket that holds or precedes a label, `password:e\nn=S`, a label chain that ends in a list item, `apikey:|#`, a password with a literal `\n` before a `name=`, a blank in a JSON array element, a value that starts with `>` or `:` right after `=` | LISTED with pins (garbled shapes, and ones that the reviewed tree also left); open decisions for the owner | `redaction-security-round5`, "KNOWN LIMITS"; `docs/INTERFACES.md`, `SECURITY.md` |
| A bracket with elements on later lines that never closes; `Authorization: [a,\n b,\n c]tail S`; the round-5 leftovers (a blank in a JSON array element, user information with a raw `@`) | LISTED (same lists) | same |

**Differentials at the final tree** (seeds 20270811 planted, 20270822 structured, 20270833 noise; 100,000 strings per style; minimised and classified as in the third pass). Against the reviewed round-5 tree (binding): planted 65,456 strings hidden by it, 15 leaked now; structured 36,347 and 92; noise
36 strings with fewer markers; every shape is in a pinned class, none a plain form (the plain forms of each class are hidden). Against the tree that the round-6 reviewers reviewed: planted 86,889 / 1, structured 84,842 / 5, noise 5 fewer: seven
shapes in all, all garbled (a dangling-label chain after a bracket, a label chain and a list item, `-pSapikey:`, and three truncated percent escapes after an option name: `-passwd%`). The realistic-secrets differential of the review itself (a fixed seed, 150,000 strings) found the prefixed class and no other plain form.
Random printable passwords in `password=`, `password:`, YAML next line and list, `--password` and `--token=` (100,000 passwords without a backslash or a percent sign, in every context, tail included): the reviewed tree left 3,706 strings, this tree 2,145; what is left are passwords
that hold `;name=` or `,name=` (a connection string is split there by design) and a value that starts with `>` or `:` after `=`.

**Cost of the shapes the reviewers named** (CPU time in ms, not wall time; the host load average was above 290). The tree that the round-6 reviewers reviewed at 16 Ki / 64 Ki characters (it is quadratic: 256 Ki took seconds), then this tree at 16 Ki / 64 Ki / 256 Ki / 1 Mi:
`--password=` repeated 59 / 477, then 12 / 10 / 30 / 104; `--token=` 44 / 627, then 1.7 / 6.6 / 23 / 113; `-Password=` 60 / 497, then 2.3 / 5.6 / 20 / 79; `-p--password=` 28 / 362, then 1.3 / 4.9 / 23 / 84;
`\n--password%3D` 58 / 388, then 7.8 / 18 / 86 / 208; `%0A--password=` 56 / 484, then 2.3 / 9.2 / 39 / 158; `-token=-token=` chained 64 / 692, then 1.5 / 5.7 / 35 / 101; `=-auth` 62 / 965, then 3.0 / 9.8 / 46 / 106;
`=-u` 163 / 1,946, then 10 / 30 / 41 / 141; `={-u` 110 / 1,427, then 1.5 / 6.4 / 25 / 105; `=--user` 75 / 750, then 4.0 / 5.9 / 54 / 100; `-u=` 120 / 1,885, then 2.1 / 8.9 / 37 / 132;
`password=` and backslashes 976 / 14,458, then 4.6 / 14 / 15 / 58; `--password a`, backslashes, `x` 126 / 1,821, then 0.2 / 0.4 / 3.1 / 7.3; `password=a`, backslashes, `b":` 1,036 / 16,293, then 0.4 / 1.2 / 5.1 / 21;
`: &a Basic pinauth` repeated 30 / 238, then 1.4 / 7.8 / 32 / 63. Linear (growth from 16 Ki to 256 Ki of 16 times or less, from a base of one to a few milliseconds). `redaction-work-bound` runs these and 184 more (23 openers, four kinds of run, with and without a terminator) in a capped child.

### Sixth pass: the final review items (nested hash line, packed export, termination family, classifier, limits)

- **A `#` line under a credential key (security, leak, fixed).** `db:\n  password:\n    #S\n  host: x` left `S` readable: a `#` line was read as a comment whenever any line followed it, and the line after it was taken for the
  value. The rule now judges the `#` line against the KEY's indentation: a `#` line indented deeper than the key is the value (it is hidden, with the lines below it that are deeper than the key too); a `#` line at the key's column or to
  its left is a comment and stays readable. A list dash and a quote in front of the key count as part of its indentation; a line break written as text (`\n`, `%0A`) ends the key's line. One consequence, stated: a real comment that is
  indented deeper than its credential key is hidden together with the value (`password:\n  # rotate\n  S`), which is the safe direction; the round-5 pin that kept such a comment readable was changed, and the old pin of the nested shape
  (a KNOWN LIMIT) was deleted. Tests `redaction-nested-hash` (81: 6 key names by depth 0 to 3 by 3 indentations, the exact output, list dash, quoted key, text-written breaks, the lines below, the controls, the cost): 57 fail by assertion at
  the tree before the change and all pass after; mutants M367 to M373.
- **The artifact scan takes a work limit like the redactor does** (`findCredentialPatternsWithWorkLimit`): a forced limit answers `work-budget-exceeded`, never an empty list (`redaction-work-bound`; M366 makes it fail open).
- **The packed `bundle export` (security addendum).** The packed binary (an `npm pack` tarball installed outside the repository) runs `evaluate` and then `bundle export` over a receipt whose artifact hash is in the receipt, in a child with a
  60 second cap, for the shape of the review (`<testsuite>--password `, 262,144 backslashes, `x</testsuite>`) at 256 KiB, 1 MiB and 4,000,000 bytes, and an ordinary artifact of the same sizes (`tests/e2e/packaged-hostile-artifact.test.ts`; the built
  CLI runs the same in `bundle-export-hostile-artifact`, with seven more shapes, at 256 KiB; fixtures are generated at run time). Outcome, asserted: exit 2, `proofgate: error [bundle_secret_detected]: artifacts contain credential-shaped text
  (artifacts/big.txt: command-line-secret); redact them or pass --allow-secret-artifacts`, no bundle file, none of the text echoed; the control exits 0 and writes the bundle. The refusal names the pattern that was found, not
  `work-budget-exceeded`: the scans are linear, so the budget is never reached (the fail-closed answer of the budget is proved by the forced-limit test and M366). One shape that holds no credential (`=-u` repeated) is exported and ends. Measured at this tree
  (a whole test, `evaluate` plus `bundle export`, on a loaded host): hostile 1.39 s at 256 KiB, 1.26 s at 1 MiB, 1.23 s at 4,000,000 bytes; control 1.34 s, 1.47 s, 1.57 s; the built CLI export alone 0.3 s to 0.7 s for the hostile shapes.
  At the tree that the round-6 reviewers reviewed (the one with the hang) the packed run took 33 s at 256 KiB (now asserted under 20 s) and was killed at the 60 s cap at 1 MiB (red by assertion); the built CLI killed 3 of 8 shapes at its cap. Mutants E08 and E09 put the exponential and the quadratic expression back at the one place that the artifact scan of this shape reaches (the word of a bracket group: measured, the scan of the review's shape is slowed by M364 and M365 only, not by the
  plants at the option word or the key tail, which `redactString` reaches); a first version of E08 and E09 at the option word survived for that reason and was moved. E10 (a credential-shaped artifact is no longer flagged) is killed too: all three through the packed suite, by assertion.
- **The termination family (tests reviewer, addendum).** `redaction-long-run-family`: 26 openers (key forms, option forms, bracket, brace and parenthesis openers, prefixes) by 9 escape units (a backslash, `\n`, `\r`, `\t`, `\u000A`, `%0A`, `%0D`, `%09`, `%20`)
  by 5 tails (a letter, a quote, `=`, `:`, a real line break) by N = 26, 40, 200 and 5,000 units, one child per opener with a 90 s cap and a 1 s CPU limit per call (4,680 calls); 27 growth shapes of the later rules (the Python-prefix loop, `Authorization: [ x`, `--password=`,
  `-u=`, a text-written break in front of an option, the key tail) at 16 Ki, 64 Ki and 256 Ki characters; and 14 shapes at 4 MB with the growth from 250 KB to 4 MB compared. Red at the tree that the round-6 reviewers reviewed: the exponential opener (`password=[]x`: the child never finished), 4 of the 25 growth
  shapes that existed then, 10 of the 14 large shapes. Only the exponential shape is red in the family itself (N <= 5,000 is too small for a quadratic one; the growth and large lists carry those). Plants M359 to M365 (the exponential and the quadratic trailing-strip expression put back
  at each of the four places that strip a run) are killed by assertion, and `regex-static-audit` flags every plant and nothing more on the clean text (both directions).
- **The kill rule reads failed `rejects` / `resolves` assertions** (found by the sibling product's replay): vitest 5.0.2 reports `await expect(p).rejects.toMatchObject(...)` as `Error: expected ... to match object ...` with no AssertionError header; its own first stack
  frame (`_Assertion.__VITEST_REJECTS__`, in vitest's package) says it is one. A thrown message that only names the frame, a frame that is not first, and a message that does not start with `Error: ` are errors. The fixture holds 60 captured failures (39 vitest, 21
  Playwright): the rule before the repair read 15 of them wrongly, the repaired rule 0. Mutants M374 to M376.
- **Listed, pinned, named** (`redaction-known-limits-final`, each pin expected to be retired when its shape is fixed): `Authorization: [a,\n b,\n c]tail S`, a line break written inside a password (`password=a\nb=cS`, `\r`, `%0d`, `%0A`), `--token=>;x=yS`, `;name=` inside a
  password, a blank inside an element of a JSON array, a raw `@` in user information. The scheme words Splunk and Hawk and the block indicators `|1`, `>1`, `|2-`, `|+1` are pinned as must-hide. The PowerShell clause was removed from the lists of shapes that stay unredacted.
  **Open for the owner, as documented redaction limits (a disclosure, not a waiver):** random printable passwords in `password=`, `password:`, YAML and `--password` forms (100,000 without a backslash or percent sign, from the tests review's check): the reviewed round-5 tree left 3,706,
  the tree the round-6 reviewers reviewed 2,199, this tree 2,145; what is left are passwords that hold `;name=` or `,name=` (a connection string is split there by design) and a value that starts with `>` or `:` right after `=`. These figures are the review's; they were not re-run here.
- **Differential after these changes** (seeds 20271101 planted, 20271102 structured, 20271103 noise; 100,000 strings per style; comparators: the round-3, round-4 and reviewed round-5 trees, the tree of the earlier interim, the tree the round-6 reviewers
  reviewed and the interim tree that followed it). Planted: the reviewed round-5 tree hid 65,393 strings and this tree leaks 16 of them; the tree the round-6 reviewers reviewed hid 86,794 and this tree leaks 1. Structured: 36,401 and 84; 84,877 and 5.
  Noise: fewer markers than the reviewed round-5 tree in 36 strings, than the tree the round-6 reviewers reviewed in 7 (two minimal shapes, `-passwd%` and `-password%`, a truncated percent escape behind an option name, nothing follows it; pinned). Five
  shapes leak now that the tree the round-6 reviewers reviewed hid (garbled label chains such as `-token /apikey%3D'S`); the reviewed round-5 tree leaks all five as well, none is new in this pass, and each is pinned in `redaction-known-limits-final`.
  The shapes that leak now and that the reviewed round-5 tree hid (79 minimal shapes) are in the classes of the third pass (label chains, a bracket that holds a label, `-p` with percent-escape soup, a scheme value with a closed string behind it).
- **Linear time per opener** (CPU ms at 16 Ki / 64 Ki / 256 Ki characters, the worst of a backslash run, a written `\n` run and a `%0A` run per opener, then `y`; 26 openers): growth from 16 Ki to 64 Ki at most 4.1 times (linear: 4), from 16 Ki to 256 Ki at most
  11.0 times (linear: 16; the floor is 2 ms); for example `password=` 3.3 / 5.6 / 21.1, `%0A` 0.7 / 2.8 / 21.9, `value=` 0.8 / 3.4 / 19.8, `--password=` 0.3 / 1.2 / 5.5. The artifact scan at 64 Ki / 256 Ki / 1 Mi: the review's shape 3.2 / 12.4 / 22.0 ms, `=-u` repeated
  32.6 / 59.9 / 167.8, `password=` and backslashes 1.4 / 6.6 / 22.8, `--password=` repeated 8.6 / 38.0 / 100.1, `%0A--password=` repeated 43.2 / 88.3 / 326.4, an ordinary log 3.0 / 7.7 / 21.7 (growth from 64 Ki to 1 Mi at most 11.6 times; linear: 16). Only the shapes that were
  measured carry this claim.
- **The time fuzzers** are in `scripts/fuzz-redaction-time.mjs` (see the method paragraph above); the AC-09 row of the matrix now names the round-6 findings.

### Size and time of the redactor

`src/redact.ts` grew from 76,289 bytes and 1,465 lines (56 functions, 26 module patterns) to 112,616 bytes and 2,032 lines (81 functions, 30 patterns); the pipeline has the same steps as before. Time for 64 KiB, 256 KiB (4 times) and 1 MiB (16 times) of one hostile shape repeated, measured on the maintainer's host for 36 shapes (every new rule, the three shapes of the text-written line break change and the
older shapes): the growth at 4 times the input was between 2.3 and 5.3 times, at 16 times between 10.0 and 21.1 times, the slowest shape took 560 ms at 1 MiB (an argv
list with `-u`). The scaling matrix of `round3-redaction-scaling` (1, 2 and 3.5 MiB) carries the claim in the suite; it compares timings, so it can fail under load at a
different shape on each run (it did, on a host that also ran other work) and passes on a quiet one. The 36 shapes are the ones that were measured; the claim is about those shapes and about the ones the tests run, and the work budget is what bounds the rest.

## What this ledger does not claim

The remediation (both round-1 waves, and the re-review wave whose RED commands run against the round-2 review tree) was written by its maintainers, not by the reviewers. None of it is an independent receipt. An independent reviewer must re-verify it:
run each RED command against the reviewed tree, confirm the mutation controls, and read the diff. Nothing here waives a criterion:
AC-11 (a fresh operator using the runbook) still needs a human receipt and stays `PENDING_HUMAN_RECEIPT`.
