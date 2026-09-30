/**
 * Review round 3 (tests re-review P2, security re-review must-fix e): the JSON budget tests used arrays only, never pinned that
 * the budget runs BEFORE JSON.parse, and did not cover documents that are large in VALUES rather than in containers.
 *   - objects and arrays are counted alike, at exactly the limit (`{` uncounted survived every test);
 *   - `JSON.parse` is not called for an over-budget document (parse-then-count survived every test);
 *   - an over-budget document that is not even valid JSON reports the budget, not a syntax error (order);
 *   - a document of millions of plain values is refused (`limit_json_values`) with exit 2 under a 256 MB heap;
 *   - 3 million empty OBJECTS abort V8 at 128 MB on Node 25 while 3 million empty arrays do not, so the object test is the
 *     one that bites at a small heap.
 */
import { readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_JSON_CONTAINERS, MAX_JSON_VALUES, assertJsonContainerBudget, parseJsonStrict } from "../../src/json.js";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";
import { errorCode, evalArgs, runDist } from "../helpers/cli.js";

const made: Workspace[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).name;
  }
  return undefined;
};

describe("the container budget counts objects and arrays alike, at exactly the limit", () => {
  const arrays = (n: number): string => `[${Array.from({ length: n - 1 }, () => "[]").join(",")}]`; // n containers: the outer one and n-1 inner
  const objects = (n: number): string => `[${Array.from({ length: n - 1 }, () => "{}").join(",")}]`;

  it("exactly MAX_JSON_CONTAINERS arrays are accepted; one more is limit_json_containers", () => {
    expect(codeOf(() => assertJsonContainerBudget(arrays(MAX_JSON_CONTAINERS)))).toBeUndefined();
    expect(codeOf(() => assertJsonContainerBudget(arrays(MAX_JSON_CONTAINERS + 1)))).toBe("limit_json_containers");
  });

  it("exactly MAX_JSON_CONTAINERS objects are accepted; one more is limit_json_containers", () => {
    expect(codeOf(() => assertJsonContainerBudget(objects(MAX_JSON_CONTAINERS)))).toBeUndefined();
    expect(codeOf(() => assertJsonContainerBudget(objects(MAX_JSON_CONTAINERS + 1)))).toBe("limit_json_containers");
  });

  it("a mix of both counts both", () => {
    const half = MAX_JSON_CONTAINERS / 2;
    const mixed = `[${Array.from({ length: half }, () => "{}").join(",")},${Array.from({ length: half }, () => "[]").join(",")}]`; // 1 + 2*half
    expect(codeOf(() => assertJsonContainerBudget(mixed))).toBe("limit_json_containers");
  });

  it("braces and brackets inside strings (including after an escaped quote) are not counted", () => {
    const inString = `["${"[{".repeat(MAX_JSON_CONTAINERS)}", "a\\"${"{".repeat(MAX_JSON_CONTAINERS)}"]`;
    expect(codeOf(() => assertJsonContainerBudget(inString))).toBeUndefined();
  });
});

describe("the value budget counts array elements, object members and containers", () => {
  it("exactly MAX_JSON_VALUES array elements are accepted; one more is limit_json_values", () => {
    const list = (n: number): string => `[${"1,".repeat(n - 1)}1]`; // one container + (n - 1) commas = n values
    expect(codeOf(() => assertJsonContainerBudget(list(MAX_JSON_VALUES)))).toBeUndefined();
    expect(codeOf(() => assertJsonContainerBudget(list(MAX_JSON_VALUES + 1)))).toBe("limit_json_values");
  });

  it("object members count the same way", () => {
    const members = (n: number): string => `{${Array.from({ length: n - 1 }, (_, i) => `"k${i}":1`).join(",")},"z":1}`;
    expect(codeOf(() => assertJsonContainerBudget(members(MAX_JSON_VALUES)))).toBeUndefined();
    expect(codeOf(() => assertJsonContainerBudget(members(MAX_JSON_VALUES + 1)))).toBe("limit_json_values");
  });

  it("commas inside strings are not values", () => {
    expect(codeOf(() => assertJsonContainerBudget(`["${",".repeat(MAX_JSON_VALUES * 2)}"]`))).toBeUndefined();
  });
});

