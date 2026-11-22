import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { validateCollectedEmail } from "../../email/sesValidation";
import { subscribeLimiter } from "../../middleware/rateLimit";
import {
  applyTags,
  recordActivity,
  upsertContactWithStatus,
} from "../../services/contacts";
import { publishDomainEvent } from "../../services/domainEvents";

/**
 * The public face of the retreats table (Yvette's second reply of 22 Nov 2026,
 * item 6): the permanent /upcoming-retreats listing, each listed retreat's own
 * destination-and-year page (/retreats/<slug>), and the reusable
 * /retreat-interest announcement sign-up.
 *
 * Listing rule: `listed_publicly` (migration 223), never `published`. The
 * latter opens a retreat's private guest dashboard; a sales page goes public
 * long before that dashboard does (Bali's has been public since September
 * while its dashboard is still a draft). A listed retreat drops off the
 * upcoming list by itself the day after its end date, in Pacific time.
 *
 * Only the columns below ever leave this file. `settings` (guest-facing
 * dashboard content, call links, questionnaire config) is never selected.
 *
 * The sign-up stores a contact and the "retreat-announcements" tag and sends
 * NOTHING: no welcome email, no owner notification, no automation trigger.
 * Announcements are sent by hand, to that tag, when a retreat is announced.
 */
export const retreatsPublicRouter = Router();

/** The tag /retreat-interest applies (seeded by migration 223). */
export const RETREAT_INTEREST_TAG = "retreat-announcements";

/** `contacts.consent_source`, `contacts.source` and the activity's origin. */
export const RETREAT_INTEREST_SOURCE = "retreat-interest";

/**
 * What the visitor ticks, stored with her sign-up so "why was I mailed?" has
 * the exact answer. Must stay word-for-word the label the page shows
 * (frontend/src/content/retreatInterest.ts `consentLabel`).
 */
export const RETREAT_INTEREST_CONSENT =
  "Yes, email me announcements about new FlourisHealer retreats. I can unsubscribe at any time.";

/** Faster than this and nobody read the form (same rule as routes/public/leads.ts). */
const MIN_FILL_MS = 2000;

/** "Today" for the listing: Pacific, as Yvette works and as the brief states. */
const TODAY_PACIFIC = `(now() AT TIME ZONE 'America/Los_Angeles')::date`;

export interface PublicRetreat {
  slug: string;
  title: string;
  location: string;
  /** YYYY-MM-DD, the calendar date as stored. Never parsed through `Date`. */
  startDate: string;
  endDate: string;
  summary: string;
  image: string;
  /** Where the card links. */
  href: string;
  /** False once end_date has passed (Pacific). */
  upcoming: boolean;
}

export interface RetreatRow {
  slug: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string;
  public_summary: string;
  public_image: string;
  public_path: string | null;
  upcoming: boolean;
}

const COLUMNS = `slug, title, location,
       to_char(start_date, 'YYYY-MM-DD') AS start_date,
       to_char(end_date, 'YYYY-MM-DD') AS end_date,
       public_summary, public_image, public_path,
       (end_date >= ${TODAY_PACIFIC}) AS upcoming`;

/** A site path ("/x", never protocol-relative "//host") or an https URL. */
function safeLink(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (/^\/(?!\/)/.test(v)) return v;
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  return null;
}

/**
 * A retreat's card link: its own `public_path`, else its destination-and-year
 * page. "dashboard" is the one slug that address cannot carry — /retreats/dashboard
 * is the member area — so such a retreat links to the listing instead.
 */
export function retreatHref(slug: string, publicPath: string | null): string {
  const explicit = safeLink(publicPath);
  if (explicit) return explicit;
  return slug === "dashboard" ? "/upcoming-retreats" : `/retreats/${slug}`;
}

export function toPublicRetreat(row: RetreatRow): PublicRetreat {
  const image = safeLink(row.public_image);
  return {
    slug: row.slug,
    title: row.title,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    summary: row.public_summary,
    // Only a site image or an https one; anything else shows no photo.
    image: image ?? "",
    href: retreatHref(row.slug, row.public_path),
    upcoming: row.upcoming === true,
  };
}

