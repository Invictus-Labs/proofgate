# Adapters

Adapters are optional and file-based. **No adapter connects to anything**; the core has no network code. The
`connector` command exists only to fail explicitly (`connector_disconnected`) when someone asks for a live operation.

## Native receipts

`*.receipt.json` files with `schema_version: 1` (see `docs/SCHEMAS.md`). `format` is optional
(`proofgate.receipt`). Unknown fields are rejected; `extensions` is preserved verbatim.

## RunProof importer (`format: "runproof.run-detail"`)

### What RunProof actually publishes (read-only reference)

The importer targets the public RunProof repository at **main SHA
`5e2f9af3310655116535b31ca99ab92210178431`** (read with `git show main:<file>`; no RunProof code or dependency is
used). RunProof's public `main` has since moved to `e442ea6`, which differs from the pinned SHA only by a LICENSE file, README
wording, the package metadata and one documentation file under `docs/dispatch/` (checked with `git diff --stat 5e2f9af e442ea6`: no source file changed and there is still no
export route), so the pin describes the same code. At the pinned SHA:

- RunProof has **no evidence-export endpoint or export file format**. Its own README lists "export/restore" as not
  implemented and its API routes contain no export route (the PRD's `POST /workspaces/{id}/exports` is not built).
- The only published, versioned shape that carries per-check outcomes is the response of
  `GET /api/v1/runs/:id` (`src/services/runs.ts: getRun`): the `runs` row (`id`, `external_run_id`,
  `execution_status`, `exit_code`, `outcome`, `finished_at`, ...) plus `checks[]` (`evaluation`, `definition_id`,
  `required`, `state` in `pending|pass|fail|unknown`, `expected`, `observed`, `evidence_hash`, ...), `events`,
  `exceptions`, `collectors`.
- RunProof checks are artifact-existence checks. They carry **no repository, commit SHA, environment or test level**.

Therefore the importer reads a wrapper document that embeds the `getRun` response verbatim as `run` and adds an
**operator-declared `binding`** for what RunProof does not know. This is a *declared provenance* input, not an
attested one.

### Document

```json
{
  "format": "runproof.run-detail",
  "schema_version": 1,
  "source_kind": "operator_capture",
  "runproof": { "main_sha": "5e2f9af3310655116535b31ca99ab92210178431", "basis": "GET /api/v1/runs/:id" },
  "run": { "...": "the getRun response, verbatim" },
  "binding": {
    "requirement_ids": ["REQ-001"], "repository": "api", "commit_sha": "<40 hex>",
    "environment": "staging", "test_level": "integration", "execution_kind": "live",
    "runner_id": "optional", "artifact": { "path": "artifacts/report.txt", "sha256": "<64 hex>" }
  }
}
```

### Status of the adapter: fixture-tested, **not live** (AC-06 is PARTIAL)

The RunProof half of AC-06 is **BLOCKED upstream**: RunProof has no evidence export, so there is nothing real to import. An
owner decision (ask RunProof for an export, or accept the importer as a labelled-fixture adapter) is **pending**; until it is
made, and until a real export is imported, AC-06 stays PARTIAL and this importer is described everywhere as fixture-tested only.

The repository ships `tests/fixtures/runproof/run-detail.fixture.json`, a synthetic document with
`source_kind: "fixture"` shaped like the `getRun` response at the pinned SHA. **No live RunProof export exists to test
against**, so the adapter is verified against that labelled fixture only. Consequences enforced in code:

- a `fixture` document is always imported as `execution_kind: "synthetic"` (and flagged
  `extensions.runproof.execution_kind_overridden`), so a live-required requirement rejects it whatever the binding says;
- `operator_capture` documents keep the declared execution kind; the operator vouches for the binding.
- Nothing in ProofGate ever claims a RunProof integration is live.

### Mapping

| RunProof | Receipt |
| --- | --- |
| `run.id` | `receipt_id` |
| required checks of the **latest** `evaluation` | `tests.total`; `pass` -> `passed`, `fail` -> `failed`, `pending`/`unknown` -> `skipped` |
| `__proto__` (a field of that name on the run) | Refused: `runproof_schema_invalid`. A field with that name cannot be preserved under `unmapped_run_fields` by plain assignment, and silently dropping it would contradict "never dropped". |
| `__proto__` (a field of that name on a check) | Refused: `runproof_schema_invalid`, for the same reason. |
| an exit status or a verdict under another spelling (`exit_status`, `exit code`, `exit.code`, `exitcode`, `returncode`, `return_code`, `exit_code ` with a trailing blank), or a plain `status` field, or a field named `verdict`, `result`, `success`, `ok`, `failed`, `passed` or `state` (compared after removing everything but letters and digits and folding the case) | Refused: `runproof_schema_invalid`. Only `exit_code`, `exitCode` and `execution_status` are read, and a run that carried another spelling or a `status` (`status: "failed"` beside `execution_status: "succeeded"`) would import as a pass. Any other field is preserved verbatim under `extensions.runproof.unmapped_run_fields`. |
| `execution_status`, `exit_code` | `execution_status: failed` or a non-zero integer `exit_code` (or `exitCode`) -> `fail` whatever the checks say; `running` or `missing` -> rejected (`runproof_execution_incomplete`); an exit code that is present but not an integer or null (`"1"`, `true`, `{}`, `[]`, `""`, `1.5`) -> `runproof_schema_invalid`; only `succeeded` with no non-zero exit code can pass |
| `outcome` + counts | `result`: any failure or `outcome: failed` -> `fail`; otherwise anything unverified -> `partial`; else `pass`; no required checks -> `skipped` |
| `run.finished_at` | `finished_at` (a null value is `runproof_run_unfinished`) |
| `binding.*` | repository, commit, environment, level, execution kind, artifact |

A run that claims `outcome: verified` while a required check is not `pass` is rejected (`runproof_outcome_mismatch`). So is a run whose
latest evaluation lacks a required check definition that an earlier evaluation held (it may be the one that failed): only checks
that the latest evaluation repeats are superseded.
Only the checks of the **latest** evaluation count: a re-evaluation supersedes earlier ones (all checks, including earlier
evaluations, are preserved verbatim in `extensions.runproof.checks`).
Run fields ProofGate does not map (`workspace_id`, `deadline_at`, `events`, ...) and every check field are preserved
verbatim in `extensions.runproof`.

### Version policy

`schema_version` is ProofGate's adapter-document version. Any other major is `unsupported_schema_version`. Unknown
top-level and binding fields are `runproof_unknown_field`; the embedded `run` is deliberately open so RunProof can add
columns without breaking imports (they are preserved, not dropped).

## Event envelope

`src/adapters/envelope.ts` implements the PRD envelope and an at-least-once consumer helper; see
`docs/SCHEMAS.md`. ProofGate does not emit envelopes or write to any connector in the MVP.

## Ecosystem boundary (from the PRD)

A dashboard or portal consumer would read a sanitized report reference and status (`assessment_id`, `verdict`,
`policy_hash`, per-requirement statuses); ScopeGuard could supply approved requirements as a manifest. Neither is
implemented here and neither is a runtime dependency.
