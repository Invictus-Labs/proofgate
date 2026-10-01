/**
 * Secret redaction for logs, reports and bundle documents. BEST EFFORT: it removes the credential shapes it knows
 * (listed below) and the values of credential-named properties and assignments; it cannot recognise an arbitrary secret
 * that has no telltale shape or name, and it may redact harmless text that looks like one. Do not rely on it as the only
 * control; it is a safety net for documents and messages, not a guarantee for opaque artifact bytes.
 *
 * Layers:
 *   1. key names: the value of a property whose name looks like a credential is replaced wholesale, and the KEY TEXT itself
 *      goes through the pattern layer (a token used as a key name is redacted). Names are also tested in folded form, so
 *      a key written with zero-width characters or in fullwidth letters is still recognised;
 *   2. token shapes: cloud, VCS, chat, package-registry, payment and hosting tokens, JWTs, bearer headers, URL credentials,
 *      webhook URLs, private-key blocks (PEM and PGP), `Cookie:` headers, signature parameters;
 *   3. assignments and command-line flags: `name=value`, `"name": "value"`, `--password value`, `-pSECRET`. A quoted value
 *      ends at its closing quote, an `Authorization` value at the end of the line, any other value at whitespace, a quote or
 *      a `name=` pair; a value of ANY length is consumed whole;
 *   4. text that hides a credential by splitting it with zero-width characters or writing it in fullwidth letters is
 *      folded (NFKC, zero-width removed) before matching; a string that contained a credential is returned in folded form.
 * Boundaries are "not preceded by a letter or digit" (so `TOKEN_ghp_...` and `unknown_ghp_...` are caught; a plain `\b`
 * does not see a boundary after an underscore).
 *
 * Cost is LINEAR in the text. That is checked, not merely claimed, and it has failed before: a scaling matrix of hostile shapes
 * (`tests/unit/round3-redaction-scaling.test.ts`), a static audit of every regular expression (`scripts/regex-audit.mjs`, run by
 * `tests/unit/regex-static-audit.test.ts`), and, for every opener of a credential followed by a run of backslashes or of escaped breaks, a capped
 * child process that compares the CPU time at three sizes (`tests/unit/redaction-work-bound.test.ts`). As a last resort every scan that walks a run is counted
 * against a per-call WORK BUDGET that fails closed (see `withWorkBudget`): a call that passes it hides the whole text. Every pattern has either
 * bounded quantifiers or a run that a match consumes whole, no pattern nests an unbounded quantifier inside another, each step is guarded by a literal-prefix check so most text never reaches a regex,
 * the shapes that would otherwise rescan a long run from every start (JWT, assignments, private-key blocks) are found by a
 * scanner that resumes after what it consumed, and output is built with array joins or `String.replace`, never by
 * per-character concatenation. Unicode folding works in bounded chunks cut at points where normalisation cannot change
 * the result, and text whose folded form is over a fixed budget is treated as unexaminable and redacted whole (fail
 * closed), so hostile expansion (one code point that normalises to 18) cannot exhaust memory. Redaction is idempotent.
 */

import { charClassRegex } from "./charclass.js";

export const REDACTED = "[REDACTED]";

/* ------------------------------------------------------------------------------------------------ key names */

/**
 * A private copy of a module-level global or sticky regex. A scanning loop that can re-enter `redactString` (a pair label is judged by
 * redacting it) must never share `lastIndex` with the call it re-enters: that made `{"key":"value"}` loop forever.
 */
const fresh = (re: RegExp): RegExp => new RegExp(re.source, re.flags);

/**
 * Usage counters and statuses that only look like credentials: `max_tokens`, `total_tokens`, `TOKEN_COUNT`, `tokens_per_minute`, `pass_rate`. ONE definition for the text rule and
 * the object-key rule (`isSensitiveName`): a name either is a counter in both or in neither. It is narrow on purpose, and every shape is one that cannot name a credential:
 *  - LLM token counts, PLURAL only: `input_tokens`, `output_tokens`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `max_tokens`, `min_tokens`, `cached_tokens`, `reasoning_tokens`
 *    (the singular names a credential: GitHub Actions passes an input as `INPUT_TOKEN`);
 *  - a token with a counting word after it: `token_used`, `token_count`, `token_limit`, `token_total`, `token_remaining`, `token_max`, `token_min`, `token_rate`;
 *  - a token per unit of time or work: `tokens_per_second|minute|hour|day|week|month|request|call`;
 *  - a pass with a status word: `pass_count`, `pass_rate`, `pass_fail`, `pass_failed`, `pass_total`, `pass_through`.
 * A word that can qualify a credential (`token_user`, `token_request`, `token_second`, `token_day`, `token_month`, `token_calls`) is NOT here: `TOKEN_USER=S` is a secret.
 */
const COUNTER_SOURCE = String.raw`(?:(?:input|output|prompt|completion|total|max|min|cached|reasoning)[_-]?tokens|tokens?[_-](?:used|count|limit|total|remaining|max|min|rate)|tokens?[_-]per[_-](?:second|minute|hour|day|week|month|request|call)s?|pass[_-](?:count|rate|fail|failed|total|through))`;
const USAGE_COUNTER = new RegExp(`^${COUNTER_SOURCE}$`, "i");

const SENSITIVE_KEY =
  /(?:^|[_-])(?:password|passwd|pswd|pw|pwd|passphrase|passcode|secrets?|tokens?|api[_-]?key|apikey|auth|authorization|credentials?|private[_-]?key|ssh[_-]?key|sshkey|connection[_-]?string|cookies?|session[_-]?id|access[_-]?key|account[_-]?key|signing[_-]?key|encryption[_-]?key|master[_-]?key|dsn|shared[_-]?access[_-]?(?:key|signature)|bearer|jwt|signature)\d*(?:$|[_-])/i;
// A bare "pass" is a password key only in lowercase: the report's own status key is "PASS". Inside a longer name
// ("DB_PASS", "dbPass", "pass_phrase") it is a password whatever the case.
const SENSITIVE_PASS = /(?:^|[_-])pass\d*(?:$|[_-])/;
const SENSITIVE_PASS_ANY_CASE = /(?:^|[_-])pass\d*(?:$|[_-])/i;

/** Words that name a credential wherever they sit inside ONE segment of a name (`dbpassword`, `PASSWORD1`, `myapikey`). */
const STRONG_SEGMENT = /password|passwd|passphrase|passcode|apikey|accesskey|privatekey|credential|authorization|sessionid|connectionstring|sshkey|clientsecret|secretkey|secretvalue|tokenvalue|tokenstring|authkey|authtoken|signingkey|encryptionkey|masterkey/;
/** `secret` or `token` as the END of a segment, with optional digits (`mytoken`, `accesstoken`, `clientsecret2`); `secretary` and `tokenizer` stay. */
const TRAILING_SECRET = /(?:secret|token)s?\d*$/;
/** `pass` or `pwd` glued to the word that says whose it is (`dbpass`, `userpass`, `adminpwd`): a name, where `compass` and `bypass` are English. */
const PASS_SUFFIX = /(?:db|user|admin|root|app|service|master|ssh|smtp|mail|redis|mysql|pg|api|client|server|login)(?:pass|pwd)$/;
/**
 * Credential words anywhere in the WHOLE name once its separators are removed and its case is folded (`PGPASSWORD`, `database_url`,
 * `stripeKey`, `slack_webhook`), so a word that the segment rules cannot see because it spans two segments or carries a vendor name
 * is still found: connection URLs (which carry a password), webhook URLs (which are the secret), and `<vendor>key`.
 */
const FLAT_CREDENTIAL =
  /passw(?:or)?d|passphrase|passcode|apikey|accesskey|privatekey|secretkey|signingkey|encryptionkey|masterkey|sshkey|authtoken|clientsecret|sessionid|connectionstring|credential|webhook|pswd|tlskey|sslkey|privkey|keypass|storepass|idrsa|clientkeydata|mnemonic|(?:database|db|redis|mongo|mongodb|postgres|postgresql|mysql|mariadb|amqp|rabbitmq|broker|celery|jdbc|datasource|sqlalchemy|connection|conn)(?:url|uri|dsn)|(?:stripe|sendgrid|mailgun|twilio|openai|anthropic|github|gitlab|slack|aws|azure|firebase|datadog|sentry|npm|heroku|vercel|netlify|cloudflare|paypal|shopify|okta|hmac|jwt|bot|license)key/;

function isSensitiveName(key: string): boolean {
  // Every run of characters that is not a letter or a digit separates segments ("spring.datasource.password", "user[password]",
  // "user:password", "db password"), and so does a lower-to-upper camel-case step ("dbPass").
  // "tokens_used", "token_count", ... are usage counters (LLM tokens), not credentials: the WHOLE name is one of the shapes of `COUNTER_SOURCE`, the ones the text rule exempts.
  const snake = key
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  if (USAGE_COUNTER.test(snake)) return false;
  if (SENSITIVE_KEY.test(snake) || SENSITIVE_PASS.test(snake) || (snake.length > 4 && SENSITIVE_PASS_ANY_CASE.test(snake))) return true;
  for (const segment of snake.toLowerCase().split("_")) {
    if (STRONG_SEGMENT.test(segment) || TRAILING_SECRET.test(segment) || PASS_SUFFIX.test(segment)) return true;
  }
  return FLAT_CREDENTIAL.test(key.toLowerCase().replace(/[^a-z0-9]+/g, ""));
}

/** Folded key names are limited to 1 Mi code units; a longer key cannot be examined and is treated as sensitive (fail closed). */
const KEY_FOLD_BUDGET = 1024 * 1024;

export function isSensitiveKey(key: string): boolean {
  if (key.length > MAX_REDACT_STRING) return true;
  if (isSensitiveName(key)) return true;
  if (!hasNonAscii(key)) return false;
  const folded = foldString(key, KEY_FOLD_BUDGET);
  if (folded === undefined) return true;
  return folded !== key && isSensitiveName(folded);
}

/* -------------------------------------------------------------------------------------------- steps and shapes */

/** A redaction step: returns the (possibly rewritten) text. Detection = the step changed something. */
interface Step {
  name: string;
  /** True for credential shapes (used by the artifact scanner); false for personal-field patterns such as e-mail. */
  credential: boolean;
  /** Literal substrings; the step only runs on text that contains at least one (case-sensitive unless `insensitive`). */
  prefilter: readonly string[];
  insensitive?: boolean;
  apply(text: string): string;
}

/**
 * Boundary in front of a SHORT or ordinary-looking prefix (`sk-`, `AC`, `key-`, `Bearer`): not preceded by a letter or a
 * digit ("_" and punctuation are boundaries), OR preceded by an escape that stands for a separator (a literal backslash and
 * `n`, `t`, `r`; a percent escape such as `%20` or `%0A`; a backslash-u or backslash-x escape). A log that carries
 * `line1\nghp_...` or `a%20ghp_...` has a letter or digit in front of the token only by accident of the encoding.
 */
const NB = String.raw`(?:(?<![A-Za-z0-9])|(?<=\\[nrtbfv])|(?<=%[0-9A-Fa-f]{2})|(?<=\\u[0-9A-Fa-f]{4})|(?<=\\x[0-9A-Fa-f]{2}))`;
/** No boundary at all, for prefixes that are distinctive enough to be a credential wherever they appear (`ghp_`, `glpat-`, `npm_`, ...). */
const ANY = "";

function regexStep(name: string, regex: RegExp, replace: string, prefilter: readonly string[], credential = true, insensitive = false): Step {
  return { name, credential, prefilter, insensitive, apply: (text) => text.replace(regex, replace) };
}

const isAlnum = (cc: number): boolean => (cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122);
const isBase64Url = (cc: number): boolean => isAlnum(cc) || cc === 95 || cc === 45;

function runEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && isBase64Url(text.charCodeAt(i))) i += 1;
  return i;
}

/**
 * `eyJ<8+>.<8+>.<8+>` (three base64url segments). A regex with an open-ended run and a required "." rescans the whole run
 * from every `eyJ` start (`eyJ_eyJ_eyJ_...` is quadratic), so this scanner measures each run once and resumes after it.
 * The last segment is consumed whole, whatever its length.
 */
function redactJwt(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf("eyJ", from);
    if (at === -1) break;
    const header = runEnd(text, at + 3);
    if (header - (at + 3) < 8 || text.charCodeAt(header) !== 46) {
      from = Math.max(header, at + 1);
      continue;
    }
    const payload = runEnd(text, header + 1);
    if (payload - (header + 1) < 8 || text.charCodeAt(payload) !== 46) {
      from = header;
      continue;
    }
    const signature = runEnd(text, payload + 1);
    if (signature - (payload + 1) < 8) {
      from = header;
      continue;
    }
    parts.push(text.slice(cursor, at), REDACTED);
    cursor = signature;
    from = signature;
  }
  return parts.length === 0 ? text : parts.join("") + text.slice(cursor);
}

