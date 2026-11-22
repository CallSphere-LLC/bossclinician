import { z } from "zod";
import { pool } from "../db/pool";
import { copyQuestionnaires } from "./retreatQuestionnaires";
import { findRetreatById, findRetreatBySlug, normaliseSettings, type RetreatRow, type RetreatSettings } from "./retreats";

/**
 * "Duplicate retreat" (Yvette's item 7): a NEW, unpublished retreat with its
 * own draft dashboard product and unpublished course, carrying over the
 * source's settings, checklist choices and questionnaires (current wording, as
 * version 1).
 *
 * Never copied: guests, access grants, responses, files, signed agreements
 * (retreat_contracts), booking offers and orders (retreat_offers,
 * booking_product_id), announcements, memories, feedback, interest, offer
 * cards. Unconfirmed-by-nature details (shuttle windows, group call, flight
 * guidance, passport date, airport transport note, deadline dates) start empty.
 */

export const duplicateSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single dashes, e.g. costa-rica-2028.").max(80),
    location: z.string().trim().max(200).default(""),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().trim().min(1).max(64).optional(),
    airport: z.string().trim().max(200).default(""),
  })
  .strict();

export type DuplicateInput = z.infer<typeof duplicateSchema>;

export class DuplicateError extends Error {}

/** The settings a copy starts with. Pure, so the reset list is tested. */
export function duplicatedSettings(source: RetreatSettings, airport: string): RetreatSettings {
  return {
    ...source,
    airport,
    guestProfileUrl: "",
    flightTrackerUrl: "",
    transportNote: "",
    shuttle: { confirmed: false, details: "" },
    groupCall: { ...source.groupCall, confirmed: false, startsAt: null, joinUrl: "", notes: "" },
    flightGuidance: { status: "researching", note: "" },
    passportValidThrough: null,
    deadlines: source.deadlines.map((d) => ({ ...d, date: null })),
    joinUsAgain: { ...source.joinUsAgain, mode: "closed" },
  };
}

export async function duplicateRetreat(source: RetreatRow, input: DuplicateInput, adminId: number | null): Promise<RetreatRow> {
  if (input.endDate < input.startDate) throw new DuplicateError("The end date is before the start date.");
  const timezone = input.timezone ?? source.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new DuplicateError("That time zone isn't recognised. Use a name like America/Los_Angeles.");
  }
  if (await findRetreatBySlug(input.slug)) throw new DuplicateError("Another retreat already uses that web address.");
  const productSlug = `flourishealer-retreats-${input.slug}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const taken = await client.query(
      `SELECT 1 FROM courses WHERE slug = $1 UNION ALL SELECT 1 FROM products WHERE slug = $1`,
      [productSlug],
    );
    if (taken.rows.length) throw new DuplicateError("A course or product already uses that web address.");

    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (slug, title, subtitle, description, price_text, image, url, features, sort, published)
       VALUES ($1, $2, 'Your private retreat dashboard',
               'Your private FlourisHealer retreat dashboard: your agreement, questionnaires, travel, preparation, itinerary, payments and messages in one place.',
               '', NULL, '', '[]'::jsonb, (SELECT COALESCE(MAX(sort), 0) + 1 FROM courses), false)
       RETURNING id`,
      [productSlug, input.title],
    );
    const courseId = course.rows[0].id;
    const moduleRow = await client.query<{ id: number }>(
      `INSERT INTO course_modules (course_id, title, sort) VALUES ($1, 'Your Retreat Dashboard', 0) RETURNING id`,
      [courseId],
    );
    await client.query(
      `INSERT INTO course_lessons
         (module_id, title, slug, body_md, content_type, published, sort, tool_key, tool_config,
          requires_previous_lesson, watch_rule, comments_enabled, notes_enabled)
       VALUES ($1, 'YOUR RETREAT DASHBOARD', 'your-retreat-dashboard', '', 'text', true, 0,
               'flourishealer-retreat-dashboard', $2::jsonb, false, 'skippable', false, false)`,
      [moduleRow.rows[0].id, JSON.stringify({ retreat: input.slug })],
    );
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, subtitle, description, kind, course_id, status, sort)
       VALUES ($1, $2, 'Private retreat dashboard',
               'Private guest dashboard for this FlourisHealer retreat. Give this product to a confirmed guest to open her dashboard.',
               'course', $3, 'draft', (SELECT COALESCE(MAX(sort), 0) + 1 FROM products))
       RETURNING id`,
      [productSlug, input.title, courseId],
    );
    const settings = duplicatedSettings(normaliseSettings(source.settings), input.airport);
    const retreat = await client.query<{ id: number }>(
      `INSERT INTO retreats (slug, title, location, start_date, end_date, timezone, product_id, booking_product_id, course_id, published, settings)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, NULL, $8, false, $9::jsonb)
       RETURNING id`,
      [input.slug, input.title, input.location, input.startDate, input.endDate, timezone, product.rows[0].id, courseId, JSON.stringify(settings)],
    );
    await copyQuestionnaires(source.id, retreat.rows[0].id, adminId, client);
    await client.query("COMMIT");
    return (await findRetreatById(retreat.rows[0].id))!;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
