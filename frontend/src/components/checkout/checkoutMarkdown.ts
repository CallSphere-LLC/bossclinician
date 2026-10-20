import { stripMarkdown, withHardBreaks } from "@/components/community/descriptionFormat";

/**
 * The checkout description's formatting rules — what Yvette types under
 * Offers > What you're selling > Description, and what the checkout draws.
 *
 * Ordinary Markdown (headings, **bold**, _italic_, links, `- ` bullets, `1.`
 * numbers, `![photo](address)`, `---` rules) plus one convention of our own:
 * a STYLE LINE. A line holding nothing but words in curly braces styles the
 * block straight below it:
 *
 *     {checks}
 *     - CE certificate included
 *     - Lifetime replay access
 *
 *     {sans gold}
 *     ## Two ways to join
 *
 * Only the words in `CHECKOUT_STYLES` count. A line with any other word in
 * braces ("{name}") is left alone and printed as she typed it, so ordinary
 * copy can never be swallowed by mistake. The words become CSS classes from a
 * fixed list — nothing she types reaches the page as markup.
 */

export type CheckoutStyleGroup = "bullets" | "numbers" | "font" | "look";

export interface CheckoutStyle {
  /** The word typed between the braces. */
  word: string;
  /** The class it puts on the block (styled in checkoutMarkdown.css). */
  className: string;
  /** What the editor's menus call it. */
  label: string;
  group: CheckoutStyleGroup;
}

export const CHECKOUT_STYLES: readonly CheckoutStyle[] = [
  // Bullet markers. Plain "- " bullets are small gold diamonds already.
  { word: "checks", className: "cm-checks", label: "Gold check marks", group: "bullets" },
  { word: "diamonds", className: "cm-diamonds", label: "Gold diamonds", group: "bullets" },
  { word: "stars", className: "cm-stars", label: "Gold stars", group: "bullets" },
  { word: "hearts", className: "cm-hearts", label: "Gold hearts", group: "bullets" },
  { word: "arrows", className: "cm-arrows", label: "Gold arrows", group: "bullets" },
  // Number markers. Plain "1. " lists are gold numbered circles already.
  { word: "circles", className: "cm-circles", label: "Gold numbered circles", group: "numbers" },
  { word: "steps", className: "cm-steps", label: "Step 1, Step 2…", group: "numbers" },
  // The site's two typefaces (the only ones the site loads).
  { word: "serif", className: "cm-serif", label: "Elegant serif (Playfair Display)", group: "font" },
  { word: "sans", className: "cm-sans", label: "Clean sans-serif (Montserrat)", group: "font" },
  { word: "italic", className: "cm-italic", label: "Serif italic", group: "font" },
  // Small finishing touches.
  { word: "gold", className: "cm-gold", label: "Gold text", group: "look" },
  { word: "large", className: "cm-large", label: "Larger text", group: "look" },
  { word: "center", className: "cm-center", label: "Centred", group: "look" },
];

const STYLE_BY_WORD = new Map(CHECKOUT_STYLES.map((style) => [style.word, style]));

/**
 * The braces of a style line. A leading dot or `:` on each word is forgiven
 * (`{.checks}`, `{: .checks}` — the way other Markdown tools write it).
 */
const STYLE_LINE = /^\s{0,3}\{\s*:?\s*([.a-z\s-]+?)\s*\}\s*$/i;

/** The classes a style line asks for, or null when it is not a style line. */
export function styleLineClasses(line: string): string[] | null {
  const match = STYLE_LINE.exec(line);
  if (!match) return null;
  const words = match[1]
    .split(/\s+/)
    .map((word) => word.replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  if (words.length === 0) return null;
  const classes: string[] = [];
  for (const word of words) {
    const style = STYLE_BY_WORD.get(word);
    if (!style) return null;
    if (!classes.includes(style.className)) classes.push(style.className);
  }
  return classes;
}

/**
 * The text as the renderer wants it:
 *
 *  - every style line stands alone as its own paragraph (a blank line either
 *    side), so the line after it is never run into it — Markdown would
 *    otherwise join "{serif}" and the sentence under it into one paragraph;
 *  - single line breaks are kept (`withHardBreaks`), because every checkout
 *    description written before formatting existed was plain text drawn with
 *    its line breaks, and must keep looking the way it did.
 */
export function prepareCheckoutMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && styleLineClasses(line)) {
      if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
      out.push(line.trim(), "");
      continue;
    }
    out.push(line);
  }
  return withHardBreaks(out.join("\n"));
}

/* ── remark plugin ──────────────────────────────────────────────────────── */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> };
}

function styleParagraphClasses(node: MdNode): string[] | null {
  if (node.type !== "paragraph" || node.children?.length !== 1) return null;
  const only = node.children[0];
  if (only.type !== "text" || typeof only.value !== "string") return null;
  return styleLineClasses(only.value);
}

function addClasses(node: MdNode, classes: string[]) {
  const data = (node.data ??= {});
  const props = (data.hProperties ??= {});
  const existing = props.className;
  const current = Array.isArray(existing)
    ? existing.map(String)
    : typeof existing === "string"
      ? existing.split(/\s+/).filter(Boolean)
      : [];
  props.className = [...current, ...classes.filter((c) => !current.includes(c))];
}

