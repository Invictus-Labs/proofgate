/**
 * Review round 2, logic re-review P1: the RunProof importer only recognised `typeof exit_code === "number"`, so a run that
 * recorded `"exit_code": "1"` (or true, {}, [], "") beside `execution_status: succeeded` and verified checks was imported
 * as a PASS and the gate accepted it. A recorded exit code must be an integer (or null, or absent). Every test in the first
 * two groups fails on the round-2 review tree.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adaptRunproofDocument } from "../../src/adapters/runproof.js";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, baseManifest, baseRequirement, makeWorkspace, writeManifest, writeRevisions, type Workspace } from "../helpers/fixture.js";

const fixturePath = join(import.meta.dirname, "..", "fixtures", "runproof", "run-detail.fixture.json");
type Doc = Record<string, any>;
const load = (mutate: (d: Doc) => void = () => undefined): Doc => {
  const doc = JSON.parse(readFileSync(fixturePath, "utf8")) as Doc;
  doc.source_kind = "operator_capture";
  mutate(doc);
  return doc;
};
const adapt = (d: Doc) => adaptRunproofDocument(d, "run.receipt.json");
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

describe("a recorded exit_code that is not an integer is never read as 'no exit code'", () => {
  it.each([
    ["the string '1'", "1"],
    ["the string '137'", "137"],
    ["the string '0'", "0"],
    ["the boolean true", true],
    ["the boolean false", false],
    ["an empty object", {}],
    ["an empty array", []],
    ["the empty string", ""],
    ["a non-integer number", 1.5],
  ])("exit_code %s is runproof_schema_invalid, not a pass", (_label, value) => {
    expect(codeOf(() => adapt(load((d) => (d.run.exit_code = value))))).toBe("runproof_schema_invalid");
  });

  it("the camelCase spelling is checked the same way", () => {
    expect(codeOf(() => adapt(load((d) => (d.run.exitCode = "1"))))).toBe("runproof_schema_invalid");
    expect(adapt(load((d) => (d.run.exitCode = 3))).receipt.result).toBe("fail");
    expect(adapt(load((d) => (d.run.exitCode = 0))).receipt.result).toBe("pass");
  });

  it("controls: integers keep their meaning, null and absent are 'no exit code'", () => {
    expect(adapt(load((d) => (d.run.exit_code = 0))).receipt.result).toBe("pass");
    expect(adapt(load((d) => (d.run.exit_code = 1))).receipt.result).toBe("fail");
    expect(adapt(load((d) => (d.run.exit_code = -1))).receipt.result).toBe("fail");
    expect(adapt(load((d) => (d.run.exit_code = 1e0))).receipt.result).toBe("fail");
    expect(adapt(load((d) => (d.run.exit_code = null))).receipt.result).toBe("pass");
    expect(adapt(load((d) => delete d.run.exit_code)).receipt.result).toBe("pass");
  });
});

describe("through the CLI: a string exit code is malformed input (exit 2), never ACCEPTED", () => {
  const made: Workspace[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((w) => w.cleanup()));
  });
  async function workspaceWith(mutate: (d: Doc) => void): Promise<Workspace> {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ max_age_seconds: 7200 })] }));
    await writeRevisions(ws);
    await mkdir(join(ws.receiptsDir, "artifacts"), { recursive: true });
    await writeFile(join(ws.receiptsDir, "artifacts", "runproof-evidence.txt"), "runproof fixture evidence\n");
    await writeFile(join(ws.receiptsDir, "run.receipt.json"), JSON.stringify(load(mutate)));
    return ws;
  }

  it.each([
    ["the string '1'", "1"],
    ["the boolean true", true],
    ["an empty object", {}],
    ["an empty array", []],
    ["the empty string", ""],
  ])("exit_code %s", async (_label, value) => {
    const control = await workspaceWith(() => undefined);
    expect((await runCli(evalArgs(control, ["--now", NOW]))).code).toBe(0);
    const ws = await workspaceWith((d) => (d.run.exit_code = value));
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "runproof_schema_invalid"]);
    expect(r.stdout).not.toContain("ACCEPTED");
  });
});
