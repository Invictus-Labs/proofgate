/**
 * Review round 4 (tests P2): the identifier refusal was tested for some fields and for the first element only, so dropping
 * `run.id`, `binding.requirement_ids`, `binding.repository`, `binding.environment` or the per-requirement `repositories` from the
 * lists, or checking only the first element of an array of objects, survived every test. One case per path in EACH list, with the
 * credential-looking value at index 1 (never the first element), plus the paths the lists must contain.
 */
import { describe, expect, it } from "vitest";
import { MANIFEST_IDENTIFIER_PATHS, RECEIPT_IDENTIFIER_PATHS, assertIdentifiersUnredacted } from "../../src/identifiers.js";
import { redactValue } from "../../src/redact.js";

const secret = ["tok", "en=", "z".repeat(24)].join("");
type Path = readonly string[];
const ARRAY_LEAVES = new Set(["requirement_ids"]);

/** A document that holds `value` at `path`; a `*` step is an array of three objects with the value in the SECOND. */
function plant(path: Path, value: string): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (head === "*") return [plant(rest, "plain-1"), plant(rest, value), plant(rest, "plain-3")];
  if (rest.length === 0) return { [head]: ARRAY_LEAVES.has(head) || (head === "repositories" && path.length === 1) ? ["plain-1", value] : value };
  return { [head]: plant(rest, value) };
}
/** `["requirements","*","repositories"]`: a per-element array of ids, so the leaf is an array too. */
function plantPath(path: Path, value: string): unknown {
  const leafIsArray = path[path.length - 1] === "repositories" && path[0] === "requirements";
  if (!leafIsArray) return plant(path, value);
  const [a, star, leaf] = path as [string, string, string];
  return { [a]: [{ [leaf]: ["plain-1", "plain-2"] }, { [leaf]: ["plain-1", value] }, { [leaf]: ["plain-3"] }], _: star };
}

const label = (path: Path): string => path.join(".");

describe.each([
  ["receipt", RECEIPT_IDENTIFIER_PATHS, "receipt_schema_invalid" as const],
  ["manifest", MANIFEST_IDENTIFIER_PATHS, "manifest_schema_invalid" as const],
])("%s identifier paths", (_name, paths, code) => {
  it.each(paths.map((p) => [label(p), p] as const))("a credential-looking value at %s (index 1 of an array) is refused, naming the field", (_label, path) => {
    const raw = plantPath(path, secret);
    const redacted = redactValue(raw);
    expect(JSON.stringify(redacted), "the value really is rewritten by redaction").not.toBe(JSON.stringify(raw));
    let caught: { code?: string; message?: string; detail?: { field?: string } } | undefined;
    try {
      assertIdentifiersUnredacted(raw, redacted, [path], "doc.json", code);
    } catch (error) {
      caught = error as typeof caught;
    }
    expect(caught?.code, `${label(path)} was not refused`).toBe(code);
    expect(caught?.message).toContain("looks like a credential");
    expect(caught?.detail?.field?.endsWith(path[path.length - 1] as string), caught?.detail?.field).toBe(true);
  });

  it.each(paths.map((p) => [label(p), p] as const))("control: plain identifiers at %s are accepted", (_label, path) => {
    const raw = plantPath(path, "plain-2");
    expect(() => assertIdentifiersUnredacted(raw, redactValue(raw), [path], "doc.json", code)).not.toThrow();
  });
});

describe("the lists hold every field that is compared or reported as an identifier", () => {
  it("receipt: native fields and the RunProof wrapper's run id and binding", () => {
    const listed = new Set(RECEIPT_IDENTIFIER_PATHS.map(label));
    for (const path of ["receipt_id", "requirement_ids", "repository", "environment", "run.id", "binding.requirement_ids", "binding.repository", "binding.environment"]) {
      expect(listed.has(path), path).toBe(true);
    }
  });
  it("manifest: repository ids, requirement ids, required_environment and per-requirement repositories", () => {
    const listed = new Set(MANIFEST_IDENTIFIER_PATHS.map(label));
    for (const path of ["repositories.*.id", "requirements.*.id", "requirements.*.required_environment", "requirements.*.repositories"]) expect(listed.has(path), path).toBe(true);
  });
  it("runner_id is only reported, never compared, and is deliberately absent", () => {
    expect(RECEIPT_IDENTIFIER_PATHS.map(label)).not.toContain("runner_id");
  });
});

describe("an identifier that cannot even be serialised is a schema error, not an internal error", () => {
  // On Node 22.12 JSON.stringify overflows its stack for a value nested about 5,000 levels deep (Node 25 copes with more), so an
  // identifier of that shape used to end as internal_error. The failure is simulated here so the branch is exercised on any Node.
  const overflowing = { get toJSON(): () => never { return () => { throw new RangeError("Maximum call stack size exceeded"); }; } };

  it("names the field and refuses", () => {
    const raw = { receipt_id: overflowing };
    let caught: { code?: string; message?: string; detail?: { field?: string } } | undefined;
    try {
      assertIdentifiersUnredacted(raw, { receipt_id: "x" }, [["receipt_id"]], "deep.receipt.json", "receipt_schema_invalid");
    } catch (error) {
      caught = error as typeof caught;
    }
    expect(caught?.code).toBe("receipt_schema_invalid");
    expect(caught?.message).toContain("nested too deeply");
    expect(caught?.detail?.field).toBe("receipt_id");
  });

  it("the same for an element of a list", () => {
    expect(() => assertIdentifiersUnredacted({ requirement_ids: ["a", overflowing] }, { requirement_ids: ["a", "b"] }, [["requirement_ids"]], "x", "receipt_schema_invalid")).toThrow(/nested too deeply/);
  });
});
