import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { errorCode, evalArgs, runCli } from "./cli.js";
import { NOW, type Workspace } from "./fixture.js";

/** Every file under a directory, read as latin1 so that any byte sequence can be searched. */
export function treeText(dir: string): string {
  let out = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    out += `\n${entry.name}\n`;
    out += entry.isDirectory() ? treeText(path) : statSync(path).size > 0 ? readFileSync(path, "latin1") : "";
  }
  return out;
}

export interface CycleOutputs {
  /** Everything an operator or a downstream reader can see: stdout and stderr of every step, the report directory, the JSON output, the bundle, the restored tree. */
  everything: string;
  bundle: string;
  restoredDir: string;
}

/**
 * evaluate (with report), `evaluate --json`, bundle export, verify, restore, then verify again: each step must succeed. Returns all
 * the text those steps produced so a test can look for a planted secret in ALL of it.
 */
export async function cycle(w: Workspace, label: string): Promise<CycleOutputs> {
  const first = await runCli(evalArgs(w, ["--now", NOW]));
  expect([first.code, errorCode(first)], `${label}: evaluate: ${first.stderr.slice(0, 500)}`).toEqual([0, undefined]);
  const json = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "report-json") }, ["--now", NOW, "--json"]));
  expect([json.code, errorCode(json)], `${label}: evaluate --json: ${json.stderr.slice(0, 500)}`).toEqual([0, undefined]);
  const bundle = join(w.dir, "cycle.pgbundle");
  const exported = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
  expect([exported.code, errorCode(exported)], `${label}: export: ${exported.stderr.slice(0, 500)}`).toEqual([0, undefined]);
  const verified = await runCli(["bundle", "verify", bundle]);
  expect([verified.code, errorCode(verified)], `${label}: verify: ${verified.stderr.slice(0, 500)}`).toEqual([0, undefined]);
  const restoredDir = join(w.dir, "restored");
  const restored = await runCli(["bundle", "restore", bundle, "--output", restoredDir]);
  expect([restored.code, errorCode(restored)], `${label}: restore: ${restored.stderr.slice(0, 500)}`).toEqual([0, undefined]);
  const bundleText = readFileSync(bundle).toString("latin1");
  const everything = [first.stdout, first.stderr, json.stdout, json.stderr, exported.stdout, verified.stdout, restored.stdout, treeText(w.outputDir), treeText(join(w.dir, "report-json")), bundleText, treeText(restoredDir)].join("\n");
  return { everything, bundle: bundleText, restoredDir };
}
