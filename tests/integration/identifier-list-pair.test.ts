/**
 * Swarm review P1s: the list-pair redaction rule (`["--password", "S"]`: the element after a credential name is a value) also ran
 * over the engine's own identifier LISTS. A requirement id such as AUTH-001, a repository called `auth` or a receipt id such as
 * `auth-e2e-api-001` names a credential word, so the NEXT id in the list was rewritten to [REDACTED]:
 *  - the manifest (`repositories: [auth, web]`) and a receipt (`requirement_ids: [AUTH-001, AUTH-002]`) were refused with exit 2;
 *  - assess() ran the same rule over the finished report, so `receipt_ids` came out as [..., "[REDACTED]"]: evaluate exited 0
 *    but wrote a report that `explain` and `bundle export` refuse as report_invalid.
 * Identifier lists are judged element by element; a credential-looking identifier is still refused (identifier-paths.test.ts).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MANIFEST_IDENTIFIER_PATHS, RECEIPT_IDENTIFIER_PATHS, assertIdentifiersUnredacted, redactDocument } from "../../src/identifiers.js";
import { errorCode, evalArgs, runCli } from "../helpers/cli.js";
import { NOW, REPOS, baseManifest, baseRequirement, makeWorkspace, writeManifest, writeReceipt, writeRevisions, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

async function credentialWordWorkspace(): Promise<Workspace> {
  const w = await makeWorkspace();
  made.push(w);
  await writeManifest(
    w,
    baseManifest({
      repositories: [{ id: "auth" }, { id: "web" }],
      requirements: [
        baseRequirement({ id: "AUTH-001", repositories: ["auth", "web"] }),
        baseRequirement({ id: "AUTH-002", repositories: ["auth", "web"] }),
      ],
    }),
  );
  await writeRevisions(w, { auth: REPOS.api, web: REPOS.web });
  await writeReceipt(w, { receipt: { receipt_id: "auth-e2e-api-001", requirement_ids: ["AUTH-001", "AUTH-002"], repository: "auth", commit_sha: REPOS.api } });
  await writeReceipt(w, { receipt: { receipt_id: "auth-e2e-web-001", requirement_ids: ["AUTH-001", "AUTH-002"], repository: "web", commit_sha: REPOS.web } });
  return w;
}

describe("identifier lists that start with a credential word", () => {
  it("evaluate accepts them and writes a report that explain and bundle export can read back", async () => {
    const w = await credentialWordWorkspace();
    const r = await runCli(evalArgs(w, ["--now", NOW]));
    expect([r.code, errorCode(r)], r.stderr).toEqual([0, undefined]);
    const report = JSON.parse(await readFile(join(w.outputDir, "report.json"), "utf8")) as { requirements: Array<{ receipt_ids: string[]; repositories: string[] }>; receipts: Array<{ requirement_ids: string[] }> };
    for (const d of report.requirements) {
      expect(d.receipt_ids).toEqual(["auth-e2e-api-001", "auth-e2e-web-001"]);
      expect(d.repositories).toEqual(["auth", "web"]);
    }
    for (const rc of report.receipts) expect(rc.requirement_ids).toEqual(["AUTH-001", "AUTH-002"]);
    expect(await readFile(join(w.outputDir, "report.json"), "utf8")).not.toContain("[REDACTED]");

    const explained = await runCli(["explain", "--report", w.outputDir, "AUTH-002"]);
    expect([explained.code, errorCode(explained)], explained.stderr).toEqual([0, undefined]);
    const bundle = join(w.dir, "evidence.pgbundle");
    const exported = await runCli(["bundle", "export", "--report", w.outputDir, "--manifest", w.manifestPath, "--receipts", w.receiptsDir, "--revisions", w.revisionsPath, "--output", bundle]);
    expect([exported.code, errorCode(exported)], exported.stderr).toEqual([0, undefined]);
  });

  it("redactDocument judges identifier lists element by element, and still rewrites a credential-looking element", () => {
    const manifest = { requirements: [{ id: "AUTH-001", repositories: ["auth", "web"] }] };
    expect(redactDocument(manifest, MANIFEST_IDENTIFIER_PATHS)).toEqual(manifest);
    const receipt = { requirement_ids: ["AUTH-001", "AUTH-002"], binding: { requirement_ids: ["TOKEN-1", "TOKEN-2"] } };
    expect(redactDocument(receipt, RECEIPT_IDENTIFIER_PATHS)).toEqual(receipt);
    const secret = ["tok", "en=", "z".repeat(24)].join("");
    const hostile = { requirement_ids: ["AUTH-001", secret] };
    expect(() => assertIdentifiersUnredacted(hostile, redactDocument(hostile, RECEIPT_IDENTIFIER_PATHS), RECEIPT_IDENTIFIER_PATHS, "r.json", "receipt_schema_invalid")).toThrow(/looks like a credential/);
  });

  it("the list-pair rule still applies to lists that are not identifier lists", () => {
    const doc = { requirement_ids: ["AUTH-001"], command_argv: ["tool", "--password", "hunter2hunter2"] };
    expect((redactDocument(doc, RECEIPT_IDENTIFIER_PATHS) as typeof doc).command_argv[2]).toBe("[REDACTED]");
  });
});
