import { assertJsonDepth } from "../canonical.js";
import { MAX_EXTENSION_DEPTH } from "../limits.js";
import { parseDocument, receiptSchema } from "../schemas.js";
import { ProofGateError } from "../errors.js";
import type { AdapterOutput } from "./types.js";

export const NATIVE_FORMAT = "proofgate.receipt";

/** Versioned local receipt JSON (schema_version 1). Unknown fields are rejected; `extensions` is preserved verbatim. */
export function adaptNativeReceipt(raw: unknown, label: string): AdapterOutput {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const ext = (raw as Record<string, unknown>).extensions;
    if (ext !== undefined) assertJsonDepth(ext, MAX_EXTENSION_DEPTH, `${label} extensions`);
  }
  const doc = parseDocument(receiptSchema, raw, "receipt", label);
  const ids = [...new Set(doc.requirement_ids)];
  if (ids.length !== doc.requirement_ids.length) {
    throw new ProofGateError("receipt_schema_invalid", `${label} lists a requirement id more than once`);
  }
  return {
    receipt: {
      receipt_id: doc.receipt_id,
      requirement_ids: ids.sort(),
      repository: doc.repository,
      commit_sha: doc.commit_sha,
      runner_id: doc.runner_id,
      environment: doc.environment,
      test_level: doc.test_level,
      execution_kind: doc.execution_kind,
      result: doc.result,
      tests: { ...doc.tests },
      artifact: { path: doc.artifact.path, sha256: doc.artifact.sha256 },
      finished_at: doc.finished_at,
      command: doc.command ?? null,
      extensions: doc.extensions ?? null,
    },
    adapter: { name: NATIVE_FORMAT, version: 1, provenance: "native" },
  };
}
