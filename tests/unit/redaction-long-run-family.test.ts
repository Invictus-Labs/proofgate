/**
 * Review round 6, tests reviewer (P2/P3) and the addendum on the P0: the shapes that the four reports named were tested one by one, and the family they belong to was not:
 * ONE opener of a credential, then ONE LONG RUN of one escape unit, then a tail. This file runs the family, every opener of the redactor by every escape unit (a backslash, the
 * text `\n`, `\r`, `\t`, `\u000A`, and `%0A`, `%0D`, `%09`, `%20`) by five tails (a letter, a quote, `=`, `:` and a real line break) at N = 26, 40, 200 and 5,000 units, each opener in a
 * CHILD process with a hard cap (a call that never returns is a failed assertion, and the CPU time of every call is bounded); the growth shapes of the rules that were added since the
 * first list (the Python-prefix loop, a bracket after `Authorization:`, `--password=`, `-u=`, a text-written break in front of an option), each at 16 Ki, 64 Ki and 256 Ki
 * characters with the growth compared; and a list of shapes at 4 MB (the largest text that is examined: over 4 MiB a string is hidden without being read) with the growth
 * from 250 KB to 4 MB compared in a capped child. A linear cost grows 16 times over 16 times the input; the bound is three times that.
 */
import { describe, expect, it } from "vitest";
import { B, expandPw, expandShape, judge, runFamilyInChild, shapeName, timeInChild, type Shape } from "../helpers/redact-child.js";

// every opener of the redactor (the list of `redaction-work-bound`, and the openers the later rules added)
const RAW_OPENERS = [
  "@PW@=",
  "@PW@: ",
  "@PW@:\n  ",
  "--@PW@ ",
  "--@PW@=",
  "-u ",
  "-u a:",
  "-p",
  "token=",
  "Authorization: ",
  "Authorization=[",
  "Authorization: Bearer ",
  "x=b'",
  "api_key=$'",
  '{"@PW@":"',
  "- ",
  "export TOKEN=",
  "%0A",
  "--user a:",
  "secret=(",
  "pw=[",
  "key: &",
  "name=",
  "value=",
  "@PW@=[]x",
  "@PW@=br'",
];
const OPENERS = RAW_OPENERS.map(expandPw);
/** The escape units of a long run: a backslash, a written line break, tab and carriage return, the written `\u000A`, and the percent escapes of a break, a tab and a blank. */
const UNITS = [B, `${B}n`, `${B}r`, `${B}t`, `${B}u000A`, "%0A", "%0D", "%09", "%20"];
const TAILS = ["y", '"', "=", ":", "\n"];
const NS = [26, 40, 200, 5_000];

describe("one opener, one long run of one escape unit, one tail (every opener by nine units by five tails by four lengths), in a capped child", () => {
  it.each(OPENERS.map((opener) => [JSON.stringify(opener), opener] as const))("%s", (_name, opener) => {
    const result = runFamilyInChild(opener, UNITS, TAILS, NS, 1_000, 90_000);
    expect(result, "the child did not finish within the cap").toBeDefined();
    expect(result?.cases).toBe(UNITS.length * TAILS.length * NS.length);
    expect(result?.slow, "calls that took more than a second of CPU time").toEqual([]);
  }, 150_000);
});

// the rules that were added after the first list of shapes: each is a loop that once rescanned a long run from every start
const RAW_GROWTH: Shape[] = [
  // the Python-prefix loop: a prefix letter, a quote or a backslash-quote, repeated
  ...["@PW@=br'", "@PW@=f\"", `@PW@=b${B}'`, "@PW@=rb'x", "@PW@=u'a"].map((unit) => ({ prefix: "", unit, tail: "" })),
  { prefix: "@PW@=b", unit: B, tail: "'" },
  { prefix: "@PW@=fr", unit: `${B}${B}`, tail: '"' },
  // a bracket after the header name
  ...["Authorization: [ x", "Authorization: [x", "Authorization:[ ", "Authorization= [ x"].map((unit) => ({ prefix: "", unit, tail: "" })),
  // options repeated with no blank between them
  ...["--@PW@=", "-u=", "--@PW@= x --@PW@=", "--token=[", "--token={"].map((unit) => ({ prefix: "", unit, tail: "" })),
  // a line break written as text in front of an option, repeated and once
  ...[`a=1${B}n--@PW@ x`, `${B}n-p`, `${B}t--@PW@=`, `%0A-pS`, `${B}r-u a:`].map((unit) => ({ prefix: "", unit, tail: "" })),
  { prefix: `a=1${B}n`, unit: "-", tail: "p" },
  // a run of backslashes and a word, then the quote that closes a KEY (`token=\\\\...x":`): the value ends in the name of another key
  { prefix: "token=", unit: B, tail: 'x":' },
  { prefix: "@PW@=", unit: B, tail: `x${B}":` },
  // a name judged before its value, over and over
  ...["name=@PW@ value=", "name: api_key\nvalue:", "key=token,value="].map((unit) => ({ prefix: "", unit, tail: "" })),
];
const GROWTH: Shape[] = RAW_GROWTH.map(expandShape);
const GROWTH_SIZES = [16_384, 65_536, 262_144];

describe("growth of the shapes of the later rules, 16 Ki to 256 Ki characters, in a capped child", () => {
  it.each(GROWTH.map((shape) => [shapeName(shape), shape] as const))("%s", (_name, shape) => {
    const t = timeInChild(shape, GROWTH_SIZES, "redact");
    expect(judge(shape, t, GROWTH_SIZES)).toBeUndefined();
    expect(t?.whole, "the work budget was not needed").toEqual([false, false, false]);
  }, 120_000);
});

// 4 MB: the largest text that is examined (over 4 MiB a string is redacted whole)
const RAW_LARGE: Shape[] = [
  { prefix: "@PW@=", unit: B, tail: "y" },
  { prefix: "@PW@=[]a", unit: B, tail: "b" },
  { prefix: "@PW@=x", unit: `${B}n`, tail: ":" },
  { prefix: "", unit: "--@PW@=", tail: "" },
  { prefix: "", unit: "=-u", tail: "" },
  { prefix: "", unit: "-u=", tail: "" },
  { prefix: "", unit: "%0A--@PW@=", tail: "" },
  { prefix: "", unit: ": &a Basic pinauth", tail: "" },
  { prefix: "", unit: "Authorization: [ x", tail: "" },
  { prefix: "", unit: "@PW@=br'", tail: "" },
  { prefix: "", unit: `a=1${B}n--@PW@ x`, tail: "" },
  { prefix: "--@PW@ []a", unit: B, tail: "x" },
  { prefix: "token: {}a", unit: `${B}${B}n`, tail: "x" },
  { prefix: "@PW@=%0A", unit: "%0A", tail: "x" },
];
const LARGE: Shape[] = RAW_LARGE.map(expandShape);
const LARGE_SIZES = [250_000, 1_000_000, 4_000_000];

describe("the largest examined text (4 MB) ends, and the cost grows with the input, in a capped child", () => {
  it.each(LARGE.map((shape) => [shapeName(shape), shape] as const))("%s", (_name, shape) => {
    const t = timeInChild(shape, LARGE_SIZES, "redact", 120_000);
    expect(judge(shape, t, LARGE_SIZES, 30_000)).toBeUndefined();
  }, 150_000);
});
