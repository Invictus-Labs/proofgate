// An empirical time audit of the redactor, for a maintainer to run by hand. It is NOT a step of the quality gate (it takes minutes, and its numbers depend on the host);
// the gate's own evidence is `tests/unit/redaction-long-run-family.test.ts`, `redaction-work-bound.test.ts` and `round3-redaction-scaling.test.ts`. Dependency-free:
// node only, no package of the repository.
//
//   node scripts/run-with-cap.mjs 30 node scripts/fuzz-redaction-time.mjs regex
//   node scripts/run-with-cap.mjs 30 node scripts/fuzz-redaction-time.mjs functions <dir holding redact.js> [A|B|C] [N1]
//
// `regex`: every static regular expression of src/ (from scripts/regex-audit.mjs) is run on hostile runs of one character or one short unit followed by a tail that
// fails, and flagged when it is exponential (a run of 24 takes over 30 ms) or super-linear (4 times the input takes over 7 times the time and over 120 ms).
// `functions`: `redactString` (and, in set C, the artifact scanner) on a prefix that reaches a reader, a hostile unit repeated, and a tail; CPU time at 22 characters
// (exponential?), N1 (default 8,000) and 4 x N1 characters. Sets: A the openers of the first rounds, B the YAML / bracket / property openers, C units that are themselves
// openers (options with `=`, chained options, the `=-u` family, properties).
// CAP: run it under `scripts/run-with-cap.mjs <minutes>`, as above: one call that never returns (an exponential expression) cannot be interrupted from inside the
// process, and the wrapper kills the whole process group at the cap. The script itself stops between calls after FUZZ_MINUTES (default 25) and says that it stopped.
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [mode, dirArg, setArg = "A", n1Arg] = process.argv.slice(2);
const deadline = Date.now() + Number(process.env.FUZZ_MINUTES ?? 25) * 60_000;
const cpu = (f) => {
  const a = process.cpuUsage();
  f();
  const b = process.cpuUsage(a);
  return (b.user + b.system) / 1000;
};
let stopped = false;
const timeUp = () => {
  if (Date.now() > deadline) stopped = true;
  return stopped;
};

const UNITS = ["a", "0", " ", "\\", "\n", "n", "r", "%", "A", ":", "=", '"', "'", "-", "_", ".", "[", "]", "(", ")", "{", "}", ",", ";", "x", "/", "<", ">", "|", "&", "#", "@", "!", "\t",
  "\\n", "\\\\", "%0A", "%20", "a:", "a=", " a", "a ", '\\"', '""', "''", "a.", "a-", "ab", "-a", "= ", ": ", ", ", "a\n", "\\t", "\\r\\n", "\r\n", "$'", "b'", 'u"', "[a", "a]", "a,",
  "password=", "-p", "--token ", "token:", "\\'a", "%3A", "%0D%0A"];
const TAILS = ["", "y", "\u0001", '"'];

