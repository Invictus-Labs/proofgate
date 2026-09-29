# PRD: ProofGate

**Prove what passed, on which revision, before accepting delivery.**

Author: Codex via prd-writer · 2026-09-29

Status: Draft; proposed topology; open-source direction; implementation not started. Board: #3793 (authoring only).

## 1. Problem Statement

A green summary can hide skipped requirements, mocked integrations, stale commits and missing negative tests. Reviewers reconstruct evidence manually and still cannot tell whether the release candidate is covered.

**Primary user / buyer:** Engineering leads and agencies accepting agent-built software.

**Evidence status:** product hypothesis from ecosystem operational pain, not validated demand. No competitor absence or willingness-to-pay claim is made. Before building beyond a synthetic prototype, interview three prospective users, capture five recent examples and compare the proposed workflow with their current tools.

## 2. Goal

Generate a deterministic acceptance report from a requirement manifest and verifiable test receipts for an exact multi-repository revision set.

**Position in the ecosystem:** RunProof records execution evidence. ProofGate evaluates whether that evidence satisfies a declared acceptance policy. It consumes optional RunProof exports; it never replaces the runner.

**Open-source boundary:** the complete deterministic MVP, schemas, synthetic examples, test harness and operational documentation belong in the public source release. Self-hosting must not require a license server or private fleet service. Hosted operation/support is a possible later business model; willingness to pay must be tested. License and product-name clearance remain owner decisions before publication.

## 3. Non-Goals

Running arbitrary tests; replacing CI; generating tests with AI; merging or deploying code; claiming log signatures prove test correctness.

No sibling product is a mandatory runtime dependency. No repository creation, implementation dispatch, production mutation, merge or deployment is authorized by this PRD authoring task. AI-generated prose cannot substitute for test evidence or operator approval.

## 4. Success Metrics

| Metric | Baseline collection | Pilot target | Evidence |
| --- | --- | --- | --- |
| Baseline completion | Before first pilot: time five current manual workflows and record errors | Five usable baseline records per pilot team | Dated operator worksheet |
| Median reviewer time to reconcile a delivery matrix | Use the same scenario class and record sample size | At least 50% below the recorded baseline over 10 comparable deliveries | Raw timestamps and outcome receipts |
| Activation | Record starting user count in the pilot | Three teams complete a synthetic core workflow within 30 minutes of install | Opt-in operator reports |
| Retention / value | Ask whether current workflow is still used after four weeks | Two of three teams elect to continue using the tool | Interview with concrete saved-time examples |

Targets are proposed decision thresholds. Report failures and sample sizes; small pilots do not establish market demand. Stop expansion if the baseline shows no recurring pain or existing tools solve it sufficiently.

## 5. Acceptance Criteria

- [ ] **AC-01** — Reject malformed manifests, duplicate requirement IDs, unknown requirement references and tampered artifacts; return exit 2 with a stable reason code.
- [ ] **AC-02** — A receipt for commit A cannot satisfy commit B, even when branch names match; multi-repository gates require all declared full SHAs.
- [ ] **AC-03** — Live-required criteria reject mocked receipts; skipped and partial results remain unsatisfied; zero tests is MISSING.
- [ ] **AC-04** — At max_age_seconds boundary evidence becomes STALE; changed policy hash forces reevaluation; a fixed UTC clock makes results reproducible.
- [ ] **AC-05** — Report every mandatory requirement with status, source receipt, environment and reason; a planted mandatory failure changes exit 0 to exit 1.
- [ ] **AC-06** — Import versioned local receipt JSON and optional RunProof export through adapters; unsupported major versions fail without silently dropping fields.
- [ ] **AC-07** — Escape malicious report text; never execute receipt commands or fetch artifact URLs; filesystem traversal and symlink escapes are rejected.
- [ ] **AC-08** — A synthetic demo works without paid accounts or mandatory telemetry; an outbound-denied test completes the deterministic local core. Live connector operations fail explicitly when disconnected.
- [ ] **AC-09** — Validate size and schema before processing; planted secret tokens never appear in logs or exported reports; malicious HTML renders as text.
- [ ] **AC-10** — Export a versioned evidence bundle and restore/read it in a clean installation with matching hashes; truncated or unsupported exports fail without partial accepted state.
- [ ] **AC-11** — Release documentation includes installation, upgrade, backup, restore and failure diagnosis; a fresh operator can execute the synthetic smoke procedure.

