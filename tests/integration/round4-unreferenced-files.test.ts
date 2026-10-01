/**
 * Review round 3 (logic re-review P2): the round-2 refusal of "look-alike" receipt files was an extension heuristic, and a
 * failing receipt-shaped document saved as `x.json.bak`, `x.json~`, `x.json.gz`, `x.jsonc`, `x.receipt.js0n`, `x.receipt`,
 * `x.receipt.yaml`, `.yml`, `.txt`, `x.receipt.jsom`, `fail.txt` or `fail` still gave ACCEPTED, exit 0. The rule is now
 * strict: every file in the receipts tree is a receipt (`*.receipt.json`), an artifact that a receipt names, or one of a few
 * documented note names; anything else is `receipt_unreferenced_file`. Each name below is planted as a FAILING receipt beside a
 * passing one, so exit 0 can only mean the evidence was ignored.
 */
import { chmodSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, passingWorkspace, writeReceipt, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});
async function pass(): Promise<Workspace> {
  const w = await passingWorkspace();
  made.push(w);
  return w;
}

/** The documented allow-list, written out so that this file does not depend on the implementation to know it. */
const ALLOWED_UNREFERENCED = ["README", "README.md", "README.txt", ".gitkeep", ".DS_Store"] as const;

/** The names the reviewers found, the round-2 names, and further spellings of the same idea. */
const NAMES = [
  // logic re-review of the round-2 tree
  "x.json.bak", "x.json~", "x.json.gz", "x.jsonc", "x.receipt.js0n", "x.receipt", "x.receipt.yaml", "x.receipt.yml", "x.receipt.txt", "x.receipt.jsom", "fail.txt", "fail",
  // round 2
  "failing.Receipt.JSON", "failing.RECEIPT.json", "failing.receipt.json.bak", "failing.receipt.json~", "failing.receipt.jsonl", "failing.json", "failing.Json", "failing.ndjson", "failing.json5",
  // tests re-review and further variants
  "x.rcpt.yaml", "receipt.yaml", "x.receipt.jso", "x.receipt.js", "x.RECEIPT", "receipt.json", "receipt", "x.receipt.json.orig", "x.receipt.json.swp", ".x.receipt.json.tmp", ".hidden", "notes.md", "run.log",
  "x.receipt.json ", "x .receipt.json.txt", "x.receipt.jsonx", "receipts.json", "result", "result.xml", "x.tar.gz", "fail.yaml", "fail.toml", "fail.csv", "readme.md", "README.MD", "README.rst", "gitkeep", ".gitkeep.txt",
  "nested/deeper/fail", "nested/deeper/x.receipt.yaml", "nested/x.receipt.JSON",
];

describe("every file in the receipts tree is a receipt, a named artifact or an allowed note", () => {
  it.each(NAMES)("a failing receipt saved as %j beside a passing one is refused, never ignored", async (name) => {
    const w = await pass();
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code, "control: the passing workspace alone").toBe(0);
    // The planted receipt points at the artifact that the PASSING receipt already names, so its artifact is never an orphan: the only
    // thing that can make the run refuse is the rule about the receipt's own file name (round 3: with an orphan artifact of its
    // own the refusal happened anyway, and `.md` allowed or an upper-case suffix survived as mutants).
    const artifactName = readdirSync(join(w.receiptsDir, "artifacts"))[0] as string;
    const artifact = readFileSync(join(w.receiptsDir, "artifacts", artifactName));
    await writeReceipt(w, {
      receipt: { receipt_id: "rcpt-planted-1", result: "fail", tests: { total: 10, passed: 8, failed: 2, skipped: 0 } },
      fileName: name,
      artifactPath: `artifacts/${artifactName}`,
      artifact,
    });
    const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
    expect([r.code, errorCode(r)], `${name}: ${r.stderr}`).toEqual([2, "receipt_unreferenced_file"]);
    expect(r.stderr, "the refusal names the planted file, not an artifact").toContain(name.split("/").pop() as string);
    expect(r.stdout).not.toContain("ACCEPTED");
  });

  it("control: the same failing receipt under the exact name is read and fails the gate (exit 1)", async () => {
    const w = await pass();
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-planted-1", result: "fail", tests: { total: 10, passed: 8, failed: 2, skipped: 0 } }, fileName: "nested/failing.receipt.json" });
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(1);
  });

  it.each([...ALLOWED_UNREFERENCED, `nested/${ALLOWED_UNREFERENCED[1]}`, `nested/deeper/${ALLOWED_UNREFERENCED[3]}`])("the allowed note %s is not evidence and does not stop the run", async (name) => {
    const w = await pass();
    const file = join(w.receiptsDir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "operator note\n");
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect(r.code, r.stderr).toBe(0);
  });

  it("the implementation exports exactly the documented allow-list", async () => {
    const { ALLOWED_UNREFERENCED: actual } = (await import("../../src/receipt.js")) as { ALLOWED_UNREFERENCED?: readonly string[] };
    expect(actual === undefined ? undefined : [...actual]).toEqual([...ALLOWED_UNREFERENCED]);
  });

  it.each(["artifacts/evidence.json", "artifacts/evidence.txt", "artifacts/evidence", "logs/run.log", "a/b/c/report.xml.gz", "artifacts/README.json"])(
    "a file that a receipt names as its artifact is evidence whatever its name: %s",
    async (artifactPath) => {
      const w = await pass();
      await writeReceipt(w, { receipt: { receipt_id: "rcpt-artifact-1" }, artifactPath, artifact: "synthetic artifact bytes\n" });
      const r = await runCli(evalArgs({ ...w, outputDir: join(w.dir, "second") }, ["--now", NOW]));
      expect(r.code, r.stderr).toBe(0);
    },
  );

  it("an artifact that no receipt names any more is refused as soon as the receipt goes (a stale copy is not evidence)", async () => {
    const w = await pass();
    writeFileSync(join(w.receiptsDir, "artifacts", "orphan.xml"), "<x/>");
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)]).toEqual([2, "receipt_unreferenced_file"]);
    expect(r.stderr).toContain("orphan.xml");
  });

  it("the refusal names at most five files, counts them all, and says what to do", async () => {
    const w = await pass();
    for (let i = 0; i < 8; i += 1) writeFileSync(join(w.receiptsDir, `extra-${i}`), "x");
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)]).toEqual([2, "receipt_unreferenced_file"]);
    expect(r.stderr).toContain("8 file(s)");
    expect(r.stderr).toContain(", ...");
    expect(r.stderr).toContain('rename each one to end in ".receipt.json"');
    expect(r.stderr).toContain("README.md");
  });

  it("a symlink is still refused as a symlink, not reclassified", async () => {
    const w = await pass();
    symlinkSync(join(w.receiptsDir, "README.md"), join(w.receiptsDir, "link-to-nothing"));
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)]).toEqual([2, "path_symlink_rejected"]);
  });

  it("an unreadable stray file does not matter: it is refused by name before anything reads it", async () => {
    const w = await pass();
    const stray = join(w.receiptsDir, "secret-notes");
    writeFileSync(stray, "x");
    chmodSync(stray, 0);
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    chmodSync(stray, 0o600);
    expect([r.code, errorCode(r)]).toEqual([2, "receipt_unreferenced_file"]);
  });
});
