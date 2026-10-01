/**
 * Review round 1, P2/P3 group: case-folded receipt ids, source-scoped envelope de-duplication, the timestamp pattern in the
 * published JSON Schemas, and the packaging of the documents the README links to. Tests here fail on the delivered tree.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { EnvelopeDeduper } from "../../src/adapters/envelope.js";
import { ROOT, errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, baseManifest, baseRequirement, makeWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

describe("receipt ids are compared case-insensitively", () => {
  it("two receipt documents whose ids differ only in case are refused (exit 2, receipt_duplicate_id)", async () => {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement()] }));
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { receipt_id: "rcpt-Case-1" }, fileName: "one.receipt.json", artifactPath: "artifacts/one.xml" });
    await writeReceipt(ws, { receipt: { receipt_id: "RCPT-case-1" }, fileName: "two.receipt.json", artifactPath: "artifacts/two.xml" });
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("receipt_duplicate_id");
    expect(r.stderr).toContain("case-insensitively");
  });

  it("control: distinct ids are accepted", async () => {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement()] }));
    await writeRevisions(ws);
    await writeReceipt(ws, { receipt: { receipt_id: "rcpt-1" }, fileName: "one.receipt.json", artifactPath: "artifacts/one.xml" });
    await writeReceipt(ws, { receipt: { receipt_id: "rcpt-2" }, fileName: "two.receipt.json", artifactPath: "artifacts/two.xml" });
    expect((await runCli(evalArgs(ws, ["--now", NOW]))).code).toBe(0);
  });
});

describe("the event envelope de-duplicates per source", () => {
  const event = (source: string, id = "evt-1", extra: Record<string, unknown> = {}) => ({
    schema_version: 1,
    event_id: id,
    source,
    resource_id: "res-1",
    event_type: "report.created",
    occurred_at: "2026-09-29T12:00:00Z",
    revision: "r1",
    evidence_ref: "sha256:abc",
    ...extra,
  });

  it("two sources may reuse an event id: neither is a duplicate or a conflict of the other", () => {
    const d = new EnvelopeDeduper();
    expect(d.offer(event("source-a")).outcome).toBe("accepted");
    expect(d.offer(event("source-b", "evt-1", { revision: "r2" })).outcome).toBe("accepted");
    expect(d.offer(event("source-a")).outcome).toBe("duplicate");
    expect(d.offer(event("source-a", "evt-1", { revision: "r9" })).outcome).toBe("conflict");
    expect(d.current("source-a", "res-1")?.revision).toBe("r1");
    expect(d.current("source-b", "res-1")?.revision).toBe("r2");
  });

  it("the strict variant names the source in the conflict", () => {
    const d = new EnvelopeDeduper();
    d.offerStrict(event("source-a"));
    expect(() => d.offerStrict(event("source-a", "evt-1", { revision: "r9" }))).toThrowError(/from source source-a/);
  });
});

describe("the published JSON Schemas carry the UTC timestamp pattern", () => {
  const load = (name: string): object => JSON.parse(readFileSync(join(ROOT, "schemas", name), "utf8")) as object;

  it.each(["yesterday", "2026-09-29", "2026-09-29T12:00:00+02:00", "2026-09-29 12:00:00Z", "2026-09-29T12:00:00.1234Z"])("receipt.json rejects finished_at %s", (bad) => {
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(load("receipt.json"));
    const receipt = {
      schema_version: 1,
      receipt_id: "rcpt-1",
      requirement_ids: ["REQ-001"],
      repository: "api",
      commit_sha: "a".repeat(40),
      runner_id: "r",
      environment: "staging",
      test_level: "unit",
      execution_kind: "live",
      result: "pass",
      tests: { total: 1, passed: 1, failed: 0, skipped: 0 },
      artifact: { path: "a.txt", sha256: "b".repeat(64) },
      finished_at: bad,
    };
    expect(validate(receipt)).toBe(false);
    expect(validate({ ...receipt, finished_at: "2026-09-29T12:00:00Z" })).toBe(true);
    expect(validate({ ...receipt, finished_at: "2026-09-29T12:00:00.123Z" })).toBe(true);
  });

  it("every timestamp field in the published schemas has a pattern", () => {
    for (const file of ["receipt.json", "report.json", "evidence-bundle.json", "event-envelope.json", "runproof-run-detail.json"]) {
      const text = JSON.stringify(load(file));
      expect(text, file).toContain('"pattern":"^(\\\\d{4})-(\\\\d{2})-(\\\\d{2})T');
    }
  });
});

describe("the package ships the documents its README links to", () => {
  it("every relative markdown link in README.md points at a file that is in the packed tarball", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" });
    const files = new Set((JSON.parse(out) as Array<{ files: Array<{ path: string }> }>)[0]?.files.map((f) => f.path));
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const targets = [...readme.matchAll(/\]\(((?!https?:|#|mailto:)[^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1] as string);
    expect(targets.length).toBeGreaterThan(10);
    const missing = [...new Set(targets)].filter((t) => !files.has(t.replace(/^\.\//, "")));
    expect(missing).toEqual([]);
  }, 60_000);
});
