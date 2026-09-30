/**
 * Review round 4 (security P1 and logic P2-1): whatever the reason, `bundle export` must never publish a file that
 * `bundle verify` and `bundle restore` would refuse. A backup that can be written but not restored is worse than none.
 * To exercise the guard independently of any particular redaction bug, redaction is replaced here by a version that is NOT
 * idempotent (every pass appends a marker to every `extensions.note`), which is exactly what the reviewers' keys did in
 * effect: the stored document differs from what a second pass produces. Export must refuse, say why, and leave no file
 * and no temporary file behind.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, passingWorkspace, writeReceipt, type Workspace } from "../helpers/fixture.js";

let nonIdempotent = false;
vi.mock("../../src/redact.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/redact.js")>();
  return {
    ...original,
    redactValue: <T,>(value: T): T => {
      const out = original.redactValue(value);
      if (!nonIdempotent) return out;
      const doc = out as { extensions?: { note?: unknown } } | null;
      if (doc !== null && typeof doc === "object" && doc.extensions !== undefined && typeof doc.extensions.note === "string") {
        return { ...doc, extensions: { ...doc.extensions, note: `${doc.extensions.note}+` } } as T;
      }
      return out;
    },
  };
});

const made: Workspace[] = [];
afterEach(async () => {
  nonIdempotent = false;
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

describe("bundle export refuses to publish a bundle that verify would refuse", () => {
  it("control: with idempotent redaction the same export succeeds and verifies", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-note-1", extensions: { note: "kept" } } });
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const bundle = join(w.dir, "ok.pgbundle");
    const exported = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
    expect([exported.code, exported.stderr]).toEqual([0, expect.any(String)]);
    expect((await runCli(["bundle", "verify", bundle])).code).toBe(0);
  });

  it("a non-idempotent redaction makes export exit 2, name the mismatch, and leave nothing behind", async () => {
    const w = await passingWorkspace();
    made.push(w);
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-note-1", extensions: { note: "kept" } } });
    nonIdempotent = true;
    expect((await runCli(evalArgs(w, ["--now", NOW]))).code).toBe(0);
    const bundle = join(w.dir, "bad.pgbundle");
    const exported = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
    expect([exported.code, errorCode(exported)], exported.stderr).toEqual([2, "bundle_reevaluation_mismatch"]);
    expect(exported.stderr).toMatch(/would not verify|cannot be verified|not published/i);
    expect(existsSync(bundle), "no bundle file is published").toBe(false);
    expect(readdirSync(w.dir).filter((n) => n.includes("bad.pgbundle")), "no temporary file is left next to it").toEqual([]);
  });
});