const TOKEN_LIKE: Step[] = [
  // No leading boundary: a key id glued to a letter (xAKIA...) is still a key id. The exact length and the trailing boundary
  // keep an ordinary longer word that merely contains "AKIA" out of it.
  regexStep("aws-access-key", /(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g, REDACTED, ["AKIA", "ASIA"]),
  regexStep("twilio-api-key", new RegExp(`${NB}SK[0-9a-f]{32}(?![A-Za-z0-9])`, "g"), REDACTED, ["SK"]),
  regexStep("twilio-account-sid", new RegExp(`${NB}AC[0-9a-f]{32}(?![A-Za-z0-9])`, "g"), REDACTED, ["AC"]),
  regexStep("github-token", new RegExp(`${ANY}gh[pousr]_[A-Za-z0-9]{30,}`, "g"), REDACTED, ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]),
  regexStep("github-pat", new RegExp(`${ANY}github_pat_[A-Za-z0-9_]{40,}`, "g"), REDACTED, ["github_pat_"]),
  regexStep("gitlab-token", new RegExp(`${ANY}glpat-[A-Za-z0-9_-]{20,}`, "g"), REDACTED, ["glpat-"]),
  regexStep("npm-token", new RegExp(`${ANY}npm_[A-Za-z0-9]{36,}`, "g"), REDACTED, ["npm_"]),
  regexStep("slack-token", new RegExp(`${ANY}xox[a-z]-[A-Za-z0-9-]{10,}`, "g"), REDACTED, ["xox"]),
  regexStep("sk-ant-token", new RegExp(`${ANY}sk-ant-[A-Za-z0-9_-]{20,}`, "g"), REDACTED, ["sk-ant-"]),
  // A bare `sk-` is short enough to sit inside ordinary words ("task-runner-configuration-module"), so it keeps its boundary.
  regexStep("sk-token", new RegExp(`${NB}sk-[A-Za-z0-9_-]{20,}`, "g"), REDACTED, ["sk-"]),
  regexStep("sendgrid-key", new RegExp(`${ANY}SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}`, "g"), REDACTED, ["SG."]),
  regexStep("huggingface-token", new RegExp(`${ANY}hf_[A-Za-z0-9]{30,}`, "g"), REDACTED, ["hf_"]),
  regexStep("google-api-key", new RegExp(`${ANY}AIza[0-9A-Za-z_-]{35}`, "g"), REDACTED, ["AIza"]),
  regexStep("google-oauth-token", new RegExp(`${ANY}ya29\\.[A-Za-z0-9_-]{20,}`, "g"), REDACTED, ["ya29."]),
  regexStep("stripe-key", new RegExp(`${ANY}[sr]k_(?:live|test)_[0-9A-Za-z]{16,}`, "g"), REDACTED, ["k_live_", "k_test_"]),
  regexStep("digitalocean-token", new RegExp(`${ANY}do[opr]_v1_[0-9a-f]{64}(?![A-Za-z0-9])`, "g"), REDACTED, ["_v1_"]),
  regexStep("shopify-token", new RegExp(`${ANY}shp(?:at|ca|pa|ss)_[0-9a-fA-F]{32}(?![A-Za-z0-9])`, "g"), REDACTED, ["shp"]),
  regexStep("mailgun-key", new RegExp(`${NB}key-[0-9a-f]{32}(?![A-Za-z0-9])`, "g"), REDACTED, ["key-"]),
  regexStep("slack-app-token", new RegExp(`${ANY}xapp-[0-9]-[A-Za-z0-9]{6,}-[0-9]{6,}-[A-Za-z0-9]{20,}`, "g"), REDACTED, ["xapp-"]),
  regexStep("pypi-token", new RegExp(`${ANY}pypi-[A-Za-z0-9_-]{50,}`, "g"), REDACTED, ["pypi-"]),
  regexStep("docker-pat", new RegExp(`${ANY}dckr_pat_[A-Za-z0-9_-]{20,}`, "g"), REDACTED, ["dckr_pat_"]),
  regexStep("gitlab-deploy-token", new RegExp(`${ANY}gldt-[A-Za-z0-9_-]{20,}`, "g"), REDACTED, ["gldt-"]),
  { name: "jwt", credential: true, prefilter: ["eyJ"], apply: redactJwt },
  // `Bearer` with a capital B is the header scheme: a short token after it is a credential when it has a digit in it
  // ("Bearer abc123"; "Bearer Cookie" is prose), and any token of 16 characters or more is. A lowercase "bearer" is ordinary
  // English often enough that it always needs a long token-looking value.
  regexStep(
    "bearer",
    new RegExp(`${NB}(?:Bearer\\s{1,4}(?:(?=[A-Za-z._~+/-]*[0-9])[A-Za-z0-9._~+/-]{6,}|[A-Za-z0-9._~+/-]{16,})|bearer\\s{1,4}[A-Za-z0-9._~+/-]{16,})=*`, "g"),
    `Bearer ${REDACTED}`,
    ["earer"],
  ),
  regexStep(
    "webhook-url",
    /https:\/\/(?:hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}|(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]{5,}\/[A-Za-z0-9_-]{20,}|[a-z0-9.-]{1,100}\.webhook\.office\.com\/webhookb2\/[A-Za-z0-9@/_-]{20,})/gi,
    REDACTED,
    ["hooks.slack.com", "discord", "webhook.office.com"],
    true,
    true,
  ),
  // One start per scheme (the lookbehind), and the password is consumed whole up to the "@". The user may be empty
  // (`redis://:password@host`, the standard Redis form).
  // (The password may hold `@` and `/`: see `redactUserinfo`; a scheme-less `//user:password@host` is read too.)
  { name: "url-credentials", credential: true, prefilter: ["//"], apply: redactUserinfo },
  // `X-Cookie:` and `Proxy-Cookie:` count too, so only a letter or digit in front stops a match.
  regexStep("cookie-header", /((?<![A-Za-z0-9])(?:Set-)?Cookie\s{0,3}:\s{0,3})[^\r\n]{4,}/gi, `$1${REDACTED}`, ["cookie"], true, true),
  // `curl -u user:password` and `--user user:password`; a bare `-u root` (no colon) is a user name, not a secret.
  { name: "user-flag", credential: true, prefilter: ["-u", "--user"], apply: (text) => redactFlags(text, "user") },
  // Name/value pair objects written as JSON text at any nesting depth: {"name": "DB_PASSWORD", "value": "..."} (Kubernetes),
  // {"Name":...,"Value":...} (AWS), {"key":...,"value":...}, {"header":"Authorization","value":...}. The value is the secret and
  // the name is only a label; the value ends by the layer arithmetic of the assignment reader, so a value that holds a quote is whole.
  { name: "name-value-pair", credential: true, prefilter: ["value"], insensitive: true, apply: redactNameValuePairs },
  regexStep(
    "signature-parameter",
    /((?<![A-Za-z0-9])(?:x-amz-signature|x-goog-signature|signature|sig)=)[^&\s"'#]{6,}/gi,
    `$1${REDACTED}`,
    ["sig", "SIG"],
    true,
    true,
  ),
  // Long and short options whose NAME is a credential name (`--password`, `--db-password`, `--client-secret`, `--API_KEY`): the value is
  // read with the same layer arithmetic as an assignment, so `--password \"S\"` at any nesting depth and a value with an escaped quote are whole.
  { name: "command-line-secret", credential: true, prefilter: ["-"], apply: (text) => redactFlags(text, "credential") },
  // mysql-style glued password (-pSECRET). Needs 6+ characters with a digit, capital or symbol so that ordinary flags such as -pipe stay.
  // `-p=SECRET` too (any length: after an equals sign the value is not a flag).
  // ... unless the "secret" is an option NAME that a separator follows (`-password%20'S'`, `-passD: S`, `-pApiKey: S`): the option reader and the assignment reader take those.
  { name: "glued-password-flag", credential: true, prefilter: ["-p"], apply: (text) => text.replace(GLUED_PASSWORD_FLAG, (glued) => (gluedIsOptionName(glued) ? glued : `-p${REDACTED}`)) },
];

const GLUED_PASSWORD_FLAG = /(?:(?<![A-Za-z0-9-])|(?<=\\[nrtfv])|(?<=%0[9AaBbCcDd])|(?<=\\u000[9AaBbCcDd])|(?<=\\x0[9AaBbCcDd]))-p(?:=[^\s"']+|(?=[^\s"'=-]{0,20}[0-9A-Z!@#$%^&*])[^\s"'=-][^\s"']{4,})/g;

/** `-password%20`, `-passD:`, `-pApiKey:`: the glued text starts with a credential option's name and a percent escape or a colon follows it. */
function gluedIsOptionName(glued: string): boolean {
  const name = /^-([A-Za-z][A-Za-z0-9_-]*)/.exec(glued);
  if (name === null) return false;
  const after = glued.charAt(1 + (name[1] as string).length);
  return (after === "%" || after === ":") && flagNamesCredential(name[1] as string);
}

/* --------------------------------------------------------------------------------------------- assignments */

/**
 * Words that can name a credential inside an assignment; found in one linear pass. The name around the word is then read
 * (bounded) and judged as a whole: `password`, `client_secret` and `accountkey` are credentials wherever they appear in a
 * name, while the short words (`pwd`, `pass`, `auth`) only count as a whole name segment, so `author=` and `passed=` stay.
 */
const ASSIGNMENT_KEYWORD = /password|passwd|passphrase|passcode|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|account[_-]?key|shared[_-]?access[_-]?signature|authorization|auth|credential|private[_-]?key|ssh[_-]?key|sshkey|connection[_-]?string|connectionstring|cookie|session[_-]?id|sessionid|signing[_-]?key|encryption[_-]?key|master[_-]?key|bearer|jwt|dsn|webhook|pswd|pw|tls[_-]?key|ssl[_-]?key|priv[_-]?key|privkey|id[_-]?rsa|key[_-]?pass|store[_-]?pass|client[_-]?key[_-]?data|mnemonic|(?:database|db|redis|mongo(?:db)?|postgres(?:ql)?|mysql|amqp|broker|celery|jdbc|datasource|connection|conn)[_-]?(?:url|uri)|(?:stripe|sendgrid|mailgun|twilio|openai|anthropic|github|gitlab|slack|aws|azure|firebase|datadog|sentry|npm|heroku|vercel|netlify|cloudflare|paypal|shopify|okta|hmac|bot|license)[_-]?key|pass/gi;
const STRONG_NAME = /password|passwd|passphrase|passcode|secret|token|api[_-]?key|apikey|access[_-]?key|account[_-]?key|shared[_-]?access[_-]?signature|authorization|credential|private[_-]?key|session[_-]?id|sessionid|ssh[_-]?key|sshkey|connection[_-]?string|connectionstring|signing[_-]?key|encryption[_-]?key|master[_-]?key/i;
/** A whole name and nothing else: what the key of the next pair looks like. */
const NAME_ONLY = /^[A-Za-z0-9_.-]{1,60}$/;
const NAME_CHAR = /[A-Za-z0-9_.-]/;
const NAME_LEFT = 80;
const NAME_RIGHT = 80;
/** Spaces and tabs allowed around the separator (aligned YAML and ini files pad with many). */
const MAX_BLANKS = 64;
/** After ";" or "," in an unquoted value: does another `name=` pair follow (a connection string), or is it part of the secret? */
const NEXT_PAIR = /[A-Za-z_][A-Za-z0-9_. -]{0,40}=/y;

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";
}

/** Index after a run of spaces and tabs (at most MAX_BLANKS). */
function skipBlanks(text: string, from: number): number {
  let i = from;
  const limit = Math.min(text.length, from + MAX_BLANKS);
  while (i < limit && (text.charAt(i) === " " || text.charAt(i) === "\t")) i += 1;
  return i;
}

/**
 * End (exclusive) of a quoted value that starts after its opening quote, else the end of the line. `r` is the number of
 * backslashes that stood in front of the OPENING quote: 0 for plain JSON, 1 for JSON inside a JSON string, 3 for JSON inside
 * that, and so on (2^k - 1 at nesting depth k; any other number is treated the same way). The rule is arithmetic, not a
 * table: a run of `m` backslashes in front of a quote is `c * (r + 1) + r` for some `c`, where `c` backslashes of the
 * value itself were written at the innermost level. An EVEN `c` means the quote closes the value (its own `r` backslashes
 * come last, so the value ends where they begin); an ODD `c` is a quote INSIDE the value, which is how a credential that
 * itself contains a quote (`ab"cd`) is written at every depth. A run that fits neither (`m` less than `r`, or not of the
 * form `c * (r + 1) + r`) is malformed: it is taken as part of the value, so the value runs on to the end of its line and
 * more is redacted, never less. The whole run is counted (no cap) and each character is looked at once.
 */
function quotedValueEnd(text: string, start: number, quote: string, r: number): number {
  const n = text.length;
  let i = start;
  while (i < n) {
    const ch = text.charAt(i);
    if (ch === "\n" || ch === "\r") {
      tick(i - start + 1);
      return i;
    }
    if (ch === "\\") {
      let j = i + 1;
      while (j < n && text.charCodeAt(j) === 92) j += 1;
      const m = j - i;
      if (text.charAt(j) === quote) {
        if (m >= r && (m - r) % (r + 1) === 0 && ((m - r) / (r + 1)) % 2 === 0) {
          tick(i - start + 1);
          return i + (m - r);
        }
        i = j + 1; // a quote inside the value (odd c) or a malformed run: part of the value
      } else {
        i = j;
      }
      continue;
    }
    if (ch === quote && r === 0) {
      tick(i - start + 1);
      return i;
    }
    i += 1;
  }
  tick(n - start + 1);
  return n;
}

function lineEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && text.charAt(i) !== "\n" && text.charAt(i) !== "\r") i += 1;
  tick(i - start + 1);
  return i;
}

/* ------------------------------------------------------------------------------------------------ work budget */

/**
 * A per-call WORK BUDGET for every scan that walks a run of text (line ends, value ends, option words, quoted values, runs of backslashes, containers, trailing
 * strips). The redactor is linear by construction: every such scan is either done once per region or remembers where it ended (`backslashRunEnd`, `wordEnd`,
 * `nextChar`), and a stress test and a static audit look for the ones that are not. This budget is what stands behind them when they miss one, and it FAILS CLOSED:
 * a call whose counted steps pass `WORK_PER_CHAR` per character of its input (plus `WORK_BASE`) gives up, and the WHOLE text is replaced by the marker (for the
 * credential scanner: reported as holding a credential), never shown. Legitimate text uses a small fraction of it (a few steps per character); a hostile shape that
 * would have cost quadratic time costs a bounded, linear amount and is hidden. The budget belongs to the outermost call: a nested call (a pair label is judged by
 * redacting it) spends the same one.
 */
const WORK_PER_CHAR = 64;
const WORK_BASE = 65_536;
const OUT_OF_WORK = Symbol("out-of-work");
let workLeft = Number.POSITIVE_INFINITY;
let workDepth = 0;

function tick(steps: number): void {
  workLeft -= steps;
  if (workLeft < 0) throw OUT_OF_WORK;
}

/** Runs `run` under the budget of its outermost call (`limit` steps); when the budget runs out, `exhausted()` is the answer. */
function withWorkBudget<T>(limit: number, run: () => T, exhausted: () => T): T {
  const outermost = workDepth === 0;
  if (outermost) workLeft = limit;
  workDepth += 1;
  try {
    return run();
  } catch (error) {
    if (error === OUT_OF_WORK && outermost) return exhausted();
    throw error;
  } finally {
    workDepth -= 1;
    if (outermost) workLeft = Number.POSITIVE_INFINITY;
  }
}

/** Is there a colon in `[from, to)`? (the last answer of `nextChar` is remembered: a scan that asks at every option of a text without a colon reads it once) */
function colonBetween(text: string, from: number, to: number): boolean {
  const at = nextChar(text, ":", from);
  return at !== -1 && at < to;
}

/** How many of the last characters of an option's word are looked at for a credential's name at its end (a name is at most 61 characters, a separator at most 6). */
const TAIL_WINDOW = 160;

/** The end of the word (up to a blank or a quote) that starts at `from`, or, with `glued`, up to a blank or a quote that follows a `:` or `=` (and is not the first character). The last word of each kind is remembered: a scan that asks at every option of one long blank-free text reads it once. */
const wordMemo = [
  { text: "", from: 0, to: 0 },
  { text: "", from: 0, to: 0 },
];
function wordEnd(text: string, from: number, glued: boolean): number {
  const memo = wordMemo[glued ? 1 : 0] as { text: string; from: number; to: number };
  if (from >= memo.from && from < memo.to && memo.text === text) return memo.to;
  let e = from;
  while (e < text.length) {
    const ch = text.charAt(e);
    if (isWhitespace(ch)) break;
    if ((ch === '"' || ch === "'") && (!glued || (e > from && (text.charAt(e - 1) === ":" || text.charAt(e - 1) === "=")))) break;
    e += 1;
  }
  tick(e - from + 1);
  memo.text = text;
  memo.from = from;
  memo.to = e;
  return e;
}

