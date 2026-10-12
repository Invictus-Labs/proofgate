/**
 * Review round 4 (security P1s), end to end: the depth-parametric secrets go into a receipt (as extension text and as the
 * receipt's command) and through evaluate, `evaluate --json`, bundle export, verify and restore. No marker of any planted
 * secret may appear in ANY byte those steps produce: stdout and stderr, report.json, report.sha256, index.html, the JSON output,
 * the bundle, the restored receipts and the restored report. Each (template, secret, depth) has its own marker, so a failure
 * names the shape. The keys that made redaction non-idempotent are round-tripped too (receipt and manifest extensions).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cycle } from "../helpers/cycle.js";
import { FAKE } from "../helpers/fake-secrets.js";
import { baseManifest, baseRequirement, makeWorkspace, passingWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";
import { DEPTHS, TEMPLATES, nest, secrets } from "../helpers/redaction-templates.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

describe("planted secrets, every template x every secret x depth 0 to 8, never reach any output", () => {
  it("in receipt extensions", async () => {
    const w = await passingWorkspace();
    made.push(w);
    const extensions: Record<string, unknown> = {};
    const markers: Array<{ where: string; marker: string }> = [];
    TEMPLATES.forEach((template, i) => {
      for (const k of DEPTHS) {
        // one tag per (template, depth): every marker is unique to the shape that planted it
        secrets(`T${i}D${k}`).forEach((secret, s) => {
          if (!template.quoted && !secret.plain) return;
          extensions[`t${i}_${s}_${k}`] = `run ${nest(template.make(secret.value), k)} end`;
          for (const marker of secret.markers) markers.push({ where: `${template.name} / ${secret.label} / depth ${k}`, marker });
        });
      }
    });
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-depth-1", extensions } });
    const out = await cycle(w, "extensions");
    const leaked = markers.filter(({ marker }) => out.everything.includes(marker)).map(({ where, marker }) => `${where}: ${marker}`);
    expect(leaked.slice(0, 12), `${leaked.length} of ${markers.length} planted secrets survive`).toEqual([]);
    // control: the receipt is still there, so the run did not simply drop the text
    expect(out.everything).toContain("rcpt-depth-1");
    expect(out.everything).toContain("[REDACTED]");
  }, 240_000);

  it("in the receipt command (2000 characters), depth 0 to 3", async () => {
    const survived: string[] = [];
    let n = 0;
    for (const template of TEMPLATES) {
      n += 1;
      for (const k of [0, 1, 2, 3]) {
        const secret = secrets(`C${n}D${k}`)[0]!;
        const command = `run ${nest(template.make(secret.value), k)}`;
        if (command.length > 1900) continue;
        const w = await makeWorkspace();
        made.push(w);
        await writeManifest(w);
        await writeRevisions(w);
        await writeReceipt(w, { receipt: { receipt_id: `rcpt-cmd-${n}-${k}`, command } });
        const out = await cycle(w, `command ${template.name} depth ${k}`);
        if (out.everything.includes(secret.markers[0]!)) survived.push(`${template.name} / depth ${k}`);
      }
    }
    expect(survived).toEqual([]);
  }, 480_000);
});

describe("keys that only become credential-looking after redaction round-trip through a bundle", () => {
  const KEYS = [`pass${FAKE.githubToken}`, `token${FAKE.githubToken}`, `api_key${FAKE.slackToken}`, `auth${FAKE.npmToken}`, `pwd${FAKE.gitlabToken}`, "\\nbearer abcdefghijklmnop", `${FAKE.githubToken}cookie`];

  it.each(KEYS.map((k) => [k.slice(0, 24), k] as const))("receipt extension key %s", async (_label, key) => {
    const w = await passingWorkspace();
    made.push(w);
    await writeReceipt(w, { receipt: { receipt_id: "rcpt-key-1", extensions: { [key]: { inner: "harmless value" }, note: "kept" } } });
    const out = await cycle(w, "receipt key");
    expect(out.everything.includes(FAKE.githubToken)).toBe(false);
  });

  it.each(KEYS.map((k) => [k.slice(0, 24), k] as const))("manifest extension key %s", async (_label, key) => {
    const w = await makeWorkspace();
    made.push(w);
    await writeManifest(w, baseManifest({ requirements: [baseRequirement()], extensions: { [key]: "harmless", note: "kept" } }));
    await writeRevisions(w);
    await writeReceipt(w);
    const out = await cycle(w, "manifest key");
    expect(out.everything.includes(FAKE.githubToken)).toBe(false);
  });
});
