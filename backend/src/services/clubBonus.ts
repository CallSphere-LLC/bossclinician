import crypto from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { buildMergeValues } from "../email/mergeValues";
import { mergeLinks, renderMarkdown, renderTokens, sendEmail } from "../email/provider";
import { grantAccess } from "./access";
import {
  REMINDER_LOOKAHEAD_DAYS,
  REMINDER_POSITION,
  bonusDeadlineFor,
  bonusDeadlineMergeValues,
  dueReminder,
  formatBonusDeadline,
  promotionConflict,
  tooClose,
  unresolvedPlaceholders,
  withinBonusWindow,
  type ReminderKey,
  type ReminderLedger,
} from "./clubBonusDeadline";

/**
 * The Club's Ramp-Up Rate Formula bonus (Yvette, 22 Nov 2026, item 3):
 * one saved window per subscriber, the checkout/fulfilment decision, the signed
 * link that lets a subscriber's own page show their own date, and the C1-C3
 * reminder dispatcher. The date arithmetic is in clubBonusDeadline.ts (pure).
 *
 * Storage (migration 215):
 *  - club_bonus_windows: one row per lower-cased email, written the first time
 *    the registration is seen and never moved (INSERT ... ON CONFLICT DO
 *    NOTHING; the first registration is the earliest form submission), so
 *    registering again cannot restart the window. deadline_at NULL means
 *    "undecided": the subscriber registered before this went live and Yvette
 *    has not yet chosen how existing registrants enter the offer. They see the
 *    public wording, never an expired message.
 *  - club_bonus_orders: the decision for every paid Club order, made from the
 *    order's own created_at (the moment the buyer submitted checkout), so a
 *    3-D Secure, PayPal or webhook delay past midnight cannot flip it.
 *  - club_bonus_reminder_sends: the C1-C3 ledger; one send per window, reminder
 *    and deadline, never backfilled.
 *  - settings.club_bonus: { goLiveAt, registrationFormIds, legacyPendingGetsBonus,
 *    excludedEmails }.
 *
 * Test accounts (migration 221, Yvette 22 Nov round 2, item 1): a window with
 * rule 'test_excluded', an address in settings.club_bonus.excludedEmails, or a
 * contact marked internal (contacts.is_internal) is never eligible, is not a
 * participant, and gets no C1-C3 (see `clubBonusExclusion`). The four existing
 * registrants are excluded by rule + list rather than is_internal, because
 * is_internal also hides a contact from the People list and the owner's
 * audience counts/reports, and two of the four are Yvette's own addresses.
 *
 * The C1-C3 copy lives in the 'club-bonus-reminders' sequence so it can be
 * edited in the sequence editor. That sequence's STATUS is the on/off switch:
 * nothing is sent, and the Club sequence skips nothing, until it is 'active'.
 * Nobody is ever enrolled in it; this file sends from it on each sequence tick.
 * Its emails are stored disabled on purpose (so the ordinary engine can never
 * send one without a date) and this file reads them regardless of that flag.
 */

type Queryable = Pick<PoolClient, "query"> | typeof pool | { query: typeof pool.query };

export const CLUB_OFFER_SLUG = "the-club";
export const RAMP_UP_PRODUCT_SLUG = "ramp-up-rate-formula";
export const REMINDER_SEQUENCE_SLUG = "club-bonus-reminders";
/**
 * The ordinary Club promotions a reminder keeps its distance from (the Club
 * nurture, migration 202, and the reminders themselves): a reminder is skipped
 * when one of these went out to the subscriber too recently (tooClose).
 */
export const CLUB_PROMOTION_SEQUENCE_SLUGS = ["practice-prep-to-the-club", REMINDER_SEQUENCE_SLUG] as const;
/** club_bonus_windows.rule for a test account (migration 221). */
export const TEST_EXCLUDED_RULE = "test_excluded";
/** The Practice Prep Training sign-up (forms.slug), used when the setting is missing. */
const DEFAULT_REGISTRATION_FORM_SLUG = "practicepreptraining";

/* ------------------------------------------------------------- settings */

export interface ClubBonusSettings {
  /** Registrations before this instant are "existing registrants" (deadline undecided). */
  goLiveAt: Date | null;
  registrationFormIds: number[];
  /** What a purchase by an undecided existing registrant gets. Default true. */
  legacyPendingGetsBonus: boolean;
  /** Lower-cased test addresses: never eligible, never reminded (migration 221). */
  excludedEmails: string[];
}

const CACHE_MS = 60_000;
let settingsCache: { value: ClubBonusSettings; at: number } | null = null;

/** Test hook. */
export function resetClubBonusCache(): void {
  settingsCache = null;
  idCache = null;
}

