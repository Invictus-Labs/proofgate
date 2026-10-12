# ProofGate schemas (version 1, frozen for the MVP)

Every serialized ProofGate document carries `schema_version: 1`. The JSON Schema files in `schemas/` are
**generated from the runtime validators** (`npm run schemas`) and a test fails if they drift
(`npm run schemas:check`). The runtime validators (zod, `src/schemas.ts`) are the source of truth; the JSON
Schemas describe structure, not every cross-field rule (see "Rules the JSON Schema cannot express").

| Document | Format | Schema file | Produced / consumed by |
| --- | --- | --- | --- |
| Requirements manifest | YAML (or JSON) | `schemas/manifest.json` | authored by operators, read by `evaluate` |
| Revision set | JSON | `schemas/revisions.json` | authored by operators / CI, read by `evaluate` |
| Test receipt (native) | JSON, file name `*.receipt.json` | `schemas/receipt.json` | produced by test runners, read by `evaluate` |
| RunProof import document | JSON, file name `*.receipt.json`, `format: "runproof.run-detail"` | `schemas/runproof-run-detail.json` | see `docs/ADAPTERS.md` |
| Acceptance report | JSON (`report.json`) | `schemas/report.json` | written by `evaluate`, read by `explain`, the report layer and `bundle` |
| Evidence bundle header | JSON line inside a bundle file | `schemas/evidence-bundle.json` | written by `bundle export`, read by `bundle verify/restore` |
| Event envelope | JSON | `schemas/event-envelope.json` | adapter helper (`src/adapters/envelope.ts`) |

## Versioning and unknown fields

- `schema_version` is the **major** version. A document with any other integer major is rejected with
  `unsupported_schema_version` *before* any other validation, so a future document is never half-read.