describe("the budget runs before JSON.parse", () => {
  it("JSON.parse is never called for an over-budget document", () => {
    const spy = vi.spyOn(JSON, "parse");
    expect(codeOf(() => parseJsonStrict(`[${"[],".repeat(MAX_JSON_CONTAINERS + 1)}[]]`, "receipt"))).toBe("limit_json_containers");
    expect(codeOf(() => parseJsonStrict(`[${"1,".repeat(MAX_JSON_VALUES + 1)}1]`, "receipt"))).toBe("limit_json_values");
    expect(spy.mock.calls.length, "JSON.parse calls").toBe(0);
  });

  it("control: a document within budget does reach JSON.parse", () => {
    const spy = vi.spyOn(JSON, "parse");
    expect(parseJsonStrict("[1,2,3]")).toEqual([1, 2, 3]);
    expect(spy.mock.calls.length, "JSON.parse calls").toBe(1);
  });

  it("an over-budget document that is not valid JSON reports the budget, not a syntax error", () => {
    expect(codeOf(() => parseJsonStrict(`[${"{".repeat(MAX_JSON_CONTAINERS + 1)}`))).toBe("limit_json_containers");
    expect(codeOf(() => parseJsonStrict(`[${"1,".repeat(MAX_JSON_VALUES + 1)} nope`))).toBe("limit_json_values");
  });

  it("the message names the document and the limit, not its content", () => {
    let message = "";
    try {
      parseJsonStrict(`["secret-marker-xyz",${"1,".repeat(MAX_JSON_VALUES)}1]`, "extensions.json");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("extensions.json");
    expect(message).toContain(String(MAX_JSON_VALUES));
    expect(message).not.toContain("secret-marker-xyz");
  });
});

describe("hostile documents under a heap cap end in a refusal, never an abort", () => {
  async function receiptWith(w: Workspace, note: string): Promise<void> {
    const name = readdirSync(w.receiptsDir).find((n) => n.endsWith(".receipt.json")) as string;
    const path = join(w.receiptsDir, name);
    const doc = readFileSync(path, "utf8");
    await writeFile(path, `${doc.slice(0, doc.lastIndexOf("}"))},"extensions":{"x-note":${note}}}`);
  }
  const noAbort = (r: { code: number; stderr: string }): void => {
    expect(r.code, r.stderr.slice(0, 300)).not.toBe(134);
    expect(r.code, r.stderr.slice(0, 300)).not.toBe(-1);
    expect(r.stderr).not.toContain("FATAL ERROR");
  };

  it("3 million empty OBJECTS in a receipt (9 MB) at a 128 MB heap: exit 2 limit_json_containers", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await receiptWith(w, `[${"{},".repeat(3_000_000)}{}]`);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=128"] });
    noAbort(r);
    expect([r.code, errorCode(r)], r.stderr.slice(0, 300)).toEqual([2, "limit_json_containers"]);
  }, 180_000);

  it("a 24 MB array of plain numbers (12 million values) in a receipt at a 256 MB heap: exit 2 limit_json_values", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await receiptWith(w, `[${"1,".repeat(12_000_000)}1]`);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect([r.code, errorCode(r)], r.stderr.slice(0, 300)).toEqual([2, "limit_json_values"]);
  }, 180_000);

  // The limit is pinned from both sides at the documented heap: a document just over it is refused (a limit raised to 5 million
  // survived when only 12 million was tested), and one just under it is accepted (so a limit cannot drift down unnoticed either).
  // (2 million, not more: above the 3 million of the aggregate budget the aggregate would refuse it and hide the per-document limit.)
  it("2 million plain values (a 4 MB text) at a 256 MB heap: exit 2 limit_json_values", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await receiptWith(w, `[${"1,".repeat(2_000_000)}1]`);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect([r.code, errorCode(r)], r.stderr.slice(0, 300)).toEqual([2, "limit_json_values"]);
  }, 180_000);

  // The container limit (500,000) is pinned from both sides too (round 5: a limit of 700,000 survived every test).
  it("600,000 empty objects (just over the 500,000 container limit) at a 256 MB heap: exit 2 limit_json_containers", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await receiptWith(w, `[${"{},".repeat(600_000)}{}]`);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect([r.code, errorCode(r)], r.stderr.slice(0, 300)).toEqual([2, "limit_json_containers"]);
  }, 180_000);

  it("control: 480,000 empty objects (under the 500,000 container limit) at a 256 MB heap are accepted", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await receiptWith(w, `[${"{},".repeat(480_000)}{}]`);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect([r.code, r.stderr.slice(0, 300)]).toEqual([0, expect.any(String)]);
  }, 180_000);

  it("control: 1.4 million plain values (under the 1,500,000 limit) at a 256 MB heap are accepted", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await receiptWith(w, `[${"1,".repeat(1_400_000)}1]`);
    const r = await runDist(evalArgs(w, ["--now", NOW]), { nodeArgs: ["--max-old-space-size=256"] });
    noAbort(r);
    expect([r.code, r.stderr.slice(0, 300)]).toEqual([0, expect.any(String)]);
  }, 180_000);
});
