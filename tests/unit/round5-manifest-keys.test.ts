/**
 * Review round 5 (logic P3): the linear duplicate-key pass compared YAML scalar VALUES, so `1: a` with `'1': b` and `true: a` with
 * `'true': b` were not duplicates, yet both are the same key once they become JSON keys in `extensions`, and the first value was
 * silently lost. Keys are now compared by their text.
 */
import { describe, expect, it } from "vitest";
import { parseManifestText } from "../../src/manifest.js";

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

describe("YAML keys that collide as JSON keys are duplicates", () => {
  it.each([
    ["a number and a string", "extensions:\n  1: first\n  '1': second\n"],
    ["a string and a number", "extensions:\n  '1': first\n  1: second\n"],
    ["a boolean and a string", "extensions:\n  true: first\n  'true': second\n"],
    ["null and a string", "extensions:\n  null: first\n  'null': second\n"],
    ["1.0 and 1", "extensions:\n  1.0: first\n  1: second\n"],
    ["at the top level", "1: first\n'1': second\n"],
    ["in a flow map", "extensions: {1: a, '1': b}\n"],
  ])("%s", (_name, text) => {
    expect(codeOf(() => parseManifestText(text))).toBe("manifest_parse_error");
  });

  // round 5, logic P3: a repeated COLLECTION key (`? [1]` twice) was skipped by the pass and the first value was silently lost
  it.each([
    ["a repeated list key", "extensions:\n  ? [1]\n  : first\n  ? [1]\n  : second\n"],
    ["a repeated mapping key", "extensions:\n  ? {a: 1}\n  : first\n  ? {a: 1}\n  : second\n"],
    ["a list key and a string that spells it", "extensions:\n  ? [1]\n  : first\n  '[ 1 ]': second\n"],
    ["a single list key", "extensions:\n  ? [1]\n  : first\n"],
  ])("%s is refused (a Map key must be a scalar)", (_name, text) => {
    expect(codeOf(() => parseManifestText(text))).toBe("manifest_parse_error");
  });

  it("controls: different keys, and the same word in different mappings, are not duplicates", () => {
    for (const text of ["extensions:\n  1: a\n  2: b\n", "extensions:\n  a: {1: x}\n  b: {1: y}\n", "extensions:\n  true: a\n  false: b\n", "extensions:\n  '1': a\n  '01': b\n"]) {
      expect(codeOf(() => parseManifestText(text)), text).not.toBe("manifest_parse_error");
    }
  });
});
