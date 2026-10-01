import { stat, readFile } from "node:fs/promises";
import { isScalar, parseDocument as parseYamlDocument, visit } from "yaml";
import { assertJsonDepth, assertPlainJson, compareStrings, hashCanonical } from "./canonical.js";
import { ProofGateError } from "./errors.js";
import { MANIFEST_IDENTIFIER_PATHS, assertIdentifiersUnredacted } from "./identifiers.js";
import { DEFAULT_LIMITS, MAX_EXTENSION_DEPTH, MAX_YAML_NODES, type Limits } from "./limits.js";
import { parseJsonStrict } from "./json.js";
import { redactValue } from "./redact.js";
import { manifestSchema, parseDocument, type NormalizedManifest, type NormalizedRequirement } from "./schemas.js";
import { POLICY_ENGINE_VERSION } from "./version.js";

export interface LoadedManifest {
  manifest: NormalizedManifest;
  /** sha256 over the canonical encoding of the normalised, redacted manifest. */
  manifest_hash: string;
  /** sha256 over the decision-relevant subset plus the engine policy version. */
  policy_hash: string;
}

/**
 * Cheap upper estimate of how much structure a YAML text holds, computed WITHOUT parsing it (the parser is what must be
 * protected: it needs about 1 KB of heap per node). Every newline, flow separator or opener, `:` and `- ` entry counts,
 * whether or not it sits inside a quoted string, so the estimate can only overcount. Throws limit_manifest_size when the
 * text is larger than the byte cap or the estimate is over MAX_YAML_NODES.
 */
export function assertYamlWithinBudget(text: string, label: string, maxBytes: number = DEFAULT_LIMITS.maxManifestBytes): void {
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ProofGateError("limit_manifest_size", `${label} is over the ${maxBytes} byte limit for a YAML manifest`, { limit: maxBytes });
  }
  let nodes = 1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    // \n, a bare \r (a line break to YAML; \r\n is counted once, by its \n), ",", "[", "{", ":"
    if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a) || c === 0x2c || c === 0x5b || c === 0x7b || c === 0x3a) nodes += 1;
    else if (c === 0x2d && (i === 0 || text.charCodeAt(i - 1) <= 0x20) && (i + 1 === text.length || text.charCodeAt(i + 1) <= 0x20)) nodes += 1;
    if (nodes > MAX_YAML_NODES) {
      throw new ProofGateError(
        "limit_manifest_size",
        `${label} holds more than ${MAX_YAML_NODES} YAML nodes (lines, list items, flow entries and keys); split the policy into several manifests`,
        { limit: MAX_YAML_NODES },
      );
    }
  }
}

export function parseManifestText(
  text: string,
  label = "manifest",
  maxBytes: number = DEFAULT_LIMITS.maxManifestBytes,
  format: "yaml" | "json" = "yaml",
): LoadedManifest {
  let raw: unknown;
  if (format === "json") {
    // The normalised manifest inside an evidence bundle is canonical JSON that this program wrote (its default
    // repository lists are expanded, so it can be far larger than the YAML it came from): it is parsed as strict
    // JSON, which needs none of the YAML parser's per-node memory.
    try {
      raw = parseJsonStrict(text, label);
    } catch (error) {
      if (error instanceof ProofGateError) throw error;
      throw new ProofGateError("manifest_parse_error", `${label} is not valid JSON`);
    }
    return finishManifest(raw, label);
  }
  assertYamlWithinBudget(text, label, maxBytes);
  try {
    // The parser's own duplicate-key check (`uniqueKeys: true`) is quadratic in the size of one mapping (40,000 keys took 10 s, 70,000
    // took over a minute), so it is off and the same rule is applied here in one linear pass over the parsed tree.
    const doc = parseYamlDocument(text, { schema: "core", uniqueKeys: false, prettyErrors: false });
    if (doc.errors.length > 0 || doc.warnings.length > 0) {
      const first = (doc.errors[0] ?? doc.warnings[0]) as { message: string };
      throw new ProofGateError("manifest_parse_error", `${label} is not valid YAML: ${first.message.split("\n")[0]}`);
    }
    let duplicated = false;
    let collectionKey = false;
    visit(doc, {
      Map(_key, node) {
        // Keys are compared by the text they become as JSON keys: `1` and `'1'`, `true` and `'true'` are one key in `extensions`.
        // A key that is itself a collection (`? [1]`) has no such text that is stable across spellings (`[1]`, `[ 1 ]`): refused.
        const seen = new Set<string>();
        for (const pair of node.items) {
          if (!isScalar(pair.key)) {
            collectionKey = true;
            return visit.BREAK;
          }
          const key = String(pair.key.value);
          if (seen.has(key)) {
            duplicated = true;
            return visit.BREAK;
          }
          seen.add(key);
        }
        return undefined;
      },
    });
    if (duplicated) throw new ProofGateError("manifest_parse_error", `${label} is not valid YAML: Map keys must be unique`);
    if (collectionKey) throw new ProofGateError("manifest_parse_error", `${label} is not valid YAML: a Map key must be a scalar, not a list or a mapping`);
    // Anchors and aliases are refused: an alias fan-out ("billion laughs") expands a few kilobytes into gigabytes.
    raw = doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof ProofGateError) throw error;
    const message = (error as Error).message.split("\n")[0] ?? "parse failure";
    const alias = /alias/i.test(message) ? " (anchors and aliases are not supported in manifests)" : "";
    throw new ProofGateError("manifest_parse_error", `${label} is not valid YAML: ${message}${alias}`);
  }
  return finishManifest(raw, label);
}

