/**
 * Review round 4 (security P2 and P3, logic P3):
 *  - the container and value budgets were per document, so eight receipts just under the budget aborted V8 at 256 MB instead
 *    of exiting 2: the budgets now also cover all the receipt documents together;
 *  - a YAML mapping of tens of thousands of keys took seconds to minutes (the parser's duplicate-key check is quadratic): the
 *    check is now linear;
 *  - the error line was redacted as a whole, so `error [bundle_secret_detected]:` lost its first word to the `secret` keyword:
 *    only the message is redacted;
 *  - an identifier field nested hundreds of thousands of levels deep ended as `internal_error`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifestText } from "../../src/manifest.js";
import { errorCode, evalArgs, runCli, runDist } from "../helpers/cli.js";
import { FAKE } from "../helpers/fake-secrets.js";
import { NOW, passingWorkspace, writeReceipt, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

/** A workspace with `count` receipts, each holding `perReceipt` empty objects in an extension. */
async function withBigReceipts(count: number, perReceipt: number): Promise<Workspace> {
  const w = await passingWorkspace();
  made.push(w);
  const big = Array.from({ length: perReceipt }, () => ({}));
  for (let i = 0; i < count; i += 1) {
    const fileName = `big-${i}.receipt.json`;
    await writeReceipt(w, { receipt: { receipt_id: `rcpt-big-${i}`, extensions: { big } }, fileName });
    // writeReceipt pretty-prints (about 10 bytes per empty object); the shape under test is the compact 3 bytes per object.
    const path = join(w.receiptsDir, fileName);
    await writeFile(path, JSON.stringify(JSON.parse(await readFile(path, "utf8"))));
  }
  return w;
}

describe("the JSON budgets cover all receipt documents together", () => {
  it("three receipts of 490,000 empty objects (each under the per-document budget) are refused in process", async () => {
    const w = await withBigReceipts(3, 490_000);
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr.slice(0, 300)).toEqual([2, "limit_json_containers"]);
    expect(r.stderr).toMatch(/together|all the receipt documents|in total/i);
  }, 120_000);

  it("eight receipts of 490,000 empty objects exit 2 under a 256 MB heap instead of aborting", async () => {
    const w = await withBigReceipts(8, 490_000);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    expect(r.code, r.stderr.slice(0, 300)).not.toBe(-1);
    expect([r.code, errorCode(r)], r.stderr.slice(0, 300)).toEqual([2, "limit_json_containers"]);
  }, 240_000);

  it("controls: one such receipt, and a few hundred ordinary ones, are accepted", async () => {
    const one = await withBigReceipts(1, 490_000);
    expect((await runCli(evalArgs(one, ["--now", NOW]))).code).toBe(0);
    const many = await passingWorkspace();
    made.push(many);
    await mkdir(join(many.receiptsDir, "many"), { recursive: true });
    for (let i = 0; i < 120; i += 1) await writeReceipt(many, { receipt: { receipt_id: `rcpt-many-${i}`, extensions: { note: { a: [1, 2, 3], b: { c: "d" } } } }, fileName: `many/m-${i}.receipt.json` });
    expect((await runCli(evalArgs(many, ["--now", NOW]))).code).toBe(0);
  }, 240_000);

  it("the limits sit where they are documented: two receipts at the per-document container limit pass, a third is refused", async () => {
    const two = await withBigReceipts(2, 490_000);
    expect((await runCli(evalArgs(two, ["--now", NOW]))).code, "980,000 containers in total").toBe(0);
    const three = await withBigReceipts(3, 490_000);
    expect(errorCode(await runCli(evalArgs(three, ["--now", NOW]))), "1,470,000 containers in total").toBe("limit_json_containers");
  }, 240_000);

  it("the aggregate VALUE budget: two receipts of 1.4 million values (2.8 million) pass, three (4.2 million) are refused with limit_json_values", async () => {
    const numbers = async (count: number): Promise<Workspace> => {
      const w = await passingWorkspace();
      made.push(w);
      const big = Array.from({ length: 1_400_000 }, () => 1);
      for (let i = 0; i < count; i += 1) {
        const fileName = `nums-${i}.receipt.json`;
        await writeReceipt(w, { receipt: { receipt_id: `rcpt-nums-${i}`, extensions: { big } }, fileName });
        const path = join(w.receiptsDir, fileName);
        await writeFile(path, JSON.stringify(JSON.parse(await readFile(path, "utf8"))));
      }
      return w;
    };
    expect((await runCli(evalArgs(await numbers(2), ["--now", NOW]))).code).toBe(0);
    const three = await runCli(evalArgs(await numbers(3), ["--now", NOW]));
    expect([three.code, errorCode(three)], three.stderr.slice(0, 300)).toEqual([2, "limit_json_values"]);
    expect(three.stderr).toMatch(/together/);
  }, 480_000);
});

