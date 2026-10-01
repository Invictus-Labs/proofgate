# Lessons - proofgate

Running log of mistakes, root causes and rules. Updated after every correction.

## Template

### [Date] - [Category]
**Mistake:** what went wrong
**Root cause:** why it happened
**Rule:** what to do differently

### 2026-09-29 - Filesystem
**Mistake:** `ensurePrivateDir` originally ran `chmod 0700` on the parent of every output path, which would have silently changed the permissions of a user's working directory for `--output ./x`.
**Root cause:** "owner-only output" was implemented by tightening whatever directory the call touched.
**Rule:** only tighten directories this process created (`mkdir` recursive returns the first created path); never change permissions of pre-existing directories.

### 2026-09-29 - Testing
**Mistake:** the first mutation control for the bundle truncation check survived (the mutated code still reported truncation with the same error code).
**Root cause:** later checks made the up-front check observably redundant; the test asserted only the error code.
**Rule:** when a check exists to "fail before doing work", assert the absence of side effects (no directory created), not just the error.

### 2026-09-29 - Public hygiene
**Mistake:** literal UUIDs in fixtures and tests are a hard block for `sanitize-content --scope public`.
**Root cause:** the scanner treats any raw UUID as a possible leaked internal ID; a UUID-only `receipt_id` would have forced every demo fixture to contain one.
**Rule:** receipt ids are opaque tokens (UUIDs still allowed); generate UUIDs at runtime in tests instead of writing literals; assemble planted fake secrets from fragments so `sec-scan` does not flag test data.
