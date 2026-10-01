import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptReceiptDocument, SUPPORTED_FORMATS } from "../../src/adapters/index.js";
import { adaptNativeReceipt } from "../../src/adapters/native.js";
import { adaptRunproofDocument } from "../../src/adapters/runproof.js";
import { EnvelopeDeduper, envelopeBytes, envelopeSchema, parseEnvelope } from "../../src/adapters/envelope.js";
import type { ProofGateError } from "../../src/errors.js";
import { NOW, REPOS, sha256, uuid } from "../helpers/fixture.js";

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as ProofGateError).code;
  }
  return "no-error";
};

const native = (o: Record<string, unknown> = {}) => ({
  schema_version: 1,
  receipt_id: uuid(1),
  requirement_ids: ["REQ-2", "REQ-1"],
  repository: "api",
  commit_sha: REPOS.api,
  runner_id: "r",
  environment: "staging",
  test_level: "unit",
  execution_kind: "live",
  result: "pass",
  tests: { total: 2, passed: 2, failed: 0, skipped: 0 },
  artifact: { path: "a/b.txt", sha256: sha256("x") },
  finished_at: NOW,
  ...o,
});

describe("native receipt adapter", () => {
  it("normalises: sorted requirement ids, null defaults, provenance native", () => {
    const out = adaptNativeReceipt(native(), "r.json");
    expect(out.receipt.requirement_ids).toEqual(["REQ-1", "REQ-2"]);
    expect(out.receipt.command).toBeNull();
    expect(out.receipt.extensions).toBeNull();
    expect(out.adapter).toEqual({ name: "proofgate.receipt", version: 1, provenance: "native" });
  });

  it("accepts the explicit format tag, a command and extensions verbatim", () => {
    const ext = { "vendor.x": { a: [1, { b: "c" }] } };
    const out = adaptNativeReceipt(native({ format: "proofgate.receipt", command: "npm test", extensions: ext }), "r.json");
    expect(out.receipt.command).toBe("npm test");
    expect(out.receipt.extensions).toEqual(ext);
  });

  it.each([
    [{ requirement_ids: ["REQ-1", "REQ-1"] }, "receipt_schema_invalid"],
    [{ requirement_ids: [] }, "receipt_schema_invalid"],
    [{ tests: { total: 3, passed: 1, failed: 1, skipped: 0 } }, "receipt_schema_invalid"],
    [{ tests: { total: -1, passed: -1, failed: 0, skipped: 0 } }, "receipt_schema_invalid"],
    [{ tests: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 1 } }, "receipt_unknown_field"],
    [{ finished_at: "2026-09-29T12:00:00+01:00" }, "receipt_schema_invalid"],
    [{ commit_sha: "abc" }, "receipt_invalid_commit_sha"],
    [{ receipt_id: "bad id!" }, "receipt_schema_invalid"],
    [{ test_level: "smoke" }, "receipt_schema_invalid"],
    [{ execution_kind: "real" }, "receipt_schema_invalid"],
    [{ result: "ok" }, "receipt_schema_invalid"],
    [{ schema_version: "1" }, "receipt_schema_invalid"],
    [{ schema_version: undefined }, "receipt_schema_invalid"],
    [{ schema_version: 7 }, "unsupported_schema_version"],
    [{ artifact: { path: "x", sha256: "short" } }, "receipt_schema_invalid"],
    [{ artifact: { path: "x", sha256: sha256("x"), url: "https://example.invalid" } }, "receipt_unknown_field"],
    [{ format: "proofgate.receipt.v2" }, "receipt_schema_invalid"],
    [{ command: "x".repeat(2001) }, "receipt_schema_invalid"],
  ])("rejects %j with %s", (override, code) => {
    expect(codeOf(() => adaptNativeReceipt(native(override as Record<string, unknown>), "r.json"))).toBe(code);
  });

  it("bounds extension depth", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 25; i += 1) deep = { k: deep };
    expect(codeOf(() => adaptNativeReceipt(native({ extensions: { deep } }), "r.json"))).toBe("limit_json_depth");
  });

  it("rejects non-object input without crashing", () => {
    expect(codeOf(() => adaptNativeReceipt(null, "r.json"))).toBe("receipt_schema_invalid");
    expect(codeOf(() => adaptNativeReceipt("str", "r.json"))).toBe("receipt_schema_invalid");
  });
});

describe("format routing", () => {
  it("routes by format, defaulting to native, and lists supported formats on rejection", () => {
    expect(adaptReceiptDocument(native(), "x").adapter.name).toBe("proofgate.receipt");
    expect(SUPPORTED_FORMATS).toEqual(["proofgate.receipt", "runproof.run-detail"]);
    try {
      adaptReceiptDocument({ format: "junit" }, "x.json");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as ProofGateError).code).toBe("adapter_unknown_format");
      expect((e as ProofGateError).detail).toEqual({ supported: SUPPORTED_FORMATS });
    }
    expect(codeOf(() => adaptReceiptDocument([], "x"))).toBe("receipt_schema_invalid");
    expect(codeOf(() => adaptReceiptDocument(null, "x"))).toBe("receipt_schema_invalid");
  });
});

