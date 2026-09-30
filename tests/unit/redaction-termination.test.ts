/**
 * Review round 5 (logic P0): the redactor looped forever on `{"key":"value"}`. A pair scanner iterated a module-level global regex,
 * and judging the label ("value") redacted it, which ran the same scanner again on the same regex object and reset its position: the
 * outer loop rematched from index 0 for ever, `proofgate evaluate` spun at 100% CPU on a receipt whose command was
 * `curl -d '{"key": "value"}' ...`, and SIGTERM was not heard (the handler runs on the blocked event loop).
 *
 * Why 1,921 tests and 229 mutants did not see it: every pair test used a label that names a credential, and no test fed the redactor
 * ordinary text that merely contains the words key, name, value, header, token or password. Also, a test that hangs in a synchronous
 * loop cannot time out from inside its own process, so every termination check here runs in a CHILD process with a hard wall clock and
 * treats "still running" as a failed assertion, never as a hang of the suite.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { passingWorkspace, writeReceipt, type Workspace } from "../helpers/fixture.js";
import { DIST_CLI } from "../helpers/cli.js";
import { evalArgs } from "../helpers/cli.js";

const ROOT = join(import.meta.dirname, "..", "..");
const REDACT_URL = pathToFileURL(join(ROOT, "dist", "redact.js")).href;

interface Isolated {
  finished: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a module script in a child process that is killed (SIGKILL) at the cap; `finished` is false when the cap was hit. */