export async function clubBonusSettings(db: Queryable = pool): Promise<ClubBonusSettings> {
  if (settingsCache && Date.now() - settingsCache.at < CACHE_MS) return settingsCache.value;
  const res = await db.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'club_bonus'`);
  const raw = (res.rows[0]?.value ?? {}) as Record<string, unknown>;
  const goLive = typeof raw.goLiveAt === "string" ? new Date(raw.goLiveAt) : null;
  let formIds = Array.isArray(raw.registrationFormIds)
    ? raw.registrationFormIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (formIds.length === 0) {
    const form = await db.query<{ id: number }>(`SELECT id FROM forms WHERE slug = $1`, [
      DEFAULT_REGISTRATION_FORM_SLUG,
    ]);
    formIds = form.rows.map((r) => r.id);
  }
  const value: ClubBonusSettings = {
    // A missing or unreadable go-live date makes EVERY registration "existing":
    // nobody is given a date or an expiry until the setting exists.
    goLiveAt: goLive && Number.isFinite(goLive.getTime()) ? goLive : new Date(8.64e15),
    registrationFormIds: formIds,
    legacyPendingGetsBonus: raw.legacyPendingGetsBonus !== false,
    excludedEmails: Array.isArray(raw.excludedEmails)
      ? raw.excludedEmails
          .filter((e): e is string => typeof e === "string")
          .map((e) => normaliseEmail(e))
          .filter(Boolean)
      : [],
  };
  settingsCache = { value, at: Date.now() };
  return value;
}

let idCache: { clubOfferId: number | null; rampUpProductId: number | null; at: number } | null = null;

async function catalogIds(db: Queryable): Promise<{ clubOfferId: number | null; rampUpProductId: number | null }> {
  if (idCache && Date.now() - idCache.at < CACHE_MS) return idCache;
  const res = await db.query<{ club: number | null; ramp: number | null }>(
    `SELECT (SELECT id FROM offers WHERE slug = $1) AS club,
            (SELECT id FROM products WHERE slug = $2) AS ramp`,
    [CLUB_OFFER_SLUG, RAMP_UP_PRODUCT_SLUG]
  );
  idCache = { clubOfferId: res.rows[0]?.club ?? null, rampUpProductId: res.rows[0]?.ramp ?? null, at: Date.now() };
  return idCache;
}

/* --------------------------------------------------------------- windows */

export interface BonusWindow {
  id: number;
  email: string;
  contactId: number | null;
  firstRegisteredAt: Date;
  /** null = undecided existing registrant (public messaging). */
  deadlineAt: Date | null;
  rule: string;
}

export type BonusState = "none" | "pending" | "open" | "expired";

export function normaliseEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** The state of a window at `at`. */
export function windowState(window: BonusWindow | null, at: Date): BonusState {
  if (!window) return "none";
  if (window.deadlineAt === null) return "pending";
  return withinBonusWindow(window.deadlineAt, at) ? "open" : "expired";
}

interface WindowRow {
  id: string;
  email: string;
  contact_id: number | null;
  first_registered_at: Date;
  deadline_at: Date | null;
  rule: string;
}

function toWindow(row: WindowRow | undefined): BonusWindow | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    email: row.email,
    contactId: row.contact_id,
    firstRegisteredAt: row.first_registered_at,
    deadlineAt: row.deadline_at,
    rule: row.rule,
  };
}

const WINDOW_COLUMNS = `id, email, contact_id, first_registered_at, deadline_at, rule`;

/**
 * The saved window for an email, creating it from the registrations on file the
 * first time it is asked for. Null when the address never registered.
 *
 * Creation is the only time a deadline is computed. A row that exists is
 * returned as it is: a later registration changes nothing.
 */
export async function ensureWindow(db: Queryable, rawEmail: string): Promise<BonusWindow | null> {
  const email = normaliseEmail(rawEmail);
  if (!email) return null;
  const existing = await db.query<WindowRow>(
    `SELECT ${WINDOW_COLUMNS} FROM club_bonus_windows WHERE email = $1`,
    [email]
  );
  if (existing.rows[0]) return toWindow(existing.rows[0]);

  const settings = await clubBonusSettings(db);
  if (settings.registrationFormIds.length === 0) return null;
  const first = await db.query<{ id: number; created_at: Date; contact_id: number | null }>(
    `SELECT fs.id, fs.created_at, COALESCE(fs.contact_id, c2.id) AS contact_id
       FROM form_submissions fs
       LEFT JOIN contacts c ON c.id = fs.contact_id
       LEFT JOIN contacts c2 ON lower(c2.email::text) = $2::text
      WHERE fs.form_id = ANY($1::int[])
        AND (lower(fs.email) = $2::text OR lower(c.email::text) = $2::text)
      ORDER BY fs.created_at, fs.id
      LIMIT 1`,
    [settings.registrationFormIds, email]
  );
  const row = first.rows[0];
  if (!row) return null;

  const legacy = row.created_at.getTime() < (settings.goLiveAt?.getTime() ?? Infinity);
  // A listed test address is saved without a date, as a test account.
  const testAccount = settings.excludedEmails.includes(email);
  const deadline = legacy || testAccount ? null : bonusDeadlineFor(row.created_at);
  await db.query(
    `INSERT INTO club_bonus_windows
       (email, contact_id, first_registered_at, first_submission_id, deadline_at, rule)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    [
      email,
      row.contact_id,
      row.created_at,
      row.id,
      deadline,
      testAccount ? TEST_EXCLUDED_RULE : legacy ? "legacy_pending" : "first_registration",
    ]
  );
  const saved = await db.query<WindowRow>(
    `SELECT ${WINDOW_COLUMNS} FROM club_bonus_windows WHERE email = $1`,
    [email]
  );
  return toWindow(saved.rows[0]);
}

