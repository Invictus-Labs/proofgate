// Secret and content hygiene scan for the public repository.
// Usage: node scripts/hygiene-scan.mjs [--root <dir>]
//   Default: scans every tracked and every untracked-but-not-ignored file of the git repository in the current
//   directory. With --root, scans every file under that directory instead (used by the scan's own negative control).
// Exit 0 when clean, 1 when a finding exists. Findings print file:line and the rule, never the matched text.
//
// Rules (all applied to text files; binary files are skipped):
//   credential-shaped literals   cloud, VCS, chat and payment tokens, JWTs, private-key blocks
//   personal filesystem paths    /Users/<name>, /home/<name>, C:\Users\<name>
//   e-mail addresses             except the reserved example.invalid domain
//   UUID literals                only under fixtures/ and tests/fixtures/ (committed data must use opaque ids)
//   GitHub Actions workflows     a .github/workflows directory is not allowed in this repository
//   forbidden files              .env files, private keys, node_modules, dist, coverage and tarballs must not be tracked
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const explicitRoot = rootIndex === -1 ? undefined : args[rootIndex + 1];
const cwd = explicitRoot ?? process.cwd();

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() || entry.isSymbolicLink()) out.push(p);
  }
  return out;
}

let files;
if (explicitRoot !== undefined) {
  files = walk(explicitRoot).map((p) => relative(explicitRoot, p).split(sep).join("/"));
} else {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  files = [...new Set(listed.split("\0").filter(Boolean))];
}
// Deleted-but-still-listed files are not a finding.
files = files.filter((f) => existsSync(join(cwd, f)) && statSync(join(cwd, f)).isFile());

const RULES = [
  // "Not preceded by a letter or digit" rather than \b, so TOKEN_ghp_... (an underscore is a word character) is still found.
  ["credential: AWS access key id", /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/],
  ["credential: GitHub token", /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36,}/],
  ["credential: GitHub fine-grained token", /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{22,}/],
  ["credential: Slack token", /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/],
  ["credential: API secret key", /(?<![A-Za-z0-9])sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ["credential: payment secret key", /(?<![A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/],
  ["credential: Google API key", /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/],
  ["credential: JWT", /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["internal board or ticket reference", /Board:\s*#\d+/],
  ["credential: password in URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@[^\s/]+/i],
  ["personal path", /(?:\/Users\/[A-Za-z][\w.-]*|\/home\/[a-z][\w.-]*|[A-Za-z]:\\Users\\[A-Za-z][\w.-]*)/],
  ["e-mail address", /\b[A-Za-z0-9._%+-]+@(?!example\.invalid\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/],
];
// A private-key block is a header followed by key material (a bare header inside a redaction test is not a key).
const KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/]{40,}/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const FORBIDDEN_FILES = [
  [/(^|\/)\.env(\..*)?$/, /(^|\/)\.env\.example$/, "environment file"],
  [/\.(pem|key|p12|pfx)$/, undefined, "key material file"],
  [/(^|\/)node_modules\//, undefined, "node_modules"],
  [/^(dist|coverage|test-results|playwright-report)\//, undefined, "build or test output"],
  [/\.tgz$/, undefined, "packed tarball"],
  [/^\.github\/workflows\//, undefined, "GitHub Actions workflow (banned: the gate is local)"],
];
// This file names the patterns it searches for, so it must not match itself.
const SELF = "scripts/hygiene-scan.mjs";
// The PRD and its diagram pack are frozen source documents that may quote example identifiers; content rules still apply.
const findings = [];
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
// Invisible and reordering characters (C0/C1 controls other than tab, zero-width, bidi, separators, BOM, tags). Numeric ranges
// so that none appears in this file. A hostile-string test must build them from code points, never store them raw.
const INVISIBLE = [
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f],
  [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0xe0000, 0xe007f],
];
function hasInvisible(line) {
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    if (INVISIBLE.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
  }
  return false;
}

for (const file of files) {
  for (const [pattern, allow, label] of FORBIDDEN_FILES) {
    if (pattern.test(file) && !(allow && allow.test(file))) findings.push(`${file}: forbidden file (${label})`);
  }
  if (file === SELF) continue;
  const buf = readFileSync(join(cwd, file));
  if (isBinary(buf)) continue;
  const text = buf.toString("utf8");
  const key = KEY_BLOCK.exec(text);
  if (key !== null) findings.push(`${file}:${text.slice(0, key.index).split("\n").length}: credential: private key block`);
  const lines = text.split("\n");
  const inCommittedData = file.startsWith("fixtures/") || file.startsWith("tests/fixtures/");
  lines.forEach((line, i) => {
    if (hasInvisible(line)) findings.push(`${file}:${i + 1}: invisible or bidi control character in a text file (write it as an escape or a numeric code point)`);
    for (const [label, re] of RULES) if (re.test(line)) findings.push(`${file}:${i + 1}: ${label}`);
    if (inCommittedData && UUID.test(line)) findings.push(`${file}:${i + 1}: UUID literal in committed data (use an opaque id)`);
  });
}

if (findings.length > 0) {
  console.log(`hygiene scan: ${findings.length} finding(s) in ${files.length} file(s)`);
  for (const f of findings.slice(0, 200)) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`hygiene scan: clean (${files.length} files, ${RULES.length + 4} rules)`);
