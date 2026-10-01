# Security policy

## Status

ProofGate is a pre-release MVP (`0.1.0`). The repository is public under the MIT license; the owner has not yet designated
a security contact or a supported-version policy (both are open items in the product requirements). Until then:

- **Supported versions:** none are formally supported; only the latest commit on the default branch receives fixes.
- **Reporting a vulnerability:** use the repository host's *private* vulnerability reporting feature (a private security
  advisory) if it is enabled. If it is not, open a public issue that says only "security contact requested" and contains
  **no details**; a maintainer will move the conversation to a private channel. Do not post exploit details, sample
  secrets or real receipts in public issues.
- Please give the maintainer a reasonable time to respond before any public disclosure.

## What ProofGate protects, and what it does not

ProofGate treats every receipt, manifest, artifact and bundle as **untrusted data**:

- It never executes a command recorded in a receipt, never fetches an artifact URL, and never spawns a process.
- Artifact paths are relative to the receipts directory; absolute paths, `..`, backslashes and every symlink are refused.
- Size and entry-count limits (25 MB of metadata, 4 MiB and 150,000 nodes for the YAML manifest, 1,000 entries, 250 MB of
  artifact bytes) are enforced before parsing; anchors and aliases in YAML are refused; a JSON document that repeats a key is
  refused instead of letting the last value win.
- Report text is HTML-escaped; the static report contains no script and makes no request, and pins a strict
  Content-Security-Policy. Text printed to a terminal shows control characters, bidi overrides and newlines as `[U+XXXX]`, so a
  receipt cannot inject terminal escape sequences or forge a `verdict:` line.