if (mode === "regex") {
  const { auditSources } = await import(pathToFileURL(join(import.meta.dirname, "regex-audit.mjs")).href);
  const rows = auditSources(join(import.meta.dirname, "..")).filter((r) => r.kind !== "new RegExp(dynamic)");
  const run = (re, s) => {
    re.lastIndex = 0;
    if (re.global) s.replace(re, "");
    else re.test(s);
  };
  const flagged = [];
  let runs = 0;
  outer: for (const r of rows) {
    let re;
    try {
      re = new RegExp(r.source.replace(/\u0001/g, "(?:)"), r.flags);
    } catch {
      continue;
    }
    for (const unit of UNITS) {
      for (const tail of ["!", "\u0001", "\u0000x"]) {
        if (timeUp()) break outer;
        const small = unit.repeat(Math.ceil(24 / unit.length)) + tail;
        const tExp = cpu(() => run(re, small));
        runs += 1;
        if (tExp > 30) {
          flagged.push({ r, unit, tail, why: `exponential: ${tExp.toFixed(0)} ms at ${small.length} characters` });
          continue;
        }
        const s1 = unit.repeat(Math.ceil(20_000 / unit.length)) + tail;
        const t1 = cpu(() => run(re, s1));
        if (t1 < 4) continue; // linear enough at 20K for anything to matter
        if (t1 > 600) {
          flagged.push({ r, unit, tail, why: `${t1.toFixed(0)} ms at ${s1.length} characters` });
          continue;
        }
        const s2 = unit.repeat(Math.ceil(80_000 / unit.length)) + tail;
        const t2 = cpu(() => run(re, s2));
        if (t2 > 120 && t2 / Math.max(t1, 1) > 7) flagged.push({ r, unit, tail, why: `${t1.toFixed(0)} ms at ${s1.length} -> ${t2.toFixed(0)} ms at ${s2.length} (${(t2 / Math.max(t1, 1)).toFixed(1)}x for 4x)` });
      }
    }
  }
  console.log(`${rows.length} static regexes, ${runs} probes, flagged ${flagged.length}${stopped ? " (STOPPED at the time limit: the list is not complete)" : ""}`);
  const byRegex = new Map();
  for (const f of flagged) {
    const k = `${f.r.file}:${f.r.line} /${f.r.source.slice(0, 110)}/${f.r.flags}`;
    if (!byRegex.has(k)) byRegex.set(k, []);
    byRegex.get(k).push(f);
  }
  for (const [k, list] of byRegex) console.log(k, "\n   ", list.length, "hostile inputs, e.g.", JSON.stringify(list[0].unit), "x N +", JSON.stringify(list[0].tail), "->", list[0].why);
} else if (mode === "functions" && dirArg !== undefined) {
  const { redactString, findCredentialPatterns } = await import(pathToFileURL(join(dirArg, "redact.js")).href);
  const N1 = Number(n1Arg ?? 8000);
  const SETS = {
    A: {
      prefixes: ["", "password=", "password: ", "password=[]x", "password=[", "--password ", "--password=", "--password []x", "-u ", "-u a:", "-p", "-uu:", "token: ", "token=(", "Authorization: ", "Authorization=[", "--Authorization ", "x=b'", 'secret=u"', "api_key=$'", "a=1&", "name=", "value=", '{"password":"', '["password=', "password:\n", "credential: |\n", "-secretkey ", "--user ", "curl -u "],
      units: UNITS,
      floor: 30,
    },
    B: {
      prefixes: ["key: &", "key: !!str ", "token: &a ", "- ", "  - ", "export A_TOKEN=", "-uu:", "--Authorization=", "[a,", "{'token': ", "%0A", "\\n", "Bearer ", "password: >\n", "password: |\n  ", "pw=(", "secret={", "auth:\n  - ", "Authorization: [\n", "name=password value=", "x\npassword=", '"token":"', 'password="', "password='", "--user a:", "--user=a:", "-u a:b ", "-pass ", "-p x -p"],
      units: UNITS,
      floor: 30,
    },
    C: {
      prefixes: ["", "password=", "password: ", "password=[]x", "--password ", "--password=", "--password []x", "-u ", "-u a:", "-p", "-uu:", "token: ", "token=(", "Authorization: ", "Authorization=[", "x=b'", "a=1&", "name=", '{"password":"', "password:\n", "key: &", "- ", "export A_TOKEN=", "%0A", "--user a:", "run "],
      units: ["--password=", "--token=", "--secret=", "--api_key=", "-Password=", "--pw=", "-p--password=", "\\n--password%3D", "%0A--password=", "%0A--password%3D", "=-u", "=-u ", "={-u", "=--user", "-u=", "-u:", "-token=", "-password=-p", "token=-auth", "=-auth",
        "password=password=", "token=a", ": &a Basic pinauth", ": &a ", "&a Basic pinauth ", "[]x\\n", "{}a", "()a", "[x]a", "--password a ", "--password a\\", "--token {}a", "--user a:", "-uadmin:", "-uu:passwd=", "--Authorization=[", "Bearer=", "a=b&", "\\u000a--password=", "\\n-p"],
      floor: 8,
    },
  };
  const set = SETS[setArg];
  if (set === undefined) throw new Error(`unknown set ${setArg} (A, B or C)`);
  const flagged = [];
  let runs = 0;
  outer: for (const prefix of set.prefixes) {
    for (const unit of set.units) {
      for (const tail of TAILS) {
        if (timeUp()) break outer;
        const build = (n) => prefix + unit.repeat(Math.ceil(n / unit.length)) + tail;
        const s0 = build(22);
        const t0 = cpu(() => redactString(s0));
        runs += 1;
        if (t0 > 40) {
          flagged.push({ prefix, unit, tail, why: `${t0.toFixed(0)} ms at ${s0.length} characters (exponential?)` });
          continue;
        }
        const s1 = build(N1);
        const t1 = cpu(() => redactString(s1));
        if (t1 < set.floor) continue;
        if (t1 > 1500) {
          flagged.push({ prefix, unit, tail, why: `${t1.toFixed(0)} ms at ${s1.length}` });
          continue;
        }
        const s2 = build(N1 * 4);
        const t2 = cpu(() => redactString(s2));
        if (t2 > 150 && t2 / Math.max(t1, 1) > 7) flagged.push({ prefix, unit, tail, why: `${t1.toFixed(0)} ms at ${s1.length} -> ${t2.toFixed(0)} ms at ${s2.length} (${(t2 / Math.max(t1, 1)).toFixed(1)}x for 4x)` });
      }
    }
  }
  console.log(`set ${setArg}: ${runs} redactString runs, flagged ${flagged.length}${stopped ? " (STOPPED at the time limit: the list is not complete)" : ""}`);
  for (const f of flagged.slice(0, 60)) console.log(JSON.stringify(f.prefix), "+", JSON.stringify(f.unit), "x N +", JSON.stringify(f.tail), "->", f.why);
  if (setArg === "C") {
    // the artifact scanner (findCredentialPatterns on a window): 64 KiB of each unit
    const slow = [];
    for (const unit of set.units) {
      const s = unit.repeat(Math.ceil(65_536 / unit.length));
      const t = cpu(() => findCredentialPatterns(s));
      if (t > 1000) slow.push(`${JSON.stringify(unit)} ${t.toFixed(0)} ms`);
    }
    console.log("findCredentialPatterns on 64 KiB of a unit, slower than 1 s:", slow.length === 0 ? "none" : slow.join("; "));
  }
} else {
  console.error("usage: node scripts/fuzz-redaction-time.mjs regex | functions <dir holding redact.js> [A|B|C] [N1]");
  process.exit(2);
}
