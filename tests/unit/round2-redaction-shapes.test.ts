/**
 * Review round 1, follow-up from the edge-case prober: the planted-secret list only held shapes the redactor already
 * handled, so it could not reveal gaps. tests/helpers/fake-secrets.ts now carries vendor tokens, header values, an Azure
 * storage key and word-glued tokens; every one must be redacted in text and detected by the artifact scanner that
 * `bundle export` uses. Values are assembled from fragments in the helper, so no credential-shaped literal is stored here.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue, scanBufferForCredentials } from "../../src/redact.js";
import { FAKE, FAKE_CONTEXT } from "../helpers/fake-secrets.js";

// [label, text as it would appear in a log or command line, the secret that must not survive]
const SHAPES: Array<[string, string, string]> = [
  ["npm token", `publish with ${FAKE.npmToken} now`, FAKE.npmToken],
  ["GitLab token", `clone using ${FAKE.gitlabToken}`, FAKE.gitlabToken],
  ["SendGrid key", `key ${FAKE.sendgridKey}`, FAKE.sendgridKey],
  ["Twilio API key", `twilio ${FAKE.twilioKey} ok`, FAKE.twilioKey],
  ["Azure storage AccountKey", `DefaultEndpointsProtocol=https;AccountName=demo;${FAKE.azureAccountKey};EndpointSuffix=core.example.invalid`, FAKE.azureAccountKey.slice("AccountKey=".length)],
  ["Authorization: Basic", `curl -H 'Authorization: Basic ${FAKE_CONTEXT.basicAuthValue}' https://example.invalid/`, FAKE_CONTEXT.basicAuthValue],
  ["Authorization: Digest", `Authorization: Digest ${FAKE_CONTEXT.digestAuthValue}`, "fedcba9876543210"],
  ["Cookie header", `curl -H 'Cookie: ${FAKE_CONTEXT.cookieValue}' https://example.invalid/`, "4f9c1b2a7d3e8f60"],
  ["Set-Cookie header", `Set-Cookie: ${FAKE_CONTEXT.cookieValue}; Path=/; HttpOnly`, "4f9c1b2a7d3e8f60"],
  ["JSON password inside free text", `the run printed ${FAKE.jsonPasswordText} before failing`, "correct-horse-battery"],
  ["GitHub token glued to a word", `${FAKE.wordGluedGithub}`, FAKE.githubToken],
  ["AWS key id glued to a letter", `${FAKE.wordGluedAws}`, FAKE.awsKey],
];

describe("credential shapes found by the prober are redacted", () => {
  it.each(SHAPES)("%s", (_label, text, secret) => {
    const out = redactString(text);
    expect(out, text).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("the same shapes are redacted inside object values and object keys", () => {
    for (const [, text, secret] of SHAPES) {
      const out = JSON.stringify(redactValue({ note: text, [text]: 1 }));
      expect(out).not.toContain(secret);
    }
  });

  it("the artifact scanner (bundle export) detects every one of them", () => {
    for (const [label, text] of SHAPES) {
      expect(scanBufferForCredentials(Buffer.from(`build log\n${text}\ndone\n`)).length, label).toBeGreaterThan(0);
    }
  });

  it("ordinary text near these shapes is left alone", () => {
    for (const text of ["npm_config_cache is set", "SK is short for stock keeping", "Cookie policy: we use cookies", "Authorization was granted by the owner", "use glpat- style tokens carefully"]) {
      expect(redactString(text), text).toBe(text);
    }
  });
});
