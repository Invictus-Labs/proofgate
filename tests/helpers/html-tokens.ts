/**
 * A deliberately strict, tiny HTML tokenizer for the report tests. No real HTML parser is a dependency
 * of this repository, so this one is written to fail loudly instead of recovering the way browsers do:
 * a raw `<` that does not start a well-formed tag, an unquoted or single-quoted attribute, a bare `&`,
 * an unknown entity or mismatched nesting is reported as an error. The report renderer must never
 * produce any of those, so `errors` must be empty for every output.
 */

export type Token =
  | { type: "doctype"; value: string }
  | { type: "start"; name: string; attrs: Array<[string, string]> }
  | { type: "end"; name: string }
  | { type: "text"; value: string }
  | { type: "comment"; value: string };

export interface Parsed {
  tokens: Token[];
  errors: string[];
}

const VOID = new Set(["meta", "br", "link", "hr", "img", "input", "base"]);
const RAW_TEXT = new Set(["style", "script"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#96": "`" };

function decode(raw: string, errors: string[]): string {
  return raw.replace(/&([^;\s&<]{1,8});?/g, (whole, name: string) => {
    if (!whole.endsWith(";") || !(name in ENTITIES)) {
      errors.push(`unknown or unterminated entity ${JSON.stringify(whole)}`);
      return whole;
    }
    return ENTITIES[name] as string;
  });
}

export function parseHtml(source: string): Parsed {
  const tokens: Token[] = [];
  const errors: string[] = [];
  const stack: string[] = [];
  let i = 0;

  const push = (t: Token): void => {
    tokens.push(t);
  };

  while (i < source.length) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i);
      const end = next === -1 ? source.length : next;
      const rawText = source.slice(i, end);
      if (/&(?![a-z0-9#]+;)/i.test(rawText)) errors.push(`bare ampersand in text near ${JSON.stringify(rawText.slice(0, 40))}`);
      push({ type: "text", value: decode(rawText, errors) });
      i = end;
      continue;
    }
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end === -1) {
        errors.push("unterminated comment");
        break;
      }
      push({ type: "comment", value: source.slice(i + 4, end) });
      i = end + 3;
      continue;
    }
    const doctype = /^<!doctype html>/i.exec(source.slice(i, i + 20));
    if (doctype) {
      push({ type: "doctype", value: doctype[0] });
      i += doctype[0].length;
      continue;
    }
    const end = /^<\/([a-z][a-z0-9-]*)>/.exec(source.slice(i, i + 40));
    if (end) {
      const name = end[1] as string;
      if (stack.pop() !== name) errors.push(`mismatched end tag </${name}>`);
      push({ type: "end", name });
      i += end[0].length;
      continue;
    }
    const open = /^<([a-z][a-z0-9-]*)/.exec(source.slice(i, i + 40));
    if (!open) {
      errors.push(`stray "<" at offset ${i}: ${JSON.stringify(source.slice(i, i + 40))}`);
      i += 1;
      continue;
    }
    const name = open[1] as string;
    i += open[0].length;
    const attrs: Array<[string, string]> = [];
    let closed = false;
    while (i < source.length && !closed) {
      const ws = /^\s+/.exec(source.slice(i, i + 50));
      if (ws) i += ws[0].length;
      if (source[i] === ">") {
        i += 1;
        closed = true;
        break;
      }
      const attr = /^([a-zA-Z_:][-a-zA-Z0-9_:.]*)(="([^"]*)")?/.exec(source.slice(i, i + 4200));
      if (!attr) {
        errors.push(`malformed attribute in <${name}> near ${JSON.stringify(source.slice(i, i + 40))}`);
        i += 1;
        continue;
      }
      const value = attr[3] ?? "";
      if (/[<>]/.test(value)) errors.push(`raw angle bracket in attribute ${attr[1]} of <${name}>`);
      attrs.push([attr[1] as string, decode(value, errors)]);
      i += attr[0].length;
    }
    if (!closed) errors.push(`unterminated <${name}> tag`);
    push({ type: "start", name, attrs });
    if (RAW_TEXT.has(name)) {
      const close = source.indexOf(`</${name}>`, i);
      if (close === -1) {
        errors.push(`unterminated <${name}> element`);
        break;
      }
      push({ type: "text", value: source.slice(i, close) });
      push({ type: "end", name });
      i = close + name.length + 3;
      continue;
    }
    if (!VOID.has(name)) stack.push(name);
  }
  if (stack.length > 0) errors.push(`unclosed elements: ${stack.join(", ")}`);
  return { tokens, errors };
}

export function elementNames(tokens: Token[]): Set<string> {
  return new Set(tokens.filter((t): t is Extract<Token, { type: "start" }> => t.type === "start").map((t) => t.name));
}

export function allAttributes(tokens: Token[]): Array<{ element: string; name: string; value: string }> {
  return tokens.flatMap((t) => (t.type === "start" ? t.attrs.map(([name, value]) => ({ element: t.name, name, value })) : []));
}

/** Concatenated decoded text of the document body (the stylesheet text and <title> are excluded). */
export function bodyText(tokens: Token[]): string {
  let inStyle = false;
  let inTitle = false;
  let out = "";
  for (const t of tokens) {
    if (t.type === "start" && t.name === "style") inStyle = true;
    else if (t.type === "end" && t.name === "style") inStyle = false;
    else if (t.type === "start" && t.name === "title") inTitle = true;
    else if (t.type === "end" && t.name === "title") inTitle = false;
    else if (t.type === "start" && t.name === "br" && !inStyle && !inTitle) out += " ";
    else if (t.type === "text" && !inStyle && !inTitle) out += t.value;
  }
  return out;
}

export function titleText(tokens: Token[]): string {
  let inTitle = false;
  let out = "";
  for (const t of tokens) {
    if (t.type === "start" && t.name === "title") inTitle = true;
    else if (t.type === "end" && t.name === "title") inTitle = false;
    else if (t.type === "text" && inTitle) out += t.value;
  }
  return out;
}

export function styleText(tokens: Token[]): string[] {
  const out: string[] = [];
  let inStyle = false;
  for (const t of tokens) {
    if (t.type === "start" && t.name === "style") inStyle = true;
    else if (t.type === "end" && t.name === "style") inStyle = false;
    else if (t.type === "text" && inStyle) out.push(t.value);
  }
  return out;
}
