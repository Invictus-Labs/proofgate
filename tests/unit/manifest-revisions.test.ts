import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computePolicyHash, parseManifestText, readInputFile } from "../../src/manifest.js";
import { checkRevisionsAgainstManifest, parseRevisionsText } from "../../src/revisions.js";
import { ProofGateError } from "../../src/errors.js";
import { withLimits } from "../../src/limits.js";
import { REPOS, baseManifest, baseRequirement } from "../helpers/fixture.js";

const parse = (m: Record<string, unknown>) => parseManifestText(stringify(m));
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as ProofGateError).code;
  }
  return "no-error";
};

describe("manifest parsing and normalisation", () => {
  it("fills defaults: all repositories, live-only execution kinds", () => {
    const { manifest } = parse(baseManifest({ requirements: [baseRequirement({ repositories: undefined })] }));
    const req = manifest.requirements[0];
    expect(req?.repositories).toEqual(["api", "web"]);
    expect(req?.allowed_execution_kinds).toEqual(["live"]);
    expect(req?.deferred).toBeUndefined();
  });

  it("sorts lists, keeps requirement order and carries descriptions and extensions", () => {
    const { manifest } = parse(
      baseManifest({
        repositories: [{ id: "web", description: "front end" }, { id: "api" }],
        requirements: [
          baseRequirement({ id: "REQ-B", repositories: ["web", "api"], allowed_execution_kinds: ["synthetic", "live", "live"] }),
          baseRequirement({ id: "REQ-A", deferred: { reason: "later" } }),
        ],
        extensions: { owner: "team-x" },
      }),
    );
    expect(manifest.repositories).toEqual([{ id: "api" }, { id: "web", description: "front end" }]);
    expect(manifest.requirements.map((r) => r.id)).toEqual(["REQ-B", "REQ-A"]);
    expect(manifest.requirements[0]?.repositories).toEqual(["api", "web"]);
    expect(manifest.requirements[0]?.allowed_execution_kinds).toEqual(["live", "synthetic"]);
    expect(manifest.requirements[1]?.deferred).toEqual({ reason: "later" });
    expect(manifest.extensions).toEqual({ owner: "team-x" });
  });

  it("normalisation is idempotent: the normalised manifest re-parses to the same hash (bundle restore depends on it)", () => {
    const first = parse(baseManifest({ requirements: [baseRequirement({ repositories: undefined, deferred: { reason: "x" } })], extensions: { a: 1 } }));
    const again = parseManifestText(JSON.stringify(first.manifest));
    expect(again.manifest_hash).toBe(first.manifest_hash);
    expect(again.policy_hash).toBe(first.policy_hash);
    expect(again.manifest).toEqual(first.manifest);
  });

  it("hashes are stable across YAML formatting and key order", () => {
    const a = parseManifestText("schema_version: 1\nname: n\nrepositories: [{id: api}]\nrequirements:\n  - {id: R1, title: t, severity: mandatory, required_level: unit, required_environment: e, max_age_seconds: 5}\n");
    const b = parseManifestText(`{"requirements":[{"max_age_seconds":5,"required_environment":"e","required_level":"unit","severity":"mandatory","title":"t","id":"R1"}],"repositories":[{"id":"api"}],"name":"n","schema_version":1}`);
    expect(a.manifest_hash).toBe(b.manifest_hash);
  });

  it("policy hash ignores titles, order and descriptions, but tracks every rule", () => {
    const base = parse(baseManifest());
    const same = (overrides: Record<string, unknown>) => parse(baseManifest({ requirements: [baseRequirement(overrides)] })).policy_hash === base.policy_hash;
    expect(same({ title: "different title" })).toBe(true);
    for (const change of [
      { severity: "advisory" },
      { required_level: "e2e" },
      { required_environment: "prod" },
      { max_age_seconds: 3599 },
      { repositories: ["api", "web"] },
      { allowed_execution_kinds: ["live", "mocked"] },
      { deferred: { reason: "x" } },
    ]) {
      // advisory alone would leave no mandatory requirement; add one so the manifest stays valid
      const m = baseManifest({ requirements: [baseRequirement(change), baseRequirement({ id: "REQ-2" })] });
      const changed = parse(m).policy_hash;
      const control = parse(baseManifest({ requirements: [baseRequirement(), baseRequirement({ id: "REQ-2" })] })).policy_hash;
      expect(changed, JSON.stringify(change)).not.toBe(control);
    }
    // reordering requirements does not change the policy
    const ab = parse(baseManifest({ requirements: [baseRequirement({ id: "A" }), baseRequirement({ id: "B" })] }));
    const ba = parse(baseManifest({ requirements: [baseRequirement({ id: "B" }), baseRequirement({ id: "A" })] }));
    expect(ab.policy_hash).toBe(ba.policy_hash);
    expect(ab.manifest_hash).not.toBe(ba.manifest_hash);
    expect(computePolicyHash(ab.manifest)).toBe(ab.policy_hash);
  });

  it("rejects YAML errors, warnings (unknown tags), duplicate YAML keys and alias bombs", () => {
    expect(codeOf(() => parseManifestText("a: [unclosed"))).toBe("manifest_parse_error");
    expect(codeOf(() => parseManifestText("a: !!python/object x"))).toBe("manifest_parse_error");
    expect(codeOf(() => parseManifestText("a: 1\na: 2\n"))).toBe("manifest_parse_error");
    const bomb = ["a: &a [x,x,x,x,x,x,x,x,x,x]", ...Array.from({ length: 6 }, (_, i) => `b${i}: &b${i} [${Array(10).fill(i === 0 ? "*a" : `*b${i - 1}`).join(",")}]`)].join("\n");
    expect(codeOf(() => parseManifestText(bomb))).toBe("manifest_parse_error");
  });

  it("rejects non-object documents and empty input as schema errors", () => {
    expect(codeOf(() => parseManifestText(""))).toBe("manifest_schema_invalid");
    expect(codeOf(() => parseManifestText("- a\n- b\n"))).toBe("manifest_schema_invalid");
    expect(codeOf(() => parseManifestText("just a string"))).toBe("manifest_schema_invalid");
  });

  it("rejects an unsupported schema_version, unknown fields, and a non-integer or missing version", () => {
    expect(codeOf(() => parse(baseManifest({ schema_version: 2 })))).toBe("unsupported_schema_version");
    expect(codeOf(() => parse(baseManifest({ schema_version: "1" })))).toBe("manifest_schema_invalid");
    expect(codeOf(() => parse(baseManifest({ schema_version: undefined })))).toBe("manifest_schema_invalid");
    expect(codeOf(() => parse(baseManifest({ owner: "x" })))).toBe("manifest_unknown_field");
    expect(codeOf(() => parse(baseManifest({ requirements: [baseRequirement({ owner: "x" })] })))).toBe("manifest_unknown_field");
  });

  it("validates field ranges", () => {
    for (const bad of [{ max_age_seconds: 0 }, { max_age_seconds: -1 }, { max_age_seconds: 1.5 }, { severity: "blocker" }, { required_level: "smoke" }, { id: "has space" }, { id: "" }, { title: "" }, { required_environment: "" }, { allowed_execution_kinds: [] }, { allowed_execution_kinds: ["prod"] }]) {
      expect(codeOf(() => parse(baseManifest({ requirements: [baseRequirement(bad)] }))), JSON.stringify(bad)).toBe("manifest_schema_invalid");
    }
    expect(codeOf(() => parse(baseManifest({ repositories: [] })))).toBe("manifest_schema_invalid");
    expect(codeOf(() => parse(baseManifest({ requirements: [] })))).toBe("manifest_schema_invalid");
  });

  it("rejects duplicate repositories (declared or within a requirement) and unknown repository references", () => {
    expect(codeOf(() => parse(baseManifest({ repositories: [{ id: "api" }, { id: "api" }] })))).toBe("manifest_duplicate_repository");
    expect(codeOf(() => parse(baseManifest({ requirements: [baseRequirement({ repositories: ["api", "api"] })] })))).toBe("manifest_schema_invalid");
    expect(codeOf(() => parse(baseManifest({ requirements: [baseRequirement({ repositories: ["nope"] })] })))).toBe("manifest_unknown_repository");
  });

  it("requires at least one mandatory requirement", () => {
    expect(codeOf(() => parse(baseManifest({ requirements: [baseRequirement({ severity: "advisory" })] })))).toBe("manifest_no_mandatory_requirements");
    expect(() => parse(baseManifest({ requirements: [baseRequirement({ deferred: { reason: "later" } })] }))).not.toThrow();
  });

  it("redacts secrets in the manifest before hashing and bounds extension depth", () => {
    const { manifest } = parse(baseManifest({ requirements: [baseRequirement({ title: "uses password: hunter2hunter2 here" })], extensions: { api_key: "abc" } }));
    expect(manifest.requirements[0]?.title).toContain("[REDACTED]");
    expect(manifest.extensions).toEqual({ api_key: "[REDACTED]" });
    let deep: unknown = 1;
    for (let i = 0; i < 30; i += 1) deep = { k: deep };
    expect(codeOf(() => parse(baseManifest({ extensions: deep as Record<string, unknown> })))).toBe("limit_json_depth");
  });
});

