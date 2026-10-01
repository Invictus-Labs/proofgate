/**
 * Review round 3 (security re-review, P2): text with many short redaction matches still aborted V8 at the documented 256 MB heap
 * (SIGABRT, not exit 2): a 23 MB `token=a token=a ...` or `a@b.c a@b.c ...` string, and a 20 MB OBJECT KEY of `token=a ` or `aB`
 * repeated. Redaction now replaces a string (or a key) over MAX_REDACT_STRING (4 MiB) as a whole instead of measuring it, so its
 * cost and memory no longer depend on how many matches the text holds. Each test runs the PACKAGED executable under the heap cap
 * and requires a verdict (exit 0 here), never a signal, and never any of the hostile text in the report.
 */
import { readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";
import { evalArgs, runDist } from "../helpers/cli.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

async function withExtensions(extensionsJson: string): Promise<Workspace> {
  const w = await passingWorkspace();
  made.push(w);
  const name = readdirSync(w.receiptsDir).find((n) => n.endsWith(".receipt.json")) as string;
  const path = join(w.receiptsDir, name);
  const doc = readFileSync(path, "utf8");
  await writeFile(path, `${doc.slice(0, doc.lastIndexOf("}"))},"extensions":${extensionsJson}}`);
  return w;
}

const noAbort = (r: { code: number; stderr: string }): void => {
  expect(r.code, r.stderr.slice(0, 400)).not.toBe(134);
  expect(r.code, r.stderr.slice(0, 400)).not.toBe(-1);
  expect(r.stderr).not.toContain("FATAL ERROR");
};

describe("hostile redaction shapes at a 256 MB heap end in a verdict, not an abort", () => {
  it.each([
    ["23 MB of `token=a ` in a string value", () => `{"x-note":"${"token=a ".repeat(2_900_000)}"}`],
    ["23 MB of `a@b.c ` in a string value", () => `{"x-note":"${"a@b.c ".repeat(3_800_000)}"}`],
    ["a 20 MB object key of `token=a `", () => `{"${"token=a ".repeat(2_500_000)}":1}`],
    ["a 20 MB object key of `aB`", () => `{"${"aB".repeat(10_000_000)}":1}`],
  ] as const)("%s", async (_label, make) => {
    const w = await withExtensions(make());
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect([r.code, r.stderr.slice(0, 300)]).toEqual([0, expect.any(String)]);
    const report = readFileSync(join(w.outputDir, "report.json"), "utf8");
    expect(report).not.toContain("token=a token=a");
    expect(report).not.toContain("a@b.c a@b.c");
    expect(report).not.toContain("aBaBaBaB");
  }, 240_000);
});
