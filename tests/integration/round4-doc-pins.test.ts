/**
 * Review round 3 (tests re-review P3): documentation statements that are part of the honesty contract and were unpinned (flipping
 * them to PASS survived every test): the AC-03 and AC-11 statements in README, CHANGELOG and gate-evidence. Also pinned here: the
 * narrowed redaction coverage, which is now enumerated (and whose "not redacted" list must stay), and the documented limits that
 * belong to the new code (`limit_json_values`, the identifier refusal, `--replace` needs `--output`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), "utf8");
const readme = read("README.md");
const changelog = read("CHANGELOG.md");
const gate = read("docs", "qa", "gate-evidence.md");
const interfaces = read("docs", "INTERFACES.md");
const security = read("SECURITY.md");
const operations = read("docs", "OPERATIONS.md");

describe("acceptance statuses that no agent may flip", () => {
  it("README: AC-03 and AC-06 are PARTIAL and AC-11 is PENDING_HUMAN_RECEIPT, none of them PASS", () => {
    expect(readme).toContain("**AC-03 is PARTIAL**");
    expect(readme).toContain("**AC-06 is PARTIAL**");
    expect(readme).toMatch(/\*\*AC-11\*\*[^`]*`PENDING_HUMAN_RECEIPT`/);
    expect(readme).not.toMatch(/AC-0[36] is PASS/);
    expect(readme).not.toMatch(/AC-11[^.\n]{0,80}\b(?:PASS|satisfied|closed|complete)\b/);
  });

  it("CHANGELOG: AC-11 is PENDING_HUMAN_RECEIPT and AC-03 and AC-06 are PARTIAL", () => {
    expect(changelog).toMatch(/AC-11 \(fresh-operator drill\) is `PENDING_HUMAN_RECEIPT`/);
    expect(changelog).toMatch(/AC-03 and AC-06 as PARTIAL/);
    expect(changelog).not.toMatch(/AC-11[^.\n]{0,80}\b(?:PASS|satisfied|closed)\b/);
  });

  it("gate evidence: the automated runbook harness is supplemental and AC-11 remains PENDING_HUMAN_RECEIPT", () => {
    expect(gate).toContain("supplemental evidence for AC-11, NOT the human drill");
    expect(gate).toContain("**AC-11 remains PENDING_HUMAN_RECEIPT**");
    expect(gate).not.toMatch(/AC-11[^.\n]{0,80}\b(?:is PASS|satisfied|closed by)\b/);
  });
});

describe("the redaction documents enumerate what is covered and what is not", () => {
  it("INTERFACES lists where a token may sit, the boundary exceptions, the identifier refusal and the not-redacted classes", () => {
    expect(interfaces).toContain("**Where a token may sit**");
    for (const prefix of ["`ghp_`", "`github_pat_`", "`glpat-`", "`npm_`", "`sk-ant-`", "`AKIA`/`ASIA`"]) expect(interfaces, prefix).toContain(prefix);
    expect(interfaces).toMatch(/short prefixes `sk-`, `key-`, `SK`, `AC` and a capital-B `Bearer`[\s\S]{0,300}\*\*not\*\* redacted/);
    expect(interfaces).toMatch(/`AKIA\.\.\.EXAMPLEx` is not redacted/);
    expect(interfaces).toContain("**Identifiers are refused, not redacted**");
    expect(interfaces).toContain("redacted-<16 hex>.receipt.json");
    expect(interfaces).toContain("**What it does not redact**: personal data other than e-mail addresses");
    expect(interfaces).toContain("longer than 4 MiB is replaced by `[REDACTED]` as a whole");
    expect(interfaces).toContain("at most six rounds");
    expect(interfaces).toContain("1, 2 and 3.5 MiB");
  });

  it("SECURITY, OPERATIONS and README say that personal data other than e-mail is not redacted", () => {
    expect(security).toMatch(/personal data other than e-mail addresses/);
    expect(operations).toMatch(/personal data other than e-mail addresses/);
    expect(readme).toMatch(/personal data other than e-mail addresses/);
  });

  it("no document still claims a scaling test at 256 KB or an unconditional glue promise", () => {
    for (const [name, text] of [["INTERFACES", interfaces], ["SECURITY", security]] as const) {
      expect(text, name).not.toMatch(/64, 128\s+and 256 KB/);
      expect(text, name).not.toMatch(/A token glued to a word or an underscore is still found/);
    }
  });
});

describe("round 4: the acceptance statuses of the tested tree are stated in the gate evidence, and the new behaviour is documented", () => {
  it("gate evidence states AC-03 PARTIAL, AC-06 PARTIAL and AC-11 PENDING_HUMAN_RECEIPT for the tree it describes, and that no gate result exists until one is recorded", () => {
    expect(gate).toMatch(/AC-03[^.\n]{0,40}PARTIAL/);
    expect(gate).toMatch(/AC-06[^.\n]{0,40}PARTIAL/);
    expect(gate).toMatch(/AC-11[^.\n]{0,40}PENDING_HUMAN_RECEIPT/);
    expect(gate).toMatch(/no gate result is recorded/i);
    expect(gate).not.toMatch(/AC-0[36][^.\n]{0,40}\bPASS\b/);
  });

  it("gate evidence carries the round 2 gate table forward as history and does not call it a result of a later tree", () => {
    expect(gate).toContain("the round-2 tree");
    expect(gate).toMatch(/history|different lineage|earlier tree/i);
  });

  it("no public document carries the internal workflow vocabulary of the review process", () => {
    for (const [name, text] of [["ledger", read("docs", "qa", "review-round1-ledger.md")], ["gate evidence", gate], ["ac-matrix", read("docs", "qa", "ac-matrix.md")], ["negative controls", read("docs", "qa", "negative-controls.md")]] as const) {
      expect(text, name).not.toMatch(/\bcoordinator\b|hand-?over message|hook flagged|edit-count hook|\bEdit tool\b|go-ahead/i);
    }
  });

  it("INTERFACES documents nesting, escapes as separators, pairs and lists, the export check, the entry modules and the aggregate budgets", () => {
    expect(interfaces).toContain("**Nesting**");
    expect(interfaces).toContain("`c * (r + 1) + r`");
    expect(interfaces).toContain("**Pairs and lists**");
    expect(interfaces).toMatch(/`bundle export` verifies the bundle it has written/);
    expect(interfaces).toMatch(/`dist\/index\.js` and `dist\/run\.js` are library modules/);
    expect(interfaces).toMatch(/all the receipt documents of one evaluation together/);
  });

  it("the not-redacted list names the separators and formats that are not covered", () => {
    for (const shape of ["`->`", "`<password>x</password>`", "`tool -p x`", "`password%2525253Dx`", "`name: DB_PASSWORD`"]) expect(interfaces, shape).toContain(shape);
  });

  it("INTERFACES documents the pair reader, whole-key names, percent-encoded separators and block lists that the round 4 review classes need", () => {
    expect(interfaces).toContain("in either order of the two keys and with other keys");
    expect(interfaces).toContain("an object boundary,\n  found outside strings, ends the search");
    expect(interfaces).toContain("**Key names** are tested as a whole as well as by segment");
    expect(interfaces).toContain("**Percent-encoded separators**");
    expect(interfaces).toContain("up to\n  three levels");
    expect(interfaces).toContain("A YAML block list under a credential key");
    expect(interfaces).toMatch(/a name\/value pair written as YAML or TOML lines/);
    expect(interfaces).not.toContain("a separator written percent-encoded (`password%3Dx`)");
    expect(security).toContain("reads percent-encoded separators (`password%3Dx`) up to three levels");
    expect(security).toContain("a name/value pair\n  written as YAML or TOML lines or with the spellings");
    expect(security).toContain("separators in percent escapes nested more than three levels deep");
  });
});

describe("limits and refusals that belong to round 3 are documented where an operator looks", () => {
  it("limit_json_values, the identifier refusal codes and the --replace usage error are in the interface document", () => {
    expect(interfaces).toContain("limit_json_values");
    expect(operations).toContain("limit_json_values");
    expect(security).toContain("limit_json_values");
    expect(interfaces).toMatch(/`--replace` without `--output` is a usage error \(`cli_usage`\)/);
    expect(interfaces).toMatch(/ENOENT, ENOTDIR/);
  });
});

describe("round 5: the shipped documents are written for a public reader and state the limits they leave", () => {
  // EVERY shipped document: README (npm always packs it), every Markdown file named by `files` in package.json (a directory contributes its Markdown files), and the PRD
  const shipped = JSON.parse(read("package.json")) as { files: string[] };
  const FILES = ["README.md"];
  for (const entry of shipped.files) {
    if (entry.endsWith(".md")) FILES.push(entry);
    else if (entry === "docs/qa") for (const name of readdirSync(join(ROOT, "docs", "qa")).filter((n) => n.endsWith(".md")).sort()) FILES.push(`docs/qa/${name}`);
  }
  it("the list of documents covers every Markdown document of the package", () => {
    expect(FILES).toEqual(expect.arrayContaining(["README.md", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md", "docs/REPORT.md", "docs/BENCHMARK.md", "docs/SCHEMAS.md", "docs/DATA-RETENTION.md", "docs/RUNBOOK-SMOKE.md", "docs/DEPENDENCY-LICENSES.md", "docs/prd/proofgate.md", "docs/qa/review-round1-ledger.md"]));
    expect(new Set(FILES).size).toBe(FILES.length);
  });
  it("no shipped document cites a commit of the working history (a public repository is squashed: such ids would not resolve)", () => {
    // Allowed: hashes that are not commits of this repository (an upstream project's pinned commit, tarball hash prefixes).
    const ALLOWED = new Set(["5e2f9af", "5e2f9af3310655116535b31ca99ab92210178431", "e442ea6", "bb917828", "785818a9", "715ec745", "56ca6054"]);
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = read(...file.split("/"));
      for (const m of text.matchAll(/(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g)) {
        const token = m[0];
        if (/[a-f]/.test(token) && /[0-9]/.test(token) && !ALLOWED.has(token)) offenders.push(`${file}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(read("docs", "qa", "review-round1-ledger.md")).toMatch(/\*\*Commit ids\.\*\*/);
  });

  it("no shipped document carries the vocabulary of the review workflow or the names of the local branches", () => {
    const words = /\bcoordinator\b|hand-?over|hook flagged|edit-count|\bEdit tool\b|go-ahead|worktree|checkpoint|automated check|by instruction|remediation brief|\bthe brief\b|successor|previous implementer|written cap|codex\/mvp|\bimplementers?\b|\bhunks?\b|\bbatch(?:es)?\b|delivered tree|previous delivery|edge prober|independent QA runner|conformance auditor/i;
    for (const file of FILES) expect(read(...file.split("/")), file).not.toMatch(words);
  });

  it("every shape that stays unredacted is in the interface document, and the bundle-masking limit is stated in both places", () => {
    for (const shape of ["`ENV PASSWORD x`", '`password: string = "x"`', "`pass\\u0077ord`", "`mnemonic`", "`gh secret set NAME --body S`", "`--name /prod/db/password --value S`", "`IDENTIFIED BY 'S'`", "Braille blank (U+2800)", "`sid=S`", "`{k, v}`", "`{name, data}`", "`otp`", "`pin`", "`salt`", "`bearerx`", "a text key longer than about 88 characters"]) {
      expect(interfaces, shape).toContain(shape);
    }
    expect(interfaces).toMatch(/not cross-checked/);
    expect(interfaces).toContain("the report's `engine.version`");
    expect(security).toMatch(/not cross-checked\s+either/);
    expect(security).toContain("the report's `engine.version`");
    expect(security).toContain('("What it does not redact")');
    expect(security).toContain("Whether any of these should be covered is an open decision for the owner.");
    expect(security).toContain("Hard links are not detected");
  });

  it("the interface, operations and adapter documents state the round 5 behaviour of options, user information, pairs, bundles and RunProof", () => {
    expect(interfaces).toContain("**User information** in a URL");
    expect(interfaces).toContain("up to the last `@` before the first `/`, `?`, `#`, quote or blank");
    expect(interfaces).toContain("within 4 KiB of the name key");
    expect(interfaces).toContain("up to 1,100 characters");
    expect(interfaces).toContain("looked for in text windows only");
    expect(interfaces).toContain("`PROOFGATE-BUNDLE 1`");
    expect(read("docs", "OPERATIONS.md")).toContain("next to the output file**");
    expect(read("docs", "OPERATIONS.md")).toContain("`bundle verify` extracts into `TMPDIR`");
    expect(read("docs", "ADAPTERS.md")).toContain("or a plain `status` field, or a field named `verdict`");
  });

  it("the interface document describes the operators, block scalars and prefixed options that are read", () => {
    expect(interfaces).toContain("`?=` and `+=` (make, shell)");
    expect(interfaces).toContain("A YAML block scalar under a credential key");
    expect(interfaces).toContain("`--db-password S`");
    expect(interfaces).toContain("`-p=S`");
  });

  it("no document claims that the full mutation run has passed on the current tree", () => {
    for (const file of ["CHANGELOG.md", "docs/qa/negative-controls.md", "docs/qa/ac-matrix.md", "docs/qa/review-round1-ledger.md"]) {
      // the counts of the lists of the trees that were reviewed (229, 244) and of the current one (274, plus 7 end-to-end): "all 274 mutants killed",
      // "274 of 274 mutants killed", "every mutant is killed" are claims about a full run that has not been made (earlier rounds' own gate counts are history)
      expect(read(...file.split("/")), file).not.toMatch(/\ball\s+(?:229|244|274|281|296|318|320|323|325|332|333|351|358|365|376|382|384|385|386|387|388)\s+(?:seeded\s+)?(?:mutants|controls|defects)\s+(?:were\s+|are\s+)?killed|\b(229|244|274|281|296|318|320|323|325|332|333|351|358|365|376|382|384|385|386|387|388)\s+(?:of|\/)\s+\1\s+(?:seeded\s+)?(?:mutants|controls|defects)?\s*(?:were\s+)?killed|\bevery\s+(?:mutant|control|defect)\s+(?:was|is|has been)\s+killed/i);
    }
    expect(read("docs", "qa", "negative-controls.md")).toMatch(/full (?:mutation )?run[^.]{0,120}(?:pending|has not been run|not been run|has NOT been run)/i);
    expect(changelog).toMatch(/full (?:mutation )?run[^.]{0,120}(?:pending|has not been run|not been run)/i);
    // and the qualification sits in the same sentence as the count: "killed in targeted runs" is what the documents may say
    expect(changelog).toMatch(/\d+ mutation\s+controls; killed in targeted runs/);
  });
});
