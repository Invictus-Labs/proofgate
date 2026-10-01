# ProofGate interfaces (version 1, frozen for the MVP)

ProofGate is a CLI (`proofgate`) plus a small library (`src/index.ts`). There is no daemon, database, HTTP server,
account or telemetry. The evaluation core performs **no network access at all**; tests prove this with the network
primitives stubbed out and, on macOS, inside an OS-level network-deny sandbox.

## Commands

```
proofgate evaluate --manifest <requirements.yaml> --receipts <dir> --revisions <revisions.json>
                   [--output <report-dir>] [--replace] [--now <UTC ISO time>] [--max-blob-bytes <n>] [--json]
proofgate explain <REQ-ID> --report <report.json | report-dir> [--json]
proofgate bundle export --report <report-dir> --manifest <file> --receipts <dir> --revisions <file>
                        --output <bundle-file> [--max-blob-bytes <n>] [--allow-secret-artifacts]
proofgate bundle verify <bundle-file> [--max-blob-bytes <n>]
proofgate bundle restore <bundle-file> --output <dir> [--max-blob-bytes <n>]
proofgate connector <name> <operation>     # live connectors are not implemented: always exit 2 connector_disconnected
proofgate --version | --help
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | `evaluate`: every mandatory requirement is PASS. Other commands: success. |
| `1` | `evaluate` only: the policy is unsatisfied (at least one mandatory requirement is not PASS). A report is written. |
| `2` | Malformed input, integrity failure, usage error or internal error. **No report, bundle or restored tree is produced**; stderr carries `proofgate: error [<code>]: <message>` with a stable `<code>` from the table below. |

Errors are redacted before printing (see Security) and never include absolute paths of the operator's machine unless
the operator typed them.

`--output` is optional. **Without it `evaluate` writes no report at all**: it prints the summary (or, with `--json`, the report
as JSON) and says so on stderr (`no --output was given, so no report was written`). Add `--output <dir>` to keep
`report.json`, `report.sha256` and `index.html`.

### Clock

The evaluation instant is `--now <UTC ISO>` if given, else the `PROOFGATE_NOW` environment variable, else the system
clock. With a fixed clock every hash, id and report byte is reproducible. `--now` must be strict UTC
(`2026-09-29T00:00:00Z`); anything else, **including an empty value**, is `clock_invalid` (there is no silent fallback to the
system clock; the same holds for a `PROOFGATE_NOW` that is set but empty). The report records where the instant came from in
`clock_source` (`flag`, `env` or `system`), and when the clock is fixed `evaluate` prints a `proofgate: note: ...` line
on stderr, because a frozen clock judges the evidence against a time that is not "now" (fresh evidence can look stale
later, stale evidence can look fresh earlier). Bundle re-evaluation ignores `clock_source`. The same inputs with the same clock mechanism give byte-identical reports; `--now` and `PROOFGATE_NOW` with the same instant differ only in `clock_source` (and so in `report.sha256`).

### Output directory

`--output <dir>` writes `report.json`, `report.sha256` and `index.html` into a temporary sibling directory and
**renames** it into place, so a reader never sees a partial report. Directories are mode 0700, files 0600. An existing
output is an error (`output_exists`). `--replace` without `--output` is a usage error (`cli_usage`): it only means something for an
existing report directory. With `--replace` the previous report directory (it must contain a `report.json`,
otherwise nothing is moved and `output_exists` is raised) is **moved, never deleted**, to
`<output>.superseded-<previous assessment id>` (a `-2`, `-3`, ... suffix is added if that name is taken, so repeated
replaces under a fixed clock never collide) and the new report records `supersedes` (the prior assessment, and whether the
policy hash changed). Historical reports are therefore immutable, and a changed policy hash always yields a new
assessment: nothing is cached between runs. Before anything is rendered or written, a report whose `report.json` would
exceed the 25 MB metadata limit (the size `explain` and `bundle export` accept) is refused with `limit_metadata_bytes`:
the requirements x repositories fan-out must stay within it (about 80,000 requirement-repository pairs).
The output path must be separate from the inputs: an `--output` that is, contains or lies inside the receipts directory, the
manifest or the revisions file (spelled through a symlink or not, `.` included) is refused with `output_overlaps_input`
before anything is read or moved, so `--replace` can never archive the operator's own evidence; an empty `--output` is a
usage error. Without `--output` nothing is written: the summary is printed and stderr says so.
If the process is interrupted by SIGINT or SIGTERM, temporary output that is still being written is removed
(exit status 130 or 143); a finished output is never touched.

### The static report page

`index.html` is rendered by the bundled report layer (`src/web/render.ts`) on every `evaluate --output`; it is part of
the program, not an optional hook. The renderer HTML-escapes every string in the report (`escapeHtml`); `report.json`
intentionally carries raw strings. (`dist/run.js`, where the command is implemented, is not part of the library surface and
refuses to start as a script; the frozen exports are the ones in `dist/index.js`.)

### Terminal output

Everything `proofgate` prints as plain text (`evaluate`, `explain`, error messages, bundle messages) shows control
characters, bidi overrides, zero-width characters and newlines found inside document strings as `[U+XXXX]` (see
`src/terminal.ts`), so a hostile receipt cannot inject terminal escape sequences or forge a line such as
`verdict: ACCEPTED (exit 0)`. `--json` output escapes the code points JSON leaves raw as `\uXXXX` (still valid JSON,
same value). Strings longer than 4,000 characters are cut with a visible marker in plain text.

## The decision contract

A requirement resolves to one of six statuses. Only PASS on every **mandatory** requirement gives exit 0.

| Status | Meaning |
| --- | --- |
| `PASS` | Every required repository has fresh, qualifying, fully passing evidence. |
| `FAIL` | Qualifying, fresh evidence contains a failure (or contradicts itself). |
| `STALE` | The only qualifying evidence is at or beyond `max_age_seconds`. **At exactly `max_age_seconds` the evidence is STALE.** |
| `MISSING` | No qualifying evidence exists, or only zero-test `pass` claims (a zero-test `fail` is FAIL and a zero-test `partial` or `skipped` is PARTIAL). |
| `PARTIAL` | Skipped/partial results, or only some of the declared repositories are covered. |
| `DEFERRED` | The manifest explicitly defers the requirement. Never satisfies a mandatory gate. `evidence_status` still shows what the evidence says. |

A receipt **qualifies** for a requirement and repository only if all of these hold (each failure is a reason code and the
receipt appears under `rejected_receipts`):

1. it lists the requirement id and its repository is one the requirement covers;
2. `commit_sha` equals the full SHA in the revision set for that repository (a receipt for commit A never satisfies
   commit B, whatever the branch names say);
3. `environment` equals `required_environment` (exact match: case-sensitive, no trimming, so `Staging` does not satisfy `staging`);
4. `test_level` is at least `required_level` (`unit < integration < e2e`);
5. `execution_kind` is in `allowed_execution_kinds` (default `[live]`);
6. it did not finish after the evaluation time.

**Future-dated receipts.** A receipt whose `finished_at` is after the evaluation time never counts as passing evidence
(`receipt_from_future`, listed under `rejected_receipts`). But if it matches on rules 1 to 5 and reports a failure or a
partial/skipped run, it is not ignored: it counts as FAIL or PARTIAL with `receipt_from_future` among the reason codes, so
clock skew can never let an older pass hide a newer failure. A future-dated receipt that would pass neither passes nor
blocks. (Fix the clock, or remove the receipt, to resolve it.)

Qualifying receipts are then classified: age `>= max_age_seconds` is STALE (checked first); any failed test or a `fail`
result is FAIL **even with zero tests** (a `pass` claim with failed tests is FAIL and adds `result_contradicts_counts`);
skipped tests, a `partial`/`skipped` result (also with zero tests), or `passed < total` is PARTIAL; zero tests with a
`pass` claim is MISSING (`zero_tests`); otherwise PASS.

Per repository, **all** fresh substantive receipts must pass: any FAIL wins (`conflicting_evidence` if a PASS exists
too), then PARTIAL, then PASS. Fresh evidence outranks stale evidence; a zero-test `pass` receipt is ignored beside
substantive evidence. The requirement-level reason list carries `all_criteria_met` only when the requirement is PASS. Across repositories: any FAIL is FAIL; all PASS is PASS; a mix of PASS with anything else is
PARTIAL (`incomplete_repository_coverage`); otherwise PARTIAL, STALE, MISSING in that order of precedence.

To retract a superseded failing receipt for the same revision, remove it from the receipts directory you feed in; the
receipts directory is the operator-curated evidence set.

This MVP verifies **consistency and declared provenance**, not the honesty of test producers: a forged receipt from a
trusted runner is possible without attestation.

## Path, symlink and resource rules

- Artifact paths are **relative to the receipts directory**, forward slashes only, at most 512 characters, no control
  characters. Rejected: absolute paths (`path_absolute`), `..` (`path_traversal`), URLs, backslashes, empty or `.`
  segments (`path_invalid`). Artifact URLs are never fetched.
- **Any symlink anywhere under the receipts directory is rejected** (`path_symlink_rejected`), not just ones that
  escape, as are FIFOs, sockets and devices (`path_not_regular_file`). Files are opened with `O_NOFOLLOW` and
  re-checked against their `lstat` identity. Trust model: the local OS user is trusted; the receipts directory must not
  be modified by another party while a run is in progress.
- **A symlinked root is followed.** The receipts directory (and the manifest and revisions paths) you name is resolved with
  `realpath` once, so `--receipts current -> /data/run-42/receipts` works; only links found *under* that directory are
  refused. Pass the real path if you do not want a link followed.
- Receipt documents are files named `*.receipt.json` (any depth, exact lowercase suffix). **The rule is strict**: every file
  in the receipts tree must be a receipt (`*.receipt.json`), a file that some receipt names as its artifact, or one of the
  documented note names (`README`, `README.md`, `README.txt`, `.gitkeep`, `.DS_Store`, at any depth; the CONTENT of a note is never
  read, so a receipt saved under one of those names is not evidence). Any other file is refused
  with `receipt_unreferenced_file` (exit 2), naming up to five of them, whatever it is called (`x.RECEIPT.JSON`,
  `x.receipt.json.bak`, `x.receipt.yaml`, `x.receipt.jso`, `fail.txt`, `x.json`, a file without an extension). Rename a file
  that is meant as evidence to end in `.receipt.json` so that it counts, or move it out of the receipts directory. What a
  receipt names as its artifact is read as an artifact whatever its type.
- Limits, all enforced **before** the content is parsed or hashed: 25 MB of metadata (manifest + revisions + receipt
  documents), 1,000 directory entries (bundle: 1,000 entries), 250 MB of artifact/blob bytes (bundle cap). The blob and
  bundle cap is raised only by the explicit `--max-blob-bytes <n>` flag.
- **The YAML manifest has a tighter limit than the 25 MB metadata limit**: at most **4 MiB** and at most **150,000 YAML
  nodes** (an upper estimate counting lines, list items, flow separators and openers, and `key:` colons, quoted or not),
  both checked before the YAML parser runs (`limit_manifest_size`). The parser needs about 1 KB of heap per node, and a few
  megabytes of `[` or `- 1` would otherwise exhaust a container's memory. 150,000 is about 2,250 requirements that each
  list 50 repositories, or all 5,000 requirements with up to 10 listed repositories each; requirements that omit
  `repositories` (all repositories) cost nothing extra. Larger policies are split into several manifests. Anchors and aliases
  (`&x`, `*x`) are refused outright. The limit was verified with the packaged CLI under `--max-old-space-size=256`.
  (The canonical `manifest.json` inside an evidence bundle is strict JSON, parsed without the YAML budget.) Duplicate keys in a
  mapping are found in one linear pass over the parsed tree (the parser's own check is quadratic: 40,000 keys took 10 s).
- **JSON documents have a container budget** of 500,000 objects and arrays each (`limit_json_containers`), counted in one
  linear pass before `JSON.parse` runs and applied to receipts, the revision set, reports and bundle headers. `JSON.parse`
  needs tens of bytes of heap per container however few bytes the text spends on it, so 3 million empty arrays (a 9 MB
  file) would otherwise exhaust a 256 MB heap. A report at the 25 MB metadata ceiling holds about 300,000 containers (the
  report of a 5,000-requirement, 5-repository manifest, 9.8 MB, holds 115,013), so a legitimate document does not come near it.
- **The budgets also cover all the receipt documents of one evaluation together**: 1,000,000 objects and arrays and 3,000,000 values
  in total (`limit_json_containers`, `limit_json_values`, naming the receipt at which the total was passed). Each document was
  bounded on its own, but eight receipts of 490,000 empty objects (12 MB) aborted V8 at a 256 MB heap; two receipts at the
  per-document limit are still accepted.
- **JSON documents also have a value budget** of 1,500,000 values (`limit_json_values`): every array element and object member
  counts one (a comma is one), and so does every container. A 6 MB array of one-digit numbers holds 3 million values, is
  smaller than any container count would suggest, and still exhausts a 256 MB heap in `JSON.parse`; the budget is checked in the
  same pass, before parsing, and covers the same documents as the container budget.

## Security properties

- Receipt `command` text and artifact paths are data: nothing is executed, no URL is fetched, no process is spawned.
- Secrets are redacted at load time (documents), on object key names, on receipt file names and bundle entry paths, on the
  report and on every error message. **Redaction is best effort**: it removes the shapes it knows and the values of
  credential-named properties, and it can neither recognise an arbitrary secret with no telltale shape or name nor promise
  never to redact harmless text that resembles one. Key-name based: any key with a segment such as `password`, `passwd`,
  `pwd`, `apikey` and `api_key`, `pass` (lowercase on its own; in any case inside a longer name such as `DB_PASS` or `dbPass`), `passphrase`,
  `secret(s)`, `token(s)` (not usage counters such as `tokens_used`), `api_key`, `auth`, `authorization`, `credential(s)`,
  `private_key`, `ssh_key`, `connection_string`, `cookie`, `session_id`, `access_key`, `account_key`, `shared_access_key`,
  `bearer`, `jwt`, `signature`, `passcode`, `signing_key`, `encryption_key`, `master_key`, `dsn` or `cookies`, and the
  concatenated spellings of those (`secretkey`, `tokenvalue`, `authkey`, `signingkey`, `encryptionKey`, `masterKey`) and
  `pass` or `pwd` glued to a word that says whose it is (`dbpass`, `userpass`, `adminpwd`, `userpwd`); key names are also tested in
  folded form, so `pass<zero-width>word` and fullwidth spellings count. A key is judged as written AND as redacted (a key such as
  `pass<token>` becomes `pass[REDACTED]` and would otherwise be judged differently by a second pass). Pattern based: cloud, VCS, chat, package-registry, payment and hosting tokens (AWS, GitHub, GitLab, npm,
  Slack, Stripe, SendGrid, Twilio keys and account SIDs, Mailgun, Shopify, DigitalOcean, Hugging Face, Google API keys and
  OAuth tokens, Azure storage `AccountKey` and shared-access-signature values), JWTs, bearer headers (a short token after a
  capital-B `Bearer` when it has a digit, any token of 16 or more characters), `Authorization` values of any scheme
  (Basic, Digest, Bearer, to the end of the line), URL credentials, webhook URLs (Slack, Discord, Teams), PEM and PGP
  private-key blocks of any length, `Cookie:` headers, `sig=` parameters, `name=value`, `name: value` and `"name": "value"`
  assignments, command-line flags such as `--password x` and `-pSECRET`, and e-mail addresses. **A value is redacted whole,
  whatever its length**: a quoted value ends at its closing quote (it may contain spaces), an `Authorization` value at the
  end of the line, and any other value at whitespace, a quote or a following `name=` pair (so `password=abc;def` is redacted
  through `;def`, while `Password=abc;Uid=svc` keeps `Uid=svc`; a value that holds such an end, for example a line break written as text, followed by a `name=` shape shows its tail: 3 of 120,000 random printable passwords in eight contexts, against 847 that an earlier redactor showed and this one hides; the three rows are pinned in `tests/unit/redaction-known-limits-final.test.ts`, and nothing here claims that class closed; a password that contains a quote ends an unquoted value at the quote, and in a uniform printable-password test almost all of the leaks contain a quote; a glued `-p'S'` shows its value, and two more rows of the connection-string class are pinned in the same file). A `|`, `)`, `}`, `]`, `<`, `&` or `#`, a `<br>` tag, and a blank or delimiter written as text or as an escape (`\t`, `%20`, `%7C`, `%3E`, `%23`, `%3F`, `%2B`, `%21`) end an unquoted value only in front of a credential-named pair whose credential word is a whole segment of the name (`PASSWORD=x|AUTH_TOKEN=y`): a secret may hold `&x=` or `#y=`, and a secret glued to a name-like suffix (`Xy7token=`) is a secret, so a delimiter in front of any other name stays inside the value and one that starts the value is part of it. **Nesting**: a quoted value is delimited by arithmetic on the run
  of backslashes in front of its quotes, not by a table of depths. At nesting depth `k` (a JSON document inside a JSON string, `k`
  times) a quote carries `2^k - 1` backslashes; a run of `m` backslashes in front of a quote is `c * (r + 1) + r`, where `r` is
  the run in front of the value's OPENING quote, and an even `c` closes the value while an odd `c` is a quote inside it, so a
  credential that itself contains a quote is redacted whole at every depth. A run that fits neither reading is taken as part of the
  value: the value then runs to the end of its line, so more is redacted, never less. Runs of any length are read, in one pass with
  no cap. An escape that stands for a separator (`\n`, `\t`, `\r\n`, `%0A`, `%20`, `%09`, `\u000a`, at any nesting depth) ends the
  text in front of a name the way a real one does (`make test\npwd=S`), a YAML value on the next line is found after a line break
  written as text, `=>` (Ruby, PHP, `print_r`), `:=` (make, Go), `?=` and `+=` (make, shell) separate like `=`, and blanks around the
  `=` of a flag are skipped (`--password = S`). A `#` line under a credential key is judged against the KEY's indentation: a `#` line indented deeper than the key is the value (a password may start with `#`; it is
  redacted with the lines below it that are deeper than the key, and a real comment in that place is hidden with it), a `#` line at the key's column or to its left is a comment and stays readable; a list dash and a quote in front of the
  key count as indentation. A YAML block scalar under a credential key (`password: |`, `>-`, `|+`, `|2`, with
  or without a comment after the header) is redacted to the end of its indented block (blank lines belong to it; an unindented first
  line cannot be told from the next key, so the value then runs to the end of the text), and a value that starts with an anchor or a tag
  (`password: &a S`, `!!str S`, `!!str &a` and the value on the next line, `password: !Pass123`) is redacted from the anchor or tag to
  the end of the LINE (the anchor and the words behind it go with the value: a password may start with `!` or `&`), and when the anchor or
  tag ends its line and the next line is indented, that line too; a block scalar behind an anchor or tag (`password: !!str |`) is redacted as
  a block, and `password:&S` glued to the colon is a plain value. An option is read when its NAME is a credential name by the key-name rule (`--password`, `--db-password S` and `--db-password=S`, `--client-secret`, `--API_KEY`, `-Password`; `--token-count` and `--tokenizer` are not), quoted or not, with the same layer arithmetic as an assignment, so `--password \"S\"` inside strings inside strings and a value that holds an escaped quote are whole; a Python prefix (`b'S'`, `u"S"`) or a shell `$` (`$'S x'`) in front of an option's quote is part of its value; an unquoted option value that starts with `[`, `{` or `(` is read as a whole, one that starts with an anchor or a tag runs to the end of the line, and the value of an option whose name ends in `Authorization` (`--Authorization`, `--Proxy-Authorization`, `-userAuthorization`) runs to the end of the line, as an `Authorization` header does; a colon after an option (`--api_key :'S`) is an assignment separator, read by the assignment step; an option at the end of a line takes the next line's word (more is redacted, never less); `-u user:S` and `--user user:S` are read the same way (a bare `-u root` is a user name), and `-p=S` is read like `-pS`; an option that stands right after a line break written as text (`\n`, `\r`, `\t`, `%0A`, `%09`, `%0D`) is read like one after a real line break (`a=1\n--password S`). **User information** in a URL (`user:password` in front of the host after any scheme, the scheme-less `//user:password@host`, an empty user as in `redis://:password@host`) is redacted up to the last `@` before the first `/`, `?`, `#`, quote or blank (so an `@` inside the password is inside it), else up to the first `@`, else, when the text before the first `/` cannot be a port, up to the last `@` of the token within 512 characters (a password with a slash in it): more is redacted, never less. A Python string prefix (`b'S'`, `u'S'`, `r"S"`) and blank lines and comment lines between a key and its value (`password:`, an empty line, `# note`, then the value) are skipped, unless no indented line follows the `#` line: a value line that starts with `#`, `>#` or `|#` is then the value itself (a comment after a block header needs a blank in front of it). A credential-named parent key (`credentials:`, `auth:`) leaves its credential-named child to the child's own reader, whether that value stands on the next line, is a block scalar or a list. A value that starts with a bracket is a bracketed value when the bracket closes and stands alone; otherwise it is the bracket and the word behind it (`[S]tail`, `[]S` and `[a],tail` are passwords, not lists with text next to them). An unquoted scheme word (`Bearer`, `Basic`, `Digest`, `Negotiate`, `NTLM`, `OAuth`, `Splunk`, `Hawk`) takes the credential behind it (`token: Bearer S`). In a list, the element after `-u` or `--user` that holds a colon, and a number after a credential option, are values; `curl -uNAME:S` (glued) is read after its colon. A YAML block list under a credential key (`password:` and then `- S` lines; blank lines and comment lines between the items do not end it) and a bracketed list
  (`[a, b]`, `["a","b"]`, also as text at any depth, also a flow list that continues on the next lines) are redacted item by item; a `{...}` or `(...)` value under a credential key (`{"secret": {"a": "S"}}`, `PASSWORDS=(a S)`) is redacted whole. A bracketed value that never closes ends at the end of its first line (at the end of the text when it has no line break), and the work of one such scan is bounded, so a hostile text costs one pass: more is redacted, never less. **Pairs and lists**: a name/value pair object
  (`{name, value}` as in Kubernetes, `{Name, Value}`, `{key, value}`, `{ParameterKey, ParameterValue}`,
  `{header: "Authorization", value}`), written as an object or as text at any depth (double quotes, or single quotes as in a
  Python repr), has its value redacted when the name is a credential name, in either order of the two keys and with other keys
  between them (`{"Name": ..., "Type": "SecureString", "Value": ...}`, `{"value": ..., "name": ...}`, `valueFrom` next to
  `value`). The value key is looked for within 4 KiB of the name key (a little more at deep nesting), a nested object between the two keys is stepped over, and an object boundary,
  found outside strings, ends the search, so the value of a neighbouring pair is not taken. The label may be any single line of up to 1,100 characters (`Admin password`, `user[password]`, `${DB_PASSWORD}`, a long SSM path), and the value may be a string, a number, an object or an array (an object or an array is redacted whole). A label that spans lines or is longer is not read as a name, and the value key is not looked for past the 4 KiB window (both are limits, listed below). A name may be path-shaped
  (`/prod/db/password`), and the name of a session cookie counts (`session`, `sid`, `PHPSESSID`, `connect.sid`,
  `laravel_session`). So has the element after a credential name in a list (`["--password", "S"]`, `[["password", "S"]]`,
  `["run", "--token", "S"]`). **Key names** are tested as a whole as well as by segment: with separators removed and the case
  folded, a key may not contain a credential word (`PGPASSWORD`), a connection URL or DSN name (`database_url`, `redis_url`,
  `mongodb_uri`, `jdbc_url`), `webhook` (`slack_webhook`, `webhook_url`) or a vendor name followed by `key` (`stripeKey`, `sendgridKey`). Short names (`pw`, `pswd`, `tls_key`, `privkey`, `id_rsa`, `storepass`) and digit-suffixed ones (`pass1`, `pwd1`) count; usage counters (`max_tokens`, `total_tokens`, `TOKEN_COUNT`, `pass_rate`; the whole name must be a counter) do not, while a name that only starts like one (`TOKEN_PERSONAL`, `TOKEN_MAX_SECRET`, `token_used_password`) is a credential name. **Percent-encoded separators**: text that holds a percent escape of a separator (`%3D`, `%3A`, `%22`, `%27`,
  `%40`, `%20`, `%2F`, `%26`, `%3B`, `%2C`, `%5C`, `%5F`, `%2D`, `%2E`, `%3E`, `%7C`, `%23`, `%3F`, `%2B`, `%21`, braces, brackets, line breaks) is also examined with those escapes decoded, up to
  three levels (`%253D` is one level deeper than `%3D`); when the decoded copy shows a credential, the decoded and redacted copy
  is what is returned, and text that names no credential keeps its escapes. The artifact scan reads the same way.
  **Where a token may sit**: a token with a distinctive prefix
  (`ghp_` and the other GitHub prefixes, `github_pat_`, `glpat-`, `npm_`, `xox?-`, `sk-ant-`, `SG.`, `hf_`, `AIza`, `ya29.`,
  `sk_live_`/`rk_test_`, `AKIA`/`ASIA`, DigitalOcean and Shopify) is found wherever it stands, including glued to a letter, a
  digit, an underscore or an escape that stands for a line break (a literal `\n`, `\t`, `\r\n`, `%0A`, `%20`, `\u000a`,
  `\x0a`). The short prefixes `sk-`, `key-`, `SK`, `AC` and a capital-B `Bearer` occur inside ordinary words, so they keep a
  boundary: after a letter or digit (`xsk-...`, `wordBearer ...`) they are **not** redacted. An AWS key id must not be followed by
  a letter or digit either (`AKIA...EXAMPLEx` is not redacted). `sk-` and `Bearer` after a separator, an underscore or one
  of the escapes above are found. Text that hides a token with zero-width characters or fullwidth letters is folded first (a
  string that contained a credential is then returned in folded form; text whose folded form would exceed 32 Mi characters
  cannot be examined and is replaced by `[REDACTED]` as a whole, which is what stops one character that normalises to 18 from
  exhausting memory). A string, and an object key, longer than 4 MiB is replaced by `[REDACTED]` as a whole without being
  examined: its cost and memory then do not depend on how many matches it holds. Redaction is applied until the text stops
  changing (at most six rounds; text that does not settle is replaced whole), so redacting a redacted document changes
  nothing: a bundle is restored by redacting the receipts again and comparing. Its cost was measured to grow about linearly in the text for the shapes that the tests cover (every opener of a credential followed by a run of backslashes or of escaped breaks, and the hostile-input matrix below); no claim is made for a shape that was not measured, and a per-call work budget hides the whole text when it is passed, whatever the shape: no
  pattern nests an unbounded quantifier in another, the shapes that would rescan a long run from every start are found by
  scanners that resume after what they consumed, and every scan works on its own copy of its patterns (judging a name redacts it, which runs the same scanner again; a pattern shared between the two calls lost its position and the pair scan once never ended on `{"key":"value"}`, so a static test refuses any shared global or sticky pattern and a child-process test with a hard cap runs every such string as an assertion), and a hostile-input matrix
  (`tests/unit/round3-redaction-scaling.test.ts`: every pattern shape at 1, 2 and 3.5 MiB, growth bound 7 for 3.5 times the
  input) checks the scaling rather than asserting it. **Identifiers are refused, not redacted**: a receipt's `receipt_id`,
  `requirement_ids`, `repository`, `environment` (and the same fields under a RunProof `binding`), and a manifest's
  repository ids, requirement ids, `required_environment` and per-requirement `repositories`, are compared against each other,
  and two different values that both look like a credential would redact to the same text and match. A document in which
  redaction would rewrite one of those fields is refused (`receipt_schema_invalid` or `manifest_schema_invalid`, naming the
  field). Receipt files whose NAME looks like a credential are recorded under `redacted-<16 hex>.receipt.json`, derived from the
  content hash, so two such names never collapse into one entry and the credential never becomes an entry name. Opaque artifact bytes are never rewritten; `bundle export` scans them, as written, as
  UTF-8 with zero-width characters removed and fullwidth letters folded, and as UTF-16 text (either byte order and
  alignment), and refuses credential-shaped ones unless overridden. Only the distinctive token shapes (prefixed tokens, JWTs, private-key blocks, webhook URLs) are looked for in a window that is mostly binary (under 85% printable characters); assignments, options, user information, signatures, cookies and pairs are looked for in text windows only, so a compressed or random file is not refused.
  **What it does not redact**: personal data other than e-mail addresses (names, telephone numbers, postal addresses, IP
  addresses, host names, user names); a value after `->`; XML (`<password>x</password>`, `<add key="password" value="x"/>`); a Dockerfile `ENV PASSWORD x` line
  (a space, no equals sign); a typed assignment (`password: string = "x"`); a key name written with a
  JSON escape (`pass\u0077ord`) or with look-alike letters from another alphabet; a single-letter option whose value follows after a space (`tool -p x`;
  `-pSECRET`, `-p=SECRET` and `--password x` are covered); the value of a name/value pair object with other key spellings
  (`{k, v}`, `{label, text}`, `{field, val}`, `{name, data}`; the spellings `name`, `key`, `header`, `variable`, `parameter_name`
  with `value` and `parameter_value` are covered); a pair whose label is longer than 1,100 characters or spans lines, and a pair whose value key is more than about 4 KiB from the name key; a password that holds a slash when no `@` follows within 512 characters of that slash; more than 64 blanks between a key and its value; a tab written as text (`\t`) around an equals sign; a double-quoted value folded over several lines; single short key names that are ambiguous or carry no credential word (`otp`, `pin`, `salt`, a bare `priv`, `bearerx`; the segment and whole-key rules cover the rest); a text key longer than about 88 characters (the name is read for 80 characters around its keyword; a key in an object is read whole); a control character (a backspace, NUL) or a no-break space inside a keyword or a token; a single-quoted Python string with an escaped quote inside JSON text (`\'` at nesting depth 1 or more); a separator
  encoded in percent escapes more than three levels deep (`password%2525253Dx`); a name/value pair written as YAML or TOML lines
  (`name: DB_PASSWORD` on one line and `value: x` on the next), of which only the credential key form (`DB_PASSWORD: x`) is read;
  credential names that none of the lists above recognise (compound names outside the spellings listed); a zero-width-hidden JWT whose segment is longer than 16 KiB and straddles a 1 MiB artifact-scan
  window (the windows overlap by 16 KiB); a short-prefix token or an AWS key id in the boundary cases above; a secret with neither
  a known shape nor a credential-named key or keyword next to it. A bare 32-character hex key, a password written as free text in a receipt's `command` ("login with hunter2") or an
  unlabelled base64 blob are left as they are, and the artifact scan does not decode base64 or hex or look
  inside compressed or encrypted data. Every shape in this list is pinned by a test that expects it to stay unredacted
  (`tests/unit/redaction-fix5.test.ts`), so the list and the behaviour cannot drift apart; whether any of them should be covered
  is an open decision for the owner, not something a reviewer's opinion settles. **Also not redacted, each one pinned in the same file**: a
  value of several words after a credential key (`password: correct S battery`, `PASSWORD=alpha bravo S`: an unquoted value ends at its first
  blank; a quoted value, a bracket, brace or parenthesis value and a value that starts with an anchor or a tag are read whole); a plain YAML
  scalar continued on the next line; a nested block sequence (`password:` then `- - S`); a YAML single quote written twice inside the value
  (`'it''s S'`); a YAML complex key (`? password` then `: S`); a triple-quoted string; adjacent string literals; blanks escaped with a backslash
  and a line continuation after the equals sign; command lines that name the credential in one word and give it in another
  (`--name /prod/db/password --value S`, `tool --name DB_PASSWORD --value S`, `gh secret set NAME --body S`, `aws configure set NAME S`,
  `git config user.password S`, `npm config set _authToken S`, `setenv PASSWORD S`, `-P S`, `-P=S`, `redis-cli -a S`, `mongosh -p S`); Python
  pairs written as tuples (`("password", "S")`, `[('password', 'S')]`, `dict_items`); a separator or a key letter written as `\u003d`, `\x3d`,
  `%77`, `&#61;`, `&#x3D;` or `&quot;`, and a JSON key with its colon on another line; names that the object-key rule knows and the text rule
  does not (`mnemonic`, `seed_phrase`, `unseal_key`, `recovery_code`, `pin_code`, `key_data`, `client-key-data`, `subscription_key`,
  `Ocp-Apim-Subscription-Key`, `kek`, `hmac`, `wallet_key`, `passw`, `pword`, `cred`, `creds`, `Pass`, `bearerx`, and a `sha256=` hub signature);
  session cookie names as text (`sid=S`, `session=S`, `PHPSESSID=S`, `connect.sid=S`, `curl -b "sid=S"`: they are credential names in pairs
  and lists only); HTML `<input name="password" value="S">` and SQL (`IDENTIFIED BY 'S'`, `ALTER USER u PASSWORD 'S'`); a no-break space or a
  Braille blank (U+2800) inside a keyword. **Also not redacted, or redacted less than an older release did by accident, each one pinned in
  `tests/unit/redaction-security-round5.test.ts` or `tests/unit/redaction-known-limits-final.test.ts`**: a credential keyword whose value is another credential's name with a blank in front of the
  separator (`Bearer:auth =S`, `-uc:token =S`) and a chain of dangling labels (`password:= Authorization:a S`); an empty or label-like quoted value
  with a word glued to its closing quote (`Authorization=>""S`, `credential:=" apikey:"S`); a `#` line at column 0 that an indented line
  follows (YAML reads it as a comment and the indented line as the value); a secret written with a hyphen and a credential word behind a
  delimiter (`|#S-credential=`); an option named `Authorization` followed by a hyphen and a qualifier (`-Authorization-e=a S`, which must stay
  as narrow as `--authorization-mode=Node,RBAC`); a keyword that ends in `Authorization` with a block header at the end of its line; the
  host of `//Authorization:x@host`; a credential word followed by its value with no separator (`api_key S`); a `/` is not a delimiter (base64
  secrets hold it); a glued `-p` followed by percent-escape soup (`-p%pwd= S`; a credential option's name that a colon or a percent escape follows, `-passD: S`, `-password%20'S'`, is read by the option reader, after any lead, and the plain `-password: S`, `-pass: S`, `-pwd=S`, `-password="S"` and `-password S` are redacted); a name-like padded key (letters only, a credential word in camel case, `==` at its end) that a delimiter and glued content follow (`--token KEY==,password=S` hides the padding and the pair and leaves the key body; `--token KEY==,]x` the same; an earlier reviewed tree hid both whole; 0 of 22 cells of realistic key kinds and 2 of 5,000 letters-only 22-character keys leak; an OPEN owner decision, no closure claim); a `-u` or `--user` user that ends in a colon with the value on the next line (`curl -u admin:\nS`, `-u PASSWD:\nS`: the line behind it is a new word, not the password); `passwd:Bearer %passwd= S` and `password:1|auth= credential=>'S` (a scheme word, a percent escape or a hash rocket between two names); an option `-u1`/`-ux` whose user is a credential's name; a secret with a credential's name and separator glued behind it (`token=Sapikey':`, `-passwd S-auth=`, `-pSapikey:`); an empty or label-like quoted value, or a closed `$'M'`/`b'M'`/`u"a"` after `Authorization`, with a word glued to the closing quote (as for a plain `password='M'S`); `TOKEN=%0AN=S` and `password:e\nn=S` (the secret is the value of another name, and an earlier tree redacted it with the rest); a bracket that holds a label or is followed by a dangling label (`token=( token%3A\nS`, `apikey=[]\secret:\n S`), and a label chain that ends in a YAML list item (`Bearer=':` and `- S` on the next line); a block header with a `#` glued to its indicator (`apikey:|#` and `apikey: >#`, then the value on the indented lines below); an unclosed bracket whose elements stand on later lines (for every key alike); `Authorization: [a,\n b,\n c]tail S` (text behind the closing bracket of a multi-line list); a password with a literal `\n`, `\r` or `%0d` followed by a `name=` (it ends at the break); a value that starts with `>` or `:` right after `=` followed by `;name=` (`--token=>;x=y`); a blank inside an element of a JSON array (`["run","--password=S1 S2","x"]` keeps `S2`); user information with a raw `@` and another stop character behind it. The word behind a credential option that takes no secret (`--password-stdin`, `--token-file`) is redacted with it
  (fail closed). Do not put secrets in receipts; treat redaction as a safety net, not a control.
- `report.json` is raw text; renderers escape (`escapeHtml`). Hostile HTML is stored inert.
- Evidence directories, report directories and bundles are owner-only (0700 / 0600).
- `bundle export` verifies the bundle it has written (the same check as `bundle verify`, on the temporary file) BEFORE it publishes
  it: a bundle that verify and restore would refuse is never published, the export exits 2 with the reason and leaves no file. The
  header's revision set is checked against the report on verify and restore. There is no signature: a bundle whose report,
  inputs and header were all rewritten together is consistent and verifies (the documented consistency-not-honesty limit), and the
  fields that are masked from the re-evaluation comparison because they depend on the build or the run (producer version,
  input summary, `supersedes`, `clock_source`, and the report's `engine.version`) are not cross-checked. The `role` of every entry is checked against its path and the format line must be spelled canonically (`PROOFGATE-BUNDLE 1`).
- `dist/index.js` and `dist/run.js` are library modules. Started as the main script (`node dist/index.js`, `node .`, `node dist`,
  `node dist/run.js`) they print a message and exit 2; the command is `proofgate` (or `node dist/cli.js`).
- No telemetry, license server or account. Live connector operations fail explicitly (`connector_disconnected`).

## Stable error codes (exit 2)

| Code | Raised when |
| --- | --- |
| `cli_usage` | Unknown command or option, missing required flag, bad flag value, an option given twice (each option takes exactly one value; there is no "last one wins"), or an empty path value. |
| `clock_invalid` | `--now` / `PROOFGATE_NOW` is not a strict UTC timestamp. |
| `connector_disconnected` | A live connector operation was requested; none is configured or implemented. |
| `internal_error` | Unexpected failure (the message is redacted). |
| `manifest_not_found` | The manifest path is missing or not a regular file. |
| `manifest_parse_error` | Invalid YAML, YAML warnings (unknown tags), duplicate YAML keys, alias bombs. |
| `manifest_schema_invalid` | Manifest fails the schema. |
| `manifest_unknown_field` | Manifest contains an undeclared field. |
| `manifest_duplicate_requirement_id` | Two requirements share an id (case-insensitive). |
| `manifest_duplicate_repository` | A repository is declared twice. |
| `manifest_unknown_repository` | A requirement names an undeclared repository. |
| `manifest_no_mandatory_requirements` | The manifest has no mandatory requirement. |
| `revisions_not_found` | The revisions path is missing. |
| `revisions_invalid_json` | The revisions file is not JSON. |
| `revisions_schema_invalid` | Revisions fail the schema. |
| `revisions_unknown_field` | Revisions contain an undeclared field. |
| `revisions_invalid_commit_sha` | A revision SHA is short, uppercase or not 40-hex. |
| `revisions_duplicate_repository` | A repository appears twice in the revision set. |
| `revisions_unknown_repository` | The revision set names a repository the manifest does not declare. |
| `revisions_missing_repository` | A declared repository has no SHA. |
| `receipts_dir_not_found` | The receipts path is missing or not a directory. |
| `receipt_invalid_json` | A receipt file is not valid JSON. |
| `receipt_schema_invalid` | A receipt fails the schema. |
| `receipt_unknown_field` | A receipt contains an undeclared field. |
| `receipt_invalid_commit_sha` | A receipt SHA is not a full 40-hex SHA. |
| `receipt_duplicate_id` | Two receipt documents share a `receipt_id`. |
| `receipt_unknown_requirement` | A receipt references a requirement id not in the manifest. |
| `receipt_unknown_repository` | A receipt names a repository the manifest does not declare. |
| `adapter_unknown_format` | A receipt document declares an unsupported `format`. |
| `receipt_unreferenced_file` | The receipts directory holds a file that is not a `*.receipt.json` receipt, not named as an artifact by a receipt and not an allowed note name (`README`, `README.md`, `README.txt`, `.gitkeep`, `.DS_Store`). Rename it to end in `.receipt.json` or move it away. |
| `runproof_schema_invalid` | A RunProof import document fails the schema, including a recorded `exit_code`/`exitCode` that is not an integer or null (a string, boolean, object or array), an exit status under another spelling (`exit_status`, `exitcode`, `returncode`, ...) and a `__proto__` key on the run or on a check. |
| `runproof_unknown_field` | A RunProof import document contains an undeclared top-level or binding field. |
| `runproof_invalid_commit_sha` | A RunProof document SHA (pin or binding) is not a full 40-hex SHA. |
| `runproof_outcome_mismatch` | A run claims `verified` while a required check is not `pass`, or a required check definition of an earlier evaluation is absent from the latest one. |
| `runproof_run_unfinished` | A RunProof run has no `finished_at`. |
| `runproof_execution_incomplete` | A RunProof run has `execution_status` `running` or `missing`. |
| `unsupported_schema_version` | Any document declares an integer `schema_version` other than 1. |
| `json_duplicate_key` | A JSON document (receipt, revision set, report, bundle header) repeats an object key at any depth; the parser refuses to pick a winner. |
| `artifact_missing` | A referenced artifact does not exist. |
| `artifact_hash_mismatch` | The artifact's recomputed sha256 differs from the receipt (tampering). |
| `path_invalid` | Malformed path, URL, backslash, control character, empty segment, excessive nesting. |
| `path_absolute` | Absolute path. |
| `path_traversal` | `..` segment. |
| `path_symlink_rejected` | A symbolic link was found. |
| `path_not_regular_file` | A directory, FIFO, socket or device where a file was required. |
| `limit_file_count` | More than 1,000 entries (directory or bundle). |
| `limit_metadata_bytes` | Metadata over 25 MB. |
| `limit_manifest_size` | The YAML manifest is over 4 MiB. |
| `limit_blob_bytes` | Referenced artifacts over the blob cap. |
| `limit_json_depth` | JSON nested too deeply. |
| `limit_json_containers` | A JSON document holds more than 500,000 objects and arrays, or the receipt documents together hold more than 1,000,000 (a memory bound checked before parsing). |
| `limit_json_values` | A JSON document holds more than 1,500,000 values (array elements, object members and containers; a memory bound checked before parsing), or the receipt documents together hold more than 3,000,000. |
| `output_exists` | The output directory exists and `--replace` was not given (or another run published it first). |
| `output_overlaps_input` | `--output` (or a bundle's `--output`) is, contains or lies inside an input: the receipts directory, the manifest, the revisions file or the report. Nothing is read, moved or written. |
| `output_unwritable` | The report, bundle or restored tree could not be written or published: permission denied, read-only file system, full disk or quota, too many open files, a parent that does not exist or is not a directory (ENOENT, ENOTDIR). This applies to every writer: `evaluate`, `bundle export` and `bundle restore` (a restore into an unwritable target never blames the bundle). |
| `report_not_found` | `explain`/`bundle` could not find `report.json`. |
| `report_invalid` | The report is malformed or does not match its `report.sha256`. |
| `explain_unknown_requirement` | The requirement id is not in the report. |
| `bundle_not_found` | The bundle file does not exist. |
| `bundle_truncated` | The bundle is shorter than its header declares, or its trailer is missing. |
| `bundle_corrupt` | An entry hash or the trailer checksum does not match, or trailing bytes exist. |
| `bundle_invalid_header` | Not a bundle, or an invalid header. |
| `bundle_unsupported_version` | The container version is not 1. |
| `bundle_entry_invalid` | Unsafe or unexpected entry path, duplicates, file/dir conflicts, missing required entries. |
| `bundle_too_large` | Bundle over the cap. |
| `bundle_target_exists` | The bundle output file or restore directory already exists. |
| `bundle_input_mismatch` | Export inputs do not reproduce the report. |
| `bundle_secret_detected` | An artifact contains credential-shaped text (override: `--allow-secret-artifacts`). |
| `bundle_reevaluation_mismatch` | The bundled report does not follow from the bundled inputs, or the header disagrees with it. |
| `envelope_schema_invalid` | An event envelope fails the schema. |
| `envelope_unknown_field` | An event envelope contains an undeclared field. |
| `envelope_conflict` | An event id was redelivered with different content. |

## Decision reason codes

Reason codes appear in `report.json` (`reason_codes`, `rejected_receipts[].reason_codes`) and in `explain` output.

| Code | Meaning |
| --- | --- |
| `revision_mismatch` | Receipt is for a different commit than the revision set. |
| `environment_mismatch` | Receipt ran in a different environment than required. |
| `level_insufficient` | Receipt test level is below the required level. |
| `execution_kind_not_allowed` | Receipt is mocked/synthetic where that is not allowed. |
| `receipt_from_future` | Receipt finished after the evaluation time. |
| `repository_not_required` | Receipt is for a repository the requirement does not cover. |
| `evidence_stale` | Evidence age is at or beyond `max_age_seconds`. |
| `zero_tests` | The run executed zero tests. |
| `tests_failed` | One or more tests failed. |
| `result_failed` | The receipt reports a failing result. |
| `result_contradicts_counts` | A pass claim contradicts its own failure count. |
| `tests_skipped` | Some tests were skipped. |
| `partial_result` | The receipt reports a partial result. |
| `suite_skipped` | The whole suite was skipped. |
| `all_criteria_met` | Everything matched and every test passed. |
| `no_receipt` | No receipt names this requirement for this repository. |
| `no_qualifying_receipt` | Receipts exist but none qualifies. |
| `conflicting_evidence` | Qualifying receipts for the same revision disagree. |
| `incomplete_repository_coverage` | Only some declared repositories have passing evidence. |
| `requirement_deferred` | The manifest defers the requirement. |

## Library surface (`src/index.ts`)

Frozen exports for the report layer and tools: `escapeHtml`, `redactString`/`redactValue`, `canonicalize`,
`hashCanonical`, `sha256Hex`, the zod schemas and `Report`/`Decision`/`ReportReceipt`/`Status` types, `readReport`,
`serializeReport`, `explainRequirement`, `evaluatePaths`, `assess` (pure), `exportBundle`/`restoreBundle`,
`parseEnvelope`/`EnvelopeDeduper`, `describeReason`, `resolveNow`, `ERROR_CODES`.

## Deferred / out of scope for the MVP

No HTTP API, no connector writes (nothing is written back to any system), no signing or attestation of receipts, no
branch-protection integration, no operator-approved retention enforcement (see `docs/DATA-RETENTION.md`).
