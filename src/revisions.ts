import { compareStrings, hashCanonical } from "./canonical.js";
import { ProofGateError } from "./errors.js";
import { parseJsonStrict } from "./json.js";
import type { NormalizedManifest } from "./schemas.js";
import { parseDocument, revisionsSchema, type Revision } from "./schemas.js";

export interface LoadedRevisions {
  revisions: Revision[];
  byRepository: Map<string, string>;
  revisions_hash: string;
}

export function parseRevisionsText(text: string, label = "revisions"): LoadedRevisions {
  let raw: unknown;
  try {
    raw = parseJsonStrict(text, label);
  } catch (error) {
    if (error instanceof ProofGateError) throw error;
    throw new ProofGateError("revisions_invalid_json", `${label} is not valid JSON`);
  }
  const parsed = parseDocument(revisionsSchema, raw, "revisions", label);
  const byRepository = new Map<string, string>();
  for (const rev of parsed.revisions) {
    if (byRepository.has(rev.repository)) {
      throw new ProofGateError("revisions_duplicate_repository", `${label} lists repository "${rev.repository}" more than once`);
    }
    byRepository.set(rev.repository, rev.commit_sha);
  }
  const revisions = [...byRepository.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([repository, commit_sha]) => ({ repository, commit_sha }));
  return { revisions, byRepository, revisions_hash: hashCanonical(revisions) };
}

/** Every declared repository needs exactly one full SHA, and no undeclared repository may appear. */
export function checkRevisionsAgainstManifest(revisions: LoadedRevisions, manifest: NormalizedManifest): void {
  const declared = new Set(manifest.repositories.map((r) => r.id));
  for (const repo of revisions.byRepository.keys()) {
    if (!declared.has(repo)) {
      throw new ProofGateError("revisions_unknown_repository", `revisions name repository "${repo}", which the manifest does not declare`, {
        repository: repo,
      });
    }
  }
  for (const repo of declared) {
    if (!revisions.byRepository.has(repo)) {
      throw new ProofGateError("revisions_missing_repository", `revisions have no commit SHA for declared repository "${repo}"`, {
        repository: repo,
      });
    }
  }
}