describe("a YAML mapping with tens of thousands of keys is parsed in linear time", () => {
  const keys = (n: number): string => Array.from({ length: n }, (_, i) => `k${i}: v${i}`).join("\n");

  it("40,000 keys are rejected (they are not a manifest) in time that grows linearly: 4 times the keys, about 4 times as long, not 16", () => {
    const time = (n: number): { took: number; code: string | undefined } => {
      const text = keys(n);
      let best = Infinity;
      let code: string | undefined;
      for (let i = 0; i < 2; i += 1) {
        const t0 = performance.now();
        code = codeOf(() => parseManifestText(text));
        best = Math.min(best, performance.now() - t0);
      }
      return { took: best, code };
    };
    const small = time(10_000);
    const large = time(40_000);
    expect(["manifest_schema_invalid", "manifest_unknown_field", "manifest_parse_error"]).toContain(large.code);
    expect(large.took, `${Math.round(small.took)} ms at 10,000 keys and ${Math.round(large.took)} ms at 40,000`).toBeLessThanOrEqual(Math.max(7 * small.took, 200));
    expect(large.took).toBeLessThan(60_000);
  }, 120_000);

  it("a duplicate key in a large mapping is still refused", () => {
    const code = codeOf(() => parseManifestText(`${keys(20_000)}\nk7: again`));
    expect(code).toBe("manifest_parse_error");
  }, 60_000);

  it.each([
    ["plain duplicate", "a: 1\nb: 2\na: 3"],
    ["quoted duplicate", 'a: 1\n"a": 2'],
    ["nested duplicate", "top:\n  x: 1\n  x: 2"],
    ["flow map duplicate", "{ a: 1, a: 2 }"],
    ["duplicate inside a list item", "list:\n  - a: 1\n    a: 2"],
  ])("control: %s", (_label, text) => {
    expect(codeOf(() => parseManifestText(text))).toBe("manifest_parse_error");
  });
});

describe("error lines and identifiers", () => {
  it("the error line keeps its code and the words of its message: only the message is redacted", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-secret-art" }, artifact: `token ${FAKE.githubToken}\n`, artifactPath: "artifacts/leaky.txt", fileName: "leaky.receipt.json" });
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const bundle = join(w.dir, "leaky.pgbundle");
    const r = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
    expect([r.code, errorCode(r)], r.stderr).toEqual([2, "bundle_secret_detected"]);
    expect(r.stderr).toContain("error [bundle_secret_detected]: ");
    expect(r.stderr).not.toContain("]: [REDACTED] contain");
    expect(r.stderr).not.toContain(FAKE.githubToken);
  });

  it("an identifier nested 300,000 levels deep is a schema error, not an internal error", async () => {
    const w = await passingWorkspace();
    made.push(w);
    const id = `${"[".repeat(300_000)}${"]".repeat(300_000)}`;
    await writeFile(join(w.receiptsDir, "deep.receipt.json"), `{"schema_version":1,"receipt_id":${id},"requirement_ids":["REQ-001"],"repository":"api"}`);
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
    expect(r.code, r.stderr.slice(0, 300)).toBe(2);
    expect(errorCode(r), r.stderr.slice(0, 300)).not.toBe("internal_error");
  }, 120_000);
});
