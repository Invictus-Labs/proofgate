/**
 * Final security review (P1) through the real commands: a receipt whose `command` holds an option given a value after a blank, with a value of the shape of a label (a Fernet key: letters,
 * digits, `-`, `_` and a final `=`, holding `Pw`, `Jwt` or `Auth` as a camel-case segment), once put the key into `evaluate --json` on stdout, `index.html`, `report.json` and the raw bytes
 * of the bundle. The built CLI must show none of it anywhere. (The packed binary runs the same in `tests/e2e/packaged-space-option.test.ts`.)
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evalArgs, runDist } from "../helpers/cli.js";
import { NOW, passingWorkspace, writeReceipt, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

const KEYS = ["LzoVnZg-qdh5H16SBqPw-da6Q3WjgvEReUQEUjrrYWk=", "w-mxxsyUtdVHNQtpbO3X_8JwtE6xjPip7_7Rk72dpLs=", "ZqB28ClwKx919Jwt1Yc8="];
const fragments = (key: string): string[] => [key, key.slice(0, 16), key.slice(-16)];
const tree = (dir: string): string => {
  let text = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    text += entry.isDirectory() ? tree(p) : readFileSync(p, "latin1");
  }
  return text;
};

describe("a key that reads as a label, given to an option after a blank, reaches no output of the built CLI", () => {
  it.each(KEYS.map((key) => [key.slice(0, 12), key] as const))("%s in a receipt command", async (_name, key) => {
    const ws = await passingWorkspace();
    made.push(ws);
    await writeReceipt(ws, { receipt: { command: `deploy --token ${key} --verbose` } });
    const evaluated = await runDist(evalArgs(ws, ["--now", NOW, "--json"]));
    expect(evaluated.code, evaluated.stderr.slice(0, 300)).toBe(0);
    const bundle = join(ws.dir, "drill.pgbundle");
    const exported = await runDist(["bundle", "export", "--report", ws.outputDir, "--manifest", ws.manifestPath, "--receipts", ws.receiptsDir, "--revisions", ws.revisionsPath, "--output", bundle]);
    expect(exported.code, exported.stderr.slice(0, 300)).toBe(0);
    expect(existsSync(bundle)).toBe(true);
    const places: Array<[string, string]> = [
      ["evaluate --json stdout", evaluated.stdout],
      ["evaluate stderr", evaluated.stderr],
      ["the report directory (index.html, report.json)", tree(ws.outputDir)],
      ["the bundle bytes", readFileSync(bundle, "latin1")],
    ];
    // the receipts on disk (the input) hold the key: the drill is meaningful only because the raw input does
    expect(tree(ws.receiptsDir)).toContain(key);
    for (const [where, text] of places) for (const piece of fragments(key)) expect(text.includes(piece), `${where} holds ${piece.slice(0, 8)}...`).toBe(false);
  });
});
