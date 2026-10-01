import { describe, expect, it } from "vitest";
import { assertJsonDepth, canonicalize, hashCanonical, sha256Hex, uuidFromHash } from "../../src/canonical.js";

describe("canonical JSON v1", () => {
  it("sorts object keys and removes whitespace", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 1, y: 2 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}');
  });

  it("is independent of insertion order (equal documents hash equally)", () => {
    expect(hashCanonical({ a: 1, b: { c: 2, d: 3 } })).toBe(hashCanonical({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("orders keys by UTF-16 code unit, as RFC 8785 does", () => {
    expect(canonicalize({ "é": 1, z: 2, "😀": 3, a: 4 })).toBe('{"a":4,"z":2,"é":1,"😀":3}');
  });

  it("omits undefined members, encodes undefined array items as null, and keeps unicode strings verbatim", () => {
    expect(canonicalize({ a: undefined, b: [undefined, 1], c: "café ☃" })).toBe('{"b":[null,1],"c":"café ☃"}');
  });

  it("serialises numbers exactly like ECMAScript JSON", () => {
    expect(canonicalize([0, -0, 1.5, 1e21, 100, 1e-7])).toBe("[0,0,1.5,1e+21,100,1e-7]");
  });

  it("rejects values that have no canonical form", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/);
    expect(() => canonicalize(10n)).toThrow(/bigint/);
    expect(() => canonicalize(() => 1)).toThrow(/function/);
    expect(() => canonicalize(Symbol("x"))).toThrow(/symbol/);
    expect(() => canonicalize(new Date())).toThrow(/plain objects/);
    expect(() => canonicalize(new Map())).toThrow(/plain objects/);
    expect(canonicalize(Object.create(null))).toBe("{}");
  });

  it("rejects excessive nesting with a stable code", () => {
    let v: unknown = 1;
    for (let i = 0; i < 100; i += 1) v = [v];
    expect(() => canonicalize(v)).toThrowError(/nesting/);
  });

  it("computes sha256 with a known-answer vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256Hex("abc"));
    expect(hashCanonical("abc")).toBe(sha256Hex('"abc"'));
  });

  it("derives a stable RFC 9562 version-8 UUID from a digest", () => {
    const id = uuidFromHash(sha256Hex("x"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFromHash(sha256Hex("x"))).toBe(id);
    expect(uuidFromHash(sha256Hex("y"))).not.toBe(id);
  });

  it("guards nesting depth of untrusted JSON iteratively", () => {
    expect(() => assertJsonDepth({ a: [{ b: [1] }] }, 8, "doc")).not.toThrow();
    let v: unknown = 1;
    for (let i = 0; i < 20; i += 1) v = { k: v };
    expect(() => assertJsonDepth(v, 10, "doc")).toThrowError(/deeper than 10/);
    expect(() => assertJsonDepth("scalar", 1, "doc")).not.toThrow();
  });
});
