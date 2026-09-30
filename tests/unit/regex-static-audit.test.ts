/**
 * Static audit of every regular expression in src/ (scripts/regex-audit.mjs) for backtracking blow-up. Review round 6 (logic P0): the redactor
 * held `(?:\\+[nr]?|%0[AaDd])+$`, a quantified group with an unbounded quantifier inside (`(a+)+$`), which took 1,377 ms on 24 characters and hung
 * `proofgate evaluate` on a short receipt string. Two shapes are flagged:
 *   E  a group quantified without a small bound that holds an unbounded quantifier or an alternation (exponential)
 *   T  an unbounded run in front of the end anchor `$` in an expression that is not anchored at the start (quadratic on a long run)
 * plus D, a `new RegExp(<expression>)` whose source is not a literal. Each one that is left stands on the allow-list with the reason it is safe;
 * an entry that no longer matches anything fails too (a list that only grows hides the next hit).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Finding {
  shape: string;
  detail: string;
}
interface Row {
  file: string;
  line: number;
  kind: string;
  source: string;
  flags: string;
  findings: Finding[];
}
interface Audit {
  auditSources: (root: string) => Row[];
  analyseRegex: (source: string, flags?: string) => Finding[];
  extractRegexes: (text: string) => Array<{ line: number; kind: string; source: string; flags: string }>;
}

const ROOT = join(import.meta.dirname, "..", "..");
const { auditSources, analyseRegex, extractRegexes } = (await import(/* @vite-ignore */ join(ROOT, "scripts", "regex-audit.mjs"))) as Audit;

/** `<file> <shape> <source>`: the reason it is safe. */
const ALLOWED: Array<[string, string, string, string]> = [
  ["src/redact.ts", "T", "(?:secret|token)s?\\d*$", "a match must start at the word `secret` or `token`, so a run is never re-entered from another start; it is applied to one name, and the name is bounded by the name reader"],
  ["src/redact.ts", "E", "[:=](?:\\\\+[nr]|%0[AaDd])*$", "applied to a slice of at most 24 characters (`text.slice(Math.max(valueStart, valueEnd - 24), valueEnd)`)"],
  ["src/redact.ts", "D", "re.source, re.flags);", "a private copy of a module-level regular expression that is itself in this audit"],
  ["src/redact.ts", "D", "source, \"gi\");", "`valueKeyOpen`: its source is built from a run count and a quote, with bounded quantifiers only (`\\s{0,64}`, `\\\\{run}`)"],
];

