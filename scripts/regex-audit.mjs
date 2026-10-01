/**
 * Static audit of the regular expressions in src/ for backtracking blow-up. Dependency-free (a light lexer, not a parser of JavaScript): it finds every regex
 * literal and every `new RegExp("...")` with a string argument, and classifies the risky shapes:
 *   E  a group that is quantified without a small bound and holds an unbounded quantifier or an alternation: `(a+)+`, `(?:\\+[nr]?|%0A)+`, `(x|xy)*`
 *      (exponential when a tail fails; the round-6 review reproduced 1,377 ms at 24 characters)
 *   T  an unbounded quantifier right in front of an end anchor `$`, in an expression that does not start with `^` and is not sticky/global-anchored:
 *      it retries at every start position of a long run that does not end the text (quadratic)
 * `new RegExp(<expression>)` with a dynamic source is reported as D (reviewed by hand). Usage: node scripts/regex-audit.mjs [--all]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const KEYWORD_PRECEDERS = new Set(["return", "typeof", "case", "in", "of", "void", "delete", "throw", "else", "do"]);

/** Every regex literal and `new RegExp("...")` in a TypeScript/JavaScript source: [{ line, kind, source, flags }]. */
export function extractRegexes(text) {
  const out = [];
  let i = 0;
  let line = 1;
  let prev = ""; // last significant token: a punctuation character, or a word
  const n = text.length;
  const skipString = (quote) => {
    i += 1;
    while (i < n && text[i] !== quote) {
      if (text[i] === "\\") i += 1;
      if (text[i] === "\n") line += 1;
      i += 1;
    }
    i += 1;
  };
  const skipTemplate = () => {
    i += 1;
    while (i < n && text[i] !== "`") {
      if (text[i] === "\\") i += 1;
      else if (text[i] === "$" && text[i + 1] === "{") {
        // a substitution: skip to its closing brace (nested braces and strings are counted, regex literals inside are not searched)
        let depth = 1;
        i += 2;
        while (i < n && depth > 0) {
          const ch = text[i];
          if (ch === "{") depth += 1;
          else if (ch === "}") depth -= 1;
          else if (ch === '"' || ch === "'") {
            skipString(ch);
            continue;
          } else if (ch === "`") {
            skipTemplate();
            continue;
          } else if (ch === "\n") line += 1;
          i += 1;
        }
        continue;
      }
      if (text[i] === "\n") line += 1;
      i += 1;
    }
    i += 1;
  };
  while (i < n) {
    const c = text[i];
    if (c === "\n") {
      line += 1;
      i += 1;
    } else if (c === " " || c === "\t" || c === "\r") i += 1;
    else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i += 1;
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
    } else if (c === '"' || c === "'") {
      skipString(c);
      prev = "str";
    } else if (c === "`") {
      skipTemplate();
      prev = "str";
    } else if (c === "/" && (REGEX_PRECEDERS.has(prev) || KEYWORD_PRECEDERS.has(prev))) {
      const startLine = line;
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const ch = text[j];
        if (ch === "\\") j += 2;
        else {
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) break;
          else if (ch === "\n") break;
          j += 1;
        }
      }
      const source = text.slice(i + 1, j);
      let k = j + 1;
      while (k < n && /[a-z]/.test(text[k])) k += 1;
      out.push({ line: startLine, kind: "literal", source, flags: text.slice(j + 1, k) });
      i = k;
      prev = "regex";
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      if (word === "RegExp" && /^new\s*$/.test(prev === "new" ? "new" : "")) {
        // new RegExp( "..." [, "flags"] )
        let k = j;
        while (text[k] === " ") k += 1;
        if (text[k] === "(") {
          k += 1;
          while (/\s/.test(text[k])) k += 1;
          const q = text[k];
          if (q === '"' || q === "'") {
            let m = k + 1;
            let source = "";
            while (m < n && text[m] !== q) {
              if (text[m] === "\\") {
                source += text[m + 1] === "\\" ? "\\" : text[m + 1] === q ? q : `\\${text[m + 1]}`;
                m += 2;
              } else {
                source += text[m];
                m += 1;
              }
            }
            const after = /^\s*,\s*["']([a-z]*)["']/.exec(text.slice(m + 1, m + 30));
            out.push({ line, kind: "new RegExp(string)", source, flags: after?.[1] ?? "" });
          } else if (q === "`") {
            // a template literal: its text with every ${...} replaced by one opaque character (the substituted constants are reviewed by hand)
            let m = k + 1;
            let source = "";
            while (m < n && text[m] !== "`") {
              if (text[m] === "\\") {
                source += text[m + 1] === "\\" ? "\\" : `\\${text[m + 1]}`;
                m += 2;
              } else if (text[m] === "$" && text[m + 1] === "{") {
                let depth = 1;
                m += 2;
                while (m < n && depth > 0) {
                  if (text[m] === "{") depth += 1;
                  else if (text[m] === "}") depth -= 1;
                  m += 1;
                }
                source += "\u0001";
              } else {
                source += text[m];
                m += 1;
              }
            }
            const after = /^\s*,\s*["']([a-z]*)["']/.exec(text.slice(m + 1, m + 30));
            out.push({ line, kind: "new RegExp(template)", source, flags: after?.[1] ?? "" });
          } else out.push({ line, kind: "new RegExp(dynamic)", source: text.slice(k, k + 60).split("\n")[0] ?? "", flags: "" });
        }
      }
      i = j;
      prev = word;
    } else if (/[0-9]/.test(c)) {
      while (i < n && /[0-9A-Za-z_.]/.test(text[i])) i += 1;
      prev = "num";
    } else {
      prev = c === ")" || c === "]" ? "close" : c;
      i += 1;
    }
  }
  return out;
}

