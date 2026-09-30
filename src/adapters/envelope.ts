import { z } from "zod";
import { canonicalize, hashCanonical } from "../canonical.js";
import { ProofGateError } from "../errors.js";
import { parseDocument, utcTimestamp } from "../schemas.js";

/**
 * Versioned event envelope for ecosystem adapters (PRD section 6):
 *   {schema_version:1, event_id, source, resource_id, event_type, occurred_at,
 *    revision, evidence_ref, correlation_id?}
 * Unsupported major versions and unknown fields are rejected. Delivery is
 * at-least-once, so consumers deduplicate by event_id and never infer current
 * state from an event that is older than one they already hold.
 *
 * ProofGate never writes envelopes anywhere and never dereferences
 * `evidence_ref`; it is an opaque string (for example `sha256:<hex>`).
 */

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/, "must be 1-200 characters of A-Z a-z 0-9 . _ : / @ -");

export const envelopeSchema = z.strictObject({
  schema_version: z.literal(1),
  event_id: identifier,
  source: identifier,
  resource_id: identifier,
  event_type: identifier,
  occurred_at: utcTimestamp,
  revision: z.string().min(1).max(200),
  evidence_ref: z.string().min(1).max(512),
  correlation_id: identifier.optional(),
});
export type EventEnvelope = z.infer<typeof envelopeSchema>;

export function parseEnvelope(raw: unknown, label = "event envelope"): EventEnvelope {
  return parseDocument(envelopeSchema, raw, "envelope", label);
}

export type DedupeOutcome = "accepted" | "duplicate" | "conflict";

/**
 * At-least-once consumer helper. `offer` returns:
 *   accepted   first time this (source, event_id) is seen
 *   duplicate  same source and event_id with identical content (safe to ignore)
 *   conflict   same source and event_id with different content (never applied)
 * `current` returns the newest accepted event per resource by occurred_at, then
 * event_id, so a late-arriving old event never displaces a newer one.
 */
export class EnvelopeDeduper {
  private readonly seen = new Map<string, string>();
  private readonly latest = new Map<string, EventEnvelope>();

  offer(input: unknown): { outcome: DedupeOutcome; event: EventEnvelope; superseded: boolean } {
    const event = parseEnvelope(input);
    const digest = hashCanonical(event);
    // Event ids are only unique per source: two sources may legitimately reuse an id, so the key is source + event_id.
    const dedupeKey = `${event.source}\u0000${event.event_id}`;
    const prior = this.seen.get(dedupeKey);
    if (prior !== undefined) {
      return { outcome: prior === digest ? "duplicate" : "conflict", event, superseded: false };
    }
    this.seen.set(dedupeKey, digest);
    const key = `${event.source}\u0000${event.resource_id}`;
    const current = this.latest.get(key);
    const newer = current === undefined || compareEvents(event, current) > 0;
    if (newer) this.latest.set(key, event);
    return { outcome: "accepted", event, superseded: !newer };
  }

  /** Strict variant: a conflicting redelivery is an error. */
  offerStrict(input: unknown): { outcome: "accepted" | "duplicate"; event: EventEnvelope; superseded: boolean } {
    const result = this.offer(input);
    if (result.outcome === "conflict") {
      throw new ProofGateError("envelope_conflict", `event_id ${result.event.event_id} from source ${result.event.source} was already received with different content`);
    }
    return { ...result, outcome: result.outcome };
  }

  current(source: string, resourceId: string): EventEnvelope | undefined {
    return this.latest.get(`${source}\u0000${resourceId}`);
  }
}

function compareEvents(a: EventEnvelope, b: EventEnvelope): number {
  const t = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  if (t !== 0) return t;
  return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
}

/** Canonical bytes of an envelope, for stable storage or hashing by consumers. */
export function envelopeBytes(envelope: EventEnvelope): string {
  return canonicalize(envelope);
}
