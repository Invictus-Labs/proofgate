// Builds the package, packs it with `npm pack`, records the tarball's SHA-256 and installs the tarball into a fresh
// temporary consumer project OUTSIDE this repository. Prints one JSON document describing the result.
// Usage: node scripts/pack-install.mjs [--out <dir>] [--no-install]
// The install step needs the npm registry (or a warm npm cache) for the two runtime dependencies; --prefer-offline is used.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const outArg = option("--out");
const out = resolve(outArg ?? mkdtempSync(join(realpathSync(tmpdir()), "proofgate-pack-")));
mkdirSync(out, { recursive: true });
const rel = relative(realpathSync(root), realpathSync(out));
if (!rel.startsWith("..") && !rel.startsWith("/")) {
  console.error("pack-install: --out must be outside the repository");
  process.exit(2);
}

const run = (cmd, cmdArgs, cwd, extra = {}) =>
  execFileSync(cmd, cmdArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...extra });

// A stale dist would make the packed evidence meaningless, so always rebuild.
run("npm", ["run", "build", "--silent"], root);

const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", out], root));
const entry = packed[0];
const tarball = join(out, entry.filename);
const bytes = readFileSync(tarball);
const sha256 = createHash("sha256").update(bytes).digest("hex");
writeFileSync(join(out, "SHA256SUMS"), `${sha256}  ${entry.filename}\n`);

const result = {
  out,
  tarball,
  filename: entry.filename,
  sha256,
  bytes: bytes.length,
  version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
  files: entry.files.map((f) => f.path).sort(),
};

if (!flag("--no-install")) {
  const consumer = join(out, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({ name: "proofgate-consumer", version: "0.0.0", private: true }, null, 2)}\n`);
  run("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", "--ignore-scripts", tarball], consumer);
  result.consumer = consumer;
  result.packageDir = join(consumer, "node_modules", "proofgate");
  result.bin = join(consumer, "node_modules", ".bin", "proofgate");
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