/** `text.indexOf(ch, from)`, remembering the last answer: when no `ch` stands between `from` and the remembered position, the answer is the same (a scan that asks at every option of a text without one reads it once). */
const charMemo = { text: "", ch: "", from: 0, at: -1 };
function nextChar(text: string, ch: string, from: number): number {
  if (charMemo.ch === ch && from >= charMemo.from && (charMemo.at === -1 || from <= charMemo.at) && charMemo.text === text) return charMemo.at;
  const at = text.indexOf(ch, from);
  tick((at === -1 ? text.length : at) - from + 1);
  charMemo.text = text;
  charMemo.ch = ch;
  charMemo.from = from;
  charMemo.at = at;
  return at;
}

/**
 * The trailing strips below are linear scans from the end, never a regular expression with an end anchor: `/\\+$/` retries at every backslash of a run that does not
 * end the text (quadratic), and `/(?:\\+[nr]?|%0[AaDd])+$/` is exponential on `\\\\...\\y` (1,377 ms at 24 characters, found by the round-6 logic review).
 */

/** `s` without the backslashes that end it. */
function stripTrailingBackslashes(s: string): string {
  let e = s.length;
  while (e > 0 && s.charCodeAt(e - 1) === 92) e -= 1;
  tick(s.length - e + 1);
  return e === s.length ? s : s.slice(0, e);
}

/**
 * `s` without the escaped line breaks that end it: `\n`, `\r` (with any number of backslashes in front), `%0A`, `%0D`, in any order and number; with `bare`, a
 * run of backslashes that no letter follows is stripped too (the regex it replaces: `(?:\\+[nr]?|%0[AaDd])+$` with `bare`, `(?:\\+[nr]|%0[AaDd])+$` without).
 */
function stripTrailingBreakEscapes(s: string, bare: boolean): string {
  let e = s.length;
  while (e > 0) {
    const last = s.charCodeAt(e - 1);
    if (e >= 3 && s.charCodeAt(e - 3) === 37 && s.charCodeAt(e - 2) === 48 && "AaDd".includes(s.charAt(e - 1))) {
      e -= 3; // %0A, %0a, %0D, %0d
      continue;
    }
    let f = e;
    if ((last === 110 || last === 114) && e >= 2 && s.charCodeAt(e - 2) === 92) f = e - 1; // `\n`, `\r`: the letter belongs to the backslashes in front of it
    else if (!bare || last !== 92) break;
    while (f > 0 && s.charCodeAt(f - 1) === 92) f -= 1;
    e = f;
  }
  tick(s.length - e + 1);
  return e === s.length ? s : s.slice(0, e);
}

/** Does `s` end in a blank written as text or as an escape: a space, a tab, `\t` (any number of backslashes), `%09`, `%20`? */
function endsWithBlank(s: string): boolean {
  const last = s.charAt(s.length - 1);
  return last === " " || last === "\t" || (last === "t" && s.charAt(s.length - 2) === "\\") || s.endsWith("%09") || s.endsWith("%20");
}

/**
 * A span that ends in a separator at the end of its line (`... token:`, `... secret=`) hands its value to the next line: the span goes on over
 * the first word there. (A bracketed value that never closes, or an Authorization line, may have swallowed the name whose value this is.)
 */
