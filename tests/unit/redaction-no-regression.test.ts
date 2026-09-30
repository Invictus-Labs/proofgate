/**
 * Review round 5 (found by a differential against the previous redactor, in three rounds): a change that adds a reader can stop an
 * older reader from seeing a secret that it used to hide. YAML anchors and tags in front of a value were skipped, so `password:&S`,
 * `password: !S` and `passwd:\n  &S` were read as an anchor or a tag with no value; an option reader that took compound option names
 * consumed only the colon of `--api_key :'S`. `tests/fixtures/redaction-no-regression.json` (seed 5150) and
 * `tests/fixtures/redaction-no-regression-2.json` (seed 777) are FROZEN lists of generated inputs that each hold one planted secret and
 * that the redactor of the round-3 tree hid (the generator, its seed and the comparison are recorded in each file). The current redactor must
 * hide the same secret in every one of them: what an earlier tree redacted, a later tree redacts. A case that the current tree does
 * not hide is a leak regression, whatever the reason.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactString } from "../../src/redact.js";

interface Fixture {
  planted: string;
  comparedWith: string;
  generator: string;
  inputs: string[];
  /** A fixture may store its planted secret as this token, so that no line of the file reads as a hard-coded password assignment (the token is expanded here). */
  placeholder?: string;
}
const load = (name: string): Fixture => {
  const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", name), "utf8")) as Fixture;
  const { placeholder } = fixture;
  return placeholder === undefined ? fixture : { ...fixture, inputs: fixture.inputs.map((text) => text.replaceAll(placeholder, fixture.planted)) };
};

for (const [file, seed] of [
  ["redaction-no-regression.json", "5150"],
  ["redaction-no-regression-2.json", "777"],
  ["redaction-no-regression-3.json", "option forms"],
  ["redaction-no-regression-4.json", "option neighbours"],
  ["redaction-no-regression-5.json", "reviewer shapes"],
] as const) {
  describe(`no leak regression against the earlier redactors (frozen fixture: ${seed})`, () => {
    const fixture = load(file);
    const compared = ([] as string[]).concat(fixture.comparedWith);

    it("the fixture is what it says: hundreds of distinct inputs, each holding the planted secret", () => {
      expect(compared).toContain("the round-3 tree");
      expect(fixture.generator).toContain(seed.startsWith("option") || seed.startsWith("reviewer") ? seed : `seed ${seed}`);
      expect(fixture.inputs.length).toBeGreaterThanOrEqual(600);
      expect(new Set(fixture.inputs).size).toBe(fixture.inputs.length);
      expect(fixture.inputs.every((text) => text.includes(fixture.planted))).toBe(true);
      // it covers the classes that the differentials found
      if (seed === "reviewer shapes") {
        expect(compared, "derived from both earlier trees").toEqual(["the round-3 tree", "the round-4 tree"]);
        expect(fixture.inputs.some((text) => /=\[[^\]]*\][A-Za-z]/.test(text)), "a bracket value with text glued behind it").toBe(true);
        expect(fixture.inputs.some((text) => /^(?:credentials|secrets|auth|apikey|token):/.test(text)), "a credential-named parent key").toBe(true);
        expect(fixture.inputs.some((text) => /%7C|<br>/.test(text)), "a delimiter written as an escape or a tag").toBe(true);
        expect(fixture.inputs.some((text) => /\[\]\S/.test(text)), "an empty bracket with text behind it").toBe(true);
        return;
      }
      if (seed.startsWith("option")) {
        expect(compared, "derived from both earlier trees").toEqual(["the round-3 tree", "the round-4 tree"]);
        if (seed === "option forms") expect(fixture.inputs.some((text) => /authorization[= ]+(?:\[|\{|b'|\$'|u"|!!str)/i.test(text)), "an Authorization option followed by a bracket, a brace, a prefix, $' or a tag").toBe(true);
        if (seed === "option forms") expect(fixture.inputs.some((text) => /=>/.test(text)), "a hash rocket after an option").toBe(true);
        if (seed === "option neighbours") expect(fixture.inputs.some((text) => /--password-stdin[ \n\t]+--token/.test(text)), "a credential option with no value of its own, then another credential option").toBe(true);
        return;
      }
      expect(fixture.inputs.some((text) => /(?:password|token|secret)\s*:[&!]/i.test(text)), "an anchor-like or tag-like start right after the colon").toBe(true);
      expect(fixture.inputs.some((text) => /\s:['"]/.test(text)), "a colon and a quote after a key").toBe(true);
    });

    it("every input still has its planted secret redacted, and the result is a fixed point", () => {
      const leaked: string[] = [];
      const unstable: string[] = [];
      for (const text of fixture.inputs) {
        const out = redactString(text);
        if (out.includes(fixture.planted)) leaked.push(JSON.stringify(text).slice(0, 100));
        else if (redactString(out) !== out) unstable.push(JSON.stringify(text).slice(0, 100));
      }
      expect({ leaked: leaked.slice(0, 10), count: leaked.length }).toEqual({ leaked: [], count: 0 });
      expect(unstable.slice(0, 10)).toEqual([]);
    });
  });
}

describe("precision: anchors, tags and colons beside NON-credential names are left alone", () => {
  it.each([
    "name: &a x",
    "image: !!str foo",
    "base: &defaults\n  adapter: postgres\n",
    "value: !Ref Thing",
    "run --port :8080 --name :x",
    "curl --max-time :5 http://localhost:8080/x",
    "key: [a, b]\nlabel: !!str text",
  ])("%s", (text) => {
    expect(redactString(text), text).toBe(text);
  });

  it("the colon of a credential option is an assignment separator: the value behind it is redacted, the option is kept", () => {
    expect(redactString("run --api_key :'Zq7KmW4xPt9R' next")).toContain("--api_key");
    expect(redactString("run --api_key :'Zq7KmW4xPt9R' next")).not.toContain("Zq7KmW4xPt9R");
    expect(redactString("run --password :Zq7KmW4xPt9R next")).not.toContain("Zq7KmW4xPt9R");
  });
});
