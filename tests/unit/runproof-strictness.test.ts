/**
 * Review round 4 (logic P3s): three ways a RunProof run could import as a pass while carrying a failure the importer did not read.
 *  - a required check definition that failed in an earlier evaluation and is simply ABSENT from the latest one;
 *  - an exit status under a spelling other than `exit_code` / `exitCode` (`exit_status`, `exitcode`, `returncode`, ...);
 *  - a `__proto__` key inside a check (LG3-6 covered only the run object), silently dropped by the schema.
 * Each is refused with a stable code instead of being read as "nothing to see".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptRunproofDocument } from "../../src/adapters/runproof.js";

const fixturePath = join(import.meta.dirname, "..", "fixtures", "runproof", "run-detail.fixture.json");
type Doc = Record<string, any>;
const load = (mutate: (d: Doc) => void = () => undefined): Doc => {
  const doc = JSON.parse(readFileSync(fixturePath, "utf8")) as Doc;
  doc.source_kind = "operator_capture";
  mutate(doc);
  return doc;
};
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};
const adapt = (d: Doc) => adaptRunproofDocument(d, "run.receipt.json");

describe("a required definition that failed earlier and is absent from the latest evaluation is refused", () => {
  const twoEvaluations = (d: Doc): void => {
    const [first, second] = d.run.checks as [Doc, Doc];
    // evaluation 1: both definitions, the first one FAILING; evaluation 2: only the second definition, passing
    first.evaluation = 1;
    first.state = "fail";
    second.evaluation = 1;
    d.run.checks.push({ ...second, id: "check-demo-manifest-2", evaluation: 2, state: "pass" });
    d.run.current_evaluation = 2;
  };

  it("the reviewer's case: evaluation 2 holds only the passing definition", () => {
    expect(adapt(load()).receipt.result).toBe("pass");
    expect(codeOf(() => adapt(load(twoEvaluations)))).toBe("runproof_outcome_mismatch");
  });

  it("controls: a definition that is re-checked in the latest evaluation is judged by the latest state; a non-required earlier definition is ignored", () => {
    const recheck = load((d) => {
      const [first, second] = d.run.checks as [Doc, Doc];
      first.evaluation = 1;
      first.state = "fail";
      second.evaluation = 1;
      d.run.checks.push({ ...first, id: "check-demo-report-2", evaluation: 2, state: "pass" }, { ...second, id: "check-demo-manifest-2", evaluation: 2 });
      d.run.current_evaluation = 2;
    });
    expect(adapt(recheck).receipt.result).toBe("pass");
    const optional = load((d) => {
      const [first, second] = d.run.checks as [Doc, Doc];
      first.evaluation = 1;
      first.state = "fail";
      first.required = false;
      second.evaluation = 1;
      d.run.checks.push({ ...second, id: "check-demo-manifest-2", evaluation: 2 });
      d.run.current_evaluation = 2;
    });
    expect(adapt(optional).receipt.result).toBe("pass");
  });
});

describe("an exit status under another spelling is refused, never read as no exit status", () => {
  it.each(["exit_status", "exitcode", "returncode", "return_code", "exitStatus", "ExitCode", "EXIT_CODE"])("%s", (name) => {
    expect(codeOf(() => adapt(load((d) => (d.run[name] = 3))))).toBe("runproof_schema_invalid");
    expect(codeOf(() => adapt(load((d) => (d.run[name] = 0))))).toBe("runproof_schema_invalid");
  });

  it("controls: exit_code and exitCode keep their meaning; a nested payload named exit_code is data", () => {
    expect(adapt(load((d) => (d.run.exit_code = 3))).receipt.result).toBe("fail");
    expect(adapt(load((d) => (d.run.exitCode = 3))).receipt.result).toBe("fail");
    expect(adapt(load()).receipt.result).toBe("pass"); // the fixture's events carry redacted_payload.exit_code
  });
});

describe("a plain `status` beside execution_status is refused (round 5: it imported a failed run as a pass)", () => {
  it.each(["status", "Status", "STATUS"])("%s: failed, and even a passing value", (name) => {
    expect(codeOf(() => adapt(load((d) => (d.run[name] = "failed"))))).toBe("runproof_schema_invalid");
    expect(codeOf(() => adapt(load((d) => (d.run[name] = "passed"))))).toBe("runproof_schema_invalid");
  });

  it("the message names the field and the fields that are read", () => {
    try {
      adapt(load((d) => (d.run.status = "failed")));
      expect.unreachable("the run should have been refused");
    } catch (error) {
      expect((error as Error).message).toContain('"status"');
      expect((error as Error).message).toContain("execution_status");
    }
  });

  // round 5, logic P3: the refusal was a list of spellings, and 17 other spellings of a verdict still imported as a pass
  it.each([
    "exit code",
    "exit.code",
    "Exit-Status",
    "exit",
    "exit_code ",
    "status ",
    "verdict",
    "result",
    "success",
    "ok",
    "failed",
    "passed",
    "state",
    "return_code",
    "returncode",
    "RETURN-STATUS",
    " status",
    "conclusion",
    "exit_signal",
    "signal",
    "error",
    "errors",
    "success_count",
    "failure_count",
    "timed_out",
    "cancelled",
  ])("the run field %j (a verdict under another spelling) is refused, not imported as a pass", (name) => {
    for (const value of ["failed", 1, false, true, "passed", 0]) expect(codeOf(() => adapt(load((d) => (d.run[name] = value)))), `${name}=${String(value)}`).toBe("runproof_schema_invalid");
  });

  it("controls: the exact exit_code and exitCode keep their meaning, and an ordinary field is preserved under unmapped_run_fields", () => {
    expect(adapt(load((d) => (d.run.exit_code = 0))).receipt.result).toBe("pass");
    expect(adapt(load((d) => (d.run.exitCode = 3))).receipt.result).toBe("fail");
    const withNote = adapt(load((d) => (d.run.trigger = "schedule")));
    expect(JSON.stringify(withNote.receipt.extensions)).toContain("schedule");
    expect(withNote.receipt.result).toBe("pass");
  });

  it("controls: execution_status keeps its meaning and a check's own state is data", () => {
    expect(adapt(load()).receipt.result).toBe("pass");
    expect(adapt(load((d) => (d.run.execution_status = "failed"))).receipt.result).toBe("fail");
  });
});

describe("a __proto__ key inside a check is refused like the one on the run", () => {
  it("run.checks[n]", () => {
    const doc = load();
    doc.run.checks[0] = JSON.parse(`{"__proto__":{"state":"fail"},${JSON.stringify(doc.run.checks[0]).slice(1)}`);
    expect(Object.hasOwn(doc.run.checks[0], "__proto__")).toBe(true);
    expect(codeOf(() => adapt(doc))).toBe("runproof_schema_invalid");
  });
});

describe("round 5: the checks are examined at every index, not only the first", () => {
  /** A passing extra check first, so that the check under test is NOT at index 0. */
  const withLeadingChecks = (d: Doc, count: number): void => {
    const template = d.run.checks[0] as Doc;
    const leading = Array.from({ length: count }, (_, i) => ({ ...template, id: `check-lead-${i}`, definition_id: `def-lead-${i}`, evaluation: 1, state: "pass" }));
    d.run.checks = [...leading, ...d.run.checks];
  };

  it("a dropped required definition at index 1, 2 and 5 is refused", () => {
    for (const lead of [1, 2, 5]) {
      const doc = load((d) => {
        withLeadingChecks(d, lead);
        const [first, second] = d.run.checks.slice(lead) as [Doc, Doc];
        first.evaluation = 1;
        first.state = "fail";
        second.evaluation = 1;
        d.run.checks.push({ ...second, id: "check-demo-manifest-2", evaluation: 2, state: "pass" });
        // the leading definitions are re-checked in evaluation 2, so only the dropped one is missing
        for (let i = 0; i < lead; i += 1) d.run.checks.push({ ...(d.run.checks[i] as Doc), id: `check-lead-${i}-2`, evaluation: 2 });
        d.run.current_evaluation = 2;
      });
      expect(codeOf(() => adapt(doc)), `${lead} leading checks`).toBe("runproof_outcome_mismatch");
    }
  });

  it("a __proto__ key in a check at index 1, 2 and the last index is refused", () => {
    for (const index of [1, 2, 4]) {
      const doc = load((d) => withLeadingChecks(d, 4));
      doc.run.checks[index] = JSON.parse(`{"__proto__":{"state":"fail"},${JSON.stringify(doc.run.checks[index]).slice(1)}`);
      expect(Object.hasOwn(doc.run.checks[index], "__proto__")).toBe(true);
      expect(codeOf(() => adapt(doc)), `index ${index}`).toBe("runproof_schema_invalid");
    }
  });

  it("controls: the same documents without the planted defect import as a pass", () => {
    expect(adapt(load((d) => withLeadingChecks(d, 3))).receipt.result).toBe("pass");
  });
});
