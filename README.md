# ProofGate

**Prove what passed, on which revision, before accepting delivery.**

ProofGate is a self-hosted command-line tool that turns a requirement manifest, an exact set of commit SHAs and a
directory of test receipts into a deterministic acceptance report. It answers one question: *does the evidence in this
directory satisfy the declared policy, for exactly these revisions, right now?* A green summary can hide skipped
requirements, mocked integrations, stale commits and missing negative tests; ProofGate does not let uncertainty become
success.

- Exit **0** only when every mandatory requirement is `PASS`; exit **1** when the policy is unsatisfied; exit **2** for
  malformed input or an internal error, with a stable reason code and no report.
- Six requirement states, all visible in the report: `PASS`, `FAIL`, `STALE`, `MISSING`, `PARTIAL`, `DEFERRED`.
- A receipt for commit A never satisfies commit B. Mocked or synthetic runs never satisfy a live-required requirement.
  A zero-test `pass` claim is `MISSING` (a zero-test `fail` is `FAIL`; a zero-test `partial` or `skipped` is `PARTIAL`).
  Evidence exactly at `max_age_seconds` is `STALE`.
- Output is `report.json`, `report.sha256` and a self-contained static `index.html` (no script, no network). An evidence
  bundle exports and restores the whole result with checksums.
- No database, daemon, account, telemetry or license server. The deterministic core makes no network call.

## Non-goals

ProofGate does not run tests, replace CI, generate tests with AI, merge or deploy code, or prove that a test is correct.
It evaluates evidence somebody else produced. No sibling product is a runtime dependency, and there is no HTTP server.

## Status