/** The quantifier that starts at `at` of a regex source: { length, unbounded, max } or undefined. */
function quantifierAt(source, at) {
  const c = source[at];
  let length = 0;
  let unbounded = false;
  let max = 1;
  if (c === "*" || c === "+") {
    length = 1;
    unbounded = true;
  } else if (c === "?") length = 1;
  else if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(at, at + 24));
    if (m === null) return undefined;
    length = m[0].length;
    if (m[2] === undefined) max = Number(m[1]);
    else if (m[3] === "") unbounded = true;
    else max = Number(m[3]);
  } else return undefined;
  if (source[at + length] === "?") length += 1; // lazy
  return { length, unbounded, max };
}

/** The risky shapes of one regex source: [{ shape: "E" | "T", detail }]. */
export function analyseRegex(source, flags = "") {
  const findings = [];
  const frames = [];
  let cur = { hasUnbounded: false, hasAlt: false, start: 0 };
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === "\\") {
      i += 1;
      const q = quantifierAt(source, i + 1);
      if (q !== undefined) {
        if (q.unbounded) cur.hasUnbounded = true;
        i += q.length;
      }
      continue;
    }
    if (inClass) {
      if (c === "]") {
        inClass = false;
        const q = quantifierAt(source, i + 1);
        if (q !== undefined) {
          if (q.unbounded) cur.hasUnbounded = true;
          i += q.length;
        }
      }
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "(") {
      frames.push(cur);
      cur = { hasUnbounded: false, hasAlt: false, start: i };
      continue;
    }
    if (c === "|") {
      cur.hasAlt = true;
      continue;
    }
    if (c === ")") {
      const inner = cur;
      cur = frames.pop() ?? { hasUnbounded: false, hasAlt: false, start: 0 };
      const q = quantifierAt(source, i + 1);
      if (q !== undefined) {
        if (q.unbounded && (inner.hasUnbounded || inner.hasAlt)) {
          findings.push({ shape: "E", detail: `a quantified group holds ${inner.hasUnbounded ? "an unbounded quantifier" : "an alternation"}: ${source.slice(inner.start, i + 1 + q.length)}` });
        }
        if (q.unbounded || inner.hasUnbounded) cur.hasUnbounded = true;
        i += q.length;
      } else if (inner.hasUnbounded) cur.hasUnbounded = true;
      continue;
    }
    const q = quantifierAt(source, i + 1);
    if (q !== undefined) {
      if (q.unbounded) cur.hasUnbounded = true;
      i += q.length;
    }
  }
  // T: an unbounded quantifier (or a group holding one) directly in front of a final `$`, with no start anchor
  if (findings.length === 0 && /(?:[*+]|\{\d+,\}|[*+]\))\??\$$/.test(source) && !source.startsWith("^") && !flags.includes("y")) {
    findings.push({ shape: "T", detail: `an unbounded run in front of the end anchor, retried at every start position: ${source.slice(-40)}` });
  }
  return findings;
}

/** Every module under src/ (recursively) as [relative path, text]. */
export function sourceFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts")) files.push([relative(root, path), readFileSync(path, "utf8")]);
    }
  };
  walk(join(root, "src"));
  return files;
}

/** All regexes of src/ with their findings: [{ file, line, kind, source, flags, findings }]. */
export function auditSources(root) {
  const rows = [];
  for (const [file, text] of sourceFiles(root)) {
    for (const r of extractRegexes(text)) {
      rows.push({ file, ...r, findings: r.kind === "new RegExp(dynamic)" ? [{ shape: "D", detail: "dynamic source, reviewed by hand" }] : analyseRegex(r.source, r.flags) });
    }
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const rows = auditSources(root);
  const show = process.argv.includes("--all") ? rows : rows.filter((r) => r.findings.length > 0);
  console.log(`${rows.length} regular expressions in src/, ${rows.filter((r) => r.findings.length > 0).length} with a risky shape`);
  for (const r of show) console.log(`${r.file}:${r.line} [${r.kind}] /${r.source.slice(0, 150)}/${r.flags}${r.findings.length > 0 ? "  <== " + r.findings.map((f) => `${f.shape}: ${f.detail}`).join(" ; ") : ""}`);
}
