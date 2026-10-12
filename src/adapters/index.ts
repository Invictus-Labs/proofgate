import { assertPlainJson } from "../canonical.js";
import { ProofGateError } from "../errors.js";
import { adaptNativeReceipt, NATIVE_FORMAT } from "./native.js";
import { adaptRunproofDocument, RUNPROOF_FORMAT } from "./runproof.js";
import type { AdapterOutput } from "./types.js";

export type { AdapterInfo, AdapterOutput } from "./types.js";
export { NATIVE_FORMAT, RUNPROOF_FORMAT };

export const SUPPORTED_FORMATS = [NATIVE_FORMAT, RUNPROOF_FORMAT] as const;

/**
 * Route a parsed receipt document to its adapter by the `format` field. A
 * document without `format` is a native ProofGate receipt. An unknown format is
 * an explicit error, never a silent skip.
 */
export function adaptReceiptDocument(raw: unknown, label: string): AdapterOutput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProofGateError("receipt_schema_invalid", `${label} must be a JSON object`);
  }
  assertPlainJson(raw, label, "receipt_schema_invalid");
  const format = (raw as Record<string, unknown>).format;
  if (format === undefined || format === NATIVE_FORMAT) return adaptNativeReceipt(raw, label);
  if (format === RUNPROOF_FORMAT) return adaptRunproofDocument(raw, label);
  throw new ProofGateError("adapter_unknown_format", `${label} declares unsupported format ${JSON.stringify(String(format)).slice(0, 80)}`, {
    supported: [...SUPPORTED_FORMATS],
  });
}
