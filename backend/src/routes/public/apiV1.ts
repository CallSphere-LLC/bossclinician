import { NextFunction, Request, Response, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, unauthorized } from "../../utils/httpError";
import { hashToken } from "../../auth/tokens";
import { publishDomainEvent } from "../../services/domainEvents";
import { dispatchEvent } from "../../services/webhooksOut";

/**
 * The public REST surface — the one an integrator or a Zap talks to.
 *
 * Small on purpose. Four endpoints cover what every no-code integration
 * actually asks for (read my people, add a person, read my sales, read what I
 * sell) and each one is a plain list with a cursor. A wider surface is a wider
 * thing to keep compatible forever, and this one is versioned in its path
 * precisely so it can stay still while the admin API changes underneath it.
 *
 * Authentication is `Authorization: Bearer bck_<prefix>_<secret>`. Only the
 * SHA-256 of the whole key is stored, so a database dump yields nothing that
 * can be presented back; the prefix is kept in clear only so a key can be
 * recognised in a list.
 */
export const apiV1Router = Router();

export const API_SCOPES = [
  "contacts.read",
  "contacts.write",
  "orders.read",
  "offers.read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface AuthenticatedApiKey {
  id: number;
  name: string;
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: AuthenticatedApiKey;
    }
  }
}

const KEY_PATTERN = /^bck_([0-9a-f]{8})_([A-Za-z0-9_-]{16,})$/;

export function formatApiKey(prefix: string, secret: string): string {
  return `bck_${prefix}_${secret}`;
}

/** The identifiable half of a key. Returns "" for anything malformed. */
export function keyPrefix(key: string): string {
  return KEY_PATTERN.exec(key)?.[1] ?? "";
}

/**
 * How often `last_used_at` is worth a write.
 *
 * A sync that polls every ten seconds would otherwise turn a read-only endpoint
 * into a row update per request, on a row every one of its requests also reads.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/* --------------------------------------------------------- authentication */

const apiKeyAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    throw unauthorized("Send your API key as: Authorization: Bearer <key>");
  }

  const presented = header.slice("Bearer ".length).trim();
  if (!KEY_PATTERN.test(presented)) throw unauthorized("That API key isn't valid.");

  // One indexed equality on the unique hash — never a scan, and never a
  // comparison against anything reversible.
  const found = await pool.query<{
    id: number;
    name: string;
    scopes: string[];
    revoked_at: Date | null;
    last_used_at: Date | null;
  }>(
    `SELECT id, name, scopes, revoked_at, last_used_at FROM api_keys WHERE key_hash = $1`,
    [hashToken(presented)]
  );

  const key = found.rows[0];
  if (!key || key.revoked_at !== null) throw unauthorized("That API key isn't valid.");

  const stale =
    key.last_used_at === null || Date.now() - key.last_used_at.getTime() > TOUCH_INTERVAL_MS;
  if (stale) {
    // Fire and forget: a failed bookkeeping write must not fail the request it
    // was only recording.
    void pool
      .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.id])
      .catch(() => undefined);
  }

  req.apiKey = { id: key.id, name: key.name, scopes: key.scopes ?? [] };
  next();
});

function requireScope(scope: ApiScope) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiKey?.scopes.includes(scope)) {
      next(forbidden(`This key doesn't have the "${scope}" permission.`));
      return;
    }
    next();
  };
}

/**
 * Per key, not per IP.
 *
 * Every caller here is a server: Zapier's outbound addresses are shared by
 * thousands of accounts, so an IP-keyed limit would have one customer's
 * integration throttle another's. The key is the tenant.
 */
const apiKeyLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Slow down and try again shortly." },
  keyGenerator: (req: Request): string => `apikey:${req.apiKey?.id ?? 0}`,
});

/**
 * A per-IP ceiling *before* authentication.
 *
 * The per-key limiter cannot see a request that never presented a valid key, so
 * on its own it leaves key guessing completely unthrottled — the one thing a
 * bearer-token endpoint most needs a limit on. This is deliberately loose
 * enough that a legitimate integration behind a shared address never notices.
 */
const unauthenticatedLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Slow down and try again shortly." },
});

apiV1Router.use(unauthenticatedLimiter, apiKeyAuth, apiKeyLimiter);

/* ---------------------------------------------------------------- paging */

const pageSchema = z.object({
  /** The last id you saw. Page forward until `nextCursor` comes back null. */
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Keyset paging on the primary key, ascending.
 *
 * An offset would silently skip rows whenever something is inserted between two
 * pages, which for a sync that runs every fifteen minutes means contacts that
 * are simply never delivered.
 */
function page(req: Request): { cursor: number; limit: number } {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) throw badRequest("Check `cursor` and `limit`.", parsed.error.flatten());
  return parsed.data;
}

function withCursor<T extends { id: number }>(rows: T[], limit: number) {
  return {
    data: rows,
    nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
  };
}

/* -------------------------------------------------------------- contacts */

interface ContactOut {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  marketingStatus: string;
  lifetimeValueCents: number;
  orderCount: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CONTACT_SELECT = `
  SELECT c.id, c.email, c.first_name, c.last_name, c.name, c.phone,
         c.email_marketing_status, c.lifetime_value_cents, c.order_count,
         c.created_at, c.updated_at,
         COALESCE(
           (SELECT array_agg(t.name ORDER BY t.name)
              FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
             WHERE ct.contact_id = c.id),
           '{}'
         ) AS tags
    FROM contacts c`;

interface ContactRow {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  phone: string;
  email_marketing_status: string;
  lifetime_value_cents: number;
  order_count: number;
  created_at: Date;
  updated_at: Date;
  tags: string[];
}

function contactOut(row: ContactRow): ContactOut {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    name: row.name,
    phone: row.phone,
    marketingStatus: row.email_marketing_status,
    lifetimeValueCents: row.lifetime_value_cents,
    orderCount: row.order_count,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const contactFilterSchema = z.object({
  email: z.string().email().max(320).optional(),
  /** ISO date — everything changed since then, for an incremental sync. */
  updatedSince: z.coerce.date().optional(),
});

apiV1Router.get(
  "/contacts",
  requireScope("contacts.read"),
  asyncHandler(async (req, res) => {
    const { cursor, limit } = page(req);
    const filter = contactFilterSchema.safeParse(req.query);
    if (!filter.success) throw badRequest("Check your filters.", filter.error.flatten());

    const result = await pool.query<ContactRow>(
      `${CONTACT_SELECT}
        WHERE c.id > $1
          AND ($3::citext IS NULL OR c.email = $3)
          AND ($4::timestamptz IS NULL OR c.updated_at >= $4)
        ORDER BY c.id
        LIMIT $2`,
      [cursor, limit, filter.data.email ?? null, filter.data.updatedSince ?? null]
    );

    res.json(withCursor(result.rows.map(contactOut), limit));
  })
);

const createContactSchema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().max(200).default(""),
  lastName: z.string().max(200).default(""),
  phone: z.string().max(40).default(""),
  source: z.string().max(100).default("api"),
});

apiV1Router.post(
  "/contacts",
  requireScope("contacts.write"),
  asyncHandler(async (req, res) => {
    const parsed = createContactSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());

    const { email, firstName, lastName, phone, source } = parsed.data;
    const name = [firstName, lastName].filter(Boolean).join(" ").trim();

    // An upsert rather than a create: every integration that posts a contact
    // posts the same one again on the next run, and a 409 in that situation is
    // a support ticket rather than a signal. Blank fields never overwrite
    // something already known — a Zap that only knows an email must not wipe a
    // name somebody typed in by hand.
    const saved = await pool.query<{ id: number; inserted: boolean }>(
      `INSERT INTO contacts (email, first_name, last_name, name, phone, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE
         SET first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), contacts.first_name),
             last_name  = COALESCE(NULLIF(EXCLUDED.last_name,  ''), contacts.last_name),
             name       = COALESCE(NULLIF(EXCLUDED.name,       ''), contacts.name),
             phone      = COALESCE(NULLIF(EXCLUDED.phone,      ''), contacts.phone),
             updated_at = now()
       -- xmax is zero on a row this statement inserted and non-zero on one it
       -- updated: the only way to tell the two apart from a single upsert.
       RETURNING id, (xmax = 0) AS inserted`,
      [email, firstName, lastName, name, phone, source]
    );

    const upserted = saved.rows[0];
    if (!upserted) throw badRequest("We couldn't save that contact.");

    const reread = await pool.query<ContactRow>(`${CONTACT_SELECT} WHERE c.id = $1`, [
      upserted.id,
    ]);
    const row = reread.rows[0];
    if (!row) throw badRequest("We couldn't save that contact.");

    const contact = contactOut(row);
    if (upserted.inserted) {
      // Preserve the v1 webhook payload contract first. The later durable
      // domain-event dispatcher uses the same occurrence id, so its delivery
      // conflicts with this richer, backwards-compatible body even if the
      // worker is exceptionally fast.
      await dispatchEvent("contact.created", {
        id: `contact-created:${upserted.id}`,
        contact,
      });
      await publishDomainEvent("contact_created", {
        eventKey: `contact-created:${upserted.id}`,
        contactId: upserted.id,
        email,
        name,
        source,
        facts: { apiKeyId: req.apiKey?.id ?? 0 },
      });
    }

    res.status(upserted.inserted ? 201 : 200).json({ data: contact });
  })
);