/** Listed and not yet ended (Pacific), soonest first. Also the SSR loader for /upcoming-retreats. */
export async function listUpcomingRetreats(): Promise<PublicRetreat[]> {
  const result = await pool.query<RetreatRow>(
    `SELECT ${COLUMNS}
       FROM retreats
      WHERE listed_publicly = true
        AND end_date >= ${TODAY_PACIFIC}
      ORDER BY start_date, id`,
  );
  return result.rows.map(toPublicRetreat);
}

/** One listed retreat by slug, ended or not (its page says which). Null when unlisted. */
export async function getListedRetreat(slug: string): Promise<PublicRetreat | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const result = await pool.query<RetreatRow>(
    `SELECT ${COLUMNS} FROM retreats WHERE slug = $1 AND listed_publicly = true`,
    [slug],
  );
  return result.rows[0] ? toPublicRetreat(result.rows[0]) : null;
}

retreatsPublicRouter.get(
  "/upcoming-retreats",
  asyncHandler(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=60");
    res.json({ retreats: await listUpcomingRetreats() });
  }),
);

retreatsPublicRouter.get(
  "/upcoming-retreats/:slug",
  asyncHandler(async (req, res) => {
    const retreat = await getListedRetreat(String(req.params.slug));
    if (!retreat) throw notFound("Retreat not found");
    res.set("Cache-Control", "public, max-age=60");
    res.json({ retreat });
  }),
);

export const retreatInterestSchema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().trim().max(100).optional(),
  // The box must be ticked: an unticked form is not consent.
  consent: z.literal(true),
  // Which retreat page she came from, if any. Stored, never trusted for anything.
  retreat: z.string().max(80).regex(/^[a-z0-9-]*$/).optional(),
  // Bot trap (components/forms/useHoneypot).
  company: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

retreatsPublicRouter.post(
  "/retreat-interest",
  subscribeLimiter,
  asyncHandler(async (req, res) => {
    const parsed = retreatInterestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please enter your email and tick the box to sign up.", parsed.error.flatten());
    const { email, firstName, retreat, company, elapsedMs } = parsed.data;

    // A filled honeypot, or a form sent faster than a person can read it, gets
    // the same 201 a real sign-up gets, and nothing is written.
    if (company?.trim() || (elapsedMs !== undefined && elapsedMs < MIN_FILL_MS)) {
      res.status(201).json({ ok: true });
      return;
    }

    const validation = await validateCollectedEmail(email);
    if (!validation.accepted) throw badRequest(validation.reason || "Please check your email address.");

    // Same contact record every public opt-in uses. An address that earlier
    // unsubscribed keeps its status: this form does not override an opt-out
    // (routes/public/subscribe.ts behaves the same way).
    const contact = await upsertContactWithStatus({
      email,
      firstName: firstName ?? "",
      source: RETREAT_INTEREST_SOURCE,
      consentSource: RETREAT_INTEREST_SOURCE,
      consentIp: req.ip ?? "",
    });
    const contactId = contact.id;

    await applyTags(contactId, [RETREAT_INTEREST_TAG], RETREAT_INTEREST_SOURCE);
    await recordActivity({
      contactId,
      kind: "retreat_interest.subscribed",
      title: "Signed up for FlourisHealer retreat announcements",
      meta: {
        source: RETREAT_INTEREST_SOURCE,
        consent: RETREAT_INTEREST_CONSENT,
        ip: (req.ip ?? "").slice(0, 64),
        ...(retreat ? { retreat } : {}),
      },
    });
    if (contact.created) {
      await publishDomainEvent("contact_created", {
        eventKey: `contact-created:${contactId}`,
        contactId,
        email,
        source: RETREAT_INTEREST_SOURCE,
      });
    }

    res.status(201).json({ ok: true });
  }),
);
