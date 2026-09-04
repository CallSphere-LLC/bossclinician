import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { applyTags, normaliseSlugs, recordActivity, removeTags } from "../../services/contacts";
import { MAILABLE_CONTACT_SQL } from "../../services/audience";
import { dispatchEvent } from "../../services/webhooksOut";
import { publishDomainEvent } from "../../services/domainEvents";
import { requirePermission } from "../../services/permissions";
import { enrollContact } from "../../services/sequences";
import { grantOfferAccess } from "../../services/access";

/**
 * Contacts — the one list of people, mounted at /admin/contacts.
 *
 * Everything the owner does to an audience happens here: find somebody, see
 * everything they have ever done, tag them, import a spreadsheet, export one,
 * and merge the two rows that turn out to be the same person.
 */
export const adminContactsRouter = Router();
const requireManage = requirePermission("contacts.manage");

const EMAIL_STATUSES = [
  "subscribed",
  "opted_out",
  "bounced",
  "complained",
  "unconfirmed",
] as const;

const CONTACT_COLUMNS = `c.id, c.email::text AS email, c.name, c.first_name, c.last_name,
       c.phone, c.timezone, c.email_marketing_status, c.opted_in_at, c.opted_out_at,
       c.consent_source, c.lifetime_value_cents, c.order_count, c.last_activity_at,
       c.last_ordered_at, c.source, c.custom_fields, c.notes, c.created_at, c.updated_at`;

/** The tags on a contact, as names and slugs, without a GROUP BY over the whole list. */
const CONTACT_TAGS = `COALESCE((SELECT json_agg(json_build_object('slug', t.slug::text, 'name', t.name, 'colour', t.colour)
                                  ORDER BY t.name)
                                 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
                                WHERE ct.contact_id = c.id), '[]'::json) AS tags`;

const idSchema = z.coerce.number().int().positive();

function parseId(raw: string, label = "contact"): number {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw badRequest(`Invalid ${label} id`);
  return parsed.data;
}

/** Escapes the characters LIKE reads as syntax, so searching for "100%" finds it. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Sorting comes from a fixed map rather than from the query string.
 *
 * An ORDER BY assembled from a parameter is the same injection hole a WHERE is,
 * and it is the one people forget because it looks like presentation.
 */
const SORTS = {
  recent: "c.last_activity_at DESC NULLS LAST, c.id DESC",
  newest: "c.created_at DESC",
  oldest: "c.created_at ASC",
  name: "lower(c.name) ASC, c.id",
  value: "c.lifetime_value_cents DESC, c.id",
  orders: "c.order_count DESC, c.id",
} as const;

interface ContactFilters {
  q?: string;
  tag?: string;
  status?: string;
  untagged?: boolean;
  audience?: "new" | "subscribed" | "new_subscriber" | "customer" | "new_customer";
  optOut?: "manual" | "self";
  engagement?: "healthy" | "passive" | "unengaged" | "inactive";
}

const LAST_ENGAGED_SQL = `GREATEST(
  COALESCE((SELECT MAX(m.first_clicked_at) FROM email_messages m WHERE m.contact_id = c.id), '-infinity'::timestamptz),
  COALESCE((SELECT MAX(m.first_opened_at)  FROM email_messages m WHERE m.contact_id = c.id), '-infinity'::timestamptz),
  COALESCE(c.opted_in_at, c.created_at)
)`;