- Secrets are redacted from documents, reports, bundles and error output (object keys and receipt file names included);
  report, bundle and restore output is owner-only. **Redaction is best effort**: it knows the credential shapes and
  credential-named fields listed in `docs/INTERFACES.md` and cannot recognise an arbitrary secret; opaque artifact bytes are
  never rewritten (`bundle export` refuses credential-shaped artifacts unless overridden). It is limited to key names and known
  token shapes: a bare hex key, an unlabelled base64 value or a password in free text (for example in a receipt's `command`)
  is **not** redacted, nor is personal data other than e-mail addresses (names, telephone numbers, addresses, IP addresses, host names),
  so never put secrets or personal data in receipts, artifacts or manifests. A token glued to the letters or digits in front of a short-prefix
  shape (`sk-`, `key-`, `Bearer`) is not found either (the exact boundaries are in `docs/INTERFACES.md`). A value that follows a credential name is
  redacted whole, whatever its length. The artifact scan reads each file as written, as UTF-8 with zero-width characters
  removed and fullwidth letters folded, and as UTF-16, and reads percent-encoded separators (`password%3Dx`) up to three levels
  deep; it does **not** decode base64 or hex and cannot look inside compressed or encrypted files, so a credential hidden that way
  is not found. The shapes that are not redacted are listed in `docs/INTERFACES.md` ("What it does not redact") and each is pinned by a
  test that expects it to stay unredacted: `->`, XML, a Dockerfile `ENV NAME value` line, a typed assignment, JSON-escaped or look-alike key names, `tool -p x`, a name/value pair
  written as YAML or TOML lines or with the spellings `{k, v}`, `{label, text}`, `{field, val}`, `{name, data}`, the ambiguous short names `otp`, `pin`, `salt` and `priv`, text keys longer than about 88 characters, control characters inside a keyword, separators in percent escapes nested more than three levels deep, a pair whose label is longer than 1,100 characters or spans lines, a pair whose value key is more than about 4 KiB from its name key, a password that holds a slash when no `@` follows within 512 characters of it, more than 64 blanks between a key and its value, a tab written as text around an equals sign, and a double-quoted value folded over several lines; also, each pinned in `tests/unit/redaction-security-round5.test.ts`, a credential keyword whose value is another credential's name with a blank before the separator, a chain of dangling labels, an empty quoted value with a word glued to its closing quote, a `#` line at column 0 that an indented line follows, a secret written with a hyphen and a credential word behind a delimiter, the host of `//Authorization:x@host`, and a long single-dash option name glued to noise (`-passD: S`). The complete list, with the reason for each, is in `docs/INTERFACES.md`; where the two differ, that one governs. Whether any of these should be covered is an open decision for the owner. The bundle fields that are
  masked from the re-evaluation comparison (producer version, input summary, `supersedes`, `clock_source`, the report's `engine.version`) are not cross-checked either: a bundle has no signature, so a bundle rewritten consistently verifies.
- The redactor is compared with its earlier versions by generated strings (`docs/qa/review-round1-ledger.md`, "Third pass"): the comparator that decides is the version that the last independent security review reviewed (an earlier statement in these documents named a later version by that label, and is corrected there). Anything that version hid and this one shows is fixed or listed with a pinned string in `docs/INTERFACES.md`; nothing here says that no string leaks.
- Further shapes that are not redacted (each pinned in `tests/unit/redaction-security-round5.test.ts` or `tests/unit/redaction-known-limits-final.test.ts`; the full list is in `docs/INTERFACES.md`): a secret that ends in a credential's name and a colon (`-pS...apikey:`), chains of dangling labels and a bracket that holds a label, a name-like padded key with a credential word in camel case that a delimiter and glued content follow (`--token KEY==,password=S` keeps the key body readable; 2 of 5,000 letters-only 22-character keys, 0 of 22 cells of realistic key kinds; an open owner decision), a `-u` or `--user` user that ends in a colon with the value on the next line (`curl -u admin:\nS`), a block header with a `#` glued to it (`apikey:|#`), `password:e\nn=S` (the secret is the value of another name), a password with a literal `\n`, `\r` or `%0d` in front of a `name=`, a blank inside an element of a JSON array, and a value that starts with `>` or `:` right after `=` followed by `;name=`. Whether any of these should be covered is an open decision for the owner. A check with 100,000 random printable passwords (no backslash or percent sign) in `password=`, `password:`, YAML and `--password` forms left 2,145 readable at this tree (3,706 at the reviewed round-5 tree, 2,199 at the round-6 tree that was reviewed): what remains are passwords that hold `;name=` or `,name=` (a connection string is split there by design) and a value that starts with `>` or `:` right after `=`; this is a documented limit, not a waiver. A password that contains a quote ends an unquoted value at the quote; in that uniform printable-password test almost all of the leaks contain a quote. A glued `-p` with a quoted value (`-p'S'`) and the dotted usage counters (`total.tokens` is hidden in text and kept as an object key) are listed in `tests/unit/redaction-known-limits-final.test.ts` too. A password that holds a line break written as text, or another end of a value, followed by a `name=` shape shows the tail behind it (3 of 120,000 random printable passwords in eight contexts, where 847 more were hidden than before; the three rows are pinned in `tests/unit/redaction-known-limits-final.test.ts`); AC-09 stays PARTIAL.
- Regular expressions are audited for backtracking blow-up: `scripts/regex-audit.mjs` (run by `tests/unit/regex-static-audit.test.ts`) flags a quantified group that holds an unbounded quantifier and an unbounded run in front of `$`, each expression left flagged stands on an allow-list with its reason, and the termination tests feed hostile runs of backslashes and escapes to the redactor in a child process with a hard cap. A string that a receipt holds can still make the redactor slow in a shape that none of them has tried; the bound is measured, not proven.
- Hard links are not detected: an artifact path that is a second name for a file outside the receipts tree is read like any other file. The receipts tree is
  the operator's own directory, and ProofGate refuses symbolic links, FIFOs and paths that leave the tree, but it does not compare link counts.
- Resource bounds that hostile input cannot exceed: the time of redaction was measured to grow about linearly in the text for the shapes that the tests cover (a scaling test at 1, 2
  and 3.5 MiB, a test of every credential opener followed by a run of backslashes or of escaped breaks); no claim is made for a shape that was not measured, and a per-call work budget hides the whole text when a scan passes it, whatever the shape; a string or key over 4 MiB is redacted whole without being examined; text whose Unicode-folded form would be over 32 Mi characters is redacted whole rather than expanded; a JSON
  document with more than 500,000 objects and arrays, or more than 1,500,000 values in all, is refused before it is parsed
  (`limit_json_containers`, `limit_json_values`).
- The receipts tree is strict: every file in it must be a receipt (`*.receipt.json`), an artifact that a receipt names, or one of
  the documented note names (`README`, `README.md`, `README.txt`, `.gitkeep`, `.DS_Store`); anything else is refused
  (`receipt_unreferenced_file`), so failing evidence cannot be left out of the gate by a slip of the name or the extension.
- The repository's `sec-scan` and hygiene-scan runs are not evidence that no secret exists: an independent audit reported that `sec-scan` did not flag a planted
  token, and `scripts/hygiene-scan.mjs` only knows the shapes listed in its header.
- The deterministic core opens no network connection and sends no telemetry.

ProofGate does **not** prove that the party that produced a receipt was honest. The MVP verifies consistency and declared
provenance only: a forged receipt from a trusted runner is possible without attestation. Do not treat an `ACCEPTED`
report as more than "the supplied evidence is fresh, complete and consistent with the declared policy and revisions".
The local operating-system user is trusted; the receipts directory must not be modified by another party during a run.

## Scope for reports

In scope: any way to make an unsatisfied policy exit 0, to make malformed or tampered input produce a report, to execute
code or fetch a URL from receipt content, to escape the receipts directory, to inject markup or script into the static
report, to leak a planted secret, or to leave partial state after a rejected bundle or report.

Out of scope: forged receipts from an otherwise valid runner (a known, documented limit), and attacks that require write
access to your receipts directory during a run.
