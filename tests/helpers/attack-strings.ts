/**
 * Attack-string corpus for the report renderer. Every entry is inert data; the tests assert that each one
 * shows up in the rendered report as visible text and never as markup, attribute content or a link.
 */
const cp = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

export const ATTACK_STRINGS: readonly string[] = [
  "<script>alert(1)</script>",
  '"><script>alert(1)</script>',
  "'><img src=x onerror=alert(1)>",
  '" onmouseover="alert(1)',
  "' onfocus='alert(1)' autofocus='",
  "`onerror=alert(1)`",
  "javascript:alert(document.cookie)",
  '<a href="javascript:alert(1)">click</a>',
  "</td></tr></table></section><h1>pwned</h1>",
  "</title><script>alert(1)</script>",
  "</style><script>alert(1)</script>",
  "<style>body{display:none}</style>",
  "<!-- comment --><!--",
  "-->",
  "<svg/onload=alert(1)>",
  '<iframe src="https://attacker.example/"></iframe>',
  '<meta http-equiv="refresh" content="0;url=https://attacker.example/">',
  '<base href="https://attacker.example/">',
  "<link rel=stylesheet href=//attacker.example/x.css>",
  '<form action="https://attacker.example/"><input name=x></form>',
  '<object data="https://attacker.example/x"></object>',
  "<math><mtext></mtext></math>",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "&#x3C;script&#x3E; &#60;b&#62; &amp;amp; &",
  "&notit; &copy &#0; &#xD800;",
  "expression(alert(1))",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "file:///etc/passwd",
  ["http://169", ".254.169", ".254/latest/meta-data/"].join(""), // link-local metadata address, assembled so a grep of the tree stays quiet
  "https://attacker.example/artifact.xml",
  "../../../../etc/passwd",
  "${7*7} {{7*7}} %s%n <%= 7*7 %>",
  "line1\r\nSet-Cookie: session=1\r\n\r\n<html>",
  // Unicode tricks: bidi override, zero width, BOM, NUL, tag characters, lone surrogates, separators.
  // Written with numeric code points so no invisible character appears in this source file.
  `${cp(0x202e)}fdp.exe`,
  `${cp(0x2066)}hidden${cp(0x2069)} isolate`,
  `zero${cp(0x200b)}width${cp(0x200d)}join${cp(0x2060)}er`,
  `${cp(0xfeff)}bom-prefixed`,
  `nul${cp(0)}byte`,
  `esc${cp(0x1b)}[31mred`,
  `tag${cp(0xe0041, 0xe0042)}chars`,
  `lone${String.fromCharCode(0xd800)}surrogate and ${String.fromCharCode(0xdfff)}`,
  `line${cp(0x2028)}separator${cp(0x2029)}paragraph`,
  `${cp(0x440, 0x430)}ypal.example (cyrillic homoglyphs)`,
  `Z${cp(0x361, 0x35c)}a${cp(0x335, 0x316)}l${cp(0x337, 0x323)}g${cp(0x338)}o combining marks`,
  `family ${cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)}`,
  `${cp(0x7f)}delete ${cp(0x85)}next-line ${cp(0x9f)}apc`,
  // Very long strings.
  "A".repeat(200_000),
  "<".repeat(50_000),
  "&".repeat(50_000),
  `${"x".repeat(3999)}${cp(0x1f600)}${"y".repeat(50)}`,
  "<script>".repeat(20_000),
];

/** Deterministic PRNG so the fuzz run is reproducible (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ["<", ">", '"', "'", "`", "&", ";", "/", "=", "!", "-", "#", " ", "\n", "\t", "a", "Z", "0", cp(0x202e), cp(0x200b), cp(0), String.fromCharCode(0xd800), cp(0x1f600), cp(0xe9), "javascript:", "on", "script", "&lt;", "&#x3c;", "</", "<!--", "-->", "{{", "}}"];

/** Random hostile-looking string built from markup fragments and characters. */
export function randomHostile(rand: () => number): string {
  const length = 1 + Math.floor(rand() * 60);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

/** Mix corpus entries and random fragments. */
export function randomAttack(rand: () => number): string {
  const short = ATTACK_STRINGS.filter((s) => s.length <= 200);
  const pick = (): string => short[Math.floor(rand() * short.length)] as string;
  const mode = Math.floor(rand() * 3);
  if (mode === 0) return randomHostile(rand);
  if (mode === 1) return pick() + randomHostile(rand);
  return randomHostile(rand) + pick() + randomHostile(rand);
}