function throughNextLine(text: string, start: number, end: number): number {
  const last = text.charAt(end - 1);
  if (end <= start || (last !== ":" && last !== "=")) return end;
  const breakLength = lineBreakLength(text, end);
  if (breakLength === 0) return end;
  const next = skipIndent(text, end + breakLength);
  if (next >= text.length) return end;
  const ch = text.charAt(next);
  if (ch === '"' || ch === "'") {
    const close = quotedValueEnd(text, next + 1, ch, 0);
    return text.charAt(close) === ch ? close + 1 : close;
  }
  // the label of a header (`Authorization:`) hands over the whole next line, and so does a bracket there (its close may never come)
  // (an anchor or a tag there is a property: the line, as everywhere)
  // (a YAML list item on the next line is the next item, with a value of its own: not the continuation of this one)
  if (ch === "-" && isWhitespace(text.charAt(next + 1))) return end;
  if ("[{(&!".includes(ch) || /authorization[-_A-Za-z0-9]*[:=]$/i.test(text.slice(Math.max(start, end - 60), end))) return Math.max(end, lineEnd(text, next));
  const to = unquotedValueEnd(text, next);
  // a credential's name and separator that a value follows (`Authorization= S`, a name with a quote after its separator, a quoted key) is left for its own reader
  if (startsWithCredentialLabel(text, next, to)) return end;
  const key = /^[A-Za-z][A-Za-z0-9_.-]{0,60}$/.exec(text.slice(next, to));
  if (key !== null && /^(?:\\+)?["'][:=]/.test(text.slice(to, to + 6)) && isSensitiveName(key[0])) return end;
  return Math.max(end, to);
}

/**
 * A value that starts with a bracket: the bracketed span when it closes and stands alone (a blank, a delimiter, the end), else the
 * bracketed span together with the plain token that runs on from it (`[x]tail` and `[]tail` are passwords, not a list followed by text).
 * A closed bracket followed by another credential's name and separator (`[]secret:"S"`) leaves that name to its own reader.
 */
function containerValueEnd(text: string, start: number, budget: { left: number }): number {
  const open = text.charAt(start);
  const close = ({ "[": "]", "{": "}", "(": ")" })[open] as string;
  const end = containerEnd(text, start, open, close, budget);
  if (end <= start + 1 || text.charAt(end - 1) !== close) return end; // never closes: to the end of its line
  const next = text.charAt(end);
  if (text.startsWith(REDACTED, start)) return end; // the marker of an earlier pass is not a list with text behind it
  NEXT_PAIR.lastIndex = end + 1;
  const alone =
    next === "" ||
    isWhitespace(next) ||
    structureContinues(text, end) ||
    (next === "," && (end + 1 >= text.length || /[\s"'\\\])}]/.test(text.charAt(end + 1)) || NEXT_PAIR.test(text))) ||
    ("|&#<".includes(next) && credentialPairFollows(text, end + 1)); // a delimiter in front of the next `NAME=` ends the value
  if (alone) return end;
  const tail = unquotedValueEnd(text, end);
  const word = stripTrailingBreakEscapes(text.slice(end, tail), true); // (an escaped quote or a line break written as text may end the word)
  // another credential's name behind the bracket (`[]PASSWORD =S`, `[]secret:"S"`) is left to its own reader
  const named = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,60}[:=]?$/.exec(word);
  const separated = named !== null && (/[:=]$/.test(word) || /^\s{0,4}[:=]/.test(text.slice(tail, tail + 5)));
  return separated && isSensitiveName(word.replace(/[:=]$/, "")) ? end : Math.max(end, tail);
}

/**
 * A bracket that starts a value has closed and a closer or a delimiter follows it (`[S]}`, `(a);`): does that character belong to the text AROUND the value (the next level
 * of a JSON document, a statement, an outer string), or is it a character of the password (`password=(,NI<ON);r#T-=J*`, `{$F}]r|VK*~l)%JcV`, `()}IK5I1Y`: generated passwords
 * hold brackets and delimiters)? It belongs to the structure when a quote follows, when an escaped quote or a line break or a blank written as text follows, or when the
 * character after it is itself a blank, the end, a closer, a quote or a comma; a `;` also when a credential's `NAME=` follows. Anything else continues the token, and the
 * value is read to its end (more is redacted, never less).
 */
function structureContinues(text: string, end: number): boolean {
  const next = text.charAt(end);
  if (next === '"' || next === "'") return true;
  if (next === "\\") return backslashRun(text, end) > 0 || lineBreakLength(text, end) > 0 || valueGapLength(text, end) > 0;
  if (next === "" || !";)}]>".includes(next)) return false;
  const after = text.charAt(end + 1);
  if (after === "" || isWhitespace(after) || ",)}]>\"'".includes(after)) return true;
  if (after === "\\") return true;
  if (after === ";") return credentialPairFollows(text, end + 2);
  return next === ";" && credentialPairFollows(text, end + 1);
}

/** The end of an Authorization value that starts at `at`: the line, or the whole bracket when it runs past the line (`Authorization: [` then the elements on the lines below): never less than the line. */
function authorizationValueEnd(text: string, at: number, budget: { left: number }): number {
  const line = lineEnd(text, at);
  const end = "[{(".includes(text.charAt(at)) && at < text.length ? Math.max(line, containerValueEnd(text, at, budget)) : line;
  return throughNextLine(text, at, end);
}

/** The scheme words of an authorization value: what follows one is the credential (`token: Bearer S`). */
const SCHEME_WORD = /^(?:Bearer|Basic|Digest|Negotiate|NTLM|OAuth|Splunk|Hawk)$/i;

/** A quoted value that never closes (it runs to the end of its line) and ends in a dangling `name:` hands its value to the next line. */
function quotedThroughNextLine(text: string, start: number, end: number, quote: string, depth: number): number {
  return text.charAt(end + depth) === quote ? end : throughNextLine(text, start, end);
}

/** Does a quote, plain or escaped, follow at `from` (after blanks)? */
function quoteFollows(text: string, from: number): boolean {
  const at = skipBlanks(text, from);
  const ch = text.charAt(at);
  return ch === '"' || ch === "'" || backslashRun(text, at) > 0;
}

/** A blank or a delimiter written as text or as a tag (`\t`, `%20`, `%7C`, `%3E`, `%23`, `<br>`): it ends a value in front of the next `NAME=`. */
const VALUE_GAP_PLAIN = /%(?:09|20|7[Cc]|3[EeBb]|23|3[Ff]|2[BbCc]|21|26|29|7[Dd]|5[Dd])|<[Bb][Rr]\s{0,8}\/?>/y;

/**
 * The end of the run of backslashes that contains `at` (a backslash stands there). A value scan asks at every position of a run, and a regular expression
 * with `\\+` in it read the rest of the run each time (quadratic: 3.9 s for 32,000 backslashes behind `password=`), so the last run of each slot is remembered
 * and every other position in it is answered at once. Two slots: a line break may hold two runs (`\\\\r\\\\\\n`).
 */
const runSlots = [
  { text: "", from: 0, to: 0 },
  { text: "", from: 0, to: 0 },
];
function backslashRunEnd(text: string, at: number, slot: 0 | 1): number {
  const cached = runSlots[slot] as { text: string; from: number; to: number };
  if (at >= cached.from && at < cached.to && cached.text === text) return cached.to;
  let end = at + 1;
  while (text.charCodeAt(end) === 92) end += 1;
  tick(end - at);
  cached.text = text;
  cached.from = at;
  cached.to = end;
  return end;
}

/** The length of a blank or a delimiter written as text or as a tag (`\t` with any number of backslashes, `%20`, `%7C`, `<br>`) at `at`; 0 when there is none. */
function valueGapLength(text: string, at: number): number {
  if (text.charCodeAt(at) === 92) {
    const run = backslashRunEnd(text, at, 0);
    return text.charAt(run) === "t" ? run + 1 - at : 0;
  }
  VALUE_GAP_PLAIN.lastIndex = at;
  const m = VALUE_GAP_PLAIN.exec(text);
  return m === null ? 0 : m[0].length;
}

/** Does a NAME= that names a credential (`AUTH_TOKEN=`) start at `at`? A delimiter other than `;` and `,` ends a value only in front of one. */
function credentialPairFollows(text: string, at: number): boolean {
  NEXT_PAIR.lastIndex = at;
  if (!NEXT_PAIR.test(text)) return false;
  // the credential word must be a whole segment of the name (`AUTH_TOKEN`, `authToken`): a secret that ends in one (`Xy7token=`) is a secret,
  // and a name is one word: `S Bearer=` is a secret and a blank and a name
  const name = text.slice(at, NEXT_PAIR.lastIndex - 1);
  if (/\s/.test(name)) return false;
  const snake = name.replace(/[^A-Za-z0-9]+/g, "_").replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return SENSITIVE_KEY.test(snake) || SENSITIVE_PASS_ANY_CASE.test(snake);
}

/**
 * Is a value glued to the separator inside this word (`token=S`, `a:b`)? Base64 padding is not one: `==` at the end of a key, or `=` or `==` followed only by delimiters (`--token abcJwtDef==, next`).
 */
function gluedValue(word: string): boolean {
  let end = word.length;
  while (end > 0 && ",;)]}".includes(word.charAt(end - 1))) end -= 1; // (a linear walk from the end: no unanchored run expression)
  let cut = word;
  if (end < word.length && word.charAt(end - 1) === "=") cut = `${word.slice(0, word.charAt(end - 2) === "=" ? end - 2 : end - 1)}=`;
  return /[:=][^:=]/.test(cut);
}

/**
 * Does `name` read as a NAME a person wrote (`apikey`, `DB_PASSWORD`, `X-Api-Key`, `clientSecret`, `token2`): up to 40 letters with `_`, `.` or `-`, at most three digits at the end, at most three
 * camel-case humps? A random key that merely holds a credential word as a camel-case segment (`LzoVnZg-qdh5H16SBqPw-da6Q3W...=`, a Fernet key, base64, 30 random letters and digits) is a VALUE, however
 * `isSensitiveName` reads it: a value that follows an option or a header label is hidden, never left to the reader of a "name" that is not one.
 */
function plausibleLabel(name: string, maxHumps = 3): boolean {
  if (name.length > 40 || !/^[A-Za-z_][A-Za-z_.-]*[0-9]{0,3}$/.test(name)) return false;
  return (name.match(/[a-z][A-Z]/g) ?? []).length <= maxHumps;
}

/**
 * A word after an option that reads as a credential's name and separator is left to that name's reader only when a value stands behind it: glued to the separator inside the word
 * (`token=S`), or after it on the same line and not another option (`apikey= S`, `PASSWORD = S`). With nothing behind it (the end of the text or of the line, `--verbose`) the
 * word IS the option's value.
 */
function valueBehindLabel(text: string, word: string, end: number): boolean {
  if (gluedValue(word)) return true; // (base64 padding, `==`, is not a value)
  let i = end;
  while (text.charAt(i) === " " || text.charAt(i) === "\t") i += 1;
  if (!/(?:[:=]|%3[AaDd])$/.test(word)) {
    if (text.charAt(i) === '"' || text.charAt(i) === "'") i += 1;
    if (text.charAt(i) !== ":" && text.charAt(i) !== "=") return true;
    i += 1;
    while (text.charAt(i) === " " || text.charAt(i) === "\t") i += 1;
  }
  const ch = text.charAt(i);
  return i < text.length && ch !== "\n" && ch !== "\r" && ch !== "-";
}

/** Does the word at `[at, to)` start with a credential's name and a separator (`Authorization=('S`, `PASSWD:{`)? Its own reader takes what follows. */
function startsWithCredentialLabel(text: string, at: number, to: number): boolean {
  const label = /^([A-Za-z_][A-Za-z0-9_.-]{0,60})[:=]/.exec(text.slice(at, to));
  return label !== null && plausibleLabel(label[1] as string) && isSensitiveName(label[1] as string);
}

function unquotedValueEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (isWhitespace(ch) || ch === '"' || ch === "'") break;
    if (ch === ";" || ch === ",") {
      NEXT_PAIR.lastIndex = i + 1;
      if (NEXT_PAIR.test(text)) break;
    } else if (i > start && "|)}]<&#".includes(ch) && credentialPairFollows(text, i + 1)) {
      // `PASSWORD=S1|AUTH_TOKEN='S2'`: the next pair names a credential. A delimiter in front of any other word and an equals sign is part of the
      // value (a secret may hold `&x=` or `#y=`), as it always was; so is one that starts the value (`#Sapikey=`).
      break;
    }
    if (ch === "\\" || ch === "%" || ch === "<") {
      // a line break written as text (`\n`, `%0A`) followed by the next `NAME=`: the value ends there (`DB_PASSWORD=S1\nAPI_TOKEN='S2'`);
      // so does a blank or a delimiter written as text or as a tag (`\t`, `%20`, `%7C`, `<br>`) in front of a credential's NAME=
      const breakLength = lineBreakLength(text, i);
      if (breakLength > 0) {
        NEXT_PAIR.lastIndex = i + breakLength;
        if (NEXT_PAIR.test(text)) break;
      } else {
        const gap = valueGapLength(text, i);
        if (gap > 0 && i > start && credentialPairFollows(text, i + gap)) break;
      }
    }
    i += 1;
  }
  tick(i - start + 1);
  return i;
}

/** The whole run of backslashes at `from`, however long, when a quote character follows it (0 when it does not). */
function backslashRun(text: string, from: number): number {
  let end = from;
  while (end < text.length && text.charCodeAt(end) === 92) end += 1;
  const after = text.charAt(end);
  return end > from && (after === '"' || after === "'") ? end - from : 0;
}

/**
 * A name that starts right after an ESCAPE that stands for a separator is a name of its own: in `a\npwd=S` (a backslash and an
 * `n`, as in a JSON-encoded log), `a%0Apwd=S`, `a%20auth: S` and `a\u000apwd=S` the letters in front of the keyword belong to the
 * escape, not to the name. Given where the leftward walk over name characters stopped (`at`), returns where the name really
 * starts. Same boundary set as the token layer (`NB`).
 */
function afterLeadingEscape(text: string, at: number): number {
  const before = text.charAt(at - 1);
  const c = text.charAt(at);
  if (before === "\\") {
    if (c !== "" && "nrtbfv".includes(c)) return at + 1;
    if (c === "u" && /^[0-9A-Fa-f]{4}$/.test(text.slice(at + 1, at + 5))) return at + 5;
    if (c === "x" && /^[0-9A-Fa-f]{2}$/.test(text.slice(at + 1, at + 3))) return at + 3;
  } else if (before === "%" && /^[0-9A-Fa-f]{2}$/.test(text.slice(at, at + 2))) {
    return at + 2;
  }
  return at;
}

/** A line break, real or written as text (`\n`, `\r\n`, `%0A`, `%0D%0A`, `\u000a`): matched at exactly one position. */
const LINE_BREAK_PLAIN = /\r\n|\n|\r|%0[Dd]%0[Aa]|%0[Aa]|%0[Dd]/y;
/** A tab or space written as text (`\t`, `%09`, `%20`); each layer of JSON string nesting doubles the backslashes. */
const INDENT_ESCAPE = /\\+t|%09|%20/y;

function lineBreakLength(text: string, at: number): number {
  if (text.charCodeAt(at) === 92) {
    // backslashes, then `n`, `r`, `r` + backslashes + `n`, or `u000A`/`u000D` (any number of backslashes: one scan of a run, see `backslashRunEnd`)
    const run = backslashRunEnd(text, at, 0);
    const c = text.charAt(run);
    if (c === "n") return run + 1 - at;
    if (c === "r") {
      if (text.charCodeAt(run + 1) === 92) {
        const again = backslashRunEnd(text, run + 1, 1);
        if (text.charAt(again) === "n") return again + 1 - at;
      }
      return run + 1 - at;
    }
    return c === "u" && /^000[AaDd]/.test(text.slice(run + 1, run + 5)) ? run + 5 - at : 0;
  }
  LINE_BREAK_PLAIN.lastIndex = at;
  const m = LINE_BREAK_PLAIN.exec(text);
  return m === null ? 0 : m[0].length;
}

/** Indentation after a YAML line break: spaces, tabs, and tabs or spaces written as text (`\t`, `%09`, `%20`). */
function skipIndent(text: string, from: number): number {
  let i = skipBlanks(text, from);
  for (let guard = 0; guard < MAX_BLANKS; guard += 1) {
    INDENT_ESCAPE.lastIndex = i;
    const m = INDENT_ESCAPE.exec(text);
    if (m === null) break;
    i = skipBlanks(text, i + m[0].length);
  }
  return i;
}

/**
 * Is a QUOTED value really the credential-named key of the NEXT pair (`"token":`)? A stray word that looks like an
 * assignment (`pass : "token": "abc"`) would otherwise swallow that key and leave its own value in the clear. ONLY a whole
 * name counts. (An unquoted value that ends in a colon is handled differently: it is redacted together with the word after
 * it, so a secret that happens to contain a credential word and a colon is never mistaken for a key.)
 */
function isNextKey(text: string, valueStart: number, valueEnd: number, closeLength: number): boolean {
  const i = skipBlanks(text, valueEnd + closeLength);
  if (valueEnd >= text.length || (text.charAt(i) !== ":" && text.charAt(i) !== "=")) return false;
  const candidate = text.slice(valueStart, valueEnd);
  return NAME_ONLY.test(candidate) && (STRONG_NAME.test(candidate) || isSensitiveName(candidate));
}

/**
 * `name=value`, `name: value`, `"name": "value"`, `'name': 'value'` and the same inside an escaped string (`\"name\": \"value\"`),
 * where the name is a credential name. The keyword is found by one forward regex scan; the name around it is at most 160
 * characters; blanks around the separator (and one line break after a colon) are skipped; the value is consumed once and
 * scanning resumes after it, so the cost is linear in the text.
 */
function redactAssignments(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  const keywords = fresh(ASSIGNMENT_KEYWORD);
  const budget = { left: text.length * 8 + 65536 };
  let match: RegExpExecArray | null;
  while ((match = keywords.exec(text)) !== null) {
    if (match.index < cursor) continue;
    let nameStart = match.index;
    const leftLimit = Math.max(cursor, match.index - NAME_LEFT);
    while (nameStart > leftLimit && NAME_CHAR.test(text.charAt(nameStart - 1))) nameStart -= 1;
    // `a\npwd=S`, `a%0Apwd=S`, `a%20auth: S`: the letters of an escape that stands for a separator are not part of the name.
    const afterEscape = afterLeadingEscape(text, nameStart);
    if (afterEscape <= match.index) nameStart = afterEscape;
    let nameEnd = match.index + match[0].length;
    const rightLimit = Math.min(text.length, nameEnd + NAME_RIGHT);
    while (nameEnd < rightLimit && NAME_CHAR.test(text.charAt(nameEnd))) nameEnd += 1;
    let i = nameEnd;
    // Closers of a key: a quote (also an escaped one) or a bracket, as in `"password"`, `\"password\"` and `user[password]`.
    for (let closers = 0; closers < 3; closers += 1) {
      const ch = text.charAt(i);
      if (ch === '"' || ch === "'" || ch === "]") i += 1;
      else if (ch === "\\") {
        const depth = backslashRun(text, i);
        if (depth === 0) break;
        i += depth + 1;
      } else break;
    }
    const sepStart = i;
    i = skipBlanks(text, i);
    let sep = text.charAt(i);
    let operator = 1;
    if ((sep === "?" || sep === "+" || sep === ":") && text.charAt(i + 1) === "=") {
      // `?=` and `+=` (make, shell) and `:=` (make, Go) assign like `=`; `:=` is never a YAML colon in front of a value that starts with `=`.
      sep = "=";
      operator = 2;
    } else if (sep === "=" && text.charAt(i + 1) === ">") {
      // `=>` (a hash rocket, as in Ruby, PHP and print_r) separates like `=`.
      operator = 2;
    }
    if (sep !== ":" && sep !== "=") {
      keywords.lastIndex = Math.max(keywords.lastIndex, sepStart);
      continue;
    }
    // Judge the name before measuring anything (a property, a line, a value): a run of `passed=passed=passed=...` or of `: &a Basic x` behind a name that is not a credential must not measure the rest of the text each time.
    const name = text.slice(nameStart, nameEnd);
    // `PASS=value` (an environment variable) is a password; as a KEY, "PASS" is the report's own status word.
    if (USAGE_COUNTER.test(name)) {
      keywords.lastIndex = Math.max(keywords.lastIndex, sepStart);
      continue;
    }
    if (!STRONG_NAME.test(name) && !isSensitiveName(name) && !(sep === "=" && name === "PASS")) {
      keywords.lastIndex = Math.max(keywords.lastIndex, sepStart);
      continue;
    }
    i = skipBlanks(text, i + operator);
    // a blank written as text between the separator and a quote (`db_password:%20"S"`, `secret=%09'S'`)
    INDENT_ESCAPE.lastIndex = i;
    const blankText = INDENT_ESCAPE.exec(text);
    if (blankText !== null && quoteFollows(text, i + blankText[0].length)) i = skipBlanks(text, i + blankText[0].length);
    let dashList = false;
    let crossed = false; // the value was looked for on the next line
    let blockEnd = -1; // the end of a YAML block scalar (`|` or `>`), else -1
    if (sep === ":") {
      // YAML style: the value is on the next line, indented. The line break may be written as text (`\n`, `%0A`) inside JSON.
      const breakLength = lineBreakLength(text, i);
      if (breakLength > 0) {
        crossed = true;
        i = skipBlankLines(text, i + breakLength, nameStart);
        // `password:\n  - S`: a YAML block list under a credential key; every item is a value.
        const item = dashItemStart(text, i);
        if (item > 0) {
          i = item;
          dashList = true;
        }
      }
      // An anchor or a tag in front of the value (`&a`, `!!str`), after which the value may follow on the next line, and a block
      // scalar (`|`, `>-`, `|2`): the value is the indented block on the lines below.
      // Only after a blank or a line break: a mapping colon is followed by one, so `password:&S` is a value, not an anchor.
      const propertyStart = i;
      if (i > skipBlanks(text, sepStart) + 1) i = skipProperties(text, i);
      const block = blockScalar(text, i);
      if (block !== undefined) {
        // behind an anchor or a tag the property is redacted with the block (`password: !S |`: a secret may start with `!` or `&`)
        i = i > propertyStart ? propertyStart : block[0];
        blockEnd = block[1];
      } else if (i > propertyStart) {
        // A property with no block scalar behind it is not skipped: a secret may start with `!` or `&`, so the whole line is the value,
        // and when the property ends its line and the value stands on an indented line below, that line too (more is redacted, never less).
        const below = endsWithBlank(text.slice(propertyStart, i));
        blockEnd = lineEnd(text, below ? i : propertyStart);
        blockEnd = throughNextLine(text, propertyStart, blockEnd); // a dangling `token:` at the end of that line hands over the next one
        i = propertyStart;
      }
    }
    // `b'S'`, `u'S'`, `r"S"`: a Python string prefix in front of the quote.
    if (blockEnd < 0) {
      PY_PREFIX.lastIndex = i;
      const prefix = PY_PREFIX.exec(text);
      if (prefix !== null) {
        // Only when the string closes on the same line: `b'` with no closing quote there is a word and a quote, not a quoted value.
        const opening = text.charAt(i + prefix[0].length);
        const from = i + prefix[0].length + 1;
        const close = opening === '"' || opening === "'" ? text.indexOf(opening, from) : -2;
        // ... and not an empty string. A string that is nothing but a name and a separator is a label only when a word stands glued behind its closing quote (`u"secret="S`:
        // the value is behind the quote); a padded base64 secret (`b'c2VjcmV0cGFzcw=='`, `b'S:'`) has that shape too, and is the value. What follows the closing quote does not matter otherwise
        // (`token=b'S'"`, `b'S'.decode()`, `b'S'| cat`): a closed string is redacted whatever is glued to it.
        const value = close > from ? text.slice(from, close) : "";
        // A quote with no closing quote on its line (none at all, or one on a later line) is unclosed: the value runs to the end of the line (`password=b'S` when a log is cut).
        if (close < 0 || (close > from && /[\r\n]/.test(text.slice(from, close))) || (close > from && !/[\r\n]/.test(text.slice(i, close)) && !(PREFIXED_LABEL.test(value) && /[A-Za-z0-9_]/.test(text.charAt(close + 1))))) i += prefix[0].length;
      }
    }
    let quote = "";
    let depth = 0; // how many backslashes escape the quote (0: a plain quote)
    if (blockEnd >= 0) {
      // the block is the value: no quote handling
    } else if (text.charAt(i) === '"' || text.charAt(i) === "'") {
      quote = text.charAt(i);
      i += 1;
    } else if (text.charAt(i) === "\\") {
      depth = backslashRun(text, i);
      if (depth > 0) {
        quote = text.charAt(i + depth);
        i += depth + 1;
      }
    }
    const closeLength = depth + 1;
    const valueStart = i;
    const isAuthorization = /authorization/i.test(match[0]) || /authorization/i.test(name);
    // An unquoted Authorization value is a scheme plus parameters (`Digest username="a", response="b"`): the whole line.
    // A bracketed list (`[a, b]`, `["a","b"]`) is one value: every element is a secret.
    let valueEnd =
      blockEnd >= 0
        ? blockEnd
        : quote !== ""
          ? quotedThroughNextLine(text, valueStart, quotedValueEnd(text, valueStart, quote, depth), quote, depth)
          : isAuthorization && !text.startsWith(REDACTED, valueStart)
            ? authorizationValueEnd(text, valueStart, budget)
            : crossed && text.charAt(valueStart) === "#"
              ? hashValueEnd(text, valueStart, nameStart) // a value line that starts with `#` is the value, not a comment (it is deeper than the key, or no indented line follows it)
              : "[{(".includes(text.charAt(valueStart)) && valueStart < text.length
                ? throughNextLine(text, valueStart, containerValueEnd(text, valueStart, budget))
                : unquotedValueEnd(text, valueStart);
    if (valueEnd === valueStart) {
      keywords.lastIndex = Math.max(keywords.lastIndex, valueStart);
      continue;
    }
    if (blockEnd < 0 && quote === "" && !isAuthorization && SCHEME_WORD.test(text.slice(valueStart, valueEnd))) {
      // `token: Bearer S`: a scheme word takes the credential after it (unless the next word is another credential's name and separator)
      const schemeAfter = skipBlanks(text, valueEnd);
      const schemeEnd = unquotedValueEnd(text, schemeAfter);
      if (!startsWithCredentialLabel(text, schemeAfter, schemeEnd)) valueEnd = Math.max(valueEnd, schemeEnd);
    }
    if (blockEnd < 0 && quote === "" && !isAuthorization && /^(?:\\+)?["'][:=]/.test(text.slice(valueEnd, valueEnd + 6))) {
      // the "value" ends in the name of another credential inside a quoted key (`Bearer=auth":S`, `Bearer=-auth":S`): the name is left for its own
      // match, and what stands in front of it is this value
      const keyTail = /([A-Za-z][A-Za-z0-9_.-]{0,60})$/.exec(stripTrailingBackslashes(text.slice(valueStart, valueEnd)));
      if (keyTail !== null && isSensitiveName(keyTail[1] as string)) {
        if (keyTail.index === 0) {
          keywords.lastIndex = valueStart;
          continue;
        }
        valueEnd = valueStart + keyTail.index;
      }
    }
    if (blockEnd < 0 && quote === "" && !isAuthorization && /[:=](?:\\+[nr]|%0[AaDd])*$/.test(text.slice(Math.max(valueStart, valueEnd - 24), valueEnd))) {
      // The "value" is the name of another credential and its separator, and a quoted value follows it (`auth:` then `password: "S"`,
      // `hmacKey+=stripeKey="S"`, `token?=apikey:"S"`): the name is left for its own match, which reads the quoted value, instead of
      // eating the name and leaving the value behind. So is the name of a credential whose value stands on the next line
      // (`credentials:` then `password:` then `S`; the line break may be written as text).
      const word = text.slice(valueStart, valueEnd);
      const label = stripTrailingBreakEscapes(word, false);
      const named = /([A-Za-z][A-Za-z0-9_.-]{0,60})[:=]$/.exec(label);
      const handOver =
        named !== null &&
        plausibleLabel(named[1] as string) &&
        isSensitiveName(named[1] as string) &&
        // (a quote behind the word that is the quote the key stands in (`-H 'X-Api-Key: V='`) CLOSES that string: it does not open the value of a name)
        ((quoteFollows(text, valueEnd) && text.charAt(valueEnd) !== text.charAt(nameStart - 1)) ||
          (named.index === 0 &&
            /(?:^|[_.-])(?:passwords?|passwd|pwd|passphrase|secrets?|tokens?|apikey|credentials?|auth|authorization|keys?)$/i.test((named[1] as string).replace(/([a-z0-9])([A-Z])/g, "$1_$2")) &&
            (crossed || label !== word || lineBreakLength(text, skipBlanks(text, valueEnd)) > 0)));
      if (handOver && named.index === 0) {
        keywords.lastIndex = valueStart;
        continue;
      }
      if (handOver) {
        valueEnd = valueStart + named.index; // `Bearer=-auth:"S"`: what stands in front of the credential's name is this value
      } else if (word.endsWith(":") || (word.endsWith("=") && plausibleLabel(label.slice(0, -1), 0) && isSensitiveName(label.slice(0, -1)))) {
        // `password=mysecret: rest`, or a stray `pass : token: abc`: a value that ends in a colon may be a secret followed by
        // its own value or a label followed by the real secret; either way the next word (or, at the end of the line, the first word of the
        // next line) is redacted with it (never left). So is a credential's name and an equals sign (`Bearer:auth= S`).
        // The one exception is the header name itself (`pass : Authorization: Digest ...`): it is left for its own match, which
        // redacts the whole header line, instead of eating "Authorization:" and one word and leaving the parameters behind.
        if (/^(?:[A-Za-z]+-)?authorization[:=]$/i.test(word)) {
          keywords.lastIndex = valueStart;
          continue;
        }
        const after = skipBlanks(text, valueEnd);
        const c = text.charAt(after);
        if (after < text.length && c !== "\n" && c !== "\r") {
          const nextEnd = unquotedValueEnd(text, after);
          // ... unless that word is itself a credential's name and separator (`passwd=passwd= TOKEN="S"`, `apikey=Basic PASSWD:{"S`)
          if (!startsWithCredentialLabel(text, after, nextEnd)) valueEnd = nextEnd;
        } else valueEnd = throughNextLine(text, valueStart, valueEnd);
      }
    }
    if (quote !== "" && isNextKey(text, valueStart, valueEnd, closeLength)) {
      // `pass : "token": "abc"`: the "value" is the key of the next pair. Leave it and look at that pair instead.
      keywords.lastIndex = valueStart;
      continue;
    }
    parts.push(text.slice(cursor, valueStart), REDACTED);
    cursor = valueEnd;
    // The other items of the same block list (`- a`, `- b`).
    while (dashList) {
      // (An escaped line break can be inside the value just read, so the next item may follow on blanks alone.)
      const start = dashItemStart(text, skipBlankLines(text, cursor + lineBreakLength(text, cursor)));
      if (start === 0) break;
      const [itemStart, itemEnd] = itemValue(text, start, budget);
      if (itemEnd === itemStart) break;
      parts.push(text.slice(cursor, itemStart), REDACTED);
      cursor = itemEnd;
    }
    keywords.lastIndex = cursor;
  }
  return parts.length === 0 ? text : parts.join("") + text.slice(cursor);
}

/** A YAML anchor or tag: `&a`, `!!str`, `!local`, `!<tag:yaml.org,2002:str>`. */
const YAML_PROPERTY = /(?:&[^\s"',[\]{}]+|!<[^>\s]*>|![^\s"',[\]{}]*)/y;
/** The header of a block scalar: `|` or `>` with a chomping indicator and/or an indentation digit (`|-`, `>+`, `|2`, `>2-`). */
const BLOCK_HEADER = /[|>](?:[1-9][+-]?|[+-][1-9]?)?/y;

/** Skips anchors and tags in front of a value, then the line break (and indentation) when the value follows on the next line. */
function skipProperties(text: string, from: number): number {
  let i = from;
  let seen = false;
  for (let count = 0; count < 4; count += 1) {
    YAML_PROPERTY.lastIndex = i;
    const m = YAML_PROPERTY.exec(text);
    if (m === null || m[0].length === 0) break;
    seen = true;
    i = skipBlanks(text, i + m[0].length);
  }
  if (!seen) return from;
  const breakLength = lineBreakLength(text, i);
  return breakLength > 0 ? skipIndent(text, i + breakLength) : i;
}

/** Index of the next line break, real or written as text, at or after `from` (the text length when there is none); linear. */
function nextBreak(text: string, from: number): number {
  const n = text.length;
  let i = from;
  while (i < n) {
    const ch = text.charAt(i);
    if (ch === "\\") {
      let j = i + 1;
      while (j < n && text.charCodeAt(j) === 92) j += 1;
      if (lineBreakLength(text, i) > 0) return i;
      i = j;
      continue;
    }
    if ((ch === "\n" || ch === "\r" || ch === "%") && lineBreakLength(text, i) > 0) return i;
    i += 1;
  }
  return n;
}

/**
 * A YAML block scalar (`|`, `>`, with chomping and indentation indicators, and an optional comment) that starts at `at`:
 * `[start, end)` of its indented block, or undefined when no block scalar stands there. The block runs while lines are indented
 * at least as far as the first one (blank lines belong to it); with an explicit indentation digit any indented line belongs to
 * it. A first line with no indentation cannot be told from the next key: the value then runs to the end of the text (more is
 * redacted, never less). Line breaks written as text (`\n`, `%0A`) count as line breaks, at any nesting depth.
 */
function blockScalar(text: string, at: number): [number, number] | undefined {
  BLOCK_HEADER.lastIndex = at;
  const header = BLOCK_HEADER.exec(text);
  if (header === null) return undefined;
  let i = skipBlanks(text, at + header[0].length);
  if (text.charAt(i) === "#") {
    // a comment after the header needs a blank in front of it: `>#x` is a value, not a header
    if (i === at + header[0].length) return undefined;
    i = nextBreak(text, i);
  }
  const headerBreak = lineBreakLength(text, i);
  if (headerBreak === 0) return undefined;
  let indent = /[1-9]/.test(header[0]) ? 1 : -1;
  let cursor = i + headerBreak;
  let start = -1;
  let end = -1;
  while (cursor < text.length) {
    const contentStart = skipIndent(text, cursor);
    const blank = lineBreakLength(text, contentStart);
    if (blank > 0) {
      cursor = contentStart + blank;
      continue;
    }
    if (contentStart >= text.length) break;
    const width = contentStart - cursor;
    if (indent < 0) {
      if (width === 0) return [cursor, text.length];
      indent = width;
    }
    if (width < indent) break;
    if (start < 0) start = contentStart;
    end = nextBreak(text, contentStart);
    if (end >= text.length) break;
    cursor = end + lineBreakLength(text, end);
  }
  return start < 0 ? undefined : [start, end];
}

/** A string that is a name and a separator and nothing else (`secret=`, `Authorization:`, and, by accident, a padded base64 secret). */
const PREFIXED_LABEL = /^\s*[A-Za-z][A-Za-z0-9_.-]{0,60}["']?\s*[:=][>=]?\s*$/;

/**
 * A string prefix in front of a quote: Python (`b`, `u`, `r`, `br`) and shell (`$'`), in front of a quote or a backslash; and, in front of a quote or of backslashes and a quote only (a value `f`
 * or `e` followed by a backslash and an `n` is a word and a line break, not a prefix): Python's `f`, `fr`, `rf`, SQL's `N'`, `E'`, `X'`, `U&'`.
 */
const PY_PREFIX = /(?:(?:[bBuUrR]{1,2}|\$)(?=['"\\])|(?:[fF][rR]?|[rR][fF]|[NEX]|[uU]&)(?=['"]|\\+['"]))/y;

/**
 * The indentation (in characters) of the line on which a key starts at `at`: the blanks between the last line break (real or written as text) and the key, which may be quoted.
 * A list dash and its blank in front of the key (`- password:`, `- - password:`) count as indentation: the key starts where the dash's item starts. `undefined` when something else stands in
 * front of the key on its line (`{password:`, `a: password:`), when the break is not within 12 characters of a blank-only walk, or when the walk is long.
 */
function keyLineIndent(text: string, at: number): number | undefined {
  let i = at;
  if (i > 0 && (text.charAt(i - 1) === '"' || text.charAt(i - 1) === "'")) i -= 1;
  for (let steps = 0; steps < MAX_BLANKS; steps += 1) {
    for (let k = 1; k <= 12 && k <= i; k += 1) if (lineBreakLength(text, i - k) === k) return at - i;
    if (i === 0) return at;
    const ch = text.charAt(i - 1);
    const dash = ch === "-" && (text.charAt(i) === " " || text.charAt(i) === "\t");
    if (ch !== " " && ch !== "\t" && !dash) return undefined;
    i -= 1;
  }
  return undefined;
}

/**
 * Skips blank lines and comment lines after a key (`password:` then an empty line, a `# note`, then the value); at most 64. `lineStart` is the start of the line that follows the key's
 * line break; `keyStart` (the start of the key's name) lets it judge a `#` line against the key's indentation: a `#` line indented DEEPER than the key is the value itself (YAML
 * makes it a comment only at the column of the key or to its left, and a password may start with `#`), so the scan stops on it.
 */
function skipBlankLines(text: string, lineStart: number, keyStart?: number): number {
  let start = lineStart;
  let i = skipIndent(text, start);
  for (let guard = 0; guard < MAX_BLANKS; guard += 1) {
    if (text.charAt(i) === "#") {
      if (keyStart !== undefined) {
        const indent = keyLineIndent(text, keyStart);
        if (indent !== undefined && i - start > indent) return i;
      }
      // a comment line, unless no indented line follows it: then it is the value itself (a password may start with `#`)
      const commentEnd = nextBreak(text, i);
      let next = commentEnd + lineBreakLength(text, commentEnd);
      for (let blanks = 0; blanks < MAX_BLANKS; blanks += 1) {
        const content = skipIndent(text, next);
        const blank = lineBreakLength(text, content);
        if (blank === 0) break;
        next = content + blank;
      }
      const content = skipIndent(text, next);
      if (content >= text.length || content === next) return i; // nothing indented follows (whitespace alone does not count)
      i = commentEnd;
    }
    const breakLength = lineBreakLength(text, i);
    if (breakLength === 0) break;
    start = i + breakLength;
    i = skipIndent(text, start);
  }
  return i;
}

/**
 * The end of a value that is a `#` line under a key (see `skipBlankLines`): that line, and, when it is indented deeper than the key, the lines below it that are indented deeper than the key too
 * (a plain scalar goes on over them; more is redacted, never less). A `#` line that is not deeper than the key ends with its own line.
 */
function hashValueEnd(text: string, at: number, keyStart: number): number {
  let end = lineEnd(text, at);
  const keyIndent = keyLineIndent(text, keyStart);
  const hashIndent = keyLineIndent(text, at);
  if (keyIndent === undefined || hashIndent === undefined || hashIndent <= keyIndent) return end;
  for (let lines = 0; lines < MAX_BLANKS; lines += 1) {
    const breakLength = lineBreakLength(text, end);
    if (breakLength === 0) break;
    const start = end + breakLength;
    const content = skipIndent(text, start);
    if (content >= text.length || lineBreakLength(text, content) > 0 || content - start <= keyIndent) break;
    end = lineEnd(text, content);
  }
  return end;
}

/** Start of the value of a YAML block-list item (`- S`) at `at`, or 0 when no list dash stands there. */
function dashItemStart(text: string, at: number): number {
  const next = text.charAt(at + 1);
  return text.charAt(at) === "-" && (next === " " || next === "\t") ? skipBlanks(text, at + 1) : 0;
}

/**
 * End (exclusive) of a bracketed list value that opens at `open`: `[a, b]` in YAML, `["a","b"]` in JSON, also as text inside a
 * JSON string (the run of backslashes in front of the first quote says how the quotes are written). Brackets inside strings do not
 * count. A list that never closes runs to the end of the line, or of the text: more is redacted, never less.
 */
function listEnd(text: string, open: number, budget: { left: number }): number {
  return containerEnd(text, open, "[", "]", budget);
}

/**
 * The same for any bracket pair (`[`...`]`, `{`...`}`): brackets inside strings do not count, nested ones do, and the pair may
 * span lines (a multi-line flow list). The work of one scan is capped by `budget` (linear overall); a pair that never closes, or
 * that runs out of budget, ends at the end of its first line, or at the end of the text when it has no line break.
 */
function containerEnd(text: string, open: number, openCh: string, closeCh: string, budget: { left: number }): number {
  const n = text.length;
  const r = backslashRun(text, skipBlanks(text, open + 1));
  let depth = 1;
  let quote = ""; // the quote character of the string being read, or "" outside strings
  let firstBreak = -1;
  let i = open + 1;
  while (i < n && budget.left > 0) {
    budget.left -= 1;
    const ch = text.charAt(i);
    if (ch === "\n" || ch === "\r") {
      if (firstBreak < 0) firstBreak = i;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      let j = i + 1;
      while (j < n && text.charCodeAt(j) === 92) j += 1;
      if (text.charAt(j) === '"') {
        if (r > 0 && j - i === r) quote = quote === "" ? '"' : "";
        i = j + 1;
      } else {
        i = j;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && r === 0) {
      if (quote === "") quote = ch;
      else if (quote === ch) quote = "";
    } else if (quote === "" && ch === openCh) depth += 1;
    else if (quote === "" && ch === closeCh) {
      depth -= 1;
      if (depth === 0) {
        tick(i - open + 1);
        return i + 1;
      }
    }
    i += 1;
  }
  tick(i - open + 1);
  return firstBreak >= 0 ? firstBreak : n;
}

/** Start and end of the value of a further list item that begins at `start`: quoted (plain or escaped), a list, or a word. */
function itemValue(text: string, start: number, budget: { left: number }): [number, number] {
  const ch = text.charAt(start);
  if (ch === '"' || ch === "'") return [start + 1, quotedValueEnd(text, start + 1, ch, 0)];
  const run = backslashRun(text, start);
  if (run > 0) return [start + run + 1, quotedValueEnd(text, start + run + 1, text.charAt(start + run), run)];
  if (ch === "[") return [start, listEnd(text, start, budget)];
  return [start, unquotedValueEnd(text, start)];
}

const PRIVATE_KEY_BEGIN = /-----BEGIN (?:[A-Z]+ ){0,4}PRIVATE KEY(?: BLOCK)?-----/g;

/**
 * PEM and PGP private-key blocks of any length. Each header consumes everything up to its `-----END ...-----` line (or to
 * the end of the text when there is none), and scanning resumes after the consumed part, so a hostile text made of
 * repeated headers costs one pass, not one pass per header.
 */
function redactPrivateKeys(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  const opener = fresh(PRIVATE_KEY_BEGIN);
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text)) !== null) {
    const bodyStart = match.index + match[0].length;
    const endMarker = text.indexOf("-----END ", bodyStart);
    let end = text.length;
    if (endMarker !== -1) {
      const close = text.indexOf("-----", endMarker + 9);
      end = close === -1 ? text.length : close + 5;
    }
    parts.push(text.slice(cursor, match.index), REDACTED);
    cursor = end;
    opener.lastIndex = end;
  }
  return parts.length === 0 ? text : parts.join("") + text.slice(cursor);
}

const STEPS: Step[] = [
  { name: "private-key-block", credential: true, prefilter: ["-----BEGIN"], apply: redactPrivateKeys },
  ...TOKEN_LIKE,
  // ["--password", "S"], [["password", "S"]]: a list element that names a credential, then its value.
  { name: "list-pair", credential: true, prefilter: [","], apply: redactListPairs },
  {
    name: "assignment",
    credential: true,
    prefilter: [
      "password", "passwd", "passphrase", "pwd", "pass", "secret", "token", "api_key", "api-key", "apikey", "access_key", "access-key", "accesskey",
      "account_key", "account-key", "accountkey", "sharedaccesssignature", "shared_access_signature", "shared-access-signature", "authorization", "auth",
      "credential", "private_key", "private-key", "privatekey", "session_id", "session-id", "sessionid",
      "passcode", "ssh_key", "ssh-key", "sshkey", "connection_string", "connection-string", "connectionstring", "cookie", "signing_key",
      "signing-key", "signingkey", "encryption_key", "encryption-key", "encryptionkey", "master_key", "master-key", "masterkey", "bearer", "jwt", "dsn",
      "webhook", "url", "uri", "key", "pswd", "pw", "mnemonic", "rsa",
    ],
    insensitive: true,
    apply: redactAssignments,
  },
  regexStep("email", /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}(?![A-Za-z0-9-])/g, REDACTED, ["@"], false),
];

function shouldRun(step: Step, text: string, lower: () => string): boolean {
  const haystack = step.insensitive === true ? lower() : text;
  for (const needle of step.prefilter) {
    if (haystack.includes(step.insensitive === true ? needle.toLowerCase() : needle)) return true;
  }
  return false;
}

/**
 * Percent escapes of the characters that separate a name from its value: `%3D` (=), `%3A` (:), `%22` and `%27` (quotes), `%40` (@),
 * `%20` (space), `%2F` (/), `%26` (&), `%3B` (;), `%2C` (,), braces, brackets, line breaks and tab, and `%25` (%) when two hex
 * digits follow (so `%253D` is one level of encoding deeper than `%3D`). Only these are decoded: ordinary text keeps its escapes.
 */
const SEPARATOR_ESCAPE = /%(?:3[A-Fa-f]|2[0-46-9A-Fa-f]|40|7[BbCcDd]|5[BbCcDdFf]|0[AaDd9]|25(?=[0-9A-Fa-f]{2}))/g;
/** How many levels of percent-encoding are undone; a separator encoded more deeply than this is not read (a documented limit). */
const MAX_PERCENT_LEVELS = 3;

function decodeSeparators(text: string): string {
  let current = text;
  for (let level = 0; level < MAX_PERCENT_LEVELS; level += 1) {
    const next = current.replace(SEPARATOR_ESCAPE, (escape) => String.fromCharCode(Number.parseInt(escape.slice(1), 16)));
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * The steps on the text as written, then, when it holds percent escapes of separators, on a copy with those escapes decoded:
 * `password%3DS`, `Authorization%3A%20Bearer%20S`, `https%3A%2F%2Fu%3AS%40host`. The decoded form is what is returned when
 * (and only when) it revealed a credential, so text that names none is returned as written; nothing is ever mapped back onto
 * the original, so no tail of an encoded secret can be left. The copy is never longer than its input (decoding shortens), and the
 * input is capped, so the cost is bounded and linear.
 */
function redactPlain(input: string): string {
  const direct = redactSteps(input);
  if (!direct.includes("%")) return direct;
  const decoded = decodeSeparators(direct);
  if (decoded === direct) return direct;
  const viaDecoded = redactSteps(decoded);
  return viaDecoded === decoded ? direct : viaDecoded;
}

function redactSteps(input: string): string {
  let out = input;
  let lowered: string | undefined;
  const lower = (): string => (lowered ??= out.toLowerCase());
  for (const step of STEPS) {
    if (!shouldRun(step, out, lower)) continue;
    const next = step.apply(out);
    if (next !== out) {
      out = next;
      lowered = undefined;
    }
  }
  return out;
}

/* --------------------------------------------------------------------------------------------------- folding */

/**
 * Characters that can be used to split a token so that it does not match as written: soft hyphen, combining grapheme
 * joiner, Arabic letter mark, Mongolian vowel separator, zero-width and directional marks, line/paragraph separators and
 * embedding controls, invisible operators, BOM. The numeric ranges are the ones a reader knows by name; the class ALSO holds every
 * code point the Unicode standard marks default-ignorable (variation selectors, tag characters, Hangul fillers, the reserved
 * invisible blocks) and every format character: with only a hand-picked list 4,186 of 4,206 such code points split `ghp_` unredacted.
 * Written as numeric ranges and property escapes, so no invisible character appears in this source file.
 */
const HIDING = charClassRegex(
  [[0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff]],
  "gu",
  "\\p{Default_Ignorable_Code_Point}\\p{Cf}",
);

/**
 * Characters that must stay attached to the one before them when normalising: combining marks and the Hangul jamo blocks
 * (which compose across characters). A chunk is only cut in front of some other character, where NFKC of the pieces
 * equals NFKC of the whole; surrogates are excluded so that a pair is never split.
 */
const JOINS_PREVIOUS = charClassRegex([[0x1100, 0x11ff], [0x3130, 0x318f], [0xa960, 0xa97f], [0xd7b0, 0xd7ff], [0xd800, 0xdfff]], "u", "\\p{M}");

const FOLD_CHUNK = 64 * 1024;
const FOLD_CUT_SEARCH = 1024;
/** Folded code units examined for one string before it is declared unexaminable (a code point can normalise to 18). */
const FOLD_SCAN_BUDGET = 32 * 1024 * 1024;
/** Largest folded text that is materialised as the redacted output of a string that hid a credential. */
const FOLD_OUTPUT_BUDGET = 8 * 1024 * 1024;
const FOLD_CARRY = 64 * 1024;

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) > 0x7f) return true;
  return false;
}

function cutPoint(text: string, from: number): number {
  const target = from + FOLD_CHUNK;
  if (target >= text.length) return text.length;
  const limit = Math.min(text.length, target + FOLD_CUT_SEARCH);
  for (let p = target; p < limit; p += 1) {
    if (text.charCodeAt(p) < 0x80 || !JOINS_PREVIOUS.test(text.charAt(p))) return p;
  }
  // No safe point nearby (a hostile run of combining marks): cut anyway, but never inside a surrogate pair.
  const low = text.charCodeAt(target);
  return low >= 0xdc00 && low <= 0xdfff ? target - 1 : target;
}

function* foldedChunks(text: string): Generator<string> {
  let from = 0;
  while (from < text.length) {
    const to = cutPoint(text, from);
    yield text.slice(from, to).replace(HIDING, "").normalize("NFKC");
    from = to;
  }
}

/** The folded (hiding characters removed, NFKC) form of `text`, or undefined when it would be longer than `budget` code units. */
function foldString(text: string, budget: number): string | undefined {
  if (text.length <= FOLD_CHUNK) {
    const folded = text.replace(HIDING, "").normalize("NFKC");
    return folded.length > budget ? undefined : folded;
  }
  const parts: string[] = [];
  let total = 0;
  for (const chunk of foldedChunks(text)) {
    total += chunk.length;
    if (total > budget) return undefined;
    parts.push(chunk);
  }
  return parts.join("");
}

const UNEXAMINABLE = Symbol("unexaminable");

/**
 * Run `probe` over the folded form of `text` and return the first result it gives (undefined when it never gives one, or
 * UNEXAMINABLE when the folded text is over budget). The folded text is examined chunk by chunk, each chunk joined to the tail
 * of the one before it so that a token cut by a chunk boundary is still seen, and is never held whole.
 */
function probeFolded<T>(text: string, probe: (window: string) => T | undefined): T | typeof UNEXAMINABLE | undefined {
  let carry = "";
  let total = 0;
  for (const chunk of foldedChunks(text)) {
    total += chunk.length;
    if (total > FOLD_SCAN_BUDGET) return UNEXAMINABLE;
    const window = carry + chunk;
    const found = probe(window);
    if (found !== undefined) return found;
    carry = window.length > FOLD_CARRY ? window.slice(window.length - FOLD_CARRY) : window;
  }
  return undefined;
}

/**
 * The longest string (and key) that is redacted piece by piece. A longer one is replaced by `[REDACTED]` as a whole: no
 * receipt field, requirement title, command or error message is legitimately millions of characters long, and a text of
 * 23 MB made of `token=a token=a ...` or `a@b.c a@b.c ...` needs more memory for its millions of matches than the documented
 * 256 MB heap has, so the process died with an abort instead of exit 2.
 */
export const MAX_REDACT_STRING = 4 * 1024 * 1024;
/** Passes over one string until it stops changing; a string that has not settled by then is replaced whole. */
const MAX_REDACT_ROUNDS = 6;

/**
 * Redact one string. The result is a FIXED POINT: `redactString(redactString(x)) === redactString(x)` always, because the
 * passes repeat until the text stops changing (and a text that does not settle is replaced whole). Idempotence matters
 * beyond tidiness: a bundle restores by redacting the stored documents again and comparing, so a receipt that a second
 * pass would still change made a backup that could be written but never verified or restored.
 */
export function redactString(input: string): string {
  return redactStringWithWorkLimit(input, WORK_PER_CHAR * input.length + WORK_BASE);
}

/** `redactString` with the work budget set to `limit` counted steps (the tests that prove the budget fails closed use a tiny one: the whole text is hidden). */
export function redactStringWithWorkLimit(input: string, limit: number): string {
  if (input.length > MAX_REDACT_STRING) return REDACTED;
  return withWorkBudget(limit, () => redactRounds(input), () => REDACTED);
}

function redactRounds(input: string): string {
  let current = redactOnce(input);
  if (current === input) return current;
  for (let round = 0; round < MAX_REDACT_ROUNDS; round += 1) {
    const next = redactOnce(current);
    if (next === current) return current;
    current = next;
  }
  return REDACTED;
}

function redactOnce(input: string): string {
  const direct = redactPlain(input);
  if (!hasNonAscii(input)) return direct;
  // A credential written with zero-width characters inside it, or in fullwidth letters, does not match as written.
  const hidden = probeFolded(input, (window) => (redactPlain(window) !== window ? true : undefined));
  if (hidden === undefined) return direct;
  if (hidden === UNEXAMINABLE) return REDACTED;
  const folded = foldString(input, FOLD_OUTPUT_BUDGET);
  if (folded === undefined) return REDACTED;
  return folded === input ? direct : redactPlain(folded);
}

/* --------------------------------------------------------------------------------------------- deep redaction */

const MAX_REDACT_DEPTH = 64;

/** Deep-redact any JSON-like value (object keys included). Returns a new structure; the input is never mutated. */
export function redactValue<T>(value: T): T {
  return redactInner(value, 0) as T;
}

/** The label of a pair or a list element: a plain name (`DB_PASSWORD`, `--password`, `Authorization`), not a sentence. */
const LABEL_SHAPE = /^-{0,2}[A-Za-z0-9_.:/-]{1,80}$/;
const NAME_LIKE_KEY = /^(?:name|key|header|parameter_?key|parameter_?name|variable)$/i;
const VALUE_LIKE_KEY = /^(?:value|parameter_?value)$/i;
/** The name of a session cookie (`session`, `sid`, `PHPSESSID`, `connect.sid`, `laravel_session`): the pair `{"name": "sid", "value": ...}` holds a credential. */
const COOKIE_NAME = /^(?:.*[_.-])?(?:session|sess|sid|sessid|phpsessid|csrf|xsrf)$/i;

/**
 * Does this label name a credential, as written OR once redacted? Both matter: `pass<token>` is not a credential name as
 * written but is after redaction turns it into `pass[REDACTED]`, and a second pass (a bundle is restored by redacting again)
 * must not reach a different answer than the first. This is the strict form, for the elements of a list (`["--password", "S"]`).
 */
function namesCredential(label: string): boolean {
  if (!LABEL_SHAPE.test(label)) return false;
  return isSensitiveKey(label) || isSensitiveKey(redactString(label)) || COOKIE_NAME.test(label);
}

/** The label of a name/value pair may be any single line of up to this many characters (`Admin password`, `${DB_PASSWORD}`, a long SSM path). */
const PAIR_LABEL_MAX = 1100;

function namesPairLabel(label: string): boolean {
  if (label.length === 0 || label.length > PAIR_LABEL_MAX || /[\r\n]/.test(label)) return false;
  return isSensitiveKey(label) || isSensitiveKey(redactString(label)) || COOKIE_NAME.test(label);
}

/**
 * `{"name": "DB_PASSWORD", "value": "..."}` written as TEXT (a JSON document inside a JSON string, at any depth). The pair is
 * found by a regex that captures the run of backslashes in front of the quotes and demands the same run everywhere (a start
 * only where a run begins, so a long run costs one look), and the value is delimited by the layer arithmetic of `quotedValueEnd`.
 * The regex is only a pattern: every scan makes its own copy (`fresh`), because judging a label redacts it, which runs this scanner again.
 */
const NAME_KEY_OPEN = /(?<!\\)(\\*)(["'])(?:name|key|header|parameter_?key|parameter_?name|variable)\1\2\s{0,64}:\s{0,64}\1\2((?:(?!\2)[^\\\r\n]){1,1100})\1\2/gi;
/** How far from the name key the value key is looked for (other keys, `Type` or `valueFrom`, may stand between). */
const PAIR_WINDOW = 4096;
const valueKeySources = new Map<string, string>();
/** The window grows with the escape overhead of the layer: each quote carries `r` backslashes, and a gap holds several. */
const pairWindow = (r: number): number => PAIR_WINDOW + 16 * (r + 1);

/** The opening of a `"value":` (or `parameter_value`, or the same in single quotes) whose quotes carry exactly `run` backslashes; a private regex each time. */
function valueKeyOpen(run: number, q: string): RegExp {
  const id = `${run}${q}`;
  let source = valueKeySources.get(id);
  if (source === undefined) {
    const slashes = run === 0 ? "" : `\\\\{${run}}`;
    source = `(?<!\\\\)${slashes}${q}(?:value|parameter_?value)${slashes}${q}\\s{0,64}:\\s{0,64}`;
    if (valueKeySources.size >= 64) valueKeySources.clear();
    valueKeySources.set(id, source);
  }
  return new RegExp(source, "gi");
}

/**
 * Does the text between `from` and `to` leave the object that holds both keys? A `}` outside strings that has no `{` of its own in the
 * gap closes that object, and a `{` that is never closed in the gap opens another one; a nested object in the gap (`valueFrom`) is fine.
 * `r` backslashes stand in front of the quotes `q`.
 */
function crossesObject(text: string, from: number, to: number, r: number, q: string): boolean {
  let inString = false;
  let depth = 0;
  let i = from;
  while (i < to) {
    const ch = text.charAt(i);
    if (ch === "\\") {
      let j = i + 1;
      while (j < to && text.charCodeAt(j) === 92) j += 1;
      if (text.charAt(j) === q) {
        if (j - i === r) inString = !inString;
        i = j + 1;
      } else {
        i = j;
      }
      continue;
    }
    if (ch === q && r === 0) inString = !inString;
    else if (!inString && ch === "{") depth += 1;
    else if (!inString && ch === "}") {
      if (depth === 0) return true;
      depth -= 1;
    }
    i += 1;
  }
  return depth !== 0;
}

/**
 * The value a `"value":` key holds, starting at `at`: `[start, end, closingLength]` to redact. A string is delimited by the layer
 * arithmetic; an object or an array is taken whole; anything else (a number, `true`, a bare word) runs to the next delimiter.
 */
function pairValueSpan(text: string, at: number, r: number, q: string, budget: { left: number }): [number, number, number] | undefined {
  const run = backslashRun(text, at);
  if (run === r && text.charAt(at + run) === q) {
    const start = at + run + 1;
    return [start, quotedValueEnd(text, start, q, r), r + 1];
  }
  const ch = text.charAt(at);
  if (ch === "{") return [at, containerEnd(text, at, "{", "}", budget), 0];
  if (ch === "[") return [at, containerEnd(text, at, "[", "]", budget), 0];
  let end = at;
  while (end < text.length && !",}]".includes(text.charAt(end)) && !isWhitespace(text.charAt(end))) end += 1;
  return end > at ? [at, end, 0] : undefined;
}

/** Replace the given [start, end) spans (any order, may overlap) by the placeholder. */
function redactSpans(text: string, spans: Array<[number, number]>): string {
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0]);
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start < cursor) {
      cursor = Math.max(cursor, end);
      continue;
    }
    parts.push(text.slice(cursor, start), REDACTED);
    cursor = end;
  }
  return parts.join("") + text.slice(cursor);
}

