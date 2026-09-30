/**
 * Review round 1, S1 + P1 (P1): hostile YAML inside the 25 MB metadata limit killed the CLI with a V8 out-of-memory abort
 * (3 MB of "[", a 4 MB block sequence, an alias fan-out) instead of exit 2 with a stable code. The manifest now has a
 * 4 MiB byte cap, a structure budget checked before the parser runs, and no aliases. Each hostile case below runs the
 * packaged CLI with a small V8 heap (--max-old-space-size=256) so an abort is a test failure. Fails on the delivered tree.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertYamlWithinBudget, parseManifestText } from "../../src/manifest.js";
import { MAX_YAML_NODES } from "../../src/limits.js";
import { errorCode, evalArgs, runCli, runDist } from "../helpers/cli.js";
import { NOW, baseManifest, baseRequirement, makeWorkspace, passingWorkspace, writeManifest, writeRevisions, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});
async function ws(): Promise<Workspace> {
  const w = await passingWorkspace();
  made.push(w);
  return w;
}
const LOW_HEAP = ["--max-old-space-size=256"];
const MB = 1024 * 1024;

/** 24 levels that double at every step: 48 aliases (under the old cap of 50) that expand to 16 million elements. */
const aliasBomb = (): string => {
  const lines = ["a0: &a0 [x]"];
  for (let i = 1; i <= 24; i += 1) lines.push(`a${i}: &a${i} [*a${i - 1}, *a${i - 1}]`);
  return `${lines.join("\n")}\n`;
};

describe("hostile YAML manifests are refused before the parser can exhaust memory (packaged CLI, 256 MB heap)", () => {
  const shapes: Array<[string, () => string, string]> = [
    ["3 MB of unclosed [", () => "[".repeat(3 * MB), "limit_manifest_size"],
    ["a 3 MB block sequence of '- 1'", () => "- 1\n".repeat((3 * MB) / 4), "limit_manifest_size"],
    ["a 3 MB flow sequence", () => `[${"1,".repeat((3 * MB) / 2)}1]`, "limit_manifest_size"],
    ["a 24 MB block sequence (over the byte cap)", () => "- 1\n".repeat(6 * MB), "limit_manifest_size"],
    ["a deeply indented block nest", () => Array.from({ length: 160_000 }, (_, i) => `${" ".repeat(i % 500)}- a`).join("\n"), "limit_manifest_size"],
    ["an alias fan-out (anchors and aliases)", aliasBomb, "manifest_parse_error"],
  ];

  it.each(shapes)("%s: exit 2 with a stable code, no abort, in bounded time", async (_name, make, code) => {
    const w = await ws();
    await writeFile(w.manifestPath, make());
    const t0 = Date.now();
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: LOW_HEAP });
    expect(r.code, r.stderr.slice(0, 300)).toBe(2);
    expect(errorCode(r)).toBe(code);
    expect(r.stderr).not.toMatch(/heap out of memory|SIGABRT|FATAL/i);
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
});

