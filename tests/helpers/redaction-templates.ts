/**
 * The embedding templates and secrets of the depth-parametric redaction tests (unit level and end to end). A template is the
 * innermost text that holds a secret; `nest(text, k)` writes it as the text of a JSON string inside a JSON string, k times,
 * so a quote carries 2^k - 1 backslashes. Markers are alphanumeric so escaping cannot hide them from a search.
 */

/** The text of a JSON string holding `text`: what embedding a document inside a JSON string does to it, once. */
export const layer = (text: string): string => JSON.stringify(text).slice(1, -1);

export function nest(text: string, k: number): string {
  let out = text;
  for (let i = 0; i < k; i += 1) out = layer(out);
  return out;
}

export interface Template {
  name: string;
  /** Innermost text holding the secret. */
  make: (secret: string) => string;
  /** True when the template can hold a secret that itself contains a quote or a backslash. */
  quoted: boolean;
}

/** Shell double-quote escaping: a backslash or a double quote inside the value is written with a backslash. */
const dq = (s: string): string => s.replace(/[\\"]/g, "\\$&");

export const TEMPLATES: Template[] = [
  // round 5: one template per step family and quoting style, so that a family cannot be left out of the depth matrix
  { name: "option, double-quoted value", make: (s) => `run --password "${dq(s)}" done`, quoted: true },
  { name: "option with equals, double-quoted value", make: (s) => `run --token="${dq(s)}" done`, quoted: true },
  { name: "option, blanks around equals, double-quoted", make: (s) => `run --secret = "${dq(s)}" done`, quoted: true },
  { name: "Authorization option, double-quoted", make: (s) => `run --Authorization="${dq(s)}" done`, quoted: true },
  { name: "compound option", make: (s) => `tool --client-secret ${s} --verbose`, quoted: false },
  { name: "compound option, quoted", make: (s) => `tool --db-password "${dq(s)}" --verbose`, quoted: true },
  { name: "curl -u, quoted user:password", make: (s) => `curl -u "admin:${dq(s)}" https://localhost/x`, quoted: true },
  { name: "curl -u, unquoted user:password", make: (s) => `curl -u admin:${s} https://localhost/x`, quoted: false },
  { name: "URL user information", make: (s) => `https:${"//"}svc:${s}@host.example.invalid/path`, quoted: false },
  { name: "scheme-less user information", make: (s) => `//svc:${s}@localhost/path`, quoted: false },
  { name: "pair with a label that has a space", make: (s) => JSON.stringify({ name: "Admin password", value: s }), quoted: true },
  { name: "pair, value first, a nested object between the keys", make: (s) => JSON.stringify({ value: s, meta: { a: 1 }, name: "DB_PASSWORD" }), quoted: true },
  { name: "pair whose value is an object", make: (s) => JSON.stringify({ name: "DB_PASSWORD", value: { stringValue: s } }), quoted: true },
  { name: "pair whose value is an array", make: (s) => JSON.stringify({ name: "DB_PASSWORD", value: [s] }), quoted: true },
  { name: "python bytes prefix", make: (s) => `{'password': b'${s}'}`, quoted: false },
  { name: "yaml value after a blank line and a comment", make: (s) => `password:\n\n# note\n  ${s}\nnext: 1`, quoted: false },
  { name: "yaml block scalar", make: (s) => `password: |\n  ${s}\nnext: 1`, quoted: false },
  { name: "percent-encoded JSON with an escaped quote", make: (s) => `?f=%7B%5C%22password%5C%22%3A%5C%22${s}%5C%22%7D`, quoted: false },
  { name: "json quoted value (password)", make: (s) => JSON.stringify({ user: "svc", password: s }), quoted: true },
  { name: "json quoted value (token, other key after)", make: (s) => JSON.stringify({ token: s, keep: "x" }), quoted: true },
  { name: "json quoted value (apiKey, nested)", make: (s) => JSON.stringify({ config: { apiKey: s, region: "eu" } }), quoted: true },
  { name: "json quoted value (connectionString)", make: (s) => JSON.stringify({ connectionString: s }), quoted: true },
  { name: "json quoted value (ssh_key)", make: (s) => JSON.stringify({ ssh_key: s }), quoted: true },
  { name: "json quoted value (client_secret)", make: (s) => JSON.stringify({ client_secret: s }), quoted: true },
  { name: "json quoted value (bearer key)", make: (s) => JSON.stringify({ bearer: s }), quoted: true },
  { name: "kubernetes pair", make: (s) => JSON.stringify({ name: "DB_PASSWORD", value: s }), quoted: true },
  { name: "unquoted assignment", make: (s) => `deploy password=${s} done`, quoted: false },
  { name: "unquoted assignment (pwd, after a newline)", make: (s) => `make test\npwd=${s}\nmake done`, quoted: false },
  { name: "unquoted assignment (pass, after a tab)", make: (s) => `a\tpass=${s}\tb`, quoted: false },
  { name: "unquoted assignment (auth, after CRLF)", make: (s) => `a\r\nauth=${s}\r\nb`, quoted: false },
  { name: "colon assignment (secret)", make: (s) => `secret: ${s}`, quoted: false },
  { name: "spaced assignment", make: (s) => `password   =    ${s}`, quoted: false },
  { name: "hash rocket", make: (s) => `{ "password" => "${s}" }`, quoted: false },
  { name: "yaml next line", make: (s) => `db:\n  password:\n    ${s}\nnext: line`, quoted: false },
  { name: "flag with a space", make: (s) => `run --password ${s} --verbose`, quoted: false },
  { name: "flag with equals", make: (s) => `run --token=${s} --verbose`, quoted: false },
  { name: "flag with spaces around equals", make: (s) => `run --password = ${s} --verbose`, quoted: false },
  { name: "authorization header", make: (s) => `curl -H 'Authorization: Basic ${s}' https://example.invalid/`, quoted: false },
  { name: "glued word before the name", make: (s) => `build_pwd=${s}`, quoted: false },
  { name: "pair, value before the name", make: (s) => JSON.stringify({ value: s, name: "DB_PASSWORD" }), quoted: true },
  { name: "pair with an intervening key (AWS SSM)", make: (s) => JSON.stringify({ Name: "/prod/db/password", Type: "SecureString", Value: s }), quoted: true },
  { name: "cookie pair", make: (s) => JSON.stringify({ name: "session", value: s }), quoted: true },
  { name: "ECS valueFrom beside value", make: (s) => JSON.stringify({ name: "DB_PASSWORD", valueFrom: "arn:example", value: s }), quoted: true },
  { name: "tuple list", make: (s) => JSON.stringify([["password", s]]), quoted: true },
  { name: "argv list", make: (s) => JSON.stringify(["run", "--token", s, "--verbose"]), quoted: true },
  { name: "whole-key name (database_url)", make: (s) => JSON.stringify({ database_url: s }), quoted: true },
  { name: "whole-key name in an assignment (stripeKey)", make: (s) => `stripeKey=${s}`, quoted: false },
  { name: "yaml block list under a key", make: (s) => `password:\n  - ${s}\nnext: 1`, quoted: false },
  { name: "flow list under a key", make: (s) => `password: [${s}, ${s}]\nnext: 1`, quoted: false },
  { name: "percent-encoded assignment", make: (s) => `password%3D${s}`, quoted: false },
  { name: "percent-encoded header", make: (s) => `Authorization%3A%20Bearer%20${s}`, quoted: false },
  { name: "percent-encoded URL userinfo", make: (s) => `https%3A%2F%2Fadmin%3A${s}%40db.example.invalid%2F`, quoted: false },
  { name: "percent-encoded newline before the name", make: (s) => `a%0Apwd=${s}%0Ab`, quoted: false },
  { name: "percent-encoded space before the name", make: (s) => `a%20auth: ${s} b`, quoted: false },
  { name: "percent-encoded tab before the name", make: (s) => `a%09pass=${s} b`, quoted: false },
  { name: "escaped newline before the name, written as text", make: (s) => `a\\npwd=${s}\\nb`, quoted: false },
  { name: "escaped newline inside a yaml next line, written as text", make: (s) => `db:\\n  password:\\n    ${s}\\nnext: line`, quoted: false },
  { name: "unicode-escaped newline before the name", make: (s) => `a\\u000apwd=${s}`, quoted: false },
];

export interface Secret {
  label: string;
  value: string;
  markers: string[];
  /** True when the value has no quote or backslash, so it can be written into an unquoted template unchanged. */
  plain: boolean;
}

export function secrets(tag: string): Secret[] {
  return [
    { label: "plain", value: `Hs${tag}Zq9plainXy`, markers: [`Hs${tag}Zq9plainXy`], plain: true },
    { label: "with an embedded quote", value: `HEAD${tag}77"TAIL${tag}99`, markers: [`HEAD${tag}77`, `TAIL${tag}99`], plain: false },
    { label: "with an embedded backslash", value: `HEAD${tag}55\\TAIL${tag}44`, markers: [`HEAD${tag}55`, `TAIL${tag}44`], plain: false },
    { label: "with a quote and a backslash", value: `HEAD${tag}33\\"TAIL${tag}22`, markers: [`HEAD${tag}33`, `TAIL${tag}22`], plain: false },
  ];
}

export const DEPTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
