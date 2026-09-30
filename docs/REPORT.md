# The static HTML report

`proofgate evaluate --output <dir>` writes `report.json`, `report.sha256` and `index.html`. `index.html` is a single
self-contained page rendered from `report.json` by `renderReportHtml(report)` (`src/web/render.ts`, imported statically by
the CLI; there is no optional report layer). It needs no server, no script and no network: open it from disk.

`report.json` stays the source of truth. The page adds no decision of its own; it presents the decisions, and where
the report contradicts itself it refuses to show acceptance (see "Verdict").

## What the page contains

| Section | Content |
| --- | --- |
| Header | Manifest name, evaluation time (UTC), assessment id, links to every section. |
| Verdict | `ACCEPTED` or `NO ACCEPTED RESULT`, the exit code, the count of unsatisfied mandatory requirements and a list of each with its first next step. |
| Exit code meaning | 0, 1 and 2 explained, the row that applies to this report marked. |
| Summary by status | Counts per status, split mandatory and advisory, with what each status means for acceptance. |
| Assessment | Assessment id, manifest name, where the evaluation clock came from (a clock fixed by `--now` or `PROOFGATE_NOW` is called out as fixed, not current), manifest / policy / revisions / receipts hashes, engine version, whether this report replaced an earlier one (and whether the policy changed), input sizes. |
| Revisions | Every repository with its full 40-character commit SHA. |
| Requirements | One row for **every** requirement, mandatory first (manifest order inside each group): status, required level / environment / maximum age / repositories / execution kinds, source receipt ids, observed environments, reason codes with plain-language explanations, next steps. |
| Requirement details | Per repository: expected commit, status, reasons, receipts. Plus the rejected receipts of the requirement and why each was rejected. Each requirement is a native disclosure (no script): one that passed cleanly is folded to a one-line summary, everything else is open, and the summary always names every repository and its status, so folding hides no status. The page cannot collapse by screen width without script; on a phone the detail cards are also laid out more compactly. |
| Receipts considered | Every receipt: id, source file, adapter and provenance, repository and full SHA, runner, environment, level, execution kind, result and counts, finished time relative to the evaluation time, artifact path and hashes. Artifact paths are shown as text and are never links. |
| How to read the statuses | The six statuses, what they mean, and that only PASS satisfies a requirement. |

## Status wording

Each status is a text label plus a decorative symbol (hidden from assistive technology), a distinct border style and a
colour. None of the four cues is required alone.

| Status | Symbol | Wording on the page | Acceptance |
| --- | --- | --- | --- |
| PASS | check | Every required repository has fresh, complete, passing evidence for the exact revision, environment and test level. | Satisfies the requirement. |
| FAIL | cross | Fresh evidence for the exact revision contains a failing test or contradicts itself. | Not satisfied. |
| STALE | clock | The only matching evidence is at or beyond the maximum allowed age. Evidence exactly at the limit is already stale. | Not satisfied. |
| MISSING | empty circle | No matching evidence exists, or the only evidence is passing claims of runs that executed zero tests. | Not satisfied. Absence of evidence is not a pass. |
| PARTIAL | half circle | Skipped tests, a partial result, or only some declared repositories are covered. | Not satisfied. |
| DEFERRED | diamond | The manifest explicitly defers this requirement. Unverified and visible. | Not satisfied. Deferral never satisfies a mandatory requirement. |

Only PASS uses the green tone, in both colour schemes. A `DEFERRED` row also prints the recorded deferral reason and
what the evidence alone would say ("Evidence alone would say ... Deferral is not a pass."). Mocked and synthetic
receipts are tagged `MOCKED: not live evidence` / `SYNTHETIC: not live evidence`. A status the renderer does not know is
printed as `UNKNOWN: <value>` in a neutral tone and counts as not accepted.

Every core reason code has a specific next step (`REASON_NEXT_STEPS` in `src/web/guidance.ts`); the type of that table is
tied to the core reason table, so a new core code fails the build until wording exists. The explanation text comes from
the core (`describeReason`). Unknown codes fall back to "No description is available for this reason code." and a
pointer to `proofgate explain`.