describe("RunProof adapter", () => {
  const fixture = () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "runproof", "run-detail.fixture.json"), "utf8")) as Record<string, any>;
  const mutate = (fn: (d: Record<string, any>) => void) => {
    const d = fixture();
    fn(d);
    return adaptRunproofDocument(d, "rp.json");
  };
  const check = (o: Record<string, unknown>) => ({ id: "c", evaluation: 1, definition_id: "d", required: true, state: "pass", ...o });

  it("maps a verified run to a passing receipt and pins its provenance", () => {
    const { receipt, adapter } = adaptRunproofDocument(fixture(), "rp.json");
    expect(receipt).toMatchObject({
      receipt_id: "run-nightly-20260929",
      repository: "api",
      result: "pass",
      tests: { total: 2, passed: 2, failed: 0, skipped: 0 },
      execution_kind: "synthetic",
      finished_at: "2026-09-29T11:30:00.000Z",
      runner_id: "runproof-fixture",
      command: null,
    });
    expect(adapter).toEqual({ name: "runproof.run-detail", version: 1, provenance: "fixture" });
    const ext = receipt.extensions as any;
    expect(ext.runproof).toMatchObject({ main_sha: "5e2f9af3310655116535b31ca99ab92210178431", source_kind: "fixture", declared_execution_kind: "live", execution_kind_overridden: true, evaluation: 1, outcome: "verified" });
  });

  it("accepts real UUID run ids as well as opaque ids", () => {
    const id = uuid(7);
    expect(mutate((d) => (d.run.id = id)).receipt.receipt_id).toBe(id);
  });

  it("an operator capture keeps the declared execution kind; a fixture bound as synthetic is not flagged as overridden", () => {
    expect(mutate((d) => (d.source_kind = "operator_capture")).receipt.execution_kind).toBe("live");
    const asSynthetic = mutate((d) => (d.binding.execution_kind = "synthetic"));
    expect((asSynthetic.receipt.extensions as any).runproof.execution_kind_overridden).toBe(false);
    expect(mutate((d) => (d.source_kind = "operator_capture")).adapter.provenance).toBe("operator_capture");
  });

  it("uses only required checks of the latest evaluation", () => {
    const r = mutate((d) => {
      d.source_kind = "operator_capture";
      d.run.checks = [check({ id: "old", evaluation: 1, state: "fail" }), check({ id: "new", evaluation: 2 }), check({ id: "adv", evaluation: 2, required: false, state: "fail" })];
    });
    expect(r.receipt.tests).toEqual({ total: 1, passed: 1, failed: 0, skipped: 0 });
    expect(r.receipt.result).toBe("pass");
  });

  it.each([
    ["failed", ["fail"], "fail", { total: 1, passed: 0, failed: 1, skipped: 0 }],
    ["failed", ["pass"], "fail", { total: 1, passed: 1, failed: 0, skipped: 0 }],
    ["unknown", ["unknown"], "partial", { total: 1, passed: 0, failed: 0, skipped: 1 }],
    ["pending", ["pending"], "partial", { total: 1, passed: 0, failed: 0, skipped: 1 }],
    ["unknown", ["pass"], "partial", { total: 1, passed: 1, failed: 0, skipped: 0 }],
    ["failed", ["fail", "unknown"], "fail", { total: 2, passed: 0, failed: 1, skipped: 1 }],
  ])("outcome %s with checks %j maps to result %s", (outcome, states, result, tests) => {
    const r = mutate((d) => {
      d.source_kind = "operator_capture";
      d.run.outcome = outcome;
      d.run.checks = (states as string[]).map((state, i) => check({ id: `c${i}`, state }));
    });
    expect(r.receipt.result).toBe(result);
    expect(r.receipt.tests).toEqual(tests);
  });

  it("a run with no required checks is a skipped, zero-test receipt", () => {
    const r = mutate((d) => {
      d.run.outcome = "unknown";
      d.run.checks = [];
    });
    expect(r.receipt).toMatchObject({ result: "skipped", tests: { total: 0 } });
  });

  it("rejects verified runs that contradict their checks, unfinished runs, bad shapes and versions", () => {
    expect(codeOf(() => mutate((d) => (d.run.checks[0].state = "fail")))).toBe("runproof_outcome_mismatch");
    expect(codeOf(() => mutate((d) => (d.run.checks[0].state = "pending")))).toBe("runproof_outcome_mismatch");
    expect(codeOf(() => mutate((d) => (d.run.finished_at = null)))).toBe("runproof_run_unfinished");
    expect(codeOf(() => mutate((d) => (d.run.id = "not valid!")))).toBe("runproof_schema_invalid");
    expect(codeOf(() => mutate((d) => (d.run.checks = "x")))).toBe("runproof_schema_invalid");
    expect(codeOf(() => mutate((d) => (d.runproof.main_sha = "5e2f9af")))).toBe("runproof_invalid_commit_sha");
    expect(codeOf(() => mutate((d) => (d.binding.commit_sha = "short")))).toBe("runproof_invalid_commit_sha");
    expect(codeOf(() => mutate((d) => (d.schema_version = 2)))).toBe("unsupported_schema_version");
    expect(codeOf(() => mutate((d) => (d.binding.extra = 1)))).toBe("runproof_unknown_field");
    expect(codeOf(() => mutate((d) => delete d.binding))).toBe("runproof_schema_invalid");
  });

  it("preserves unmapped run fields and unknown check fields verbatim", () => {
    const r = mutate((d) => {
      d.run.brand_new_runproof_column = { nested: [1, 2, 3] };
      d.run.checks[0].future_field = "kept";
    });
    const ext = (r.receipt.extensions as any).runproof;
    expect(ext.unmapped_run_fields.brand_new_runproof_column).toEqual({ nested: [1, 2, 3] });
    expect(ext.checks[0].future_field).toBe("kept");
    expect(ext.unmapped_run_fields.id).toBeUndefined();
    expect(ext.unmapped_run_fields.checks).toBeUndefined();
  });

  it("dedupes requirement ids in the binding and defaults the runner id", () => {
    const r = mutate((d) => {
      d.binding.requirement_ids = ["REQ-2", "REQ-1", "REQ-2"];
      delete d.binding.runner_id;
    });
    expect(r.receipt.requirement_ids).toEqual(["REQ-1", "REQ-2"]);
    expect(r.receipt.runner_id).toBe("runproof");
  });
});