function isolated(script: string, capMs: number, env: NodeJS.ProcessEnv = {}): Isolated {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: capMs,
    killSignal: "SIGKILL",
    env: { PATH: process.env.PATH ?? "", ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { finished: r.status !== null, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Redacts one string in a child process and returns what came back, or undefined when the child did not finish in time. */
function redactIsolated(input: string, capMs = 15_000): string | undefined {
  const r = isolated(`import { redactString } from ${JSON.stringify(REDACT_URL)}; process.stdout.write(JSON.stringify(redactString(${JSON.stringify(input)})));`, capMs);
  return r.finished && r.status === 0 ? (JSON.parse(r.stdout) as string) : undefined;
}

/** Ordinary text that holds the words the scanners key on as VALUES, as KEYS, in every quoting, and that holds no credential. */
const ORDINARY: string[] = [
  '{"key":"value"}',
  '{"name":"value"}',
  '{"header":"value"}',
  '{"name":"default_value"}',
  '{"Name":"Value"}',
  '{"ParameterKey":"ParameterValue"}',
  '{"name":"valueFrom"}',
  "{'key':'value'}",
  "{'name': 'value', 'value': 'x'}",
  '{"name":"value","value":"x"}',
  '{"key": "value", "name": "key", "value": "name"}',
  '{"name":"key"}',
  '{"value":"value"}',
  '{"value":"name","name":"value"}',
  '[{"name":"HOST","value":"localhost"},{"name":"PORT","value":"5432"}]',
  "curl -X POST -d '{\"key\": \"value\"}' http://localhost:8080/api",
  'echo "the key is the value of the name"',
  "key: value\nname: value\nheader: value\n",
  "name=value&key=value&header=value",
  "The header names the value; the token count is five and the password policy is on the wiki.",
  '{"a":{"b":{"key":"value","name":"value"}}}',
  'run --name value --key value --header value',
];

describe("termination: ordinary text that contains the scanners' own words is returned unchanged, in bounded time", () => {
  it.each(ORDINARY)("%s", (input) => {
    const out = redactIsolated(input);
    expect(out, "the redactor did not finish within 15 s (a hang)").toBeDefined();
    expect(out).toBe(input);
  });

  it("the same strings nested in JSON strings at depth 1 to 6", () => {
    const failures: string[] = [];
    for (const input of ORDINARY.filter((s) => s.startsWith("{") || s.startsWith("["))) {
      let text = input;
      for (let k = 1; k <= 6; k += 1) {
        text = JSON.stringify(text).slice(1, -1);
        const out = redactIsolated(text, 10_000);
        if (out !== text) failures.push(`depth ${k}: ${out === undefined ? "HANG" : "changed"}: ${text.slice(0, 60)}`);
        // (a hang is reported once: each one costs the whole cap, and the first is the finding)
        if (out === undefined) expect(failures).toEqual([]);
      }
    }
    expect(failures).toEqual([]);
  });

  it("credential text next to the same words is still redacted", () => {
    expect(redactIsolated('{"key":"value","password":"Hs7Zq9TermXy"}')).not.toContain("Hs7Zq9TermXy");
    expect(redactIsolated('{"name":"value","name":"DB_PASSWORD","value":"Hs7Zq9TermXy"}')).not.toContain("Hs7Zq9TermXy");
    expect(redactIsolated("--password value")).toBe("--password [REDACTED]");
  });
});

describe("termination: a property test over ordinary and hostile strings, with a per-call time cap", () => {
  const PROPERTY = `
    import { redactString, redactValue } from ${JSON.stringify(REDACT_URL)};
    const words = ["key", "name", "value", "header", "token", "password", "parameter_name", "ParameterValue", "valueFrom", "x", "a1"];
    const marks = ["{", "}", "[", "]", ":", ",", '"', "'", " ", "\\\\", "=", "-", "--", "\\n", "%3D", "%22", "%5C", "//", "@", "|", ">", "&", "!!str", "#"];
    let seed = 20260929;
    const next = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    let worst = 0, worstText = "", unstable = 0, count = 0;
    for (let i = 0; i < Number(process.env.CASES); i += 1) {
      let text = "";
      for (let j = 0, parts = next(14); j < parts; j += 1) text += next(3) === 0 ? words[next(words.length)] : marks[next(marks.length)] + (next(4) === 0 ? words[next(words.length)] : "");
      const t0 = performance.now();
      const once = redactString(text);
      const took = performance.now() - t0;
      if (took > worst) { worst = took; worstText = text; }
      if (redactString(once) !== once) unstable += 1;
      count += 1;
    }
    process.stdout.write(JSON.stringify({ count, worst, worstText: worstText.slice(0, 80), unstable }));
  `;
  it("100,000 random strings finish, none takes long, and every result is a fixed point", () => {
    const r = isolated(PROPERTY, 90_000, { CASES: "100000" });
    expect(r.finished, "the property run did not finish in 90 s (a hang or a runaway)").toBe(true);
    expect(r.status, r.stderr.slice(0, 400)).toBe(0);
    const result = JSON.parse(r.stdout) as { count: number; worst: number; worstText: string; unstable: number };
    expect(result.count).toBe(100_000);
    expect(result.worst, `slowest input: ${JSON.stringify(result.worstText)}`).toBeLessThan(500);
    expect(result.unstable).toBe(0);
  }, 120_000);

  it("objects with the same words as keys and values finish and are fixed points", () => {
    const script = `
      import { redactValue } from ${JSON.stringify(REDACT_URL)};
      const words = ["key", "name", "value", "header", "token", "password", "valueFrom", "Value", "x"];
      let seed = 7; const next = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
      const make = (d) => { const o = {}; for (let i = 0, n = next(4); i < n; i += 1) o[words[next(words.length)]] = d > 2 || next(2) === 0 ? words[next(words.length)] : next(2) === 0 ? make(d + 1) : [words[next(words.length)], words[next(words.length)]]; return o; };
      let bad = 0;
      for (let i = 0; i < 20000; i += 1) { const doc = make(0); const once = redactValue(doc); if (JSON.stringify(redactValue(once)) !== JSON.stringify(once)) bad += 1; }
      process.stdout.write(String(bad));
    `;
    const r = isolated(script, 60_000);
    expect(r.finished, "did not finish in 60 s").toBe(true);
    expect(r.stdout).toBe("0");
  }, 90_000);
});

describe("termination: the packaged command", () => {
  it("proofgate evaluate on a receipt whose command is curl -d '{\"key\": \"value\"}' finishes within seconds", async () => {
    const w: Workspace = await passingWorkspace();
    try {
      await writeReceipt(w, { receipt: { receipt_id: "rcpt-hang-1", command: "curl -X POST -d '{\"key\": \"value\"}' http://localhost:8080/api", extensions: { text: '{"name":"value"}' } } });
      const args = evalArgs(w, ["--now", "2026-09-29T12:00:00Z"]);
      const started = Date.now();
      const r = spawnSync(process.execPath, [DIST_CLI, ...args], { cwd: ROOT, encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL", env: { PATH: process.env.PATH ?? "" } });
      expect(r.status, `evaluate did not finish within 30 s (killed by ${r.signal ?? "nothing"}): a hang`).not.toBeNull();
      expect(r.status).toBe(0);
      expect(Date.now() - started).toBeLessThan(20_000);
      const report = readFileSync(join(w.outputDir, "report.json"), "utf8");
      expect(report).toContain("rcpt-hang-1");
    } finally {
      await w.cleanup();
    }
  }, 60_000);

  it("SIGTERM stops a redaction of a large input that is still running (the bound is stated: a synchronous pass ends on its own within seconds)", () => {
    // The redactor is synchronous: a signal handler runs between calls, not inside one. What is promised is that no call is unbounded,
    // so a large hostile input ends by itself. This measures the slowest of the adversarial shapes at the 4 MiB cap.
    const script = `
      import { redactString } from ${JSON.stringify(REDACT_URL)};
      const shapes = ['{"key":"value"}', '{"value":"a","name":"token"},', '["password","x"],', '--password "x" ', '//u:a/@', 'password: |\\n  a\\n', 'a%3Db%26c%3Dd '];
      let worst = 0;
      for (const unit of shapes) { const text = unit.repeat(Math.ceil((4 * 1024 * 1024 - 1) / unit.length)).slice(0, 4 * 1024 * 1024 - 1); const t0 = performance.now(); redactString(text); worst = Math.max(worst, performance.now() - t0); }
      process.stdout.write(String(Math.round(worst)));
    `;
    const r = isolated(script, 120_000);
    expect(r.finished, "a 4 MiB input did not finish within 120 s").toBe(true);
    expect(Number(r.stdout)).toBeLessThan(20_000);
  }, 150_000);
});

describe("no module-level global or sticky regex is driven across a call that can re-enter the redactor", () => {
  const source = readFileSync(join(ROOT, "src", "redact.ts"), "utf8");
  // Sticky regexes that are used for ONE immediate exec (never inside a loop, never across a call) are allowed by name.
  const SINGLE_USE = new Set(["NEXT_PAIR", "LINE_BREAK_PLAIN", "INDENT_ESCAPE", "YAML_PROPERTY", "BLOCK_HEADER", "PY_PREFIX", "SEPARATOR_ESCAPE", "VALUE_GAP_PLAIN", "GLUED_PASSWORD_FLAG"]);

  /** The module-level `const NAME = <regex literal or new RegExp(...)>;` statements of a source file, one statement over any number of lines. */
  function moduleRegexes(text: string): Array<{ name: string; flags: string }> {
    const found: Array<{ name: string; flags: string }> = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const head = /^(?:export )?(?:const|let|var) ([A-Za-z_][A-Za-z0-9_]*)(?::[^=]+)? = (.*)$/.exec(lines[i] as string);
      if (head === null) continue;
      let statement = head[2] as string;
      let j = i;
      while (!statement.trimEnd().endsWith(";") && j + 1 < lines.length && j - i < 12) {
        j += 1;
        statement += `\n${lines[j]}`;
      }
      const literal = /^\/.*\/([a-z]*);\s*$/s.exec(statement);
      const constructed = /^new RegExp\(.*,\s*["'`]([a-z]*)["'`]\s*,?\s*\);\s*$/s.exec(statement);
      const flags = literal?.[1] ?? constructed?.[1];
      if (flags !== undefined && /[gy]/.test(flags)) found.push({ name: head[1] as string, flags });
    }
    return found;
  }

  it("the declaration finder sees one-line, multi-line and constructed patterns (a control for the check below)", () => {
    const sample = ["const A = /a+/g;", "const B = new RegExp(", "  `x${y}`,", '  "gi",', ");", "export const C = /c/y;", "const D = /d/;", "const E = 5;"].join("\n");
    expect(moduleRegexes(sample).map((m) => m.name)).toEqual(["A", "B", "C"]);
  });

  it("every module-level /g or /y regex of every source file is only used through a private copy (`fresh`), or is a named single-use sticky one", () => {
    const declared = moduleRegexes(source).map((m) => m.name);
    expect(declared.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const name of declared) {
      if (SINGLE_USE.has(name)) continue;
      const uses = [...source.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length - 1; // minus the declaration
      const throughCopy = [...source.matchAll(new RegExp(`fresh\\(${name}\\)`, "g"))].length;
      if (throughCopy === 0 || uses !== throughCopy) offenders.push(`redact.ts ${name}: ${uses} use(s), ${throughCopy} through a private copy`);
    }
    // no other source file declares a shared global or sticky pattern
    for (const file of readdirSync(join(ROOT, "src"), { recursive: true }) as string[]) {
      if (!file.endsWith(".ts") || file === "redact.ts") continue;
      for (const m of moduleRegexes(readFileSync(join(ROOT, "src", file), "utf8"))) offenders.push(`${file} ${m.name} (flags ${m.flags})`);
    }
    expect(offenders).toEqual([]);
    expect(SINGLE_USE.has("PRIVATE_KEY_BEGIN"), "the private-key scanner is a loop too: it works on a private copy").toBe(false);
  });

  it("the copy helper exists and the scanners that can re-enter the redactor use it", () => {
    expect(source).toContain("const fresh = (re: RegExp): RegExp => new RegExp(re.source, re.flags);");
    for (const name of ["NAME_KEY_OPEN", "LIST_PAIR_OPEN", "ASSIGNMENT_KEYWORD", "FLAG_OPEN", "USERINFO_OPEN", "PRIVATE_KEY_BEGIN"]) expect(source, name).toContain(`fresh(${name})`);
  });
});