function redactNameValuePairs(text: string): string {
  const spans: Array<[number, number]> = [];
  let covered = 0;
  const opener = fresh(NAME_KEY_OPEN);
  const budget = { left: text.length * 8 + 65536 };
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text)) !== null) {
    if (match.index < covered || !namesPairLabel(match[3] as string)) continue;
    const r = (match[1] as string).length;
    const q = match[2] as string;
    const after = match.index + match[0].length;
    // The value key after the name (`{"name": N, "Type": T, "value": V}`), in the same object.
    const ahead = valueKeyOpen(r, q).exec(text.slice(after, after + pairWindow(r)));
    if (ahead !== null && !crossesObject(text, after, after + ahead.index, r, q)) {
      const span = pairValueSpan(text, after + ahead.index + ahead[0].length, r, q, budget);
      if (span !== undefined) {
        spans.push([span[0], span[1]]);
        covered = Math.max(covered, span[1]);
      }
    }
    // The value key before the name (`{"value": V, "name": N}`): the nearest one, unless another object stands between.
    const from = Math.max(0, match.index - pairWindow(r));
    const behind = text.slice(from, match.index);
    const re = valueKeyOpen(r, q);
    let nearest: RegExpExecArray | null = null;
    for (let m = re.exec(behind); m !== null; m = re.exec(behind)) nearest = m;
    if (nearest !== null) {
      const span = pairValueSpan(behind, nearest.index + nearest[0].length, r, q, budget);
      // A value that does not close before the name key is not this pair's.
      if (span !== undefined && span[1] < behind.length && !crossesObject(behind, span[1] + span[2], behind.length, r, q)) spans.push([from + span[0], from + span[1]]);
    }
  }
  return redactSpans(text, spans);
}

