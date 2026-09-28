import { z } from "zod";
import { badRequest } from "../utils/httpError";

/**
 * The People list's segments, filters and sorts, laid out the way Kajabi's
 * contacts screen lays them out (QA sheet rows 22 and 23), and compiled here
 * into SQL.
 *
 * Kept free of the database pool on purpose: every builder in this file is a
 * pure function from a validated choice to a SQL fragment plus bind values, so
 * the whole whitelist can be exercised by a unit test without Postgres, and
 * the route (routes/admin/contacts.ts) is left to fetch what it needs and run
 * the query.
 *
 * The safety rule is the one services/segments.ts states for saved segments,
 * and for the same reason: a filter row is data somebody typed into a URL, so
 * nothing from it is ever spliced into SQL. The category and the conditional
 * are looked up in the tables below — anything not in them is refused — and
 * every value travels as a bind parameter through `param`. Column expressions
 * come only from fixed literals written in this file.
 */

/* ------------------------------------------------------------------ words */

/**
 * Email-marketing states, as Kajabi words them.
 *
 * `never_subscribed` arrived with migration 075: Kajabi tells "never agreed to
 * marketing" apart from "agreed, then opted out", and mapping the first onto
 * `unconfirmed` would have made those people mailable (MAILABLE_CONTACT_SQL
 * sends to unconfirmed). Every sending gate treats it as "do not send".
 */
export const EMAIL_STATUS_WORDS = {
  subscribed: "Subscribed",
  opted_out: "Opted out",
  bounced: "Hard bounced",
  complained: "Marked as spam",
  unconfirmed: "Unconfirmed",
  never_subscribed: "Never subscribed",
} as const;

export type EmailMarketingStatus = keyof typeof EMAIL_STATUS_WORDS;
export const EMAIL_MARKETING_STATUSES = Object.keys(EMAIL_STATUS_WORDS) as EmailMarketingStatus[];

/* ---------------------------------------------------------------- segments */

/**
 * Somebody who has paid for something, or been handed an offer.
 *
 * `order_count` is the denormalised rollup (paid and refunded orders); the
 * direct order check covers the hour before the rollup catches up with a new
 * purchase, and the grant check counts an offer given away, which Kajabi counts
 * as a customer too.
 */
export const CUSTOMER_SQL = `(c.order_count > 0
  OR EXISTS (SELECT 1 FROM orders o WHERE o.contact_id = c.id AND o.status = 'paid')
  OR EXISTS (SELECT 1 FROM members m JOIN access_grants ag ON ag.member_id = m.id
              WHERE m.contact_id = c.id AND ag.offer_id IS NOT NULL AND ag.status = 'active'))`;

/**
 * Kajabi's "Last Sign In At", which the importer kept as a custom field.
 *
 * Only a value in exactly Kajabi's shape (`2026-09-12 21:15:09 -0700`) is cast.
 * A cast of anything else would throw and take the whole list query with it, so
 * a malformed or hand-edited value simply doesn't count as a sign-in.
 */
const KAJABI_SIGN_IN_SQL = `CASE WHEN c.custom_fields->>'Last Sign In At'
    ~ '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} [+-]\\d{4}$'
  THEN (c.custom_fields->>'Last Sign In At')::timestamptz END`;

/**
 * The last time this person did something themselves, for "Inactive".
 *
 * Built only from facts the rebuild actually holds:
 *  - an email opened or clicked (email_messages, sent from this site);
 *  - a sign-in (members.last_login_at here, Kajabi's own last sign-in for the
 *    people brought over);
 *  - a purchase (last_ordered_at);
 *  - `last_activity_at`, which the importer filled from Kajabi's own "Last
 *    Activity" column — the only record of their Kajabi-era opens and clicks,
 *    because Kajabi's email history was not in the export.
 * Floored at `created_at`, so somebody who joined last week is not "inactive"
 * for want of 90 days in which to be active. GREATEST skips NULLs, so a person
 * with no history at all falls back to the day they were added.
 */
export const LAST_ENGAGED_SQL = `GREATEST(
  c.created_at,
  c.last_activity_at,
  c.last_ordered_at,
  (SELECT MAX(GREATEST(m.first_opened_at, m.first_clicked_at)) FROM email_messages m WHERE m.contact_id = c.id),
  (SELECT MAX(mb.last_login_at) FROM members mb WHERE mb.contact_id = c.id),
  ${KAJABI_SIGN_IN_SQL}
)`;

/**
 * Kajabi's "Inactive": subscribed, and nothing from them in 90 days.
 *
 * Kajabi does not publish its exact rule; this is the closest honest reading
 * of it from the data above. Only subscribed people are in it, because the
 * segment exists to find the part of the mailing list that has gone quiet.
 */
export const INACTIVE_SQL = `(c.email_marketing_status = 'subscribed'
  AND ${LAST_ENGAGED_SQL} < now() - interval '90 days')`;

