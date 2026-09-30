# Release procedure

Release is an owner decision. This page describes how a release **candidate** is built, checksummed and verified. It
does not publish anything, and nothing in the repository authorizes registry publication: package-name clearance, a
named maintainer, a security contact and a supported-version policy are still open (see the PRD, section 9). The license is
decided (MIT, see the README's License decision note and the dependency audit).

## 1. Prerequisites

- Node.js 22.12 or newer (the `engines` floor) and a clean working tree on the exact commit to be released.
- `npm ci` completed; `npx playwright install chromium` completed once (the browser smoke needs it).

## 2. Run the full local gate

```sh
bash scripts/verify-quality.sh
```

The gate exits non-zero on any failure and prints a per-step summary. It runs, in order:

| Step | What it proves |
| --- | --- |
| install check | Node version, lockfile consistent with `package.json`, dependencies installed |
| typecheck, build | strict TypeScript over sources and tests; the compiled `dist/` |
| unit + integration + acceptance tests with coverage | every acceptance test in `tests/proofgate.spec.ts`; 90% statements, branches, functions and lines over `src/**` (see `vitest.config.ts` for the documented exclusions). The step runs under a wall-clock cap (`TEST_CAP_MINUTES`, default 60): a test process that spins in a synchronous loop cannot time out from inside itself, so a hang fails the step at the cap instead of stalling the gate |
| mutant targets match the sources | `node scripts/mutation-controls.mjs --check` and `node scripts/e2e-mutation-controls.mjs --check`: every seeded defect's target text occurs exactly once in the file it mutates, so a defect that can no longer be applied cannot pass as "killed" |
| instrument negative control | the same check is run with a target that cannot match (`MUTATION_CHECK_SELFTEST=1`) and must fail naming it |
| mutation controls | every deliberate defect in `scripts/mutation-controls.mjs` (the count is printed by the run and listed in `docs/qa/negative-controls.md`), each of which must turn the unit, integration and acceptance suite red |
| end-to-end mutation controls | every deliberate defect in `scripts/e2e-mutation-controls.mjs`, each run against a tarball packed from the mutated copy, each of which must turn the packaged-binary suite or the browser smoke red |
| schema drift | `schemas/*.json` equal what the runtime validators generate |
| demo fixtures current | `fixtures/demo/**` equal what `scripts/generate-demo-fixtures.mjs` generates |
| dependency licenses | `docs/DEPENDENCY-LICENSES.md` is current and every package has an allowed license |
| secret and hygiene scan | no credential-shaped literal, personal path, e-mail address, UUID literal in fixtures, or GitHub Actions workflow in tracked files |
| packaged-executable E2E | `npm pack`, install into a fresh directory outside the repository, run the real binary through every flow |
| runbook harness | the smoke runbook's commands, executed verbatim in an empty directory (supplemental evidence only) |
| browser smoke | real Chromium opens the static report from `file://` at 375 px and 1440 px |

## 3. Build and checksum the tarball

```sh
npm run build
npm pack                       # writes proofgate-<version>.tgz in the current directory
node -e "const c = require('node:crypto'), f = require('node:fs'); console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" proofgate-<version>.tgz
```

Record the hash in the release notes next to the file name, exactly as printed. (`shasum -a 256` and `sha256sum` print the same
value.) `npm pack` writes deterministic archive metadata, so the same commit built on the same Node and npm versions gives
the same hash; a different toolchain may not, so the hash that is published is the hash of the file that is published.
**The tarball SHA-256 is reproducible only on the same toolchain.** The same commit packed to different hashes on macOS with
Node 25 and on Linux with Node 22.12 and npm 10.9 (independent runs recorded `bb917828...` and `785818a9...` for one commit, and
the remediation branch gave `715ec745...` on macOS and `56ca6054...` in the Node 22.12 container), so never compare a hash
across machines: publish the hash of the exact file you hand over, and record the Node and npm versions that produced it.
A tarball rebuilt after any commit has a new hash; the human drill must use a tarball built from the **final** commit. One commit is
allowed after the drill: the one that records the drill receipt (only the AC-11 row, the drilled commit and the drilled tarball
hash, see `docs/HUMAN-DRILL.md`). The tarball that is released is then the one rebuilt from that receipt commit, and the AC-11
row states the drilled hash next to the released one, so a reader can see that the two differ by that one documented commit.

`node scripts/pack-install.mjs` does the same in a scratch directory outside the repository, writes a `SHA256SUMS` file, and
installs the tarball into a fresh project; the gate uses it for the packaged-executable tests.

## 4. Verify what will be shipped

- The tarball contains `dist/`, `schemas/`, the operator documents, `fixtures/`, `README.md`, `CHANGELOG.md`,
  `SECURITY.md` and `LICENSE`, and nothing from `src/`, `tests/`, `scripts/`, `.claude/` or any environment file
  (asserted by `tests/e2e/packaged-cli.test.ts :: packaged tarball`).
- Run the synthetic smoke runbook ([RUNBOOK-SMOKE.md](RUNBOOK-SMOKE.md)) yourself once.
- Have an **independent human** run the same runbook with [HUMAN-DRILL.md](HUMAN-DRILL.md). Until a completed sheet is attached to
  `docs/qa/ac-matrix.md`, AC-11 is `PENDING_HUMAN_RECEIPT` and the release does not satisfy its own criteria.
- Independent code review and QA of the exact final revision must report zero P0/P1 findings. The gate is maintainer
  evidence, not an independent receipt.

`package.json` carries `"private": true`, which makes `npm publish` refuse. Whoever publishes (an owner decision, see the top
of this page) must remove it in a reviewed commit, and that commit changes the tarball, so the drill and the checksum
follow it.

### Publish a squashed history, not the working one

The working history of this repository holds token-shaped literals (test inputs that look like credentials, spelled out before the tests spelled them apart), so the history must never be pushed as it is. Before the
first push to a public remote: (1) squash the branch into one or a few commits whose tree is **byte-identical** to the reviewed revision (compare `git rev-parse <squashed>^{tree}` with the reviewed commit's tree); (2) run
`git log -p` and `git log --all -G '<credential-shaped pattern>'` over **every ref that will be pushed** and expect no hit; (3) run the hygiene scan, `sanitize-content --scope public` and `sec-scan` again on a
`git archive` of the squashed commit; (4) build the tarball from a checkout of the squashed commit and record its SHA-256 (it must equal the one the drill used). Anything less publishes the history, not the tree.

## 5. Record

In the release notes record: the commit SHA, `git status` cleanliness, Node and npm versions, the exact commands and their
exit codes, the tarball name and SHA-256, the skipped or unresolved items, and the AC matrix as it stood (including that AC-11
was or was not closed by a human receipt).

## Optional: Docker image

```sh
bash scripts/docker-smoke.sh            # builds the image, then runs the synthetic smoke inside it with --network none
```

The image is pinned to `node:22.12-bookworm-slim`, installs the same `npm pack` tarball and runs as an unprivileged user.
The script needs Docker, is not part of the gate, exits non-zero on any mismatch and touches only its own throwaway
containers. Its result for a revision is recorded in `docs/qa/ac-matrix.md`.

## Not part of this procedure

Publishing to a registry, tagging, creating release notes on the repository host and announcing the release are
deliberate owner actions and are not automated here.
