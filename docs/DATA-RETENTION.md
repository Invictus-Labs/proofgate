# Data retention (defaults awaiting operator approval)

These are the PRD's proposed defaults. **ProofGate does not enforce them.** It has no daemon, no scheduler and no
database; it writes files where the operator tells it to. Retention is an operator procedure until a real deployment
approves it.

| Item | Proposed default | Who enforces it |
| --- | --- | --- |
| Redacted evidence (receipts, reports, bundles) | retained 90 days, configurable by the operator | operator (delete the report directories and bundles) |
| Primary deletion after a deletion request | completes within 24 hours | operator |
| Rotated backups | expire within 30 days | operator |

Operator checklist before ingesting real customer data:

1. Approve or change the three defaults above in writing.
2. Decide where report directories and bundles live (they are owner-only, mode 0700/0600) and who may read them.
3. Remember redaction covers documents, not artifact bytes: artifacts are stored exactly as received, so treat them as
   customer data and apply the same retention.
4. Historical reports are immutable by design (`--replace` archives, never deletes); deletion is an explicit operator
   action on the archived directories.

Nothing here has been approved by a production operator; the defaults are documentation only.