describe("no regular expression of src/ backtracks exponentially or retries at every start of a long run", () => {
  const rows = auditSources(ROOT);

  it("the audit sees the redactor's expressions (a lexer that finds none would pass everything)", () => {
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.some((r) => r.file === "src/redact.ts" && r.source.startsWith("\\r\\n|\\n|\\r|"))).toBe(true);
    expect(rows.filter((r) => r.kind === "new RegExp(template)").length).toBeGreaterThan(10);
  });

  it("every flagged expression stands on the allow-list, and every entry of the list still matches one", () => {
    const flagged = rows.flatMap((r) => r.findings.map((f) => ({ r, f })));
    const unlisted = flagged.filter(({ r, f }) => !ALLOWED.some(([file, shape, source]) => file === r.file && shape === f.shape && r.source.startsWith(source.replace(/\);$/, "").replace(/, "gi"\);$/, "")) ));
    expect(unlisted.map(({ r, f }) => `${r.file}:${r.line} ${f.shape} /${r.source.slice(0, 120)}/ ${f.detail}`)).toEqual([]);
    const stale = ALLOWED.filter(([file, shape, source]) => !flagged.some(({ r, f }) => file === r.file && shape === f.shape && r.source.startsWith(source.replace(/\);$/, "").replace(/, "gi"\);$/, ""))));
    expect(stale.map((e) => e.slice(0, 3).join(" "))).toEqual([]);
    for (const entry of ALLOWED) expect(entry[3].length, "each entry needs a reason").toBeGreaterThan(20);
  });

  it("the analyser flags the shapes it is meant to flag, and only those", () => {
    expect(analyseRegex("(?:\\\\+[nr]?|%0[AaDd])+$").map((f) => f.shape)).toEqual(["E"]);
    expect(analyseRegex("(a+)+$").map((f) => f.shape)).toEqual(["E"]);
    expect(analyseRegex("(a|aa)*b").map((f) => f.shape)).toEqual(["E"]);
    expect(analyseRegex("(x*)*").map((f) => f.shape)).toEqual(["E"]);
    expect(analyseRegex("\\\\+$").map((f) => f.shape)).toEqual(["T"]);
    expect(analyseRegex("\\s+$").map((f) => f.shape)).toEqual(["T"]);
    // safe forms: a bounded quantifier, an anchor at the start, a sticky flag, a group with a bounded body
    expect(analyseRegex("^\\s{0,4}[:=]")).toEqual([]);
    expect(analyseRegex("\\\\{1,64}n")).toEqual([]);
    expect(analyseRegex("^\\\\+$")).toEqual([]);
    expect(analyseRegex("\\\\+$", "y")).toEqual([]);
    expect(analyseRegex("(?:ab){1,3}c")).toEqual([]);
    expect(analyseRegex("(?:[a-z]{0,60}[:=])?x")).toEqual([]);
    expect(analyseRegex("[A-Za-z0-9_.-]+")).toEqual([]);
  });

  it("the audit flags every PLANT (the trailing-strip regular expressions of the mutation list put back into src/redact.ts) and flags nothing more on the clean text", () => {
    const source = readFileSync(join(ROOT, "scripts", "mutation-controls.mjs"), "utf8");
    const start = source.indexOf("const MUTANTS = [") + "const MUTANTS = ".length;
    const end = source.indexOf("\n];", start) + 2;
    const mutants = new Function(`return ${source.slice(start, end)}`)() as string[][];
    const plants = mutants.filter((m) => /^M3(?:59|6[0-5]) /.test(m[0] as string));
    expect(plants.length).toBe(7);
    const clean = readFileSync(join(ROOT, "src", "redact.ts"), "utf8");
    const flaggedIn = (text: string): string[] => extractRegexes(text).flatMap((r) => analyseRegex(r.source, r.flags).map((f) => `${f.shape} ${r.source}`));
    const before = flaggedIn(clean);
    for (const [name, file, find, replace] of plants as [string, string, string, string][]) {
      expect(file).toBe("src/redact.ts");
      expect(clean.split(find).length - 1, `${name}: the target occurs once`).toBe(1);
      const after = flaggedIn(clean.replace(find, () => replace));
      const added = after.filter((entry) => !before.includes(entry));
      expect(added.length, `${name}: the plant is flagged`).toBeGreaterThanOrEqual(1);
      expect(added.every((entry) => /^[ET] /.test(entry)), name).toBe(true);
    }
    // the other direction: the linear scans that replaced them are not flagged (the clean text's flags are exactly the allow-list)
    expect(before.length).toBe(ALLOWED.filter(([, shape]) => shape !== "D").length);
  });

  it("the lexer finds literals, string sources and template sources, and skips strings, comments and divisions", () => {
    const text = [
      "const a = /x+y/g; // /not+a+regex/",
      'const b = "text / with / slashes";',
      "const c = new RegExp(\"a\\\\.b\", \"i\");",
      "const d = new RegExp(`${NB}k{2}`, \"g\");",
      "const e = total / count / 2;",
      "/* /nor+this/ */",
      "if (/^z*$/.test(s)) return;",
    ].join("\n");
    const found = extractRegexes(text).map((r) => `${r.kind}:${r.source}:${r.flags}`);
    expect(found).toEqual(["literal:x+y:g", "new RegExp(string):a\\.b:i", "new RegExp(template):\u0001k{2}:g", "literal:^z*$:"]);
  });
});