/** Kajabi's built-in segments, in Kajabi's order. Saved segments and "team" follow them. */
export const BUILT_IN_SEGMENTS = [
  { key: "all", label: "All Contacts", sql: "TRUE" },
  { key: "customers", label: "Customers", sql: CUSTOMER_SQL },
  { key: "subscribed", label: "Subscribed", sql: `c.email_marketing_status = 'subscribed'` },
  { key: "inactive", label: "Inactive", sql: INACTIVE_SQL },
  { key: "hard_bounced", label: "Hard Bounced", sql: `c.email_marketing_status = 'bounced'` },
] as const;

/** The rebuild's own addition, always last in the list: the people who built and tested it. */
export const TEAM_SEGMENT = { key: "team", label: "Team & test accounts" } as const;

/** A saved segment travels as `saved-<id>` so one query key names every choice. */
export const SEGMENT_PATTERN = /^(all|customers|subscribed|inactive|hard_bounced|team|saved-[1-9]\d{0,8})$/;

export function savedSegmentId(segment: string | undefined): number | null {
  const match = /^saved-([1-9]\d{0,8})$/.exec(segment ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * Hidden from every count unless asked for (migration 075). The flag is about
 * this screen only — it has no part in who is emailed.
 */
export const NOT_INTERNAL_SQL = "NOT c.is_internal";
export const INTERNAL_SQL = "c.is_internal";

/* ------------------------------------------------------------------ sorts */

/**
 * Kajabi's sort menu, word for word and in its order.
 *
 * ORDER BY comes from this fixed map rather than the query string: an ORDER BY
 * assembled from a parameter is the same injection hole a WHERE is. Every
 * order ends on the id so paging is stable when two rows tie.
 */
export const CONTACT_SORTS = {
  name_asc: { label: "Name A–Z", sql: "NULLIF(lower(c.name), '') ASC NULLS LAST, lower(c.email::text) ASC, c.id ASC" },
  name_desc: { label: "Name Z–A", sql: "NULLIF(lower(c.name), '') DESC NULLS LAST, lower(c.email::text) DESC, c.id DESC" },
  email_asc: { label: "Email A–Z", sql: "lower(c.email::text) ASC, c.id ASC" },
  email_desc: { label: "Email Z–A", sql: "lower(c.email::text) DESC, c.id DESC" },
  value_desc: { label: "Lifetime Value (most first)", sql: "c.lifetime_value_cents DESC, c.id DESC" },
  value_asc: { label: "Lifetime Value (least first)", sql: "c.lifetime_value_cents ASC, c.id ASC" },
  added_asc: { label: "Added date (oldest first)", sql: "c.created_at ASC, c.id ASC" },
  added_desc: { label: "Added date (newest first)", sql: "c.created_at DESC, c.id DESC" },
  activity_asc: { label: "Last activity (oldest first)", sql: "c.last_activity_at ASC NULLS LAST, c.id ASC" },
  activity_desc: { label: "Last activity (newest first)", sql: "c.last_activity_at DESC NULLS LAST, c.id DESC" },
} as const;

export type ContactSort = keyof typeof CONTACT_SORTS;
export const CONTACT_SORT_KEYS = Object.keys(CONTACT_SORTS) as ContactSort[];
export const DEFAULT_CONTACT_SORT: ContactSort = "added_desc";

/**
 * The sort words the list used before it matched Kajabi. Still accepted, so a
 * bookmarked link or the voice assistant's lookup keeps working.
 */
export const LEGACY_SORTS = {
  recent: "activity_desc",
  newest: "added_desc",
  oldest: "added_asc",
  name: "name_asc",
  value: "value_desc",
  orders: "orders",
} as const;

const ORDERS_SORT_SQL = "c.order_count DESC, c.id DESC";

export function sortSql(sort: string | undefined): string {
  if (sort && Object.prototype.hasOwnProperty.call(CONTACT_SORTS, sort)) {
    return CONTACT_SORTS[sort as ContactSort].sql;
  }
  if (sort && Object.prototype.hasOwnProperty.call(LEGACY_SORTS, sort)) {
    const target = LEGACY_SORTS[sort as keyof typeof LEGACY_SORTS];
    return target === "orders" ? ORDERS_SORT_SQL : CONTACT_SORTS[target].sql;
  }
  return CONTACT_SORTS[DEFAULT_CONTACT_SORT].sql;
}

export const SORT_PARAM_VALUES = [...CONTACT_SORT_KEYS, ...Object.keys(LEGACY_SORTS)] as [string, ...string[]];

/* ---------------------------------------------------------- filter values */

/** Days offered wherever a filter asks "in the last…". */
export const DAY_CHOICES = [7, 14, 30, 60, 90, 180, 365] as const;
/** Kajabi's engagement windows. */
export const ENGAGEMENT_DAY_CHOICES = [30, 60, 90] as const;

/** "Contact was added" presets; `custom` carries its own `from~to`. */
export const DATE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "last_7_days", label: "In the last 7 days" },
  { key: "last_30_days", label: "In the last 30 days" },
  { key: "last_90_days", label: "In the last 90 days" },
  { key: "last_365_days", label: "In the last 12 months" },
  { key: "this_month", label: "This month" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Between two dates…" },
] as const;

/**
 * Kajabi's default contact fields, and the fixed column each one reads.
 *
 * The address fields live in `custom_fields` because that is where the
 * importer put Kajabi's address columns; they are still Kajabi defaults, so
 * they are offered here rather than under Custom Fields.
 */
export const DEFAULT_FIELDS = {
  name: { label: "Name", sql: "c.name" },
  first_name: { label: "First name", sql: "c.first_name" },
  last_name: { label: "Last name", sql: "c.last_name" },
  email: { label: "Email", sql: "c.email::text" },
  phone: { label: "Phone number", sql: "c.phone" },
  address: { label: "Address", sql: "COALESCE(c.custom_fields->>'Address', '')" },
  city: { label: "City", sql: "COALESCE(c.custom_fields->>'City', '')" },
  state: { label: "State", sql: "COALESCE(c.custom_fields->>'State', '')" },
  country: { label: "Country", sql: "COALESCE(c.custom_fields->>'Country', '')" },
  zip: { label: "Zip code", sql: "COALESCE(c.custom_fields->>'Zip Code', '')" },
  timezone: { label: "Time zone", sql: "c.timezone" },
} as const;

type DefaultField = keyof typeof DEFAULT_FIELDS;

/* ------------------------------------------------------------ the catalog */

/**
 * What the value box of a filter row holds.
 *  - none:       nothing more to choose ("is a customer").
 *  - choice:     one item from an option list the route supplies (`options`).
 *  - days:       a number of days from DAY_CHOICES / ENGAGEMENT_DAY_CHOICES.
 *  - date_range: a DATE_PRESETS key, or `custom` with `text` = "YYYY-MM-DD~YYYY-MM-DD".
 *  - money:      dollars.
 *  - field:      a field from `options`, and nothing to compare it with.
 *  - field_text: a field from `options`, compared with `text`.
 */
export type FilterValueKind = "none" | "choice" | "days" | "engagement_days" | "date_range" | "money" | "field" | "field_text";

/** The option lists a value box can draw from. The route fills the database-backed ones. */
export type FilterOptionList =
  | "assessments"
  | "coupons"
  | "broadcasts"
  | "sequences"
  | "events"
  | "forms"
  | "newsletters"
  | "offers"
  | "products"
  | "tags"
  | "customFields"
  | "defaultFields"
  | "statuses";

interface BuildContext {
  value: string;
  text: string;
  /** Binds a value and hands back its placeholder. The only way a value reaches SQL. */
  param: (value: unknown) => string;
  /** The site's zone, for calendar days ("today", "this month", a date range). */
  timeZone: string;
}

interface ConditionalSpec {
  key: string;
  label: string;
  value: FilterValueKind;
  options?: FilterOptionList;
  /**
   * Set when Kajabi has the conditional and this site has nothing it could be
   * answered from. It is listed so the menu matches Kajabi's, and refused if
   * sent, because an empty result would be a made-up answer.
   */
  unavailable?: string;
  build?: (ctx: BuildContext) => string;
}

interface CategorySpec {
  key: string;
  label: string;
  /** One line under the category when its data is thinner than Kajabi's. */
  note?: string;
  conditionals: ConditionalSpec[];
}

/* ---- value readers: each refuses rather than guesses ---- */

function asId(value: string, what: string): number {
  if (!/^[1-9]\d{0,8}$/.test(value)) throw badRequest(`Choose ${what} for that filter`);
  return Number(value);
}

/**
 * An offer or product, by id — or, for something only the Kajabi import knows
 * about, by title (`t:<title>`). Most of her Kajabi purchases name offers that
 * were never rebuilt here, so a title is the only handle there is on them.
 */
function asCatalogRef(value: string, what: string): { id: number } | { title: string } {
  if (/^[1-9]\d{0,8}$/.test(value)) return { id: Number(value) };
  const titled = /^t:(.{1,300})$/s.exec(value);
  if (titled && titled[1].trim()) return { title: titled[1].trim() };
  throw badRequest(`Choose ${what} for that filter`);
}

function asText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw badRequest("Type something for that filter to look for");
  return trimmed.slice(0, 300);
}

