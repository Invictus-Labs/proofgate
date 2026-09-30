import { createHash } from "node:crypto";

export interface ParsedBundle {
  header: Record<string, unknown> & { entries: Array<{ path: string; size: number; sha256: string; role: string }> };
  bodies: Buffer[];
}

/** Split a bundle file into its header and entry bodies (test helper; trusts the input). */
export function parseBundleBuffer(buf: Buffer): ParsedBundle {
  const first = buf.indexOf(0x0a);
  const second = buf.indexOf(0x0a, first + 1);
  const header = JSON.parse(buf.toString("utf8", first + 1, second)) as ParsedBundle["header"];
  const bodies: Buffer[] = [];
  let pos = second + 1;
  for (const entry of header.entries) {
    bodies.push(buf.subarray(pos, pos + entry.size));
    pos += entry.size;
  }
  return { header, bodies };
}

/** Assemble a structurally valid bundle (correct sizes, entry hashes and trailer) from arbitrary content. */
export function assembleBundle(
  header: ParsedBundle["header"],
  entries: Array<{ path: string; role: string; bytes: Buffer }>,
  options: { magic?: string; headerOverrides?: Record<string, unknown> } = {},
): Buffer {
  const h = {
    ...header,
    ...options.headerOverrides,
    entries: entries.map((e) => ({ path: e.path, size: e.bytes.length, sha256: createHash("sha256").update(e.bytes).digest("hex"), role: e.role })),
    total_bytes: entries.reduce((n, e) => n + e.bytes.length, 0),
  };
  const canonical = JSON.stringify(sortKeys(h));
  const head = Buffer.from(`${options.magic ?? "PROOFGATE-BUNDLE 1"}\n${canonical}\n`);
  const body = Buffer.concat(entries.map((e) => e.bytes));
  const partial = Buffer.concat([head, body]);
  const trailer = Buffer.from(`PROOFGATE-END ${createHash("sha256").update(partial).digest("hex")}\n`);
  return Buffer.concat([partial, trailer]);
}

/**
 * Give a bundle whose body or header was edited a trailer that matches the edited bytes, as an attacker who can rewrite the
 * whole file would. Only the per-entry hashes recorded in the header can still notice a changed entry.
 */
export function resealTrailer(buf: Buffer): Buffer {
  const trailerLength = "PROOFGATE-END ".length + 64 + 1;
  const partial = buf.subarray(0, buf.length - trailerLength);
  return Buffer.concat([partial, Buffer.from(`PROOFGATE-END ${createHash("sha256").update(partial).digest("hex")}\n`)]);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}
