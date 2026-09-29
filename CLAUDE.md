# ProofGate

Self-hosted acceptance gate: prove which requirements passed, on which exact revisions, with fresh verifiable evidence.

## Stack
Node.js 22+ and TypeScript CLI with a static HTML report (no database, no daemon). Pin exact dependency versions. TypeScript strict, ESM.

## GitHub
NEVER commit to main directly. Always feature branch (`codex/`) -> PR -> merge. No GitHub Actions workflows.

## Quality Gate
- Coverage floor: 90% lines and branches on decision/service code.
- Local gate: `bash scripts/verify-quality.sh` (typecheck, build, tests, coverage, secret scan, negative controls).
- Every acceptance criterion in `docs/prd/proofgate.md` needs current, named test evidence; see `docs/qa/`.
- Independent code-review and QA at the exact final SHA with zero P0/P1 before merge.

## Hygiene
Public repository: synthetic data only, `localhost` in demo URLs, no personal paths, hostnames, IPs or secrets.
