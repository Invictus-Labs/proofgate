/**
 * Review round 1 (owner-elevated): duplicate keys in receipts, revisions.json, report.json and the bundle header were
 * accepted with "last one wins", so {"result":"fail","result":"pass"} read as a pass. The parser unit tests fail on the delivered tree (the module does not exist there); the CLI behaviour is in round1-json-duplicates-cli.test.ts.
 */
import { describe, expect, it } from "vitest";
import { findDuplicateKey, parseJsonStrict } from "../../src/json.js";

describe("findDuplicateKey", () => {
  it.each([
    ['{"a":1,"a":2}', "a"],
    ['{"a":{"b":1,"b":2}}', "b"],
    ['{"list":[{"x":1},{"y":1,"y":2}]}', "y"],
    ['{"a":1,"\\u0061":2}', "a"],
    ['{"__proto__":1,"__proto__":2}', "__proto__"],
    ['[{"k":[{"k":1,"k":2}]}]', "k"],
    ['{"result":"fail","result":"pass"}', "result"],
    ['{"s":"x","t":{"u":1},"s":2}', "s"],
  ])("finds the duplicated key in %s", (text, key) => {
    expect(findDuplicateKey(text)).toBe(key);
  });

  it.each([
    '{"a":1,"b":2}',
    '{"a":{"a":1},"b":{"a":2}}',
    '{"a":[{"a":1},{"a":2}]}',
    '{"a":"{\\"a\\":1,\\"a\\":2}"}',
    '{"a":"x, \\"b\\": y","b":"z"}',
    "[]",
    '"just a string"',
    "[[],[{}],{}]",
    '{"":1,"a":2}',
  ])("accepts %s (no duplicate)", (text) => {
    expect(findDuplicateKey(text)).toBeUndefined();
  });

  it("parseJsonStrict throws a stable error for duplicates, SyntaxError for invalid JSON, and returns the value otherwise", () => {
    expect(() => parseJsonStrict('{"a":1,"a":2}', "doc")).toThrowError(/repeats the key "a"/);
    try {
      parseJsonStrict('{"a":1,"a":2}');
    } catch (error) {
      expect((error as { code?: string }).code).toBe("json_duplicate_key");
    }
    expect(() => parseJsonStrict("{nope")).toThrow(SyntaxError);
    expect(parseJsonStrict('{"a":[1,2]}')).toEqual({ a: [1, 2] });
  });

  it("is linear: a large document with many distinct keys and deep arrays is checked quickly", () => {
    const big = JSON.stringify({ list: Array.from({ length: 50_000 }, (_, i) => ({ [`k${i}`]: i, nested: { a: [i, { b: i }] } })) });
    const t0 = Date.now();
    expect(findDuplicateKey(big)).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
