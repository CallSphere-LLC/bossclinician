/**
 * Plain-English helpers shared by every admin screen.
 *
 * The admin has exactly one reader — the business owner — and she never sees a
 * slug, a field key, an HTTP status or a parser message. The derivations and
 * translations that make that possible live here rather than being re-invented
 * per screen, so the whole console spells a web address one way, names a saved
 * answer one way, and says "that didn't work" one way.
 */

/** Combining marks left behind by `normalize("NFD")` — stripped to fold accents. */
const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * A title as she typed it → the URL-safe identifier stored as `slug`.
 *
 * Screens call this on save so the slug field never has to be shown: she types
 * "Raising Your Rates", we store "raising-your-rates", and she sees it back as
 * a web address. Deliberately identical to the backend's own slugify
 * (backend/src/routes/admin/community.ts) — a second spelling would give the
 * same title two different addresses depending on which side generated it.
 *
 * Accents are folded rather than dropped ("Café Notes" → "cafe-notes"), which
 * is the difference between a readable address and "caf-notes".
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    // The slice can land mid-separator; a trailing hyphen would show up in the
    // address preview she reads back.
    .replace(/-+$/, "");
}

/**
 * A question label → the stable snake_case key its answers are filed under.
 *
 * Every submission already collected is keyed by this string, so screens derive
 * it once when a question is created and never regenerate it on rename —
 * relabelling "Your email" to "Best email" must not orphan the answers people
 * have already given. Labels starting with a digit get a `field_` prefix so the
 * result is always a usable identifier ("2024 revenue" → "field_2024_revenue").
 */
export function fieldKey(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/, "");

  if (!base) return "field";
  return /^[0-9]/.test(base) ? `field_${base}` : base;
}

/**
 * Makes a generated key or slug unique against the ones already in use, by
 * suffixing 2, 3, … — two questions both called "Email" would otherwise
 * overwrite each other's answers, and two posts called "Welcome" would fight
 * over the same web address.
 *
 * Pass `separator: "-"` for slugs, which use hyphens rather than underscores.
 */
export function uniqueKey(base: string, taken: Iterable<string>, separator = "_"): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;

  let suffix = 2;
  while (used.has(`${base}${separator}${suffix}`)) suffix += 1;
  return `${base}${separator}${suffix}`;
}

/**
 * A stored key → something readable in a sentence.
 * `annualIncome` / `annual_income` / `annual income` all become "Annual income".
 *
 * Used wherever we render data whose shape we don't control — a form answer, a
 * saved page section, a lead's meta — so an unrecognised key still reads as a
 * label instead of leaking the machine name.
 */
export function humanizeKey(key: string): string {
  const sentence = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    // Sentence case rather than Title Case — "ctaLabel" becomes "Cta label",
    // which reads like a label on a form instead of a headline. Words that are
    // all capitals are left alone: they're acronyms she typed herself.
    .map((word) => (/^[A-Z][a-z]/.test(word) ? word[0].toLowerCase() + word.slice(1) : word))
    .join(" ");

  return sentence ? sentence[0].toUpperCase() + sentence.slice(1) : key;
}

/** British spelling, same function — some screens already say `humaniseKey`. */
export const humaniseKey = humanizeKey;

/** Pulls a numeric HTTP status off an ApiError without importing the class. */
function statusOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * Any thrown API error → one sentence she can act on.
 *
 * Screens call this instead of printing `err.message`: the server's own text is
 * written for developers ("Request failed (422)", "Invalid payload"), while the
 * status code is the part that reliably says what she should do next. We throw
 * the server's wording away on purpose — showing it is how "400" ends up on a
 * business owner's screen.
 *
 * `context` is the business noun the screen is working with — "post", "form",
 * "enquiry" — so a missing record reads as "We couldn't find that post."
 */
export function friendlyError(err: unknown, context: string): string {
  const status = statusOf(err);

  // "Session" is the one bit of developer vocabulary that used to survive here;
  // what she experiences is simply being signed out.
  if (status === 401 || status === 403) return "You've been signed out — please sign in again.";
  if (status === 404) return `We couldn't find that ${context}.`;
  if (status === 409) {
    return `That ${context} clashes with one you already have — try a different name.`;
  }
  if (status === 413) return "That file is too large.";
  if (status === 400 || status === 422) {
    return "Something in that form needs fixing — check the highlighted fields.";
  }
  if (status === 429) return "That was a lot at once — wait a moment and try again.";

  // Everything else — a 500, a dropped connection, a request that never left
  // the browser — is ours to fix, not hers to diagnose.
  return "Something went wrong on our end. Please try again in a moment.";
}

/** True for hosts that only ever appear during development. */
function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
}

/** Trims stray slashes so callers can pass "blog", "/blog" or "blog/" alike. */
function joinPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/**
 * The public address of a page, written the way she'd type it into a browser:
 *
 *   webAddress("blog", "raising-your-rates") → "yoursite.com/blog/raising-your-rates"
 *   webAddress("", "about")                 → "yoursite.com/about"
 *
 * This is what replaces the slug field on screen. The host comes from wherever
 * the admin is actually open, so on the live domain she reads her own domain
 * back; only local development falls through to the neutral placeholder.
 */
export function webAddress(prefix: string, slug: string): string {
  const host =
    typeof window === "undefined" || !window.location.host || isLocalHost(window.location.host)
      ? "yoursite.com"
      : window.location.host.replace(/^www\./i, "");
  return joinPath(host, prefix, slug);
}

/**
 * The same address with its label, for the grey line under a title:
 * "Web address: yoursite.com/blog/raising-your-rates".
 */
export function webAddressLabel(prefix: string, slug: string): string {
  return `Web address: ${webAddress(prefix, slug)}`;
}

/** The name the screens were given for {@link webAddress}; identical function. */
export const WEB_ADDRESS_HINT = webAddress;

/**
 * The full clickable link to send someone — "https://yoursite.com/f/apply".
 *
 * Distinct from {@link webAddress}, which is display text she reads; this is
 * what goes behind a Copy button or an "Open" link.
 */
export function shareLink(prefix: string, slug: string): string {
  const origin = typeof window === "undefined" ? "https://yoursite.com" : window.location.origin;
  return `${origin.replace(/\/+$/, "")}/${joinPath(prefix, slug)}`;
}

/**
 * "1 question" / "3 questions" — counts that read as English rather than as
 * "1 question(s)". Pass `plural` for the words that don't just take an "s"
 * ("enquiry" → "enquiries").
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Replaces the em-dash placeholder that litters the tables. "—" tells her
 * nothing; "None yet" says the number is real and simply hasn't happened.
 */
export function orNone(value: string | number | null | undefined, fallback = "None yet"): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text && text !== "—" ? text : fallback;
}

/**
 * The one wording for the published/draft pair. Every screen that shows a
 * status badge reads from here, so "Live on your site" never drifts into
 * "Published" on one page and "Live" on the next.
 */
export const PUBLISH_LABEL = {
  live: "Live on your site",
  draft: "Not visible yet",
} as const;

/** Badge/checkbox text for a published flag. */
export function publishLabel(isLive: boolean): string {
  return isLive ? PUBLISH_LABEL.live : PUBLISH_LABEL.draft;
}
