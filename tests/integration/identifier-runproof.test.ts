/**
 * Review round 4 (tests P2): the identifier refusal end to end for a RunProof wrapper, whose identifiers sit under `run.id` and
 * `binding` (the unit test covers every path of the list; this proves the loader applies the list to that document shape).
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});
const secret = ["tok", "en=", "y".repeat(24)].join("");
const fixture = join(import.meta.dirname, "..", "fixtures", "runproof", "run-detail.fixture.json");

describe("a RunProof wrapper with a credential-looking identifier is refused with the field named", () => {
  it.each([
    ["binding.environment", (d: Record<string, any>) => (d.binding.environment = secret)],
    ["binding.repository", (d: Record<string, any>) => (d.binding.repository = `org/${secret}`)],
    ["binding.requirement_ids", (d: Record<string, any>) => (d.binding.requirement_ids = ["REQ-001", secret])],
    ["run.id", (d: Record<string, any>) => (d.run.id = secret)],
  ])("%s", async (field, mutate) => {
    const w = await passingWorkspace();
    made.push(w);
    const doc = JSON.parse(readFileSync(fixture, "utf8")) as Record<string, any>;
    doc.source_kind = "operator_capture";
    mutate(doc);
    await writeFile(join(w.receiptsDir, "run.receipt.json"), JSON.stringify(doc));
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "receipt_schema_invalid"]);
    expect(r.stderr).toContain(field);
    expect(r.stderr).not.toContain("y".repeat(24));
  });
});
