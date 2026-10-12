import { compareStrings, hashCanonical } from "./canonical.js";
import { adaptReceiptDocument, type AdapterInfo } from "./adapters/index.js";
import { ProofGateError } from "./errors.js";
import { RECEIPT_IDENTIFIER_PATHS, assertIdentifiersUnredacted, redactDocument } from "./identifiers.js";
import { parseJsonStrict } from "./json.js";
import { hashConfined, openRoot, readConfined, scanTree, validateRelativePath, type Root, type TreeFile } from "./fsguard.js";
import type { Limits } from "./limits.js";
import { redactString } from "./redact.js";
import type { NormalizedManifest, Receipt } from "./schemas.js";

export const RECEIPT_SUFFIX = ".receipt.json";

export interface LoadedReceipt {
  receipt: Receipt;
  adapter: AdapterInfo;
  /** Path of the source document relative to the receipts directory. */
  source_file: string;
  /** sha256 over the canonical encoding of the normalised (redacted) receipt. */
  content_sha256: string;
  /** The redacted source document exactly as parsed; this is what bundles store. */
  source_document: unknown;
  artifact_size: number;
}

export interface ReceiptSet {
  root: Root;
  receipts: LoadedReceipt[];
  files_scanned: number;
  receipt_documents: number;
  /** Bytes of receipt documents (manifest and revisions are counted by the caller). */
  metadata_bytes: number;
  artifact_bytes: number;
  tree: TreeFile[];
  /** Files that look like receipts but are not read (wrong-case suffix); listed so ignored evidence is never silent. */
  notes: string[];
}

/**
 * File names (at any depth) that may sit in the receipts tree without being a receipt or a receipt's artifact: a note for
 * the next operator and the placeholders that version control and the desktop leave behind. Everything else must be one of
 * the two, because a name-based guess about what "looks like evidence" (an extension list, the word "receipt") is beaten
 * by a name nobody thought of: `x.json.bak`, `x.jsonc`, `x.receipt.yaml`, `fail.txt`, `fail` all held a failing receipt
 * that the gate then silently ignored.
 */
export const ALLOWED_UNREFERENCED = ["README", "README.md", "README.txt", ".gitkeep", ".DS_Store"] as const;
const ALLOWED = new Set<string>(ALLOWED_UNREFERENCED);

function withFile<T>(rel: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ProofGateError && !error.message.includes(rel)) {
      throw new ProofGateError(error.code, `${rel}: ${error.message}`, { ...error.detail, file: rel });
    }
    throw error;
  }
}

/**
 * Load every `*.receipt.json` below `dir`. Order of operations matters for the
 * resource limits: the tree is counted before any read, receipt-document bytes
 * are summed from lstat before any parse, and artifact bytes are summed before
 * any artifact is hashed.
 */
