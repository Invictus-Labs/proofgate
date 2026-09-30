/** Resource limits, enforced before any content is parsed or hashed. */
export interface Limits {
  /** Total bytes of manifest, revisions and receipt documents. Default 25 MB. */
  maxMetadataBytes: number;
  /** Maximum bytes of the YAML manifest. Default 4 MiB (see MAX_YAML_NODES for why the YAML limit is tighter). */
  maxManifestBytes: number;
  /** Maximum directory entries (files and directories) in the receipts tree, or entries in a bundle. Default 1000. */
  maxFiles: number;
  /** Total artifact/blob bytes in an evaluation or bundle. Default 250 MB; override is explicit. */
  maxBlobBytes: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxMetadataBytes: 25 * 1024 * 1024,
  maxManifestBytes: 4 * 1024 * 1024,
  maxFiles: 1000,
  maxBlobBytes: 250 * 1024 * 1024,
});

/**
 * Structure budget for a YAML manifest. The YAML library keeps roughly 1 KB of heap per node, and hostile shapes (millions
 * of `[`, a 4 MB block sequence of `- 1`) reach the byte limit long before they look big, so the byte cap alone does not
 * bound memory. The budget counts an upper estimate of structure (lines, flow separators and openers, `key:` colons and
 * `- ` entries, quoted or not); 150,000 is about 2,250 requirements that each list 50 repositories, or all 5,000 requirements
 * with up to 10 repositories listed, and needs well under 256 MB of heap.
 */
export const MAX_YAML_NODES = 150_000;

/** Depth cap for the free-form `extensions` object of untrusted documents. */
export const MAX_EXTENSION_DEPTH = 16;
/** Directory nesting cap for the receipts tree. */
export const MAX_DIRECTORY_DEPTH = 32;

export function withLimits(overrides?: Partial<Limits>): Limits {
  return { ...DEFAULT_LIMITS, ...overrides };
}
