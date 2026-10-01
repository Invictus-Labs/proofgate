/**
 * Planted fake credentials for redaction tests. They are assembled from fragments
 * at runtime so no credential-shaped literal exists in the repository, and none
 * of them is a real credential.
 */
const join = (...parts: string[]): string => parts.join("");

export const FAKE = {
  awsKey: join("AKI", "AIOSFODNN7", "EXAMPLE"),
  githubToken: join("ghp", "_", "0123456789abcdefghijklmnopqrstuvwxyzAB"),
  githubPat: join("github", "_pat_", "11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH"),
  slackToken: join("xox", "b-", "123456789012-abcdefghijklmnop"),
  skToken: join("sk", "-", "ant-api03-", "abcdefghijklmnopqrstuvwxyz0123456789"),
  googleKey: join("AIza", "SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q"),
  stripeKey: join("sk", "_live_", "abcdefghijklmnop1234"),
  jwt: join("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiJzeW50aGV0aWMifQ", ".", "c2lnbmF0dXJlLXN5bnRoZXRpYw"),
  bearer: join("Bearer ", "abcdefghijklmnopqrstuvwxyz012345"),
  urlPassword: join("https://", "user", ":", "hunter2hunter2", "@", "example.invalid/path"),
  privateKey: join("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END ", "RSA PRIVATE KEY-----"),
  assignment: join("api_", "key=", "synthetic-secret-value-123"),
  email: join("person", "@", "example.invalid"),
  // Shapes added after review round 1 (each is a shape the redactor did not know when the list was first written).
  npmToken: join("npm", "_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"),
  gitlabToken: join("glpat", "-", "a1B2c3D4e5F6g7H8i9J0"),
  sendgridKey: join("SG", ".", "a1B2c3D4e5F6g7H8i9J0k1", ".", "L2m3N4o5P6q7R8s9T0u1V2w3X4y5Z6a7B8c9D0e1F2g"),
  twilioKey: join("SK", "0123456789abcdef0123456789abcdef"),
  azureAccountKey: join("Account", "Key=", "dGhpcy1pcy1hLXN5bnRoZXRpYy1henVyZS1zdG9yYWdlLWtleS0wMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Ng=="),
  jsonPasswordText: join("{\"pass", "word\": \"", "correct-horse-battery", "\"}"),
  wordGluedGithub: join("build_ghp", "_", "0123456789abcdefghijklmnopqrstuvwxyzAB"),
  wordGluedAws: join("xAKI", "AIOSFODNN7", "EXAMPLE"),
} as const;

/** Values that are only credentials in context (a header, a cookie jar): redacted by the header they follow, never bare. */
export const FAKE_CONTEXT = {
  basicAuthValue: "dXNlcjpwYXNzd29yZC1zeW50aGV0aWM=",
  digestAuthValue: join("username=\"svc\", realm=\"x\", nonce=\"", "0123456789abcdef", "\", response=\"", "fedcba9876543210", "\""),
  cookieValue: "session=4f9c1b2a7d3e8f60",
} as const;

export const PLANTED_VALUES = [
  FAKE.awsKey,
  FAKE.githubToken,
  FAKE.githubPat,
  FAKE.slackToken,
  FAKE.skToken,
  FAKE.googleKey,
  FAKE.stripeKey,
  FAKE.jwt,
  "abcdefghijklmnopqrstuvwxyz012345",
  "hunter2hunter2",
  "MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu",
  "synthetic-secret-value-123",
  FAKE.email,
  FAKE.npmToken,
  FAKE.gitlabToken,
  FAKE.sendgridKey,
  FAKE.twilioKey,
  FAKE.azureAccountKey.slice("AccountKey=".length),
  FAKE_CONTEXT.basicAuthValue,
  "fedcba9876543210",
  "4f9c1b2a7d3e8f60",
  "correct-horse-battery",
  "build_" + FAKE.githubToken,
  "x" + FAKE.awsKey,
];

/**
 * What can stand directly in front of a token in real logs: a word or letter, a digit, a literal backslash-n or backslash-t (a
 * log line kept as text inside JSON), a percent-encoded newline or space (a URL), a JSON or string-literal escape of a newline.
 * Round 3 (tests re-review P1): the suite planted only the underscore form, so the promise "a token glued to a word is still
 * found" was unproven for letters, digits and escapes, and 11 of 12 token shapes leaked behind them.
 */
export const GLUE_PREFIXES: readonly string[] = ["build_", "word", "x", "9", "\\n", "\\t", "\\r\\n", "%0A", "%0a", "%20", "\\u000a", "\\x0a", "\n", "\t"];

/** Token shapes with a distinctive prefix, each of which must be found behind every prefix above. */
export const GLUE_TOKENS: readonly string[] = [
  FAKE.githubToken,
  FAKE.githubPat,
  FAKE.slackToken,
  FAKE.skToken,
  FAKE.stripeKey,
  FAKE.npmToken,
  FAKE.gitlabToken,
  FAKE.googleKey,
  FAKE.jwt,
  FAKE.sendgridKey,
  FAKE.awsKey,
];

/** One planted string per (prefix, token) pair, space separated: `log <prefix><token> log <prefix><token> ...`. */
export const GLUED_TEXT: string = GLUE_PREFIXES.flatMap((prefix) => GLUE_TOKENS.map((token) => `log ${prefix}${token}`)).join(" ");
