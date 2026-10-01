/**
 * Review round 5 (conformance P1): four mutants no longer occurred in src/redact.ts after the redactor changed, so the mutation
 * harness could not run them and "all mutants killed" was a claim about a list that could not run. Nothing in the main suite
 * looked at the lists; only the harness itself did, at the moment it was run. This file makes the main suite check the instrument:
 * every entry of BOTH mutant lists must match its source exactly once, ids must be unique, and the checker itself is shown to go
 * red on a target that is missing, on one that occurs twice, on a no-op and on a duplicate id.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

interface Fields {
  name: string;
  file: string;
  find: string;
  replace: string;
}
interface InstrumentRule {
  checkMutantTargets(mutants: unknown[][], readSource: (file: string) => string): { checked: number; problems: string[] };
  mutantFields(entry: unknown[]): Fields;
  reportInstrumentCheck(label: string, result: { checked: number; problems: string[] }): number;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { checkMutantTargets, mutantFields, reportInstrumentCheck } = (await import(/* @vite-ignore */ join(root, "scripts", "kill-rule.mjs"))) as InstrumentRule;
const read = (file: string): string => readFileSync(join(root, file), "utf8");

/** The MUTANTS array literal of a harness script, evaluated without running the script (the suites are stand-ins). */
function loadMutants(script: string): unknown[][] {
  const source = read(script);
  const start = source.indexOf("const MUTANTS = [") + "const MUTANTS = ".length;
  const end = source.indexOf("\n];", start) + 2;
  const NODE_SUITE = ["node-suite"];
  const BROWSER_SUITE = ["browser-suite"];
  const ARTIFACT_SUITE = ["artifact-suite"];
  return new Function("NODE_SUITE", "BROWSER_SUITE", "ARTIFACT_SUITE", `return ${source.slice(start, end)}`)(NODE_SUITE, BROWSER_SUITE, ARTIFACT_SUITE) as unknown[][];
}

describe("the mutant lists match the sources they mutate", () => {
  for (const script of ["scripts/mutation-controls.mjs", "scripts/e2e-mutation-controls.mjs"]) {
    it(`${script}: every target occurs exactly once, every replacement differs, ids are unique`, () => {
      const mutants = loadMutants(script);
      expect(mutants.length).toBeGreaterThanOrEqual(7);
      const result = checkMutantTargets(mutants, read);
      expect(result.problems).toEqual([]);
      expect(result.checked).toBe(mutants.length);
    });
  }

  it("the main list is the size the documents state (390) and the end-to-end list has 10", () => {
    expect(loadMutants("scripts/mutation-controls.mjs").length).toBe(390);
    expect(loadMutants("scripts/e2e-mutation-controls.mjs").length).toBe(10);
  });

  it("every mutant of the main list has a row in the negative-controls table (tests P2: 21 had none), and no row is listed twice", () => {
    const doc = read("docs/qa/negative-controls.md");
    const rows = [...doc.matchAll(/^\| (M\d+) \|/gm)].map((m) => m[1] as string);
    const ids = loadMutants("scripts/mutation-controls.mjs").map((entry) => String(entry[0]).split(" ")[0] as string);
    expect(ids.filter((id) => !rows.includes(id))).toEqual([]);
    const duplicated = [...new Set(rows.filter((id, i) => rows.indexOf(id) !== i))].sort();
    expect(duplicated, "one row per mutant: a mutant that changed meaning has its row rewritten, not repeated").toEqual([]);
  });

  it("the named mutants that the redactor's changes orphaned are targeted at the current source", () => {
    const byId = new Map(loadMutants("scripts/mutation-controls.mjs").map((entry) => [String(entry[0]).split(" ")[0], mutantFields(entry)]));
    for (const id of ["M57", "M82", "M115", "M123", "M151", "M152", "M229"]) {
      const m = byId.get(id);
      expect(m, id).toBeDefined();
      expect(read(m!.file).split(m!.find).length - 1, id).toBe(1);
    }
  });
});