## Verdict

The page says **ACCEPTED** only when all of these hold: the report says `verdict: accepted` with `exit_code: 0`; at
least one mandatory requirement exists and every mandatory requirement is `PASS`; and the summary counts (total,
mandatory, mandatory passed, per status) equal what the decisions add up to.

| Situation | Headline |
| --- | --- |
| Consistent, every mandatory requirement PASS | `ACCEPTED` (green). Open advisory items are still named. |
| Consistent, at least one mandatory requirement not PASS | `NO ACCEPTED RESULT` (red), exit code 1, list of what blocks. |
| No mandatory requirement | `NO ACCEPTED RESULT`: "nothing can be accepted". |
| The report contradicts itself (verdict vs decisions, verdict vs exit code, summary vs decisions) | `NO ACCEPTED RESULT (report inconsistent)` with the reasons; re-run `proofgate evaluate`. |
| Zero requirements | `NO ACCEPTED RESULT (nothing evaluated)`; the requirement, detail, receipt and revision sections each show an explicit empty state. |

The core refuses an empty manifest and a manifest without a mandatory requirement, so the last two rows are defence in
depth for hand-edited or future reports; they are covered by tests.

## Safety properties

- **Escaping by construction.** All markup is built with the `html` tagged template in `src/web/safe-html.ts`. Static parts
  are trusted; every interpolated value is converted to text and passed through `escapeHtml` unless it is a `Safe`
  fragment created by the module. Report data cannot forge a `Safe` fragment (an `instanceof` check on a private class).
  There is no `innerHTML`, no script and no inline event handler. Attribute values are constants or counters
  (`req-3`), never report text.
- **Invisible and reordering characters are shown, not applied.** C0/C1 controls (except tab and line breaks), soft hyphen,
  zero-width characters, bidi marks and overrides, line/paragraph separators, BOM, Unicode tag characters and
  unpaired surrogates are displayed as `[U+XXXX]`. Cell text is also isolated for bidirectional layout.
- **Bounded strings.** A single string longer than 4,000 UTF-16 units is cut (never inside a surrogate pair) and followed by
  `[... N more characters not shown; the full value is in report.json]`. Nothing is silently dropped.
- **Strict CSP (meta tag).** `default-src 'none'; style-src 'sha256-<hash of the inline stylesheet>'; img-src 'none';
  script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`. No `unsafe-inline`, no external font, image,
  stylesheet or script. The page works from `file://` (verified in real Chromium by `tests/e2e/smoke.spec.ts`; see "Tests").
- **No fetching, no links out.** The only `href` values are in-page anchors. Artifact paths, URLs and command text are inert
  text; the command is labelled "informational, never executed".
- **Deterministic.** No clock, locale, randomness or environment input. The same report gives byte-identical HTML; key order
  in the JSON does not matter. The golden files embed the engine version, so update them (see "Tests") with a version change.
- **Nothing sensitive added.** The renderer only shows what `report.json` already carries (already redacted, on a best-effort basis). It does not
  read any other file.

## Accessibility and layout

Semantic landmarks (`header`, `nav`, `main`, `footer`), one `h1`, no skipped heading levels, a skip link, `lang="en"`. Every
table has a `caption`, column headers with `scope="col"` and row headers with `scope="row"`. Scrollable table regions are
keyboard focusable and labelled. Focus outlines are never removed.

Light and dark follow `prefers-color-scheme`; text and status colours are verified for WCAG AA contrast (4.5:1, and 3:1 for
meaningful borders) in both schemes by `tests/unit/report-render-style.test.ts`. At 720 px and narrower every table becomes
stacked cards using static `data-label` captions. Print styles restore the light palette (also for dark-mode users), let
tables flow across pages and repeat the header row.

## Try it (QA, from a source checkout)

The commands in this section and in "Tests" run from a clone of the repository (they use `tests/helpers/`, which the npm
package does not ship). An installed `proofgate` writes the same page with `proofgate evaluate`; see `docs/RUNBOOK-SMOKE.md`.