## 5b. Test Strategy

**SEC · 04c — Test Strategy & DoD**

**11 mapped ACs / 11 total ACs. All tests are PLANNED; none is claimed to pass.**

| AC | Level | Proven by — planned behavior | Execution | Status |
| --- | --- | --- | --- | --- |
| AC-01 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <schema and artifact tamper>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-02 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <revision mismatch>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-03 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <mock and empty suite controls>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-04 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <freshness boundaries>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-05 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <negative control and report reconciliation>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-06 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <adapter compatibility>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-07 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <untrusted receipt isolation>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-08 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <offline demo>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-09 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <redaction and hostile input>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-10 | Unit + integration / E2E | `tests/proofgate.spec.ts :: <portability and corruption>` — assert the criterion, including its failure boundary. | Automated; live sandbox gated | PLANNED |
| AC-11 | Human + E2E | Non-builder follows supplied runbook in a fresh sandbox; record all assistance, step outcomes and cleanup receipt (§9 independent drill). | Human receipt + harness | PLANNED |

### Flow and failure coverage

| User-facing flow | Happy path | Sad path / boundary |
| --- | --- | --- |
| schema and artifact tamper | Reject malformed manifests, duplicate requirement IDs, unknown requirement references and tampered artifacts; return exit 2 with a stable reason code. | Inject the rejected/uncertain condition in this criterion; assert no accepted result or unauthorized state change. |
| revision mismatch | A receipt for commit A cannot satisfy commit B, even when branch names match; multi-repository gates require all declared full SHAs. | Inject the rejected/uncertain condition in this criterion; assert no accepted result or unauthorized state change. |
| mock and empty suite controls | Live-required criteria reject mocked receipts; skipped and partial results remain unsatisfied; zero tests is MISSING. | Inject the rejected/uncertain condition in this criterion; assert no accepted result or unauthorized state change. |
| freshness boundaries | At max_age_seconds boundary evidence becomes STALE; changed policy hash forces reevaluation; a fixed UTC clock makes results reproducible. | Inject the rejected/uncertain condition in this criterion; assert no accepted result or unauthorized state change. |
| negative control and report reconciliation | Report every mandatory requirement with status, source receipt, environment and reason; a planted mandatory failure changes exit 0 to exit 1. | Inject the rejected/uncertain condition in this criterion; assert no accepted result or unauthorized state change. |
| adapter compatibility | Import versioned local receipt JSON and optional RunProof export through adapters; unsupported major versions fail without silently dropping fields. | Inject the rejected/uncertain condition in this criterion; assert no accepted result or unauthorized state change. |
| untrusted receipt isolation | Escape malicious report text; never execute receipt commands or fetch artifact URLs; filesystem traversal and symlink escapes are rejected. | Inject the rejected/uncertain condition in this criterion; assert no accepted result or unauthorized state change. |

### Fixtures and runners
Use deterministic UTC clocks, synthetic IDs and planted fake secrets. Default tests cannot access customer accounts. Unit tests cover decision rules and state boundaries. Integration tests exercise real persistence and adapters against controlled fixtures; browser tests exercise API-backed UI rather than route mocks. For a CLI, E2E invokes the packaged executable in a fresh temporary directory and checks exit codes plus report contents. Add a static-report browser smoke for escaping, readable tables and empty/error states.

Each service module requires meaningful normal, invalid and boundary cases; each API router requires success, authorization and conflict tests. Each implemented page receives an E2E smoke and render tests for loading, empty and failure. Target at least 90% branch/line coverage of new decision and service code, with exclusions documented. Coverage is supporting evidence, not a substitute for the matrix.

Live adapters need opt-in sandbox tests pinned to provider/version and sanitized evidence. If credentials or a supported provider are absent, mark BLOCKED; mock success does not satisfy a live criterion. A seeded mandatory failure must turn the release verdict red. QA reconciles planned behavior labels to real test IDs in the implementation PR.

The final receipt records every repository SHA, dirty-tree status, environment, command, exit code, run time, fixture version, artifact hashes, skipped tests and unresolved findings. Any required NOT RUN, PARTIAL or BLOCKED row prevents a claim that the matrix passed.


## 5c. Definition of Done

Reference the canonical **CLAUDE.md → Quality Gate Standard (ALL repos)** at implementation time; resolve its actual workspace path in the build handoff and follow the current local/swarm runner policy. Do not introduce a competing universal gate in this PRD.