function asDays(value: string, allowed: readonly number[]): number {
  const days = Number(value);
  if (!allowed.includes(days)) throw badRequest("Choose how many days that filter looks back");
  return days;
}

function asCents(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) throw badRequest("Lifetime value needs an amount in dollars");
  return Math.round(Number(cleaned) * 100);
}

function asStatus(value: string): EmailMarketingStatus {
  if (!(EMAIL_MARKETING_STATUSES as string[]).includes(value)) {
    throw badRequest("Choose an email marketing status for that filter");
  }
  return value as EmailMarketingStatus;
}

function asCustomField(value: string): string {
  if (!value || value.length > 600) throw badRequest("Choose which custom field to look at");
  return value;
}

function asDefaultField(value: string): DefaultField {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_FIELDS, value)) {
    throw badRequest("Choose which field to look at");
  }
  return value as DefaultField;
}

function realDay(raw: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Escapes the characters LIKE reads as syntax, so searching for "100%" finds it. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * A date range as a `created_at` predicate, cut at midnight in the site's zone
 * — "today" is the owner's today, not UTC's.
 */
function dateRangeSql(column: string, ctx: BuildContext): string {
  const zone = () => `${ctx.param(ctx.timeZone)}::text`;
  const startOf = (unit: "day" | "month" | "year") =>
    `(date_trunc('${unit}', now() AT TIME ZONE ${zone()}) AT TIME ZONE ${zone()})`;
  switch (ctx.value) {
    case "today":
      return `${column} >= ${startOf("day")}`;
    case "last_7_days":
    case "last_30_days":
    case "last_90_days":
    case "last_365_days": {
      const days = Number(ctx.value.replace(/\D/g, ""));
      return `${column} >= now() - make_interval(days => ${ctx.param(days)}::int)`;
    }
    case "this_month":
      return `${column} >= ${startOf("month")}`;
    case "this_year":
      return `${column} >= ${startOf("year")}`;
    case "custom": {
      const match = /^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/.exec(ctx.text.trim());
      if (!match || !realDay(match[1]) || !realDay(match[2]) || match[1] > match[2]) {
        throw badRequest("Choose a start and an end date for that filter");
      }
      // The end day is included: the range runs to midnight after it.
      return `(${column} >= (${ctx.param(match[1])}::date)::timestamp AT TIME ZONE ${zone()}
        AND ${column} < ((${ctx.param(match[2])}::date) + 1)::timestamp AT TIME ZONE ${zone()})`;
    }
    default:
      throw badRequest("Choose when they were added for that filter");
  }
}

/** Text comparisons, shared by Custom Fields and Default Fields. */
function fieldTextSql(op: string, column: string, ctx: BuildContext): string {
  const folded = `lower(COALESCE(${column}, ''))`;
  switch (op) {
    case "is":
      return `${folded} = lower(${ctx.param(asText(ctx.text))}::text)`;
    case "is_not":
      return `${folded} <> lower(${ctx.param(asText(ctx.text))}::text)`;
    case "contains":
      return `${folded} LIKE ${ctx.param(likePattern(asText(ctx.text).toLowerCase()))}`;
    case "empty":
      return `COALESCE(${column}, '') = ''`;
    case "not_empty":
      return `COALESCE(${column}, '') <> ''`;
    default:
      throw badRequest("That filter asks for a comparison we can't make");
  }
}

const FIELD_TEXT_CONDITIONALS = [
  { key: "is", label: "is", value: "field_text" },
  { key: "is_not", label: "is not", value: "field_text" },
  { key: "contains", label: "contains", value: "field_text" },
  { key: "empty", label: "is empty", value: "field" },
  { key: "not_empty", label: "is not empty", value: "field" },
] as const;

/** Letters and digits only, lower case: how an imported title is matched to one of ours. */
function normalisedTitle(expr: string): string {
  return `regexp_replace(lower(${expr}), '[^a-z0-9]+', '', 'g')`;
}

/**
 * Whether Kajabi's "Products" column, kept on the contact by the importer,
 * names this product. Kajabi appends "archived <epoch>" to a retired product,
 * which is stripped the same way the importer strips it for the tags. Titles
 * are compared on letters and digits only, so "🔥 RAMP-UP RATE FORMULA" here
 * matches "Ramp-Up Rate Formula" there. A product title with a comma in it
 * would be split by this — none of hers has one.
 */
function kajabiProductListed(titleExpr: string): string {
  const name = `regexp_replace(kp.name, '\\s+archived\\s+\\d+\\s*$', '', 'i')`;
  return `EXISTS (SELECT 1 FROM unnest(string_to_array(COALESCE(c.custom_fields->>'Products', ''), ',')) AS kp(name)
                   WHERE ${normalisedTitle(name)} = ${normalisedTitle(titleExpr)}
                     AND ${normalisedTitle(titleExpr)} <> '')`;
}

/**
 * A paid order for an offer: by the offer itself, by a line of a cart, or — for
 * the Kajabi payments, which were imported with a title and no offer — by the
 * title the payment names.
 */
function offerPurchasedSql(ref: { id: number } | { title: string }, ctx: BuildContext): string {
  if ("id" in ref) {
    const id = ctx.param(ref.id);
    return `EXISTS (SELECT 1 FROM orders o
                     WHERE o.contact_id = c.id AND o.status = 'paid'
                       AND (o.offer_id = ${id}
                            OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.offer_id = ${id})
                            OR (o.offer_id IS NULL
                                AND ${normalisedTitle("o.course_title")} =
                                    (SELECT ${normalisedTitle("f.title")} FROM offers f WHERE f.id = ${id}))))`;
  }
  return `EXISTS (SELECT 1 FROM orders o
                   WHERE o.contact_id = c.id AND o.status = 'paid'
                     AND ${normalisedTitle("o.course_title")} = ${normalisedTitle(`${ctx.param(ref.title)}::text`)})`;
}

/** Access held on this site, through a grant that is still live. */
function grantSql(column: "offer_id" | "product_id", id: string): string {
  return `EXISTS (SELECT 1 FROM members m JOIN access_grants ag ON ag.member_id = m.id
                   WHERE m.contact_id = c.id AND ag.${column} = ${id} AND ag.status = 'active'
                     AND (ag.expires_at IS NULL OR ag.expires_at > now()))`;
}

function offerAccessSql(ctx: BuildContext): string {
  const ref = asCatalogRef(ctx.value, "an offer");
  // A Kajabi purchase is the only record of Kajabi-era access: nobody brought
  // over was given a grant here. So having bought it counts as having it.
  if ("title" in ref) return offerPurchasedSql(ref, ctx);
  return `(${grantSql("offer_id", ctx.param(ref.id))} OR ${offerPurchasedSql(ref, ctx)})`;
}

function productAccessSql(ctx: BuildContext): string {
  const ref = asCatalogRef(ctx.value, "a product");
  if ("title" in ref) return kajabiProductListed(`${ctx.param(ref.title)}::text`);
  const id = ctx.param(ref.id);
  return `(${grantSql("product_id", id)}
           OR ${kajabiProductListed(`(SELECT p.title FROM products p WHERE p.id = ${id})`)})`;
}

function assessmentSql(ctx: BuildContext, extra: string): string {
  return `EXISTS (SELECT 1 FROM assessment_attempts aa
                   WHERE aa.assessment_id = ${ctx.param(asId(ctx.value, "an assessment"))}
                     AND (aa.contact_id = c.id OR (aa.contact_id IS NULL AND aa.email <> '' AND aa.email = c.email))
                     AND aa.completed_at IS NOT NULL ${extra})`;
}

function couponUsedSql(ctx: BuildContext): string {
  const id = ctx.param(asId(ctx.value, "a coupon"));
  return `(EXISTS (SELECT 1 FROM coupon_redemptions r
                    WHERE r.coupon_id = ${id} AND r.released_at IS NULL
                      AND (r.email = c.email
                           OR r.order_id IN (SELECT o.id FROM orders o WHERE o.contact_id = c.id)))
           OR EXISTS (SELECT 1 FROM orders o
                       WHERE o.contact_id = c.id AND o.coupon_id = ${id} AND o.status IN ('paid', 'refunded')))`;
}

/** Opened (or clicked) an email sent from this site within the window. */
function emailEventSql(kind: "opened" | "clicked" | "engaged", days: number, ctx: BuildContext): string {
  const since = `now() - make_interval(days => ${ctx.param(days)}::int)`;
  const first =
    kind === "opened"
      ? `m.first_opened_at >= ${since}`
      : kind === "clicked"
        ? `m.first_clicked_at >= ${since}`
        : `(m.first_opened_at >= ${since} OR m.first_clicked_at >= ${since})`;
  const eventKinds = kind === "engaged" ? `('opened', 'clicked')` : `('${kind}')`;
  return `EXISTS (SELECT 1 FROM email_messages m
                   WHERE m.contact_id = c.id
                     AND (${first}
                          OR EXISTS (SELECT 1 FROM email_events e
                                      WHERE e.message_id = m.id AND e.kind IN ${eventKinds}
                                        AND e.occurred_at >= ${since})))`;
}

function broadcastSql(ctx: BuildContext, extra: string): string {
  return `EXISTS (SELECT 1 FROM email_sends s
                   WHERE s.campaign_id = ${ctx.param(asId(ctx.value, "a broadcast"))}
                     AND s.status = 'sent'
                     AND (s.contact_id = c.id OR (s.contact_id IS NULL AND lower(s.email) = lower(c.email::text)))
                     ${extra})`;
}

function sequenceSql(ctx: BuildContext, status: "active" | "completed"): string {
  return `EXISTS (SELECT 1 FROM sequence_subscriptions ss
                   WHERE ss.contact_id = c.id AND ss.sequence_id = ${ctx.param(asId(ctx.value, "an email sequence"))}
                     AND ss.status = '${status}')`;
}

function eventSql(ctx: BuildContext, extra: string): string {
  return `EXISTS (SELECT 1 FROM event_registrations er
                   WHERE er.event_id = ${ctx.param(asId(ctx.value, "an event"))}
                     AND (er.contact_id = c.id OR (er.contact_id IS NULL AND er.email = c.email))
                     ${extra})`;
}

function formSql(ctx: BuildContext): string {
  return `EXISTS (SELECT 1 FROM form_submissions fs
                   WHERE fs.form_id = ${ctx.param(asId(ctx.value, "a form"))}
                     AND (fs.contact_id = c.id
                          OR (fs.contact_id IS NULL AND fs.email <> '' AND lower(fs.email) = lower(c.email::text))))`;
}

function newsletterSql(ctx: BuildContext): string {
  return `EXISTS (SELECT 1 FROM newsletter_subscriptions ns
                   WHERE ns.newsletter_id = ${ctx.param(asId(ctx.value, "a newsletter"))}
                     AND ns.status = 'subscribed'
                     AND (ns.email = c.email
                          OR ns.member_id IN (SELECT m.id FROM members m WHERE m.contact_id = c.id)))`;
}

function tagSql(ctx: BuildContext): string {
  const slug = ctx.value.trim();
  if (!slug || slug.length > 80) throw badRequest("Choose a tag for that filter");
  return `EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
                   WHERE ct.contact_id = c.id AND t.slug = ${ctx.param(slug)}::citext)`;
}

const not = (sql: string) => `NOT ${sql}`;

/**
 * Kajabi's filter categories, in Kajabi's order, and the conditionals each one
 * offers here.
 *
 * Every category Kajabi lists is here, so the menu reads the same. Where the
 * rebuild holds less than Kajabi did — no hidden contacts, no Kajabi email
 * history — the category says so in its note and offers only what it can
 * answer truthfully.
 */
export const FILTER_CATEGORIES: CategorySpec[] = [
  {
    key: "assessment",
    label: "Assessment",
    conditionals: [
      { key: "completed", label: "completed", value: "choice", options: "assessments", build: (ctx) => assessmentSql(ctx, "") },
      { key: "not_completed", label: "did not complete", value: "choice", options: "assessments", build: (ctx) => not(assessmentSql(ctx, "")) },
      { key: "passed", label: "passed", value: "choice", options: "assessments", build: (ctx) => assessmentSql(ctx, "AND aa.passed IS TRUE") },
      {
        key: "failed",
        label: "failed",
        value: "choice",
        options: "assessments",
        // Failed and never since passed: somebody who failed once and then
        // passed is not who a "failed" filter is looking for.
        build: (ctx) => `(${assessmentSql(ctx, "AND aa.passed IS FALSE")} AND NOT ${assessmentSql(ctx, "AND aa.passed IS TRUE")})`,
      },
    ],
  },
  {
    key: "contacts",
    label: "Contacts",
    conditionals: [
      { key: "added", label: "Contact was added", value: "date_range", build: (ctx) => dateRangeSql("c.created_at", ctx) },
      { key: "not_added", label: "Contact was not added", value: "date_range", build: (ctx) => not(`(${dateRangeSql("c.created_at", ctx)})`) },
      {
        key: "hidden",
        label: "Is hidden",
        value: "none",
        unavailable: "Hiding a contact is a Kajabi community feature this site doesn't have, so nobody here is hidden.",
      },
    ],
  },
  {
    key: "coupon",
    label: "Coupon",
    conditionals: [
      { key: "used", label: "used", value: "choice", options: "coupons", build: couponUsedSql },
      { key: "not_used", label: "did not use", value: "choice", options: "coupons", build: (ctx) => not(couponUsedSql(ctx)) },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    conditionals: [
      { key: "is", label: "is a customer", value: "none", build: () => CUSTOMER_SQL },
      { key: "is_not", label: "is not a customer", value: "none", build: () => not(CUSTOMER_SQL) },
    ],
  },
  {
    key: "custom_fields",
    label: "Custom Fields",
    conditionals: FIELD_TEXT_CONDITIONALS.map((conditional) => ({
      ...conditional,
      options: "customFields" as const,
      // The field name is a JSON key, bound like any other value — `->>` takes
      // a text parameter, so a field called `'); DROP …` is only ever a key.
      build: (ctx: BuildContext) =>
        fieldTextSql(conditional.key, `c.custom_fields->>${ctx.param(asCustomField(ctx.value))}::text`, ctx),
    })),
  },
  {
    key: "default_fields",
    label: "Default Fields",
    conditionals: FIELD_TEXT_CONDITIONALS.map((conditional) => ({
      ...conditional,
      options: "defaultFields" as const,
      build: (ctx: BuildContext) => fieldTextSql(conditional.key, DEFAULT_FIELDS[asDefaultField(ctx.value)].sql, ctx),
    })),
  },
  {
    key: "email_activity",
    label: "Email Activity",
    note: "Counts email sent from this site. Kajabi's email history wasn't in its export.",
    conditionals: [
      { key: "opened", label: "opened any email in the last", value: "days", build: (ctx) => emailEventSql("opened", asDays(ctx.value, DAY_CHOICES), ctx) },
      { key: "clicked", label: "clicked any email in the last", value: "days", build: (ctx) => emailEventSql("clicked", asDays(ctx.value, DAY_CHOICES), ctx) },
      { key: "not_opened", label: "did not open any email in the last", value: "days", build: (ctx) => not(emailEventSql("opened", asDays(ctx.value, DAY_CHOICES), ctx)) },
    ],
  },
  {
    key: "email_broadcast",
    label: "Email Broadcast",
    note: "Broadcasts sent from this site. Kajabi's broadcasts weren't in its export.",
    conditionals: [
      { key: "received", label: "received", value: "choice", options: "broadcasts", build: (ctx) => broadcastSql(ctx, "") },
      {
        key: "opened",
        label: "opened",
        value: "choice",
        options: "broadcasts",
        build: (ctx) =>
          broadcastSql(ctx, `AND (s.opened_at IS NOT NULL
                                  OR EXISTS (SELECT 1 FROM email_messages m WHERE m.id = s.message_id AND m.first_opened_at IS NOT NULL))`),
      },
      {
        key: "clicked",
        label: "clicked",
        value: "choice",
        options: "broadcasts",
        build: (ctx) =>
          broadcastSql(ctx, `AND EXISTS (SELECT 1 FROM email_messages m WHERE m.id = s.message_id AND m.first_clicked_at IS NOT NULL)`),
      },
      { key: "not_received", label: "did not receive", value: "choice", options: "broadcasts", build: (ctx) => not(broadcastSql(ctx, "")) },
    ],
  },
  {
    key: "email_engagement",
    label: "Email Engagement",
    note: "Opens and clicks on email sent from this site.",
    conditionals: [
      { key: "engaged", label: "engaged in the last", value: "engagement_days", build: (ctx) => emailEventSql("engaged", asDays(ctx.value, ENGAGEMENT_DAY_CHOICES), ctx) },
      { key: "not_engaged", label: "not engaged in the last", value: "engagement_days", build: (ctx) => not(emailEventSql("engaged", asDays(ctx.value, ENGAGEMENT_DAY_CHOICES), ctx)) },
    ],
  },
  {
    key: "email_sequence",
    label: "Email Sequence",
    conditionals: [
      { key: "subscribed", label: "is subscribed to", value: "choice", options: "sequences", build: (ctx) => sequenceSql(ctx, "active") },
      { key: "not_subscribed", label: "is not subscribed to", value: "choice", options: "sequences", build: (ctx) => not(sequenceSql(ctx, "active")) },
      { key: "completed", label: "completed", value: "choice", options: "sequences", build: (ctx) => sequenceSql(ctx, "completed") },
    ],
  },
  {
    key: "events",
    label: "Events",
    conditionals: [
      { key: "registered", label: "registered for", value: "choice", options: "events", build: (ctx) => eventSql(ctx, "") },
      { key: "not_registered", label: "did not register for", value: "choice", options: "events", build: (ctx) => not(eventSql(ctx, "")) },
      { key: "attended", label: "attended", value: "choice", options: "events", build: (ctx) => eventSql(ctx, "AND er.attended") },
      { key: "not_attended", label: "registered but did not attend", value: "choice", options: "events", build: (ctx) => eventSql(ctx, "AND NOT er.attended") },
    ],
  },
  {
    key: "forms",
    label: "Forms",
    conditionals: [
      { key: "submitted", label: "submitted", value: "choice", options: "forms", build: formSql },
      { key: "not_submitted", label: "did not submit", value: "choice", options: "forms", build: (ctx) => not(formSql(ctx)) },
    ],
  },
  {
    key: "lifetime_value",
    label: "Lifetime Value",
    conditionals: [
      { key: "gt", label: "is greater than", value: "money", build: (ctx) => `c.lifetime_value_cents > ${ctx.param(asCents(ctx.value))}` },
      { key: "lt", label: "is less than", value: "money", build: (ctx) => `c.lifetime_value_cents < ${ctx.param(asCents(ctx.value))}` },
      { key: "eq", label: "is equal to", value: "money", build: (ctx) => `c.lifetime_value_cents = ${ctx.param(asCents(ctx.value))}` },
    ],
  },
  {
    key: "email_marketing_status",
    label: "Email Marketing Status",
    conditionals: [
      { key: "is", label: "is", value: "choice", options: "statuses", build: (ctx) => `c.email_marketing_status = ${ctx.param(asStatus(ctx.value))}` },
      { key: "is_not", label: "is not", value: "choice", options: "statuses", build: (ctx) => `c.email_marketing_status <> ${ctx.param(asStatus(ctx.value))}` },
    ],
  },
  {
    key: "newsletter",
    label: "Newsletter",
    conditionals: [
      { key: "subscribed", label: "is subscribed to", value: "choice", options: "newsletters", build: newsletterSql },
      { key: "not_subscribed", label: "is not subscribed to", value: "choice", options: "newsletters", build: (ctx) => not(newsletterSql(ctx)) },
    ],
  },
  {
    key: "offers",
    label: "Offers",
    note: "Offers only in Kajabi are matched by the name on the imported payment.",
    conditionals: [
      { key: "has_access", label: "has access to", value: "choice", options: "offers", build: offerAccessSql },
      { key: "no_access", label: "does not have access to", value: "choice", options: "offers", build: (ctx) => not(offerAccessSql(ctx)) },
      { key: "purchased", label: "purchased", value: "choice", options: "offers", build: (ctx) => offerPurchasedSql(asCatalogRef(ctx.value, "an offer"), ctx) },
      { key: "not_purchased", label: "did not purchase", value: "choice", options: "offers", build: (ctx) => not(offerPurchasedSql(asCatalogRef(ctx.value, "an offer"), ctx)) },
    ],
  },
  {
    key: "products",
    label: "Products",
    note: "Includes the products Kajabi listed for each person when they were brought over.",
    conditionals: [
      { key: "has_access", label: "has access to", value: "choice", options: "products", build: productAccessSql },
      { key: "no_access", label: "does not have access to", value: "choice", options: "products", build: (ctx) => not(productAccessSql(ctx)) },
    ],
  },
  {
    key: "tags",
    label: "Tags",
    conditionals: [
      { key: "has", label: "has tag", value: "choice", options: "tags", build: tagSql },
      { key: "not_has", label: "does not have tag", value: "choice", options: "tags", build: (ctx) => not(tagSql(ctx)) },
    ],
  },
];

/** The catalog as the screen needs it: words and value kinds, no builders. */
export function filterCatalog() {
  return FILTER_CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    note: category.note ?? "",
    conditionals: category.conditionals.map((conditional) => ({
      key: conditional.key,
      label: conditional.label,
      value: conditional.value,
      options: conditional.options ?? null,
      unavailable: conditional.unavailable ?? "",
    })),
  }));
}

