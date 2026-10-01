# Changelog

All notable changes to ProofGate are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
Serialized documents carry `schema_version` (currently `1`); a change to any schema bumps that major version and is
called out here, except the pre-release exception described in `docs/SCHEMAS.md` (`schema_version` stays 1 until first publication).

## [Unreleased]

No version has been released to a registry yet. The repository is public under the MIT license (see the License decision
note in the README). Version `0.1.0` below is the first MVP candidate; registry publication, package-name clearance, a named
maintainer, a security contact and a supported-version policy are not yet designated.

### Fixes, set 1

Independent review of the MVP integration line found defects that are fixed here; each has a regression test that is red on the reviewed
commit, a mutation control, and an entry in `docs/qa/review-round1-ledger.md`.

- **Decision engine (P0/P1):** a failing receipt with zero tests could hide behind a passing one and produce exit 0; a
  failing receipt dated after the evaluation clock was ignored; the RunProof importer ignored `execution_status` and
  `exit_code`. The policy engine version is now 2 (`policy_hash` changes for every manifest).
- **Duplicate JSON keys** in receipts, revision sets, reports and bundle headers are refused (`json_duplicate_key`).
- **Hostile YAML** can no longer exhaust memory: 4 MiB and 150,000-node limits, no aliases (`limit_manifest_size`).
- **Terminal output** neutralises control characters, bidi overrides and newlines.
- **Redaction** covers object keys, file names and many more credential shapes, with bounded cost; it is documented as best effort.
- Also: `--replace` only archives a report directory and never collides; the report records `clock_source`; reports must
  be self-consistent and carry `report.sha256`; oversize reports are refused before writing; free-space checks; interrupted
  runs clean up temporary output; receipt ids are case-insensitive; the event envelope de-duplicates per source; published
  JSON Schemas carry the timestamp pattern. Breaking changes: the report gains `clock_source`; `manifest_invalid_commit_sha`
  (never raised) is removed; `limit_manifest_size`, `json_duplicate_key` and `runproof_execution_incomplete` are added.
- Second wave (independent QA, edge-case, conformance and tests reviews): more credential shapes are redacted
  (Twilio, Azure account keys, `Authorization` values of any scheme, word-glued keys); an option given twice, an empty path or
  an empty `PROOFGATE_NOW` is refused; `--output` may not be, contain or lie inside an input (`output_overlaps_input`); a
  closed stdout or an uncaught exception can no longer exit 1; output errors map to `output_unwritable`; receipt-looking files
  with a wrong-case suffix are named on stderr; requirement details in the report are native disclosures. Breaking:
  `PROOFGATE_NOW` set but empty is now `clock_invalid`, and the acceptance matrix records AC-03 and AC-06 as PARTIAL.
- Packaging and documentation: the Dockerfile pins the Node 22.12 base image by digest; the `engines` note explains the
  `EBADENGINE` warning that the test toolchain prints on Node 25; the two PRD deviations (content types, capacity) are
  documented in `docs/SCHEMAS.md`; `docs/BENCHMARK.md` now records container measurements (2 CPU, 4 GB) with fan-out shapes.

### Fixes, set 2

A further independent review found more defects, two of them regressions the fixes introduced. Every P0/P1
has a regression test that is red on the reviewed tree and green here, and a mutation control; see the ledger.

- **Redaction rewritten as a fixed sequence of linear-time steps** (`src/redact.ts`). The JWT pattern was quadratic (`eyJ_` repeated to 256 KB took 19.6
  s); text with non-ASCII characters exhausted a 256 MB heap during Unicode folding (8 million U+FDFA, a 24 MB receipt); a
  secret value longer than 300 characters was redacted only in part. Now every pattern is bounded or consumes whole runs, values
  are consumed whole and quoted values end at their closing quote, folding works in chunks and text that would fold to more
  than 32 Mi characters is redacted whole, and a scaling matrix and a randomized property test check all of it. New shapes
  (Twilio account SIDs, DigitalOcean, Shopify and Mailgun keys, `pwd=`, `DB_PASS=`, `private_key=`, Docker `auth`, short
  `Bearer` tokens), folded key names, and UTF-16 and folded-UTF-8 views in the bundle artifact scanner.
- **`evaluate --json`** escaped its output one character at a time and exhausted memory on a large report; it now rewrites with
  `String.replace` in chunks. The report page's text escaping is the same rewrite.