Feature-specific release conditions: every numbered acceptance criterion has current evidence; live criteria have live sandbox receipts; independent review of the final tested revision has zero P0/P1; seeded negative controls fail as intended; documentation explains unknown/partial states. A forged trusted-runner receipt remains possible without attestation. MVP verifies consistency and declared provenance, not honesty of arbitrary test producers.

This document is a requirements draft, not an implementation or release receipt.

## 6. Technical Spec

### Proposed architecture

No database daemon, account or browser is required. Use Node.js LTS and TypeScript, content-addressed local files and an atomic report-directory rename. Support macOS and Linux. A static HTML report is the only UI.

#### ◇ Diagram — Architecture
*The core works independently; adapters are optional.*

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#0d1117','primaryColor':'#161b22','primaryBorderColor':'#00f0ff','primaryTextColor':'#e2e8f0','lineColor':'#94a3b8','fontFamily':'JetBrains Mono, monospace'}}}%%
graph LR
 subgraph Local["Self-hosted boundary"]
 A["Requirement manifest + test receipts + revision set"]:::hot
 B["Evidence verifier"]:::green
 C["Versioned evidence store"]:::hot
 D["Acceptance report"]:::green
 end
 E["Optional ecosystem adapter"]:::ext
 A ==> B
 B ==> C
 C ==> D
 D -.-> E

classDef hot fill:#0d1117,stroke:#00f0ff,stroke-width:2px,color:#e2e8f0;
classDef green fill:#0d1117,stroke:#10b981,stroke-width:1.5px,color:#e2e8f0;
classDef ext fill:#0d1117,stroke:#64748b,stroke-dasharray:4 3,color:#94a3b8;
linkStyle 0,1,2 stroke:#00f0ff,stroke-width:2px;
linkStyle 3 stroke:#64748b,stroke-width:1.5px;
```

> **THE POINT:** The core works independently; adapters are optional.

#### ◇ Diagram — Workflow
*Persist evidence at each boundary; unresolved outcomes remain visible.*

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#0d1117','primaryColor':'#161b22','primaryBorderColor':'#00f0ff','primaryTextColor':'#e2e8f0','lineColor':'#94a3b8','fontFamily':'JetBrains Mono, monospace'}}}%%
graph TD
 N0["Load manifest"]:::hot
 N1["Validate receipt schema and hashes"]:::hot
 N2["Exact revision and environment match?"]:::hot
 N3["Required evidence complete and fresh?"]:::hot
 N4["PASS report"]:::hot
 N5["Unsatisfied report"]:::hot
 N0 ==> N1
 N1 ==> N2
 N2 ==> N3
 N3 ==> N4
 N4 ==> N5

classDef hot fill:#0d1117,stroke:#00f0ff,stroke-width:2px,color:#e2e8f0;
classDef green fill:#0d1117,stroke:#10b981,stroke-width:1.5px,color:#e2e8f0;
classDef ext fill:#0d1117,stroke:#64748b,stroke-dasharray:4 3,color:#94a3b8;
linkStyle 0,1,2,3,4 stroke:#00f0ff,stroke-width:2px;
```

> **THE POINT:** Persist evidence at each boundary; unresolved outcomes remain visible.

#### ◇ Diagram — Acceptance decision
*Completion and acceptance are separate; uncertainty cannot become success.*

```mermaid
%%{init: {'theme':'base','themeVariables':{'background':'#0d1117','primaryColor':'#161b22','primaryBorderColor':'#00f0ff','primaryTextColor':'#e2e8f0','lineColor':'#94a3b8','fontFamily':'JetBrains Mono, monospace'}}}%%
graph TD
 A["Evaluate evidence"]:::hot
 B{"All required checks satisfied?"}:::hot
 C["Record accepted result"]:::green
 D["Record failed or unknown result"]:::ext
 E["Operator sees reasons and next step"]:::hot
 A ==> B
 B ==>|Yes| C
 B -->|No or uncertain| D
 D --> E

classDef hot fill:#0d1117,stroke:#00f0ff,stroke-width:2px,color:#e2e8f0;
classDef green fill:#0d1117,stroke:#10b981,stroke-width:1.5px,color:#e2e8f0;
classDef ext fill:#0d1117,stroke:#64748b,stroke-dasharray:4 3,color:#94a3b8;
linkStyle 0,1 stroke:#00f0ff,stroke-width:2px;
```

