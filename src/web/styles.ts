/**
 * Inline stylesheet for the static report. No external fonts, images or
 * resources. The CSP meta tag pins this exact text by sha256, so the page
 * needs neither `unsafe-inline` nor style attributes.
 *
 * Colours are tokens (CSS custom properties) with a light and a dark set.
 * Every status pairs a colour with a text label, a symbol and a border style,
 * so colour is never the only cue. The palette below is also exported so a
 * test can verify WCAG AA contrast for each text/background pair.
 */

export interface Tone {
  fg: string;
  bg: string;
  border: string;
}

export interface Palette {
  page: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  link: string;
  tones: Record<"pass" | "fail" | "stale" | "missing" | "partial" | "deferred" | "unknown" | "notice", Tone>;
}

export const PALETTE: { light: Palette; dark: Palette } = {
  light: {
    page: "#ffffff",
    surface: "#f6f8fa",
    text: "#1f2328",
    muted: "#4a5560",
    border: "#8c959f",
    link: "#0a4fa8",
    tones: {
      pass: { fg: "#0b4a2a", bg: "#d8f3e3", border: "#137a45" },
      fail: { fg: "#7a1620", bg: "#fde2e4", border: "#b3261e" },
      stale: { fg: "#5c4400", bg: "#fff1c2", border: "#8a6500" },
      missing: { fg: "#383e45", bg: "#e6e8eb", border: "#5b6570" },
      partial: { fg: "#7a3300", bg: "#ffe6d2", border: "#b04a00" },
      deferred: { fg: "#3b2a78", bg: "#e9e3fb", border: "#5b45b0" },
      unknown: { fg: "#383e45", bg: "#e6e8eb", border: "#5b6570" },
      notice: { fg: "#5c4400", bg: "#fff1c2", border: "#8a6500" },
    },
  },
  dark: {
    page: "#0d1117",
    surface: "#151b23",
    text: "#e6edf3",
    muted: "#a8b3bf",
    border: "#6e7a87",
    link: "#79b8ff",
    tones: {
      pass: { fg: "#8ce6b0", bg: "#0f2e1d", border: "#3fb56f" },
      fail: { fg: "#ffb1aa", bg: "#3d1418", border: "#f0665c" },
      stale: { fg: "#f2cf6b", bg: "#392e0b", border: "#c9a227" },
      missing: { fg: "#d0d7de", bg: "#2b3138", border: "#8b96a2" },
      partial: { fg: "#ffbe8f", bg: "#40230a", border: "#e0803a" },
      deferred: { fg: "#cfc0ff", bg: "#2a2150", border: "#8f7be0" },
      unknown: { fg: "#d0d7de", bg: "#2b3138", border: "#8b96a2" },
      notice: { fg: "#f2cf6b", bg: "#392e0b", border: "#c9a227" },
    },
  },
};

function tokens(p: Palette): string {
  const lines = [
    `--page:${p.page};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--border:${p.border};--link:${p.link};`,
  ];
  for (const [name, tone] of Object.entries(p.tones)) {
    lines.push(`--${name}-fg:${tone.fg};--${name}-bg:${tone.bg};--${name}-bd:${tone.border};`);
  }
  return lines.join("");
}

const TONE_CLASSES = ["pass", "fail", "stale", "missing", "partial", "deferred", "unknown", "notice"] as const;

/** Border style differs per status too (solid/dashed/dotted/double), a second non-colour cue. */
const BORDER_STYLE: Record<(typeof TONE_CLASSES)[number], string> = {
  pass: "solid",
  fail: "solid",
  stale: "dashed",
  missing: "dotted",
  partial: "dashed",
  deferred: "double",
  unknown: "dotted",
  notice: "dashed",
};

const toneRules = TONE_CLASSES.map(
  (n) => `.tone-${n}{color:var(--${n}-fg);background:var(--${n}-bg);border-color:var(--${n}-bd);border-style:${BORDER_STYLE[n]}}`,
).join("\n");

