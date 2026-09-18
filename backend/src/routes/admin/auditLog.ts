import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { rowsToCamel } from "../../utils/case";

/**
 * The audit trail, readable. Mounted at /admin/audit-log.
 *
 * `admin_audit_log` has been written to since Phase 1 — every grant, refund,
 * export and "view as member" leaves a row — and until now the only way to read
 * it was a database console. A record nobody can look at answers no questions:
 * "who changed that price?" and "did anyone open her account?" are exactly the
 * questions it was built for.
 *
 * Read-only on purpose. There is no route here that edits or removes a row, and
 * there must never be one: a log its subjects can tidy is not a log.
 *
 * The mount gates this on `admins.view`, which only the owner and a manager
 * hold — the same two roles that may administer other people's accounts. The
 * rows carry before/after snapshots of customer records, so a Marketing or
 * Support login has no business reading them.
 */
export const adminAuditLogRouter = Router();

export const auditLogQuerySchema = z.object({
  /** Part of the admin's email address, however it was typed. */
  actor: z.string().trim().max(320).optional(),
  /** A prefix: "offer." finds offer.grant, offer.revoke and the rest. */
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  entityId: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AuditLogFilters = Omit<z.infer<typeof auditLogQuerySchema>, "page" | "limit">;

/**
 * `%` and `_` typed into a search box are characters to find, not wildcards —
 * unescaped, an action filter of "_" would match every row in the table.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The WHERE clause and its parameters. Exported so the shape can be tested without a database. */
export function buildAuditFilters(filters: AuditLogFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const next = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.actor) clauses.push(`a.admin_email ILIKE ${next(`%${escapeLike(filters.actor)}%`)}`);
  if (filters.action) clauses.push(`a.action LIKE ${next(`${escapeLike(filters.action)}%`)}`);
  if (filters.entityType) clauses.push(`a.entity_type = ${next(filters.entityType)}`);
  if (filters.entityId) clauses.push(`a.entity_id = ${next(filters.entityId)}`);
  if (filters.from) clauses.push(`a.created_at >= ${next(filters.from)}`);
  if (filters.to) clauses.push(`a.created_at <= ${next(filters.to)}`);

  return { where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

/**
 * GET /admin/audit-log — newest first, a page at a time.
 *
 * `before_state` and `after_state` are JSONB and go out as they were stored:
 * their keys are whatever the recording route captured, so they are
 * deliberately not run through the camel-casing the columns get.
 */
adminAuditLogRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = auditLogQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid query", parsed.error.flatten());
    const { page, limit, ...filters } = parsed.data;
    if (filters.from && filters.to && filters.from > filters.to) {
      throw badRequest("The start date needs to be before the end date.");
    }

    const { where, params } = buildAuditFilters(filters);

    const [items, total] = await Promise.all([
      pool.query(
        `SELECT a.id::text AS id, a.admin_user_id, a.admin_email, a.action, a.entity_type,
                a.entity_id, a.before_state, a.after_state, a.ip, a.created_at,
                u.name AS admin_name
           FROM admin_audit_log a
           LEFT JOIN admin_users u ON u.id = a.admin_user_id
           ${where}
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM admin_audit_log a ${where}`,
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
 * GET /admin/audit-log/facets — what the filters can be narrowed to.
 *
 * Read from the log itself rather than from a hard-coded list, so a new kind of
 * record shows up in the filter the first time something is done to one.
 */
adminAuditLogRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    const [entityTypes, actors] = await Promise.all([
      pool.query<{ entity_type: string }>(
        `SELECT DISTINCT entity_type FROM admin_audit_log WHERE entity_type <> '' ORDER BY entity_type`
      ),
      pool.query<{ admin_email: string }>(
        `SELECT DISTINCT admin_email FROM admin_audit_log WHERE admin_email <> '' ORDER BY admin_email`
      ),
    ]);
    res.json({
      entityTypes: entityTypes.rows.map((row) => row.entity_type),
      actors: actors.rows.map((row) => row.admin_email),
    });
  })
);
