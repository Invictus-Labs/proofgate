import { expect, it } from "vitest";
import { redactString } from "../../src/redact.js";

it("M79 JWT scanner bounded character work", () => {
  const original = String.prototype.charCodeAt;
  const valueOf = String.prototype.valueOf;
  // These are incomplete JWT-shaped words, not credentials. The real public entry must leave them intact.
  for (const repeats of [1024, 2048]) {
    const input = "eyJ_".repeat(repeats);
    const budget = 256 * input.length;
    let reads = 0;
    let exhausted = false;
    let output: string | undefined;
    let failure: unknown;
    const sentinel = new Error("test character-work budget exhausted");
    try {
      String.prototype.charCodeAt = function (this: string, index: number): number {
        if (Reflect.apply(valueOf, this, []) === input && ++reads > budget) {
          exhausted = true;
          throw sentinel;
        }
        return Reflect.apply(original, this, [index]) as number;
      };
      try { output = redactString(input); } catch (error) { failure = error; }
    } finally {
      String.prototype.charCodeAt = original;
    }
    // Assertions happen after restoration. A caught fail-closed sentinel is still an assertion failure;
    // a thrown runtime error or timeout alone never certifies this mutation control.
    expect(String.prototype.charCodeAt).toBe(original);
    expect(exhausted, `${input.length} characters exceeded ${budget} counted reads`).toBe(false);
    expect(failure).toBeUndefined();
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(budget);
    expect(output).toBe(input);
  }
});