/**
 * A list element that names a credential, followed by the next element: `["--password", "S"]`, `[["password", "S"]]`,
 * `["run", "--token", "S"]`. The element has to follow a `[` or a `,` (a string that is the VALUE of a key is not a label).
 */
const LIST_PAIR_OPEN = /(?<=[\[,]\s{0,3})(?<!\\)(\\*)(["'])(-{0,2}[A-Za-z0-9_.:/-]{1,80})\1\2\s{0,3},\s{0,3}\1\2/g;

function redactListPairs(text: string): string {
  const spans: Array<[number, number]> = [];
  const opener = fresh(LIST_PAIR_OPEN);
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text)) !== null) {
    const r = (match[1] as string).length;
    const valueStart = match.index + match[0].length;
    // The value is the next element and may itself name a credential (`["run", "--token", "S"]`): read on from its opening quote.
    opener.lastIndex = valueStart - r - 1;
    const label = match[3] as string;
    const user = label === "-u" || label === "--user";
    if (!user && !namesCredential(label)) continue;
    const quoted = quotedValueEnd(text, valueStart, match[2] as string, r);
    // `["curl", "-u", "admin:S"]`: the element after -u or --user is a user name and a password when it holds a colon
    if (user && !text.slice(valueStart, quoted).includes(":")) continue;
    spans.push([valueStart, quoted]);
  }
  return redactSpans(text, spans);
}