/* ---------------------------------------------------------------- orders */

const orderFilterSchema = z.object({
  status: z.string().max(40).optional(),
  since: z.coerce.date().optional(),
});

apiV1Router.get(
  "/orders",
  requireScope("orders.read"),
  asyncHandler(async (req, res) => {
    const { cursor, limit } = page(req);
    const filter = orderFilterSchema.safeParse(req.query);
    if (!filter.success) throw badRequest("Check your filters.", filter.error.flatten());

    const result = await pool.query<{
      id: number;
      email: string;
      status: string;
      total_cents: number;
      currency: string;
      offer_id: number | null;
      offer_title: string | null;
      created_at: Date;
    }>(
      `SELECT o.id, o.email, o.status,
              -- Older rows predate the itemised totals and only carry the amount
              -- charged, so the two are coalesced rather than one being trusted.
              COALESCE(NULLIF(o.total_cents, 0), o.amount_cents) AS total_cents,
              o.currency, o.offer_id, f.title AS offer_title, o.created_at
         FROM orders o
         LEFT JOIN offers f ON f.id = o.offer_id
        WHERE o.id > $1
          AND ($3::text IS NULL OR o.status = $3)
          AND ($4::timestamptz IS NULL OR o.created_at >= $4)
        ORDER BY o.id
        LIMIT $2`,
      [cursor, limit, filter.data.status ?? null, filter.data.since ?? null]
    );

    res.json(
      withCursor(
        result.rows.map((row) => ({
          id: row.id,
          email: row.email,
          status: row.status,
          totalCents: row.total_cents,
          currency: row.currency,
          offerId: row.offer_id,
          offerTitle: row.offer_title ?? "",
          createdAt: row.created_at,
        })),
        limit
      )
    );
  })
);

/* ---------------------------------------------------------------- offers */

apiV1Router.get(
  "/offers",
  requireScope("offers.read"),
  asyncHandler(async (req, res) => {
    const { cursor, limit } = page(req);

    const result = await pool.query<{
      id: number;
      title: string;
      slug: string;
      status: string;
      pricing_type: string;
      amount_cents: number;
      currency: string;
    }>(
      `SELECT id, title, slug, status, pricing_type, amount_cents, currency
         FROM offers
        WHERE id > $1 AND status = 'published'
        ORDER BY id
        LIMIT $2`,
      [cursor, limit]
    );

    res.json(
      withCursor(
        result.rows.map((row) => ({
          id: row.id,
          title: row.title,
          slug: row.slug,
          status: row.status,
          pricingType: row.pricing_type,
          amountCents: row.amount_cents,
          currency: row.currency,
        })),
        limit
      )
    );
  })
);
