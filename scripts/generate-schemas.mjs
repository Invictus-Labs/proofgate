// Generates schemas/*.json (JSON Schema draft 2020-12) from the runtime zod validators in dist/.
// Usage: node scripts/generate-schemas.mjs [--check]   (run `npm run build` first)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { manifestSchema, receiptSchema, reportSchema, revisionsSchema, runproofDocumentSchema } from "../dist/schemas.js";
import { envelopeSchema } from "../dist/adapters/envelope.js";
import { bundleHeaderSchema } from "../dist/bundle.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const targets = {
  "manifest.json": ["Requirements manifest (authored as YAML or JSON)", manifestSchema, "input"],
  "receipt.json": ["Test receipt, native format", receiptSchema, "input"],
  "revisions.json": ["Revision set", revisionsSchema, "input"],
  "report.json": ["Acceptance report", reportSchema, "output"],
  "evidence-bundle.json": ["Evidence bundle header", bundleHeaderSchema, "output"],
  "event-envelope.json": ["Adapter event envelope", envelopeSchema, "output"],
  "runproof-run-detail.json": ["RunProof run-detail import document", runproofDocumentSchema, "input"],
};

let drift = 0;
for (const [file, [title, schema, io]] of Object.entries(targets)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io });
  const doc = { ...json, $id: `urn:proofgate:schema:${file.replace(/\.json$/, "")}:1`, title };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const path = join(root, "schemas", file);
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      console.error(`schema drift: schemas/${file} does not match the runtime validator`);
      drift += 1;
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`wrote schemas/${file}`);
  }
}
if (check && drift > 0) process.exit(1);
if (check) console.log("schemas match the runtime validators");
