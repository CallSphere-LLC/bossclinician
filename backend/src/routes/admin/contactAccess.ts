import { Router } from "express";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { rowsToCamel } from "../../utils/case";

/**
 * What one person can get into. Mounted at /admin/contact-access.
 *
 * Granting and revoking have existed on the offers router since Phase 2
 * (`POST /admin/offers/:id/grant` and `/revoke`) with nothing calling them,
 * because no screen could show what a person already had. The only place a
 * contact's grants were ever read was the data export, which writes an audit
 * row and returns their entire history — not something to call to draw a card.
 *
 * Read-only: every change still goes through the offers router, so a grant made
 * from a contact's page expands bundles, honours expiry and is audited exactly
 * as one made anywhere else.
 */
export const adminContactAccessRouter = Router();

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid id");
  return id;
}

adminContactAccessRouter.get(
  "/:contactId",
  asyncHandler(async (req, res) => {
    const contactId = parseId(req.params.contactId);

    const contact = await pool.query<{ email: string }>(
      `SELECT email::text AS email FROM contacts WHERE id = $1`,
      [contactId]
    );
    const found = contact.rows[0];
    if (!found) throw notFound("Contact not found");

    // Linked by `contact_id`, or — for an account made before the link existed,
    // or by a grant a moment ago — by the address. members.email is CITEXT, so
    // the comparison ignores how it was typed.
    const members = await pool.query<{ id: number; email: string; status: string }>(
      `SELECT id, email::text AS email, status
         FROM members
        WHERE (contact_id = $1 OR ($2::text <> '' AND email = $2::citext)) AND status <> 'deleted'
        ORDER BY id`,
      [contactId, found.email ?? ""]
    );
    const memberIds = members.rows.map((row) => row.id);

    const grants =
      memberIds.length === 0
        ? { rows: [] as Record<string, unknown>[] }
        : await pool.query(
            `SELECT g.id, g.member_id, g.product_id, p.title AS product_title,
                    g.offer_id, o.title AS offer_title, g.source, g.status,
                    g.granted_at, g.expires_at, g.revoked_at, g.revoke_reason
               FROM access_grants g
               JOIN products p ON p.id = g.product_id
               LEFT JOIN offers o ON o.id = g.offer_id
              WHERE g.member_id = ANY($1::int[])
              ORDER BY (g.status = 'active') DESC, g.granted_at DESC, g.id DESC`,
            [memberIds]
          );

    res.json({
      members: rowsToCamel(members.rows),
      grants: rowsToCamel(grants.rows),
    });
  })
);
