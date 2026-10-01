import { readFileSync } from "node:fs";

/**
 * A small static index of the test titles in this repository, used to prove that docs/qa/ac-matrix.md names tests that
 * really exist. It reads the conventional layout used here: `describe("...", () => {`, `it("...", ...)`, `test("...", ...)`,
 * `test.describe("...", ...)`, `it.skipIf(cond)("...", ...)` and `it.each(table)("...", ...)`, one title per line, with
 * nesting expressed by indentation. It is deliberately not a JavaScript parser (the TypeScript 7 toolchain used here ships no JS
 * API); the repository test `tests/proofgate.spec.ts :: AC index` cross-checks the index against `vitest list`.
 */
export interface IndexedTitle {
  /** Describe chain plus the test title, joined by " > ". */
  id: string;
  /** "describe" for a block, "test" for a leaf. */
  kind: "describe" | "test";
}

const TITLE = String.raw`(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|` + "`((?:[^`\\\\]|\\\\.)*)`" + String.raw`)`;
const OPENER = new RegExp(
  String.raw`^(\s*)(describe|test\.describe|it|test)(?:\.(?:skip|only|todo|fails|concurrent|sequential))?` +
    String.raw`(?:\.(?:each|skipIf|runIf)\((?:[^()]|\([^()]*\))*\))?\(\s*` +
    TITLE,
);

export function indexTitles(text: string): IndexedTitle[] {
  const out: IndexedTitle[] = [];
  const stack: Array<{ indent: number; title: string }> = [];
  for (const line of text.split("\n")) {
    const m = OPENER.exec(line);
    if (m === null) continue;
    const indent = (m[1] ?? "").length;
    const raw = m[3] ?? m[4] ?? m[5] ?? "";
    const title = raw.replace(/\\(["'`\\])/g, "$1");
    const isDescribe = m[2] === "describe" || m[2] === "test.describe";
    while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= indent) stack.pop();
    const id = [...stack.map((s) => s.title), title].join(" > ");
    out.push({ id, kind: isDescribe ? "describe" : "test" });
    if (isDescribe) stack.push({ indent, title });
  }
  return out;
}

export function indexFile(path: string): IndexedTitle[] {
  return indexTitles(readFileSync(path, "utf8"));
}