- **Unknown fields are rejected, never silently dropped** (`*_unknown_field`). The only free-form area is the
  optional `extensions` object (manifest and receipts): its keys should be namespaced (`vendor.name`), its
  content is preserved **verbatim** (hashed, carried into the report's receipt hash and into bundles), redacted
  like everything else, and limited to 16 levels of nesting.
- Adapter documents that embed a third-party shape (the RunProof `run` object) preserve fields ProofGate does
  not map verbatim under `extensions.runproof.unmapped_run_fields`.
- Adding an optional field is a compatible change for readers only if they tolerate it; because unknown fields are
  rejected, any field addition bumps `schema_version`.
- **Pre-release exception, stated once:** `0.1.0` has not been published, so `schema_version: 1` was not frozen until
  publication. During the review remediation the report gained a required `clock_source` field (and the policy engine version
  moved to 2) without a bump. Reports and bundles written by earlier pre-release builds are therefore refused by these builds
  (`report_invalid`, naming `clock_source`) and must be **regenerated** from their inputs; they cannot be migrated, because
  the policy hash of every manifest changed with the engine version. From the first publication the rule above applies
  without exception.
- A recorded RunProof `exit_code` (and `exitCode`) must be an integer or null: a string, a boolean, an object or an array is
  `runproof_schema_invalid`, never "no exit code".

## Canonical JSON encoding and hashes

`src/canonical.ts` implements **ProofGate canonical JSON v1**, compatible with RFC 8785 for the value space used:

1. UTF-8, no insignificant whitespace.
2. Object members sorted by key in UTF-16 code unit order.
3. Strings and numbers serialised exactly as ECMAScript `JSON.stringify` does.
4. Members whose value is `undefined` are omitted; `NaN`, `Infinity`, `bigint`, functions, symbols and non-plain
   objects are rejected; nesting deeper than 64 levels is rejected.

All hashes are **lowercase hex SHA-256** over the UTF-8 bytes of a canonical encoding, except artifact hashes
(over the raw file bytes) and the bundle trailer (over the raw bundle bytes).

| Hash | Over | Notes |
| --- | --- | --- |
| `manifest_hash` | canonical encoding of the *normalised, redacted* manifest | Normalisation fills defaults and sorts lists; it is idempotent, so YAML formatting and key order never change the hash. |
| `policy_hash` | `{policy_version, repositories, requirements[{id, severity, required_level, required_environment, max_age_seconds, repositories, allowed_execution_kinds, deferred(bool)}]}` sorted by id | Excludes titles, descriptions, extensions and requirement order. Includes the engine `policy_version` (`POLICY_ENGINE_VERSION`), so a rule change in the engine is a new policy. |
| `revisions_hash` | canonical array of `{repository, commit_sha}` sorted by repository | |
| `receipts_hash` | canonical array of `{receipt_id, content_sha256}` sorted by id | |
| `receipt.content_sha256` | canonical encoding of the normalised (redacted, adapter-mapped) receipt | |
| `artifact.sha256` | raw bytes of the artifact file | **Recomputed** from the file by the evaluator, never trusted. A mismatch is exit 2 `artifact_hash_mismatch`. |
| `assessment_id` | UUID (RFC 9562 v8, custom) derived from sha256 of `{manifest_hash, policy_hash, revisions_hash, receipts_hash, evaluated_at}` | Reproducible: same inputs and the same fixed clock give the same id. |
| report content hash (`report.sha256`) | canonical encoding of the whole report | Independent of pretty-printing. `explain` refuses a report that does not match its `report.sha256`. |

## Requirements manifest (`schemas/manifest.json`)

```yaml
schema_version: 1
name: acme-release-gate
repositories:                  # every repository the gates may name
  - id: api
  - id: web
requirements:
  - id: REQ-001                # unique, case-insensitively
    title: Checkout API integration tests
    severity: mandatory        # mandatory | advisory
    required_level: integration  # unit | integration | e2e ; a higher level satisfies a lower requirement
    required_environment: staging  # exact, case-sensitive match
    max_age_seconds: 3600      # evidence at exactly this age is STALE
    repositories: [api, web]   # optional; default = every declared repository. ALL must have evidence
    allowed_execution_kinds: [live]  # optional; default [live]. mocked/synthetic never satisfy unless listed
    deferred: { reason: "vendor sandbox unavailable" }   # optional; resolves to DEFERRED
extensions: { }                # optional, free-form, preserved
```

## Revision set (`schemas/revisions.json`)

```json
{ "schema_version": 1, "revisions": [ { "repository": "api", "commit_sha": "<40 lowercase hex>" } ] }
```

Every declared repository needs exactly one **full 40-hex lowercase** commit SHA; short, uppercase and 64-hex values
are rejected (`revisions_invalid_commit_sha`); undeclared or missing repositories are exit 2.

## Receipt (`schemas/receipt.json`)

```json
{
  "schema_version": 1,
  "format": "proofgate.receipt",
  "receipt_id": "<lowercase uuid>",
  "requirement_ids": ["REQ-001"],
  "repository": "api",
  "commit_sha": "<40 lowercase hex>",
  "runner_id": "runner-1",
  "environment": "staging",
  "test_level": "integration",
  "execution_kind": "live",
  "result": "pass",
  "tests": { "total": 10, "passed": 10, "failed": 0, "skipped": 0 },
  "artifact": { "path": "artifacts/junit.xml", "sha256": "<64 hex>" },
  "finished_at": "2026-09-29T11:59:00Z",
  "command": "npm test",
  "extensions": {}
}
```

- `format` is optional (default `proofgate.receipt`). `command` is informational text: **never executed**.
- `result` is `pass | fail | partial | skipped`. `tests` counts must satisfy `passed + failed + skipped = total`.
- `artifact.path` is relative to the receipts directory (see `docs/INTERFACES.md`, path rules); it is never a URL.
- `finished_at` must be strict UTC (`YYYY-MM-DDTHH:MM:SS[.fff]Z`); offsets and date-only forms are rejected.

## Report (`schemas/report.json`)

`report.json` carries **raw strings only** (secrets redacted on a best-effort basis, see `docs/INTERFACES.md`; HTML *not* escaped). Any renderer must escape every
string (`escapeHtml` in `src/escape.ts`) before it reaches HTML.

Top level: `schema_version`, `assessment_id`, `manifest_name`, `manifest_hash`, `policy_hash`, `revisions_hash`,
`receipts_hash`, `evaluated_at`, `clock_source` (`flag | env | system`: where the evaluation instant came from),
`engine{name,version,policy_version}`, `revisions[]`, `verdict` (`accepted | unsatisfied`), `exit_code` (`0 | 1`),
`summary`, `supersedes`, `input_summary`, `requirements[]`, `receipts[]`. `verdict`, `exit_code` and `summary` must follow
from `requirements[]`: a report that contradicts itself is refused by `explain` and `bundle` (`report_invalid`), and a
report is only read together with its `report.sha256`.

`requirements[]` (one entry per manifest requirement, in manifest order): `id`, `title`, `severity`,
`required_level`, `required_environment`, `max_age_seconds`, `repositories[]`, `allowed_execution_kinds[]`,
`status`, `evidence_status`, `deferred_reason`, `reason_codes[]`, `receipt_ids[]` (the source receipts that decided
the status), `environments[]`, `per_repository[{repository, expected_commit_sha, status, reason_codes, receipt_ids}]`,
`rejected_receipts[{receipt_id, repository, reason_codes}]`.

`receipts[]` indexes every receipt: `receipt_id`, `requirement_ids`, `repository`, `commit_sha`, `runner_id`,
`environment`, `test_level`, `execution_kind`, `result`, `tests`, `artifact_path`, `artifact_sha256`, `finished_at`,
`command`, `content_sha256`, `adapter{name,version,provenance}`, `source_file`.

`supersedes` is `null`, or `{assessment_id, manifest_hash, policy_hash, policy_changed}` when the report replaced an
earlier one at the same output path (the earlier directory is kept as `<output>.superseded-<assessment_id>`).

Report directory layout (mode 0700, files 0600): `report.json`, `report.sha256` and `index.html`.

## Evidence bundle (`schemas/evidence-bundle.json`)

A bundle is one uncompressed file (no decompression amplification):

```
PROOFGATE-BUNDLE 1\n
<header: one line of canonical JSON, see schema>\n
<entry bytes, concatenated in header order>
PROOFGATE-END <sha256 of every preceding byte>\n
```

Entries (sorted by path): `report/report.json`, `report/report.sha256`, `manifest.json` (normalised manifest),
`revisions.json`, `receipts/<original relative path>` for each receipt document (redacted, canonical JSON) and each
artifact (raw bytes). The restored tree is directly evaluable:

```
proofgate evaluate --manifest <restored>/manifest.json --receipts <restored>/receipts \
  --revisions <restored>/revisions.json --now <report.evaluated_at>
```

reproduces the bundled report byte-for-byte in every decision field. Restore verifies, in order: declared sizes versus
the real file size (truncation), the trailer checksum, every entry hash, entry path safety, header versus report
consistency, and finally **re-evaluates the report from the restored inputs**. Only then is the temporary directory
renamed into place; any failure leaves nothing behind.

Redaction covers documents, not opaque artifact bytes, so export refuses artifacts that contain credential-shaped
text unless `--allow-secret-artifacts` is passed explicitly.

## Event envelope (`schemas/event-envelope.json`)

`{schema_version:1, event_id, source, resource_id, event_type, occurred_at, revision, evidence_ref, correlation_id?}`.
Unsupported majors and unknown fields are rejected. `evidence_ref` is an opaque string that is never dereferenced.
`EnvelopeDeduper` implements at-least-once consumption, keyed by `source` + `event_id` (ids are only unique per source):
same key and content is a duplicate, same key with different content is a conflict, and `current()` returns the newest event per `(source, resource_id)` by
`occurred_at` then `event_id`, so an old event never displaces a newer one.

## Deviations from the PRD data model

- **`receipt_id` is an opaque token** (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`), not strictly a UUID as the PRD data model says.
  UUID strings are a valid subset and are accepted unchanged (lowercase or otherwise), so PRD-conformant producers work.
  Reason: CI systems rarely emit UUIDs, and the public sanitize scan hard-blocks UUID literals in committed fixtures.
  `assessment_id` stays a UUID (generated by ProofGate). The same relaxation applies to the RunProof `run.id` used as a receipt id.
- **Uniqueness of requirement ids and of receipt ids is case-insensitive**, stricter than the PRD.
- **"Allowed content types" (PRD section 6, security)** is not implemented as a content-type allow-list because ProofGate
  never interprets artifacts: an artifact is an opaque file whose bytes are hashed and (on export) scanned for credential
  shapes, never parsed, rendered, executed or fetched. The documents ProofGate does parse (manifest YAML, receipts,
  revisions and reports as JSON, bundle headers) are strictly validated, unknown fields are rejected and duplicate JSON
  keys are refused. Nothing dispatches on a MIME type or file extension other than the `*.receipt.json` suffix.
- **"Fail before work when capacity is insufficient" (PRD section 6)** is met by the limits (25 MB of metadata, 4 MiB and
  150,000 nodes for the YAML manifest, 1,000 entries, 250 MB of artifacts, all checked before parsing or hashing), by the
  report-size ceiling (checked before rendering), and by a free-space check (`statfs`) before `bundle export`,
  `bundle restore` and `bundle verify` write anything. Where the platform cannot report free space the check is skipped
  and a full disk is reported as `output_unwritable` when it happens.
- **The YAML manifest is limited to 4 MiB and 150,000 nodes and refuses anchors and aliases** (see `docs/INTERFACES.md`),
  which is tighter than the PRD's 25 MB metadata limit, because the YAML parser needs about 1 KB of heap per node.

## Rules the JSON Schema cannot express

- `passed + failed + skipped = total` in receipts; duplicate requirement/repository ids; case-insensitive duplicate
  requirement and receipt ids; requirement repositories must be declared; at least one mandatory requirement.
- Duplicate object keys anywhere in a JSON document (refused as `json_duplicate_key`; the published schemas describe
  values, not how many times a key was written).
- UTC timestamps carry a `pattern` in the published schema; their calendar validity (no 2026-02-30) is checked at runtime only.
- `verdict`, `exit_code` and `summary` of a report follow from its `requirements[]` (checked when a report is read).
- Cross-document rules: receipt requirement ids and repositories must exist in the manifest; the revision set must
  cover exactly the declared repositories; artifact hashes are recomputed from files.
