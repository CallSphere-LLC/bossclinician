import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, unauthorized } from "../../utils/httpError";
import { denyImpersonation, type AuthedMember } from "../../middleware/memberAuth";

/**
 * `/api/member/notifications` — the member area's inbox.
 *
 * The same `member_notifications` rows the community bell has always read
 * (`/api/member/community/notifications` still answers), served from a path
 * that does not imply a community: a purchase notice belongs to the whole
 * member area. `kind` narrows the list, which is how the library's "new
 * purchase" banner asks for unread purchase notices only.
 */
export const memberNotificationsRouter = Router();

const MAX_INT4 = 2_147_483_647;
const TOO_MANY = { error: "Too many requests. Please try again later." };

const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

const listSchema = z.object({
  perPage: z.coerce.number().int().min(1).max(50).default(12),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  unread: z.enum(["true", "1", "false", "0"]).optional(),
  kind: z
    .string()
    .trim()
    .regex(/^[a-z_]{1,64}$/)
    .optional(),
});

memberNotificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid request", parsed.error.flatten());
    const { perPage, page, kind } = parsed.data;
    const unreadOnly = parsed.data.unread === "true" || parsed.data.unread === "1";
    const offset = (page - 1) * perPage;

    const found = await pool.query<{
      id: number;
      kind: string;
      title: string;
      body: string;
      link: string;
      actor_id: number | null;
      actor_name: string;
      actor_avatar_url: string;
      read_at: Date | null;
      created_at: Date;
      total_count: string;
    }>(
      `SELECT n.id, n.kind, n.title, n.body, n.link, n.actor_id, n.read_at, n.created_at,
              COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), NULLIF(m.name, ''), '')
                AS actor_name,
              COALESCE(m.avatar_url, '') AS actor_avatar_url,
              COUNT(*) OVER () AS total_count
         FROM member_notifications n
         LEFT JOIN members m ON m.id = n.actor_id
        WHERE n.member_id = $1
          AND ($2::bool = false OR n.read_at IS NULL)
          AND ($3::text IS NULL OR n.kind = $3)
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $4 OFFSET $5`,
      [member.id, unreadOnly, kind ?? null, perPage, offset]
    );

    const unread = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM member_notifications
        WHERE member_id = $1 AND read_at IS NULL`,
      [member.id]
    );

    const total = found.rows[0] ? Number(found.rows[0].total_count) || 0 : 0;
    res.json({
      notifications: found.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        link: row.link,
        actor:
          row.actor_id === null ? null : { name: row.actor_name, avatarUrl: row.actor_avatar_url },
        read: row.read_at !== null,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      })),
      unreadCount: unread.rows[0]?.n ?? 0,
      page,
      perPage,
      total,
      hasMore: offset + found.rows.length < total,
    });
  })
);

const readSchema = z
  .object({
    ids: z.array(z.coerce.number().int().positive().max(MAX_INT4)).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || (v.ids?.length ?? 0) > 0, "Nothing to mark as read.");

/**
 * POST /api/member/notifications/read — `{ ids }` or `{ all: true }`.
 *
 * Scoped to the member in the WHERE clause, so somebody else's id matches
 * nothing rather than being reported as forbidden.
 */
memberNotificationsRouter.post(
  "/read",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = readSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid request", parsed.error.flatten());

    const marked = await pool.query(
      `UPDATE member_notifications
          SET read_at = now()
        WHERE member_id = $1 AND read_at IS NULL
          AND ($2::bool = true OR id = ANY($3::int[]))`,
      [member.id, parsed.data.all === true, parsed.data.ids ?? []]
    );
    const unread = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM member_notifications
        WHERE member_id = $1 AND read_at IS NULL`,
      [member.id]
    );
    res.json({ marked: marked.rowCount ?? 0, unreadCount: unread.rows[0]?.n ?? 0 });
  })
);
