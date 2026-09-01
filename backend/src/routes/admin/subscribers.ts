import { Router } from "express";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { Subscriber } from "../../types";
import { MAILABLE_CONTACT_SQL } from "../../services/audience";

export const adminSubscribersRouter = Router();

/**
 * GET /admin/subscribers — the email list.
 *
 * Reads `contacts`, not the `subscribers` table this screen is named after.
 * That table is written by exactly two things — the public newsletter box and
 * one legacy automation action — so it held a fraction of the list and, on this
 * site, none of it: five consenting contacts, zero subscriber rows, and a
 * screen that said "no subscribers yet" next to a Contacts page showing five
 * people all marked "Happy to hear from you".
 *
 * The filter is the same `MAILABLE_CONTACT_SQL` the campaign estimator and the
 * send itself use, so this screen now lists precisely the people a broadcast
 * would reach. `consent_source` is preferred over `source` because it records
 * where permission was actually given; `source` is where the contact first came
 * from, which for a buyer is a checkout rather than a sign-up box.
 */
adminSubscribersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT c.id,
              c.email,
              COALESCE(NULLIF(c.consent_source, ''), c.source) AS source,
              COALESCE(c.opted_in_at, c.created_at)            AS created_at
         FROM contacts c
        WHERE ${MAILABLE_CONTACT_SQL}
        ORDER BY COALESCE(c.opted_in_at, c.created_at) DESC, c.id DESC`
    );
    res.json(rowsToCamel<Subscriber>(result.rows));
  })
);
