import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReport } from "../../src/report.js";
import { renderReportHtml } from "../../src/web/render.js";
import { bodyText, parseHtml } from "../helpers/html-tokens.js";
import { evalArgs, runCli, runDist } from "../helpers/cli.js";
import { FAKE } from "../helpers/fake-secrets.js";
import { NOW, REPOS, baseManifest, baseRequirement, makeWorkspace, writeManifest, writeReceipt, writeRevisions, uuid, type Workspace } from "../helpers/fixture.js";
import { violations } from "../helpers/report-invariants.js";

/**
 * AC-05 / AC-07 / AC-09 through the real pipeline and the real CLI: evaluate writes index.html next to
 * report.json, the HTML is exactly what the renderer produces for that report.json, and hostile or secret
 * text planted in the inputs ends up as inert text (or redacted) in the page.
 */

const workspaces: Workspace[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((w) => w.cleanup()));
});

async function workspace(setup: (ws: Workspace) => Promise<void>): Promise<Workspace> {
  const ws = await makeWorkspace();
  workspaces.push(ws);
  await setup(ws);
  return ws;
}

const NOW_ARGS = ["--now", NOW];

describe("evaluate writes the static HTML report", () => {
  it("exit 0: index.html is written privately, is exactly the rendering of report.json and shows ACCEPTED", async () => {
    const ws = await workspace(async (w) => {
      await writeManifest(w);
      await writeRevisions(w);
      await writeReceipt(w, { receipt: { receipt_id: uuid(1) } });
    });
    const result = await runCli(evalArgs(ws, NOW_ARGS));
    expect(result.code).toBe(0);
    expect(readdirSync(ws.outputDir).sort()).toEqual(["index.html", "report.json", "report.sha256"]);
    expect(statSync(join(ws.outputDir, "index.html")).mode & 0o777).toBe(0o600);
    const { report } = await readReport(ws.outputDir);
    const page = readFileSync(join(ws.outputDir, "index.html"), "utf8");
    expect(page).toBe(renderReportHtml(report));
    expect(violations(page)).toEqual([]);
    expect(bodyText(parseHtml(page).tokens)).toContain("Verdict accepted, exit code 0");
  });

  it("a planted mandatory failure changes exit 0 to exit 1 and the page changes from ACCEPTED to no accepted result", async () => {
    const good = await workspace(async (w) => {
      await writeManifest(w);
      await writeRevisions(w);
      await writeReceipt(w, { receipt: { receipt_id: uuid(1) } });
    });
    const bad = await workspace(async (w) => {
      await writeManifest(w);
      await writeRevisions(w);
      await writeReceipt(w, { receipt: { receipt_id: uuid(1), result: "fail", tests: { total: 10, passed: 9, failed: 1, skipped: 0 } } });
    });
    expect((await runCli(evalArgs(good, NOW_ARGS))).code).toBe(0);
    expect((await runCli(evalArgs(bad, NOW_ARGS))).code).toBe(1);
    const goodText = bodyText(parseHtml(readFileSync(join(good.outputDir, "index.html"), "utf8")).tokens);
    const badText = bodyText(parseHtml(readFileSync(join(bad.outputDir, "index.html"), "utf8")).tokens);
    expect(goodText).toContain("Verdict accepted, exit code 0");
    expect(badText).toContain("NO ACCEPTED RESULT");
    expect(badText).toContain("tests_failed");
    expect(badText).toContain("Fix the failing tests");
    expect(badText).not.toContain("Verdict accepted");
  });

  it("the same inputs and the same fixed clock give byte-identical index.html in two different directories", async () => {
    const make = () =>
      workspace(async (w) => {
        await writeManifest(w);
        await writeRevisions(w);
        await writeReceipt(w, { receipt: { receipt_id: uuid(1) }, artifact: "same bytes" });
      });
    const a = await make();
    const b = await make();
    await runCli(evalArgs(a, NOW_ARGS));
    await runCli(evalArgs(b, NOW_ARGS));
    expect(readFileSync(join(a.outputDir, "index.html"))).toEqual(readFileSync(join(b.outputDir, "index.html")));
  });

  it("hostile text planted in the inputs is shown as text and planted secrets never reach the page", async () => {
    const payload = `<img src=x onerror="alert(1)"><script>alert('x')</script>`;
    const ws = await workspace(async (w) => {
      await writeManifest(w, baseManifest({ requirements: [baseRequirement({ title: `${payload} ${FAKE.githubToken}` })] }));
      await writeRevisions(w);
      await writeReceipt(w, { receipt: { receipt_id: uuid(1), runner_id: payload, command: `deploy --token ${FAKE.awsKey} ${payload}` } });
    });
    expect((await runCli(evalArgs(ws, NOW_ARGS))).code).toBe(0);
    const page = readFileSync(join(ws.outputDir, "index.html"), "utf8");
    expect(violations(page)).toEqual([]);
    expect(bodyText(parseHtml(page).tokens)).toContain(payload);
    expect(page).not.toContain("<script>alert");
    for (const secret of [FAKE.githubToken, FAKE.awsKey]) expect(page).not.toContain(secret);
  });

  it("a traversal artifact path in the receipts (exit 2) produces no report and therefore no index.html", async () => {
    const ws = await workspace(async (w) => {
      await writeManifest(w);
      await writeRevisions(w);
      await writeReceipt(w, { receipt: { receipt_id: uuid(1) }, artifactPath: "../escape.xml" });
    });
    const result = await runCli(evalArgs(ws, NOW_ARGS));
    expect(result.code).toBe(2);
    expect(() => statSync(ws.outputDir)).toThrow();
  });

  it("the packaged executable (dist/cli.js) also writes index.html", async () => {
    const ws = await workspace(async (w) => {
      await writeManifest(w);
      await writeRevisions(w, REPOS);
      await writeReceipt(w, { receipt: { receipt_id: uuid(1) } });
    });
    const result = await runDist(evalArgs(ws, NOW_ARGS), { cwd: ws.dir });
    expect(result.code).toBe(0);
    const { report } = await readReport(ws.outputDir);
    expect(readFileSync(join(ws.outputDir, "index.html"), "utf8")).toBe(renderReportHtml(report));
  });
});