/* ------------------------------------------------------------------------------------------ flags and user information */

// (a line break written as text, `\n`, `\r`, `\t`, `%0A`, `%09`, `%0D`, ends the text in front of the dash: its last letter is not a word)
const FLAG_OPEN = /(?:(?<![A-Za-z0-9-])|(?<=\\[nrtfv])|(?<=%0[9AaBbCcDd])|(?<=\\u000[9AaBbCcDd])|(?<=\\x0[9AaBbCcDd]))--?([A-Za-z][A-Za-z0-9_-]*)/g;

/** Does an option name a credential (`--password`, `--db-password`, `--client-secret`, `-Password`)? The rule of the key names, so `--token-count` and `--tokenizer` stay. */
function flagNamesCredential(name: string): boolean {
  return /^pass$/i.test(name) || isSensitiveName(name);
}

/**
 * Options that take a credential: `--password S`, `--password=S`, `--password = S`, quoted or not, at any JSON nesting depth
 * (`--password \"S\"` inside a string inside a string), with a value that holds an escaped quote. The value is read by the same layer
 * arithmetic as an assignment (`quotedValueEnd`). In `"user"` mode only `-u` and `--user` are read, and only a value with a colon in
 * it (`-u name:password`; a bare `-u root` is a user name). A quoted value is replaced with its quotes.
 */
