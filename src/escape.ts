const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/**
 * HTML-escape untrusted text. report.json carries raw strings only; every
 * renderer must pass every string through this function (or an equivalent
 * text-node API) before it reaches HTML.
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`]/g, (ch) => ENTITIES[ch] as string);
}