describe("assertYamlWithinBudget and parseManifestText", () => {
  it("counts an upper estimate of structure: the budget boundary is exact, and quoted text counts too", () => {
    const line = "- a\n"; // one newline + one dash entry = 2 per line
    const atLimit = "x".repeat(0) + line.repeat(Math.floor((MAX_YAML_NODES - 1) / 2));
    expect(() => assertYamlWithinBudget(atLimit, "m")).not.toThrow();
    expect(() => assertYamlWithinBudget(line.repeat(MAX_YAML_NODES), "m")).toThrowError(/YAML nodes/);
    expect(() => assertYamlWithinBudget(`'${"a,".repeat(MAX_YAML_NODES)}'`, "m")).toThrowError(/YAML nodes/);
  });

  it("refuses text over the byte cap before looking at it, counting bytes not characters", () => {
    expect(() => assertYamlWithinBudget("é".repeat(2 * MB + 1), "m")).toThrowError(/byte limit/);
    expect(() => assertYamlWithinBudget("a".repeat(4 * MB), "m")).not.toThrow();
    expect(() => assertYamlWithinBudget("a".repeat(4 * MB + 1), "m")).toThrowError(/byte limit/);
    expect(() => assertYamlWithinBudget("abc", "m", 2)).toThrowError(/byte limit/);
  });

  it("any alias is refused with an explicit reason; anchors alone are harmless", () => {
    const base = "schema_version: 1\nname: x\nrepositories:\n  - id: api\nrequirements:\n  - id: R1\n    title: t\n    severity: mandatory\n    required_level: unit\n    required_environment: ci\n    max_age_seconds: 60\n";
    expect(() => parseManifestText(`${base}    repositories: &r [api]\n`)).not.toThrow();
    expect(() => parseManifestText(`${base}    repositories: &r [api]\nextra: *r\n`)).toThrowError(/anchors and aliases are not supported/);
  });

  it("a 1,500-requirement manifest that lists 50 repositories per requirement still parses (documented capacity)", () => {
    const repos = Array.from({ length: 50 }, (_, i) => `repo-${i}`);
    const lines = ["schema_version: 1", "name: big", "repositories:", ...repos.map((r) => `  - id: ${r}`), "requirements:"];
    for (let i = 0; i < 1500; i += 1) lines.push(`  - id: REQ-${i}`, `    title: "Requirement ${i}"`, "    severity: mandatory", "    required_level: unit", "    required_environment: ci", "    max_age_seconds: 3600", `    repositories: [${repos.join(", ")}]`);
    const loaded = parseManifestText(`${lines.join("\n")}\n`);
    expect(loaded.manifest.requirements.length).toBe(1500);
  });

  it("the canonical JSON manifest of a bundle is parsed as strict JSON, so its expanded repository lists need no YAML budget", () => {
    const repos = Array.from({ length: 40 }, (_, i) => `repo-${i}`);
    const doc = {
      schema_version: 1,
      name: "expanded",
      repositories: repos.map((id) => ({ id })),
      requirements: Array.from({ length: 5000 }, (_, i) => ({ id: `REQ-${i}`, title: "t", severity: "mandatory", required_level: "unit", required_environment: "ci", max_age_seconds: 60, repositories: repos, allowed_execution_kinds: ["live"] })),
    };
    const text = JSON.stringify(doc);
    expect(text.length).toBeLessThan(4 * MB + 3 * MB); // well under the metadata limit
    expect(() => parseManifestText(text, "m", 64 * MB, "yaml")).toThrowError(/YAML nodes|byte limit/);
    expect(parseManifestText(text, "m", 4 * MB, "json").manifest.requirements.length).toBe(5000);
    expect(() => parseManifestText('{"schema_version":1,"schema_version":1}', "m", 4 * MB, "json")).toThrowError(/repeats the key/);
    expect(() => parseManifestText("{nope", "m", 4 * MB, "json")).toThrowError(/not valid JSON/);
  });

  it("a runaway recursion in the parser is a stable manifest_parse_error, not an internal error", () => {
    const nested = `${"[".repeat(20_000)}${"]".repeat(20_000)}`;
    let code: string | undefined;
    try {
      parseManifestText(nested);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(["manifest_parse_error", "manifest_schema_invalid", "limit_manifest_size"]).toContain(code);
  });
});

describe("manifest size limits through the in-process CLI", () => {
  it("a 5 MB manifest is refused by size before it is read", async () => {
    const w = await ws();
    await writeFile(w.manifestPath, `# ${"x".repeat(5 * MB)}\n`);
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("limit_manifest_size");
  });

  it("the 25 MB metadata limit still applies to receipts and is unaffected by the tighter manifest cap", async () => {
    const w = await ws();
    await writeFile(join(w.receiptsDir, "huge.receipt.json"), Buffer.alloc(26 * MB, 0x20));
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(errorCode(r)).toBe("limit_metadata_bytes");
  });
});

describe("bundle round trip of a manifest whose default repository lists expand beyond the YAML budget", () => {
  it("restores a bundle of 700 requirements x 40 default repositories (the normalised manifest.json is parsed as JSON)", async () => {
    const w = await makeWorkspace();
    made.push(w);
    const repos = Array.from({ length: 40 }, (_, i) => ({ id: `repo-${i}` }));
    const reqs = Array.from({ length: 700 }, (_, i) => baseRequirement({ id: `REQ-${i}`, repositories: undefined }));
    await writeManifest(w, baseManifest({ repositories: repos, requirements: reqs }));
    await writeRevisions(w, Object.fromEntries(repos.map((r, i) => [r.id, `${i.toString(16).padStart(2, "0")}${"a".repeat(38)}`])));
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(1); // no receipts: unsatisfied, but a real report
    const bundle = join(w.dir, "big.pgbundle");
    const exp = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
    expect(exp.code, exp.stderr).toBe(0);
    const restored = join(w.dir, "restored");
    const r = await runCli(["bundle", "restore", bundle, "--output", restored]);
    expect(r.code, r.stderr).toBe(0);
    const normalised = JSON.parse(readFileSync(join(restored, "manifest.json"), "utf8")) as { requirements: Array<{ repositories: string[] }> };
    expect(normalised.requirements[0]?.repositories.length).toBe(40);
  }, 120_000);
});
