const TAG = /<\/?[a-zA-Z][^>]*>/g;
const TAG_OPENER = /<(?=[a-zA-Z/!?])/g;

/**
 * Control characters: invisible in every client, and a way to smuggle lookalike
 * text past a moderator reading the same string.
 */
const INVISIBLE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

/**
 * Anything tag-shaped, removed rather than escaped.
 *
 * Escaping would store `&lt;script&gt;`, which reads as literal noise in a React
 * client that escapes again, and becomes live markup the moment anything renders
 * it as HTML. Removing means the stored row is text in every renderer that will
 * ever read it — the email digest, a CSV export, the moderation screen nobody
 * has written yet. The second pass catches an unterminated `<img onerror=...`
 * whose closing bracket the author left off precisely so the first pass would
 * miss it; `<3` survives both, because a digit is not the start of a tag.
 *
 * It lives in one place rather than beside one set of routes because every
 * surface a member's words are stored through has to agree: one sanitiser they
 * all call cannot drift the way two copies of it do.
 */
export function plainText(value: string): string {
  return value.replace(TAG, "").replace(TAG_OPENER, "").replace(INVISIBLE, "").trim();
}
