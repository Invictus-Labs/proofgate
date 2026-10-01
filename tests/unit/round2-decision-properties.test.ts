/**
 * Metamorphic properties of the decision engine (tests-reviewer, round 1). The example tests missed the zero-test P0
 * because every fixture used the shape that worked; these properties generate the shapes instead: random receipt sets
 * varying result, test counts (including zero), execution kind, environment, level, repository, commit and timestamps
 * (including future and boundary ones). Seeded, so a failure is reproducible from the printed seed.
 *
 *  P1  adding a receipt that matches the requirement (repository, commit, environment, level, live) and does not pass
 *      never turns a non-PASS requirement into PASS, and never turns a PASS into anything "better".
 *  P2  a matching, fresh failing receipt (result fail, or failed tests, zero tests included) forces FAIL.
 *  P3  a matching non-passing receipt, fresh or dated after `now`, never leaves the requirement at PASS.
 *  P4  a matching failing receipt dated after `now` still forces FAIL (it is held, not ignored).
 *  P5  the order of the receipts never changes the decision.
 *  P6  a zero-test "pass" is never PASS by itself, and never changes a decision that real evidence already decided.
 */
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { decideRequirement } from "../../src/evaluate.js";
import { hashCanonical } from "../../src/canonical.js";
import { parseManifestText } from "../../src/manifest.js";
import type { LoadedReceipt } from "../../src/receipt.js";
import { parseRevisionsText } from "../../src/revisions.js";
import type { NormalizedRequirement, Receipt } from "../../src/schemas.js";
import { NOW_MS, REPOS, baseManifest, baseRequirement, uuid } from "../helpers/fixture.js";

