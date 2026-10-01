/**
 * Kajabi lesson HTML -> the Markdown `course_lessons.body_md` holds.
 *
 * The member player renders body_md with react-markdown + remark-gfm and no
 * rehype-raw (frontend/src/components/player/LessonBody.tsx), so raw HTML in a
 * lesson body would be shown to members as literal tags. The admin editor is a
 * Markdown textarea too. So the HTML is converted, not stored.
 *
 * No dependencies on purpose: nothing that parses HTML is installed in this
 * repo, and `npm install` is not something an import script gets to do on a
 * shared production box. Kajabi's editor emits a small, regular subset of HTML
 * (p, strong, em, h1-h4, ul/ol/li, a, img, hr, br, table, iframe, span), which
 * a tolerant tag tokenizer handles well.
 *
 * ctx (all optional):
 *   rewriteUrl(url, kind)  kind is "img" | "a"; returns { url } to keep/replace
 *                          the link, or { text } to drop the link and append text.
 *   iframes: []            every iframe found is pushed here as { src, title, html }.
 *   scripts: []            every <script> found (dropped from the Markdown).
 */

const VOID = new Set([
  "br", "hr", "img", "input", "meta", "link", "source", "wbr", "col", "area",
  "base", "embed", "param", "track",
]);

const BLOCK = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside", "nav",
  "figure", "figcaption", "center", "h1", "h2", "h3", "h4", "h5", "h6", "ul",
  "ol", "li", "blockquote", "hr", "table", "pre", "iframe", "form", "fieldset",
  "dl", "dt", "dd", "address",
]);

const DROP = new Set(["script", "style", "noscript", "template", "head", "title", "svg", "button", "select", "textarea"]);

const NAMED = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "\u2019",
  lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", mdash: "\u2014", ndash: "\u2013",
  hellip: "\u2026", bull: "\u2022", middot: "\u00b7", copy: "\u00a9", reg: "\u00ae",
  trade: "\u2122", rarr: "\u2192", larr: "\u2190", uarr: "\u2191", darr: "\u2193",
  harr: "\u2194", times: "\u00d7", divide: "\u00f7", deg: "\u00b0", frac12: "\u00bd",
  frac14: "\u00bc", frac34: "\u00be", eacute: "\u00e9", egrave: "\u00e8", aacute: "\u00e1",
  agrave: "\u00e0", oacute: "\u00f3", iacute: "\u00ed", uacute: "\u00fa", ntilde: "\u00f1",
  ccedil: "\u00e7", uuml: "\u00fc", ouml: "\u00f6", auml: "\u00e4", laquo: "\u00ab",
  raquo: "\u00bb", cent: "\u00a2", pound: "\u00a3", euro: "\u20ac", sect: "\u00a7",
  para: "\u00b6", check: "\u2713", hearts: "\u2665", star: "\u2606", zwj: "\u200d",
  zwnj: "\u200c", shy: "", ensp: " ", emsp: " ", thinsp: " ",
};

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code === 0xa0) return " ";
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    const value = NAMED[name.toLowerCase()];
    return value === undefined ? whole : value;
  });
}

function parseAttrs(source) {
  const attrs = {};
  const re = /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let m;
  while ((m = re.exec(source))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|[^<]+|</gi;
  const lower = html.toLowerCase();
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[2] === undefined) {
      if (m[0].startsWith("<!")) continue;
      top.children.push({ text: m[0] });
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      // Close tag: pop back to the matching open element; ignore a stray one.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const node = { tag, attrs: parseAttrs(m[3] || ""), children: [] };
    // An <li> or <p> opened while one is still open closes the earlier one,
    // as a browser would (Kajabi bodies pasted from Google Docs do this).
    if (tag === "li" || tag === "p" || tag === "tr" || tag === "td" || tag === "th") {
      const stopAt = tag === "li" ? ["ul", "ol"] : tag === "tr" ? ["table", "tbody", "thead", "tfoot"] : tag === "p" ? [] : ["tr"];
      for (let i = stack.length - 1; i > 0; i--) {
        const t = stack[i].tag;
        if (stopAt.includes(t)) break;
        if (t === tag || (tag === "td" && t === "th") || (tag === "th" && t === "td")) { stack.length = i; break; }
        if (tag === "p" && BLOCK.has(t) && t !== "p") break;
      }
    }
    const parent = stack[stack.length - 1];
    parent.children.push(node);
    if (tag === "script" || tag === "style") {
      const end = lower.indexOf(`</${tag}`, re.lastIndex);
      node.raw = html.slice(re.lastIndex, end < 0 ? html.length : end);
      const close = end < 0 ? -1 : html.indexOf(">", end);
      re.lastIndex = close < 0 ? html.length : close + 1;
      continue;
    }
    if (!VOID.has(tag) && !m[4]) stack.push(node);
  }
  return root;
}

const BR = "\u0000BR\u0000";

