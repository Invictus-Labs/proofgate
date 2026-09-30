/**
 * Review round 3 (logic re-review, P1, older than round 2): `dist/cli.js` decided at import time whether it was "the entry
 * point" by comparing realpath(process.argv[1]) with its own file. Any invocation whose argv[1] does not end in `.js`
 * (`node dist/cli evaluate ...`) was a SILENT NO-OP that exited 0 without evaluating: with a failing receipt,
 * `node dist/cli.js evaluate` gave UNSATISFIED / exit 1 but `node dist/cli evaluate` printed nothing and exited 0, a
 * permanently green gate. The executable now always runs; the library code lives in `src/run.ts`. Every test spawns the
 * built binary and uses a FAILING receipt, so "exit 0" can only mean that nothing ran.
 */
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { DIST_CLI, ROOT } from "../helpers/cli.js";
import { NOW, makeWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const exec = promisify(execFile);
interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}
async function run(args: string[], cwd?: string): Promise<Run> {
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

/** A workspace whose only receipt FAILS: the correct verdict is UNSATISFIED, exit 1. */
async function failing(): Promise<Workspace> {
  const w = await makeWorkspace();
  made.push(w);
  await writeManifest(w);
  await writeRevisions(w);
  await writeReceipt(w, { receipt: { result: "fail", tests: { total: 10, passed: 8, failed: 2, skipped: 0 } } });
  return w;
}
const evaluateArgs = (w: Workspace): string[] => ["evaluate", "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--now", NOW];

function expectEvaluated(r: Run, label: string): void {
  expect(r.code, `${label}: ${r.stderr}`).toBe(1);
  expect(r.stdout, label).toContain("verdict: UNSATISFIED");
}

describe("the executable always runs, however it is started (a failing receipt must give UNSATISFIED, exit 1)", () => {
  it("control: node dist/cli.js", async () => {
    const w = await failing();
    expectEvaluated(await run([DIST_CLI, ...evaluateArgs(w)]), "dist/cli.js");
  });

  it("node dist/cli (no .js extension) evaluates instead of doing nothing and exiting 0", async () => {
    const w = await failing();
    expectEvaluated(await run([join(ROOT, "dist", "cli"), ...evaluateArgs(w)]), "dist/cli");
  });

  it("a relative path with and without the extension, from the repository root", async () => {
    const w = await failing();
    expectEvaluated(await run(["./dist/cli.js", ...evaluateArgs(w)], ROOT), "./dist/cli.js");
    expectEvaluated(await run(["./dist/cli", ...evaluateArgs(w)], ROOT), "./dist/cli");
    expectEvaluated(await run(["dist/cli", ...evaluateArgs(w)], ROOT), "dist/cli (relative)");
  });

  it("--version, --help and a bogus command are answered, never silent (no exit 0 with empty output)", async () => {
    const version = await run([join(ROOT, "dist", "cli"), "--version"]);
    expect([version.code, version.stdout.trim()]).toEqual([0, "0.1.0"]);
    const help = await run([join(ROOT, "dist", "cli"), "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage:");
    const bogus = await run([join(ROOT, "dist", "cli"), "bogus"]);
    expect(bogus.code).toBe(2);
    expect(bogus.stderr).toContain("cli_usage");
    const bare = await run([join(ROOT, "dist", "cli")]);
    expect(bare.code).toBe(2);
    expect(bare.stderr).toContain("Usage:");
  });

  it("through a symlink named like the installed bin, with and without an extension", async () => {
    const w = await failing();
    const dir = await mkdtemp(join(tmpdir(), "pg-bin-"));
    dirs.push(dir);
    symlinkSync(DIST_CLI, join(dir, "proofgate"));
    symlinkSync(DIST_CLI, join(dir, "proofgate.mjs"));
    symlinkSync(DIST_CLI, join(dir, "pg.cjs"));
    for (const name of ["proofgate", "proofgate.mjs", "pg.cjs"]) expectEvaluated(await run([join(dir, name), ...evaluateArgs(w)]), `symlink ${name}`);
  });

  it("from a directory whose path contains spaces", async () => {
    const w = await failing();
    const dir = await mkdtemp(join(tmpdir(), "pg space dir-"));
    dirs.push(dir);
    const place = join(dir, "with spaces", "pkg");
    mkdirSync(place, { recursive: true });
    cpSync(join(ROOT, "dist"), join(place, "dist"), { recursive: true });
    writeFileSync(join(place, "package.json"), JSON.stringify({ name: "copy", type: "module" }));
    symlinkSync(join(ROOT, "node_modules"), join(place, "node_modules"));
    expectEvaluated(await run([join(place, "dist", "cli.js"), ...evaluateArgs(w)]), "spaces .js");
    expectEvaluated(await run([join(place, "dist", "cli"), ...evaluateArgs(w)]), "spaces no extension");
  });

  it("with node's preload flags in front (--import, --require) and with extra node options", async () => {
    const w = await failing();
    const dir = await mkdtemp(join(tmpdir(), "pg-preload-"));
    dirs.push(dir);
    writeFileSync(join(dir, "noop.mjs"), "export {};\n");
    writeFileSync(join(dir, "noop.cjs"), "\n");
    expectEvaluated(await run(["--import", join(dir, "noop.mjs"), join(ROOT, "dist", "cli"), ...evaluateArgs(w)]), "--import");
    expectEvaluated(await run(["--require", join(dir, "noop.cjs"), join(ROOT, "dist", "cli"), ...evaluateArgs(w)]), "--require");
    expectEvaluated(await run(["--max-old-space-size=128", "--no-warnings", join(ROOT, "dist", "cli.js"), ...evaluateArgs(w)]), "node options");
  });

  it("importing the library entry point runs nothing (main lives in run.js, the executable is cli.js only)", async () => {
    const w = await failing();
    const script = `import { pathToFileURL } from "node:url"; const lib = await import(pathToFileURL(${JSON.stringify(join(ROOT, "dist", "run.js"))}).href); console.log(typeof lib.main);`;
    const r = await run(["--input-type=module", "-e", script, "--", ...evaluateArgs(w)]);
    expect([r.code, r.stdout.trim()]).toEqual([0, "function"]);
    expect(r.stdout).not.toContain("verdict");
  });
});