```
npm ci && npm run build
node tests/helpers/render-demo.mjs ./pg-demo            # exit code 1 scenario, all six statuses
node tests/helpers/render-demo.mjs ./pg-demo-ok --pass  # exit code 0 scenario
```

The target directory must not exist. The script writes synthetic inputs, runs the packaged CLI with a fixed clock and
prints the `file://` address of `report/index.html`. Open it in a browser, resize to phone width, toggle the system colour
scheme and print preview.

## Tests

| File | Covers |
| --- | --- |
| `tests/unit/report-render.test.ts` | Six statuses, exit 0 and 1, empty and inconsistent states, wording, receipts table, accessibility structure, CSP, determinism, golden snapshots, scale (1,000 requirements). |
| `tests/unit/report-render-security.test.ts` | Attack-string corpus (51 entries) injected into every free-form field and into every string leaf, seeded fuzz, very long strings, invisible characters, a negative control for the checks themselves. |
| `tests/unit/report-render-mutant.test.ts` | Seeded negative control: with `escapeHtml` replaced by the identity function the safety checks must fail. |
| `tests/unit/report-render-style.test.ts` | WCAG contrast for both schemes, non-colour cues, print tokens. |
| `tests/unit/report-render-cli.test.ts` | `evaluate` writes `index.html` (real pipeline, in-process CLI and packaged `dist/cli.js`), 0600 mode, planted hostile text and secrets, exit 0 to exit 1 change, no page on exit 2. |
| `tests/e2e/smoke.spec.ts`, `tests/e2e/smoke-controls.spec.ts` | Real Chromium from `file://`: hostile strings shown as text, no page overflow at 375 px and 1440 px, readable and stacked tables, empty and unsatisfied states, zero console messages, no network request; controls prove the observers see script, network and overflow faults. |
| `tests/e2e/packaged-cli.test.ts` | The same flows through the installed `npm pack` tarball, asserting exit codes and the `index.html` contents. |

No HTML parser is a dependency of this repository. The tests use a deliberately strict local tokenizer
(`tests/helpers/html-tokens.ts`) that fails on any raw `<` that is not a well-formed tag, bare `&`, unknown entity,
unquoted attribute or mismatched nesting, and an allow-list of elements and attributes
(`tests/helpers/report-invariants.ts`). The real-browser check is the Playwright smoke test
(`tests/e2e/smoke.spec.ts`, controls in `tests/e2e/smoke-controls.spec.ts`): it opens reports written by the installed,
packed CLI from `file://` in real Chromium at 375 px and 1440 px. It is maintainer-run evidence, not an independent receipt.

Renderer coverage is part of the main coverage gate (`npx vitest run --coverage`, thresholds in `vitest.config.ts` now include
`src/web/**`). The renderer can still be measured alone:

```
npx vitest run --config tests/unit/report-render.vitest.config.ts --coverage
```

Golden files live in `tests/unit/report-render.golden/`; hash-derived UUIDs are replaced by a placeholder before
comparison so no raw UUID is committed. After an intentional change to the page, review the diff and run
`npx vitest run tests/unit/report-render.test.ts -u`.

## One-off manual browser check (now automated)

Before the Playwright smoke existed, a hostile report (script tags, attribute breakouts, `javascript:` links, a `</title>` breakout, an SVG handler, a
meta refresh) was rendered and loaded from `file://` in headless Chrome 153; the serialised DOM contained no `script`,
`img`, `svg`, `iframe`, `object`, `base` or `form` element, no `on*` attribute, only in-page `href` values, and the page
title stayed the escaped text. A benign report was screenshotted at 1280 px and 390 px width. The Playwright smoke now
repeats and extends these checks on every gate run; both are maintainer-run evidence, not independent browser evidence.

## Known limits

- The report is a presentation of `report.json`; it does not prove the honesty of the parties that produced receipts.
- Narrow-screen stacking relies on CSS `display` changes on table elements, which some older assistive-technology and
  browser combinations expose as plain text instead of a table. The wide layout keeps full table semantics.
- Text is English only.
