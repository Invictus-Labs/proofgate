# Operations guide

ProofGate is a command-line tool that reads a requirement manifest, a revision set and a directory of test receipts and
writes an acceptance report. There is no daemon, database, HTTP server, account or telemetry, so "operating" it means
installing a package, keeping the input and report files safe, and diagnosing rejections. This page covers install,
upgrade, backup, restore, failure diagnosis and retention.

Before you rely on any of it, run the [synthetic smoke runbook](RUNBOOK-SMOKE.md) once in a scratch directory.

## Contents

1. [Install](#install)
2. [Upgrade](#upgrade)
3. [Backup](#backup)
4. [Restore](#restore)
5. [Failure diagnosis](#failure-diagnosis)
6. [Retention](#retention)
7. [Running in Docker](#running-in-docker)
8. [Security notes for operators](#security-notes-for-operators)

## Install

Supported: macOS and Linux with Node.js 22.12 or newer. (The suite has been run on Node 25 on macOS; the Node 22.12 result
and the Docker result are recorded in [qa/ac-matrix.md](qa/ac-matrix.md). Windows is not supported.)

The `engines` field (`>=22.12`) describes the installed CLI, which has two runtime dependencies. The development toolchain
(vitest and friends) declares its own, narrower engine ranges, so `npm ci` on a Node major newer than those ranges prints
`EBADENGINE` warnings for dev dependencies only; they do not affect the packaged CLI. The test toolchain supports Node 22.12 or newer 22.x, 24.x and 26 or newer (not 25, where it warns); the suite has nevertheless been run on Node 25.

### From a release tarball (recommended)

1. Obtain `proofgate-<version>.tgz` and the SHA-256 published with the release.
2. Verify it before installing anything:

   ```sh
   node -e "const c = require('node:crypto'), f = require('node:fs'); console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" proofgate-<version>.tgz
   ```

   (`shasum -a 256` or `sha256sum` print the same hash.) The value must equal the one you were handed with the tarball (there are no published release notes yet). Do not install a
   tarball that does not match.
3. Install it into a project directory of your own, which keeps the tool and its two runtime dependencies (`yaml`, `zod`)
   together and removable:

   ```sh
   mkdir proofgate-tools && cd proofgate-tools
   npm init -y
   npm install --no-audit --no-fund /path/to/proofgate-<version>.tgz
   export PATH="$PWD/node_modules/.bin:$PATH"
   proofgate --version
   ```

   Use the `node_modules/.bin` path, not `npx proofgate`: `npx` would fall back to fetching a package of that name from
   the registry if the local one is missing.

`npm install` is the only step that uses the network (to fetch the two runtime dependencies). Everything ProofGate does
afterwards is offline.

### From source

```sh
git clone <repository-url> proofgate && cd proofgate
npm ci
npm run build
node dist/cli.js --version
```

`bash scripts/verify-quality.sh` runs the full local gate (see [RELEASE.md](RELEASE.md)).

### Confirm the install worked

Run the [synthetic smoke runbook](RUNBOOK-SMOKE.md). Its steps 5 to 16 are the acceptance check for an install.

## Upgrade

ProofGate keeps no state between runs, so an upgrade replaces the installed package only. Your manifests, receipts, reports
and bundles are files that you own.

1. **Back up first** (see [Backup](#backup)): at minimum export a bundle of every report you still need.
2. Read [CHANGELOG.md](../CHANGELOG.md) for changes to `schema_version`, error codes or decision rules.
3. Install the new tarball into a **new** directory, verify its checksum, and run the smoke runbook there. Keep the old
   directory until the new one has passed.
4. Re-evaluate your live inputs with the new version into a **new** output directory, or with `--replace`. If the
   decision engine changed, `policy_hash` changes and the report says so (`supersedes.policy_changed: true`): the old
   report is never edited, it is moved to `<output>.superseded-<assessment id>`.
5. A `schema_version` other than `1` is refused with `unsupported_schema_version` rather than half-read. A future major
   version will ship with a migration note in the changelog; nothing migrates silently.

**Reports and bundles written by an earlier pre-release build are refused** by `explain`, `bundle verify` and `bundle restore` (`report_invalid`: the report has no `clock_source`), and a bundle written under a different policy engine version is refused with a message that names both versions (verify it with the ProofGate version that wrote it); regenerate reports from the inputs, and keep the old build for old bundles. See the pre-release exception in [SCHEMAS.md](SCHEMAS.md).

Rollback is installing the previous tarball again. Reports written by a newer version remain readable only if the older
version supports their `schema_version`; keep the previous report directories and bundles until you are satisfied.

## Backup

What to keep, and why:

| Item | Why | How |
| --- | --- | --- |
| The **evidence bundle** for each report you rely on | One self-contained, versioned, checksummed file: report, normalised manifest, revision set, every receipt and artifact. It is the unit you can copy anywhere and prove later. | `proofgate bundle export` |
| The manifest, revision set and receipts directory (the *inputs*) | Needed to re-evaluate under a new clock or policy. | Copy the directories. |
| The report directories | Immutable historical results; superseded ones end in `.superseded-<assessment id>`. | Copy the directories. |

Backups made by an earlier pre-release build cannot be restored by a later one (see Upgrade): keep the build that wrote a bundle for as long as you keep the bundle.

Export a bundle:

```sh
proofgate bundle export --report out/release --manifest requirements.yaml --receipts receipts --revisions revisions.json --output backups/release-<date>.pgbundle
proofgate bundle verify backups/release-<date>.pgbundle
```

Export refuses to overwrite an existing bundle (`bundle_target_exists`), refuses inputs that do not reproduce the report
(`bundle_input_mismatch`), and refuses artifacts that contain credential-shaped text unless you pass
`--allow-secret-artifacts` deliberately (`bundle_secret_detected`), because redaction covers documents, not opaque artifact
bytes. (The scan reads each artifact as written, as UTF-8 with hidden characters removed and fullwidth letters folded, and as
UTF-16; it does not decode base64 or hex and cannot see inside compressed data.) Bundles and restored trees are owner-only (mode 0600 and 0700); keep them that way when you copy them.

Record a checksum next to each stored bundle (`sha256sum` or `shasum -a 256`) so silent corruption is detectable before you
need the file. Backups follow the retention defaults below.

## Restore

Always restore into a **new, empty location**; restore never overwrites (`bundle_target_exists`).

```sh
proofgate bundle verify backups/release-<date>.pgbundle
proofgate bundle restore backups/release-<date>.pgbundle --output restored
proofgate evaluate --manifest restored/manifest.json --receipts restored/receipts --revisions restored/revisions.json --output restored-check --now <evaluated_at from restored/report/report.json>
```

What restore checks, in order, before anything is moved into place: declared sizes against the real file size (truncation),
the trailer checksum, every entry hash, entry path safety (no traversal, no absolute paths), header-against-report
consistency, and finally a **re-evaluation of the report from the restored inputs**. Any failure leaves nothing behind:
no partial directory and no temporary files. A truncated, corrupted, unsupported or forged bundle is therefore never
"partly accepted". Every entry's `role` is checked against its path, and the format line must be spelled `PROOFGATE-BUNDLE 1`.

**Temporary space.** `bundle export` checks the bundle it has written before it publishes it, by extracting it into a private
scratch directory **next to the output file**, so the output directory needs free space of about twice the bundle size while the
export runs (the bundle itself and its extraction) and the system temp directory is not used. A failure of that check that is not
the bundle's fault (a full disk, a permission problem) is reported as `output_unwritable` with the reason, never as a bad bundle.
`bundle verify` extracts into `TMPDIR` (or `/tmp`) and needs free space equal to the bundle size there (under an unusable `TMPDIR` it
fails with `output_unwritable` and says so for "the verification copy"); `bundle restore --output <path>` (the option is required)
extracts next to its target.

The restored `restored-check` report has the same `assessment_id`, hashes and decisions as the original. (Bookkeeping such
as the input file names differs, so `report.sha256` itself is not byte-identical; compare `assessment_id` as the runbook does.)

ProofGate writes nothing to any remote system, so a restore cannot leave remote effects to reconcile; restoring only
reproduces local files.

## Failure diagnosis

### Exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | `evaluate`: every mandatory requirement is PASS. Other commands: success. | Nothing. |
| `1` | `evaluate` only: the policy is unsatisfied. A report **is** written. | Open `index.html` or run `proofgate explain <REQ-ID> --report <dir>` for each requirement that is not PASS. |
| `2` | Malformed input, integrity failure, usage error or internal error. **No report, bundle or restored tree is written.** | Read the `proofgate: error [<code>]: ...` line on stderr and look the code up below. |

Unknown, stale, partial and deferred states are never success: they keep a mandatory requirement out of exit 0.

### First checks

1. Read the last `proofgate: error [<code>]` line. The code is stable and is the thing to search for.
2. Check the input files exist and are readable by your user. Paths in receipts are relative to the receipts directory.
3. Re-run with `--json` for machine-readable output, or with a fixed `--now` (or `PROOFGATE_NOW`) to reproduce a result. A fixed clock is
   never silent: stderr prints a `note:` line and the report records `clock_source` (`flag`, `env` or `system`); a report
   judged against a frozen clock says so on its page too.
4. If an error says `internal_error`, report it (see [SECURITY.md](../SECURITY.md) for security-sensitive cases, otherwise open an issue): the message is redacted and
   contains no stack trace by design.

### Error codes (exit 2)

| Code | Meaning | What to do |
| --- | --- | --- |
| `cli_usage` | Unknown command or option, missing flag, a bad or empty flag value, or an option given twice. | Run `proofgate --help` and fix the command line. Each option takes exactly one value: to evaluate several receipt sets, merge them into one directory. |
| `clock_invalid` | `--now` or `PROOFGATE_NOW` is not a strict UTC time such as `2026-09-29T12:00:00Z`. | Pass an ISO time ending in `Z`; offsets and dates alone are rejected. |
| `connector_disconnected` | A live connector operation was requested. None is implemented or configured. | Expected: connectors are disabled by default. Use file-based receipts. |
| `internal_error` | Unexpected failure. | Re-run once with the same inputs. If it repeats, file an issue with the redacted message. |
| `manifest_not_found` | The manifest path does not exist or is not a regular file. | Fix the `--manifest` path. |
| `manifest_parse_error` | The manifest is not valid YAML (or has duplicate keys, unknown tags, or an alias bomb). | Validate the YAML; remove anchors/aliases you do not need. |
| `manifest_schema_invalid` | The manifest breaks the schema (the message names the field). | Fix the named field; see `docs/SCHEMAS.md`. |
| `manifest_unknown_field` | The manifest contains a field the schema does not define. Unknown fields are refused, never dropped. | Remove it, or move free-form data under `extensions`. |
| `manifest_duplicate_requirement_id` | Two requirements share an id (compared case-insensitively). | Give each requirement a unique id. |
| `manifest_duplicate_repository` | A repository is declared twice. | Declare each repository once. |
| `manifest_unknown_repository` | A requirement names a repository the manifest does not declare. | Declare the repository or fix the name. |
| `manifest_no_mandatory_requirements` | The manifest has no mandatory requirement, so acceptance would be vacuous. | Mark at least one requirement `mandatory`. |
| `revisions_not_found` | The revision-set path does not exist. | Fix the `--revisions` path. |
| `revisions_invalid_json` | The revision file is not JSON. | Fix the JSON. |
| `revisions_schema_invalid` | The revision file breaks the schema. | See `docs/SCHEMAS.md`. |
| `revisions_unknown_field` | The revision file has an undeclared field. | Remove it. |
| `revisions_invalid_commit_sha` | A revision SHA is short, uppercase or otherwise not a 40-character lowercase hex SHA. | Use the full lowercase SHA. |
| `revisions_duplicate_repository` | A repository appears twice in the revision set. | List each repository once. |
| `revisions_unknown_repository` | The revision set names a repository the manifest does not declare. | Remove it or declare it. |
| `revisions_missing_repository` | A declared repository has no SHA in the revision set. | Add the commit for that repository. |
| `receipts_dir_not_found` | The receipts path does not exist or is not a directory. | Fix the `--receipts` path. |
| `receipt_invalid_json` | A `*.receipt.json` file is not valid JSON. | Fix or remove the file (the message names it). |
| `receipt_schema_invalid` | A receipt breaks the schema, for example test counts that do not add up. | Fix the receipt at its source (the producer). |
| `receipt_unknown_field` | A receipt contains an undeclared field. | Regenerate the receipt with a producer that matches `schema_version` 1. |
| `receipt_invalid_commit_sha` | A receipt SHA is not a full 40-character lowercase hex SHA. | Fix the producer. |
| `receipt_duplicate_id` | Two receipt documents share a `receipt_id`. | Make ids unique; remove a duplicate copy. |
| `receipt_unknown_requirement` | A receipt names a requirement id that is not in the manifest. | Fix the receipt or add the requirement. |
| `receipt_unknown_repository` | A receipt names a repository the manifest does not declare. | Fix the receipt or declare the repository. |
| `adapter_unknown_format` | A receipt declares a `format` no adapter handles. | Use `proofgate.receipt` or `runproof.run-detail`. |
| `receipt_unreferenced_file` | The receipts directory holds a file that is not a receipt (`*.receipt.json`), not named as an artifact by any receipt and not one of the allowed notes (`README`, `README.md`, `README.txt`, `.gitkeep`, `.DS_Store`): `x.RECEIPT.JSON`, `x.receipt.json.bak`, `x.receipt.yaml`, `fail.txt`, any other `.json`. Evidence in it would otherwise be silently left out. | Rename it to end in exactly `.receipt.json` so it counts, or move it out of the receipts directory. The message names up to five files. |
| `runproof_schema_invalid` | A RunProof import document breaks its schema, including a recorded `exit_code` that is not an integer or null, an exit status under another spelling, or a `__proto__` key. | See `docs/ADAPTERS.md`. |
| `runproof_unknown_field` | A RunProof import wrapper or binding has an undeclared field. | Remove it. |
| `runproof_invalid_commit_sha` | A SHA in a RunProof import is not a full 40-character lowercase hex SHA. | Fix the binding. |
| `runproof_outcome_mismatch` | A RunProof run claims `verified` while a required check is not `pass`, or a required check definition of an earlier evaluation is missing from the latest one. | The run's own data contradict each other; re-capture it. |
| `runproof_run_unfinished` | A RunProof run has no `finished_at`. | Import only finished runs. |
| `runproof_execution_incomplete` | A RunProof run has `execution_status` `running` or `missing`; it is not evidence. | Wait for the run to finish, or re-capture it. |
| `unsupported_schema_version` | A document declares an integer `schema_version` this build does not read. | Use a ProofGate version that supports it, or regenerate the document. Nothing is half-read. |
| `json_duplicate_key` | A JSON document repeats an object key (at any depth), so which value applies would be ambiguous (`{"result":"fail","result":"pass"}`). | Fix the producer: it wrote an invalid document. Never edit one of the two values to "resolve" it. |
| `artifact_missing` | An artifact named by a receipt is not on disk. | Add the file under the receipts directory or fix the path. |
| `artifact_hash_mismatch` | The artifact's real SHA-256 differs from the receipt's: it was **changed after the receipt was written**. | Treat as tampering or corruption. Obtain the original artifact; do not edit the hash to match. |
| `path_invalid` | An artifact path is malformed: URL, backslash, empty segment, control character, too long or too deep. | Use a relative, forward-slash path inside the receipts directory. URLs are never fetched. |
| `path_absolute` | An artifact path is absolute. | Make it relative to the receipts directory. |
| `path_traversal` | An artifact path contains `..`. | Keep artifacts inside the receipts directory. |
| `path_symlink_rejected` | A symbolic link exists anywhere under the receipts directory. | Replace links with real files. Links are refused, not only escaping ones. |
| `path_not_regular_file` | A directory, FIFO, socket or device is where a file was required. | Provide a regular file. |
| `limit_file_count` | More than 1,000 entries in the receipts directory (or a bundle). | Split the delivery; do not raise the limit casually. |
| `limit_metadata_bytes` | Manifest, revisions and receipt documents together exceed 25 MB. | Split the delivery. |
| `limit_manifest_size` | The YAML manifest is over 4 MiB (a 5,000-requirement, 50-repository manifest is about 3.4 MB as JSON). | Split the policy into several manifests; a manifest is a policy, not data. |
| `limit_blob_bytes` | Referenced artifacts exceed the 250 MB cap. | Trim artifacts or pass `--max-blob-bytes <n>` deliberately. |
| `limit_json_depth` | A JSON document is nested too deeply. | Flatten `extensions`. |
| `limit_json_containers` | A JSON document holds more than 500,000 objects and arrays (a bound on parser memory, checked before parsing; a legitimate report at the 25 MB ceiling holds about 300,000). | Fix the producer: no real receipt or revision set looks like this. |
| `limit_json_values` | A JSON document holds more than 1,500,000 values (array elements, object members and containers counted together; a bound on parser memory, checked before parsing). A few megabytes of plain numbers can hold that many. | Fix the producer: no real receipt or revision set looks like this. |
| `output_overlaps_input` | `--output` is, contains or lies inside an input (the receipts directory, manifest or revisions file), or a bundle's `--output` lands inside one. | Choose an output location beside the inputs, not in or around them. Nothing was moved. |
| `output_exists` | The output directory already exists. | Choose a new path, or pass `--replace`. `--replace` moves an existing directory that holds a `report.json` (any file of that name qualifies: a damaged or foreign one is archived too, as `<output>.superseded-unreadable-<id>`, and the new report records `supersedes: null`); a directory without a `report.json` is refused and left untouched. The old report is moved to `<output>.superseded-<id>` (`-2`, `-3`, ... if that name is taken) and never deleted. |
| `output_unwritable` | The report, bundle or restored tree could not be written or published (permission denied, read-only file system, too many open files, a full disk, a parent that does not exist or is not a directory, including an unusable `TMPDIR`), or the target has less free space than a bundle needs (checked with `statfs` before anything is written; a full disk mid-write is reported the same way). This holds for `evaluate`, `bundle export` and `bundle restore` alike: a restore into an unwritable target never says the bundle is corrupt. | Check permissions and free disk space of the target directory. Nothing partial is left. |
| `report_not_found` | `explain` or `bundle export` could not find `report.json`. | Point `--report` at the report directory or file. |
| `report_invalid` | The report is malformed, has no `report.sha256`, no longer matches it, or its verdict, exit code or summary do not follow from its own decisions: it was edited or damaged. | Restore the report from a bundle or re-evaluate. |
| `explain_unknown_requirement` | The requirement id is not in the report. | List ids with `proofgate evaluate ...` output or in `report.json`. |
| `bundle_not_found` | The bundle file does not exist. | Fix the path. |
| `bundle_truncated` | The bundle is shorter than its header says, or its trailer is missing (an interrupted copy). | Fetch the file again from your backup and compare its checksum. |
| `bundle_corrupt` | An entry hash or the trailer checksum does not match, or extra bytes follow. | The file changed after export. Use another copy. |
| `bundle_invalid_header` | The file is not a ProofGate bundle or its header is invalid. | Check you have the right file. |
| `bundle_unsupported_version` | The bundle container version is not 1. | Use a ProofGate version that supports it. |
| `bundle_entry_invalid` | An entry path is unsafe or unexpected, duplicated, or a required entry is missing. | The bundle is malformed or hostile: do not use it. |
| `bundle_too_large` | The bundle exceeds the size cap. | Pass `--max-blob-bytes <n>` deliberately if you trust it. |
| `bundle_target_exists` | The bundle output file or restore directory already exists. | Choose a new path. Nothing is overwritten. |
| `bundle_input_mismatch` | The inputs given to `bundle export` do not reproduce the report. | Export with the same manifest, revisions and receipts that produced the report. |
| `bundle_secret_detected` | An artifact contains credential-shaped text. | Remove the secret from the artifact, or pass `--allow-secret-artifacts` if you accept that it will be stored. |
| `bundle_reevaluation_mismatch` | The bundled report does not follow from the bundled inputs, or its header disagrees. | Treat the bundle as forged or damaged. Do not use it. |
| `envelope_schema_invalid` | An event envelope (library use) breaks its schema. | See `docs/SCHEMAS.md`. |
| `envelope_unknown_field` | An event envelope has an undeclared field. | Remove it. |
| `envelope_conflict` | An event id was redelivered with different content. | The source is inconsistent; investigate before trusting either copy. |

### Decision reason codes (exit 0 or 1)

These appear in `report.json` (`reason_codes`, `rejected_receipts[].reason_codes`), in `index.html` and in
`proofgate explain`.

| Reason | Meaning | What to do |
| --- | --- | --- |
| `revision_mismatch` | The receipt is for a different commit than the revision set. | Re-run the tests on the commit you are accepting. A receipt for commit A never satisfies commit B. |
| `environment_mismatch` | The receipt ran in a different environment than required. | Run in the required environment. |
| `level_insufficient` | The receipt's test level is below the required level. | Provide an integration/e2e run where required. |
| `execution_kind_not_allowed` | A mocked or synthetic run where the requirement needs live evidence. | Provide a live run, or, after review, allow that kind in the manifest. |
| `receipt_from_future` | The receipt finished after the evaluation time. | Check clocks; a fixed `--now` earlier than the receipts causes this. |
| `repository_not_required` | The receipt is for a repository the requirement does not cover. | Nothing, unless the requirement should cover it. |
| `evidence_stale` | Evidence age is at or beyond `max_age_seconds` (exactly at the limit is stale). | Re-run the tests to produce fresh evidence. |
| `zero_tests` | The run executed zero tests. A zero-test `pass` claim is MISSING evidence, not a pass; a zero-test `fail` is FAIL and a zero-test `partial` or `skipped` is PARTIAL (stricter, never ignorable). | Fix the suite so it runs tests. |
| `tests_failed` | One or more tests failed. | Fix the failures and re-run on this revision. |
| `result_failed` | The receipt reports a failing result. | As above. |
| `result_contradicts_counts` | A pass claim contradicts its own failure count. | The producer is wrong; fix it. |
| `tests_skipped` | Some tests were skipped, so the evidence is PARTIAL. | Run the skipped tests. |
| `partial_result` | The receipt reports a partial result. | Complete the run. |
| `suite_skipped` | The whole suite was skipped. | Run it. |
| `all_criteria_met` | Everything matched and every test passed. | Nothing. |
| `no_receipt` | No receipt names this requirement for this repository. | Provide the evidence or defer the requirement explicitly. |
| `no_qualifying_receipt` | Receipts exist but none qualifies (see `rejected_receipts` for why). | Fix the cause listed per rejected receipt. |
| `conflicting_evidence` | Qualifying receipts for the same revision disagree. | Remove the superseded receipt from the receipts directory (the directory is the curated evidence set) and re-evaluate. |
| `incomplete_repository_coverage` | Only some declared repositories have passing evidence. | Provide passing evidence for every declared repository. |
| `requirement_deferred` | The manifest explicitly defers the requirement. It never satisfies a mandatory gate. | Resolve the deferral and remove it from the manifest. |

### If the static report looks wrong

`index.html` is generated statically from `report.json` by the same binary. If it is missing the run failed before writing
(exit 2) or the directory is not a complete report; re-run `evaluate --replace`. If a page ever renders differently from
`report.json`, trust `report.json` and `proofgate explain`, and file an issue with the report attached.

## Retention

ProofGate does not enforce retention: it has no scheduler. Retention is an **operator procedure**, and the defaults below
are the PRD's proposals that a production operator must approve before customer data is ingested
(see [DATA-RETENTION.md](DATA-RETENTION.md)).

| Item | Proposed default | Procedure |
| --- | --- | --- |
| Redacted evidence: reports, bundles, receipt sets | 90 days, configurable | Delete the report directories (including `*.superseded-*`) and bundles older than the limit. |
| Deletion request | primary deletion within 24 hours | Delete the directories; then the backups below age out. |
| Rotated backups | expire within 30 days | Delete backup bundles older than 30 days. |

List candidates first, and delete only after reading the list:

```sh
find reports -maxdepth 1 -type d -mtime +90 -print
find backups -maxdepth 1 -type f -name '*.pgbundle' -mtime +30 -print
```

Artifacts are stored exactly as received (redaction covers documents, not opaque artifact bytes), so treat them as
customer data and apply the same retention.

## Running in Docker

The repository ships a `Dockerfile` that builds the package, installs the packed tarball into a small runtime image and
runs as an unprivileged user. Nothing in ProofGate needs the network at run time, so the container can and should run with
`--network none`.

```sh
docker build -t proofgate:local .
docker run --rm --network none proofgate:local --version
docker run --rm --network none proofgate:local evaluate \
  --manifest /opt/proofgate/fixtures/demo/happy/requirements.yaml \
  --receipts /opt/proofgate/fixtures/demo/happy/receipts \
  --revisions /opt/proofgate/fixtures/demo/happy/revisions.json \
  --now 2026-09-29T12:00:00Z
```

To evaluate your own files, mount them read-only and mount a writable output directory:

```sh
docker run --rm --network none \
  -v "$PWD/inputs:/work/inputs:ro" -v "$PWD/out:/work/out" \
  proofgate:local evaluate --manifest /work/inputs/requirements.yaml --receipts /work/inputs/receipts \
  --revisions /work/inputs/revisions.json --output /work/out/report
```

The container user must be able to write the mounted output directory. Report directories are created with mode 0700.
`bash scripts/docker-smoke.sh` builds the image and runs this whole smoke inside it with the network disabled.

## Security notes for operators

- ProofGate verifies **consistency and declared provenance**: that receipts match the manifest, the exact revisions, the
  required environment and level, and are fresh. It does **not** prove that whoever produced a receipt was honest: a
  forged receipt from a trusted runner is possible without attestation.
- Receipt commands and artifact paths are data. Nothing is executed, no URL is fetched, and every symlink under the
  receipts directory is refused.
- Secrets are redacted in documents, reports, bundles and error output on a **best-effort** basis: known credential shapes
  and sensitive key names, including in object keys and file names. Redaction cannot recognise every secret and does not
  touch personal data other than e-mail addresses (names, telephone numbers, addresses, IP addresses, host names), so do not put
  secrets or personal data in receipts; the exact coverage and the cases it does not cover are listed in `docs/INTERFACES.md`. Artifact bytes are not rewritten; `bundle export` refuses credential-shaped artifacts unless you
  override it.
- Every string that came from a document (titles, ids, runner ids, environments, file names, error text) is printed to the
  terminal with control characters, escape sequences and bidirectional overrides shown as visible escapes, so a hostile
  receipt cannot recolour your terminal or forge a `verdict:` line. `--json` output escapes them inside the JSON strings.
- Limits are enforced before work: 4 MiB and 150,000 structure nodes for a YAML manifest (anchors and aliases are refused),
  25 MB of metadata, 1,000 entries, 250 MB of artifacts, a report-size ceiling before the HTML page is rendered, and free
  space before a bundle is written or restored.
- Interrupting a run (Ctrl-C or SIGTERM) removes the temporary directory it was writing and exits 130 or 143; a `kill -9`
  cannot be cleaned up, and leaves a hidden `.<target>.tmp-<hex>` directory next to the target, which is safe to delete.
- Reports, bundles and restored trees are owner-only. The local OS user is trusted; do not point ProofGate at a receipts
  directory another party can modify while it runs.
- There is no telemetry and no license server. To report a vulnerability see [SECURITY.md](../SECURITY.md).