describe("revisions", () => {
  const doc = (revs: Array<{ repository: string; commit_sha: string }>, extra: Record<string, unknown> = {}) => JSON.stringify({ schema_version: 1, revisions: revs, ...extra });
  const good = [{ repository: "web", commit_sha: REPOS.web }, { repository: "api", commit_sha: REPOS.api }];

  it("parses, sorts by repository and hashes independent of input order", () => {
    const a = parseRevisionsText(doc(good));
    const b = parseRevisionsText(doc([...good].reverse()));
    expect(a.revisions.map((r) => r.repository)).toEqual(["api", "web"]);
    expect(a.revisions_hash).toBe(b.revisions_hash);
    expect(a.byRepository.get("api")).toBe(REPOS.api);
  });

  it("rejects invalid JSON, wrong version, unknown fields, bad SHAs and duplicates", () => {
    expect(codeOf(() => parseRevisionsText("{oops"))).toBe("revisions_invalid_json");
    expect(codeOf(() => parseRevisionsText(doc(good).replace('"schema_version":1', '"schema_version":9')))).toBe("unsupported_schema_version");
    expect(codeOf(() => parseRevisionsText(doc(good, { note: 1 })))).toBe("revisions_unknown_field");
    expect(codeOf(() => parseRevisionsText(doc([{ repository: "api", commit_sha: "abc123" }])))).toBe("revisions_invalid_commit_sha");
    expect(codeOf(() => parseRevisionsText(doc([]))).toString()).toBe("revisions_schema_invalid");
    expect(codeOf(() => parseRevisionsText(doc([good[1] as never, good[1] as never])))).toBe("revisions_duplicate_repository");
  });

  it("checks the revision set against the manifest in both directions", () => {
    const { manifest } = parse(baseManifest());
    expect(() => checkRevisionsAgainstManifest(parseRevisionsText(doc(good)), manifest)).not.toThrow();
    expect(codeOf(() => checkRevisionsAgainstManifest(parseRevisionsText(doc([good[1] as never])), manifest))).toBe("revisions_missing_repository");
    expect(codeOf(() => checkRevisionsAgainstManifest(parseRevisionsText(doc([...good, { repository: "x", commit_sha: "e".repeat(40) }])), manifest))).toBe("revisions_unknown_repository");
  });
});

describe("readInputFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pg-in-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads within the limit, refuses over it before reading, and reports missing files", async () => {
    await writeFile(join(dir, "m.yaml"), "hello");
    expect(await readInputFile(join(dir, "m.yaml"), withLimits({ maxMetadataBytes: 5 }), "manifest_not_found", "the manifest")).toEqual({ text: "hello", bytes: 5 });
    await expect(readInputFile(join(dir, "m.yaml"), withLimits({ maxMetadataBytes: 4 }), "manifest_not_found", "the manifest")).rejects.toMatchObject({ code: "limit_metadata_bytes" });
    await expect(readInputFile(join(dir, "none"), withLimits(), "revisions_not_found", "the revisions")).rejects.toMatchObject({ code: "revisions_not_found" });
    await expect(readInputFile(dir, withLimits(), "manifest_not_found", "the manifest")).rejects.toMatchObject({ code: "manifest_not_found" });
  });
});
