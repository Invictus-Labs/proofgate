import { CONTENT_SECURITY_POLICY } from "../../src/web/render.js";
import { REPORT_CSS } from "../../src/web/styles.js";
import { allAttributes, elementNames, parseHtml, styleText, type Token } from "./html-tokens.js";

/**
 * Structural safety invariants every rendered report must satisfy, whatever data it was rendered from.
 * Returns human-readable violations (empty = safe).
 */

export const ALLOWED_ELEMENTS = new Set([
  "html", "head", "meta", "title", "style", "body", "a", "div", "header", "nav", "main", "section", "footer",
  "h1", "h2", "h3", "p", "span", "strong", "em", "code", "br", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "thead", "tbody", "tr", "th", "td",
  // Collapsible per-requirement details: native disclosure, no script.
  "details", "summary",
]);

const ID = /^[a-z]+(-[a-z0-9]+)*$/;
const CLASS = /^[a-z]+([- ][a-z]+)*$/;
const LABEL = /^[A-Za-z()' ]+$/;

const ALLOWED_META = new Set([
  'charset=utf-8',
  'name=viewport|content=width=device-width, initial-scale=1',
  `http-equiv=Content-Security-Policy|content=${CONTENT_SECURITY_POLICY}`,
  "name=referrer|content=no-referrer",
  "name=color-scheme|content=light dark",
  "name=robots|content=noindex",
]);

function metaKey(attrs: Array<[string, string]>): string {
  return attrs.map(([n, v]) => (n === "charset" ? `charset=${v}` : `${n}=${v}`)).join("|");
}

export function violations(source: string): string[] {
  const out: string[] = [];
  const { tokens, errors } = parseHtml(source);
  out.push(...errors.slice(0, 10).map((e) => `parse: ${e}`));

  for (const name of elementNames(tokens)) if (!ALLOWED_ELEMENTS.has(name)) out.push(`element <${name}> is not allowed`);

  const ids = new Set<string>();
  const attributes = allAttributes(tokens);
  for (const a of attributes) if (a.name === "id") ids.add(a.value);

  for (const { element, name, value } of attributes) {
    const where = `<${element} ${name}>`;
    switch (name) {
      case "id":
        if (!ID.test(value)) out.push(`${where} has an unexpected value ${JSON.stringify(value.slice(0, 60))}`);
        break;
      case "class":
        if (!CLASS.test(value)) out.push(`${where} has an unexpected value ${JSON.stringify(value.slice(0, 60))}`);
        break;
      case "href":
        if (element !== "a" || !value.startsWith("#") || !ids.has(value.slice(1))) out.push(`${where} is not an in-page anchor to an existing id: ${JSON.stringify(value.slice(0, 60))}`);
        break;
      case "aria-labelledby":
        if (!ids.has(value)) out.push(`${where} points at a missing id ${JSON.stringify(value.slice(0, 60))}`);
        break;
      case "data-label":
        if (!LABEL.test(value)) out.push(`${where} has an unexpected value ${JSON.stringify(value.slice(0, 60))}`);
        break;
      case "scope":
        if (value !== "col" && value !== "row") out.push(`${where} has an unexpected value`);
        break;
      case "open":
        if (value !== "") out.push(`${where} has an unexpected value`);
        break;
      case "lang":
        if (value !== "en") out.push(`${where} has an unexpected value`);
        break;
      case "aria-hidden":
        if (value !== "true") out.push(`${where} has an unexpected value`);
        break;
      case "role":
        if (value !== "region") out.push(`${where} has an unexpected value`);
        break;
      case "tabindex":
        if (value !== "0") out.push(`${where} has an unexpected value`);
        break;
      case "aria-label":
        if (value !== "Report sections") out.push(`${where} has an unexpected value`);
        break;
      case "charset":
      case "name":
      case "content":
      case "http-equiv":
        break; // <meta> attributes are checked as a set below
      default:
        out.push(`attribute ${where} is not allowed`);
    }
  }

  for (const t of tokens) {
    if (t.type === "start" && t.name === "meta" && !ALLOWED_META.has(metaKey(t.attrs))) out.push(`unexpected <meta ${metaKey(t.attrs).slice(0, 80)}>`);
    if (t.type === "comment") out.push("HTML comments are not expected");
  }

  const styles = styleText(tokens);
  if (styles.length !== 1 || styles[0] !== REPORT_CSS) out.push("the inline stylesheet is missing, duplicated or altered");
  return out;
}

export function tokensOf(source: string): Token[] {
  return parseHtml(source).tokens;
}