function finishManifest(raw: unknown, label: string): LoadedManifest {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const ext = (raw as Record<string, unknown>).extensions;
    if (ext !== undefined) assertJsonDepth(ext, MAX_EXTENSION_DEPTH, `${label} extensions`);
  }
  assertPlainJson(raw, label, "manifest_schema_invalid");
  const redacted = redactValue(raw);
  assertIdentifiersUnredacted(raw, redacted, MANIFEST_IDENTIFIER_PATHS, label, "manifest_schema_invalid");
  const parsed = parseDocument(manifestSchema, redacted, "manifest", label);
  const manifest = normalizeManifest(parsed);
  return { manifest, manifest_hash: hashCanonical(manifest), policy_hash: computePolicyHash(manifest) };
}

export function normalizeManifest(input: ReturnType<typeof manifestSchema.parse>): NormalizedManifest {
  const repoIds = new Set<string>();
  for (const repo of input.repositories) {
    if (repoIds.has(repo.id)) {
      throw new ProofGateError("manifest_duplicate_repository", `repository "${repo.id}" is declared more than once`);
    }
    repoIds.add(repo.id);
  }
  const allRepos = [...repoIds].sort();

  const seen = new Map<string, string>();
  const requirements: NormalizedRequirement[] = input.requirements.map((req) => {
    const folded = req.id.toLowerCase();
    if (seen.has(folded)) {
      throw new ProofGateError("manifest_duplicate_requirement_id", `requirement id "${req.id}" duplicates "${seen.get(folded)}"`, {
        requirement_id: req.id,
      });
    }
    seen.set(folded, req.id);

    const declared = req.repositories ?? allRepos;
    const unique = new Set(declared);
    if (unique.size !== declared.length) {
      throw new ProofGateError("manifest_schema_invalid", `requirement "${req.id}" lists a repository more than once`);
    }
    for (const repo of unique) {
      if (!repoIds.has(repo)) {
        throw new ProofGateError("manifest_unknown_repository", `requirement "${req.id}" references undeclared repository "${repo}"`, {
          requirement_id: req.id,
          repository: repo,
        });
      }
    }
    const kinds = [...new Set(req.allowed_execution_kinds ?? ["live"])].sort();
    const normalized: NormalizedRequirement = {
      id: req.id,
      title: req.title,
      severity: req.severity,
      required_level: req.required_level,
      required_environment: req.required_environment,
      max_age_seconds: req.max_age_seconds,
      repositories: [...unique].sort(),
      allowed_execution_kinds: kinds as NormalizedRequirement["allowed_execution_kinds"],
    };
    if (req.deferred) normalized.deferred = { reason: req.deferred.reason };
    return normalized;
  });

  if (!requirements.some((r) => r.severity === "mandatory")) {
    throw new ProofGateError(
      "manifest_no_mandatory_requirements",
      "the manifest declares no mandatory requirement, so an accepted verdict would be vacuous",
    );
  }

  const manifest: NormalizedManifest = {
    schema_version: 1,
    name: input.name,
    repositories: [...input.repositories]
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((r) => (r.description === undefined ? { id: r.id } : { id: r.id, description: r.description })),
    requirements,
  };
  if (input.extensions !== undefined) manifest.extensions = input.extensions;
  return manifest;
}

/**
 * The policy is everything that can change a decision: requirement rules,
 * declared repositories, deferral flags and the engine's rule version. Titles,
 * descriptions and requirement order are not policy.
 */
export function computePolicyHash(manifest: NormalizedManifest): string {
  return hashCanonical({
    policy_version: POLICY_ENGINE_VERSION,
    repositories: manifest.repositories.map((r) => r.id).sort(),
    requirements: [...manifest.requirements]
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((r) => ({
        id: r.id,
        severity: r.severity,
        required_level: r.required_level,
        required_environment: r.required_environment,
        max_age_seconds: r.max_age_seconds,
        repositories: r.repositories,
        allowed_execution_kinds: r.allowed_execution_kinds,
        deferred: r.deferred !== undefined,
      })),
  });
}

/** Read a small user-named input file with the metadata size limit applied before reading. */
export async function readInputFile(
  path: string,
  limits: Limits,
  notFound: "manifest_not_found" | "revisions_not_found",
  what: string,
  format: "yaml" | "json" = "yaml",
): Promise<{ text: string; bytes: number }> {
  let bytes: number;
  try {
    const st = await stat(path);
    if (!st.isFile()) throw new Error("not a file");
    bytes = st.size;
  } catch {
    throw new ProofGateError(notFound, `${what} file was not found or is not a regular file`);
  }
  if (notFound === "manifest_not_found" && format === "yaml" && bytes > limits.maxManifestBytes) {
    // Checked before the file is read: a YAML manifest has a tighter limit than JSON metadata (see MAX_YAML_NODES).
    throw new ProofGateError("limit_manifest_size", `${what} is ${bytes} bytes, over the ${limits.maxManifestBytes} byte limit for a YAML manifest`, {
      limit: limits.maxManifestBytes,
    });
  }
  if (bytes > limits.maxMetadataBytes) {
    throw new ProofGateError("limit_metadata_bytes", `${what} is ${bytes} bytes, over the ${limits.maxMetadataBytes} byte metadata limit`, {
      limit: limits.maxMetadataBytes,
    });
  }
  return { text: await readFile(path, "utf8"), bytes };
}
