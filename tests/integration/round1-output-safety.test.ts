/**
 * Review round 1, P2 group: --replace safety and archive names, the recorded clock source, report self-consistency and
 * the report.sha256 requirement, the report size ceiling, free-space preflight and temp cleanup on signals.
 * Tests that call the CLI fail on the delivered tree; the assertions state the new contract.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomFillSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertFreeSpace, cleanupTempPathsSync, freeBytes, isNoSpace, trackTemp, untrackTemp } from "../../src/fsguard.js";
import { resolveClock, resolveNow } from "../../src/clock.js";
import { reportContentHash, serializeReport, serializeReportWithinLimit } from "../../src/report.js";
import type { Report } from "../../src/schemas.js";
import { DIST_CLI, errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, REPOS, baseManifest, baseRequirement, makeWorkspace, passingWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const made: string[] = [];
const workspaces: Workspace[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((w) => w.cleanup()));
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function ws(): Promise<Workspace> {
  const w = await passingWorkspace();
  workspaces.push(w);
  return w;
}
const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));

describe("--replace only archives a previous report, and archive names never collide", () => {
  it("refuses to move a directory that is not a ProofGate report (no report.json) and leaves it untouched", async () => {
    const w = await ws();
    await mkdir(w.outputDir, { recursive: true });
    await writeFile(join(w.outputDir, "precious.txt"), "not a report");
    const r = await runCli(evalArgs(w, ["--now", NOW, "--replace"]));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("output_exists");
    expect(r.stderr).toContain("not a ProofGate report directory");
    expect(readdirSync(w.outputDir)).toEqual(["precious.txt"]);
    expect(readdirSync(w.dir).filter((n) => n.includes("superseded"))).toEqual([]);
  });

  it("a second and third --replace with identical inputs and a fixed clock each succeed with distinct archives", async () => {
    const w = await ws();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const first = readJson(join(w.outputDir, "report.json"));
    for (let i = 0; i < 3; i += 1) {
      const r = await runCli(evalArgs(w, ["--now", NOW, "--replace"]));
      expect(r.code, `${i}: ${r.stderr}`).toBe(0);
    }
    const archives = readdirSync(w.dir).filter((n) => n.startsWith("report.superseded-")).sort();
    expect(archives.length).toBe(3);
    expect(new Set(archives).size).toBe(3);
    expect(archives).toContain(`report.superseded-${first.assessment_id}`);
    expect(archives).toContain(`report.superseded-${first.assessment_id}-2`);
    // supersedes points at the PRIOR assessment, and every archived report is intact.
    expect(readJson(join(w.outputDir, "report.json")).supersedes.assessment_id).toBe(first.assessment_id);
    for (const a of archives) expect(readJson(join(w.dir, a, "report.json")).assessment_id).toBe(first.assessment_id);
  });

  it("an unreadable previous report (report.json present but damaged) is still archived, never deleted", async () => {
    const w = await ws();
    await runCli(evalArgs(w, ["--now", NOW]));
    writeFileSync(join(w.outputDir, "report.json"), "{ damaged");
    const r = await runCli(evalArgs(w, ["--now", NOW, "--replace"]));
    expect(r.code, r.stderr).toBe(0);
    expect(readdirSync(w.dir).filter((n) => n.startsWith("report.superseded-unreadable-")).length).toBe(1);
  });
});

describe("the evaluation clock is never invisible", () => {
  it("the report records where the clock came from: flag, env or system", async () => {
    const w = await ws();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    expect(readJson(join(w.outputDir, "report.json")).clock_source).toBe("flag");
    expect(readFileSync(join(w.outputDir, "index.html"), "utf8")).toContain("Fixed by --now");
    const e = { ...w, outputDir: join(w.dir, "env") };
    expect((await runCli(evalArgs(e), { PROOFGATE_NOW: NOW })).code).toBe(0);
    expect(readJson(join(e.outputDir, "report.json")).clock_source).toBe("env");
    const s = { ...w, outputDir: join(w.dir, "sys") };
    const sys = await runCli(evalArgs(s));
    expect(readJson(join(s.outputDir, "report.json")).clock_source).toBe("system");
    expect(readFileSync(join(s.outputDir, "index.html"), "utf8")).toContain("The system clock at the time of the run.");
    expect(sys.stderr).toBe("");
  });

  it("warns on stderr when --now or PROOFGATE_NOW freezes the clock, and leaves stdout unchanged", async () => {
    const w = await ws();
    const flag = await runCli(evalArgs(w, ["--now", NOW]));
    expect(flag.stderr).toContain("the evaluation clock is fixed by --now (2026-09-29T12:00:00.000Z)");
    expect(flag.stdout).toContain("verdict: ACCEPTED (exit 0)");
    const e = { ...w, outputDir: join(w.dir, "env") };
    const env = await runCli(evalArgs(e), { PROOFGATE_NOW: NOW });
    expect(env.stderr).toContain("fixed by PROOFGATE_NOW");
  });

  it("--now with an empty value is an error, never a silent fallback to the system clock; an empty PROOFGATE_NOW is an error too", async () => {
    const w = await ws();
    const r = await runCli(evalArgs(w, ["--now", ""]));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("clock_invalid");
    expect(existsSync(w.outputDir)).toBe(false);
    expect(() => resolveClock(undefined, { PROOFGATE_NOW: "" }, () => new Date(0))).toThrowError(/must be a UTC timestamp/);
    expect(resolveClock(undefined, {}, () => new Date(0)).source).toBe("system");
    expect(() => resolveNow("", {}, () => new Date(0))).toThrowError(/must be a UTC timestamp/);
    expect(resolveClock("2026-09-29T12:00:00Z", { PROOFGATE_NOW: "2027-01-01T00:00:00Z" }).source).toBe("flag");
  });

  it("re-evaluating a bundle does not depend on how the original clock was supplied", async () => {
    const w = await ws();
    await runCli(evalArgs(w), { PROOFGATE_NOW: NOW });
    const bundle = join(w.dir, "c.pgbundle");
    const exp = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
    expect(exp.code, exp.stderr).toBe(0);
    expect((await runCli(["bundle", "verify", bundle])).code).toBe(0);
  });
});

describe("report.json must be self-consistent and carry its hash", () => {
  async function editedReport(mutate: (report: any) => void): Promise<Workspace> {
    const w = await ws();
    // A failing mandatory receipt makes the honest verdict "unsatisfied"...
    await writeReceipt(w, { receipt: { result: "fail", tests: { total: 4, passed: 3, failed: 1, skipped: 0 } } });
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(1);
    const file = join(w.outputDir, "report.json");
    const report = readJson(file);
    mutate(report);
    // ...and the forger recomputes report.sha256 so the hash check alone passes.
    writeFileSync(file, serializeReport(report as Report));
    writeFileSync(join(w.outputDir, "report.sha256"), `${reportContentHash(report as Report)}\n`);
    return w;
  }

  it("a report edited to say accepted while a mandatory requirement fails is refused by explain and bundle export", async () => {
    const w = await editedReport((r) => {
      r.verdict = "accepted";
      r.exit_code = 0;
    });
    const r = await runCli(["explain", "REQ-001", "--report", w.outputDir]);
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("report_invalid");
    expect(r.stderr).toContain("contradicts itself");
    const exp = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", join(w.dir, "x.pgbundle")]);
    expect(errorCode(exp)).toBe("report_invalid");
  });

  it("summary counts that do not follow from the decisions are refused too", async () => {
    const w = await editedReport((r) => {
      r.summary.mandatory_passed = 5;
    });
    expect(errorCode(await runCli(["explain", "REQ-001", "--report", w.outputDir]))).toBe("report_invalid");
  });

  it("a report without report.sha256 is refused (it cannot be shown to be unmodified), by directory and by file path", async () => {
    const w = await ws();
    await runCli(evalArgs(w, ["--now", NOW]));
    await rm(join(w.outputDir, "report.sha256"));
    for (const target of [w.outputDir, join(w.outputDir, "report.json")]) {
      const r = await runCli(["explain", "REQ-001", "--report", target]);
      expect(errorCode(r)).toBe("report_invalid");
      expect(r.stderr).toContain("report.sha256 is missing");
    }
  });

  it("control: an honest, untouched report is explained normally", async () => {
    const w = await ws();
    await runCli(evalArgs(w, ["--now", NOW]));
    expect((await runCli(["explain", "REQ-001", "--report", w.outputDir])).code).toBe(0);
  });
});

describe("report size ceiling (enforced before the HTML page is rendered)", () => {
  it("serializeReportWithinLimit refuses a report larger than the limit that the readers accept", () => {
    const report = { a: "x".repeat(2000) } as unknown as Report;
    expect(() => serializeReportWithinLimit(report, 1000)).toThrowError(/would be \d+ bytes/);
    expect(serializeReportWithinLimit(report, 10_000).length).toBeGreaterThan(2000);
  });

  it("an evaluation whose requirements x repositories fan-out makes report.json unreadable fails early, writes nothing and names the reason", async () => {
    const w = await makeWorkspace();
    workspaces.push(w);
    const repos = Array.from({ length: 50 }, (_, i) => ({ id: `repo-${i}` }));
    const reqs = Array.from({ length: 3000 }, (_, i) => baseRequirement({ id: `REQ-${i}`, repositories: undefined }));
    await writeManifest(w, baseManifest({ repositories: repos, requirements: reqs }));
    await writeRevisions(w, Object.fromEntries(repos.map((r, i) => [r.id, `${i.toString(16).padStart(2, "0")}${"b".repeat(38)}`])));
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(r.code, r.stdout.slice(0, 200)).toBe(2);
    expect(errorCode(r)).toBe("limit_metadata_bytes");
    expect(r.stderr).toContain("fan-out");
    expect(existsSync(w.outputDir)).toBe(false);
    expect(readdirSync(w.dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  }, 120_000);
});

describe("free space and temporary output", () => {
  it("assertFreeSpace refuses an impossible size before anything is written, and passes a tiny one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pg-space-"));
    made.push(dir);
    expect(await freeBytes(join(dir, "does", "not", "exist"))).toBeGreaterThan(0);
    await expect(assertFreeSpace(join(dir, "sub"), 2 ** 60, "the test")).rejects.toMatchObject({ code: "output_unwritable" });
    await expect(assertFreeSpace(dir, 10, "the test")).resolves.toBeUndefined();
  });

  it("isNoSpace recognises ENOSPC and EDQUOT only", () => {
    expect(isNoSpace(Object.assign(new Error("x"), { code: "ENOSPC" }))).toBe(true);
    expect(isNoSpace(Object.assign(new Error("x"), { code: "EDQUOT" }))).toBe(true);
    expect(isNoSpace(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(false);
    expect(isNoSpace(undefined)).toBe(false);
  });

  it("cleanupTempPathsSync removes exactly the tracked in-flight paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pg-temp-"));
    made.push(dir);
    const tracked = join(dir, ".tracked.tmp-1");
    const kept = join(dir, "kept");
    const untracked = join(dir, ".untracked.tmp-2");
    for (const p of [tracked, kept, untracked]) mkdirSync(p);
    trackTemp(tracked);
    trackTemp(untracked);
    untrackTemp(untracked);
    expect(cleanupTempPathsSync()).toBe(1);
    expect(existsSync(tracked)).toBe(false);
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(untracked)).toBe(true);
  });

  it("SIGTERM in the middle of a bundle restore leaves no temporary directory behind and exits 143", async () => {
    const w = await makeWorkspace();
    workspaces.push(w);
    await writeManifest(w);
    await writeRevisions(w);
    // A large artifact makes the restore last long enough to signal it mid-way.
    const big = Buffer.alloc(200 * 1024 * 1024);
    for (let off = 0; off < big.length; off += 16 * 1024 * 1024) randomFillSync(big, off, Math.min(16 * 1024 * 1024, big.length - off));
    await writeReceipt(w, { artifact: big });
    expect((await runCli(evalArgs(w, ["--now", NOW, "--max-blob-bytes", String(300 * 1024 * 1024)]))).code).toBe(0);
    const bundle = join(w.dir, "big.pgbundle");
    const exp = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle, "--allow-secret-artifacts", "--max-blob-bytes", String(300 * 1024 * 1024)]);
    expect(exp.code, exp.stderr).toBe(0);

    const target = join(w.dir, "restored-big");
    const child = spawn(process.execPath, [DIST_CLI, "bundle", "restore", bundle, "--output", target, "--max-blob-bytes", String(300 * 1024 * 1024)], { env: { PATH: process.env.PATH ?? "" } });
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
    let sawTemp = false;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !sawTemp) {
      sawTemp = readdirSync(w.dir).some((n) => n.startsWith(".restored-big.tmp-"));
      if (!sawTemp) await new Promise((r) => setTimeout(r, 2));
    }
    // The point of the test: the restore was in flight (its temporary directory existed) when the signal arrived.
    expect(sawTemp, "the restore finished before it could be interrupted; enlarge the artifact").toBe(true);
    child.kill("SIGTERM");
    const result = await exit;
    expect(result.code).toBe(143);
    expect(readdirSync(w.dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
    expect(existsSync(target)).toBe(false);
  }, 180_000);
});

void REPOS;