describe("the instrument check goes red on a broken instrument", () => {
  const source = (file: string): string => (file === "a.ts" ? "one two two three" : "");
  it("a target that does not occur", () => {
    const result = checkMutantTargets([["M1 x", "a.ts", "absent", "y"]], source);
    expect(result.problems).toEqual(["M1 x: expected exactly one match of the mutation target in a.ts, found 0"]);
  });
  it("a target that occurs twice", () => {
    expect(checkMutantTargets([["M1 x", "a.ts", "two", "y"]], source).problems[0]).toContain("found 2");
  });
  it("a replacement that equals the target", () => {
    expect(checkMutantTargets([["M1 x", "a.ts", "one", "one"]], source).problems[0]).toContain("no-op");
  });
  it("a duplicate id and an unreadable file", () => {
    const result = checkMutantTargets(
      [
        ["M1 x", "a.ts", "one", "y"],
        ["M1 again", "a.ts", "three", "y"],
        ["M2 z", "missing.ts", "q", "r"],
      ],
      (file) => {
        if (file === "missing.ts") throw new Error("ENOENT");
        return source(file);
      },
    );
    expect(result.problems).toEqual(["M1: the id is used twice", "M2 z: missing.ts cannot be read"]);
  });
  it("an end-to-end entry (suite second) is read with its own field order", () => {
    expect(mutantFields(["E1 x", ["suite"], "a.ts", "one", "y"])).toEqual({ name: "E1 x", file: "a.ts", find: "one", replace: "y" });
    expect(checkMutantTargets([["E1 x", ["suite"], "a.ts", "absent", "y"]], source).problems).toHaveLength(1);
  });
  it("the report exit code is 0 for a clean list and 1 otherwise", () => {
    const quiet = console.log;
    console.log = () => undefined;
    try {
      expect(reportInstrumentCheck("x", { checked: 3, problems: [] })).toBe(0);
      expect(reportInstrumentCheck("x", { checked: 3, problems: ["p"] })).toBe(1);
    } finally {
      console.log = quiet;
    }
  });
});

describe("both harnesses expose the check on the command line (no build, no tests)", () => {
  for (const script of ["scripts/mutation-controls.mjs", "scripts/e2e-mutation-controls.mjs"]) {
    it(`${script} --check exits 0 on the current sources`, () => {
      const r = spawnSync(process.execPath, [join(root, script), "--check"], { cwd: root, encoding: "utf8" });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toMatch(/\d+ mutants checked, 0 problems/);
    });
    it(`${script} --check exits 1 and says INSTRUMENT_BROKEN when a target cannot match (MUTATION_CHECK_SELFTEST=1)`, () => {
      const r = spawnSync(process.execPath, [join(root, script), "--check"], { cwd: root, encoding: "utf8", env: { ...process.env, MUTATION_CHECK_SELFTEST: "1" } });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("INSTRUMENT_BROKEN ZZ-SELFTEST");
    });
  }
});

describe("a normal run of a harness checks its targets first, before any baseline or mutant", () => {
  for (const script of ["scripts/mutation-controls.mjs", "scripts/e2e-mutation-controls.mjs"]) {
    it(`${script} without --check stops at a target that cannot match, before it prints a baseline`, () => {
      const r = spawnSync(process.execPath, [join(root, script)], { cwd: root, encoding: "utf8", timeout: 60_000, env: { ...process.env, MUTATION_CHECK_SELFTEST: "1" } });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("INSTRUMENT_BROKEN ZZ-SELFTEST");
      expect(r.stdout + r.stderr).not.toContain("baseline");
    });
  }
});

describe("the quality gate runs the instrument check before the mutation controls, with a negative control", () => {
  const gate = read("scripts/verify-quality.sh");
  it("the check of both lists is a step that comes before the mutation controls", () => {
    const check = gate.indexOf("mutation-controls.mjs --check && node scripts/e2e-mutation-controls.mjs --check");
    const control = gate.indexOf("instrument_negative_control");
    const run = gate.indexOf('step "mutation controls (every seeded defect must turn the suite red)"');
    expect(check).toBeGreaterThan(0);
    expect(control).toBeGreaterThan(check);
    expect(run).toBeGreaterThan(control);
  });
  it("the negative control requires the check to fail and to name the broken target", () => {
    expect(gate).toContain("MUTATION_CHECK_SELFTEST=1");
    expect(gate).toContain("INSTRUMENT_BROKEN");
    expect(gate).toContain('step "instrument negative control');
  });
});