export const REPORT_CSS = `
:root{${tokens(PALETTE.light)}color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${tokens(PALETTE.dark)}}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:80rem;margin:0 auto;padding:1rem}
.skip{position:absolute;left:-999px;top:0;background:var(--surface);color:var(--link);padding:.5rem 1rem;border:2px solid var(--border);z-index:10}
.skip:focus{left:1rem;top:1rem}
h1{font-size:1.6rem;line-height:1.25;margin:.25rem 0 .5rem}
h2{font-size:1.25rem;margin:2rem 0 .5rem;padding-top:.5rem;border-top:1px solid var(--border)}
h3{font-size:1.05rem;margin:1.5rem 0 .5rem}
p{margin:.5rem 0}
a{color:var(--link)}
a:focus-visible,[tabindex]:focus-visible{outline:3px solid var(--link);outline-offset:2px}
code{font:.875rem/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;word-break:break-word}
td,th,dd,li,code,p,h1,h2,h3,caption{unicode-bidi:isolate;overflow-wrap:anywhere}
.muted{color:var(--muted)}
.eyebrow{margin:0;color:var(--muted);font-size:.875rem;letter-spacing:.04em;text-transform:uppercase}
.verdict{margin:1rem 0;padding:1rem 1.25rem;border-width:4px;border-radius:.5rem}
.verdict h2{margin:0 0 .25rem;padding:0;border:0;font-size:1.6rem}
.verdict p{color:inherit}
.badge{display:inline-flex;align-items:baseline;gap:.35rem;padding:.1rem .55rem;border-width:2px;border-radius:.4rem;font-weight:700;font-size:.875rem;white-space:nowrap}
.badge .sym{font-weight:400}
.tag{display:inline-block;padding:0 .4rem;border:1px solid var(--border);border-radius:.3rem;font-size:.75rem;font-weight:700;letter-spacing:.04em;color:var(--muted)}
.tag.strong{color:var(--text);border-color:var(--text)}
.notice{margin:.5rem 0;padding:.5rem .75rem;border-width:2px;border-radius:.4rem}
${toneRules}
.scroll{overflow-x:auto;margin:.5rem 0;border:1px solid var(--border);border-radius:.4rem}
table{border-collapse:collapse;width:100%;font-size:.9375rem}
caption{text-align:left;padding:.5rem .75rem;font-weight:700;background:var(--surface);border-bottom:1px solid var(--border)}
caption .muted{font-weight:400}
th,td{text-align:left;vertical-align:top;padding:.5rem .75rem;border-bottom:1px solid var(--border)}
thead th{background:var(--surface);font-size:.8125rem;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
tbody th[scope=row]{font-weight:600}
tbody tr:last-child>*{border-bottom:0}
ul.plain{margin:0;padding:0;list-style:none}
ul.plain li+li{margin-top:.5rem}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:.5rem 0}
dl.facts dt{font-weight:600}
dl.facts dd{margin:0}
dl.inline{margin:.25rem 0}
dl.inline div{display:block}
dl.inline dt{display:inline;font-weight:600}
dl.inline dt::after{content:": "}
dl.inline dd{display:inline;margin:0}
details.detail>summary{cursor:pointer;padding:.4rem .6rem;border:1px solid var(--border);border-radius:.4rem;background:var(--surface);font-weight:600}
details.detail[open]>summary{margin-bottom:.5rem}
.empty{padding:1rem;border:2px dashed var(--border);border-radius:.5rem;color:var(--muted)}
.cols{min-width:12rem}
footer{margin:2rem 0 1rem;padding-top:1rem;border-top:1px solid var(--border);color:var(--muted);font-size:.875rem}
@media screen and (max-width:720px){
.wrap{padding:.75rem}
dl.facts{grid-template-columns:1fr}
dl.facts dt{margin-top:.5rem}
.scroll{border:0}
table.stack,table.stack tbody,table.stack tr,table.stack th,table.stack td{display:block;width:100%}
table.stack thead{position:absolute;left:-999px;width:1px;height:1px;overflow:hidden}
table.stack caption{display:block}
table.stack tr{margin:0 0 1rem;border:1px solid var(--border);border-radius:.4rem;overflow:hidden}
table.stack tbody tr:last-child>*{border-bottom:1px solid var(--border)}
table.stack tr>*:last-child{border-bottom:0}
table.stack td::before,table.stack th[scope=row]::before{content:attr(data-label);display:block;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
table.stack th[scope=row]{background:var(--surface)}
#details table.stack tr{margin:0 0 .5rem}
#details table.stack th,#details table.stack td{display:grid;grid-template-columns:5.5rem 1fr;gap:.5rem;align-items:baseline;padding:.25rem .6rem}
#details table.stack td::before,#details table.stack th[scope=row]::before{font-size:.6875rem}
#details h3{margin:1rem 0 .4rem}
}
@media print{
:root{${tokens(PALETTE.light)}--page:#fff;--surface:#fff;--text:#000;--muted:#333;--border:#555;--link:#000}
body{font-size:11pt}
.wrap{max-width:none;padding:0}
.skip{display:none}
.scroll{overflow:visible;border:0}
table{font-size:9pt}
tr,.verdict,.notice{break-inside:avoid}
thead{display:table-header-group}
a{color:inherit;text-decoration:none}
}
`.trim();
