import { expect, it } from "vitest";
import { REDACTED, redactValue } from "../../src/redact.js";

it("M86 redacted key collisions bounded candidate work", () => {
  const original = Set.prototype.has;
  for (const count of [32, 64]) {
    const input: Record<string, number> = {};
    for (let i = 0; i < count; i += 1) input[["ghp", "_", String(i).padStart(8, "0"), "a".repeat(30)].join("")] = i;
    const budget = 4 * count;
    let probes = 0;
    let exhausted = false;
    let output: Record<string, number> | undefined;
    let failure: unknown;
    const sentinel = new Error("test collision candidate-work budget exhausted");
    try {
      Set.prototype.has = function (this: Set<unknown>, candidate: unknown): boolean {
        if (typeof candidate === "string" && /^\[REDACTED\](?:#\d+)?$/.test(candidate) && ++probes > budget) {
          exhausted = true;
          throw sentinel;
        }
        return Reflect.apply(original, this, [candidate]) as boolean;
      };
      try { output = redactValue(input); } catch (error) { failure = error; }
    } finally {
      Set.prototype.has = original;
    }
    // Always assert after restoration; neither a sentinel exception nor timeout is a kill.
    expect(Set.prototype.has).toBe(original);
    expect(exhausted, `${count} keys exceeded ${budget} candidate probes`).toBe(false);
    expect(failure).toBeUndefined();
    expect(probes).toBeGreaterThan(0);
    expect(probes).toBeLessThanOrEqual(budget);
    const keys = Object.keys(output!);
    expect(keys).toHaveLength(count);
    expect(new Set(keys).size).toBe(count);
    expect(keys.every(key => key === REDACTED || /^\[REDACTED\]#\d+$/.test(key))).toBe(true);
    expect(Object.values(output!).sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
    expect(JSON.stringify(output)).not.toContain(["ghp", "_"].join(""));
  }
});
