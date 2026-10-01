import { createHash } from "node:crypto";
import { ProofGateError, type ErrorCode } from "./errors.js";

/**
 * ProofGate canonical JSON, version 1 (compatible with RFC 8785 for the value
 * space ProofGate uses):
 *   - UTF-8, no insignificant whitespace;
 *   - object members sorted by key using UTF-16 code unit order;
 *   - strings and numbers serialised exactly as ECMAScript JSON.stringify does;
 *   - object members whose value is `undefined` are omitted;
 *   - NaN, Infinity, bigint, functions, symbols and non-plain objects are rejected.
 * Hashes are lowercase hex SHA-256 over the UTF-8 bytes of that encoding.
 */

const MAX_DEPTH = 64;

export function canonicalize(value: unknown): string {
  return encode(value, 0);
}

function encode(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new ProofGateError("limit_json_depth", `JSON nesting deeper than ${MAX_DEPTH} levels`);
  }
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical JSON cannot encode a non-finite number");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonical JSON cannot encode a value of type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => encode(item === undefined ? null : item, depth + 1)).join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("canonical JSON can only encode plain objects");
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => compareStrings(a, b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v, depth + 1)}`).join(",")}}`;
}

/** Locale-independent string ordering (UTF-16 code units), used for every deterministic sort. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 over the canonical encoding of a value. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/** Depth guard for untrusted parsed JSON (the receipt `extensions` escape hatch). */
export function assertJsonDepth(value: unknown, maxDepth: number, label: string): void {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop() as [unknown, number];
    if (current === null || typeof current !== "object") continue;
    if (depth > maxDepth) {
      throw new ProofGateError("limit_json_depth", `${label} is nested deeper than ${maxDepth} levels`);
    }
    const children = Array.isArray(current) ? current : Object.values(current as Record<string, unknown>);
    for (const child of children) stack.push([child, depth + 1]);
  }
}

/**
 * Refuse a parsed document that holds anything JSON cannot express: NaN or Infinity (JSON `1e400` and YAML `.inf` both parse
 * to Infinity), or an object that is not a plain object or array (the YAML tags `!!set`, `!!omap`, `!!binary` and
 * `!!timestamp` parse to Set, Map, Uint8Array and Date, which redaction would silently turn into `{}` and the canonical hash
 * could not tell apart). Such input used to end as an `internal_error` or, worse, as two different documents with one hash.
 * Iterative, so a deep document cannot overflow the stack.
 */
export function assertPlainJson(value: unknown, label: string, code: ErrorCode): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined) continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new ProofGateError(code, `${label} contains a number that JSON cannot express (NaN or Infinity, for example \`.inf\` or \`1e400\`)`);
      continue;
    }
    if (typeof current !== "object") {
      if (typeof current === "string" || typeof current === "boolean") continue;
      throw new ProofGateError(code, `${label} contains a value of type ${typeof current}, which JSON cannot express`);
    }
    if (Array.isArray(current)) {
      for (const child of current) stack.push(child);
      continue;
    }
    const proto = Object.getPrototypeOf(current) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      throw new ProofGateError(code, `${label} contains a ${Object.prototype.toString.call(current).slice(8, -1)} value (a YAML tag such as !!set, !!omap, !!binary or !!timestamp); use plain strings, numbers, booleans, lists and maps`);
    }
    for (const child of Object.values(current as Record<string, unknown>)) stack.push(child);
  }
}

/**
 * Deterministic UUID (RFC 9562 version 8, custom) derived from a sha256 digest,
 * so a fixed set of inputs and a fixed clock always yield the same identifier.
 */
export function uuidFromHash(hexDigest: string): string {
  const bytes = Buffer.from(hexDigest.slice(0, 32), "hex");
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