describe("event envelope", () => {
  const env = (o: Record<string, unknown> = {}) => ({
    schema_version: 1,
    event_id: "evt-1",
    source: "proofgate",
    resource_id: "res-1",
    event_type: "assessment.completed",
    occurred_at: NOW,
    revision: "1",
    evidence_ref: `sha256:${"a".repeat(64)}`,
    ...o,
  });

  it("validates identifiers and required fields", () => {
    expect(envelopeSchema.safeParse(env()).success).toBe(true);
    for (const bad of [{ event_id: "" }, { event_id: "has space" }, { source: "x".repeat(201) }, { revision: "" }, { evidence_ref: "" }, { correlation_id: "bad id" }, { occurred_at: "2026-09-29" }, { event_id: undefined }]) {
      expect(() => parseEnvelope(env(bad)), JSON.stringify(bad)).toThrow();
    }
    expect(codeOf(() => parseEnvelope(env({ extra: 1 })))).toBe("envelope_unknown_field");
    expect(codeOf(() => parseEnvelope(env({ schema_version: 2 })))).toBe("unsupported_schema_version");
    expect(codeOf(() => parseEnvelope(null))).toBe("envelope_schema_invalid");
  });

  it("dedupes, detects conflicts and orders by occurred_at then event_id", () => {
    const d = new EnvelopeDeduper();
    expect(d.offer(env()).outcome).toBe("accepted");
    expect(d.offer(env()).outcome).toBe("duplicate");
    expect(d.offer(env({ revision: "2" })).outcome).toBe("conflict");
    expect(codeOf(() => d.offerStrict(env({ revision: "2" })))).toBe("envelope_conflict");
    expect(d.offerStrict(env()).outcome).toBe("duplicate");

    // same timestamp: event_id decides, deterministically
    const t = new EnvelopeDeduper();
    t.offer(env({ event_id: "evt-b", occurred_at: NOW, revision: "b" }));
    const a = t.offer(env({ event_id: "evt-a", occurred_at: NOW, revision: "a" }));
    expect(a.superseded).toBe(true);
    expect(t.current("proofgate", "res-1")?.revision).toBe("b");
    const c = t.offer(env({ event_id: "evt-c", occurred_at: NOW, revision: "c" }));
    expect(c.superseded).toBe(false);
    expect(t.current("proofgate", "res-1")?.revision).toBe("c");
    expect(t.current("proofgate", "unknown")).toBeUndefined();
  });

  it("keeps resources from different sources apart and produces canonical bytes", () => {
    const d = new EnvelopeDeduper();
    d.offer(env({ event_id: "e1", source: "s1" }));
    d.offer(env({ event_id: "e2", source: "s2", revision: "9" }));
    expect(d.current("s1", "res-1")?.revision).toBe("1");
    expect(d.current("s2", "res-1")?.revision).toBe("9");
    expect(envelopeBytes(parseEnvelope(env()))).toBe(envelopeBytes(parseEnvelope({ ...env(), revision: "1" })));
  });
});