/** Saves a window for every registration not yet seen. Runs on each sequence tick. */
export async function syncWindows(db: Queryable = pool): Promise<number> {
  const settings = await clubBonusSettings(db);
  if (settings.registrationFormIds.length === 0) return 0;
  const missing = await db.query<{ email: string }>(
    `SELECT DISTINCT lower(COALESCE(c.email::text, fs.email)) AS email
       FROM form_submissions fs
       LEFT JOIN contacts c ON c.id = fs.contact_id
      WHERE fs.form_id = ANY($1::int[])
        AND COALESCE(c.email::text, fs.email) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM club_bonus_windows w
                         WHERE w.email = lower(COALESCE(c.email::text, fs.email)))
      LIMIT 200`,
    [settings.registrationFormIds]
  );
  let created = 0;
  for (const row of missing.rows) {
    if (await ensureWindow(db, row.email)) created += 1;
  }
  return created;
}

async function windowById(db: Queryable, id: number): Promise<BonusWindow | null> {
  const res = await db.query<WindowRow>(`SELECT ${WINDOW_COLUMNS} FROM club_bonus_windows WHERE id = $1`, [id]);
  return toWindow(res.rows[0]);
}

/* --------------------------------------------------------- test accounts */

/**
 * Pure: whether a person is a test account for the Club bonus. Reusable by any
 * Club-bonus count or sender: `rule` is their window's rule (if any), `email`
 * their address, `isInternal` their contact's is_internal flag.
 */
export function isClubBonusTestAccount(
  input: { email?: string | null; rule?: string | null; isInternal?: boolean | null },
  excludedEmails: readonly string[]
): boolean {
  if (input.rule === TEST_EXCLUDED_RULE) return true;
  if (input.isInternal === true) return true;
  const email = normaliseEmail(input.email);
  return email !== "" && excludedEmails.includes(email);
}

/**
 * The same test in SQL, for counts over club_bonus_windows aliased `w`
 * ($1 = settings.club_bonus.excludedEmails as text[]).
 */
export const CLUB_BONUS_PARTICIPANT_SQL = `w.rule <> '${TEST_EXCLUDED_RULE}'
   AND NOT (w.email = ANY($1::text[]))
   AND NOT EXISTS (SELECT 1 FROM contacts ci
                    WHERE ci.is_internal
                      AND (ci.id = w.contact_id OR lower(ci.email::text) = w.email))`;

