/**
 * A hand-edited report may carry a reason code named like an inherited object member. Descriptions must come from own
 * keys only, so such a code gets the fallback text and never a function or object rendered into the output.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REASON_DESCRIPTIONS, describeReason } from "../../src/reasons.js";
import { reportContentHash, serializeReport } from "../../src/report.js";
import type { Report } from "../../src/schemas.js";
import { evalArgs, runCli, runDist } from "../helpers/cli.js";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";

const FALLBACK = "No description is available for this reason code.";
const INHERITED = ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "__defineGetter__"];

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

describe("describeReason", () => {
  it.each(INHERITED)("returns the fallback text for the inherited member name %s", (code) => {
    expect(describeReason(code)).toBe(FALLBACK);
  });

  it("describes every real reason code with its own text, and unknown codes with the fallback", () => {
    for (const [code, text] of Object.entries(REASON_DESCRIPTIONS)) expect(describeReason(code)).toBe(text);
    expect(describeReason("no_such_reason")).toBe(FALLBACK);
    expect(describeReason("")).toBe(FALLBACK);
  });
});

describe("explain with a hand-edited report", () => {
  async function editedReport(): Promise<Workspace> {
    const ws = await passingWorkspace();
    made.push(ws);
    expect((await runCli(evalArgs(ws, ["--now", NOW]))).code).toBe(0);
    const file = join(ws.outputDir, "report.json");
    const report = JSON.parse(readFileSync(file, "utf8")) as Report;
    const first = report.requirements[0] as Report["requirements"][number];
    first.reason_codes = ["all_criteria_met", ...INHERITED];
    // Keep the report internally consistent so explain accepts it: rewrite report.json and its hash together.
    writeFileSync(file, serializeReport(report));
    writeFileSync(join(ws.outputDir, "report.sha256"), `${reportContentHash(report)}\n`);
    return ws;
  }

  it("prints the fallback for inherited-name codes and the real text for a real code (in-process CLI)", async () => {
    const ws = await editedReport();
    const r = await runCli(["explain", "REQ-001", "--report", ws.outputDir]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`  all_criteria_met  ${REASON_DESCRIPTIONS.all_criteria_met}`);
    for (const code of INHERITED) expect(r.stdout).toContain(`  ${code}  ${FALLBACK}`);
    expect(r.stdout).not.toMatch(/\[object |function |native code|undefined/);
  });

  it("does the same through the packaged executable dist/cli.js", async () => {
    const ws = await editedReport();
    const r = await runDist(["explain", "REQ-001", "--report", ws.outputDir]);
    expect(r.code, r.stderr).toBe(0);
    for (const code of INHERITED) expect(r.stdout).toContain(`  ${code}  ${FALLBACK}`);
    expect(r.stdout).not.toMatch(/\[object |function |native code|undefined/);
  });
});