function buildFilters(filters: ContactFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    params.push(likePattern(filters.q.toLowerCase()));
    clauses.push(
      `(lower(c.email::text) LIKE $${params.length}
         OR lower(c.name) LIKE $${params.length}
         OR lower(c.phone) LIKE $${params.length})`
    );
  }

  if (filters.tag) {
    params.push(filters.tag);
    clauses.push(
      `EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
                WHERE ct.contact_id = c.id AND t.slug = $${params.length}::citext)`
    );
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`c.email_marketing_status = $${params.length}`);
  }

  if (filters.untagged) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id)`);
  }

  if (filters.audience === "new") clauses.push(`c.created_at >= now() - interval '30 days'`);
  if (filters.audience === "subscribed") clauses.push(MAILABLE_CONTACT_SQL);
  if (filters.audience === "new_subscriber") {
    clauses.push(MAILABLE_CONTACT_SQL, `c.opted_in_at >= now() - interval '30 days'`);
  }
  if (filters.audience === "customer") clauses.push(`c.order_count > 0`);
  if (filters.audience === "new_customer") {
    clauses.push(`c.order_count > 0`, `c.last_ordered_at >= now() - interval '30 days'`);
  }

  if (filters.optOut === "manual") {
    clauses.push(`c.email_marketing_status = 'opted_out'`, `c.consent_source IN ('admin','manual')`);
  }
  if (filters.optOut === "self") {
    clauses.push(`c.email_marketing_status = 'opted_out'`, `c.consent_source NOT IN ('admin','manual')`);
  }

  if (filters.engagement) {
    clauses.push(MAILABLE_CONTACT_SQL);
    const age = LAST_ENGAGED_SQL;
    if (filters.engagement === "healthy") clauses.push(`${age} >= now() - interval '90 days'`);
    if (filters.engagement === "passive") {
      clauses.push(`${age} < now() - interval '90 days'`, `${age} >= now() - interval '180 days'`);
    }
    if (filters.engagement === "unengaged") {
      clauses.push(`${age} < now() - interval '180 days'`, `${age} >= now() - interval '270 days'`);
    }
    if (filters.engagement === "inactive") clauses.push(`${age} < now() - interval '270 days'`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(80).optional(),
  status: z.enum(EMAIL_STATUSES).optional(),
  untagged: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  audience: z.enum(["new", "subscribed", "new_subscriber", "customer", "new_customer"]).optional(),
  optOut: z.enum(["manual", "self"]).optional(),
  engagement: z.enum(["healthy", "passive", "unengaged", "inactive"]).optional(),
  sort: z.enum(["recent", "newest", "oldest", "name", "value", "orders"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * List health, computed from the same contact and delivery facts the sender
 * uses. It is live rather than a second denormalised counter, so every tile and
 * the People list agree immediately after an opt-out, bounce or purchase.
 */
adminContactsRouter.get(
  "/insights",
  asyncHandler(async (_req, res) => {
    const [summary, engagement] = await Promise.all([
      pool.query<{
        contacts: number;
        new_contacts: number;
        subscribed: number;
        new_subscribers: number;
        customers: number;
        new_customers: number;
        manually_unsubscribed: number;
        opted_out: number;
        bounced: number;
        complained: number;
        never_subscribed: number;
      }>(
        `SELECT COUNT(*)::int AS contacts,
                COUNT(*) FILTER (WHERE c.created_at >= now() - INTERVAL '30 days')::int AS new_contacts,
                COUNT(*) FILTER (WHERE ${MAILABLE_CONTACT_SQL})::int AS subscribed,
                COUNT(*) FILTER (WHERE ${MAILABLE_CONTACT_SQL}
                                   AND c.opted_in_at >= now() - INTERVAL '30 days')::int AS new_subscribers,
                COUNT(*) FILTER (WHERE c.order_count > 0)::int AS customers,
                COUNT(*) FILTER (WHERE c.order_count > 0
                                   AND c.last_ordered_at >= now() - INTERVAL '30 days')::int AS new_customers,
                COUNT(*) FILTER (WHERE c.email_marketing_status = 'opted_out'
                                   AND c.consent_source IN ('admin','manual'))::int AS manually_unsubscribed,
                COUNT(*) FILTER (WHERE c.email_marketing_status = 'opted_out'
                                   AND c.consent_source NOT IN ('admin','manual'))::int AS opted_out,
                COUNT(*) FILTER (WHERE c.email_marketing_status = 'bounced')::int AS bounced,
                COUNT(*) FILTER (WHERE c.email_marketing_status = 'complained')::int AS complained,
                COUNT(*) FILTER (WHERE c.email_marketing_status = 'unconfirmed')::int AS never_subscribed
           FROM contacts c`,
      ),
      pool.query<{ healthy: number; passive: number; unengaged: number; inactive: number }>(
        `WITH last_touch AS (
           SELECT c.id,
                  GREATEST(
                    COALESCE(MAX(m.first_clicked_at), '-infinity'::timestamptz),
                    COALESCE(MAX(m.first_opened_at), '-infinity'::timestamptz),
                    COALESCE(c.opted_in_at, c.created_at)
                  ) AS engaged_at
             FROM contacts c
             LEFT JOIN email_messages m ON m.contact_id = c.id
            WHERE ${MAILABLE_CONTACT_SQL}
            GROUP BY c.id, c.opted_in_at, c.created_at
         )
         SELECT COUNT(*) FILTER (WHERE engaged_at >= now() - INTERVAL '90 days')::int AS healthy,
                COUNT(*) FILTER (WHERE engaged_at < now() - INTERVAL '90 days'
                                  AND engaged_at >= now() - INTERVAL '180 days')::int AS passive,
                COUNT(*) FILTER (WHERE engaged_at < now() - INTERVAL '180 days'
                                  AND engaged_at >= now() - INTERVAL '270 days')::int AS unengaged,
                COUNT(*) FILTER (WHERE engaged_at < now() - INTERVAL '270 days')::int AS inactive
           FROM last_touch`,
      ),
    ]);

    res.json({ ...rowToCamel(summary.rows[0]), engagement: rowToCamel(engagement.rows[0]) });
  }),
);

adminContactsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { sort, page, limit, ...filters } = parsed.data;

    const { where, params } = buildFilters(filters);

    const [items, total] = await Promise.all([
      pool.query(
        `SELECT ${CONTACT_COLUMNS}, ${CONTACT_TAGS}
           FROM contacts c
           ${where}
          ORDER BY ${SORTS[sort]}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM contacts c ${where}`,
        params
      ),
    ]);

    res.json({
      items: rowsToCamel(items.rows),
      total: total.rows[0]?.count ?? 0,
      page,
      pageSize: limit,
    });
  })
);

/**
 * Escapes one CSV field, against two separate problems.
 *
 * The first is CSV syntax: quote every field and double any quote inside it, so
 * a comma or a newline in a name cannot shift the remaining columns.
 *
 * The second is that Excel and Sheets treat a leading =, +, - or @ as the start
 * of a formula, so a contact whose name is `=HYPERLINK("http://evil","hi")` is
 * shipping code that runs when the file is opened — and a contact name is
 * whatever a stranger typed into a public form. The apostrophe forces the cell
 * to be read as text and is not part of the value. Tab and carriage return lead
 * the same way in some locales, so they are covered too.
 */
function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const CSV_HEADERS = [
  "Email",
  "First name",
  "Last name",
  "Full name",
  "Phone",
  "Email subscription",
  "Tags",
  "Total spent",
  "Purchases",
  "Last active",
  "Added",
];

const exportQuerySchema = listQuerySchema.pick({ q: true, tag: true, status: true, untagged: true });

interface ExportRow {
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  phone: string;
  email_marketing_status: string;
  tag_names: string[];
  lifetime_value_cents: number;
  order_count: number;
  last_activity_at: string | null;
  created_at: string;
}

/** Registered ahead of /:id and distinct from it by shape, so it is never read as an id. */
adminContactsRouter.get(
  "/export.csv",
  asyncHandler(async (req, res) => {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());

    const { where, params } = buildFilters(parsed.data);
    const result = await pool.query<ExportRow>(
      `SELECT c.email::text AS email, c.name, c.first_name, c.last_name, c.phone,
              c.email_marketing_status, c.lifetime_value_cents, c.order_count,
              c.last_activity_at, c.created_at,
              COALESCE((SELECT array_agg(t.name ORDER BY t.name)
                          FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
                         WHERE ct.contact_id = c.id), '{}') AS tag_names
         FROM contacts c
         ${where}
        ORDER BY c.created_at DESC`,
      params
    );

    const lines = [CSV_HEADERS.map(csvCell).join(",")];
    for (const row of result.rows) {
      lines.push(
        [
          row.email,
          row.first_name,
          row.last_name,
          row.name,
          row.phone,
          row.email_marketing_status,
          row.tag_names.join(", "),
          // Dollars, not the integer of cents the database keeps — the file is
          // opened in a spreadsheet by somebody who thinks in money.
          (row.lifetime_value_cents / 100).toFixed(2),
          row.order_count,
          row.last_activity_at ?? "",
          row.created_at,
        ]
          .map(csvCell)
          .join(",")
      );
    }

    await recordAdminAction({
      req,
      action: "contact.export_csv",
      entityType: "contact",
      entityId: "",
      after: { rows: result.rows.length },
    });

    const filename = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // The BOM is for Excel, which otherwise reads the file in the local ANSI
    // codepage and turns every accented name into mojibake.
    res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
  })
);

const importRowSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  source: z.string().trim().max(80).optional(),
  /** Tags on the row itself, comma-separated the way a spreadsheet holds them. */
  tags: z.string().trim().max(500).optional(),
});

// Rows are validated one at a time rather than as a typed array, because the
// point of the answer is to say *which* rows were rejected and why. A schema
// over the whole array fails the entire spreadsheet on one bad address.
const importSchema = z.object({
  rows: z.array(z.unknown()).max(5000),
  /** Applied to every row in the file — "everyone on this list is a retreat lead". */
  tagSlugs: z.array(z.string().max(80)).max(20).default([]),
});

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "We couldn't read this line";
  return issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
}

/**
 * POST /import
 *
 * Deliberately not one transaction. A spreadsheet exported from the old system
 * will have a handful of malformed addresses in it, and throwing away 4,900 good
 * rows because of them helps nobody — every row that can be applied is applied,
 * and the rest come back itemised so they can be fixed and re-sent. Re-sending
 * the whole file is safe: an already-imported row becomes an update.
 */
adminContactsRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    const fileTags = normaliseSlugs(parsed.data.tagSlugs);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: { row: number; email?: string; message: string }[] = [];
    const seen = new Set<string>();

    for (const [index, raw] of parsed.data.rows.entries()) {
      const rowNumber = index + 1;
      const row = importRowSchema.safeParse(raw);
      if (!row.success) {
        skipped += 1;
        errors.push({ row: rowNumber, message: firstIssue(row.error) });
        continue;
      }

      // Two lines for the same person would otherwise be reported as one created
      // and one updated, which reads as the file having imported cleanly.
      const email = row.data.email.toLowerCase();
      if (seen.has(email)) {
        skipped += 1;
        errors.push({ row: rowNumber, email, message: "Already on an earlier line of this file" });
        continue;
      }
      seen.add(email);

      const first = row.data.firstName ?? "";
      const last = row.data.lastName ?? "";
      const name = row.data.name ?? `${first} ${last}`.trim();

      try {
        // `xmax = 0` is true only for a tuple this statement inserted, which is
        // the one way to tell a create from an update inside a single upsert.
        const result = await pool.query<{ id: number; inserted: boolean }>(
          `INSERT INTO contacts AS c (email, name, first_name, last_name, phone, source)
           VALUES ($1, $2, $3, $4, $5, COALESCE(NULLIF($6, ''), 'import'))
           ON CONFLICT (email) DO UPDATE
              SET name       = COALESCE(NULLIF(EXCLUDED.name, ''), c.name),
                  first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), c.first_name),
                  last_name  = COALESCE(NULLIF(EXCLUDED.last_name, ''), c.last_name),
                  phone      = COALESCE(NULLIF(EXCLUDED.phone, ''), c.phone),
                  updated_at = now()
           RETURNING c.id, (xmax = 0) AS inserted`,
          [email, name, first, last, row.data.phone ?? "", row.data.source ?? ""]
        );

        const contact = result.rows[0];
        const rowTags = normaliseSlugs((row.data.tags ?? "").split(","));
        const tags = [...new Set([...fileTags, ...rowTags])];
        if (tags.length) await applyTags(contact.id, tags, "import");

        if (contact.inserted) {
          created += 1;
          await recordActivity({
            contactId: contact.id,
            kind: "imported",
            title: "Added from a spreadsheet",
          });
          await publishDomainEvent("contact_created", {
            eventKey: `contact-created:${contact.id}`,
            contactId: contact.id,
            email,
            name,
            source: "import",
          });
        } else {
          updated += 1;
        }
      } catch (err) {
        // The database's own message can name constraints and columns; the
        // import screen gets a plain sentence and the detail goes to the log.
        console.error(`[contacts:import] row ${rowNumber} failed:`, err);
        skipped += 1;
        errors.push({ row: rowNumber, email, message: "We couldn't save this one" });
      }
    }

    await recordAdminAction({
      req,
      action: "contact.import",
      entityType: "contact",
      entityId: "",
      after: { created, updated, skipped, submitted: parsed.data.rows.length },
    });

    res.json({ created, updated, skipped, errors });
  })
);

const bulkTagSchema = z.object({
  contactIds: z.array(z.coerce.number().int().positive()).min(1).max(5000),
  tagSlugs: z.array(z.string().max(80)).min(1).max(20),
  action: z.enum(["add", "remove"]),
});

const bulkTargetsSchema = z.object({
  contactIds: z.array(z.coerce.number().int().positive()).min(1).max(5000),
});

adminContactsRouter.post(
  "/bulk/tags",
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = bulkTagSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { contactIds, action } = parsed.data;
    const slugs = normaliseSlugs(parsed.data.tagSlugs);
    if (slugs.length === 0) throw badRequest("Choose at least one tag");

    const appliedBy = req.user?.email ?? "admin";
    let changed = 0;
    for (const contactId of new Set(contactIds)) {
      changed +=
        action === "add"
          ? await applyTags(contactId, slugs, appliedBy)
          : await removeTags(contactId, slugs);
    }

    await recordAdminAction({
      req,
      action: `contact.bulk_${action}_tags`,
      entityType: "contact",
      entityId: "",
      after: { contacts: contactIds.length, tags: slugs, changed },
    });

    res.json({ changed, contacts: contactIds.length });
  })
);

adminContactsRouter.post(
  "/bulk/sequence",
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = bulkTargetsSchema.extend({ sequenceId: z.coerce.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    let enrolled = 0;
    let alreadyEnrolled = 0;
    const blocked: { contactId: number; reason: string }[] = [];
    for (const contactId of new Set(parsed.data.contactIds)) {
      const result = await enrollContact(parsed.data.sequenceId, contactId, { reason: "Added by an administrator" });
      if (result.outcome === "enrolled") enrolled += 1;
      else if (result.outcome === "already_enrolled") alreadyEnrolled += 1;
      else blocked.push({ contactId, reason: result.reason });
    }
    await recordAdminAction({
      req,
      action: "contact.bulk_sequence",
      entityType: "contact",
      entityId: "",
      after: { sequenceId: parsed.data.sequenceId, enrolled, alreadyEnrolled, blocked: blocked.length },
    });
    res.json({ enrolled, alreadyEnrolled, blocked });
  }),
);

adminContactsRouter.post(
  "/bulk/offer",
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = bulkTargetsSchema.extend({ offerId: z.coerce.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const exists = await pool.query(`SELECT 1 FROM offers WHERE id = $1`, [parsed.data.offerId]);
    if (exists.rowCount === 0) throw notFound("Offer not found");

    let granted = 0;
    for (const contactId of new Set(parsed.data.contactIds)) {
      const contact = await pool.query<{ email: string; name: string }>(
        `SELECT email::text AS email, name FROM contacts WHERE id = $1`,
        [contactId],
      );
      if (!contact.rows[0]) continue;
      const member = await pool.query<{ id: number }>(
        `INSERT INTO members (email, name, status, contact_id)
         VALUES ($1, $2, 'active', $3)
         ON CONFLICT (email) DO UPDATE
           SET contact_id = COALESCE(members.contact_id, EXCLUDED.contact_id), updated_at = now()
         RETURNING id`,
        [contact.rows[0].email, contact.rows[0].name, contactId],
      );
      const products = await grantOfferAccess({
        memberId: member.rows[0].id,
        offerId: parsed.data.offerId,
        source: "manual",
      });
      if (products.length > 0) granted += 1;
      await recordActivity({
        contactId,
        kind: "offer_granted",
        title: "Offer access granted",
        subjectType: "offer",
        subjectId: String(parsed.data.offerId),
      });
    }
    await recordAdminAction({
      req,
      action: "contact.bulk_offer",
      entityType: "contact",
      entityId: "",
      after: { offerId: parsed.data.offerId, contacts: granted },
    });
    res.json({ granted });
  }),
);

adminContactsRouter.post(
  "/bulk/export.csv",
  asyncHandler(async (req, res) => {
    const parsed = bulkTargetsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const ids = [...new Set(parsed.data.contactIds)];
    const result = await pool.query<ExportRow>(
      `SELECT c.email::text AS email, c.name, c.first_name, c.last_name, c.phone,
              c.email_marketing_status, c.lifetime_value_cents, c.order_count,
              c.last_activity_at, c.created_at,
              COALESCE((SELECT array_agg(t.name ORDER BY t.name)
                          FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
                         WHERE ct.contact_id = c.id), '{}') AS tag_names
         FROM contacts c WHERE c.id = ANY($1::int[]) ORDER BY c.created_at DESC`,
      [ids],
    );
    const lines = [CSV_HEADERS.map(csvCell).join(",")];
    for (const row of result.rows) {
      lines.push([row.email, row.first_name, row.last_name, row.name, row.phone,
        row.email_marketing_status, row.tag_names.join(", "),
        (row.lifetime_value_cents / 100).toFixed(2), row.order_count,
        row.last_activity_at ?? "", row.created_at].map(csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="selected-contacts-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
  }),
);

adminContactsRouter.post(
  "/bulk/delete",
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = bulkTargetsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const ids = [...new Set(parsed.data.contactIds)];
    await pool.query(
      `DELETE FROM webhook_deliveries
        WHERE payload->>'contactId' = ANY($1::text[])
           OR payload->'contact'->>'id' = ANY($1::text[])`,
      [ids.map(String)],
    );
    const deleted = await pool.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [ids]);
    await recordAdminAction({
      req,
      action: "contact.bulk_delete",
      entityType: "contact",
      entityId: "",
      before: { contactIds: ids },
      after: { deleted: deleted.rowCount ?? 0 },
    });
    res.json({ deleted: deleted.rowCount ?? 0 });
  }),
);

/** The tables whose `contact_id` has to follow the survivor of a merge. */
const MERGEABLE_TABLES = ["leads", "subscribers", "members", "orders", "email_messages"] as const;

const mergeSchema = z.object({
  /** The row that survives. Its details win wherever both have one. */
  keepId: z.coerce.number().int().positive(),
  mergeId: z.coerce.number().int().positive(),
});

/**
 * POST /merge — two rows turn out to be the same person.
 *
 * Everything pointing at the duplicate is moved onto the survivor before the
 * duplicate is deleted, because `ON DELETE CASCADE` would otherwise take the
 * duplicate's history with it and the merge would read as data loss.
 *
 * Two rules are load-bearing and are not "keep the newer value":
 *
 *  - Sending permission is the strictest of the two. If either row says opted
 *    out, bounced or complained, the survivor keeps that. A merge is not
 *    consent, and the one direction this must never move is back towards
 *    "we may email them".
 *  - Money is summed, not taken from one side. Both rows really did buy things.
 */
adminContactsRouter.post(
  "/merge",
  asyncHandler(async (req, res) => {
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { keepId, mergeId } = parsed.data;
    if (keepId === mergeId) throw badRequest("Those are the same person");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Locked in a fixed order so two merges touching the same pair cannot
      // deadlock against each other.
      const rows = await client.query<{ id: number; email: string; email_marketing_status: string }>(
        `SELECT id, email::text AS email, email_marketing_status
           FROM contacts WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
        [[keepId, mergeId]]
      );
      if (rows.rows.length !== 2) throw notFound("Contact not found");

      const merge = rows.rows.find((row) => row.id === mergeId);
      if (!merge) throw notFound("Contact not found");

      // Fixed literals, not input: a table name cannot be a bind parameter, so
      // the only safe version of this loop is one whose contents are written here.
      for (const table of MERGEABLE_TABLES) {
        await client.query(`UPDATE ${table} SET contact_id = $1 WHERE contact_id = $2`, [
          keepId,
          mergeId,
        ]);
      }

      await client.query(`UPDATE contact_activity SET contact_id = $1 WHERE contact_id = $2`, [
        keepId,
        mergeId,
      ]);

      await client.query(
        `INSERT INTO contact_tags (contact_id, tag_id, applied_by, created_at)
         SELECT $1, tag_id, applied_by, created_at FROM contact_tags WHERE contact_id = $2
         ON CONFLICT (contact_id, tag_id) DO NOTHING`,
        [keepId, mergeId]
      );

      // A live sequence run is keyed (sequence, contact) and cannot simply move
      // onto a survivor already in that sequence; the survivor's own position is
      // the one to keep, and the duplicate's row goes with the duplicate.
      await client.query(
        `UPDATE sequence_subscriptions ss
            SET contact_id = $1
          WHERE ss.contact_id = $2
            AND NOT EXISTS (SELECT 1 FROM sequence_subscriptions other
                             WHERE other.contact_id = $1 AND other.sequence_id = ss.sequence_id)`,
        [keepId, mergeId]
      );

      // An unsubscribe on either row wins on every shared topic, for the same
      // reason the marketing status does.
      await client.query(
        `UPDATE contact_email_preferences keep
            SET subscribed = keep.subscribed AND dup.subscribed, updated_at = now()
           FROM contact_email_preferences dup
          WHERE keep.contact_id = $1 AND dup.contact_id = $2 AND keep.topic = dup.topic`,
        [keepId, mergeId]
      );
      await client.query(
        `UPDATE contact_email_preferences pref
            SET contact_id = $1
          WHERE pref.contact_id = $2
            AND NOT EXISTS (SELECT 1 FROM contact_email_preferences other
                             WHERE other.contact_id = $1 AND other.topic = pref.topic)`,
        [keepId, mergeId]
      );

      await client.query(
        `UPDATE contacts keep
            SET name       = COALESCE(NULLIF(keep.name, ''), dup.name),
                first_name = COALESCE(NULLIF(keep.first_name, ''), dup.first_name),
                last_name  = COALESCE(NULLIF(keep.last_name, ''), dup.last_name),
                phone      = COALESCE(NULLIF(keep.phone, ''), dup.phone),
                custom_fields = dup.custom_fields || keep.custom_fields,
                notes = TRIM(BOTH E'\n' FROM keep.notes || E'\n' || dup.notes),
                lifetime_value_cents = keep.lifetime_value_cents + dup.lifetime_value_cents,
                order_count = keep.order_count + dup.order_count,
                last_activity_at = GREATEST(keep.last_activity_at, dup.last_activity_at),
                last_ordered_at  = GREATEST(keep.last_ordered_at, dup.last_ordered_at),
                created_at = LEAST(keep.created_at, dup.created_at),
                email_marketing_status = CASE
                  WHEN 'complained' IN (keep.email_marketing_status, dup.email_marketing_status) THEN 'complained'
                  WHEN 'bounced'    IN (keep.email_marketing_status, dup.email_marketing_status) THEN 'bounced'
                  WHEN 'opted_out'  IN (keep.email_marketing_status, dup.email_marketing_status) THEN 'opted_out'
                  WHEN 'unconfirmed' IN (keep.email_marketing_status, dup.email_marketing_status) THEN 'unconfirmed'
                  ELSE keep.email_marketing_status
                END,
                opted_out_at = COALESCE(keep.opted_out_at, dup.opted_out_at),
                opted_in_at  = LEAST(keep.opted_in_at, dup.opted_in_at),
                updated_at = now()
           FROM contacts dup
          WHERE keep.id = $1 AND dup.id = $2`,
        [keepId, mergeId]
      );

      await client.query(`DELETE FROM contacts WHERE id = $1`, [mergeId]);

      await client.query(
        `INSERT INTO contact_activity (contact_id, kind, title, body)
         VALUES ($1, 'merged', 'Two records combined', $2)`,
        [keepId, `${merge.email} was merged into this person.`]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    await recordAdminAction({
      req,
      action: "contact.merge",
      entityType: "contact",
      entityId: keepId,
      before: { mergedId: mergeId },
    });

    const merged = await loadContact(keepId);
    res.json(rowToCamel(merged));
  })
);

const createSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(4000).optional(),
  source: z.string().trim().max(80).optional(),
  tagSlugs: z.array(z.string().max(80)).max(20).default([]),
});

adminContactsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { email, phone = "", notes = "", source } = parsed.data;
    const first = parsed.data.firstName ?? "";
    const last = parsed.data.lastName ?? "";
    const name = parsed.data.name ?? `${first} ${last}`.trim();

    const result = await pool.query<{ id: number; inserted: boolean }>(
      `INSERT INTO contacts AS c (email, name, first_name, last_name, phone, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE(NULLIF($7, ''), 'added by hand'))
       ON CONFLICT (email) DO UPDATE
          SET name       = COALESCE(NULLIF(EXCLUDED.name, ''), c.name),
              first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), c.first_name),
              last_name  = COALESCE(NULLIF(EXCLUDED.last_name, ''), c.last_name),
              phone      = COALESCE(NULLIF(EXCLUDED.phone, ''), c.phone),
              updated_at = now()
       RETURNING c.id, (xmax = 0) AS inserted`,
      [email.toLowerCase(), name, first, last, phone, notes, source ?? ""]
    );

    const contact = result.rows[0];
    const slugs = normaliseSlugs(parsed.data.tagSlugs);
    if (slugs.length) await applyTags(contact.id, slugs, req.user?.email ?? "admin");
    if (contact.inserted) {
      await recordActivity({ contactId: contact.id, kind: "created", title: "Added by hand" });
      await publishDomainEvent("contact_created", {
        eventKey: `contact-created:${contact.id}`,
        contactId: contact.id,
        email: email.toLowerCase(),
        name,
        source: source || "added by hand",
      });
    }

    await recordAdminAction({
      req,
      action: "contact.create",
      entityType: "contact",
      entityId: contact.id,
      after: { email, created: contact.inserted },
    });

    res.status(contact.inserted ? 201 : 200).json(rowToCamel(await loadContact(contact.id)));
  })
);