- **RunProof importer:** a recorded `exit_code` (or `exitCode`) that is not an integer or null (`"1"`, `true`, `{}`, `[]`) is
  `runproof_schema_invalid` instead of being read as "no exit code" and importing as a pass.
- **JSON of millions of tiny containers** is refused before parsing with the new code `limit_json_containers` (500,000 objects
  and arrays). **Values JSON cannot express** (`.inf`, `1e400`, YAML `!!set`, `!!omap`, `!!binary`, `!!timestamp`) are refused with
  `manifest_schema_invalid` / `receipt_schema_invalid` instead of `internal_error` or a silently collapsed hash.
- **Look-alike receipt files** (`x.Receipt.JSON`, `x.receipt.json.bak`, `x.receipt.jsonl`, an unreferenced `x.json`) are refused
  with the new code `receipt_lookalike_file` instead of being ignored (replaced by `receipt_unreferenced_file`). **Breaking:** a receipts directory that holds any other
  unreferenced JSON-family file no longer evaluates until the file is renamed or moved.
- `EMFILE` and `ENFILE` are `output_unwritable` like the other output errors (restore and `evaluate` were already mapped).
- Documentation: the zero-test wording (a zero-test `pass` is MISSING, `fail` is FAIL, `partial`/`skipped` is PARTIAL), the
  pre-release exception for the report's new required `clock_source` (`schema_version` stays 1 until first publication; earlier
  pre-release reports and bundles must be regenerated), AC-06 PARTIAL with its upstream blocker, the drill sheet (a drill on any
  other commit does not count, network needed for step 4), release notes (`private: true`), the stale mutant count, the borrowed
  benchmark figure, and the RunProof pin.

### Fixes, set 3

A further independent review found a P1 in the executable, gaps in the redactor and the tests, and
smaller defects; each fix has a regression test that is red on the reviewed tree where that could be shown (see
`docs/qa/review-round1-ledger.md` for which rows are executed-red, authored-only or not available).

- **The executable always runs.** `node dist/cli evaluate ...` (no `.js`) exited 0 having done nothing, so a failing receipt gave
  exit 0. `src/cli.ts` now runs `main` unconditionally; `main` lives in `src/run.ts`.
- **Receipts tree is strict** (breaking): any file that is not a `*.receipt.json` receipt, an artifact that a receipt names or one of
  `README`, `README.md`, `README.txt`, `.gitkeep`, `.DS_Store` is refused (`receipt_unreferenced_file`, replacing
  `receipt_lookalike_file`).
- **Bundles** written by another package version verify (the package version is not compared); a change of the policy engine
  version is reported as such.
- **Redaction**: tokens with a distinctive prefix are found behind a letter, digit, underscore or an escaped line break; escaped
  quotes no longer shield a value; redaction is applied to a fixed point; strings and keys over 4 MiB are replaced whole; key names
  split at every non-alphanumeric character; blanks, next-line values and long names no longer hide a value; more credential forms;
  a Kubernetes-style name/value pair is redacted by its name. Receipt files whose names look like credentials become
  `redacted-<16 hex>.receipt.json`. Identifier fields (ids, repository, environment) that redaction would rewrite are refused
  (`receipt_schema_invalid`, `manifest_schema_invalid`) instead of being compared in redacted form. Documentation now lists what is
  covered, the boundary exceptions and what is not redacted (personal data other than e-mail addresses).
- **JSON**: a second budget on values (`limit_json_values`, 1,500,000) beside the container budget.
- **Small fixes**: a missing or non-directory parent (ENOENT, ENOTDIR), including an unusable `TMPDIR`, is `output_unwritable`, and a
  clean-up failure no longer replaces the real error; a RunProof run field named `__proto__` is refused
  (`runproof_schema_invalid`); `--replace` without `--output` is a usage error; a bare CR counts as a YAML line break.
- **Tests and controls**: both mutation harnesses share one kill rule (`scripts/kill-rule.mjs`, a kill needs a failing test); 147
  mutants; the scaling matrix runs at 1, 2 and 3.5 MiB; per-file coverage floors for `run`, `schemas`, `explain`, `escape`, `errors`,
  `reasons`, `identifiers`, the adapters and `web/*`; repeated-flag tests for `bundle export`, `verify` and `restore`; JSON budget
  tests with a `JSON.parse` spy and heap-capped hostile documents; documentation pins.

### Fixes, set 4