export async function loadReceiptSet(
  dir: string,
  manifest: NormalizedManifest,
  limits: Limits,
  metadataBytesAlreadyUsed: number,
): Promise<ReceiptSet> {
  const root = await openRoot(dir, "receipts_dir_not_found", "the receipts path");
  const tree = await scanTree(root, limits);
  const receiptFiles = tree.filter((f) => f.rel.endsWith(RECEIPT_SUFFIX));
  const notes: string[] = [];

  const receiptBytes = receiptFiles.reduce((sum, f) => sum + f.size, 0);
  if (metadataBytesAlreadyUsed + receiptBytes > limits.maxMetadataBytes) {
    throw new ProofGateError(
      "limit_metadata_bytes",
      `receipt metadata is ${metadataBytesAlreadyUsed + receiptBytes} bytes, over the ${limits.maxMetadataBytes} byte limit`,
      { limit: limits.maxMetadataBytes },
    );
  }

  const requirementIds = new Set(manifest.requirements.map((r) => r.id));
  const repositoryIds = new Set(manifest.repositories.map((r) => r.id));
  const seenIds = new Map<string, string>();
  const parsed: Array<Pick<LoadedReceipt, "receipt" | "adapter" | "source_file" | "source_document">> = [];

  // The redacted documents are all held until the set is loaded: the budgets cover them together, not one at a time.
  const aggregate = { containers: 0, values: 0 };
  for (const file of receiptFiles) {
    const bytes = await readConfined(root, file.rel, limits.maxMetadataBytes, "artifact_missing", "limit_metadata_bytes");
    let raw: unknown;
    try {
      raw = parseJsonStrict(bytes.toString("utf8"), file.rel, aggregate);
    } catch (error) {
      if (error instanceof ProofGateError) throw new ProofGateError(error.code, error.message, { ...error.detail, file: file.rel });
      throw new ProofGateError("receipt_invalid_json", `${file.rel} is not valid JSON`, { file: file.rel });
    }
    const source_document = redactDocument(raw, RECEIPT_IDENTIFIER_PATHS);
    assertIdentifiersUnredacted(raw, source_document, RECEIPT_IDENTIFIER_PATHS, file.rel, "receipt_schema_invalid");
    const { receipt, adapter } = withFile(file.rel, () => adaptReceiptDocument(source_document, file.rel));
    withFile(file.rel, () => validateRelativePath(receipt.artifact.path));

    // Receipt ids are compared case-insensitively, like requirement ids: "RCPT-1" and "rcpt-1" are one identity, and a
    // second document under a case variant would otherwise be a way to shadow an earlier receipt in reports and explain.
    const foldedId = receipt.receipt_id.toLowerCase();
    const prior = seenIds.get(foldedId);
    if (prior !== undefined) {
      throw new ProofGateError("receipt_duplicate_id", `receipt id ${receipt.receipt_id} appears in both ${prior} and ${file.rel} (ids are compared case-insensitively)`, {
        receipt_id: receipt.receipt_id,
      });
    }
    seenIds.set(foldedId, file.rel);
    for (const id of receipt.requirement_ids) {
      if (!requirementIds.has(id)) {
        throw new ProofGateError("receipt_unknown_requirement", `${file.rel} references unknown requirement "${id}"`, {
          file: file.rel,
          requirement_id: id,
        });
      }
    }
    if (!repositoryIds.has(receipt.repository)) {
      throw new ProofGateError("receipt_unknown_repository", `${file.rel} names repository "${receipt.repository}", which the manifest does not declare`, {
        file: file.rel,
        repository: receipt.repository,
      });
    }
    parsed.push({ receipt, adapter, source_file: file.rel, source_document });
  }

  // No evidence is ignored silently: a failing receipt saved as "x.Receipt.JSON", "x.json.bak", "x.receipt.yaml" or "fail.txt"
  // beside a passing one would otherwise be a way to make the gate accept. Every file is (a) a receipt (*.receipt.json, exact
  // and lowercase), (b) an artifact that a receipt names, or (c) one of a few documented note and placeholder names (README,
  // .gitkeep, .DS_Store; their CONTENT is never read, so a receipt saved under one of those names is not evidence: that is
  // the documented meaning of the allow-list, and it is why the list is so short). Anything else is refused and the
  // operator renames it or moves it away.
  const referenced = new Set(parsed.map((p) => p.receipt.artifact.path));
  const unreferenced = tree.filter((f) => !f.rel.endsWith(RECEIPT_SUFFIX) && !referenced.has(f.rel) && !ALLOWED.has(f.rel.slice(f.rel.lastIndexOf("/") + 1)));
  if (unreferenced.length > 0) {
    throw new ProofGateError(
      "receipt_unreferenced_file",
      `${unreferenced.length} file(s) in the receipts directory are neither a receipt (a name ending in exactly "${RECEIPT_SUFFIX}", lowercase), nor an artifact that a receipt names, nor one of the allowed note files (${ALLOWED_UNREFERENCED.join(", ")}), so their content would be ignored: ${unreferenced
        .slice(0, 5)
        .map((f) => f.rel)
        .join(", ")}${unreferenced.length > 5 ? ", ..." : ""}; rename each one to end in "${RECEIPT_SUFFIX}" if it is a receipt, or move it out of the receipts directory`,
      { files: unreferenced.slice(0, 20).map((f) => f.rel) },
    );
  }

  // Artifact sizes come from the tree scan (lstat); the blob limit is enforced before any hashing.
  const sizeByPath = new Map(tree.map((f) => [f.rel, f.size]));
  const artifactSizes = new Map<string, number>();
  for (const { receipt, source_file } of parsed) {
    const size = sizeByPath.get(receipt.artifact.path);
    if (size === undefined) {
      throw new ProofGateError("artifact_missing", `${source_file}: artifact ${receipt.artifact.path} does not exist`, {
        file: source_file,
        artifact: receipt.artifact.path,
      });
    }
    artifactSizes.set(receipt.artifact.path, size);
  }
  const artifactBytes = [...artifactSizes.values()].reduce((a, b) => a + b, 0);
  if (artifactBytes > limits.maxBlobBytes) {
    throw new ProofGateError(
      "limit_blob_bytes",
      `referenced artifacts total ${artifactBytes} bytes, over the ${limits.maxBlobBytes} byte limit (raise it explicitly with --max-blob-bytes)`,
      { limit: limits.maxBlobBytes },
    );
  }

  // Recompute every artifact hash from the file; a mismatch is tampering, not a policy result.
  const actual = new Map<string, string>();
  for (const path of [...artifactSizes.keys()].sort()) {
    actual.set(path, (await hashConfined(root, path, "artifact_missing")).sha256);
  }
  for (const { receipt, source_file } of parsed) {
    const found = actual.get(receipt.artifact.path) as string;
    if (found !== receipt.artifact.sha256) {
      throw new ProofGateError(
        "artifact_hash_mismatch",
        `${source_file}: artifact ${receipt.artifact.path} hashes to ${found}, but the receipt declares ${receipt.artifact.sha256}`,
        { file: source_file, artifact: receipt.artifact.path, expected: receipt.artifact.sha256, actual: found },
      );
    }
  }

  // The name shown in the report and used as the bundle entry path must not carry a secret (a token can be part of a file
  // name), and must be UNIQUE and still end in ".receipt.json": two names that both redact to "[REDACTED].receipt.json"
  // collided into one bundle entry (a backup that could be written but not restored), and a name whose ending was consumed
  // by a redacted value was dropped on restore. So a name that redaction would change is replaced by a name derived from the
  // receipt's own (already redacted) content, `redacted-<16 hex>.receipt.json`, made unique if a real file already has it.
  // The real name was only needed above, to read the file and to word errors (which the CLI redacts on output).
  const unchanged = new Set(parsed.filter((p) => redactString(p.source_file) === p.source_file).map((p) => p.source_file));
  const taken = new Set(unchanged);
  const receipts: LoadedReceipt[] = parsed
    .map((p) => ({ ...p, content_sha256: hashCanonical(p.receipt), artifact_size: artifactSizes.get(p.receipt.artifact.path) as number }))
    .sort((a, b) => compareStrings(a.receipt.receipt_id, b.receipt.receipt_id))
    .map((r) => {
      if (unchanged.has(r.source_file)) return r;
      let name = `redacted-${r.content_sha256.slice(0, 16)}${RECEIPT_SUFFIX}`;
      for (let n = 2; taken.has(name); n += 1) name = `redacted-${r.content_sha256.slice(0, 16)}-${n}${RECEIPT_SUFFIX}`;
      taken.add(name);
      return { ...r, source_file: name };
    });

  return {
    root,
    receipts,
    files_scanned: tree.length,
    receipt_documents: receiptFiles.length,
    metadata_bytes: receiptBytes,
    artifact_bytes: artifactBytes,
    tree,
    notes,
  };
}

/** receipts_hash: order-independent digest of every receipt's normalised content. */
export function computeReceiptsHash(receipts: LoadedReceipt[]): string {
  return hashCanonical(
    receipts
      .map((r) => ({ receipt_id: r.receipt.receipt_id, content_sha256: r.content_sha256 }))
      .sort((a, b) => compareStrings(a.receipt_id, b.receipt_id)),
  );
}