/** Real participants: everybody with a saved window who is not a test account. */
export async function clubBonusParticipantCount(db: Queryable = pool): Promise<number> {
  const settings = await clubBonusSettings(db);
  const res = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM club_bonus_windows w WHERE ${CLUB_BONUS_PARTICIPANT_SQL}`,
    [settings.excludedEmails]
  );
  return res.rows[0]?.n ?? 0;
}

/**
 * Whether this person is a test account, checked live (the list and the
 * internal flag can change after the window was saved). The contact is looked
 * up by id or address.
 */
export async function clubBonusExclusion(
  db: Queryable,
  input: { email: string; contactId?: number | null; window?: BonusWindow | null }
): Promise<boolean> {
  const settings = await clubBonusSettings(db);
  const email = normaliseEmail(input.email);
  if (isClubBonusTestAccount({ email, rule: input.window?.rule }, settings.excludedEmails)) return true;
  const internal = await db.query(
    `SELECT 1 FROM contacts
      WHERE is_internal AND (id = $1::int OR ($2::text <> '' AND lower(email::text) = $2::text))
      LIMIT 1`,
    [input.contactId ?? input.window?.contactId ?? null, email]
  );
  return (internal.rowCount ?? 0) > 0;
}

/* ---------------------------------------------------------------- token */

/**
 * The signed link that identifies a subscriber on /club and /club/checkout.
 *
 * Carries only the window's row id, HMAC-signed with a key of its own (HKDF
 * over JWT_SECRET, as every other signed link here), so it cannot be forged,
 * cannot be swapped for another person's id, and is NOT the email-preferences
 * token (that one can unsubscribe). It only ever reveals the holder's own
 * deadline, which is in the email it came from.
 */
const TOKEN_INFO = "bossclinician/club-bonus-link/v1";
const TOKEN_VERSION = "cb1";
let tokenKey: Buffer | null = null;

function key(): Buffer {
  if (tokenKey === null) {
    tokenKey = Buffer.from(
      crypto.hkdfSync("sha256", Buffer.from(env.jwtSecret, "utf8"), Buffer.alloc(0), Buffer.from(TOKEN_INFO, "utf8"), 32)
    );
  }
  return tokenKey;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", key()).update(body).digest("base64url");
}

export function signClubBonusToken(windowId: number): string {
  const body = Buffer.from(`${TOKEN_VERSION}.${windowId}`, "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyClubBonusToken(token: string): number | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = sign(parts[0]);
  if (parts[1].length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(parts[1], "utf8"), Buffer.from(expected, "utf8"))) return null;
  const fields = Buffer.from(parts[0], "base64url").toString("utf8").split(".");
  if (fields.length !== 2 || fields[0] !== TOKEN_VERSION) return null;
  const id = Number(fields[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** /club with the subscriber's own token, or plain /club when there is no window. */
export function clubBonusLink(window: BonusWindow | null): string {
  const base = `${env.publicSiteUrl}/club`;
  return window ? `${base}?b=${signClubBonusToken(window.id)}` : base;
}

/* ------------------------------------------------------- public status */

export type PublicBonusStatus =
  | { state: "open"; deadline: string; deadlineAt: string }
  | { state: "expired" }
  | { state: "public" };

/**
 * What /club and /club/checkout show. Identified ONLY by the signed link or the
 * signed-in member's own address — never by an address typed into a form, so
 * the endpoint cannot be used to look up somebody else's date. A bad, missing
 * or foreign token gets the same neutral "public" answer.
 */
export async function publicBonusStatus(input: {
  token?: string | null;
  memberEmail?: string | null;
  now?: Date;
}): Promise<PublicBonusStatus> {
  const now = input.now ?? new Date();
  let window: BonusWindow | null = null;
  const memberEmail = normaliseEmail(input.memberEmail);
  if (memberEmail) {
    window = await ensureWindow(pool, memberEmail);
  } else if (input.token) {
    const id = verifyClubBonusToken(input.token);
    window = id === null ? null : await windowById(pool, id);
  }
  // A test account sees the public wording and is never shown a date.
  if (window && (await clubBonusExclusion(pool, { email: window.email, window }))) return { state: "public" };
  const state = windowState(window, now);
  if (state === "open" && window?.deadlineAt) {
    return { state: "open", deadline: formatBonusDeadline(window.deadlineAt), deadlineAt: window.deadlineAt.toISOString() };
  }
  if (state === "expired") return { state: "expired" };
  return { state: "public" };
}

/* ------------------------------------------------------ merge values */

/** Tokens a Club email can use. Blank date when the subscriber has none. */
export const CLUB_BONUS_MERGE_KEYS = [
  "clubBonusDeadline",
  "clubBonusLink",
  "clubBonusToken",
  "bonus_deadline_date",
  "bonus_deadline_time",
  "bonus_deadline_timezone",
] as const;

const NO_DEADLINE = { bonus_deadline_date: "", bonus_deadline_time: "", bonus_deadline_timezone: "" };

/**
 * `{{clubBonusDeadline}}` "December 6" ('' without a date), `{{clubBonusLink}}`
 * the full signed /club URL, `{{clubBonusToken}}` the bare token ('' without a
 * window). Stored emails use `https://www.bossclinician.com/club?b={{clubBonusToken}}`,
 * which still opens /club if anything ever leaves the token blank.
 */
export async function clubBonusMergeValues(db: Queryable, email: string): Promise<Record<string, string>> {
  const window = await ensureWindow(db, email);
  return {
    clubBonusDeadline: window?.deadlineAt ? formatBonusDeadline(window.deadlineAt) : "",
    clubBonusLink: clubBonusLink(window),
    clubBonusToken: window ? signClubBonusToken(window.id) : "",
    ...(window?.deadlineAt ? bonusDeadlineMergeValues(window.deadlineAt) : NO_DEADLINE),
  };
}

/** Whether a template uses any of the Club bonus tokens (so others pay nothing). */
export function usesClubBonusTokens(...templates: Array<string | null | undefined>): boolean {
  return templates.some(
    (t) =>
      typeof t === "string" &&
      /\{\{\s*(clubBonus(Deadline|Link|Token)|bonus_deadline_(date|time|timezone))\s*\}\}/.test(t)
  );
}

/* ------------------------------------------------------- ownership */

async function ownsClub(db: Queryable, clubOfferId: number, contactId: number | null, email: string): Promise<boolean> {
  const res = await db.query(
    `SELECT 1 FROM access_grants g JOIN members m ON m.id = g.member_id
      WHERE g.offer_id = $1 AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND (m.contact_id = $2 OR lower(m.email::text) = $3)
      LIMIT 1`,
    [clubOfferId, contactId, email]
  );
  return (res.rowCount ?? 0) > 0;
}

async function remindersOn(db: Queryable): Promise<{ id: number; topic: string } | null> {
  const res = await db.query<{ id: number; status: string; topic: string }>(
    `SELECT id, status, topic FROM email_sequences WHERE slug = $1`,
    [REMINDER_SEQUENCE_SLUG]
  );
  const row = res.rows[0];
  return row && row.status === "active" ? { id: row.id, topic: row.topic } : null;
}

/* -------------------------------------- sequence skip rule (migration 215) */

/** The C1-C3 ledger for one window and deadline. */
async function reminderLedger(db: Queryable, windowId: number, deadlineAt: Date): Promise<ReminderLedger> {
  const res = await db.query<{ reminder: ReminderKey; sent_at: Date; outcome: string }>(
    `SELECT reminder, sent_at, outcome FROM club_bonus_reminder_sends
      WHERE window_id = $1 AND deadline_at = $2`,
    [windowId, deadlineAt]
  );
  const ledger: ReminderLedger = {};
  for (const row of res.rows) ledger[row.reminder] = { sentAt: row.sent_at, sent: row.outcome === "sent" };
  return ledger;
}

/**
 * Skip rules on the Club sequence's promotional emails (migrations 215/221):
 * `{"clubBonusReminderDay": true}` (emails 3-17) and, on Email 8 / Email 11,
 * `{"clubBonusReplaces": "C1" | "C2"}`. Revised doc: "Replace Email 8 with C1
 * and replace Email 11 with C2; retain Email 9 on Day 10 and Email 10 on Day
 * 11 ... preserve at least 24 hours between promotions; suppress a conflicting
 * ordinary promotion rather than delaying a reminder past expiry."
 *
 * Returns a reason only while the reminders are switched on, for a real
 * participant (a saved deadline, not a test account, not a Club owner). '' —
 * send as before — in every other case, so with the reminders off, or for
 * anybody without a dated window, the sequence runs exactly as it does today.
 */
export async function clubBonusReminderDaySkip(
  db: Queryable,
  contactId: number,
  email: string,
  now: Date = new Date(),
  replaces?: ReminderKey
): Promise<string> {
  if (!(await remindersOn(db))) return "";
  const window = await ensureWindow(db, email);
  if (!window?.deadlineAt) return "";
  if (await clubBonusExclusion(db, { email, contactId, window })) return "";
  const { clubOfferId } = await catalogIds(db);
  if (clubOfferId !== null && (await ownsClub(db, clubOfferId, contactId, normaliseEmail(email)))) return "";
  return promotionConflict(window.deadlineAt, now, await reminderLedger(db, window.id, window.deadlineAt), replaces);
}

/**
 * The two calls the sequence engine makes inside its send transaction, each
 * under its own savepoint: a failure here must never abort the transaction
 * that is sending somebody's email. On failure: no skip, and plain /club.
 */
async function savepointed<T>(client: Queryable, name: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    await client.query(`SAVEPOINT ${name}`);
  } catch {
    return fallback;
  }
  try {
    const value = await run();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => undefined);
    // eslint-disable-next-line no-console
    console.error(`[clubBonus] ${name} failed:`, err);
    return fallback;
  }
}

