# Contributing

Thanks for helping. ProofGate is small on purpose; the rules below keep it trustworthy.

## Ground rules

- The contract is [`docs/prd/proofgate.md`](docs/prd/proofgate.md). Uncertainty must never become success: unknown, stale,
  partial and deferred states stay visible and never pass a mandatory gate.
- No mandatory network access, telemetry, account, paid provider or license server. The deterministic core makes no
  network call at all.
- Public repository: synthetic data only. No personal paths, hostnames, IP addresses, emails or real secrets in source,
  fixtures, docs or test output. Planted fake secrets in tests are assembled from fragments at run time
  (`tests/helpers/fake-secrets.ts`); do not commit a credential-shaped literal. Use `localhost` for any URL a user may type.
  Scanner inputs that resemble identifiers (an RFC 4122 example UUID, the link-local metadata address in attack strings) are
  built at run time too; the only deliberate literals in tests are the reserved `example.invalid` domain and clearly fake
  values, so a grep of the public tree for addresses, UUIDs or tokens should find nothing that is not a documented example.
- No GitHub Actions workflows. The gate runs locally.
- Pin exact dependency versions and prefer few, permissively licensed dependencies. Every change to dependencies must
  regenerate `docs/DEPENDENCY-LICENSES.md` (`npm run licenses`) and pass `node scripts/dependency-licenses.mjs --check`.

## Workflow

1. Branch from `main` with a `codex/` prefix. `main` is protected: changes arrive by pull request.
2. Install and build:

   ```sh
   npm ci
   npx playwright install chromium   # once; only the browser smoke needs it
   ```

3. Change code and tests together. New behavior needs normal, invalid and boundary cases. A criterion that can go wrong
   needs a control that proves the test can fail (see [`docs/qa/negative-controls.md`](docs/qa/negative-controls.md)).
4. Run the whole gate before you push:

   ```sh
   bash scripts/verify-quality.sh
   ```

   It exits non-zero on any failure. It covers typecheck, build, unit and integration tests with 90% line, branch,
   function and statement coverage thresholds, mutation controls, schema drift, dependency licenses, secret and
   personal-path hygiene, the packaged-executable end-to-end run and the browser smoke. See
   [`docs/RELEASE.md`](docs/RELEASE.md).
5. Keep commits small. If you changed a JSON schema (`src/schemas.ts`), regenerate the published copies with
   `npm run schemas`. If you changed the synthetic demo, regenerate it with `npm run demo-fixtures`.
6. Update `docs/qa/ac-matrix.md` when a test id changes: `tests/proofgate.spec.ts` fails if the matrix names a test that
   does not exist.

## What a good test looks like here

- Real files in a temporary directory outside the repository, the real CLI, exit codes **and** report contents.
- A fixed UTC clock (`--now` or `PROOFGATE_NOW`), so results are reproducible.
- Opaque receipt ids (no UUID literals in committed fixtures) and synthetic commit SHAs derived from labels.

## Reviews

Maintainers cannot certify their own work. Independent review and QA of the exact final revision, with zero P0/P1
findings, precede any merge; AC-11 additionally needs a receipt from an independent human (see
[`docs/HUMAN-DRILL.md`](docs/HUMAN-DRILL.md)).
