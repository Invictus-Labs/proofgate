/**
 * Build a regular expression character class from numeric code point ranges.
 *
 * The invisible and control characters that redaction, terminal output and the report page must recognise are written as
 * numbers, never as characters or `\uXXXX` escapes in a regular expression literal: that keeps every invisible character
 * out of the source files (a reviewer cannot see one, and an editor or a tool may silently turn an escape into the raw
 * character, which can even end a line inside a literal). The class is compiled with the `u` flag, so a range can span
 * astral code points and a lone surrogate is a character of its own.
 */
export function charClassRegex(ranges: ReadonlyArray<readonly [number, number]>, flags = "gu", extra = ""): RegExp {
  const cp = (n: number): string => `\\u{${n.toString(16)}}`;
  return new RegExp(`[${extra}${ranges.map(([lo, hi]) => (lo === hi ? cp(lo) : `${cp(lo)}-${cp(hi)}`)).join("")}]`, flags);
}
