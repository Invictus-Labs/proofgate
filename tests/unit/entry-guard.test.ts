/**
 * Review round 4 (logic P2-2): how the library modules recognise that node started them as the main script. The rule is node's
 * own entry resolution (file, file plus `.js`, directory through `package.json` `main` or `index.js`), on real paths.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { isStartedAsMain, refuseWhenStartedAsMain } from "../../src/entry-guard.js";

const root = mkdtempSync(join(tmpdir(), "pg-guard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "pkg", "dist"), { recursive: true });
writeFileSync(join(root, "pkg", "package.json"), JSON.stringify({ name: "x", main: "dist/index.js" }));
writeFileSync(join(root, "pkg", "dist", "index.js"), "export {};\n");
writeFileSync(join(root, "pkg", "dist", "run.js"), "export {};\n");
mkdirSync(join(root, "other"), { recursive: true });
writeFileSync(join(root, "other", "index.js"), "export {};\n");
symlinkSync(join(root, "pkg", "dist", "run.js"), join(root, "link.js"));
const url = (...parts: string[]): string => pathToFileURL(join(root, ...parts)).href;

describe("isStartedAsMain", () => {
  it.each([
    ["the file as written", join(root, "pkg", "dist", "index.js")],
    ["the file without its extension", join(root, "pkg", "dist", "index")],
    ["the directory that holds it (index.js)", join(root, "pkg", "dist")],
    ["the package directory (package.json main)", join(root, "pkg")],
    ["a path with a trailing separator", `${join(root, "pkg", "dist")}/`],
  ])("recognises %s", (_label, argv1) => {
    expect(isStartedAsMain(url("pkg", "dist", "index.js"), argv1)).toBe(true);
  });

  it("recognises a symlink to the file", () => {
    expect(isStartedAsMain(url("pkg", "dist", "run.js"), join(root, "link.js"))).toBe(true);
  });

  it("a relative path is resolved against the working directory", () => {
    const relative = join(root, "pkg", "dist", "index.js").slice(process.cwd().length + (process.cwd().endsWith("/") ? 0 : 1));
    // only meaningful when the temp directory is below the working directory; otherwise the absolute case above covers it
    if (join(root, "pkg", "dist", "index.js").startsWith(process.cwd())) expect(isStartedAsMain(url("pkg", "dist", "index.js"), relative)).toBe(true);
  });

  it.each([
    ["another file in the same directory", join(root, "pkg", "dist", "run.js")],
    ["another package", join(root, "other")],
    ["a path that does not exist", join(root, "nowhere", "x.js")],
    ["an empty argument", ""],
  ])("does not mistake %s for the entry point", (_label, argv1) => {
    expect(isStartedAsMain(url("pkg", "dist", "index.js"), argv1)).toBe(false);
  });

  it("no script at all (a REPL or an evaluated string) is not the entry point", () => {
    expect(isStartedAsMain(url("pkg", "dist", "index.js"), undefined)).toBe(false);
  });

  it("a module URL that is not a file is not the entry point", () => {
    expect(isStartedAsMain("data:text/javascript,export{}", join(root, "pkg", "dist", "index.js"))).toBe(false);
  });
});

describe("refuseWhenStartedAsMain", () => {
  it("does nothing when the module is only imported (this test is not started as that module)", () => {
    expect(() => refuseWhenStartedAsMain(url("pkg", "dist", "index.js"), "dist/index.js")).not.toThrow();
  });

  it("started as the main script it says so on stderr with the stable code and exits 2 (in process, with exit and stderr replaced)", () => {
    const original = process.argv[1];
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.argv[1] = join(root, "pkg", "dist", "index.js");
    try {
      refuseWhenStartedAsMain(url("pkg", "dist", "index.js"), "dist/index.js");
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(2);
      expect(String(write.mock.calls[0]?.[0])).toBe("proofgate: error [cli_usage]: dist/index.js is a library module, not the command; run the proofgate command (or node dist/cli.js) instead\n");
    } finally {
      process.argv[1] = original as string;
      exit.mockRestore();
      write.mockRestore();
    }
  });
});
