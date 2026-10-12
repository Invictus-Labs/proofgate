/**
 * Review round 1, finding L3 (P1): the RunProof importer ignored execution_status and exit_code, so a run that failed,
 * was still running or never ran could become PASS while `outcome` said "verified". Each test here fails on the delivered tree.
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

describe("adaptRunproofDocument honours the run's own execution result", () => {
  it("control: a succeeded run with exit code 0 and verified checks passes", () => {
    const { receipt } = adapt(load());
    expect(receipt.result).toBe("pass");
  });

  it.each(["failed"])("execution_status %s with outcome verified is a failure, not a pass", (status) => {
    const { receipt } = adapt(load((d) => (d.run.execution_status = status)));
    expect(receipt.result).toBe("fail");
  });

  it.each([1, 2, 137, -1])("a non-zero exit code (%s) on a run that claims success is a failure", (code) => {
    const { receipt } = adapt(load((d) => (d.run.exit_code = code)));
    expect(receipt.result).toBe("fail");
  });

  it("exit code null or absent does not by itself fail a succeeded run", () => {
    expect(adapt(load((d) => (d.run.exit_code = null))).receipt.result).toBe("pass");
    expect(adapt(load((d) => delete d.run.exit_code)).receipt.result).toBe("pass");
  });

  it.each(["running", "missing"])("execution_status %s is rejected with runproof_execution_incomplete", (status) => {
    let caught: unknown;
    try {
      adapt(load((d) => (d.run.execution_status = status)));
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string } | undefined)?.code).toBe("runproof_execution_incomplete");
  });

  it("a failed run with no required checks is a failure, not a skipped (ignorable) suite", () => {
    const { receipt } = adapt(load((d) => ((d.run.execution_status = "failed"), (d.run.checks = []))));
    expect(receipt.result).toBe("fail");
  });

  it("only the latest evaluation's checks count, and earlier evaluations are preserved verbatim", () => {
    const doc = load((d) => {
      d.run.checks.push({ ...d.run.checks[0], id: "check-old", evaluation: 0, state: "fail" });
    });
    const { receipt } = adapt(doc);
    expect(receipt.result).toBe("pass");
    expect((receipt.extensions as any).runproof.checks.some((c: any) => c.id === "check-old")).toBe(true);
  });
});

describe("through the CLI", () => {
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

  it("a succeeded, verified run is accepted (exit 0)", async () => {
    const ws = await workspaceWith(() => undefined);
    expect((await runCli(evalArgs(ws, ["--now", NOW]))).code).toBe(0);
  });

  it("a failed run that claims verified is not accepted (exit 1), a running run is malformed input (exit 2)", async () => {
    const failed = await workspaceWith((d) => (d.run.execution_status = "failed"));
    expect((await runCli(evalArgs(failed, ["--now", NOW]))).code).toBe(1);
    const nonZero = await workspaceWith((d) => (d.run.exit_code = 3));
    expect((await runCli(evalArgs(nonZero, ["--now", NOW]))).code).toBe(1);
    const running = await workspaceWith((d) => (d.run.execution_status = "running"));
    const r = await runCli(evalArgs(running, ["--now", NOW]));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("runproof_execution_incomplete");
  });
});