export function clubBonusReminderDaySkipSafe(
  client: Queryable,
  contactId: number,
  email: string,
  replaces?: ReminderKey
): Promise<string> {
  return savepointed(
    client,
    "club_bonus_skip",
    () => clubBonusReminderDaySkip(client, contactId, email, new Date(), replaces),
    ""
  );
}

export function clubBonusMergeValuesSafe(client: Queryable, email: string): Promise<Record<string, string>> {
  return savepointed(client, "club_bonus_merge", () => clubBonusMergeValues(client, email), {
    clubBonusDeadline: "",
    clubBonusLink: clubBonusLink(null),
    clubBonusToken: "",
    ...NO_DEADLINE,
  });
}

/* ---------------------------------------------------------- fulfilment */

export interface OrderBonusDecision {
  included: boolean;
  reason:
    | "not_club"
    | "not_registered"
    | "within_window"
    | "legacy_pending"
    | "expired"
    | "legacy_pending_excluded"
    | "test_account";
  windowId: number | null;
}

/**
 * Pure: the decision for an order placed at `orderedAt` by somebody with
 * `window`. A test account never gets the bonus (migration 221), whatever its
 * window says; a buyer who never registered is not eligible automatically
 * (support@bossclinician.com verifies a different-address registration and
 * grants it by hand: Contacts → the buyer → Access → offer "Ramp Up Rate
 * Pricing Formula").
 */