> **THE POINT:** Completion and acceptance are separate; uncertainty cannot become success.


### Data model

assessments(id UUID, manifest_hash TEXT, revisions JSON, policy_hash TEXT, evaluated_at UTC); requirements(id TEXT, severity ENUM, required_level ENUM, required_environment TEXT, max_age_seconds INT); receipts(id UUID, requirement_ids JSON, repository TEXT, commit_sha TEXT, runner_id TEXT, artifact_sha256 TEXT, environment TEXT, execution_kind ENUM[live,mocked,synthetic], result ENUM, finished_at UTC); decisions(requirement_id TEXT, status ENUM, reason_codes JSON, receipt_ids JSON)

Use schema_version on serialized documents, UUID primary IDs, UTC timestamps and content hashes over a documented canonical JSON encoding. Scope child references to their parent/workspace and enforce foreign keys. Index parent IDs, state and due timestamps. Append attempts and evidence; do not overwrite history to hide failures. Retain redacted evidence 90 days by default, configurable by operator; primary deletion completes within 24 hours and rotated backups expire within 30 days. The production operator must approve these defaults before customer data ingestion.

### Interface contract

`proofgate evaluate --manifest requirements.yaml --receipts receipts/ --revisions revisions.json --output report/` returns exit 0 only when every mandatory requirement passes; exit 1 means unsatisfied policy; exit 2 means malformed input or internal error. `proofgate explain AC-7 --report report.json` prints receipt IDs and reason codes. JSON schema version 1 is shared by CLI and report; no HTTP server in MVP.

HTTP routes use the `/api/v1` prefix throughout, including abbreviated routes above. Errors are `{error:{code,message,request_id}}`: 400 malformed input, 401 unauthenticated, 403 forbidden action, 404 inaccessible object, 409 version/idempotency conflict, 413 oversize payload, 422 schema/policy rejection, 429 rate limit, 503 dependency unavailable. Lists cap at 100 entries with cursor pagination. Request and response schemas ship in the repository.

For daemon products, local admin bootstrap uses a CLI and no default password. Sessions are revocable HttpOnly cookies with CSRF protection; authorization applies to every query, worker job and download. Admin manages policies/connectors, operator performs scoped workflows, viewer reads redacted reports. Secrets are encrypted using an operator-managed key outside the database. CLI products trust the local OS user; they expose no listening port or multi-user authorization promise. Evidence directories default to owner-only permissions.

Mutation Idempotency-Key scope is workspace + actor + route; same key/body returns the same receipt, changed body returns 409. Retain keys at least seven days. Version-sensitive operations require expected_version or plan_hash. Database leases use bounded claims and transactional outbox events. Read-only checks can retry three times with exponential backoff; remote write ambiguity follows the stricter product state machine and never uses blind retry.

### State and uncertainty contract

A requirement resolves to PASS, FAIL, STALE, MISSING, PARTIAL or DEFERRED. DEFERRED is visible and never satisfies a mandatory gate. PASS requires matching repository, full SHA, artifact hash, required environment, test level and age at evaluation time. New revision or policy hashes require a new assessment; historical reports are immutable.

### Ecosystem adapter boundary

Optional RunProof receipt importer; Mission Control consumes a sanitized report reference and status. ScopeGuard may supply approved requirements. No connector writes back in MVP.

Adapters use a versioned envelope `{schema_version:1,event_id,source,resource_id,event_type,occurred_at,revision,evidence_ref}` with optional correlation_id. Deduplicate event_id at consumers, reject unsupported major versions and preserve ordering/version metadata. Delivery is at least once; consumers do not infer current state from an old event. Connections are optional and disabled by default. Export bundles work without network connectivity.

### Security and resource limits
Do not execute commands from imported receipts, arbitrary URLs or model text. Validate paths, symlinks, archive expansion limits and allowed content types; report text is HTML-escaped. Outbound endpoints are configured by administrators and checked against an allowlist including redirects and DNS resolution. No private addresses, secrets or real customer identifiers appear in public examples. Use `localhost` in user-facing demo instructions; document binding semantics explicitly. Logs redact credentials, personal fields and authorization headers. HandoffCheck's explicitly supplied execution scripts are the sole execution exception and run only within its isolated VM contract.

