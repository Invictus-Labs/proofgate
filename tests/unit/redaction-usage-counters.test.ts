/**
 * Review round 6 (logic P2, security P1): the list of usage counters that stay readable (`max_tokens`, `TOKEN_COUNT`, `tokens_per_minute`) was written twice, once for text and once
 * for object keys, and the text one had grown: `TOKEN_USER`, `TOKEN_USERS`, `TOKEN_SECOND`, `token_day`, `TOKEN_MONTH`, `TOKEN_CALLS`, `TOKEN_REQUESTS`, `TOKEN_MINUTE` (and `TOKEN_REQUEST`,
 * an OAuth request token, and the singular `INPUT_TOKEN` that GitHub Actions passes an input as) kept their value in a log line while the same name was hidden as an object key,
 * 132 names in all. There is now ONE definition (`COUNTER_SOURCE` in `src/redact.ts`), narrow: plural LLM token counts, a token with a counting word, a token per unit of time or work,
 * a pass with a status word. A name is a counter in text and as a key, or in neither; a word that can qualify a credential is not a counter.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue } from "../../src/redact.js";

const S = "Zx9Kq2Wm5Lp";

/** Names that can name a credential: hidden as text AND as an object key. */
const AMBIGUOUS = [
  "TOKEN_USER", "TOKEN_USERS", "token_users", "token_user", "TOKEN_SECOND", "token_second", "token_day", "token-day", "tokens_month", "TOKEN_MONTH", "token_hour", "TOKEN_CALLS", "token_call",
  "TOKEN_REQUESTS", "TOKEN_REQUEST", "TOKEN_MINUTE", "token_week", "INPUT_TOKEN", "OUTPUT_TOKEN", "MAX_TOKEN", "TOTAL_TOKEN", "PROMPT_TOKEN", "CACHED_TOKEN", "reasoning_token", "input_token", "TOKEN_PER", "token_per_user",
  "token_id", "token_value", "TOKEN",
];
/** Counters: exempt as text AND as an object key. */
const COUNTERS = [
  "max_tokens", "total_tokens", "input_tokens", "output_tokens", "prompt_tokens", "completion_tokens", "cached_tokens", "reasoning_tokens", "min_tokens", "MAX_TOKENS", "TOTAL-TOKENS", "maxTokens",
  "token_used", "token_count", "TOKEN_COUNT", "tokens_used", "token_limit", "token_total", "token_remaining", "tokens_remaining", "token_max", "token_min", "token_rate",
  "tokens_per_minute", "tokens_per_second", "TOKEN_PER_DAY", "tokens_per_hour", "token_per_week", "tokens_per_month", "tokens_per_request", "tokens_per_call",
  "pass_count", "pass_rate", "pass_fail", "pass_failed", "pass_total", "pass_through",
];

const textHides = (name: string): boolean => !redactString(`${name}=${S}`).includes(S);
const keyHides = (name: string): boolean => redactValue({ [name]: S })[name] === REDACTED;

describe("one shared rule for the usage counters of text and of object keys", () => {
  it.each(AMBIGUOUS)("%s is hidden as text and as an object key", (name) => {
    expect(textHides(name), `as text: ${name}`).toBe(true);
    expect(keyHides(name), `as a key: ${name}`).toBe(true);
    expect(textHides(name)).toBe(keyHides(name));
  });

  it("every retained counter is exempt in BOTH forms", () => {
    const failures: string[] = [];
    for (const name of COUNTERS) {
      if (textHides(name)) failures.push(`${name}: hidden as text`);
      if (keyHides(name)) failures.push(`${name}: hidden as a key`);
    }
    expect(failures).toEqual([]);
  });

  it("the two rules agree on every combination of a credential word and a qualifier (they are one definition)", () => {
    const heads = ["token", "tokens", "TOKEN", "pass", "input_token", "input_tokens", "max_tokens", "total_tokens", "api_token", "password"];
    const tails = ["", "_used", "_count", "_limit", "_total", "_remaining", "_max", "_min", "_rate", "_per_minute", "_per_day", "_user", "_users", "_second", "_day", "_hour", "_month", "_week", "_calls", "_requests", "_request", "_fail", "_failed", "_through", "_id"];
    const disagree: string[] = [];
    for (const head of heads) for (const tail of tails) {
      const name = `${head}${tail}`;
      if (textHides(name) !== keyHides(name)) disagree.push(`${name}: text ${textHides(name) ? "hidden" : "shown"}, key ${keyHides(name) ? "hidden" : "shown"}`);
    }
    expect(disagree).toEqual([]);
  });

  it("only a WHOLE name is a counter, in both forms: a counter with a word in front of it is hidden (conservative: the round-5 key rule exempted a counter anywhere in a name)", () => {
    for (const name of ["openai_total_tokens", "llm_max_tokens", "api_token_count", "openai_token_user"]) {
      expect(keyHides(name), `as a key: ${name}`).toBe(true);
      expect(textHides(name), `as text: ${name}`).toBe(true);
    }
  });
});