export function decideOrderBonus(
  window: BonusWindow | null,
  orderedAt: Date,
  legacyPendingGetsBonus: boolean,
  testAccount: boolean = false
): OrderBonusDecision {
  const state = windowState(window, orderedAt);
  const windowId = window?.id ?? null;
  if (testAccount || window?.rule === TEST_EXCLUDED_RULE) return { included: false, reason: "test_account", windowId };
  if (state === "none") return { included: false, reason: "not_registered", windowId };
  if (state === "pending") {
    return legacyPendingGetsBonus
      ? { included: true, reason: "legacy_pending", windowId }
      : { included: false, reason: "legacy_pending_excluded", windowId };
  }
  if (state === "open") return { included: true, reason: "within_window", windowId };
  return { included: false, reason: "expired", windowId };
}

/**
 * Called from fulfillPayment, inside its transaction, once per paid order.
 * Under its own savepoint and never throws: a bonus problem must not roll back
 * the payment or the Club access granted above it.
 *
 * Grants the Ramp-Up Rate Formula product when the order qualifies, unless the
 * member already holds it (a grant on conflict would re-point the existing
 * grant at this order, and a Club refund would then take away a Ramp-Up they
 * bought on its own). Returns the product id when a grant newly activated.
 */
export async function applyClubBonusSafely(
  client: PoolClient,
  input: { orderId: number; offerIds: number[]; accessMemberId: number | null }
): Promise<{ grantedProductId: number | null; activated: boolean }> {
  const none = { grantedProductId: null, activated: false };
  try {
    // Every statement inside the savepoint: a failed one outside it would
    // abort the caller's whole transaction, payment included.
    await client.query("SAVEPOINT club_bonus");
    try {
      const ids = await catalogIds(client);
      const result =
        ids.clubOfferId === null || !input.offerIds.includes(ids.clubOfferId)
          ? none
          : await applyClubBonus(client, input, ids.rampUpProductId);
      await client.query("RELEASE SAVEPOINT club_bonus");
      return result;
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT club_bonus");
      throw err;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[clubBonus] order ${input.orderId}: bonus not applied:`, err);
    return none;
  }
}

async function applyClubBonus(
  client: PoolClient,
  input: { orderId: number; accessMemberId: number | null },
  rampUpProductId: number | null
): Promise<{ grantedProductId: number | null; activated: boolean }> {
  const orderRes = await client.query<{ email: string; created_at: Date; gift_recipient_email: string | null }>(
    `SELECT email, created_at, gift_recipient_email FROM orders WHERE id = $1`,
    [input.orderId]
  );
  const order = orderRes.rows[0];
  if (!order) return { grantedProductId: null, activated: false };

  const settings = await clubBonusSettings(client);
  // The buyer's registration decides. A gift is decided on whichever of the
  // buyer and the recipient registered (the recipient is who enrolls).
  const decideFor = async (email: string): Promise<OrderBonusDecision> => {
    const window = await ensureWindow(client, email);
    const testAccount = await clubBonusExclusion(client, { email, window });
    return decideOrderBonus(window, order.created_at, settings.legacyPendingGetsBonus, testAccount);
  };
  let decision = await decideFor(order.email);
  if (!decision.included && decision.reason !== "test_account" && order.gift_recipient_email) {
    const gift = await decideFor(order.gift_recipient_email);
    if (gift.included) decision = gift;
  }

  let grantedProductId: number | null = null;
  let activated = false;
  let note: string = decision.reason;
  if (decision.included && input.accessMemberId !== null && rampUpProductId !== null) {
    const held = await client.query(
      `SELECT 1 FROM access_grants WHERE member_id = $1 AND product_id = $2 AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())`,
      [input.accessMemberId, rampUpProductId]
    );
    if ((held.rowCount ?? 0) > 0) {
      note = `${decision.reason}; already owned`;
    } else {
      const grant = await grantAccess({
        memberId: input.accessMemberId,
        productId: rampUpProductId,
        // No offer id on purpose: Club ownership is "an active grant with
        // offer_id = the Club" everywhere (skip rules, requires_offer_id), and
        // a bonus that outlives the Club access must not read as owning it.
        // The order id ties it to this order: a refund revokes it.
        offerId: null,
        orderId: input.orderId,
        source: "purchase",
        client,
      });
      grantedProductId = rampUpProductId;
      activated = grant.transitionedToActive;
    }
  } else if (decision.included) {
    note = `${decision.reason}; nothing granted (no member or product)`;
  }

  await client.query(
    `INSERT INTO club_bonus_orders (order_id, email, window_id, included, reason, granted_product_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (order_id) DO NOTHING`,
    [input.orderId, normaliseEmail(order.email), decision.windowId, decision.included, note, grantedProductId]
  );
  return { grantedProductId, activated };
}

/* ------------------------------------------------------ C1-C3 dispatcher */

/**
 * One pass: save new registrations' windows, then (only when the reminder
 * sequence is active) send whichever C1-C3 reminder is due right now.
 * Registered on the 'sequence.tick' job (every few minutes).
 */
export async function runClubBonusTick(now: Date = new Date()): Promise<{ windows: number; sent: number }> {
  const windows = await syncWindows(pool);
  const sequence = await remindersOn(pool);
  if (!sequence) return { windows, sent: 0 };
  const { clubOfferId } = await catalogIds(pool);

  // Open windows whose last day is close enough for any C1-C3 slot (C1 is five
  // days before). Test accounts never have a date, so they are never here.
  const candidates = await pool.query<WindowRow>(
    `SELECT ${WINDOW_COLUMNS} FROM club_bonus_windows
      WHERE deadline_at IS NOT NULL AND rule <> $3
        AND deadline_at >= $1::timestamptz
        AND deadline_at <= $1::timestamptz + make_interval(days => $2::int)
      ORDER BY deadline_at LIMIT 500`,
    [now, REMINDER_LOOKAHEAD_DAYS, TEST_EXCLUDED_RULE]
  );

  let sent = 0;
  for (const row of candidates.rows) {
    const window = toWindow(row);
    if (!window?.deadlineAt) continue;
    const slot = dueReminder(window.deadlineAt, now);
    if (!slot) continue;
    try {
      if (await sendReminder(window, slot.key, sequence, clubOfferId, now)) sent += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[clubBonus] ${slot.key} for window ${window.id} not sent:`, err);
    }
  }
  return { windows, sent };
}

