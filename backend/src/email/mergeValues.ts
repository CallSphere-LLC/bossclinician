/**
 * What every `{{token}}` in a marketing email becomes for one reader.
 *
 * Broadcasts and sequences used to build this by hand, three values each, while
 * the composer's picker offered twelve — and `renderTokens` blanks whatever it
 * is not given, so `{{lastName}}` and `{{unsubscribeUrl}}` went out as nothing
 * at all. Both senders build their values here now, and the picker's list is
 * checked against `MARKETING_MERGE_KEYS` so the two cannot drift apart again.
 *
 * Pure on purpose: no database, no environment. The links are handed in (see
 * `mergeLinks` in the provider), which is what lets this be tested without
 * either.
 */

export interface MergeContact {
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** IANA zone, used only to decide which day `{{date}}` falls on. */
  timezone?: string | null;
  /** The `contacts.custom_fields` jsonb, exactly as it came off the row. */
  customFields?: unknown;
}

export interface MergeLinks {
  /** Blank when there is no contact to mint a link for. */
  unsubscribeUrl: string;
  loginUrl: string;
  startUrl: string;
}

/** Every built-in token a marketing send can resolve. Custom fields are extra. */
export const MARKETING_MERGE_KEYS = [
  "firstName",
  "lastName",
  "name",
  "email",
  "date",
  "loginUrl",
  "startUrl",
  "unsubscribeUrl",
] as const;

/* ------------------------------------------------------------ the picker */

/**
 * Who can resolve a token.
 *
 * `all`: anything with a reader behind it — broadcasts, sequences, and the
 * transactional templates. `transactional`: only an email about one particular
 * purchase, course or community, which a newsletter has none of.
 */
export type MergeTagScope = "all" | "transactional";

export const MERGE_TAG_SOURCES = ["broadcast", "sequence", "transactional"] as const;
export type MergeTagSource = (typeof MERGE_TAG_SOURCES)[number];

export interface MergeTagEntry {
  token: string;
  label: string;
  example: string;
  scope: MergeTagScope;
}

/**
 * 3.5. Every token the composer understands, with what it becomes.
 *
 * Served rather than hardcoded in the client for one reason: the list has to
 * agree with what the renderer actually substitutes. A picker offering
 * `{{courseName}}` that renders as the literal text is worse than no picker,
 * because it puts the broken token into the email under Yvette's name.
 *
 * Which is exactly what happened once the renderer started blanking unknown
 * tokens: a broadcast has no course, so `{{courseName}}` went out as nothing.
 * Hence `scope`, and `mergeTagsFor` below.
 */
export const MERGE_TAGS: readonly MergeTagEntry[] = [
  { token: "{{firstName}}", label: "First name", example: "Yvette", scope: "all" },
  { token: "{{lastName}}", label: "Last name", example: "Howard", scope: "all" },
  { token: "{{name}}", label: "Full name", example: "Yvette Howard", scope: "all" },
  { token: "{{email}}", label: "Email address", example: "yvette@example.com", scope: "all" },
  { token: "{{offerName}}", label: "What they bought", example: "The B.O.S.S Blueprint", scope: "transactional" },
  { token: "{{courseName}}", label: "Course name", example: "Practice Reset Intensive", scope: "transactional" },
  { token: "{{communityName}}", label: "Community name", example: "The Boss", scope: "transactional" },
  { token: "{{total}}", label: "Amount paid", example: "$19.00", scope: "transactional" },
  { token: "{{date}}", label: "The date in question", example: "September 15", scope: "all" },
  { token: "{{loginUrl}}", label: "Sign-in link", example: "https://…/login", scope: "all" },
  { token: "{{startUrl}}", label: "Their library", example: "https://…/library", scope: "all" },
  { token: "{{unsubscribeUrl}}", label: "Unsubscribe link", example: "https://…/email/prefs", scope: "all" },
];

/**
 * The tokens one kind of email can actually fill in.
 *
 * No source at all returns everything, which is what the endpoint did before
 * it took one.
 */
export function mergeTagsFor(source?: MergeTagSource): MergeTagEntry[] {
  if (source === undefined || source === "transactional") return [...MERGE_TAGS];
  return MERGE_TAGS.filter((tag) => tag.scope === "all").map((tag) =>
    // In a receipt `{{date}}` is the date of the thing being confirmed; in a
    // newsletter it can only be the day it goes out, and the picker says so.
    tag.token === "{{date}}" ? { ...tag, label: "Today's date" } : tag
  );
}

/** How a `custom_fields` key is spelt inside `{{custom.…}}`. Blank when it cannot be. */
export function customTokenKey(rawKey: string): string {
  return rawKey.trim().replace(/[^\w.]+/g, "_");
}

/** "Hi there," rather than "Hi ," when we were never told a name. */
export function greetingName(name: string, firstName: string): string {
  if (firstName.trim()) return firstName.trim();
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}

/** The stored last name, else everything after the first word of the full name. */
export function familyName(name: string, lastName: string): string {
  if (lastName.trim()) return lastName.trim();
  return name.trim().split(/\s+/).slice(1).join(" ");
}

/** "September 15", on the reader's own calendar where we know their zone. */
export function formatMergeDate(now: Date, timeZone?: string | null): string {
  const format = (zone: string | undefined): string =>
    new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: zone }).format(now);
  try {
    return format(timeZone?.trim() || undefined);
  } catch {
    // An unrecognised zone on a contact row must not stop the email going out.
    return format("UTC");
  }
}

/**
 * `contacts.custom_fields` flattened to `custom.<key>` tokens.
 *
 * Only plain values: a nested object has no sensible way to read in a
 * sentence, and "[object Object]" in an email is worse than a blank. A key the
 * token syntax cannot spell (`{{ }}` allows letters, digits, `_` and `.`) is
 * offered with the awkward characters turned into underscores.
 */
export function customFieldValues(customFields: unknown): Record<string, string> {
  const values: Record<string, string> = {};
  if (customFields === null || typeof customFields !== "object" || Array.isArray(customFields)) {
    return values;
  }

  for (const [rawKey, raw] of Object.entries(customFields as Record<string, unknown>)) {
    const key = customTokenKey(rawKey);
    if (!key) continue;

    let value: string;
    if (raw === null || raw === undefined) value = "";
    else if (typeof raw === "string") value = raw;
    else if (typeof raw === "number" || typeof raw === "boolean") value = String(raw);
    else continue;

    const token = `custom.${key}`;
    // Two keys that collapse to the same token: the first one keeps it.
    if (!(token in values)) values[token] = value;
  }
  return values;
}

export function buildMergeValues(
  contact: MergeContact,
  links: MergeLinks,
  now: Date = new Date()
): Record<string, string> {
  const name = contact.name ?? "";
  return {
    ...customFieldValues(contact.customFields),
    firstName: greetingName(name, contact.firstName ?? ""),
    lastName: familyName(name, contact.lastName ?? ""),
    name: name.trim() || contact.email,
    email: contact.email,
    date: formatMergeDate(now, contact.timezone),
    loginUrl: links.loginUrl,
    startUrl: links.startUrl,
    unsubscribeUrl: links.unsubscribeUrl,
  };
}