function redactFlags(text: string, mode: "credential" | "user"): string {
  const spans: Array<[number, number]> = [];
  const budget = { left: text.length * 8 + 65536 };
  const opener = fresh(FLAG_OPEN);
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text)) !== null) {
    const flag = match[0];
    if (mode === "user" && /^-u[A-Za-z0-9_]/.test(flag) && text.charAt(match.index + flag.length) === ":" && !flagNamesCredential(match[1] as string)) {
      // `curl -uadmin:S`: the user name and the password are glued to the option; what stands after the colon is the password
      const at = match.index + flag.length + 1;
      const opening = text.charAt(at);
      let e = at;
      if (opening === '"' || opening === "'") {
        const close = quotedValueEnd(text, at + 1, opening, 0);
        e = text.charAt(close) === opening ? close + 1 : close;
      } else {
        // (a quote right after a separator opens the value of the next credential: `-uu:passwd="S"`)
        e = wordEnd(text, at, true);
      }
      const glued = /([A-Za-z][A-Za-z0-9_.-]{0,60})[:=]$/.exec(text.slice(at, e));
      if (glued !== null && isSensitiveName(glued[1] as string)) continue; // the "password" is another credential's name: its own reader takes what follows
      if (text.charAt(e - 1) === ":") e = Math.max(e, unquotedValueEnd(text, skipBlanks(text, e)));
      if (e > at) spans.push([at, e]);
      opener.lastIndex = Math.max(opener.lastIndex, e);
      continue;
    }
    if (mode === "user" ? flag !== "-u" && flag !== "--user" : !flagNamesCredential(match[1] as string)) continue;
    let k = match.index + flag.length;
    let blanks = 0;
    while (blanks < MAX_BLANKS && isWhitespace(text.charAt(k))) {
      k += 1;
      blanks += 1;
    }
    if (text.charAt(k) === "=") {
      k += 1;
      blanks = 0;
      while (blanks < MAX_BLANKS && isWhitespace(text.charAt(k))) {
        k += 1;
        blanks += 1;
      }
    } else if (blanks === 0) {
      continue;
    }
    // `--api_key :'S`, `--api_key=>'S'`: a colon, or `=>` (a hash rocket), after the option separates an assignment (read by that step), not a value.
    if (k >= text.length || isWhitespace(text.charAt(k)) || (mode === "credential" && (text.charAt(k) === ":" || (text.charAt(k) === ">" && text.charAt(k - 1) === "=")))) continue;
    let quote = "";
    let r = 0;
    let start = k;
    // A Python prefix (`b'S'`, `u"S"`) or a shell `$'S'` in front of the quote is part of the value.
    let q = k;
    if (mode === "credential") {
      const prefix = /^(?:(?:[bBuUrR]{1,2}|\$)(?=['"\\])|(?:[fF][rR]?|[rR][fF]|[NEX]|[uU]&)(?=['"]|\\+['"]))/.exec(text.slice(k, k + 12));
      if (prefix !== null) q = k + prefix[0].length;
    }
    const c = text.charAt(q);
    if (c === '"' || c === "'") {
      quote = c;
      start = q + 1;
    } else if (c === "\\") {
      r = backslashRun(text, q);
      if (r > 0) {
        quote = text.charAt(q + r);
        start = q + r + 1;
      }
    }
    const authorization = mode === "credential" && /authorization[A-Za-z0-9]*-?$/i.test(match[1] as string);
    let end: number;
    let resumeAt = -1;
    if (quote !== "") {
      const close = quotedValueEnd(text, start, quote, r);
      if (mode === "user" && !colonBetween(text, start, close)) continue;
      end = text.charAt(close + r) === quote && close + r < text.length ? close + r + 1 : close;
      while (mode === "credential" && end < text.length && /[A-Za-z0-9_]/.test(text.charAt(end))) end += 1;
    } else if (mode === "credential" && authorization) {
      // An Authorization value is a scheme and its parameters (`Digest a="b", c="d"`, `Bearer S`, a list, an object, a tag): the line.
      // Unless the first word is another credential's name and separator (`--Authorization token:` then the value): that name reads it.
      const first = /^-{0,2}([A-Za-z][A-Za-z0-9_.-]{0,40})["']?\s{0,4}[:=]/.exec(text.slice(k, k + 60));
      if (first !== null && flagNamesCredential(first[1] as string)) continue;
      end = authorizationValueEnd(text, k, budget);
    } else if (mode === "credential" && (c === "[" || c === "{" || c === "(")) {
      // the bracket, and at least the whole word it starts (an option's value is a shell word: `--token={rERr+<l}!u;x=` holds its `;x=`)
      end = throughNextLine(text, k, Math.max(containerValueEnd(text, k, budget), wordEnd(text, k, false)));
    } else if (mode === "credential" && (c === "!" || c === "&")) {
      end = throughNextLine(text, k, lineEnd(text, k));
    } else {
      end = wordEnd(text, k, false);
      if (end === k || (mode === "user" && !colonBetween(text, k, end))) continue;
      // `curl -u admin:"S"`: a quote right after the colon opens the password, and the word reaches through its closing quote (as for `-uadmin:"S"`)
      if (mode === "user" && (text.charAt(end - 1) === ":" || text.slice(end - 2, end) === ":$") && (text.charAt(end) === '"' || text.charAt(end) === "'")) {
        const opening = text.charAt(end);
        const close = quotedValueEnd(text, end + 1, opening, 0);
        end = text.charAt(close) === opening ? close + 1 : close;
      }
      // The next word names a credential of its own (`--password-stdin --token S`, `--user-password token=S`, `... PASSWORD = S`): it is not
      // this option's value, and its own reader takes what follows it.
      const named = mode === "credential" ? /^-{0,2}([A-Za-z][A-Za-z0-9_.-]{0,40})/.exec(text.slice(k, end)) : null;
      // (a name that a value follows after a blank, not glued to its separator, is written in one case: camel-case humps in it mean a random key)
      if (named !== null && plausibleLabel(named[1] as string, gluedValue(text.slice(k, end)) ? 3 : 0) && flagNamesCredential(named[1] as string) && (c === "-" || /^["']?\s{0,4}[:=]/.test(text.slice(k + named[0].length, k + named[0].length + 7))) && valueBehindLabel(text, text.slice(k, end), end)) continue;
      // ... nor does the value end in a credential's name that a separator follows (`-secretkey-header\n$headerProxy-Authorization": "S"`,
      // `-pass S;Bearer:`): what stands in front of that name is the value, the name is left for its own reader
      const word = stripTrailingBackslashes(text.slice(k, end)); // (the backslashes of an escaped quote may end the word)
      // (only the last characters of the word matter to the name at its end: a window, so a long word is not read again at every option in it)
      const windowStart = Math.max(0, word.length - TAIL_WINDOW);
      const tail = /([A-Za-z][A-Za-z0-9_.-]{0,60})((?:[:=]|%3[AaDd](?:%20)?)?)$/.exec(windowStart === 0 ? word : word.slice(windowStart));
      const tailIndex = tail === null ? -1 : tail.index + windowStart;
      // (a name that starts right behind a base64 character (`+`, `/`, `=`), or, in `-u user:password`, behind the colon, is the end of a value, not a name)
      let runStart = Math.max(tailIndex, 0);
      for (let back = 0; back < 64 && runStart > 0 && /[A-Za-z0-9_.-]/.test(word.charAt(runStart - 1)); back += 1) runStart -= 1; // (digits in front of the name belong to its run; bounded)
      const nameStartsValue = tailIndex > 0 && runStart > 0 && (mode === "user" ? "+/=:" : "+/=").includes(word.charAt(runStart - 1));
      if (tail !== null && !nameStartsValue && plausibleLabel(tail[1] as string, tail[2] === "" || gluedValue(word) ? 3 : 0) && isSensitiveName(tail[1] as string) && (tail[2] !== "" || /^(?:\\+["'])?["']?\s{0,4}[:=]/.test(text.slice(end, end + 12)))) {
        if (tailIndex === 0) {
          if (valueBehindLabel(text, word, end)) continue;
          // nothing stands behind the "name": it is this option's value (the word is hidden as it stands)
        } else end = k + tailIndex;
      } else if (mode === "credential" && (word.endsWith(":") || SCHEME_WORD.test(word))) {
        // a word that ends in a colon takes the next word (`--token a: S`), and so does a scheme word (`--token Bearer S`)
        end = Math.max(end, unquotedValueEnd(text, skipBlanks(text, end)));
        // ... and a dangling label that it takes (`--token e: password: S`) takes its own value too (at most three labels, on the same line)
        for (let hops = 0; hops < 3 && word.endsWith(":") && text.charAt(end - 1) === ":"; hops += 1) {
          const after = skipBlanks(text, end);
          if (after >= text.length || lineBreakLength(text, after) > 0) break;
          end = Math.max(end, unquotedValueEnd(text, after));
        }
      }
      resumeAt = k + 1; // an option that starts inside this word (`@-apikey`) is looked at too
    }
    spans.push([k, end]);
    opener.lastIndex = Math.max(opener.lastIndex, resumeAt >= 0 ? resumeAt : end);
  }
  return redactSpans(text, spans);
}

/** How far past the first `/` a password that holds a slash is looked for (fail closed: the userinfo then ends at the last `@` of that token). */
const USERINFO_REACH = 512;
const USERINFO_OPEN = /(?:(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,20}:)?\/\/(?=[^\s/@]{0,100}:)/gi;

/** The largest position in the sorted list `ats` that lies in [from, to), or -1 (a binary search: no scan over the text). */
function lastAtIn(ats: number[], from: number, to: number): number {
  let lo = 0;
  let hi = ats.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((ats[mid] as number) < to) lo = mid + 1;
    else hi = mid;
  }
  const found = lo > 0 ? (ats[lo - 1] as number) : -1;
  return found >= from ? found : -1;
}

/**
 * a `user:password` pair in front of the host, after any scheme, and the scheme-less form with the two slashes alone. The password ends at the LAST `@` before the first
 * `/`, `?`, `#`, quote, backslash or blank (so an `@` inside it is inside it); failing that at the first `@` (a password with a quote or
 * a backslash in it); failing that, when the text before the first `/` cannot be a port and an `@` follows in the same token, at the
 * last `@` of that token (a password with a slash in it, within reach): more is redacted, never less. The user may be empty
 * (`redis://:password@host`). The positions of the `@` characters are listed once, so every look for one is a binary search.
 */
function redactUserinfo(text: string): string {
  const ats: number[] = [];
  for (let i = text.indexOf("@"); i !== -1; i = text.indexOf("@", i + 1)) ats.push(i);
  if (ats.length === 0) return text;
  const spans: Array<[number, number]> = [];
  const opener = fresh(USERINFO_OPEN);
  let memoFrom = 0;
  let memoStop = -1;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text)) !== null) {
    const userStart = match.index + match[0].length;
    const colon = text.indexOf(":", userStart);
    if (colon === -1) continue;
    const pwStart = colon + 1;
    let end1 = pwStart;
    while (end1 < text.length && !"/?#\"'\\<>".includes(text.charAt(end1)) && !isWhitespace(text.charAt(end1))) end1 += 1;
    let at = lastAtIn(ats, pwStart + 1, end1);
    if (at === -1) {
      // A quote or a backslash inside the password: the old reading, up to the first `@`.
      let e = pwStart;
      while (e < text.length && text.charAt(e) !== "@" && text.charAt(e) !== "/" && !isWhitespace(text.charAt(e))) e += 1;
      if (text.charAt(e) === "@" && e > pwStart) at = e;
    }
    if (at === -1 && "/?#".includes(text.charAt(end1)) && !/^\d*$/.test(text.slice(pwStart, end1))) {
      // A slash inside the password: the last `@` of the token, within reach.
      const limit = Math.min(text.length, end1 + USERINFO_REACH);
      if (lastAtIn(ats, end1, limit) !== -1) {
        let stop = memoFrom <= end1 && end1 <= memoStop && memoStop <= limit ? memoStop : end1;
        if (stop === end1) {
          while (stop < limit && !isWhitespace(text.charAt(stop)) && text.charAt(stop) !== '"' && text.charAt(stop) !== "'" && text.charAt(stop) !== "\\") stop += 1;
          memoFrom = end1;
          memoStop = stop;
        }
        at = lastAtIn(ats, end1, stop);
      }
    }
    if (at === -1) continue;
    spans.push([userStart, at]);
    opener.lastIndex = Math.max(opener.lastIndex, at + 1);
  }
  return redactSpans(text, spans);
}

function redactInner(value: unknown, depth: number): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_REDACT_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    // A list that names a credential and then gives it (`["--password", "S"]`, `[["password", "S"]]` rows): the element after a
    // credential name is the value.
    return value.map((item, i) => {
      const before = i > 0 ? value[i - 1] : undefined;
      if ((typeof item === "string" || typeof item === "number") && typeof before === "string" && namesCredential(before)) return REDACTED;
      // `["curl", "-u", "admin:S"]`: the element after -u or --user is a user name and a password when it holds a colon
      if (typeof item === "string" && (before === "-u" || before === "--user") && item.includes(":")) return REDACTED;
      return redactInner(item, depth + 1);
    });
  }
  // Own properties are defined with Object.defineProperty semantics via fromEntries, so a hostile "__proto__" key stays plain data.
  const entries: Array<[string, unknown]> = [];
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();
  // A name/value pair object (`{ "name": "DB_PASSWORD", "value": "..." }`, as in Kubernetes env lists, `{ Name, Value }` in AWS,
  // `{ key, value }`, `{ header: "Authorization", value }`): the name says what the value is.
  const record = value as Record<string, unknown>;
  let pairedName = false;
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === "string" && NAME_LIKE_KEY.test(key) && (namesPairLabel(child) || namesPairLabel(redactString(child)))) pairedName = true;
  }
  for (const [key, child] of Object.entries(record)) {
    const base = redactString(key);
    let safeKey = base;
    // Two different secret-looking keys must not collapse into one and silently overwrite each other. The redacted key is
    // computed once and a per-base counter is kept, so thousands of colliding keys stay linear.
    if (used.has(safeKey)) {
      let n = nextSuffix.get(base) ?? 2;
      while (used.has(`${base}#${n}`)) n += 1;
      safeKey = `${base}#${n}`;
      nextSuffix.set(base, n + 1);
    }
    used.add(safeKey);
    // Judged on the key as written AND as redacted (a joint fixed point): see namesCredential.
    const sensitive = isSensitiveKey(key) || isSensitiveKey(base) || (pairedName && VALUE_LIKE_KEY.test(key));
    entries.push([safeKey, sensitive && child !== null && child !== undefined ? REDACTED : redactInner(child, depth + 1)]);
  }
  return Object.fromEntries(entries);
}

/* ------------------------------------------------------------------------------------------- artifact scanning */

/**
 * Steps whose shape is short enough to occur in binary data by chance (a keyword followed by a few characters, a `-p` flag, a `//x:y@`
 * shape): the artifact scan applies them to text windows only, so a compressed or random file is not refused. The steps with a
 * distinctive prefix (tokens, JWTs, private-key blocks, webhook URLs) are looked for in binary too.
 */
const WEAK_STEPS = new Set([
  "glued-password-flag",
  "user-flag",
  "command-line-secret",
  "assignment",
  "signature-parameter",
  "url-credentials",
  "cookie-header",
  "name-value-pair",
  "list-pair",
]);

/** At least 85% of the characters are printable (random or compressed bytes are about 76% as Latin-1, and mostly U+FFFD as UTF-8). */
function looksLikeText(text: string): boolean {
  let printable = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if ((c >= 0x20 && c < 0x7f) || c === 9 || c === 10 || c === 13 || (c >= 0xa0 && c !== 0xfffd)) printable += 1;
  }
  return printable >= text.length * 0.85;
}

/** Names of credential patterns found in a text (never the matched secret itself). */
export function findCredentialPatterns(text: string): string[] {
  return findCredentialPatternsWithWorkLimit(text, WORK_PER_CHAR * text.length + WORK_BASE);
}

/** `findCredentialPatterns` with the work budget set to `limit` counted steps (the test that proves the scan fails closed uses a tiny one: the answer is `work-budget-exceeded`, never nothing found). */
export function findCredentialPatternsWithWorkLimit(text: string, limit: number): string[] {
  return withWorkBudget(limit, () => findCredentialPatternsWithin(text), () => [WORK_BUDGET_PATTERN]);
}

/** Pattern name reported for a text whose scan ran out of its work budget (fail closed: the artifact is unsafe to bundle). */
export const WORK_BUDGET_PATTERN = "work-budget-exceeded";

function findCredentialPatternsWithin(text: string): string[] {
  const found = credentialPatternsIn(text);
  if (!text.includes("%")) return found;
  // A credential behind percent-encoded separators (`password%3DS`) is found in the decoded copy (never longer than the text, which
  // is a window of at most 1 MiB); the weak shapes are still asked of text only.
  const decoded = decodeSeparators(text);
  if (decoded !== text) for (const name of credentialPatternsIn(decoded)) if (!found.includes(name)) found.push(name);
  return found;
}

function credentialPatternsIn(text: string): string[] {
  const found: string[] = [];
  let lowered: string | undefined;
  const lower = (): string => (lowered ??= text.toLowerCase());
  let textual: boolean | undefined;
  for (const step of STEPS) {
    if (!step.credential || !shouldRun(step, text, lower)) continue;
    // `-pXXXXX` is a shape that random or compressed bytes contain by chance (185 of 200 random 256 KB buffers): only text is asked.
    if (WEAK_STEPS.has(step.name) && !(textual ??= looksLikeText(text))) continue;
    if (step.apply(text) !== text) found.push(step.name);
  }
  return found;
}

/** Pattern name reported for a window whose folded form is too large to examine (fail closed: the artifact is unsafe to bundle). */
export const UNEXAMINABLE_PATTERN = "unexaminable-text";

/** Credential patterns in a decoded text and in its folded form (zero-width splits, fullwidth letters). */
function patternsInDecodedText(text: string): string[] {
  const names = new Set(findCredentialPatterns(text));
  if (hasNonAscii(text)) {
    const foldedNames = probeFolded(text, (window) => {
      const found = findCredentialPatterns(window);
      return found.length > 0 ? found : undefined;
    });
    if (foldedNames === UNEXAMINABLE) names.add(UNEXAMINABLE_PATTERN);
    else for (const name of foldedNames ?? []) names.add(name);
  }
  return [...names];
}

const SCAN_WINDOW = 1024 * 1024;
const SCAN_OVERLAP = 16 * 1024;
/** Consecutive UTF-16 code units in ASCII range (a non-zero byte and a zero byte) that make a window worth decoding as UTF-16. */
const UTF16_RUN = 4;

/**
 * Which UTF-16 layouts a window looks like. `le[p]` / `be[p]` is true when at least `UTF16_RUN` consecutive code units that
 * start at byte offset `p` (0 or 1, relative to `start`) are a non-zero byte followed by a zero byte (little-endian) or a
 * zero byte followed by a non-zero byte (big-endian). Compressed or random binary data does not contain such a run, and text
 * that is ASCII in another encoding does not either, so only real UTF-16 is decoded (and only in the layouts it uses).
 */
function utf16Layouts(buf: Buffer, start: number, end: number): { le: [boolean, boolean]; be: [boolean, boolean] } {
  const leRun = [0, 0];
  const beRun = [0, 0];
  const le: [boolean, boolean] = [false, false];
  const be: [boolean, boolean] = [false, false];
  for (let i = start; i + 1 < end; i += 1) {
    const p = (i - start) & 1;
    const a = buf[i] as number;
    const b = buf[i + 1] as number;
    if (a !== 0 && b === 0) {
      leRun[p] = (leRun[p] as number) + 1;
      if ((leRun[p] as number) >= UTF16_RUN) le[p] = true;
    } else leRun[p] = 0;
    if (a === 0 && b !== 0) {
      beRun[p] = (beRun[p] as number) + 1;
      if ((beRun[p] as number) >= UTF16_RUN) be[p] = true;
    } else beRun[p] = 0;
  }
  return { le, be };
}

function decodeUtf16(buf: Buffer, start: number, end: number, bigEndian: boolean): string {
  const length = (end - start) & ~1;
  if (length <= 0) return "";
  if (!bigEndian) return buf.toString("utf16le", start, start + length);
  return Buffer.from(buf.subarray(start, start + length)).swap16().toString("utf16le");
}

/**
 * Scan a binary/text buffer in overlapping windows; returns the credential pattern names seen. Scanning stops at the first
 * window that shows any credential shape: the caller only needs to know that the artifact is unsafe to bundle.
 *
 * Each window is examined as it is written (Latin-1 bytes), as UTF-8 text with zero-width characters removed and fullwidth
 * letters folded (when it holds non-ASCII bytes), and as UTF-16 text of either byte order and alignment (when it holds
 * dense zero bytes). Encodings that transform the secret itself (base64, hex, percent-encoding, compression, encryption)
 * are NOT examined; docs/SECURITY.md lists this limit.
 */
export function scanBufferForCredentials(buffer: Uint8Array): string[] {
  const buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let offset = 0; offset < buf.length; offset += SCAN_WINDOW) {
    const end = Math.min(buf.length, offset + SCAN_WINDOW + SCAN_OVERLAP);
    const latin1 = buf.toString("latin1", offset, end);
    const names = new Set(findCredentialPatterns(latin1));
    if (names.size === 0 && hasNonAscii(latin1)) {
      for (const name of patternsInDecodedText(buf.toString("utf8", offset, end))) names.add(name);
    }
    if (names.size === 0) {
      const layouts = utf16Layouts(buf, offset, end);
      for (const [bigEndian, flags] of [[false, layouts.le], [true, layouts.be]] as const) {
        for (const parity of [0, 1]) {
          if (names.size > 0 || flags[parity] !== true) continue;
          for (const name of patternsInDecodedText(decodeUtf16(buf, offset + parity, end, bigEndian))) names.add(name);
        }
      }
    }
    if (names.size > 0) return [...names].sort();
    if (end === buf.length) break;
  }
  return [];
}
