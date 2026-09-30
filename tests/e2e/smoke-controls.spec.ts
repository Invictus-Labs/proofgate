/**
 * Controls for the browser smoke (tests/e2e/smoke.spec.ts). A smoke that cannot go red proves nothing, so this file
 *  A. feeds deliberately bad pages to the same kind of observers and requires each fault to be seen, in real Chromium, and
 *  B. adds the strict layout rule that a stacked table at phone width never scrolls sideways on the real CLI output.
 * Test IDs in docs/qa/ac-matrix.md have the form `file :: describe > test`.
 */
import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readPackInfo } from "./support/pack.js";

let scratch = "";
let server: Server;
let hits: string[] = [];
let port = 0;

test.beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "pg-controls-")));
  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.setHeader("content-type", "image/gif");
    res.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
});
test.beforeEach(() => {
  hits = [];
});

function observe(page: Page) {
  const seen = { console: [] as string[], requests: [] as string[], dialogs: [] as string[] };
  page.on("console", (m) => seen.console.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => seen.console.push(`pageerror: ${String(e)}`));
  page.on("request", (r) => seen.requests.push(r.url()));
  page.on("dialog", (d) => {
    seen.dialogs.push(d.message());
    void d.dismiss();
  });
  return seen;
}

function writePage(name: string, body: string): string {
  const file = join(scratch, `${name}.html`);
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head><body>${body}</body></html>`);
  return pathToFileURL(file).href;
}

test.describe("controls: the smoke observers see real faults in real Chromium", () => {
  test("a page that runs script is seen: the script element, the global it sets, the dialog and the console error", async ({ page }) => {
    const seen = observe(page);
    await page.goto(writePage("script", `<p>x</p><script>window.__pwned = 1; console.error("boom"); alert("hi");</script>`));
    expect(await page.evaluate(() => document.scripts.length)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(1);
    expect(seen.console.join("\n")).toContain("boom");
    expect(seen.dialogs).toEqual(["hi"]);
  });

  test("a page that loads an image over the network is seen as a request beyond the document", async ({ page }) => {
    const seen = observe(page);
    const url = writePage("network", `<img src="http://127.0.0.1:${port}/pixel.gif" alt="">`);
    await page.goto(url);
    await page.waitForLoadState("load");
    expect(seen.requests.filter((r) => r !== url).length).toBeGreaterThan(0);
    expect(hits).toEqual(["/pixel.gif"]);
  });

  test("a page whose table is wider than the viewport overflows horizontally at 375px and is measured as such", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(writePage("overflow", `<table style="width:900px"><tr><td>wide</td><td>wide</td></tr></table>`));
    const m = await page.evaluate(() => ({ scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), vw: window.innerWidth }));
    expect(m.scroll).toBeGreaterThan(m.vw);
  });

  test("markup that is NOT escaped becomes a live element, which the smoke's 'dangerous element' count would catch", async ({ page }) => {
    await page.goto(writePage("unescaped", `<p><img src=x onerror="window.__pwned=2"></p>`));
    const n = await page.evaluate(() => document.querySelectorAll("img,svg,iframe,object,embed,link,form,input,button").length);
    expect(n).toBe(1);
  });
});

let renderCount = 0;
async function renderReal(name: string): Promise<string> {
  const demo = join(readPackInfo().packageDir, "fixtures", "demo", name);
  const out = join(scratch, `real-${name}-${(renderCount += 1)}`);
  await new Promise<void>((resolve, reject) => {
    execFile(readPackInfo().bin, ["evaluate", "--manifest", join(demo, "requirements.yaml"), "--receipts", join(demo, "receipts"), "--revisions", join(demo, "revisions.json"), "--output", out, "--now", "2026-09-29T12:00:00Z"], { env: { PATH: process.env.PATH ?? "" } }, (error) => {
      const code = error === null ? 0 : (error as { code?: number }).code;
      if (code === 0 || code === 1) resolve();
      else reject(new Error(`evaluate ${name} failed with ${String(code)}`));
    });
  });
  return pathToFileURL(join(out, "index.html")).href;
}

test.describe("layout rule on the real CLI output: no table needs sideways scrolling at phone width", () => {
  for (const scenario of ["happy", "unsatisfied"]) {
    test(`${scenario}: at 375px every table is stacked or fits, and none scrolls sideways inside its wrapper`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(await renderReal(scenario));
      const tables = await page.evaluate(() =>
        [...document.querySelectorAll("table")].map((t) => {
          const wrap = t.closest(".scroll");
          const row = t.querySelector("tbody tr");
          return {
            caption: t.querySelector("caption")?.textContent?.trim().slice(0, 50) ?? "",
            stacked: row !== null && getComputedStyle(row).display === "block",
            scrollsSideways: wrap !== null && wrap.scrollWidth > wrap.clientWidth + 1,
            tableWiderThanViewport: t.getBoundingClientRect().width > window.innerWidth + 1,
          };
        }),
      );
      expect(tables.length).toBeGreaterThanOrEqual(4);
      expect(tables.filter((t) => t.scrollsSideways).map((t) => t.caption), "tables that scroll sideways at 375px").toEqual([]);
      expect(tables.filter((t) => t.tableWiderThanViewport).map((t) => t.caption)).toEqual([]);
      expect(tables.some((t) => t.stacked), "at least the requirement tables are stacked into cards at phone width").toBe(true);
    });
  }

  test("at 1440px the requirements table shows all its columns without scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(await renderReal("unsatisfied"));
    const scrolls = await page.evaluate(() => [...document.querySelectorAll(".scroll")].filter((w) => w.scrollWidth > w.clientWidth + 1).map((w) => w.querySelector("caption")?.textContent?.trim().slice(0, 50) ?? ""));
    expect(scrolls).toEqual([]);
  });
});