/* --------------------------------------------------------- filter rows */

export const filterRowSchema = z.object({
  category: z.string().min(1).max(40),
  op: z.string().min(1).max(40),
  value: z.string().max(400).default(""),
  text: z.string().max(400).default(""),
});

export type FilterRow = z.infer<typeof filterRowSchema>;

/** At most this many rows at once; they AND together, so more narrows to nothing anyway. */
export const MAX_FILTER_ROWS = 20;

/**
 * The `filters` query parameter: a JSON array of rows, exactly as the screen
 * keeps it in its own address bar so a refresh keeps the filters.
 */
export function parseFilterRows(raw: string | undefined): FilterRow[] {
  if (!raw) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw badRequest("Those filters couldn't be read");
  }
  const parsed = z.array(filterRowSchema).max(MAX_FILTER_ROWS).safeParse(decoded);
  if (!parsed.success) throw badRequest("Those filters couldn't be read", parsed.error.flatten());
  return parsed.data;
}

function findConditional(row: FilterRow): ConditionalSpec {
  // Looked up, never interpolated: an unknown key lands on `undefined` here and
  // stops, rather than reaching the query as an identifier.
  const category = FILTER_CATEGORIES.find((candidate) => candidate.key === row.category);
  if (!category) throw badRequest("That filter uses something we don't recognise");
  const conditional = category.conditionals.find((candidate) => candidate.key === row.op);
  if (!conditional) throw badRequest("That filter asks for a comparison we can't make");
  if (conditional.unavailable || !conditional.build) throw badRequest(conditional.unavailable || "That filter isn't available here");
  return conditional;
}

