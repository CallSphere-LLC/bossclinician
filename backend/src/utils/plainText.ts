/**
 * Control characters: invisible in every client, and a way to smuggle lookalike
 * text past a moderator reading the same string.
 */
const INVISIBLE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

const LETTER = /^[a-zA-Z]$/;
/** What turns a `<` in front of it into the start of markup. */
const MARKUP_OPENER = /^[a-zA-Z/!?]$/;

/**
 * Anything tag-shaped, removed rather than escaped.
 *
 * Escaping would store `&lt;script&gt;`, which reads as literal noise in a React
 * client that escapes again, and becomes live markup the moment anything renders
 * it as HTML. Removing means the stored row is text in every renderer that will
 * ever read it — the email digest, a CSV export, the moderation screen nobody
 * has written yet. An unterminated `<img onerror=...`, whose closing bracket the
 * author left off precisely so a pattern for whole tags would miss it, loses its
 * `<`; `<3` survives, because a digit is not the start of a tag.
 *
 * The guarantee is about the output, not the input: no `<` in what this returns
 * is followed by a letter, `/`, `!` or `?`. That is why it is one pass that
 * looks at what it has already kept, rather than a chain of `replace` calls.
 * The chain this replaces (strip whole tags, then stray `<`, then control
 * characters) let each step build what an earlier one had removed — `<<b>script`
 * lost its `<b>` and came out as `<script`, and `<`, BEL, `script` came out the
 * same way once the BEL went. The tag pattern it used was also quadratic on a
 * body of unclosed `<a` — each one scanned to the end of the string looking for
 * a `>` — which is a slow request from anyone who can post a comment.
 *
 * It lives in one place rather than beside one set of routes because every
 * surface a member's words are stored through has to agree: one sanitiser they
 * all call cannot drift the way two copies of it do.
 */
export function plainText(value: string): string {
  // Control characters first, so removing one can never join a `<` to a letter.
  const text = value.replace(INVISIBLE, "");
  const kept: string[] = [];
  // Index of the next `>` at or after the current position: -2 not yet looked
  // for, -1 none left. Positions only move forward, so the whole string is
  // searched at most once and this stays linear.
  let close = -2;

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    if (char === "<") {
      const next = text[i + 1] ?? "";
      const startsTag = LETTER.test(next) || (next === "/" && LETTER.test(text[i + 2] ?? ""));
      if (startsTag) {
        if (close !== -1 && close < i) close = text.indexOf(">", i);
        if (close !== -1) {
          // A whole tag, attributes and all.
          i = close + 1;
          continue;
        }
      }
      if (MARKUP_OPENER.test(next)) {
        // A tag with no end, or a `</`, `<!`, `<?`: the bracket goes, the text stays.
        i += 1;
        continue;
      }
    }

    // Removing a tag can leave a `<` that was kept earlier directly in front of
    // a letter: `<<b>x`. It is dropped here, at the join, where it becomes one.
    if (MARKUP_OPENER.test(char) && kept[kept.length - 1] === "<") kept.pop();
    kept.push(char);
    i += 1;
  }

  return kept.join("").trim();
}
