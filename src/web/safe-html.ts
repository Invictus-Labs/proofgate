import { charClassRegex } from "../charclass.js";
import { escapeHtml } from "../escape.js";

/**
 * Escaping by construction. Markup is only ever built with the `html` tagged
 * template: every interpolated value that is not a `Safe` fragment (a value
 * produced by `html`, `join` or `raw`) is converted to text and passed through
 * `escapeHtml`. A report string can therefore never become markup, whichever
 * position (text or attribute) it is interpolated into, and `instanceof Safe`
 * cannot be forged from JSON data.
 */
export class Safe {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Per-string display cap. Longer text is cut with a visible marker (the full value stays in report.json). */
export const MAX_TEXT_LENGTH = 4000;

/**
 * Characters that are invisible or reorder text (C0/C1 controls except tab and
 * line breaks, soft hyphen, bidi marks and overrides, zero-width characters,
 * line/paragraph separators, BOM, interlinear annotation, Unicode "tag"
 * characters and unpaired surrogates). They are shown as `[U+XXXX]` instead of
 * being rendered, so a hostile string cannot hide or visually reorder text.
 * Inclusive code point ranges, written numerically so no invisible character
 * ever appears in this source file.
 */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xd800, 0xdfff], // unpaired surrogates (a valid pair is a single astral code point and is not seen here)
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];

/** The ranges above as one regular expression (`u` flag: a valid surrogate pair is one code point and is not matched as a lone surrogate). */
const INVISIBLE = charClassRegex(INVISIBLE_RANGES);

function showInvisible(input: string): string {
  return input.replace(INVISIBLE, (ch) => `[U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}]`);
}

/** Cut at a code point boundary and say so. */
function limit(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  let end = MAX_TEXT_LENGTH;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not split a surrogate pair
  return `${text.slice(0, end)} [... ${text.length - end} more characters not shown; the full value is in report.json]`;
}

/** What the operator sees for an untrusted value: bounded, with invisible characters made visible (not yet escaped). */
export function displayText(value: unknown): string {
  return showInvisible(limit(String(value)));
}

/** Untrusted value to escaped, visible, bounded text. This is the only path from data to markup. */
export function text(value: unknown): string {
  return escapeHtml(displayText(value));
}

/** Markup that was built by this module from constants. */
export const raw = (markup: string): Safe => new Safe(markup);

function part(value: unknown): string {
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(part).join("");
  if (value === null || value === undefined || value === false) return "";
  return text(value);
}

/** Tagged template: static parts are trusted markup, interpolations are escaped unless already `Safe`. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0] as string;
  for (let i = 0; i < values.length; i += 1) out += part(values[i]) + (strings[i + 1] as string);
  return new Safe(out);
}

/** Join fragments (escaping non-Safe items) with a trusted separator. */
export function join(items: unknown[], separator = ""): Safe {
  return new Safe(items.map(part).join(separator));
}