/** One row → one parenthesised predicate over `c`, binding into `params`. */
export function buildFilterRow(row: FilterRow, params: unknown[], timeZone: string): string {
  const conditional = findConditional(row);
  const param = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  return `(${conditional.build!({ value: row.value.trim(), text: row.text, param, timeZone })})`;
}

/**
 * A saved segment's predicate, moved along to sit after the parameters already
 * bound.
 *
 * services/segments.ts `compileSegment` numbers its placeholders from $1. The
 * rewrite is safe because of how that SQL is made: every value in it is a bind
 * parameter and none of its fixed text contains a `$`, so every `$n` in it is a
 * placeholder that function wrote.
 */
export function shiftPlaceholders(sql: string, offset: number): string {
  return sql.replace(/\$(\d+)/g, (_match, n: string) => `$${Number(n) + offset}`);
}

export interface ScopeInput {
  /** A SEGMENT_PATTERN value; anything else is refused by the route's schema first. */
  segment?: string;
  rows?: FilterRow[];
  /** The compiled saved segment, when `segment` is `saved-<id>`. */
  saved?: { where: string; params: unknown[] } | null;
  timeZone: string;
}

/**
 * The segment, the internal-account rule and the filter rows, as WHERE clauses.
 *
 * Team and test accounts are left out of everything except the segment that
 * exists to show them — the one place the 415 Kajabi can show and the 424 the
 * table holds are allowed to differ.
 */
export function buildScopeClauses(input: ScopeInput, params: unknown[]): string[] {
  const clauses: string[] = [];
  const segment = input.segment ?? "all";

  if (segment === TEAM_SEGMENT.key) {
    clauses.push(INTERNAL_SQL);
  } else {
    clauses.push(NOT_INTERNAL_SQL);
    const builtIn = BUILT_IN_SEGMENTS.find((candidate) => candidate.key === segment);
    if (builtIn && builtIn.key !== "all") clauses.push(builtIn.sql);
    if (savedSegmentId(segment) !== null) {
      if (!input.saved) throw badRequest("That segment no longer exists");
      clauses.push(`(${shiftPlaceholders(input.saved.where, params.length)})`);
      params.push(...input.saved.params);
    }
  }

  for (const row of input.rows ?? []) clauses.push(buildFilterRow(row, params, input.timeZone));
  return clauses;
}