/** mulberry32: small, seeded, good enough for shrinking-free property tests. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)] as T;

const manifest = parseManifestText(stringify(baseManifest({ requirements: [baseRequirement({ max_age_seconds: 86_400 })] })));
const requirement = manifest.manifest.requirements[0] as NormalizedRequirement;
const revisions = parseRevisionsText(JSON.stringify({ schema_version: 1, revisions: [{ repository: "api", commit_sha: REPOS.api }, { repository: "web", commit_sha: REPOS.web }] }));
const decide = (receipts: LoadedReceipt[]) => decideRequirement(requirement, receipts, revisions, NOW_MS);

let counter = 10_000;
type Shape = { result: Receipt["result"]; total: number; failed: number; skipped: number };

function make(overrides: Partial<Receipt>, shape: Shape): LoadedReceipt {
  counter += 1;
  const passed = Math.max(0, shape.total - shape.failed - shape.skipped);
  const receipt: Receipt = {
    receipt_id: uuid(counter),
    requirement_ids: ["REQ-001"],
    repository: "api",
    commit_sha: REPOS.api,
    runner_id: "runner",
    environment: "staging",
    test_level: "integration",
    execution_kind: "live",
    result: shape.result,
    tests: { total: passed + shape.failed + shape.skipped, passed, failed: shape.failed, skipped: shape.skipped },
    artifact: { path: "a.txt", sha256: "a".repeat(64) },
    finished_at: new Date(NOW_MS - 60_000).toISOString(),
    command: null,
    extensions: null,
    ...overrides,
  };
  return { receipt, adapter: { name: "proofgate.receipt", version: 1, provenance: "native" }, source_file: `${receipt.receipt_id}.receipt.json`, content_sha256: hashCanonical(receipt), source_document: {}, artifact_size: 1 };
}

const SHAPES: Shape[] = [
  { result: "pass", total: 4, failed: 0, skipped: 0 },
  { result: "pass", total: 0, failed: 0, skipped: 0 },
  { result: "fail", total: 4, failed: 1, skipped: 0 },
  { result: "fail", total: 0, failed: 0, skipped: 0 },
  { result: "fail", total: 4, failed: 4, skipped: 0 },
  { result: "partial", total: 4, failed: 0, skipped: 1 },
  { result: "partial", total: 0, failed: 0, skipped: 0 },
  { result: "skipped", total: 4, failed: 0, skipped: 4 },
  { result: "skipped", total: 0, failed: 0, skipped: 0 },
];
const NOT_PASSING = SHAPES.filter((s) => s.result !== "pass" || s.total === 0 ? s.result !== "pass" : false);
const FAILING = SHAPES.filter((s) => s.result === "fail");

function randomReceipt(r: () => number): LoadedReceipt {
  const age = pick(r, [-3600, -1, 0, 1, 60, 3600, 86_399, 86_400, 86_401, 200_000]); // seconds before now; negative = future
  return make(
    {
      repository: pick(r, ["api", "api", "api", "web"] as const),
      commit_sha: pick(r, [REPOS.api, REPOS.api, REPOS.api, REPOS.web, "b".repeat(40)]),
      environment: pick(r, ["staging", "staging", "staging", "production"]),
      test_level: pick(r, ["integration", "integration", "integration", "unit"] as const),
      execution_kind: pick(r, ["live", "live", "live", "mocked", "synthetic"] as const),
      finished_at: new Date(NOW_MS - age * 1000).toISOString(),
    },
    pick(r, SHAPES),
  );
}

const randomSet = (r: () => number): LoadedReceipt[] => Array.from({ length: Math.floor(r() * 6) }, () => randomReceipt(r));
const matching = (r: () => number, shapes: Shape[], age: number): LoadedReceipt => make({ finished_at: new Date(NOW_MS - age * 1000).toISOString() }, pick(r, shapes));
const ROUNDS = 400;

describe("decision engine properties", () => {
  it("P1: adding a matching non-passing receipt never turns a non-PASS into PASS", () => {
    for (let seed = 1; seed <= ROUNDS; seed += 1) {
      const r = rng(seed);
      const base = randomSet(r);
      const before = decide(base).status;
      const extra = matching(r, NOT_PASSING, pick(r, [60, 3600, 80_000, -60, -3600]));
      const after = decide([...base, extra]).status;
      if (before !== "PASS") expect(after, `seed ${seed}: ${before} -> ${after}`).not.toBe("PASS");
      // "Better" than PASS does not exist; the check that matters is the one above and that a PASS can only get worse.
      if (after === "PASS") expect(before, `seed ${seed}`).toBe("PASS");
    }
  });

  it("P2: a matching fresh failing receipt forces FAIL, alone or beside anything", () => {
    for (let seed = 1; seed <= ROUNDS; seed += 1) {
      const r = rng(seed * 7);
      const failing = matching(r, FAILING, pick(r, [0, 1, 60, 3600, 80_000]));
      const decision = decide([...randomSet(r), failing]);
      expect(decision.status, `seed ${seed * 7}: ${JSON.stringify(failing.receipt.tests)} ${failing.receipt.finished_at}`).toBe("FAIL");
    }
  });

  it("P3: a matching non-passing receipt, fresh or future-dated, never leaves the requirement at PASS", () => {
    for (let seed = 1; seed <= ROUNDS; seed += 1) {
      const r = rng(seed * 13);
      const passing = matching(r, [SHAPES[0] as Shape], 60);
      const bad = matching(r, NOT_PASSING, pick(r, [0, 60, 3600, -1, -60, -86_400]));
      expect(decide([passing, bad]).status, `seed ${seed * 13}: ${bad.receipt.result} ${JSON.stringify(bad.receipt.tests)} ${bad.receipt.finished_at}`).not.toBe("PASS");
      expect(decide([bad, passing]).status).not.toBe("PASS");
    }
  });

  it("P4: a matching failing receipt dated after now is held as FAIL, never dropped in favour of an older pass", () => {
    for (let seed = 1; seed <= ROUNDS; seed += 1) {
      const r = rng(seed * 31);
      const passing = matching(r, [SHAPES[0] as Shape], pick(r, [60, 3600]));
      const future = matching(r, FAILING, pick(r, [-1, -60, -3600, -86_400]));
      const decision = decide([passing, future]);
      expect(decision.status, `seed ${seed * 31}: ${JSON.stringify(future.receipt.tests)} ${future.receipt.finished_at}`).toBe("FAIL");
      expect(decision.reason_codes).toContain("receipt_from_future");
    }
  });

  it("P5: the order of the receipts never changes the decision", () => {
    for (let seed = 1; seed <= ROUNDS; seed += 1) {
      const r = rng(seed * 101);
      const set = randomSet(r);
      const expected = JSON.stringify(decide(set));
      for (let k = 0; k < 4; k += 1) {
        const shuffled = [...set];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(r() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j] as LoadedReceipt, shuffled[i] as LoadedReceipt];
        }
        expect(JSON.stringify(decide(shuffled)), `seed ${seed * 101}`).toBe(expected);
      }
    }
  });

  it("P6: a zero-test pass proves nothing: alone it is MISSING, beside a set it changes nothing", () => {
    const zeroPass = SHAPES[1] as Shape;
    for (let seed = 1; seed <= ROUNDS; seed += 1) {
      const r = rng(seed * 53);
      const empty = matching(r, [zeroPass], pick(r, [0, 60, 3600]));
      expect(decide([empty]).status, `seed ${seed * 53}`).toBe("MISSING");
      const base = randomSet(r);
      const withReal = decide([...base, matching(r, [SHAPES[0] as Shape], 60)]);
      expect(decide([...base, matching(r, [SHAPES[0] as Shape], 60), empty]).status, `seed ${seed * 53}`).toBe(withReal.status);
    }
  });

  it("the generator really produces every kind of decision (the properties are not vacuous)", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= ROUNDS; seed += 1) seen.add(decide(randomSet(rng(seed))).status);
    for (const status of ["PASS", "FAIL", "STALE", "MISSING", "PARTIAL"]) expect(seen.has(status), status).toBe(true);
  });
});
