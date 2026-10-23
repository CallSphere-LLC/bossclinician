/**
 * Clipboard HTML → the Markdown the admin editors store (QA row 169).
 *
 * When she copies from Google Docs, Word or a web page, the clipboard carries
 * an HTML version alongside the plain text. The body editors store Markdown,
 * so pasting the plain text threw away every heading, bold word, link and
 * list. This turns the HTML into the same Markdown the toolbar buttons write
 * (`**bold**`, `_italic_`, `## Heading`, `- item`, `[words](https://…)`).
 *
 * Deliberately a small string tokenizer rather than a DOM walk: it runs the
 * same in the browser, during SSR and under the node test runner, and it
 * never puts pasted markup into a live document. Nothing it emits is HTML, so
 * there is nothing to sanitise on the way out — links keep only http(s),
 * mailto, tel and site-relative addresses.
 *
 * The quirks that matter, because they are where she copies from:
 *  - Google Docs wraps the whole fragment in `<b style="font-weight:normal">`
 *    (not bold) and marks bold/italic with styled spans, not <b>/<i>. Its
 *    links go through google.com/url?q=…, which is unwrapped.
 *  - Word sends lists as `<p class="MsoListParagraph">` with the bullet or
 *    number as literal text inside conditional comments / mso-list:Ignore.
 *  - Browsers add <!--StartFragment--> markers and <meta>/<style> noise.
 */

export interface HtmlToMarkdownResult {
  markdown: string;
  /**
   * True when the HTML carried formatting worth keeping (a heading, emphasis,
   * a link, a list, more than one paragraph…). When false the caller should let the browser paste the
   * plain text as usual: converting gains nothing and can only add escapes.
   */
  formatted: boolean;
}

type El = { type: "el"; tag: string; attrs: Record<string, string>; children: Node[] };
type Text = { type: "text"; text: string };
type Node = El | Text;

/** Past this the clipboard is something other than a document worth converting. */
const MAX_HTML = 1_500_000;

const VOID = new Set(["br", "img", "hr", "meta", "link", "input", "col", "wbr", "source", "area", "base", "param", "track", "embed"]);
const DROP = new Set(["script", "style", "head", "title", "xml", "template", "noscript", "iframe", "object", "svg", "canvas", "button", "select", "textarea", "o:p"]);
const BLOCK = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "hr", "table",
  "section", "article", "header", "footer", "main", "aside", "nav", "figure", "figcaption", "dl", "dt", "dd",
  "address", "center", "form", "fieldset", "details", "summary", "body", "html", "tr", "td", "th", "tbody", "thead", "tfoot",
]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", laquo: "«", raquo: "»",
  deg: "°", times: "×", divide: "÷", euro: "€", pound: "£", cent: "¢", sect: "§", para: "¶", shy: "",
  zwj: "", zwnj: "", rarr: "→", larr: "←", check: "✓", hearts: "♥", star: "☆",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Strips what is never content: comments, Word's conditional bullets, browser fragment markers, dropped elements. */
function preclean(html: string): string {
  let source = html;
  const start = source.indexOf("<!--StartFragment-->");
  const end = source.indexOf("<!--EndFragment-->");
  if (start !== -1 && end > start) source = source.slice(start + "<!--StartFragment-->".length, end);
  return source
    .replace(/<!--\[if !supportLists\]-->[\s\S]*?<!--\[endif\]-->/gi, (block) => `<span data-list-glyph="${glyphOf(block)}"></span>`)
    .replace(/<!\[if !supportLists\]>[\s\S]*?<!\[endif\]>/gi, (block) => `<span data-list-glyph="${glyphOf(block)}"></span>`)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[[\s\S]*?\]>/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
}

