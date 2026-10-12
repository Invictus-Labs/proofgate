import { ProofGateError, type ErrorCode } from "./errors.js";
import { redactString, redactValue } from "./redact.js";

/**
 * Identifier fields are COMPARED (a receipt's environment against the required one, its repository and requirement ids
 * against the manifest's), and redaction runs on the raw document before that comparison. Two different values that both
 * look like a credential (`token=abcdefghijklmnop1234` and `token=zzzzzzzzzzzzzzzzzzzz`) redact to the SAME text, so they
 * matched: a receipt for another environment satisfied the requirement. An identifier that redaction would rewrite is
 * therefore refused with a message that says why, instead of being compared in its redacted form or failing later with an
 * unrelated schema error.
 */
type Path = readonly string[];

function pick(value: unknown, path: Path): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** `path` may contain "*" to stand for every element of an array at that position. */
function expand(value: unknown, path: Path, prefix: string[] = []): Array<{ where: string; value: unknown }> {
  const at = path.indexOf("*");
  if (at === -1) return [{ where: [...prefix, ...path].join("."), value: pick(value, path) }];
  const list = pick(value, path.slice(0, at));
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, i) => expand(item, path.slice(at + 1), [...prefix, ...path.slice(0, at), String(i)]));
}

export function assertIdentifiersUnredacted(raw: unknown, redacted: unknown, paths: readonly Path[], label: string, code: ErrorCode): void {
  for (const path of paths) {
    const before = expand(raw, path);
    const after = expand(redacted, path);
    for (const [i, entry] of before.entries()) {
      let differs: boolean;
      try {
        differs = JSON.stringify(entry.value) !== JSON.stringify(after[i]?.value);
      } catch {
        // An identifier nested hundreds of thousands of levels deep overflows the stack of JSON.stringify: it is not an identifier.
        throw new ProofGateError(code, `${label}: ${entry.where} is nested too deeply to be an identifier`, { field: entry.where });
      }
      if (differs) {
        throw new ProofGateError(
          code,
          `${label}: ${entry.where} contains text that looks like a credential, which redaction rewrites, so it cannot be compared or reported; use a plain identifier there`,
          { field: entry.where },
        );
      }
    }
  }
}

/**
 * The receipt fields that are COMPARED or used as identifiers, in a native receipt and in a RunProof wrapper's binding. runner_id
 * is only reported, never compared, so redacting it (an address or a token in it) is safe and it is not listed.
 */
export const RECEIPT_IDENTIFIER_PATHS: readonly Path[] = [
  ["receipt_id"],
  ["requirement_ids"],
  ["repository"],
  ["environment"],
  ["run", "id"],
  ["binding", "requirement_ids"],
  ["binding", "repository"],
  ["binding", "environment"],
];

/** The manifest fields that are compared or used as identifiers. */
export const MANIFEST_IDENTIFIER_PATHS: readonly Path[] = [
  ["repositories", "*", "id"],
  ["requirements", "*", "id"],
  ["requirements", "*", "required_environment"],
  ["requirements", "*", "repositories"],
];

/** The report fields that hold lists of identifiers (each element was checked unredacted when its source document was loaded). */
export const REPORT_IDENTIFIER_LIST_PATHS: readonly Path[] = [
  ["requirements", "*", "repositories"],
  ["requirements", "*", "receipt_ids"],
  ["requirements", "*", "environments"],
  ["requirements", "*", "per_repository", "*", "receipt_ids"],
  ["receipts", "*", "requirement_ids"],
];

/** The places `path` reaches in `value`, as [parent, key] pairs, so the value there can be replaced. */
function slots(value: unknown, path: Path): Array<[Record<string, unknown> | unknown[], string]> {
  const [head, ...rest] = path;
  if (head === undefined || value === null || typeof value !== "object") return [];
  if (head === "*") {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, i) => (rest.length === 0 ? [[value, String(i)] as [unknown[], string]] : slots(item, rest)));
  }
  if (Array.isArray(value) || !Object.hasOwn(value, head)) return [];
  const record = value as Record<string, unknown>;
  return rest.length === 0 ? [[record, head]] : slots(record[head], rest);
}

/**
 * Deep-redact a document, but judge the elements of the identifier lists at `paths` one by one. The list-pair rule
 * (`["--password", "S"]`: the element after a credential name is a value) is for argument lists; applied to a list of ids it
 * rewrote the id after `AUTH-001`, `auth` or `auth-e2e-api-001`, so legitimate manifests and receipts were refused and a finished
 * report was written with `[REDACTED]` in place of an evidence id. A credential-looking id is still rewritten here (and refused by
 * assertIdentifiersUnredacted).
 */
export function redactDocument<T>(raw: T, paths: readonly Path[]): T {
  const redacted = redactValue(raw);
  for (const path of paths) {
    const before = slots(raw, path);
    const after = slots(redacted, path);
    if (before.length !== after.length) continue;
    for (const [i, [parent, key]] of before.entries()) {
      const list = (parent as Record<string, unknown>)[key];
      const [target, targetKey] = after[i] as [Record<string, unknown>, string];
      if (!Array.isArray(list) || !Array.isArray(target[targetKey]) || (target[targetKey] as unknown[]).length !== list.length) continue;
      target[targetKey] = list.map((item: unknown) => (typeof item === "string" ? redactString(item) : redactValue(item)));
    }
  }
  return redacted;
}
