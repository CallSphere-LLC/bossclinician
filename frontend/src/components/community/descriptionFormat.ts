/**
 * The community description: Markdown with its line breaks kept.
 *
 * Descriptions written before formatting existed are plain text whose single
 * line breaks mean something ("The Practice Elevation:" on one line, what it is
 * on the next). Plain Markdown would run those lines together, so every single
 * break outside a code block becomes a hard break first — what remark-breaks
 * does, without another dependency. Two trailing spaces rather than a
 * backslash: at the end of a block Markdown drops trailing spaces silently,
 * where a stray backslash would be printed.
 */
export function withHardBreaks(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let fenced = false;
  return lines
    .map((line, index) => {
      if (/^\s{0,3}(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      const next = lines[index + 1];
      if (fenced || next === undefined || !line.trim() || !next.trim()) return line;
      if (/( {2}|\\)$/.test(line)) return line;
      return `${line}  `;
    })
    .join("\n");
}

/**
 * The description as one line of plain words, for cards and headers that clamp
 * it to a couple of lines. Without this a card would show "## Welcome **to**".
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s{0,3}(```|~~~)/.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/~~(.+?)~~/g, "$1")
        .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
        .replace(/(^|\W)_(\S(?:.*?\S)?)_(?=\W|$)/g, "$1$2")
        .replace(/`([^`]+)`/g, "$1"),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------- Formatting toolbar */

export type DescriptionFormat = "bold" | "italic" | "heading" | "bullets" | "numbers" | "link";

/** Formats that wrap whatever is selected. */
const WRAPPERS: Record<"bold" | "italic", { marker: string; placeholder: string }> = {
  bold: { marker: "**", placeholder: "bold words" },
  italic: { marker: "_", placeholder: "italic words" },
};

/** Formats that act on whole lines; `prefix` takes the line's position so a
 *  numbered list counts up. */
const LINE_RULES: Record<
  "heading" | "bullets" | "numbers",
  { match: RegExp; prefix: (index: number) => string }
> = {
  heading: { match: /^#{1,6}\s+/, prefix: () => "## " },
  bullets: { match: /^[-*]\s+/, prefix: () => "- " },
  numbers: { match: /^\d+\.\s+/, prefix: (index) => `${index + 1}. ` },
};

export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Writes the formatting into the stored text and says where the cursor lands.
 * The same rules as the blog editor's toolbar: she never types a hash or an
 * asterisk herself, and pressing a line button twice takes it off again.
 */
export function applyDescriptionFormat(
  id: DescriptionFormat,
  value: string,
  start: number,
  end: number,
): TextEdit {
  if (id === "bold" || id === "italic") {
    const { marker, placeholder } = WRAPPERS[id];
    const selected = value.slice(start, end) || placeholder;
    const inserted = `${marker}${selected}${marker}`;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + selected.length,
    };
  }

  if (id === "link") {
    const text = value.slice(start, end) || "the words people click";
    const href = "https://";
    const inserted = `[${text}](${href})`;
    const hrefStart = start + text.length + "[](".length;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: hrefStart,
      selectionEnd: hrefStart + href.length,
    };
  }

  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;

  const rule = LINE_RULES[id];
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const alreadyApplied = lines.every((line) => rule.match.test(line));
  const rewritten = lines
    .map((line, index) => {
      const bare = line.replace(rule.match, "");
      return alreadyApplied ? bare : rule.prefix(index) + bare;
    })
    .join("\n");

  return {
    value: value.slice(0, lineStart) + rewritten + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + rewritten.length,
  };
}