/** The literal bullet or number Word puts in front of a list paragraph ("1." / "·"), as plain text. */
function glyphOf(block: string): string {
  const text = decodeEntities(block.replace(/<!--[\s\S]*?-->|<!\[[^\]]*\]>|<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return text.replace(/["<>&]/g, "");
}

export function parseHtml(html: string): Node[] {
  const root: El = { type: "el", tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const top = () => stack[stack.length - 1];
  const re = /<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const source = preclean(html);
  let last = 0;
  let dropping: string | null = null;
  let dropDepth = 0;

  const closeUntil = (tag: string, stopAt: Set<string>) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) {
        stack.length = i;
        return;
      }
      if (stopAt.has(stack[i].tag)) return;
    }
  };

  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const text = source.slice(last, match.index);
    last = re.lastIndex;
    if (!dropping && text) top().children.push({ type: "text", text });
    const tag = match[1].toLowerCase();
    const closing = match[0][1] === "/";
    const selfClosing = /\/\s*>$/.test(match[0]);

    if (dropping) {
      if (tag === dropping) {
        if (closing) dropDepth--;
        else if (!selfClosing) dropDepth++;
        if (dropDepth === 0) dropping = null;
      }
      continue;
    }
    if (DROP.has(tag)) {
      if (!closing && !selfClosing && !VOID.has(tag)) {
        dropping = tag;
        dropDepth = 1;
      }
      continue;
    }

    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    // The implicit closes HTML allows and Word relies on.
    if (tag === "li") closeUntil("li", new Set(["ul", "ol"]));
    if (tag === "p") closeUntil("p", new Set(["div", "li", "td", "th", "blockquote", "section", "article", "body"]));
    if (tag === "td" || tag === "th") {
      closeUntil("td", new Set(["tr", "table"]));
      closeUntil("th", new Set(["tr", "table"]));
    }
    if (tag === "tr") closeUntil("tr", new Set(["table", "tbody", "thead", "tfoot"]));

    const el: El = { type: "el", tag, attrs: parseAttrs(match[2]), children: [] };
    top().children.push(el);
    if (!VOID.has(tag) && !selfClosing) stack.push(el);
  }
  if (!dropping && last < source.length) top().children.push({ type: "text", text: source.slice(last) });
  return root.children;
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

function styleValue(el: El, property: string): string | null {
  const style = el.attrs.style;
  if (!style) return null;
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i");
  const found = re.exec(style);
  return found ? found[1].trim().toLowerCase() : null;
}

function boldFrom(value: string | null): boolean | undefined {
  if (!value) return undefined;
  if (/^(bold|bolder)/.test(value)) return true;
  const weight = parseInt(value, 10);
  if (Number.isFinite(weight)) return weight >= 600;
  if (/^(normal|lighter)/.test(value)) return false;
  return undefined;
}

interface Inline {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  /** Inside a heading or a link, where extra markers only add noise. */
  plain: boolean;
  inLink: boolean;
}

const BASE: Inline = { bold: false, italic: false, strike: false, plain: false, inLink: false };

function isHidden(el: El): boolean {
  return styleValue(el, "display") === "none" || /mso-list\s*:\s*ignore/i.test(el.attrs.style ?? "");
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

interface State {
  formatted: boolean;
}

function textContent(nodes: Node[]): string {
  return nodes.map((node) => (node.type === "text" ? decodeEntities(node.text) : isHidden(node) ? "" : textContent(node.children))).join("");
}

/** Escapes what Markdown would otherwise read as formatting in pasted words. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/[*`]/g, (char) => `\\${char}`)
    .replace(/_/g, (char, index: number, whole: string) => {
      const before = whole[index - 1] ?? "";
      const after = whole[index + 1] ?? "";
      return /[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after) ? char : `\\${char}`;
    });
}

/** Escapes a line start Markdown would read as a heading, quote or list. */
function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)([#>])/, "$1\\$2")
        .replace(/^(\s*)([-+])(\s)/, "$1\\$2$3")
        .replace(/^(\s*)(\d+)([.)])(\s)/, "$1$2\\$3$4"),
    )
    .join("\n");
}

function wrap(content: string, marker: string): string {
  const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  if (!parts || !parts[2]) return content;
  return `${parts[1]}${marker}${parts[2]}${marker}${parts[3]}`;
}

/** Google Docs routes every link through google.com/url?q=… */
function unwrapHref(href: string): string {
  const match = /^https?:\/\/(?:www\.)?google\.[a-z.]+\/url\?(.*)$/i.exec(href);
  if (match) {
    const q = /(?:^|&)q=([^&]+)/.exec(match[1]);
    if (q) {
      try {
        return decodeURIComponent(q[1]);
      } catch {
        return href;
      }
    }
  }
  return href;
}

function safeHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const href = unwrapHref(raw.trim());
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href) || /^\/(?!\/)/.test(href)) {
    return href.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  }
  return null;
}

