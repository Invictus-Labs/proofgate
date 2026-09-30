/**
 * Review round 1, S2 (P1): untrusted strings reached the terminal raw, so an ESC sequence or a newline followed by a forged
 * `verdict: ACCEPTED (exit 0)` line could rewrite what the operator saw. Every plain-text output now neutralises control
 * characters, bidi controls and newlines (shown as [U+XXXX]). Each test that runs the CLI fails on the delivered tree.
 */
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { errorCode, evalArgs, runCli, runDist } from "../helpers/cli.js";
import { NOW, REPOS, baseManifest, baseRequirement, makeWorkspace, sha256, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const ESC = String.fromCharCode(0x1b);
const CSI8 = String.fromCharCode(0x9b);
const BEL = String.fromCharCode(0x07);
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const FORGED = "verdict: ACCEPTED (exit 0)";

/** True if the text holds any control character other than the single \n that ends a line. */
const hasRawControl = (s: string): boolean => [...s].some((ch) => {
  const c = ch.codePointAt(0) as number;
  return (c < 0x20 && c !== 0x0a) || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e);
});

describe("plain-text output of the CLI is neutralised", () => {
  const made: Workspace[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((w) => w.cleanup()));
  });

  async function hostileWorkspace(): Promise<Workspace> {
    const ws = await makeWorkspace();
    made.push(ws);
    const title = `Checkout\n${FORGED}\n${ESC}[2K${ESC}[1A${RLO}pwned`;
    const environment = `staging${ESC}]0;owned${BEL}`;
    await writeManifest(
      ws,
      baseManifest({
        requirements: [
          baseRequirement({ title, required_environment: environment }),
          baseRequirement({ id: "REQ-002", title: "Deferred", severity: "advisory", deferred: { reason: `later\n${FORGED}` }, required_environment: environment }),
        ],
      }),
    );
    await writeRevisions(ws, REPOS);
    await writeReceipt(ws, { receipt: { runner_id: `runner${ESC}[31m\nverdict: ACCEPTED (exit 0)`, environment } });
    return ws;
  }
  const linesStartingWith = (out: string, prefix: string): number => out.split("\n").filter((l) => l.startsWith(prefix)).length;

  it("evaluate: a title with an ESC sequence and a forged verdict line prints one verdict line and no raw control characters", async () => {
    const ws = await hostileWorkspace();
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(r.code, r.stderr).toBe(0);
    expect(hasRawControl(r.stdout)).toBe(false);
    expect(linesStartingWith(r.stdout, "verdict:")).toBe(1);
    expect(r.stdout).toContain("Checkout[U+000A]verdict: ACCEPTED (exit 0)[U+000A][U+001B][2K");
    // The same through the packaged executable, where the bytes really reach a pipe.
    const d = await runDist(evalArgs({ ...ws, outputDir: join(ws.dir, "again") }, ["--now", NOW]));
    expect(hasRawControl(d.stdout)).toBe(false);
    expect(d.stdout).not.toContain(ESC);
  });

  it("explain: title, environment, runner id and deferral reason cannot inject escapes or forge lines", async () => {
    const ws = await hostileWorkspace();
    expect((await runCli(evalArgs(ws, ["--now", NOW]))).code).toBe(0);
    for (const id of ["REQ-001", "REQ-002"]) {
      const r = await runCli(["explain", id, "--report", ws.outputDir]);
      expect(r.code, r.stderr).toBe(0);
      expect(hasRawControl(r.stdout), id).toBe(false);
      expect(linesStartingWith(r.stdout, "title: "), id).toBe(1);
      expect(linesStartingWith(r.stdout, "verdict:"), id).toBe(0);
    }
    const first = await runCli(["explain", "REQ-001", "--report", ws.outputDir]);
    expect(first.stdout).toContain("runner runner[U+001B][31m[U+000A]verdict: ACCEPTED (exit 0)");
    const deferred = await runCli(["explain", "REQ-002", "--report", ws.outputDir]);
    expect(linesStartingWith(deferred.stdout, "deferred: ")).toBe(1);
  });

  it("explain --json stays valid JSON with the control characters escaped by JSON itself", async () => {
    const ws = await hostileWorkspace();
    await runCli(evalArgs(ws, ["--now", NOW]));
    const r = await runCli(["explain", "REQ-001", "--report", ws.outputDir, "--json"]);
    expect(hasRawControl(r.stdout)).toBe(false);
    expect((JSON.parse(r.stdout) as { title: string }).title).toContain(FORGED);
  });

  it("stderr: a file name with ESC and a newline cannot forge a second error line or recolour the terminal", async () => {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws);
    await writeRevisions(ws);
    // A name with control characters is refused outright (path_invalid) without echoing it...
    const name = `bad${ESC}[31m\nproofgate: error [none]: nothing wrong.receipt.json`;
    await mkdir(ws.receiptsDir, { recursive: true });
    await writeFile(join(ws.receiptsDir, name), "{ not json");
    expect(readdirSync(ws.receiptsDir).some((n) => n.includes("\n"))).toBe(true);
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(r.code).toBe(2);
    expect(errorCode(r)).toBe("path_invalid");
    expect(hasRawControl(r.stderr)).toBe(false);
    expect(r.stderr.split("\n").filter((l) => l.startsWith("proofgate: error")).length).toBe(1);
    // ...while a name with only bidi and zero-width characters (which the path rules allow) is echoed neutralised.
    const ws2 = await makeWorkspace();
    made.push(ws2);
    await writeManifest(ws2);
    await writeRevisions(ws2);
    await writeFile(join(ws2.receiptsDir, `bad${RLO}${ZWSP}name.receipt.json`), "{ not json");
    const r2 = await runCli(evalArgs(ws2, ["--now", NOW]));
    expect(errorCode(r2)).toBe("receipt_invalid_json");
    expect(hasRawControl(r2.stderr)).toBe(false);
    expect(r2.stderr).toContain("bad[U+202E][U+200B]name.receipt.json");
  });

  it("stderr: a hostile --now value, unknown command and unknown requirement id are neutralised too", async () => {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws);
    await writeRevisions(ws);
    const clock = await runCli(evalArgs(ws, ["--now", `${ESC}[2Jyesterday`]));
    expect(errorCode(clock)).toBe("clock_invalid");
    expect(hasRawControl(clock.stderr)).toBe(false);
    const unknown = await runCli([`bad${ESC}[0mcommand`]);
    expect(hasRawControl(unknown.stderr)).toBe(false);
    const w2 = await makeWorkspace();
    made.push(w2);
    await writeManifest(w2, baseManifest());
    await writeRevisions(w2);
    await writeReceipt(w2);
    expect((await runCli(evalArgs(w2, ["--now", NOW]))).code).toBe(0);
    const missing = await runCli(["explain", `NOPE${ESC}[31m\nfake`, "--report", w2.outputDir]);
    expect(errorCode(missing)).toBe("explain_unknown_requirement");
    expect(hasRawControl(missing.stderr)).toBe(false);
  });

  it("control: harmless output is byte-for-byte what it was (no over-escaping of normal ids and titles)", async () => {
    const ws = await makeWorkspace();
    made.push(ws);
    await writeManifest(ws, baseManifest({ requirements: [baseRequirement({ title: "Checkout (v2) [smoke]: ok" })] }));
    await writeRevisions(ws);
    await writeReceipt(ws);
    const r = await runCli(evalArgs(ws, ["--now", NOW]));
    expect(r.stdout).toContain("Checkout (v2) [smoke]: ok");
    expect(r.stdout).not.toContain("[U+");
    expect(sha256(readFileSync(join(ws.outputDir, "report.json"), "utf8")).length).toBe(64);
  });
});

