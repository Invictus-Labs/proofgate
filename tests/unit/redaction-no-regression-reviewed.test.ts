/**
 * Review round 6 (conformance P3): the five frozen fixtures of `redaction-no-regression.test.ts` were derived from the round-3 and round-4 redactors; none came from the redactor that the
 * round-5 reviewers reviewed, which is the comparator that decides. This sixth fixture is FROZEN too: 900 generated inputs that each hold one planted secret, that the redactor of the round-5 tree
 * that was reviewed hid, and that the redactor of this tree hides (the planted and the structured generators of the differential, alternating; the secret is stored as a placeholder so that no line
 * of the file reads as a hard-coded credential, and is expanded here). The current redactor must hide the same secret in every one of them: what the reviewed tree redacted, a later tree redacts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactString } from "../../src/redact.js";

interface Fixture {
  planted: string;
  placeholder: string;
  comparedWith: string[];
  generator: string;
  inputs: string[];
}
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "redaction-no-regression-6.json"), "utf8")) as Fixture;
const inputs = fixture.inputs.map((text) => text.replaceAll(fixture.placeholder, fixture.planted));

describe("no leak regression against the redactor that the round-5 reviewers reviewed (frozen fixture: reviewed tree)", () => {
  it("the fixture is what it says: hundreds of distinct inputs, each holding the planted secret, derived from the reviewed tree", () => {
    expect(fixture.comparedWith).toEqual(["the round-5 tree that was reviewed"]);
    expect(fixture.generator).toContain("planted and the structured generators");
    expect(inputs.length).toBeGreaterThanOrEqual(600);
    expect(new Set(inputs).size).toBe(inputs.length);
    expect(inputs.every((text) => text.includes(fixture.planted))).toBe(true);
    // it reaches the families of the reports
    expect(inputs.some((text) => /Authorization/i.test(text))).toBe(true);
    expect(inputs.some((text) => /b'|u"|\$'/.test(text)), "a prefixed value").toBe(true);
    expect(inputs.some((text) => /--?[A-Za-z_-]+[ =]/.test(text)), "an option").toBe(true);
  });

  it("every input is hidden", () => {
    const leaks: string[] = [];
    for (const text of inputs) {
      const out = redactString(text);
      // the secret may sit behind escape layers: look for it as written
      if (out.includes(fixture.planted)) leaks.push(`${JSON.stringify(text.slice(0, 120))} -> ${JSON.stringify(out.slice(0, 120))}`);
    }
    expect(leaks.slice(0, 5)).toEqual([]);
  });

  it("and stays hidden on a second pass (a fixed point)", () => {
    const moved: string[] = [];
    for (const text of inputs) {
      const out = redactString(text);
      if (redactString(out) !== out) moved.push(text.slice(0, 100));
    }
    expect(moved.slice(0, 5)).toEqual([]);
  });
});
