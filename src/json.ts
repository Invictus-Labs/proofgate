import { ProofGateError } from "./errors.js";

/**
 * Strict JSON parsing for untrusted documents.
 *
 * `JSON.parse` silently keeps the LAST value of a duplicated key, so `{"result":"fail","result":"pass"}` would read as
 * a pass while the file visibly says fail. Every JSON document ProofGate reads (receipts, revision sets, reports and
 * bundle headers) goes through this parser, which rejects a duplicated key at any nesting level with the stable code
 * `json_duplicate_key` instead of choosing a winner. (YAML manifests reject duplicate keys in the YAML parser.)
 */

/** Returns the first duplicated object key found in already-valid JSON text, or undefined. Linear time, iterative. */
export function findDuplicateKey(text: string): string | undefined {
  // One frame per open container: a Set of keys for an object, null for an array.
  const stack: Array<Set<string> | null> = [];
  let expectKey = false;
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0x22 /* " */) {
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === 0x5c /* \ */) j += 2;
        else if (d === 0x22) break;
        else j += 1;
      }
      const top = stack[stack.length - 1];
      if (expectKey && top instanceof Set) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.has(key)) return key;
        top.add(key);
        expectKey = false;
      }
      i = j;
    } else if (c === 0x7b /* { */) {
      stack.push(new Set());
      expectKey = true;
    } else if (c === 0x5b /* [ */) {
      stack.push(null);
      expectKey = false;
    } else if (c === 0x7d /* } */ || c === 0x5d /* ] */) {
      stack.pop();
      expectKey = false;
    } else if (c === 0x2c /* , */) {
      expectKey = stack[stack.length - 1] instanceof Set;
    }
  }
  return undefined;
}

/**
 * Most objects and arrays one JSON document may hold. `JSON.parse` needs tens of bytes of heap per container however few
 * bytes the text spends on it, so a 9 MB file of `[[],[],[],...]` (3 million empty arrays) exhausted a 256 MB heap and
 * aborted the process. Measured: the report of a 5,000-requirement, 5-repository manifest (9.8 MB, at the documented
 * maximum requirement count) holds 115,013 containers, so a report at the 25 MB metadata ceiling holds about 300,000;
 * the limit leaves that comfortable room and stays far below the point where a 256 MB heap is exhausted.
 */
export const MAX_JSON_CONTAINERS = 500_000;

/**
 * Most values (array elements, object members, containers: the commas plus the containers) one JSON document may hold. The
 * container budget alone left a hole: `[1,1,1,...]` of 6 MB (3 million numbers) still aborted V8 at a 256 MB heap, because
 * `JSON.parse` also pays per element. Measured with the real reports: 335,052 values at 9.8 MB (5,000 requirements x 5
 * repositories) and 764,157 at 23.3 MB (2,000 x 40), so about 830,000 at the 25 MB metadata ceiling; a 2 million element array
 * still parses at 256 MB and 3 million does not. The limit sits between: legitimate reports have room, the abort cannot happen.
 */
export const MAX_JSON_VALUES = 1_500_000;

/**
 * Count `{` and `[` outside strings in one linear pass, without building anything, and refuse a document over
 * `MAX_JSON_CONTAINERS` BEFORE it is handed to `JSON.parse`. (The text need not be valid JSON yet; `JSON.parse` reports that.)
 */
export function assertJsonContainerBudget(text: string, label = "document", aggregate?: JsonAggregate): void {
  let containers = 0;
  let values = 0;
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0x22 /* " */) {
      i += 1;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d === 0x5c /* \ */) i += 2;
        else if (d === 0x22) break;
        else i += 1;
      }
    } else if (c === 0x7b || c === 0x5b) {
      containers += 1;
      values += 1;
      if (containers > MAX_JSON_CONTAINERS) {
        throw new ProofGateError(
          "limit_json_containers",
          `${label} holds more than ${MAX_JSON_CONTAINERS} objects and arrays, which cannot be parsed within a bounded amount of memory`,
          { limit: MAX_JSON_CONTAINERS },
        );
      }
    } else if (c === 0x2c /* , */) {
      values += 1;
    }
    if (values > MAX_JSON_VALUES) {
      throw new ProofGateError(
        "limit_json_values",
        `${label} holds more than ${MAX_JSON_VALUES} values (array elements, object members and containers), which cannot be parsed within a bounded amount of memory`,
        { limit: MAX_JSON_VALUES },
      );
    }
  }
  if (aggregate !== undefined) {
    aggregate.containers += containers;
    aggregate.values += values;
    if (aggregate.containers > MAX_AGGREGATE_CONTAINERS || aggregate.values > MAX_AGGREGATE_VALUES) {
      throw new ProofGateError(
        aggregate.containers > MAX_AGGREGATE_CONTAINERS ? "limit_json_containers" : "limit_json_values",
        `the receipt documents together hold more than ${aggregate.containers > MAX_AGGREGATE_CONTAINERS ? `${MAX_AGGREGATE_CONTAINERS} objects and arrays` : `${MAX_AGGREGATE_VALUES} values`} (reached at ${label}), which cannot be held within a bounded amount of memory`,
        { limit: aggregate.containers > MAX_AGGREGATE_CONTAINERS ? MAX_AGGREGATE_CONTAINERS : MAX_AGGREGATE_VALUES },
      );
    }
  }
}

/** Running totals over several documents that are all held in memory at once (the receipts of one evaluation). */
export interface JsonAggregate {
  containers: number;
  values: number;
}

/**
 * The same budgets over ALL the documents of a set. Each document was bounded on its own, but eight receipts of 490,000 empty
 * objects each (1.5 MB apiece) are far under 25 MB in total and still aborted V8 at a 256 MB heap. Two documents at the
 * per-document limit are allowed; more than that in total is refused before the document that crosses the line is parsed.
 */
export const MAX_AGGREGATE_CONTAINERS = 1_000_000;
export const MAX_AGGREGATE_VALUES = 3_000_000;

/**
 * Parse JSON text. Throws a `SyntaxError` for invalid JSON (callers map it to their own `*_invalid_json` code), a
 * ProofGateError `limit_json_containers` for a document with an unreasonable number of objects and arrays, and a
 * ProofGateError `json_duplicate_key` for a duplicated key.
 */
export function parseJsonStrict(text: string, label = "document", aggregate?: JsonAggregate): unknown {
  assertJsonContainerBudget(text, label, aggregate);
  const value = JSON.parse(text) as unknown;
  const duplicate = findDuplicateKey(text);
  if (duplicate !== undefined) {
    const shown = duplicate.length > 60 ? `${duplicate.slice(0, 60)}...` : duplicate;
    throw new ProofGateError("json_duplicate_key", `${label} repeats the key ${JSON.stringify(shown)}; which value applies would be ambiguous, so the document is rejected`);
  }
  return value;
}