async function loadContact(id: number): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `SELECT ${CONTACT_COLUMNS}, ${CONTACT_TAGS} FROM contacts c WHERE c.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw notFound("Contact not found");
  return row;
}

/** Untruncated, server-side portability export for one CRM person. */
adminContactsRouter.get(
  "/:id/export",
  requireManage,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const contact = rowToCamel(await loadContact(id));
    const contactEmail = String((contact as Record<string, unknown>).email ?? "");
    const memberLink = await pool.query<{ id: number }>(
      `SELECT id FROM members WHERE contact_id = $1 ORDER BY id LIMIT 1`,
      [id],
    );
    const memberId = memberLink.rows[0]?.id ?? null;

    const [activity, orders, leads, forms, sequences, assessments, events, messages, subscriber, coaching] =
      await Promise.all([
        pool.query(`SELECT * FROM contact_activity WHERE contact_id = $1 ORDER BY occurred_at, id`, [id]),
        pool.query(`SELECT * FROM orders WHERE contact_id = $1 ORDER BY created_at, id`, [id]),
        pool.query(`SELECT * FROM leads WHERE contact_id = $1 ORDER BY created_at, id`, [id]),
        pool.query(`SELECT * FROM form_submissions WHERE contact_id = $1 ORDER BY created_at, id`, [id]),
        pool.query(`SELECT * FROM sequence_subscriptions WHERE contact_id = $1 ORDER BY entered_at, id`, [id]),
        pool.query(`SELECT * FROM assessment_attempts WHERE contact_id = $1 ORDER BY started_at, id`, [id]),
        pool.query(`SELECT * FROM event_registrations WHERE contact_id = $1 ORDER BY created_at, id`, [id]),
        pool.query(`SELECT * FROM email_messages WHERE contact_id = $1 ORDER BY created_at, id`, [id]),
        pool.query(`SELECT * FROM subscribers WHERE email::citext = $1::citext`, [contactEmail]),
        pool.query(`SELECT * FROM coaching_sessions WHERE contact_id = $1 ORDER BY created_at, id`, [id]),
      ]);

    let member: Record<string, unknown> | null = null;
    if (memberId !== null) {
      const [profile, sessions, enrollments, lessonProgress, courseProgress, memberships,
        posts, comments, reactions, grants, subscriptions, invoices, certificates] =
        await Promise.all([
          pool.query(
            `SELECT id, email::text AS email, name, first_name, last_name, avatar_url,
                    timezone, locale, status, email_verified_at, last_login_at, created_at, updated_at
               FROM members WHERE id = $1`,
            [memberId],
          ),
          pool.query(
            `SELECT id, user_agent, ip, created_at, last_used_at, expires_at, revoked_at
               FROM member_sessions WHERE member_id = $1 ORDER BY created_at, id`,
            [memberId],
          ),
          pool.query(`SELECT * FROM enrollments WHERE member_id = $1 ORDER BY created_at, id`, [memberId]),
          pool.query(`SELECT * FROM lesson_progress WHERE member_id = $1 ORDER BY first_viewed_at, id`, [memberId]),
          pool.query(`SELECT * FROM course_progress WHERE member_id = $1 ORDER BY started_at, id`, [memberId]),
          pool.query(`SELECT * FROM community_memberships WHERE member_id = $1 ORDER BY joined_at, id`, [memberId]),
          pool.query(`SELECT * FROM community_posts WHERE member_id = $1 ORDER BY created_at, id`, [memberId]),
          pool.query(`SELECT * FROM community_comments WHERE member_id = $1 ORDER BY created_at, id`, [memberId]),
          pool.query(`SELECT * FROM community_reactions WHERE member_id = $1 ORDER BY created_at, id`, [memberId]),
          pool.query(`SELECT * FROM access_grants WHERE member_id = $1 ORDER BY created_at, id`, [memberId]),
          pool.query(`SELECT * FROM subscriptions WHERE member_id = $1 ORDER BY created_at, id`, [memberId]),
          pool.query(
            `SELECT i.* FROM invoices i
              JOIN subscriptions s ON s.id = i.subscription_id
             WHERE s.member_id = $1 ORDER BY i.created_at, i.id`,
            [memberId],
          ),
          pool.query(`SELECT * FROM certificates WHERE member_id = $1 ORDER BY issued_at, id`, [memberId]),
        ]);
      member = {
        profile: rowToCamel(profile.rows[0] ?? {}),
        sessions: rowsToCamel(sessions.rows),
        enrollments: rowsToCamel(enrollments.rows),
        lessonProgress: rowsToCamel(lessonProgress.rows),
        courseProgress: rowsToCamel(courseProgress.rows),
        communityMemberships: rowsToCamel(memberships.rows),
        communityPosts: rowsToCamel(posts.rows),
        communityComments: rowsToCamel(comments.rows),
        communityReactions: rowsToCamel(reactions.rows),
        accessGrants: rowsToCamel(grants.rows),
        subscriptions: rowsToCamel(subscriptions.rows),
        invoices: rowsToCamel(invoices.rows),
        certificates: rowsToCamel(certificates.rows),
      };
    }

    await recordAdminAction({
      req,
      action: "contact.export",
      entityType: "contact",
      entityId: id,
    });

    res.json({
      exportedAt: new Date().toISOString(),
      contact,
      activity: rowsToCamel(activity.rows),
      orders: rowsToCamel(orders.rows),
      leads: rowsToCamel(leads.rows),
      formSubmissions: rowsToCamel(forms.rows),
      sequenceSubscriptions: rowsToCamel(sequences.rows),
      assessmentAttempts: rowsToCamel(assessments.rows),
      eventRegistrations: rowsToCamel(events.rows),
      emailMessages: rowsToCamel(messages.rows),
      subscriber: rowToCamel(subscriber.rows[0] ?? {}),
      coachingSessions: rowsToCamel(coaching.rows),
      member,
    });
  }),
);

/**
 * GET /:id — the person, and everything they have ever done.
 *
 * The timeline is the point of the screen. It is read from `contact_activity`
 * alone rather than assembled by joining five tables at request time, which is
 * what lets an entry survive the deletion of whatever it described.
 */
adminContactsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const contact = await loadContact(id);

    const [activity, orders, links] = await Promise.all([
      pool.query(
        `SELECT id, kind, title, body, subject_type, subject_id, meta, occurred_at
           FROM contact_activity
          WHERE contact_id = $1
          ORDER BY occurred_at DESC, id DESC
          LIMIT 200`,
        [id]
      ),
      pool.query(
        `SELECT o.id, o.status, o.currency, o.created_at,
                GREATEST(o.total_cents, o.amount_cents) AS total_cents, o.refunded_cents,
                COALESCE(NULLIF(off.title, ''), o.course_title, '') AS title
           FROM orders o
           LEFT JOIN offers off ON off.id = o.offer_id
          WHERE o.contact_id = $1
          ORDER BY o.created_at DESC
          LIMIT 100`,
        [id]
      ),
      pool.query<{ member_id: number | null; lead_count: number; subscribed: boolean }>(
        `SELECT (SELECT m.id FROM members m WHERE m.contact_id = $1 ORDER BY m.id LIMIT 1) AS member_id,
                (SELECT COUNT(*)::int FROM leads l WHERE l.contact_id = $1) AS lead_count,
                -- "Is this person on the email list?" is the same question the
                -- Subscribers screen, the analytics tile and the campaign
                -- estimator ask, so it gets the same answer. It used to test
                -- for a row in the legacy subscribers table, which is written
                -- only by the public newsletter box — so a contact who had
                -- consented at checkout showed as not subscribed.
                EXISTS (
                  SELECT 1 FROM contacts c WHERE c.id = $1 AND ${MAILABLE_CONTACT_SQL}
                ) AS subscribed`,
        [id]
      ),
    ]);

    res.json({
      ...rowToCamel(contact),
      activity: rowsToCamel(activity.rows),
      orders: rowsToCamel(orders.rows),
      ...rowToCamel(links.rows[0] ?? {}),
    });
  })
);

const updateSchema = z.object({
  name: z.string().trim().max(200).optional(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  timezone: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(4000).optional(),
  emailMarketingStatus: z.enum(EMAIL_STATUSES).optional(),
});

adminContactsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
    const { name, firstName, lastName, phone, timezone, notes, emailMarketingStatus } = parsed.data;

    const before = await loadContact(id);

    const result = await pool.query(
      `UPDATE contacts AS c
          SET name       = COALESCE($2::text, c.name),
              first_name = COALESCE($3::text, c.first_name),
              last_name  = COALESCE($4::text, c.last_name),
              phone      = COALESCE($5::text, c.phone),
              timezone   = COALESCE(NULLIF($6::text, ''), c.timezone),
              notes      = COALESCE($7::text, c.notes),
              email_marketing_status = COALESCE($8::text, c.email_marketing_status),
              -- Stamped whenever the answer changes, because "when did they opt
              -- out" is the question a complaint is answered with.
              opted_out_at = CASE
                WHEN $8::text IS NOT NULL AND $8::text <> 'subscribed'
                     AND c.email_marketing_status = 'subscribed' THEN now()
                ELSE c.opted_out_at END,
              opted_in_at = CASE
                WHEN $8::text = 'subscribed' AND c.email_marketing_status <> 'subscribed'
                  THEN now()
                ELSE c.opted_in_at END,
              updated_at = now()
        WHERE c.id = $1
        RETURNING c.id`,
      [id, name ?? null, firstName ?? null, lastName ?? null, phone ?? null, timezone ?? null, notes ?? null, emailMarketingStatus ?? null]
    );
    if (result.rowCount === 0) throw notFound("Contact not found");

    if (emailMarketingStatus && emailMarketingStatus !== before.email_marketing_status) {
      await recordActivity({
        contactId: id,
        kind: "email_preference",
        title:
          emailMarketingStatus === "subscribed"
            ? "Started receiving emails"
            : "Stopped receiving emails",
      });
    }

    await recordAdminAction({
      req,
      action: "contact.update",
      entityType: "contact",
      entityId: id,
      before: { emailMarketingStatus: before.email_marketing_status },
      after: { emailMarketingStatus: emailMarketingStatus ?? before.email_marketing_status },
    });

    const updated = rowToCamel(await loadContact(id));
    await dispatchEvent("contact.updated", {
      id: `contact-update:${id}:${Date.now()}`,
      contact: updated,
      changedBy: req.user?.email ?? "admin",
    });
    res.json(updated);
  })
);

/**
 * DELETE /:id
 *
 * The contact row goes; the silo rows behind it do not. `orders` and `members`
 * are the financial record behind money that actually moved, and their
 * `contact_id` is `ON DELETE SET NULL` precisely so an audience clean-up cannot
 * quietly take a year of payments with it.
 */
adminContactsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await loadContact(id);
    // Webhook payloads are denormalised JSON and therefore cannot follow the
    // contact FK cascade. Remove those copies before erasing the person.
    await pool.query(
      `DELETE FROM webhook_deliveries
        WHERE payload->>'contactId' = $1
           OR payload->'contact'->>'id' = $1`,
      [String(id)],
    );
    const result = await pool.query(`DELETE FROM contacts WHERE id = $1`, [id]);
    if (result.rowCount === 0) throw notFound("Contact not found");

    await recordAdminAction({
      req,
      action: "contact.delete",
      entityType: "contact",
      entityId: id,
    });

    res.status(204).end();
  })
);

const tagsSchema = z.object({
  tagSlugs: z.array(z.string().max(80)).min(1).max(20),
});

adminContactsRouter.post(
  "/:id/tags",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = tagsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    await loadContact(id);
    const slugs = normaliseSlugs(parsed.data.tagSlugs);
    if (slugs.length === 0) throw badRequest("Choose at least one tag");

    const added = await applyTags(id, slugs, req.user?.email ?? "admin");

    await recordAdminAction({
      req,
      action: "contact.tag",
      entityType: "contact",
      entityId: id,
      after: { tags: slugs, added },
    });

    res.json(rowToCamel(await loadContact(id)));
  })
);

adminContactsRouter.delete(
  "/:id/tags/:slug",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const removed = await removeTags(id, [req.params.slug]);
    if (removed === 0) throw notFound("Tag not found on this contact");

    await recordAdminAction({
      req,
      action: "contact.untag",
      entityType: "contact",
      entityId: id,
      before: { tag: req.params.slug },
    });

    res.json(rowToCamel(await loadContact(id)));
  })
);

const noteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

/** A note the owner types after a call. It lands on the timeline with everything else. */
adminContactsRouter.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Write something first", parsed.error.flatten());

    await loadContact(id);
    await recordActivity({
      contactId: id,
      kind: "note",
      title: "Note",
      body: parsed.data.body,
      meta: { author: req.user?.email ?? "" },
    });

    res.status(201).json({ ok: true });
  })
);