Default import limit is 25 MB metadata and 1,000 files; blob bundle cap 250 MB with explicit override. Fail before work when capacity is insufficient. Benchmark the deterministic core on 2 CPU/4 GB: 1,000 records should finish within 30 seconds excluding provider I/O and VM setup; record this as a performance experiment before fixing an external SLA. Expose queued, running, failed and unknown status with actionable reasons.

### Deployment, rollback and dependencies
Pin supported runtime/package versions during implementation and verify adapter behavior against primary provider documentation. No provider support is implied by this draft. CLI tools distribute a versioned package plus checksums; daemon products provide Compose, database migrations and example configuration with placeholders. Runtime telemetry is off by default.

Before an upgrade, stop side-effect workers, back up metadata and encrypted evidence, and test restoration in an isolated environment. Prefer expand/contract migrations; rollback uses a verified snapshot where schema downgrade is unsafe. Reconcile external outcomes before enabling writes after restore. A restored local database cannot undo remote effects. Stage rollout: synthetic local prototype → read-only sandbox → scoped approved live sandbox → independent acceptance → owner-selected public release.


## 7. Agent Team Plan

| Owner | Exclusive files | Deliverable |
| --- | --- | --- |
| Core / backend | src/cli.ts; src/evaluate.ts; src/receipt.ts; schemas/manifest.json; schemas/receipt.json; migrations/001_initial.sql for daemon products | Schemas, state machine, interfaces and adapter contracts |
| UI / report | src/web/App.tsx; src/web/Report.tsx; src/web/styles.css; templates/report.html | Daemon screens or static CLI report as appropriate; no backend edits |
| QA / packaging | tests/proofgate.spec.ts; tests/e2e/smoke.spec.ts; fixtures/demo.json; scripts/verify-quality.sh; README.md; Dockerfile | Evidence matrix, negative controls, packaging and operator runbook |


Future dispatch only. No implementation agents are started by PRD authoring. Backend freezes schemas first; UI consumes them and proposes changes through the backend owner. QA reports implementation defects to the owning agent instead of editing overlapping files. Coordinator resolves shared configuration and reviews final integration.

Milestones: (1) validate pain and unresolved provider capability; (2) schemas and deterministic core with failure states; (3) synthetic end-to-end demonstration; (4) selected connector sandbox and fault injection where applicable; (5) independent review/QA on exact revisions; (6) operator-approved public release. Stop at a provider capability blocker rather than weakening safety criteria.


## 8. Open Questions

- **HIGH — Provider / runner:** Choose trusted receipt producers and signing policy for the pilot; decide whether branch-protection integration belongs after MVP.
- **HIGH — Publication:** choose license, verify working name availability, maintainer and release support commitment. No license is selected by this draft.
- **HIGH — Data policy:** approve retention and connector scope before using real records.
- **STRATEGIC — Demand:** verify recurring pain and the decision to pay for hosted operation; stars and downloads do not establish value.

**Risk:** A forged trusted-runner receipt remains possible without attestation. MVP verifies consistency and declared provenance, not honesty of arbitrary test producers.

Architecture choices are proposed defaults for autonomous drafting; no topology approval or implementation authorization is inferred.

## 9. Operator Action Checklist

**SEC · 01b — Operator prerequisites**

| Action | Exact task | Unblocks | Where | Cost |
| --- | --- | --- | --- | --- |
| Validate problem | Interview three target operators and record five recent failure examples before expanding MVP. | Pilot evidence | [ProofGate open questions](proofgate.md#8-open-questions) | No vendor cost; operator time |
| Select connector/runner | Choose trusted receipt producers and signing policy for the pilot; decide whether branch-protection integration belongs after MVP. | Live pilot readiness | [ProofGate open questions](proofgate.md#8-open-questions) | Provider/VM cost unpriced; no spending authorized |
| Run independent drill | Have a non-builder run the documented synthetic smoke; record identity, timing and help received. | Acceptance evidence | [ProofGate open questions](proofgate.md#8-open-questions) | Operator time |
| Prepare public release | Choose license, maintainer, repository name, security contact and supported-version policy. | Publication | [ProofGate open questions](proofgate.md#8-open-questions) | Hosting optional; budget decision pending |
| Set retention and access | Approve data retention, backup recovery and who may administer integrations. | Real data processing | [ProofGate open questions](proofgate.md#8-open-questions) | Operator time |

Checks in the HTML persist locally and are operator notes, not evidence that external work was completed.

## Build handoff

After resolving build-blocking questions and selecting this product:

```text
/feature-team docs/prd/proofgate.md
```