**Pre-release MVP (`0.1.0`, unpublished).** The implementation exists and is covered by the local gate
(`scripts/verify-quality.sh`). Defects that review found are fixed, and each fix has a regression test that fails on the reviewed code where that could be shown (the list of findings and of the evidence for each is in
[docs/qa/review-round1-ledger.md](docs/qa/review-round1-ledger.md)). **Those fixes were written and checked by the same maintainer
who wrote them; an independent re-review is pending.** Redaction is best effort; the shapes it does not cover are listed in
[docs/INTERFACES.md](docs/INTERFACES.md) ("What it does not redact") and each is pinned by a test. Acceptance status per criterion, with the honest gaps, is in
[docs/qa/ac-matrix.md](docs/qa/ac-matrix.md): **AC-03 is PARTIAL** until the zero-test and future-dated-evidence fixes are
independently confirmed, **AC-06 is PARTIAL** (the RunProof importer is verified only against a labelled synthetic fixture,
because RunProof has no export yet: the upstream half is blocked and an owner decision is pending), and **AC-11** (a fresh operator can follow the smoke procedure) is
`PENDING_HUMAN_RECEIPT`: it needs a run by an independent human ([docs/HUMAN-DRILL.md](docs/HUMAN-DRILL.md)). No criterion is
waived. The repository is public under the MIT license (see [License](#license)); the package name on a registry, a named
maintainer, a security contact and a supported-version policy are not yet designated. The product contract is
[docs/prd/proofgate.md](docs/prd/proofgate.md).

## Install

Requires Node.js 22.12 or newer on macOS or Linux.

```sh
mkdir proofgate-tools && cd proofgate-tools
npm init -y
npm install --no-audit --no-fund /path/to/proofgate-0.1.0.tgz   # verify its SHA-256 first, see docs/RELEASE.md
export PATH="$PWD/node_modules/.bin:$PATH"
proofgate --version
```

From a clone of this repository instead: `npm ci && npm run build && node dist/cli.js --version`. Docker:
`docker build -t proofgate:local . && docker run --rm --network none proofgate:local --version`.
Full instructions, upgrade, backup and restore are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Five-minute synthetic quickstart

The package ships synthetic demo fixtures. Nothing below needs an account, a server or any data of your own. There is no
URL to visit: the report is a file you open from disk. (If you ever serve a report directory yourself, bind the server to
`localhost` only.)

The demo receipts are dated relative to one fixed day, so **keep `--now 2026-09-29T12:00:00Z`**: without it the evidence is
judged against today's clock and, on any day but that one, ages past its limit: the happy example turns `STALE` and exits 1. (A fixed clock
prints a one-line note on stderr; that is expected.) Without `--output` a run prints its verdict but writes **no report**,
and says so on stderr.

```sh
cp -R node_modules/proofgate/fixtures ./fixtures

# 1. Everything passes: exit 0
proofgate evaluate --manifest fixtures/demo/happy/requirements.yaml \
  --receipts fixtures/demo/happy/receipts --revisions fixtures/demo/happy/revisions.json \
  --output out/happy --now 2026-09-29T12:00:00Z
echo "exit code: $?"          # 0

# 2. The same policy with planted problems: exit 1, one requirement in every non-PASS state
proofgate evaluate --manifest fixtures/demo/unsatisfied/requirements.yaml \
  --receipts fixtures/demo/unsatisfied/receipts --revisions fixtures/demo/unsatisfied/revisions.json \
  --output out/unsatisfied --now 2026-09-29T12:00:00Z
echo "exit code: $?"          # 1

# 3. Ask why
proofgate explain REQ-WEB-UNIT --report out/unsatisfied

# 4. A tampered artifact is refused: exit 2, no report
proofgate evaluate --manifest fixtures/demo/tampered/requirements.yaml \
  --receipts fixtures/demo/tampered/receipts --revisions fixtures/demo/tampered/revisions.json \
  --output out/tampered --now 2026-09-29T12:00:00Z
echo "exit code: $?"          # 2

# 5. Look at the static report (macOS; on Linux use xdg-open)
open out/unsatisfied/index.html
```

The complete, step-by-step version with expected output, evidence bundles and cleanup is
[docs/RUNBOOK-SMOKE.md](docs/RUNBOOK-SMOKE.md).

## Using it on your own delivery

```sh
proofgate evaluate --manifest requirements.yaml --receipts receipts/ --revisions revisions.json --output report/
proofgate explain REQ-001 --report report/
proofgate bundle export --report report/ --manifest requirements.yaml --receipts receipts/ --revisions revisions.json --output evidence.pgbundle
proofgate bundle verify evidence.pgbundle
proofgate bundle restore evidence.pgbundle --output restored/
```

- The **manifest** declares repositories and requirements (severity, required test level, required environment,
  `max_age_seconds`, allowed execution kinds, optional explicit deferral).
- The **revision set** gives the full 40-character commit SHA for every declared repository.
- **Receipts** are `*.receipt.json` files written by your test runners, each pointing at an artifact (a test report) by
  relative path and SHA-256. ProofGate recomputes the artifact hash; it never trusts the receipt's claim.
- `--now` (or `PROOFGATE_NOW`) fixes the evaluation clock, so every hash, id and byte of the report is reproducible. The
  report records that the clock was fixed (`clock_source`).
- `report.sha256` is the SHA-256 of the report's **canonical JSON form** (sorted keys, no whitespace), not of the bytes of
  `report.json`: `shasum -a 256 report.json` gives a different value. `explain` and `bundle export` recompute it and refuse a
  report that no longer matches or has no hash file.
- Every option takes one value; repeating one (for example `--receipts` twice) is an error, and `--output` may not be, contain
  or lie inside an input.

Formats are documented in [docs/SCHEMAS.md](docs/SCHEMAS.md) (JSON Schemas in `schemas/`), the full command and decision
contract in [docs/INTERFACES.md](docs/INTERFACES.md), adapters in [docs/ADAPTERS.md](docs/ADAPTERS.md).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | `evaluate`: every mandatory requirement is `PASS`. Other commands: success. |
| `1` | `evaluate` only: the policy is unsatisfied. A report is written; nothing is accepted. |
| `2` | Malformed input, tampered artifact, integrity failure, usage error or internal error. No report, bundle or restored tree is produced; stderr carries `proofgate: error [<code>]: ...` with a stable code ([diagnosis table](docs/OPERATIONS.md#failure-diagnosis)). |

## Limits

Enforced before any content is parsed: 25 MB of metadata (manifest, revisions, receipt documents), 1,000 directory entries,
250 MB of artifact bytes (raise only with `--max-blob-bytes`). Artifact paths must be relative to the receipts directory;
absolute paths, `..`, URLs and every symlink are rejected. A performance experiment (1,000 records) is recorded in
[docs/BENCHMARK.md](docs/BENCHMARK.md); it is not an SLA. Supported platforms: macOS and Linux.

## Security model

ProofGate verifies **consistency and declared provenance**. It checks that receipts match the manifest, the exact
revisions, the required environment and test level, and are fresh, and that artifacts have not changed since the receipt
was written. It does **not** prove that whoever produced a receipt was honest: **a forged receipt from a trusted runner is
possible without attestation**, and this MVP has no signing. An `ACCEPTED` report means "the supplied evidence is complete,
fresh and consistent with the declared policy", nothing more.

Everything read from disk is untrusted: receipt `command` text is never executed, artifact URLs are never fetched,
report text is HTML-escaped, text printed to a terminal has control characters neutralised, secrets are redacted (best
effort, and limited to key names and known token shapes: a bare hex key, a password written as free text in a receipt's
`command`, or personal data other than e-mail addresses is **not** recognised; do not put secrets or personal data in receipts) from documents, reports, bundles and errors, JSON
with a repeated key is refused, and reports and bundles are owner-only. The core never opens a network connection and sends no
telemetry. Details and how to report a vulnerability: [SECURITY.md](SECURITY.md).

## Documentation

| Document | For |
| --- | --- |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Install, upgrade, backup, restore, failure diagnosis with every reason code, retention |
| [docs/REPORT.md](docs/REPORT.md) | The static HTML report: what it shows, its wording, its safety properties |
| [docs/RUNBOOK-SMOKE.md](docs/RUNBOOK-SMOKE.md) | The synthetic smoke procedure a fresh operator follows |
| [docs/HUMAN-DRILL.md](docs/HUMAN-DRILL.md) | The independent human drill sheet (the only thing that can close AC-11) |
| [docs/RELEASE.md](docs/RELEASE.md) | Building, checksumming and verifying a release candidate |
| [docs/SCHEMAS.md](docs/SCHEMAS.md), [docs/INTERFACES.md](docs/INTERFACES.md), [docs/ADAPTERS.md](docs/ADAPTERS.md) | Formats, commands, decision contract, adapters |
| [docs/DATA-RETENTION.md](docs/DATA-RETENTION.md), [docs/BENCHMARK.md](docs/BENCHMARK.md) | Retention defaults awaiting approval; performance experiment |
| [docs/qa/ac-matrix.md](docs/qa/ac-matrix.md), [docs/qa/negative-controls.md](docs/qa/negative-controls.md) | Every acceptance criterion mapped to real test ids, with honest status |
| [docs/DEPENDENCY-LICENSES.md](docs/DEPENDENCY-LICENSES.md) | Dependency license audit |
| [CHANGELOG.md](CHANGELOG.md), [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) | Project policy |

## Development

```sh
npm ci
npx playwright install chromium     # once, for the browser smoke
bash scripts/verify-quality.sh      # the whole local gate; exits non-zero on any failure
```

There is no remote CI: the local gate is the gate. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE).

**License decision.** ProofGate is MIT-licensed under the copyright line `Copyright (c) 2026 Jeremy Knox` (see `LICENSE`), the
same holder line as the sibling public projects (RunProof and ScopeGuard), so the products can be combined, cited and consumed together without a license conflict. The
dependency audit ([docs/DEPENDENCY-LICENSES.md](docs/DEPENDENCY-LICENSES.md), regenerated by
`node scripts/dependency-licenses.mjs`) found no runtime dependency outside the permissive list (two runtime packages,
`yaml` ISC and `zod` MIT); the only non-permissive packages are development-only (MPL-2.0, listed there with the reason
they carry no obligation for ProofGate). Still open and owned by the maintainer: registry publication and package name
clearance, a named maintainer, a security contact, and a supported-version policy.
