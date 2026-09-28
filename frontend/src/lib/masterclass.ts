/**
 * The two addresses of the free masterclass and what passes between them.
 *
 * /freedom-masterclass takes a first name and an email, files them with the
 * `freedom-masterclass` form (migration 077), and sends the visitor to
 * /watch-now?email=…&name=… — the same query her Kajabi page used, so a link
 * she has already sent anybody keeps working.
 */

/** The form the sign-up posts to. Created by migration 077. */
export const MASTERCLASS_FORM_SLUG = "freedom-masterclass";

export const MASTERCLASS_ROUTE = "/freedom-masterclass";
export const WATCH_NOW_ROUTE = "/watch-now";

/** The action guide shipped with the site (public/downloads), used until she sets another. */
export const DEFAULT_ACTION_GUIDE = "/downloads/practice-freedom-audit.pdf";

/** Where a registration lands. Both values are encoded; either may be blank. */
export function watchNowPath(firstName: string, email: string): string {
  const query = new URLSearchParams();
  const address = email.trim();
  const name = firstName.trim();
  if (address) query.set("email", address);
  if (name) query.set("name", name);
  const qs = query.toString();
  return qs ? `${WATCH_NOW_ROUTE}?${qs}` : WATCH_NOW_ROUTE;
}

/** Longer than any first name worth greeting; short enough to keep a sentence a sentence. */
const NAME_MAX = 40;

/**
 * Up to three words of letters (any script), with the marks, apostrophes and
 * hyphens real names carry — "Mary-Kate", "D'Andre", "Zoë" — and a full stop
 * only at the end of a word, for initials ("J. R."). A stop inside a word is
 * how a domain name reads, so "evil.example" is not a name.
 */
const NAME_WORD = String.raw`\p{L}[\p{L}\p{M}'’-]*\.?`;
const NAME_SHAPE = new RegExp(`^${NAME_WORD}(?: ${NAME_WORD}){0,2}$`, "u");

/**
 * The name to greet a visitor by, read from the page's own query string — or
 * null, and the page says "Welcome" without one.
 *
 * React escapes whatever it renders, so markup is not the risk. The risk is a
 * crafted link that puts a sentence after "Welcome," on a page with the owner's
 * name on it ("…your account is suspended, call…"). So only something shaped
 * like a name is ever shown: letters and the punctuation names use, a few words
 * at most, nothing that reads as a URL or a message.
 */
export function greetingName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    // Controls and invisible formatting characters, then runs of whitespace.
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > NAME_MAX) return null;
  return NAME_SHAPE.test(cleaned) ? cleaned : null;
}
