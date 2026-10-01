/**
 * Review round 4 (logic P2-2, ruled must-fix): the fix2 P1 was `node dist/cli evaluate` exiting 0 without evaluating. The same
 * failure survived through the library modules: `node .`, `node dist`, `node dist/index.js` and `node dist/run.js` followed by
 * `evaluate ...` printed nothing and exited 0 on a FAILING tree. A silent success is the worst answer a gate can give, so a
 * module that is not the command must say so and exit 2 when it is started as the main script; the documented ways to start the
 * command are unchanged, and importing a module as a library still runs nothing.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ROOT } from "../helpers/cli.js";
import { NOW, makeWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const exec = promisify(execFile);
interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}
async function run(args: string[], cwd: string = ROOT): Promise<Run> {
  try {
    const { stdout, stderr } = await exec(process.execPath, args, { cwd, env: { PATH: process.env.PATH ?? "" } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : null, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const made: Workspace[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function failing(): Promise<Workspace> {
  const w = await makeWorkspace();
  made.push(w);
  await writeManifest(w);
  await writeRevisions(w);
  await writeReceipt(w, { receipt: { result: "fail", tests: { total: 10, passed: 8, failed: 2, skipped: 0 } } });
  return w;
}
const evaluateArgs = (w: Workspace): string[] => ["evaluate", "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--now", NOW];

describe("a library module started as the main script refuses, it never exits 0 without evaluating", () => {
  it.each([
    ["node .", ["."]],
    ["node dist", ["dist"]],
    ["node dist/index.js", ["dist/index.js"]],
    ["node dist/index", ["dist/index"]],
    ["node ./dist/index.js", ["./dist/index.js"]],
    ["node dist/run.js", ["dist/run.js"]],
    ["node dist/run", ["dist/run"]],
    ["node ./dist/run.js", ["./dist/run.js"]],
  ])("%s evaluate <failing tree> exits 2 with a message that names the command", async (_label, entry) => {
    const w = await failing();
    const r = await run([...entry, ...evaluateArgs(w)]);
    expect([r.code, r.stderr], `stdout: ${r.stdout}`).toEqual([2, expect.stringMatching(/dist\/cli\.js|proofgate command|library/i)]);
    expect(r.stdout).not.toContain("ACCEPTED");
  });

  it("through a symlink and from another working directory", async () => {
    const w = await failing();
    const dir = await mkdtemp(join(tmpdir(), "pg-entry-"));
    dirs.push(dir);
    await symlink(join(ROOT, "dist", "run.js"), join(dir, "link.js"));
    const viaLink = await run([join(dir, "link.js"), ...evaluateArgs(w)]);
    expect(viaLink.code, viaLink.stderr).toBe(2);
    const elsewhere = await run([join(ROOT, "dist", "index.js"), ...evaluateArgs(w)], dir);
    expect(elsewhere.code, elsewhere.stderr).toBe(2);
  });
});

describe("the documented forms are unchanged, and a library import runs nothing", () => {
  it("control: node dist/cli.js and node dist/cli evaluate a failing tree (exit 1, UNSATISFIED)", async () => {
    const w = await failing();
    for (const entry of ["dist/cli.js", "dist/cli"]) {
      const r = await run([entry, ...evaluateArgs(w)]);
      expect([r.code, r.stdout.includes("verdict: UNSATISFIED")], `${entry}: ${r.stderr}`).toEqual([1, true]);
    }
  });

  it("control: importing dist/index.js and dist/run.js from a script exits 0 with no output, whatever the arguments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pg-entry-"));
    dirs.push(dir);
    const script = join(dir, "use-library.mjs");
    await writeFile(script, `await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "index.js")).href)});\nawait import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "run.js")).href)});\n`);
    for (const args of [[], ["evaluate"], ["evaluate", "--manifest", "x"], ["dist/run.js"]]) {
      const r = await run([script, ...args], dir);
      expect([r.code, r.stdout, r.stderr], args.join(" ")).toEqual([0, "", ""]);
    }
    const inline = await run(["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "run.js")).href)})`, "evaluate"], dir);
    expect([inline.code, inline.stdout, inline.stderr]).toEqual([0, "", ""]);
  });
});