function escapeText(text) {
  return text.replace(/([\\`*_[\]])/g, "\\$1").replace(/<(?=[a-zA-Z/!])/g, "\\<");
}

function escapeLineStarts(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+*](?=\s)|\d+(?=[.)]\s)|=+\s*$|-{3,}\s*$)/, "$1\\$2"))
    .join("\n");
}

function wrap(content, marker) {
  const m = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2] || m[2] === BR) return content;
  // Markers cannot hug a hard break; push breaks outside the emphasis.
  let inner = m[2];
  let tail = m[3];
  while (inner.endsWith(BR)) { inner = inner.slice(0, -BR.length).trimEnd(); tail = BR + tail; }
  let head = m[1];
  while (inner.startsWith(BR)) { inner = inner.slice(BR.length).trimStart(); head = head + BR; }
  if (!inner) return head + tail;
  return `${head}${marker}${inner}${marker}${tail}`;
}

function textOf(node) {
  if (node.text !== undefined) return decodeEntities(node.text);
  return (node.children || []).map(textOf).join("");
}

function isNormalWeight(node) {
  const style = (node.attrs && node.attrs.style) || "";
  return /font-weight\s*:\s*(normal|400)\b/i.test(style);
}

function iframeLink(node, ctx) {
  const src = (node.attrs.src || "").trim();
  if (!src) return "";
  if (ctx.iframes) ctx.iframes.push({ src, title: node.attrs.title || "", html: rebuildIframe(node) });
  let label = node.attrs.title || "";
  if (!label) {
    try {
      const host = new URL(src).host;
      label = /docs\.google\.com\/forms|forms\.gle/.test(src) ? "Open the form" : /jotform/.test(host) ? "Open the form" : `Open the embedded content (${host})`;
    } catch { label = "Open the embedded content"; }
  }
  return `[${escapeText(label)}](${safeUrl(src)})`;
}

function rebuildIframe(node) {
  const keep = ["src", "title", "width", "height", "allow", "allowfullscreen", "frameborder", "id", "style"];
  const attrs = keep
    .filter((k) => node.attrs[k] !== undefined)
    .map((k) => (node.attrs[k] === "" && k === "allowfullscreen" ? k : `${k}="${String(node.attrs[k]).replace(/"/g, "&quot;")}"`))
    .join(" ");
  return `<iframe ${attrs}></iframe>`;
}

function safeUrl(url) {
  const trimmed = url.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return "";
  return trimmed.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function inline(nodes, ctx, state = {}) {
  let out = "";
  for (const node of nodes) out += inlineNode(node, ctx, state);
  return out;
}

function inlineNode(node, ctx, state) {
  if (node.text !== undefined) {
    const text = decodeEntities(node.text).replace(/[\t\n\r \u00a0]+/g, " ");
    return state.code ? text : escapeText(text);
  }
  const tag = node.tag;
  if (DROP.has(tag)) {
    if (tag === "script" && ctx.scripts) ctx.scripts.push(node);
    return "";
  }
  switch (tag) {
    case "br":
      return state.flat ? " " : BR;
    case "strong":
    case "b": {
      if (state.bold || isNormalWeight(node)) return inline(node.children, ctx, state);
      return wrap(inline(node.children, ctx, { ...state, bold: true }), "**");
    }
    case "em":
    case "i":
    case "cite":
    case "dfn": {
      if (state.italic) return inline(node.children, ctx, state);
      return wrap(inline(node.children, ctx, { ...state, italic: true }), "*");
    }
    case "s":
    case "del":
    case "strike":
      return wrap(inline(node.children, ctx, state), "~~");
    case "code":
    case "kbd":
    case "samp": {
      const text = textOf(node).replace(/\s+/g, " ");
      return text ? "`" + text.replace(/`/g, "'") + "`" : "";
    }
    case "a": {
      const label = inline(node.children, ctx, state);
      let href = (node.attrs.href || "").trim();
      if (!href || href.startsWith("#") || /^(javascript|data|vbscript):/i.test(href)) return label;
      if (ctx.rewriteUrl) {
        const r = ctx.rewriteUrl(href, "a");
        if (r && r.text !== undefined) return `${label}${r.text}`;
        if (r && r.url) href = r.url;
      }
      if (!label.trim()) return "";
      return `[${label.trim()}](${safeUrl(href)})`;
    }
    case "img": {
      let src = (node.attrs.src || "").trim();
      if (!src || src.startsWith("data:")) return "";
      if (ctx.rewriteUrl) {
        const r = ctx.rewriteUrl(src, "img");
        if (r && r.text !== undefined) return r.text;
        if (r && r.url) src = r.url;
      }
      const alt = escapeText((node.attrs.alt || "").replace(/\s+/g, " ").trim());
      return `![${alt}](${safeUrl(src)})`;
    }
    case "input": {
      const type = (node.attrs.type || "").toLowerCase();
      if (type === "checkbox") return node.attrs.checked !== undefined ? "\u2611 " : "\u2610 ";
      return "";
    }
    case "iframe":
      return iframeLink(node, ctx);
    default: {
      const content = inline(node.children, ctx, state);
      // A block element reached in inline context (a <div> inside a <span>)
      // still separates its words from the neighbours'.
      return BLOCK.has(tag) ? ` ${content} ` : content;
    }
  }
}

function finishParagraph(text) {
  let s = text.replace(/[ \t]+/g, " ");
  s = s.split(BR).map((part) => part.trim()).join("\n");
  s = s.replace(/^\n+|\n+$/g, "").trim();
  if (!s) return "";
  s = s.split("\n").map((l) => l.trim()).filter((l, i, all) => l || (i > 0 && i < all.length - 1)).join("  \n");
  return escapeLineStarts(s);
}

function blocks(nodes, ctx, opts = {}) {
  const parts = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const para = finishParagraph(inline(run, ctx));
    if (para) parts.push(para);
    run = [];
  };
  for (const node of nodes) {
    if (node.text === undefined && (BLOCK.has(node.tag) || DROP.has(node.tag))) {
      flush();
      const rendered = block(node, ctx);
      if (rendered && rendered.trim()) parts.push(rendered);
    } else {
      run.push(node);
    }
  }
  flush();
  return parts.join(opts.tight ? "\n" : "\n\n");
}

function block(node, ctx) {
  const tag = node.tag;
  if (DROP.has(tag)) {
    if (tag === "script" && ctx.scripts) ctx.scripts.push(node);
    return "";
  }
  switch (tag) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      const level = Number(tag[1]);
      const text = inline(node.children, ctx, { bold: true, flat: true }).replace(/\s+/g, " ").trim();
      if (!text) return "";
      return `${"#".repeat(level)} ${text}`;
    }
    case "hr":
      return "---";
    case "ul":
    case "ol": {
      const ordered = tag === "ol";
      let n = Number.parseInt(node.attrs.start || "1", 10);
      if (!Number.isFinite(n)) n = 1;
      const items = [];
      for (const child of node.children) {
        if (child.text !== undefined) {
          if (child.text.trim()) items.push(`- ${escapeText(decodeEntities(child.text).trim())}`);
          continue;
        }
        const content = child.tag === "li" ? blocks(child.children, ctx, { tight: true }) : block(child, ctx) || inline([child], ctx);
        if (!content.trim()) continue;
        const marker = ordered ? `${n++}. ` : "- ";
        const pad = " ".repeat(marker.length);
        const lines = content.split("\n");
        items.push(marker + lines[0] + (lines.length > 1 ? "\n" + lines.slice(1).map((l) => (l ? pad + l : l)).join("\n") : ""));
      }
      return items.join("\n");
    }
    case "li":
      return "- " + blocks(node.children, ctx, { tight: true }).split("\n").join("\n  ");
    case "blockquote": {
      const content = blocks(node.children, ctx);
      return content ? content.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") : "";
    }
    case "pre": {
      const text = textOf(node).replace(/\n+$/, "");
      return text.trim() ? "```\n" + text.replace(/```/g, "'''") + "\n```" : "";
    }
    case "iframe":
      return iframeLink(node, ctx);
    case "table":
      return table(node, ctx);
    default:
      return blocks(node.children, ctx);
  }
}

function collectRows(node, rows = []) {
  for (const child of node.children || []) {
    if (child.tag === "tr") rows.push(child);
    else if (child.tag && child.tag !== "table") collectRows(child, rows);
  }
  return rows;
}

function table(node, ctx) {
  const trs = collectRows(node);
  const cellsOf = (tr) => tr.children.filter((c) => c.tag === "td" || c.tag === "th");
  // A one-column table is layout, not data (Kajabi "callout" boxes): render
  // each cell's content as ordinary blocks so its paragraphs survive.
  if (trs.length && Math.max(...trs.map((tr) => cellsOf(tr).length)) === 1) {
    return trs.map((tr) => cellsOf(tr).map((cell) => blocks(cell.children, ctx)).join("")).filter((s) => s.trim()).join("\n\n");
  }
  const rows = trs.map((tr) =>
    tr.children
      .filter((c) => c.tag === "td" || c.tag === "th")
      .map((cell) =>
        inline(cell.children, ctx, { flat: true })
          .split(BR).join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\|/g, "\\|"),
      ),
  ).filter((r) => r.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  // A one-cell table is layout, not data: render its content as paragraphs.
  if (width === 1) return rows.map((r) => escapeLineStarts(r[0])).filter(Boolean).join("\n\n");
  const pad = (r) => [...r, ...Array(width - r.length).fill("")];
  const line = (r) => `| ${pad(r).map((c) => c || " ").join(" | ")} |`;
  return [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

export function htmlToMarkdown(html, ctx = {}) {
  if (!html || !html.trim()) return "";
  const root = parseHtml(html);
  const md = blocks(root.children, ctx);
  return md
    .split(BR).join("  \n")
    .replace(/[ \t]+$/gm, (m) => (m === "  " ? m : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