/** Whether a Club order by this person is already paid (fulfilment may still be granting access). */
async function paidClubOrder(db: Queryable, clubOfferId: number, contactId: number, email: string): Promise<boolean> {
  const res = await db.query(
    `SELECT 1 FROM orders o
      WHERE o.status = 'paid'
        AND (lower(o.email::text) = $2 OR lower(COALESCE(o.gift_recipient_email, '')) = $2
             OR o.member_id IN (SELECT m.id FROM members m WHERE m.contact_id = $3))
        AND (o.offer_id = $1 OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.offer_id = $1))
      LIMIT 1`,
    [clubOfferId, email, contactId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * The last ordinary Club promotion this contact was actually sent (the Club
 * nurture or another reminder), for the 24-hour spacing check.
 */
async function lastClubPromotionAt(db: Queryable, contactId: number): Promise<Date | null> {
  const res = await db.query<{ at: Date | null }>(
    `SELECT max(COALESCE(m.sent_at, m.created_at)) AS at
       FROM email_messages m
       JOIN email_sequences q ON q.id = m.source_id
      WHERE m.source_type = 'sequence' AND m.contact_id = $1
        AND q.slug = ANY($2::text[])
        AND m.status NOT IN ('failed', 'suppressed')`,
    [contactId, [...CLUB_PROMOTION_SEQUENCE_SLUGS]]
  );
  return res.rows[0]?.at ?? null;
}

/** Records a reminder that was claimed and deliberately not sent. */
async function closeClaim(client: PoolClient, window: BonusWindow, key: ReminderKey, outcome: string): Promise<void> {
  await client.query(
    `UPDATE club_bonus_reminder_sends SET outcome = $4
      WHERE window_id = $1 AND reminder = $2 AND deadline_at = $3`,
    [window.id, key, window.deadlineAt, outcome]
  );
  await client.query("COMMIT");
}

async function sendReminder(
  window: BonusWindow,
  key: ReminderKey,
  sequence: { id: number; topic: string },
  clubOfferId: number | null,
  now: Date
): Promise<boolean> {
  if (!window.deadlineAt) return false;
  const contactRes = await pool.query<{
    id: number;
    email: string;
    name: string;
    first_name: string;
    last_name: string;
    timezone: string;
    custom_fields: unknown;
  }>(
    `SELECT id, email, name, first_name, last_name, timezone, custom_fields
       FROM contacts WHERE id = $1::int OR lower(email::text) = $2::text
      ORDER BY (id = $1::int) DESC NULLS LAST, id LIMIT 1`,
    [window.contactId, window.email]
  );
  const contact = contactRes.rows[0];
  if (!contact) return false;
  // Purchasing removes the subscriber from these reminders; test accounts never get them.
  if (clubOfferId !== null && (await ownsClub(pool, clubOfferId, contact.id, window.email))) return false;
  if (await clubBonusExclusion(pool, { email: window.email, contactId: contact.id, window })) return false;

  const emailRes = await pool.query<{
    subject: string;
    body_md: string;
    preview_text: string | null;
    from_name: string;
    from_email: string;
  }>(
    `SELECT subject, body_md, preview_text, from_name, from_email FROM sequence_emails
      WHERE sequence_id = $1 AND position = $2`,
    [sequence.id, REMINDER_POSITION[key]]
  );
  const email = emailRes.rows[0];
  if (!email) return false;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The ledger row is the lock: a second tick waits here, then finds it.
    const claimed = await client.query(
      `INSERT INTO club_bonus_reminder_sends (window_id, reminder, deadline_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING window_id`,
      [window.id, key, window.deadlineAt]
    );
    if ((claimed.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    // Immediately before sending (her doc: "Check purchase status immediately
    // before each send"): re-read the saved window (the date in the email is
    // the one checkout uses), and check purchase, test account and expiry again.
    const fresh = await client.query<WindowRow>(`SELECT ${WINDOW_COLUMNS} FROM club_bonus_windows WHERE id = $1`, [
      window.id,
    ]);
    const current = toWindow(fresh.rows[0]);
    if (!current?.deadlineAt || current.deadlineAt.getTime() !== window.deadlineAt.getTime()) {
      await client.query("ROLLBACK");
      return false;
    }
    const sendNow = new Date(Math.max(now.getTime(), Date.now()));
    if (!withinBonusWindow(current.deadlineAt, sendNow)) {
      await closeClaim(client, window, key, "skipped: expired");
      return false;
    }
    if (
      clubOfferId !== null &&
      ((await ownsClub(client, clubOfferId, contact.id, window.email)) ||
        (await paidClubOrder(client, clubOfferId, contact.id, window.email)))
    ) {
      await closeClaim(client, window, key, "skipped: purchased");
      return false;
    }
    if (await clubBonusExclusion(client, { email: window.email, contactId: contact.id, window: current })) {
      await closeClaim(client, window, key, "skipped: test account");
      return false;
    }
    // "If necessary, skip a reminder that cannot meet spacing." The Club
    // sequence suppresses its own email around a reminder, so this only bites
    // when something went out off-rhythm (e.g. before the reminders were on).
    const lastPromotion = await lastClubPromotionAt(client, contact.id);
    if (lastPromotion && tooClose(lastPromotion, sendNow)) {
      await closeClaim(client, window, key, "skipped: spacing");
      return false;
    }

    const values: Record<string, string> = {
      ...buildMergeValues(
        {
          email: contact.email,
          name: contact.name,
          firstName: contact.first_name,
          lastName: contact.last_name,
          timezone: contact.timezone,
          customFields: contact.custom_fields,
        },
        mergeLinks(contact.id),
        now
      ),
      clubBonusDeadline: formatBonusDeadline(current.deadlineAt),
      clubBonusLink: clubBonusLink(current),
      clubBonusToken: signClubBonusToken(current.id),
      ...bonusDeadlineMergeValues(current.deadlineAt),
    };
    // Hard guard: never an unresolved or blank placeholder, never a doc note.
    const problems = unresolvedPlaceholders([email.subject, email.preview_text ?? "", email.body_md], values);
    if (problems.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`[clubBonus] ${key} for window ${window.id} blocked: ${problems.join("; ")}`);
      await closeClaim(client, window, key, `blocked: ${problems.join("; ")}`.slice(0, 500));
      return false;
    }
    const result = await sendEmail({
      to: contact.email,
      subject: renderTokens(email.subject, values),
      text: renderTokens(email.body_md, values),
      html: renderMarkdown(renderTokens(email.body_md, values)),
      contactId: contact.id,
      sourceType: "sequence",
      sourceId: sequence.id,
      topic: sequence.topic,
      fromName: email.from_name,
      fromEmail: email.from_email,
      preheader: renderTokens(email.preview_text ?? "", values),
    });
    await client.query(
      `UPDATE club_bonus_reminder_sends SET email_message_id = $4, outcome = $5, sent_at = now()
        WHERE window_id = $1 AND reminder = $2 AND deadline_at = $3`,
      [window.id, key, window.deadlineAt, result.messageId, result.outcome]
    );
    await client.query("COMMIT");
    return result.outcome === "sent";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