A further independent review found three redaction holes of one family in new shapes, an object-level
regression, a silent-green entry and a weak kill rule. The redaction rules were generalised instead of patched again, and each is
proven by a test over every nesting depth (0 to 8), every template and every secret shape, not by the shape that was reported.

- **Redaction is total over nesting depth.** A quoted value is delimited by arithmetic on the run of backslashes in front of its
  quotes (no cap, linear): JSON nested four or more layers deep no longer fails open, and a credential that itself contains a
  quote is redacted whole at every depth. Escapes that stand for a separator (`\n`, `\t`, `%0A`, `%20`, `%09`) end the text before
  a name and a YAML next-line value is found after them, at any depth. `=>`, flags with blanks around `=`, the credential words
  of the documented key list inside text, every default-ignorable and format code point as a hiding character, Slack `xox[a-z]-`.
  A value that cannot be delimited is redacted to the end of its line, never less.
- **Redaction is a fixed point for objects too** (a regression against an earlier tree): keys are judged as written and as redacted, so
  `pass<token>` no longer makes an exported bundle that cannot be verified or restored. **`bundle export` now verifies the bundle
  before publishing it** and never leaves a file that verify would refuse. Pair objects (`{name, value}`, `{Name, Value}`,
  `{key, value}`, `{header, value}`) and lists (`["--password", "S"]`) are redacted by their names, concatenated key names
  (`secretkey`, `dbpass`, `userpwd`, `encryptionKey`, ...) are recognised.
- **The library modules no longer exit 0 silently**: `node .`, `node dist`, `node dist/index.js` and `node dist/run.js` print a
  message and exit 2.
- **Budgets**: the JSON container and value budgets also cover all receipt documents together (1,000,000 objects and arrays,
  3,000,000 values); the YAML duplicate-key check is linear (40,000 keys took 10 s).
- **Artifact scan**: random or compressed binary is no longer taken for a password flag (the weak shapes are asked of text only).
- **RunProof**: a required check definition that an earlier evaluation held and the latest lacks, an exit status under another
  spelling, and a `__proto__` key on a check are refused. **Bundles**: the header's revision set is checked against the report.
  The error line redacts only its message. Identifiers nested too deeply are a schema error.
- **Kill rule of both mutation harnesses**: read from the runners' JSON results; a kill needs a test that fails by assertion,
  and timeouts, runtime errors, crashes, fake summaries and hangs (wall-clock cap) are SUSPECT.
- **229 mutation controls** in this set (82 new, 10 retargeted), each killed by a failing test in targeted runs at
  an earlier tree; the full mutation run has not been run on this tree (see the ledger).
- **Second security review of the same round** (pairs, lists and encodings; tested at every nesting depth, as objects and as text):
  a name/value pair is redacted in either order and with other keys between the two (`{"Name", "Type", "Value"}`, `{"value", "name"}`,
  `valueFrom` beside `value`), also with single quotes (a Python repr), path-shaped names and session cookie names; a list element
  after a credential name is redacted even when the element before it is a flag; a YAML block list and a bracketed list under a
  credential key are redacted item by item; separators written as percent escapes (`%3D`, `%3A`, `%22`, `%40`, `%20`, `%2F`, up to
  three levels deep) are read, in text and in the artifact scan; a key is also tested as a whole with its separators removed
  (`database_url`, `redis_url`, `webhook_url`, `slack_webhook`, `stripeKey`, `mongodb_uri`). Idempotence on short mixed shapes, the
  newest invisible code point blocks and an own `__proto__` key were tested and already held.
- **Documented, not redacted**: `:=`, `->`, XML forms, `tool -p x` (space), percent escapes more than three levels deep, name/value
  pairs written as YAML or TOML lines.

### Fixes, set 5

Four independent reviews (conformance, security, logic, tests) found a redactor that never returned, leaks in the
readers for options, user information and pairs, two problems in the evidence, and process wording in shipped documents.

- **The redactor that never returned.** An earlier tree looped for ever on any text holding a name key whose value contains "value"
  (`{"key":"value"}`, `{"name":"default_value"}`, and a `command` of `curl -d '{"key": "value"}' ...`): `proofgate evaluate` spun at full CPU and
  ignored SIGTERM. Cause: one module-level global pattern was used by a scan that, to judge a label, ran the same scan again, which reset the
  position of the outer loop. Every scan now works on its own copy of its patterns, a static test refuses any other shared global or sticky
  pattern, and the termination tests run every such string, a 100,000-string property run and `proofgate evaluate` on the curl receipt in a CHILD
  process with a hard time limit (a hang is a failed assertion, not a hung suite). Why 1,921 tests and 229 mutants missed it: every pair test
  used a label that names a credential, and no test fed the redactor ordinary text that contains the words key, name or value.
