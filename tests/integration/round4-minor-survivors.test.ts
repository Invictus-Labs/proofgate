/**
 * Review round 3 (tests re-review P3): mutants that survived every test in the round-2 review.
 *   D03  an over-budget non-ASCII object key was treated as NOT sensitive (fail open);
 *   D05, D14  the JWT scanner's segment-length boundary (8 characters) was not pinned;
 *   C04  the stderr 'error' handler of the executable was untested (a closed stderr turned a verdict into exit 2).
 * (D02, the fold-chunk cut ignoring combining-mark joins, and C07, an unreachable empty-output guard, are equivalent for the
 * decision and are recorded as such in docs/qa/review-round1-ledger.md.)
 */
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { REDACTED, isSensitiveKey, redactString } from "../../src/redact.js";
import { assertYamlWithinBudget } from "../../src/manifest.js";
import { MAX_YAML_NODES } from "../../src/limits.js";
import { DIST_CLI, evalArgs } from "../helpers/cli.js";
import { NOW, passingWorkspace, type Workspace } from "../helpers/fixture.js";

const made: Workspace[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((w) => w.cleanup()));
});

describe("D03: an object key too long to examine is sensitive, in ASCII and in non-ASCII text", () => {
  it.each([
    ["ASCII", "a".repeat(4 * 1024 * 1024 + 1)],
    ["non-ASCII", "é".repeat(1024 * 1024 + 1)],
    ["non-ASCII, just over the 1 MiB fold budget", "é".repeat(1024 * 1024 + 2)],
  ])("%s", (_label, key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it("control: an ordinary long non-ASCII key under the budget is not sensitive", () => {
    expect(isSensitiveKey("é".repeat(1000))).toBe(false);
  });
});

describe("D05 and D14: a JWT segment needs 8 characters, not 7 and not 9", () => {
  const segment = (n: number): string => "A".repeat(n);
  const jwt = (h: number, p: number, s: number): string => `eyJ${segment(h)}.${segment(p)}.${segment(s)}`;

  it.each([
    ["header", (n: number) => jwt(n, 8, 8)],
    ["payload", (n: number) => jwt(8, n, 8)],
    ["signature", (n: number) => jwt(8, 8, n)],
  ])("the %s of exactly 8 characters is redacted, 7 is not, 9 is", (_name, make) => {
    expect(redactString(`x ${make(8)} y`), "8").toBe(`x ${REDACTED} y`);
    expect(redactString(`x ${make(9)} y`), "9").toBe(`x ${REDACTED} y`);
    expect(redactString(`x ${make(7)} y`), "7").toBe(`x ${make(7)} y`);
  });
});

describe("C04: a closed stderr does not turn a verdict into an internal error", () => {
  it("evaluate without --output writes a note to stderr; with stderr closed the exit status is still the verdict", async () => {
    const w = await passingWorkspace();
    made.push(w);
    const args = evalArgs(w, ["--now", NOW]).filter((a, i, all) => a !== "--output" && all[i - 1] !== "--output");
    const child = spawn(process.execPath, [DIST_CLI, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" } });
    child.stderr.destroy(); // the read end goes away before the child reaches its first write
    child.stdout.resume();
    const code = await new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));
    expect(code).toBe(0);
  }, 30_000);
});

describe("YAML node estimate: a bare carriage return is a line break to YAML (security P3)", () => {
  const codeOf = (fn: () => void): string | undefined => {
    try {
      fn();
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return undefined;
  };
  it("MAX_YAML_NODES+1 lines separated only by CR are over the budget; the same with LF are too; one fewer is not", () => {
    const line = "a\r";
    expect(codeOf(() => assertYamlWithinBudget(line.repeat(MAX_YAML_NODES + 1), "m"))).toBe("limit_manifest_size");
    expect(codeOf(() => assertYamlWithinBudget("a\n".repeat(MAX_YAML_NODES + 1), "m"))).toBe("limit_manifest_size");
    expect(codeOf(() => assertYamlWithinBudget(line.repeat(MAX_YAML_NODES - 2), "m"))).toBeUndefined();
  });
  it("CRLF counts once, not twice", () => {
    expect(codeOf(() => assertYamlWithinBudget("a\r\n".repeat(MAX_YAML_NODES - 2), "m"))).toBeUndefined();
  });
});