function applyStyleLines(parent: MdNode) {
  const children = parent.children;
  if (!children) return;
  for (let index = 0; index < children.length; ) {
    const classes = styleParagraphClasses(children[index]);
    if (classes) {
      // Style lines stack: "{checks}" then "{large}" both reach the list.
      const target = children.slice(index + 1).find((node) => !styleParagraphClasses(node));
      if (target) addClasses(target, classes);
      children.splice(index, 1);
      continue;
    }
    applyStyleLines(children[index]);
    index += 1;
  }
}

/**
 * Turns style lines into classes on the block that follows them, and drops the
 * line itself. react-markdown hands `data.hProperties` on to the element.
 */
export function remarkCheckoutStyles() {
  return (tree: MdNode) => applyStyleLines(tree);
}

/* ── Plain text (meta description, cards) ───────────────────────────────── */

/** The description as one line of plain words: no Markdown, no style lines. */
export function checkoutPlainText(text: string): string {
  const withoutStyles = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !styleLineClasses(line) && !/^\s{0,3}([-*_]\s*){3,}$/.test(line))
    .join("\n");
  return stripMarkdown(withoutStyles);
}

/* ── Editor helpers ─────────────────────────────────────────────────────── */

export interface CheckoutTextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Image alt text cannot hold brackets or line breaks without breaking the syntax. */
function cleanAlt(alt: string): string {
  return alt.replace(/[[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** URLs with spaces or parentheses are wrapped in <> so the link stays whole. */
function cleanUrl(url: string): string {
  const trimmed = url.trim();
  return /[\s()<>]/.test(trimmed) ? `<${trimmed.replace(/[<>]/g, encodeURIComponent)}>` : trimmed;
}

/**
 * Puts a photo on its own line at the cursor (replacing any selection), with a
 * blank line either side so it is drawn as a picture block and not inline in a
 * sentence.
 */
export function insertCheckoutImage(
  value: string,
  start: number,
  end: number,
  url: string,
  alt: string,
): CheckoutTextEdit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const image = `![${cleanAlt(alt)}](${cleanUrl(url)})`;
  const inserted = `${lead}${image}${trail}`;
  const caret = before.length + lead.length + image.length;
  return { value: before + inserted + after, selectionStart: caret, selectionEnd: caret };
}

/**
 * Styles the block the cursor is in: writes (or rewrites) the style line just
 * above that block. Choosing a bullet style for a list replaces the list's old
 * bullet style but keeps its font; choosing "" for a group takes that group's
 * style off again.
 */
export function applyCheckoutStyle(
  value: string,
  cursor: number,
  group: CheckoutStyleGroup,
  word: string,
): CheckoutTextEdit {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  // Which line the cursor is on.
  let lineIndex = 0;
  for (let offset = 0; lineIndex < lines.length - 1; lineIndex += 1) {
    const next = offset + lines[lineIndex].length + 1;
    if (next > cursor) break;
    offset = next;
  }
  // A cursor on a blank line or on a style line styles the block below it.
  while (lineIndex < lines.length - 1 && (lines[lineIndex].trim() === "" || styleLineClasses(lines[lineIndex]))) {
    lineIndex += 1;
  }
  // Walk up to the first line of the block. A list is one block, even when a
  // sentence sits straight above it ("You'll learn how to:"), and a heading is
  // always a block of its own.
  const isHeading = (line: string) => /^\s{0,3}#{1,6}\s/.test(line);
  const isListLine = (line: string) => /^\s*([-*+]|\d+[.)])\s+/.test(line);
  const inList = isListLine(lines[lineIndex]);
  while (lineIndex > 0 && !isHeading(lines[lineIndex])) {
    const above = lines[lineIndex - 1];
    if (above.trim() === "" || styleLineClasses(above) || isHeading(above)) break;
    // In a list: climb list items and their indented follow-on lines only.
    if (inList && !isListLine(above) && !/^\s+\S/.test(above)) break;
    // In a paragraph: stop at a list line above it.
    if (!inList && isListLine(above)) break;
    lineIndex -= 1;
  }

  const existingIndex = lineIndex > 0 && styleLineClasses(lines[lineIndex - 1]) ? lineIndex - 1 : -1;
  const existingWords =
    existingIndex >= 0
      ? (styleLineClasses(lines[existingIndex]) ?? [])
          .map((cls) => CHECKOUT_STYLES.find((style) => style.className === cls))
          .filter((style): style is CheckoutStyle => Boolean(style))
      : [];
  const kept = existingWords.filter((style) => style.group !== group).map((style) => style.word);
  const chosen = word && STYLE_BY_WORD.get(word)?.group === group ? [word] : [];
  const words = [...kept, ...chosen];

  if (existingIndex >= 0) {
    if (words.length) lines[existingIndex] = `{${words.join(" ")}}`;
    else lines.splice(existingIndex, 1);
  } else if (words.length) {
    lines.splice(lineIndex, 0, `{${words.join(" ")}}`);
  }

  const next = lines.join("\n");
  // Leave the cursor at the start of the styled block.
  const styledLine = existingIndex >= 0 && !words.length ? lineIndex - 1 : words.length && existingIndex < 0 ? lineIndex + 1 : lineIndex;
  let caret = 0;
  for (let i = 0; i < styledLine && i < lines.length; i += 1) caret += lines[i].length + 1;
  caret = Math.min(caret, next.length);
  return { value: next, selectionStart: caret, selectionEnd: caret };
}