- **One quoted-value reader.** Options (`--password \"S\"` at any nesting depth, `--client-secret S`, `--api_key :'S`), `-u user:S`, user information
  (a password with `@` or `/`, the scheme-less form), name/value pairs (any order, values longer than 1 KiB, object and array values,
  labels with spaces, brackets or `$`), and lists share the layer arithmetic of assignments; a depth-by-family-by-quoting matrix (nesting depth 0 to 8)
  checks them. Also read now: multi-line flow lists, blank and comment lines after a key and between block-list items, Python `b'S'`, `%5C`, `%5F`,
  `%2D`, `%2E` in percent-encoded text; the artifact scan no longer takes random binary data for a password.
- **Fail closed at anchors and tags.** A value that starts with `!` or `&` is redacted to the end of its line (a password may start with either).
- **Frozen no-regression fixtures.** Two lists of 600 generated inputs (seeds 5150 and 777) that the previous redactor hid must still be hidden.
- **Bundle and adapters.** `bundle export` verifies next to the output file, so a read-only or small `TMPDIR` no longer fails it; entry roles are
  checked against their paths and the format line must be canonical; a RunProof run with a plain `status` field is refused; manifest keys
  `1` and `'1'` are duplicates.

Earlier in the round, the conformance review:

- **The mutation instrument.** After the redactor changed, four mutants no longer matched their source, so the harness could not run
  them while the documents said all were killed. They are retargeted (with three more that this round's redactor change orphaned), both
  harnesses have a `--check` mode and run it first, the quality gate runs it as its own step with a negative control, and the main
  suite asserts that every target of both lists occurs exactly once and that every mutant has a row in the controls table. 274 mutation
  controls; killed in targeted runs (M148 to M229 at an earlier tree, which has the hang described below, so that is evidence of what the tests
  assert, not of a sound tree; M230 to M274 and the retargeted ones at a later redactor); **the full mutation run has not been run
  on this tree**, so no document says "all mutants killed".
- **Redaction.** YAML block scalars (`password: |`, `>-`, `|+`, `|2`) are redacted to the end of their indented block, `?=`, `+=` and `:=`
  are assignments (`:=` used to leave a marker next to a visible secret), `-p=S` and long options with a prefix (`--db-password S`) are read.
  Tested at nesting depth 0 to 8.
- **Documents.** The unresolvable test id in the acceptance matrix is fixed (the core suite is 125 of 125 again), process narrative and
  branch names are gone from the shipped files (a pin keeps them out), the ledger maps all 44 findings of that review, the
  matrix says its PASS rows are provisional, and the list of shapes that are not redacted is complete, pinned by tests, and an open
  decision for the owner.
- **Documented, not redacted:** `->`, XML forms, a Dockerfile `ENV NAME value` line, a scheme-less `//user:x@host`, a typed assignment,
  JSON-escaped and look-alike key names, `tool -p x`, name/value pairs with the key spellings
  `{k, v}`, `{label, text}`, `{field, val}`, `{name, data}` or written as YAML or TOML lines, single short names (`pw`, `pswd`, `otp`, `pin`,
  `priv`, `tls_key`, `bearerx`), percent escapes nested more than three levels, more than 64 blanks between a key and its value, a tab written
  as text around an equals sign, a double-quoted value folded over several lines, a pair whose label is longer than 1,100 characters or
  spans lines or whose value key is more than about 4 KiB away, and a password with a slash when no `@` follows within 512 characters.
  Whether any of these should be covered is an open decision for the owner (`docs/INTERFACES.md` has the complete list).

### Fixes, set 6

Four independent reviews (conformance, security, logic, tests) found 66 items. Three of them were redactions that hid LESS than
an earlier tree had (an `Authorization` option followed by a bracket, a brace, a Python prefix, `$'` or a tag; a name that only starts like a usage counter,
`TOKEN_PERSONAL`; a value that starts with a bracket, `[S]tail`), and the rest were leaks that no tree covered, weak spots of the tests and the tooling, and
statements in the documents that did not hold. Each item is fixed with a test or listed with its reason and a pin (`docs/qa/review-round1-ledger.md`).

- **Options and containers.** An option named `Authorization` (also `--Proxy-Authorization`, `-userAuthorization`) takes the rest of the line; an option value that
  starts with a bracket, a brace, a parenthesis, an anchor or a tag is read as a whole; a Python prefix or a shell `$` in front of an option's quote is part of its value;
  `{...}` and `(...)` under a credential key are read whole in text; a value that starts with a bracket is a list when the bracket closes and stands alone, otherwise the
  bracket and the word behind it (`[S]tail`, `[]S`, `[a],tail`).
- **Names and keys.** A name that only starts like a usage counter (`TOKEN_MAX_SECRET`, `token_used_password`) is a credential name; the short names that the key rule
  knows (`pw`, `pswd`, `tls_key`, `privkey`, `id_rsa`, `storepass`, `mnemonic`, `client-key-data`) are found in text too; a credential-named parent key
  (`credentials:`, `auth:`) leaves its credential-named child to the child's own reader (on the next line, as a block, as a list); object-level redaction judges a pair's
  name as written and as redacted, so a second pass changes nothing.
- **Where a value ends.** `|`, `)`, `}`, `]`, `<`, `&`, `#`, a `<br>` tag, and a blank or delimiter written as text or as an escape (`\t`, `%20`, `%7C`, `%3E`, `%23`, `%3F`, `%2B`,
  `%21`) end an unquoted value in front of a credential-named pair; the percent-decoded copy knows those escapes; a blank written as text in front of a quote is skipped
  (`db_password:%20"S"`); an unquoted scheme word (`Bearer`, `Basic`, `Digest`, ...) takes the credential behind it (`token: Bearer S`); a YAML value line that starts with
  `#`, `>#` or `|#` is a value; the element after `-u` in an argv list, a glued `-uNAME:PASS` and a number after a credential option are read; a dangling `name:` at the end of
  a bracketed or quoted value hands its value to the next line.
- **No leak regression, as a test.** Five frozen fixtures of generated inputs (the last three derived from BOTH earlier redactors: option forms, option neighbours, the shapes of the
  security report) must stay hidden, and a scratch differential of three generator styles, 100,000 strings each, was run against earlier trees and against the tree that was last reviewed; what
  remains (about 0.1 percent of the strings that an earlier tree hid) is classified in the ledger and listed in `docs/INTERFACES.md`, each class pinned. Correction: an earlier
  statement called the third comparator "the reviewed tree"; it was an intermediate tree, and the tree that was actually reviewed is the binding comparator of the final
  differentials (ledger, "Third pass"). That comparison found three regressions against the reviewed tree, all fixed: a quote that never closes after a Python prefix or `$'`, a closed
  prefixed string with a character glued behind its closing quote, and a multi-line array under `Authorization`.
- **Tooling.** The kill rule classifies a failure by the structure of the runner's message (a labelled Playwright `expect` is an assertion); a capped run kills the process group
  twice and the scratch runs of its tests stop and report any process that still holds their directory; a hang of the wrapper is a failed assertion; `run-with-cap` forwards
  SIGINT, SIGTERM and SIGHUP to the group and refuses a cap that a timer cannot hold; the packaged end-to-end helper has a timeout; a normal harness run checks its targets
  first. 390 mutation controls (116 new, 22 retargeted); killed in targeted runs, one mutant applied to a scratch copy (M275 to M390 at the redactor of that time); **the full mutation
  run has not been run on this tree**, so no document says "all mutants killed".
- **A hang on a short receipt string (found in review, fixed).** A regular expression in the redactor, `(?:\\+[nr]?|%0[AaDd])+$`, took exponential time on `password=[]x` followed by backslashes (1.4 s at 24,
  never finished at 40); the other trailing strips and two sticky matchers were quadratic on a long run of backslashes. All are linear scans or a remembered run end now (byte-identical output on 8.9 million short strings and on runs of up to 300 backslashes); every regular
  expression of `src/` is listed with a verdict in the ledger, `scripts/regex-audit.mjs` and a static test keep it that way, and the termination tests run hostile runs of up to 400,000 characters in a capped child process.
- **Super-linear scanners made structural.** Options repeated with no blank between them (`--password=`, `=-u`, `-token=-token=`, `%0A--password=`), a property in front of a value, and runs of backslashes behind a credential were quadratic; the end of a word and the next colon are measured once per region now, and every scan that walks a run is counted against a per-call work budget that fails closed: a call that passes it hides the WHOLE text (the artifact scanner reports `work-budget-exceeded`, so a bundle with such an artifact is refused). Ordinary text uses a fraction of a step per character.
- **Regressions against the reviewed tree, fixed.** A Python-, shell- or SQL-prefixed value that looks like a label (a padded base64 secret, `b'...=='`) is redacted whole; a value that starts with a bracket runs to the end of its token; the usage counters that stay readable are ONE narrow definition for text and for object keys (`TOKEN_USER`, `INPUT_TOKEN`, `token_day` are hidden again; a counter with a word in front of it, `openai_total_tokens`, is hidden as a key too); a glued `-pSECRET` no longer swallows an option's name (`-password%20'S'`, `-passD: S`); options after `\u000a`, `\x0a`, `%0B`, `%0C` are read; a YAML list item that ends in a colon no longer takes the next item; `--Authorization=[` is read like the assignment form; the RunProof importer refuses more verdict-like run fields (`conclusion`, `exit_signal`, `error`, `success_count`, ...).
- **An option's value after a blank that reads as a label (final review, fixed).** `--token V`, `--password V`, `--api-key V`, `--secret V`, `-token V` and `-H 'X-Api-Key: V'` left V readable when V is a Fernet key, base64 of 32 bytes or 30 random letters and digits ending in `=` and holding a credential word as a camel-case segment: it was read as another credential's name. A word that does not read as a name (length, digits, humps) is the option's value, and a name with nothing behind it after an option is the value too; tested with seeded random values in six option forms and through the built CLI (`evaluate --json`, the report directory, the bundle bytes).
- **A quoted password after `-u user:` (fixed).** `curl -u admin:"S"`, `curl -u admin:'S'`, `curl -u admin:$'S'` and `curl --user admin:"S"` left S readable (the word ended at the quote; the unquoted form, a quote around the whole pair and the glued `-uadmin:"S"` were hidden). The quote after the colon now opens the password and the word reaches through its closing quote (an unclosed quote hides the rest of its line; the words behind a closed one stay readable). A `-u` or `--user` user that ends in a colon with the value on the next line (`curl -u admin:\nS`) is a documented limit, pinned in `tests/unit/redaction-known-limits-final.test.ts`.
- **A padded random key followed by a delimiter (fixed).** `--token abcdefJwtGhijkl==, next` (also `;` and `)`, and a single `=`) hid the padding and left the key body readable: the delimiter after the padding was read as a value glued to the separator. A padding that only delimiters follow is padding, and the word is the option's value; a value glued right behind the padding (`==Zx9...`) and a pair behind the delimiter (`, password=Zx9...`) are read as before.
- **A name-like padded key followed by a delimiter and content (known limit, pinned, open owner decision).** `--token KEY==,password=S` and `--token KEY==,]x` (KEY: letters only, a credential word in camel case) hide the padding and keep the key body readable; an earlier reviewed tree hid both whole. Measured: 0 of 22 cells of realistic key kinds, 2 of 5,000 letters-only 22-character keys. Pinned in `tests/unit/redaction-known-limits-final.test.ts`.
- **A `#` line under a credential key (final review, fixed).** `db:`, `  password:`, `    #S`, `  host: x` left `S` readable. A `#` line indented deeper than its credential key is now the value (hidden, with the lines below it that are deeper
  than the key); a `#` line at the key's column or to its left is a comment and stays readable; a list dash and a quote in front of the key count as indentation. A comment indented deeper than its credential key is hidden together with the value.
- **The artifact scan of `bundle export` over a hostile artifact, through the real command.** The packed binary and the built CLI run `evaluate` and `bundle export` over a 256 KiB, 1 MiB and 4,000,000 byte artifact of the shape that once took 33 s
  (refused with `bundle_secret_detected`, no bundle, under 20 s; an ordinary artifact of the same size is exported), in a child with a hard cap; the artifact scan takes a work limit like the redactor and answers `work-budget-exceeded` when it is passed.
- **Termination family.** Every opener of a credential by nine escape units by five tails by N = 26, 40, 200 and 5,000 units in a capped child; growth shapes of the later rules; 4 MB shapes; seven plants of the trailing-strip expressions and a static audit that
  flags them; a time fuzzer in `scripts/fuzz-redaction-time.mjs` (by hand, not part of the gate).
- **Kill rule.** A failed `rejects` / `resolves` assertion (`Error: expected ... to match object ...`) is recognised by vitest's own first stack frame; 60 captured failures of vitest 5.0.2 and Playwright 1.63.0 are a fixture.
- **Pins.** The scheme words Splunk and Hawk and the block indicators `|1`, `>1` are pinned as hidden; the shapes that stay readable and are accepted as listed (a multi-line `Authorization` list with text behind it, a line break written inside a password,
  `--token=>;x=y`, `;name=` inside a password, a blank in a JSON array element, a raw `@` in user information) are pinned with their exact output, and the printable-password figures are stated in `SECURITY.md`.
- **Bundle, adapters, manifest.** A bundle may hold only the documented entries under `report/`; a RunProof run with any spelling of a verdict or exit status is refused; a repeated
  collection key in a YAML manifest is a duplicate; the verify message names the verification copy and its size.
- **Documents.** No shipped document names a commit of the working history; the acceptance matrix has sections for the later fixes; the release document lists the instrument check
  and the cap; the list of shapes that are not redacted is complete and pinned; the PRD copy is marked and no longer imports a diagram library at view time.
- **Documented, not redacted (new in this round):** a credential keyword whose value is another credential's name with a blank in front of the separator, a chain of dangling
  labels, an empty quoted value with a word glued to it, a `#` line at column 0 that an indented line follows, `-Authorization-e=a S`, `//Authorization:x@host`,
  `--password=<value with a blank>` inside a JSON array, session cookie names as plain object keys, and user information with a raw `@` and another stop character. Whether any of
  these should be covered is an open decision for the owner.

## [0.1.0] - unreleased MVP candidate

### Added

- `proofgate evaluate`: deterministic acceptance report from a requirement manifest, an exact revision set and a
  directory of test receipts. Exit 0 only when every mandatory requirement is PASS; exit 1 when the policy is unsatisfied;
  exit 2 for malformed input or an internal error, with a stable reason code and no report.
- Six requirement states: PASS, FAIL, STALE, MISSING, PARTIAL, DEFERRED. Uncertain states never satisfy a mandatory gate.
- Exact-revision matching on full 40-character commit SHAs across multiple repositories; freshness at `max_age_seconds`
  (exactly at the limit is STALE); live/mocked/synthetic execution kinds; a zero-test pass claim is MISSING.
- `proofgate explain`, a self-contained static HTML report (`index.html`, no script, no network), and `report.json` +
  `report.sha256`.
- `proofgate bundle export | verify | restore`: one versioned, checksummed evidence file; restore re-evaluates the report from
  the restored inputs and leaves nothing behind on any failure.
- Adapters: native receipts and a labelled-fixture RunProof importer (`docs/ADAPTERS.md`); an event envelope helper.
- Untrusted-input handling: no receipt command is executed, no URL is fetched, symlinks and traversal are refused, size
  limits apply before parsing, known secret shapes and credential-named values are redacted in documents, reports, bundles
  and errors (redaction is best effort, see `docs/INTERFACES.md`).
- Synthetic, account-free demo fixtures (`fixtures/demo.json`, `fixtures/demo/**`).
- Operator documentation: install, upgrade, backup, restore, failure diagnosis and retention (`docs/OPERATIONS.md`), a
  synthetic smoke runbook (`docs/RUNBOOK-SMOKE.md`), a human drill sheet (`docs/HUMAN-DRILL.md`) and a release procedure
  (`docs/RELEASE.md`).
- Local quality gate `scripts/verify-quality.sh`: typecheck, build, unit and integration tests with 90% coverage
  thresholds, mutation controls, schema drift, dependency license audit, secret hygiene, packaged-CLI end-to-end run and a
  real-Chromium browser smoke of the static report.
- `Dockerfile` for a pinned Node 22.12 image that installs the packed tarball.

### Known limits

- MVP verifies consistency and declared provenance, not the honesty of arbitrary test producers; forged trusted-runner
  receipts are possible without attestation.
- The RunProof importer is verified against a labelled synthetic fixture only; no live RunProof export exists.
- No live connectors, no HTTP API, no hosted operation.
- Retention is documented as an operator procedure, not enforced.
- AC-11 (fresh-operator drill) is `PENDING_HUMAN_RECEIPT`: it needs an independent human run of the smoke runbook.
