import { charClassRegex } from "./charclass.js";
import { displayText } from "./web/safe-html.js";

/**
 * Terminal neutraliser. Every untrusted string that ProofGate prints in plain text (requirement titles, runner ids,
 * environments, file names inside error messages, report fields shown by `explain`) passes through here first.
 *
 * Without it a receipt could carry an ESC sequence (recolour or erase what was printed), a bidi override, or a
 * newline followed by a forged line such as `verdict: ACCEPTED (exit 0)`. C0 and C1 controls (including ESC, CSI, DEL),
 * bidi and zero-width characters, line separators and the layout characters tab, carriage return and line feed are all
 * shown as `[U+XXXX]` instead of being interpreted, and over-long strings are cut with a visible marker. The rules are
 * the report page's (`displayText`), plus the three layout characters that the HTML page may keep but a terminal must not.
 */
export function neutralize(value: unknown): string {
  return displayText(value).replace(/[\t\n\r]/g, (ch) => `[U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}]`);
}

/**
 * Code points that `JSON.stringify` leaves as raw characters although a terminal would act on them: DEL, the C1
 * controls, soft hyphen, bidi marks and overrides, zero-width characters, line and paragraph separators, BOM, interlinear
 * annotation and the Unicode "tag" block. (JSON.stringify already escapes every C0 control, so ESC becomes \u001b.)
 * Written as numeric ranges (see charclass.ts), so that no invisible character ever appears in this source file.
 */
const TERMINAL_UNSAFE = charClassRegex([[0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0xe0000, 0xe007f]]);

const unicodeEscape = (unit: number): string => `\\u${unit.toString(16).padStart(4, "0")}`;

function escapeMatch(ch: string): string {
  const cp = ch.codePointAt(0) as number;
  if (cp <= 0xffff) return unicodeEscape(cp);
  const v = cp - 0x10000;
  return unicodeEscape(0xd800 + (v >> 10)) + unicodeEscape(0xdc00 + (v & 0x3ff));
}

/** Pieces of this many code units are rewritten and collected in an array; a piece never ends inside a surrogate pair. */
const ESCAPE_CHUNK = 256 * 1024;

/**
 * For JSON printed to a terminal (`--json`): rewrite the code points above as \uXXXX escapes. The text stays valid JSON
 * and parses to exactly the same value, but nothing in it can reorder or hide what the operator reads. The work is one
 * `String.replace` per piece and an array join, never per-character concatenation, so a report at the documented limits
 * costs a few times its own size in memory.
 */
export function escapeJsonForTerminal(json: string): string {
  if (json.length <= ESCAPE_CHUNK) return json.replace(TERMINAL_UNSAFE, escapeMatch);
  const pieces: string[] = [];
  let from = 0;
  while (from < json.length) {
    let to = Math.min(json.length, from + ESCAPE_CHUNK);
    const last = json.charCodeAt(to - 1);
    if (to < json.length && last >= 0xd800 && last <= 0xdbff) to += 1;
    pieces.push(json.slice(from, to).replace(TERMINAL_UNSAFE, escapeMatch));
    from = to;
  }
  return pieces.join("");
}
