/**
 * Review round 3 (security and tests re-reviews): window and chunk boundaries. Text with hidden characters is folded in 64 KiB
 * chunks (with a carry), artifacts are scanned in 1 MiB windows (with an overlap). A secret that STRADDLES a boundary, at every
 * offset around it, and the long JWT header that the old 4 KiB carry could not hold, must be found as well as one in the middle.
 */
import { describe, expect, it } from "vitest";
import { redactString, scanBufferForCredentials } from "../../src/redact.js";
import { FAKE } from "../helpers/fake-secrets.js";

const ZW = String.fromCharCode(0x200b);
const CHUNK = 64 * 1024;
const WINDOW = 1024 * 1024;
const hidden = (token: string): string => token.split("").join(ZW); // every character split by a zero-width space
const padTo = (n: number): string => " ".repeat(Math.max(0, n));

describe("a secret hidden by zero-width characters straddles a fold chunk boundary at every offset", () => {
  for (const [name, token] of [
    ["github token", FAKE.githubToken],
    ["slack token", FAKE.slackToken],
    ["aws key", FAKE.awsKey],
  ] as const) {
    it(`${name}: 3 boundaries x offsets -120..+8 around each`, () => {
      const wrapped = hidden(token);
      for (const k of [1, 2, 3]) {
        for (let delta = -120; delta <= 8; delta += 1) {
          const text = `${padTo(k * CHUNK + delta)}${wrapped}${padTo(40)}`;
          const out = redactString(text);
          expect(out.includes(token), `${name} k=${k} delta=${delta}`).toBe(false);
          expect(out.replaceAll(ZW, "").includes(token.slice(4)), `${name} k=${k} delta=${delta} (folded)`).toBe(false);
        }
      }
    });
  }

  it("an assignment value and its name hidden across the boundary", () => {
    const line = hidden("password=hunter2hunter2");
    for (let delta = -40; delta <= 4; delta += 1) {
      const out = redactString(`${padTo(CHUNK + delta)}${line} tail`);
      expect(out.replaceAll(ZW, ""), `delta=${delta}`).not.toContain("hunter2");
    }
  });

  it("a JWT whose header is far longer than the old 4 KiB carry, hidden and straddling the boundary, is redacted", () => {
    const header = `eyJ${"A".repeat(5000)}`;
    const jwt = `${header}.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlLXN5bnRoZXRpYw`;
    for (const delta of [-6000, -5100, -4200, -100, 0]) {
      const text = `${padTo(CHUNK + delta)}${hidden(jwt.slice(0, 40))}${jwt.slice(40)} tail`;
      const out = redactString(text).replaceAll(ZW, "");
      expect(out.includes("c2lnbmF0dXJlLXN5bnRoZXRpYw"), `delta=${delta}`).toBe(false);
    }
  });
});

describe("the artifact scanner finds a secret at every offset around the 1 MiB window boundary", () => {
  it("latin1 text: offsets -80..+8 around each of two boundaries", () => {
    for (const k of [1, 2]) {
      for (let delta = -80; delta <= 8; delta += 1) {
        const buffer = Buffer.from(`${padTo(k * WINDOW + delta)}${FAKE.githubToken} tail`, "latin1");
        expect(scanBufferForCredentials(buffer).length, `k=${k} delta=${delta}`).toBeGreaterThan(0);
      }
    }
  });

  it("UTF-8 text with hidden characters straddling the boundary", () => {
    for (let delta = -120; delta <= 8; delta += 4) {
      const buffer = Buffer.from(`${padTo(WINDOW + delta)}${hidden(FAKE.githubToken)} tail`, "utf8");
      expect(scanBufferForCredentials(buffer).length, `delta=${delta}`).toBeGreaterThan(0);
    }
  });

  it("UTF-16LE text straddling the boundary", () => {
    for (let delta = -120; delta <= 8; delta += 4) {
      const buffer = Buffer.from(`${padTo(WINDOW / 2 + delta)}${FAKE.githubToken} tail`, "utf16le");
      expect(scanBufferForCredentials(buffer).length, `delta=${delta}`).toBeGreaterThan(0);
    }
  });

  it("control: the same buffers without a secret report nothing", () => {
    expect(scanBufferForCredentials(Buffer.from(`${padTo(WINDOW)}plain tail`, "latin1"))).toEqual([]);
  });
});

describe("a short secret inside non-ASCII UTF-16 text is found (the layout needs only a short ASCII run to be recognised)", () => {
  const cyrillic = "\u041f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440 ".repeat(60);
  const glue = "\u0416"; // a non-ASCII letter on each side, so the ASCII run is exactly the assignment (12 code units)
  it.each(["utf16le", "utf16be"] as const)("%s: secret=abc12 (a 12-character assignment) between Cyrillic text", (encoding) => {
    const text = `${cyrillic}${glue}secret=abc12${glue}${cyrillic}`;
    const bytes = Buffer.from(text, "utf16le");
    const buffer = encoding === "utf16le" ? bytes : Buffer.from(bytes).swap16();
    expect(scanBufferForCredentials(buffer).length).toBeGreaterThan(0);
  });

  it("control: the same text without an assignment reports nothing", () => {
    expect(scanBufferForCredentials(Buffer.from(`${cyrillic}nothing here ${cyrillic}`, "utf16le"))).toEqual([]);
  });
});

describe("a credential header name that follows a stray keyword is left for its own match (fail-open found by the seeded property test)", () => {
  it("`pass : Authorization: Digest ...` redacts the whole header, response included", () => {
    const response = "bg5k73eCT8XXZRTyzoWoBcq8/1g+NVn_";
    for (const prefix of ["pass : ", "password: ", "token = "]) {
      const out = redactString(`${prefix}Authorization: Digest username="svc", realm="x", response="${response}"`);
      expect(out.includes(response), prefix).toBe(false);
      expect(out.includes("Digest username"), prefix).toBe(false);
    }
  });
});
