import { ProofGateError, type ErrorCode } from "./errors.js";

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