function renderInline(nodes: Node[], ctx: Inline, state: State): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      const text = decodeEntities(node.text.replace(/[\t\n\r ]+/g, " "));
      out += escapeText(text);
      continue;
    }
    const el = node;
    if (isHidden(el)) continue;
    const tag = el.tag;
    if (tag === "br") {
      out += "\n";
      continue;
    }
    if (tag === "img") {
      const src = el.attrs.src ?? "";
      if (/^https?:\/\//i.test(src) && !ctx.inLink) {
        state.formatted = true;
        const alt = (el.attrs.alt ?? "").replace(/[[\]\n]/g, " ").trim();
        out += `![${alt}](${src.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
      }
      continue;
    }
    if (tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt") {
      const code = textContent(el.children).replace(/\s+/g, " ");
      if (code.trim()) {
        state.formatted = true;
        const fence = code.includes("`") ? "``" : "`";
        out += `${fence}${code}${fence}`;
      }
      continue;
    }
    if (tag === "a") {
      const href = ctx.inLink ? null : safeHref(el.attrs.href);
      const inner = renderInline(el.children, { ...ctx, inLink: true }, state);
      if (href && inner.trim()) {
        state.formatted = true;
        const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
        out += `${parts[1]}[${parts[2].replace(/\n/g, " ").replace(/(?<!\\)([[\]])/g, "\\$1")}](${href})${parts[3]}`;
      } else {
        out += inner;
      }
      continue;
    }

    const isB = tag === "b" || tag === "strong";
    const isI = tag === "i" || tag === "em" || tag === "cite" || tag === "dfn";
    const isS = tag === "s" || tag === "strike" || tag === "del";
    const bold = boldFrom(styleValue(el, "font-weight")) ?? (isB ? true : undefined);
    const fontStyle = styleValue(el, "font-style");
    const italic = fontStyle ? /italic|oblique/.test(fontStyle) : isI ? true : undefined;
    const decoration = styleValue(el, "text-decoration") ?? styleValue(el, "text-decoration-line");
    const strike = decoration ? decoration.includes("line-through") : isS ? true : undefined;

    const next: Inline = {
      ...ctx,
      bold: ctx.bold || (bold === true && !ctx.plain),
      italic: ctx.italic || (italic === true && !ctx.plain),
      strike: ctx.strike || (strike === true && !ctx.plain),
    };
    const plainInner = renderInline(el.children, next, state);
    let inner = plainInner;
    if (next.strike && !ctx.strike) inner = wrap(inner, "~~");
    if (next.italic && !ctx.italic) inner = wrap(inner, "_");
    if (next.bold && !ctx.bold) inner = wrap(inner, "**");
    if (inner !== plainInner) state.formatted = true;
    out += inner;
  }
  // Runs Google Docs split for no visible reason: **a****b** is **ab**, and
  // **Boss** **Clinician** is **Boss Clinician**.
  return out.replace(/(?<!\\)\*\*\*\*/g, "").replace(/(?<![\\*])\*\*( +)\*\*(?!\*)/g, "$1");
}

/** Tidies a paragraph: no stray spaces at line ends, no doubled spaces, no trailing breaks. */
function tidy(text: string): string {
  return text
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * One paragraph of inline content. Emphasis inherited from a container (a
 * `<strong>` wrapped round whole paragraphs) is applied here, per paragraph,
 * because Markdown emphasis cannot span a blank line.
 */
function paragraph(nodes: Node[], ctx: Inline, state: State): string {
  let text = escapeLineStarts(tidy(renderInline(nodes, ctx, state)));
  if (!text || ctx.plain) return text;
  if (ctx.italic) text = wrap(text, "_");
  if (ctx.bold) text = wrap(text, "**");
  if (ctx.bold || ctx.italic) state.formatted = true;
  return text;
}

interface Block {
  text: string;
  /** Word sends each list item as its own paragraph; those join with a single newline so the list stays tight. */
  kind: "para" | "item";
}

function hasBlockChild(el: El): boolean {
  return el.children.some((child) => child.type === "el" && (BLOCK.has(child.tag) || hasBlockChild(child)));
}

function isBlockNode(node: Node): boolean {
  return node.type === "el" && (BLOCK.has(node.tag) || hasBlockChild(node));
}

function indent(text: string, by: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 || !line ? line : by + line))
    .join("\n");
}

/** Word list paragraphs carry their level in `mso-list:l0 level2 lfo1`. */
function wordListLevel(el: El): number {
  const found = /level(\d+)/i.exec(el.attrs.style ?? "");
  return found ? Math.max(0, Math.min(5, Number(found[1]) - 1)) : 0;
}

function findGlyph(nodes: Node[]): string | null {
  for (const node of nodes) {
    if (node.type !== "el") continue;
    if (node.attrs["data-list-glyph"] !== undefined) return node.attrs["data-list-glyph"];
    if (/mso-list\s*:\s*ignore/i.test(node.attrs.style ?? "")) return textContent(node.children).trim();
    const inner = findGlyph(node.children);
    if (inner !== null) return inner;
  }
  return null;
}

function renderList(el: El, ctx: Inline, state: State): Block[] {
  state.formatted = true;
  const ordered = el.tag === "ol";
  let number = Math.max(0, parseInt(el.attrs.start ?? "1", 10) || 1);
  const items: Array<{ marker: string; content: string }> = [];
  for (const child of el.children) {
    if (child.type === "text") {
      const stray = tidy(escapeText(decodeEntities(child.text)));
      if (stray && items.length) items[items.length - 1].content += ` ${stray}`;
      continue;
    }
    if (child.tag === "ul" || child.tag === "ol") {
      // Google Docs nests a list as a sibling of the item it belongs under.
      const nested = renderList(child, ctx, state).map((block) => block.text).join("\n");
      if (items.length) items[items.length - 1].content += `\n${nested}`;
      else items.push({ marker: "", content: nested });
      continue;
    }
    const marker = ordered ? `${number++}. ` : "- ";
    const content = renderBlocks(child.tag === "li" ? child.children : [child], ctx, state)
      .map((block) => block.text)
      .join("\n");
    items.push({ marker, content });
  }
  const text = items
    .filter((item) => item.content.trim())
    .map((item) => item.marker + indent(item.content, " ".repeat(item.marker.length)))
    .join("\n");
  // One block per list, so two lists in a row keep the blank line between them.
  return text ? [{ text, kind: "para" }] : [];
}

function renderTable(el: El, ctx: Inline, state: State): Block[] {
  const rows: string[][] = [];
  const collect = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.type !== "el") continue;
      if (node.tag === "tr") {
        rows.push(
          node.children
            .filter((cell): cell is El => cell.type === "el" && (cell.tag === "td" || cell.tag === "th"))
            .map((cell) =>
              renderBlocks(cell.children, ctx, state)
                .map((block) => block.text)
                .join(" ")
                .replace(/\n/g, " ")
                .replace(/\|/g, "\\|")
                .trim(),
            ),
        );
      } else if (node.tag !== "table") collect(node.children);
    }
  };
  collect(el.children);
  const width = Math.max(0, ...rows.map((row) => row.length));
  const filled = rows.filter((row) => row.some((cell) => cell));
  if (!width || !filled.length) return [];
  // A one-cell "table" is page layout, not data: keep its words as paragraphs.
  if (width === 1) return filled.map((row) => ({ text: row[0], kind: "para" as const }));
  state.formatted = true;
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  const [head, ...body] = filled;
  return [{ text: [line(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...body.map(line)].join("\n"), kind: "para" }];
}

function renderBlock(el: El, ctx: Inline, state: State): Block[] {
  const tag = el.tag;
  if (isHidden(el)) return [];
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    const text = tidy(renderInline(el.children, { ...ctx, plain: true }, state)).replace(/\n+/g, " ");
    if (!text) return [];
    state.formatted = true;
    return [{ text: `${"#".repeat(Number(heading[1]))} ${text}`, kind: "para" }];
  }
  if (tag === "ul" || tag === "ol") return renderList(el, ctx, state);
  if (tag === "li") return renderList({ ...el, tag: "ul", children: [el] }, ctx, state);
  if (tag === "hr") {
    state.formatted = true;
    return [{ text: "---", kind: "para" }];
  }
  if (tag === "pre") {
    const code = textContent(el.children).replace(/ /g, " ").replace(/^\n|\n$/g, "");
    if (!code.trim()) return [];
    state.formatted = true;
    const fence = code.includes("```") ? "~~~" : "```";
    return [{ text: `${fence}\n${code}\n${fence}`, kind: "para" }];
  }
  if (tag === "blockquote") {
    const inner = renderBlocks(el.children, ctx, state)
      .map((block) => block.text)
      .join("\n\n");
    if (!inner.trim()) return [];
    state.formatted = true;
    return [{ text: inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n"), kind: "para" }];
  }
  if (tag === "table") return renderTable(el, ctx, state);

  // Word's list paragraphs: class MsoListParagraph…, or any paragraph styled mso-list:l0 level1.
  if (tag === "p" && (/MsoListParagraph/i.test(el.attrs.class ?? "") || /mso-list\s*:\s*l\d/i.test(el.attrs.style ?? ""))) {
    const glyph = findGlyph(el.children) ?? "";
    const numbered = /^(\d+)[.)]/.exec(glyph);
    const marker = numbered ? `${numbered[1]}. ` : "- ";
    const text = paragraph(el.children, ctx, state);
    if (!text) return [];
    state.formatted = true;
    const pad = "  ".repeat(wordListLevel(el));
    return [{ text: pad + marker + indent(text, pad + " ".repeat(marker.length)), kind: "item" }];
  }

  if (!hasBlockChild(el)) {
    const text = paragraph(el.children, ctx, state);
    return text ? [{ text, kind: "para" }] : [];
  }

  // A container (div, section, Google Docs' <b> wrapper): its children are the
  // blocks, and any emphasis it sets is applied paragraph by paragraph.
  const bold = boldFrom(styleValue(el, "font-weight")) ?? (tag === "b" || tag === "strong" ? true : undefined);
  const fontStyle = styleValue(el, "font-style");
  const italic = fontStyle ? /italic|oblique/.test(fontStyle) : tag === "i" || tag === "em" ? true : undefined;
  return renderBlocks(el.children, { ...ctx, bold: ctx.bold || bold === true, italic: ctx.italic || italic === true }, state);
}

function renderBlocks(nodes: Node[], ctx: Inline, state: State): Block[] {
  const out: Block[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = paragraph(run, ctx, state);
    run = [];
    if (text) out.push({ text, kind: "para" });
  };
  for (const node of nodes) {
    if (isBlockNode(node)) {
      flush();
      out.push(...renderBlock(node as El, ctx, state));
    } else run.push(node);
  }
  flush();
  return out;
}

function join(blocks: Block[]): string {
  let out = "";
  blocks.forEach((block, index) => {
    if (index > 0) out += blocks[index - 1].kind === "item" && block.kind === "item" ? "\n" : "\n\n";
    out += block.text;
  });
  return out;
}

export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  if (!html || html.length > MAX_HTML) return { markdown: "", formatted: false };
  const state: State = { formatted: false };
  const blocks = renderBlocks(parseHtml(html), BASE, state);
  const markdown = join(blocks)
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Several paragraphs count as formatting too: Google Docs' plain-text copy
  // separates paragraphs with a single newline, which Markdown runs together.
  return { markdown, formatted: (state.formatted || blocks.length > 1) && markdown.length > 0 };
}

/* ── Inserting at the cursor ─────────────────────────────────────────────── */

export interface PasteEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  /** Exactly what goes in at the cursor, separating blank lines included. */
  inserted: string;
}

/**
 * Where pasted Markdown lands. A paste that is more than a run of words (a
 * heading, a list, several paragraphs) needs to start and end on its own line,
 * or the first heading reads as text and the last paragraph runs into whatever
 * followed the cursor.
 */
export function pasteEdit(value: string, start: number, end: number, markdown: string): PasteEdit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const multiBlock = /\n/.test(markdown) || /^(#{1,6} |[-+] |\d+\. |> |```|\|)/.test(markdown);
  let inserted = markdown;
  if (multiBlock) {
    if (before && !before.endsWith("\n\n")) inserted = (before.endsWith("\n") ? "\n" : "\n\n") + inserted;
    if (after && !after.startsWith("\n\n")) inserted += after.startsWith("\n") ? "\n" : "\n\n";
  }
  const caret = before.length + inserted.length;
  return { value: before + inserted + after, selectionStart: caret, selectionEnd: caret, inserted };
}
