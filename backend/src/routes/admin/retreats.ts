import crypto from "crypto";
import fs from "fs/promises";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { partsDir } from "../../services/mediaStorage";
import { removeStoredMedia } from "../../services/objectStorage";
import {
  MEDIA_SELECT,
  REVIEWABLE_TASKS,
  RETREAT_COLUMNS,
  agreementView,
  buildDashboard,
  feedbackView,
  findRetreatById,
  findRetreatBySlug,
  formView,
  loadAgreementAssignments,
  loadFeedbackRow,
  loadFormRecords,
  loadInterest,
  loadPayments,
  loadTaskRecords,
  mediaUrl,
  memberIdentity,
  mergeSettings,
  normaliseSettings,
  safeLink,
  settingsPatchSchema,
  signMediaToken,
  type MediaRow,
  type RetreatRow,
  type TaskKey,
} from "../../services/retreats";
import { storeStagedMemory } from "../member/retreats";

/**
 * `/api/admin/retreats/*` — the FlourisHealer organizer view.
 *
 * Owner and Admin roles only, enforced here on every route (the mount adds
 * requireAuth). This router holds guests' travel, insurance, payment and
 * feedback records, so it is deliberately NOT behind the products gate that
 * Support and Marketing accounts can pass, and no guest session can reach it.
 * Reads of an individual guest's record are written to the admin audit log.
 */
export const adminRetreatsRouter = Router();

const ORGANIZER_ROLES = new Set(["owner", "admin"]);

export function requireRetreatOrganizer(req: Request, _res: Response, next: NextFunction): void {
  if (!ORGANIZER_ROLES.has(req.user?.role ?? "")) {
    next(forbidden("Only the owner and administrators can open the retreat organizer."));
    return;
  }
  next();
}

adminRetreatsRouter.use(requireRetreatOrganizer);

function adminId(req: Request): number {
  return Number(req.user?.sub);
}

async function retreatOf(req: Request): Promise<RetreatRow> {
  const retreat = await findRetreatById(Number(req.params.id));
  if (!retreat) throw notFound("We couldn't find that retreat.");
  return retreat;
}

/** A row id from the URL; anything that cannot be one is a 404, never a failed query. */
function rowId(raw: unknown, missing: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw notFound(missing);
  return id;
}

function memberIdParam(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw notFound("We couldn't find that guest.");
  return id;
}

/** Members holding the dashboard product, plus booking-product holders not yet given it. */
async function retreatPeople(retreat: RetreatRow) {
  const result = await pool.query<{ member_id: number; dashboard: boolean; booking: boolean }>(
    `SELECT g.member_id,
            bool_or(g.product_id = $1) AS dashboard,
            bool_or(g.product_id = $2) AS booking
       FROM access_grants g
      WHERE g.product_id IN ($1, $2) AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
      GROUP BY g.member_id`,
    [retreat.product_id ?? -1, retreat.booking_product_id ?? -1],
  );
  return result.rows;
}

/** A member is part of this retreat (for the organizer) if she holds either product. */
async function assertRetreatPerson(retreat: RetreatRow, memberId: number): Promise<{ dashboard: boolean }> {
  const people = await retreatPeople(retreat);
  const person = people.find((p) => p.member_id === memberId);
  if (!person) throw notFound("We couldn't find that guest on this retreat.");
  return { dashboard: person.dashboard };
}

async function detailJson(retreat: RetreatRow) {
  const [offers, contracts, product, course, counts] = await Promise.all([
    pool.query(`SELECT o.id, o.title, o.slug, o.status FROM retreat_offers ro JOIN offers o ON o.id = ro.offer_id WHERE ro.retreat_id = $1 ORDER BY o.id`, [retreat.id]),
    pool.query<{ id: string; title: string }>(
      `SELECT c.id, c.title FROM retreat_contracts rc JOIN participant_contracts c ON c.id = rc.contract_id WHERE rc.retreat_id = $1 ORDER BY c.id`,
      [retreat.id],
    ),
    pool.query<{ slug: string; status: string }>(`SELECT slug, status FROM products WHERE id = $1`, [retreat.product_id ?? -1]),
    pool.query<{ slug: string }>(`SELECT slug FROM courses WHERE id = $1`, [retreat.course_id ?? -1]),
    retreatPeople(retreat),
  ]);
  return {
    ...summaryJson(retreat, counts),
    timezone: retreat.timezone,
    bookingProductId: retreat.booking_product_id,
    settings: normaliseSettings(retreat.settings),
    offers: offers.rows,
    contracts: contracts.rows.map((row) => ({ id: Number(row.id), title: row.title })),
    courseSlug: course.rows[0]?.slug ?? null,
    productSlug: product.rows[0]?.slug ?? null,
    productStatus: product.rows[0]?.status ?? null,
  };
}

function summaryJson(retreat: RetreatRow, people: { dashboard: boolean; booking: boolean }[]) {
  return {
    id: retreat.id,
    slug: retreat.slug,
    title: retreat.title,
    location: retreat.location,
    startDate: retreat.start_date,
    endDate: retreat.end_date,
    published: retreat.published,
    productId: retreat.product_id,
    courseId: retreat.course_id,
    guestCount: people.filter((p) => p.dashboard).length,
    bookingHolderCount: people.filter((p) => p.booking && !p.dashboard).length,
  };
}

/* ─────────────────────────────── retreats ────────────────────────────── */

adminRetreatsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await pool.query<RetreatRow>(`SELECT ${RETREAT_COLUMNS} FROM retreats ORDER BY start_date DESC, id DESC`);
    const retreats = [];
    for (const retreat of rows.rows) retreats.push(summaryJson(retreat, await retreatPeople(retreat)));
    res.json({ retreats });
  }),
);

/** Course preview data (the lesson tool in "Preview as student"). Declared before /:id. */
adminRetreatsRouter.get(
  "/by-slug/:slug/preview",
  asyncHandler(async (req, res) => {
    const retreat = await findRetreatBySlug(String(req.params.slug));
    if (!retreat) throw notFound("We couldn't find that retreat.");
    res.json(await buildDashboard(retreat, null, { preview: true }));
  }),
);

adminRetreatsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await detailJson(await retreatOf(req)));
  }),
);

const updateSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    location: z.string().trim().max(200),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().trim().min(1).max(64),
    settings: settingsPatchSchema,
  })
  .partial()
  .strict();

adminRetreatsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Some of those settings don't look right.", parsed.error.flatten());
    const body = parsed.data;
    const start = body.startDate ?? retreat.start_date;
    const end = body.endDate ?? retreat.end_date;
    if (end < start) throw badRequest("The end date is before the start date.");
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
      } catch {
        throw badRequest("That time zone isn't recognised. Use a name like America/Los_Angeles.");
      }
    }
    const settings = body.settings ? mergeSettings(normaliseSettings(retreat.settings), body.settings) : normaliseSettings(retreat.settings);
    if (settings.groupCall.confirmed && !settings.groupCall.startsAt) {
      throw badRequest("Add the confirmed date and time before marking the group call confirmed.");
    }
    await pool.query(
      `UPDATE retreats SET title = $2, location = $3, start_date = $4::date, end_date = $5::date, timezone = $6,
              settings = $7::jsonb, updated_at = now()
        WHERE id = $1`,
      [retreat.id, body.title ?? retreat.title, body.location ?? retreat.location, start, end, body.timezone ?? retreat.timezone, JSON.stringify(settings)],
    );
    const updated = (await findRetreatById(retreat.id))!;
    await recordAdminAction({
      req,
      action: "retreat.update",
      entityType: "retreat",
      entityId: retreat.id,
      before: { title: retreat.title, startDate: retreat.start_date, endDate: retreat.end_date, settings: retreat.settings },
      after: { title: updated.title, startDate: updated.start_date, endDate: updated.end_date, settings: updated.settings },
    });
    res.json(await detailJson(updated));
  }),
);

/**
 * POST /:id/publish — lets guests who hold the dashboard product open it.
 * Grants nothing and sends nothing: access still comes only from a grant.
 */
adminRetreatsRouter.post(
  "/:id/publish",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = z.object({ published: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose publish or unpublish.");
    await pool.query(`UPDATE retreats SET published = $2, updated_at = now() WHERE id = $1`, [retreat.id, parsed.data.published]);
    await recordAdminAction({
      req,
      action: parsed.data.published ? "retreat.publish" : "retreat.unpublish",
      entityType: "retreat",
      entityId: retreat.id,
      before: { published: retreat.published },
      after: { published: parsed.data.published },
    });
    res.json(await detailJson((await findRetreatById(retreat.id))!));
  }),
);

/**
 * GET /:id/preview[?memberId=] — the guest dashboard, read-only. Without a
 * member it is what a brand-new guest sees; with one it is that guest's own
 * dashboard (audited), whether or not the retreat is published yet.
 */
adminRetreatsRouter.get(
  "/:id/preview",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    if (req.query.memberId === undefined) {
      res.json(await buildDashboard(retreat, null, { preview: true }));
      return;
    }
    const memberId = memberIdParam(req.query.memberId);
    await assertRetreatPerson(retreat, memberId);
    await recordAdminAction({ req, action: "retreat.guest.preview", entityType: "retreat_guest", entityId: `${retreat.id}:${memberId}` });
    res.json(await buildDashboard(retreat, memberId, { preview: true }));
  }),
);

/** GET /:id/preview/memories — the gallery as guests would see it (approved items only). */
adminRetreatsRouter.get(
  "/:id/preview/memories",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const settings = normaliseSettings(retreat.settings);
    const rows = await pool.query<MediaRow>(`${MEDIA_SELECT} WHERE m.retreat_id = $1 AND m.status = 'approved' ORDER BY m.created_at DESC LIMIT 500`, [retreat.id]);
    res.json({
      available: true,
      uploadsOpen: false,
      requireReview: settings.gallery.requireReview,
      maxPhotoMb: settings.gallery.maxPhotoMb,
      maxVideoMb: settings.gallery.maxVideoMb,
      items: rows.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        url: mediaUrl(signMediaToken({ audience: "a", principalId: adminId(req), mediaId: row.id }), "a"),
        caption: row.caption,
        mine: false,
        status: "approved",
        uploadedBy: row.member_id === null ? "FlourisHealer" : row.uploader_name || "A guest",
        createdAt: new Date(row.created_at).toISOString(),
      })),
    });
  }),
);

/* ─────────────────────────────── guests ──────────────────────────────── */

adminRetreatsRouter.get(
  "/:id/guests",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const people = await retreatPeople(retreat);
    const guests = [];
    for (const person of people) {
      const [identity, dashboard, feedback, interest] = await Promise.all([
        memberIdentity(person.member_id),
        buildDashboard(retreat, person.member_id, { preview: true }),
        loadFeedbackRow(retreat.id, person.member_id),
        loadInterest(retreat.id, person.member_id),
      ]);
      const insurance = dashboard.travelInsurance.data as { coverageStatus?: string };
      guests.push({
        memberId: person.member_id,
        contactId: identity.contactId,
        name: identity.name,
        email: identity.email,
        hasDashboardAccess: person.dashboard,
        checklist: dashboard.checklist.map((item) => ({ key: item.key, status: item.status })),
        coverageStatus: dashboard.travelInsurance.state === "submitted" ? insurance.coverageStatus ?? null : null,
        paymentsStatus: dashboard.payments.status,
        feedbackSubmitted: Boolean(feedback?.submitted_at),
        interest: interest.interest,
        marketingOptIn: interest.interest ? interest.marketingOptIn : null,
      });
    }
    guests.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ guests });
  }),
);

async function guestDetail(retreat: RetreatRow, memberId: number, req: Request) {
  const access = await assertRetreatPerson(retreat, memberId);
  const [identity, dashboard, forms, assignments, payments, feedbackRow, interest, tasks, media] = await Promise.all([
    memberIdentity(memberId),
    buildDashboard(retreat, memberId, { preview: true }),
    loadFormRecords(retreat.id, memberId),
    loadAgreementAssignments(retreat.id, memberId),
    loadPayments(retreat.id, memberId),
    loadFeedbackRow(retreat.id, memberId),
    loadInterest(retreat.id, memberId),
    loadTaskRecords(retreat.id, memberId),
    pool.query<MediaRow>(`${MEDIA_SELECT} WHERE m.retreat_id = $1 AND m.member_id = $2 ORDER BY m.created_at DESC`, [retreat.id, memberId]),
  ]);
  const history = async (responseId: number | undefined) =>
    responseId
      ? (
          await pool.query<{ data: Record<string, unknown>; submitted_at: Date }>(
            `SELECT data, submitted_at FROM retreat_form_submissions WHERE response_id = $1 ORDER BY submitted_at DESC LIMIT 50`,
            [responseId],
          )
        ).rows.map((row) => ({ data: row.data, submittedAt: new Date(row.submitted_at).toISOString() }))
      : [];
  const flight = forms.get("flight_preferences");
  const insurance = forms.get("travel_insurance");
  const call = tasks.get("group_call");
  return {
    memberId,
    contactId: identity.contactId,
    name: identity.name,
    email: identity.email,
    hasDashboardAccess: access.dashboard,
    checklist: dashboard.checklist,
    forms: {
      flight_preferences: { ...formView(flight), history: await history(flight?.id) },
      travel_insurance: { ...formView(insurance), history: await history(insurance?.id) },
    },
    agreement: {
      ...agreementView(assignments),
      assignments: assignments.map((a) => ({ id: a.id, status: a.status, signedAt: a.signed_at ? new Date(a.signed_at).toISOString() : null })),
    },
    payments,
    groupCallRsvp: typeof call?.guest_data?.rsvp === "string" ? call.guest_data.rsvp : null,
    feedback: {
      ...feedbackView(feedbackRow),
      id: feedbackRow?.id ?? null,
      approvedForPublicationAt: feedbackRow?.approved_for_publication_at ? new Date(feedbackRow.approved_for_publication_at).toISOString() : null,
    },
    interest,
    media: await Promise.all(media.rows.map((row) => adminMediaJson(row, req))),
  };
}

adminRetreatsRouter.get(
  "/:id/guests/:memberId",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = memberIdParam(req.params.memberId);
    const detail = await guestDetail(retreat, memberId, req);
    await recordAdminAction({ req, action: "retreat.guest.view", entityType: "retreat_guest", entityId: `${retreat.id}:${memberId}` });
    res.json(detail);
  }),
);

const reviewSchema = z
  .object({ status: z.enum(["verified", "needs_attention", "clear"]), note: z.string().trim().max(2000).default("") })
  .strict();

/**
 * PUT /:id/guests/:memberId/tasks/:taskKey — the organizer's review. Verified /
 * Needs attention (with a note the guest sees) / clear. Not for the agreement,
 * whose status follows its signed record only.
 */
adminRetreatsRouter.put(
  "/:id/guests/:memberId/tasks/:taskKey",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = memberIdParam(req.params.memberId);
    await assertRetreatPerson(retreat, memberId);
    const taskKey = String(req.params.taskKey) as TaskKey;
    if (!REVIEWABLE_TASKS.includes(taskKey)) throw badRequest("That task can't be reviewed here.");
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose Verified, Needs attention or Clear.");
    if (parsed.data.status === "needs_attention" && !parsed.data.note) throw badRequest("Add a note so the guest knows what to change.");
    const status = parsed.data.status === "clear" ? null : parsed.data.status;
    await pool.query(
      `INSERT INTO retreat_guest_tasks (retreat_id, member_id, task_key, review_status, review_note, reviewed_at, reviewed_by)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $4::text IS NULL THEN NULL ELSE now() END, $6)
       ON CONFLICT (retreat_id, member_id, task_key) DO UPDATE SET
         review_status = EXCLUDED.review_status,
         review_note = EXCLUDED.review_note,
         reviewed_at = EXCLUDED.reviewed_at,
         reviewed_by = EXCLUDED.reviewed_by`,
      [retreat.id, memberId, taskKey, status, status ? parsed.data.note : "", adminId(req)],
    );
    await recordAdminAction({
      req,
      action: "retreat.task.review",
      entityType: "retreat_guest",
      entityId: `${retreat.id}:${memberId}`,
      after: { taskKey, status: parsed.data.status, note: parsed.data.note },
    });
    res.json(await guestDetail(retreat, memberId, req));
  }),
);

/* ─────────────────────────────── announcements ───────────────────────── */

function announcementJson(row: { id: number; title: string; body_md: string; published: boolean; published_at: Date | null; updated_at: Date }) {
  return {
    id: row.id,
    title: row.title,
    bodyMd: row.body_md,
    published: row.published,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : "",
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const announcementSchema = z
  .object({ id: z.number().int().positive().optional(), title: z.string().trim().min(1).max(200), bodyMd: z.string().max(20000).default(""), published: z.boolean() })
  .strict();

adminRetreatsRouter.get(
  "/:id/announcements",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const rows = await pool.query(`SELECT * FROM retreat_announcements WHERE retreat_id = $1 ORDER BY created_at DESC`, [retreat.id]);
    res.json({ announcements: rows.rows.map(announcementJson) });
  }),
);

adminRetreatsRouter.post(
  "/:id/announcements",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Give the announcement a title.");
    const row = await pool.query(
      `INSERT INTO retreat_announcements (retreat_id, title, body_md, published, published_at, created_by)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() END, $5) RETURNING *`,
      [retreat.id, parsed.data.title, parsed.data.bodyMd, parsed.data.published, adminId(req)],
    );
    await recordAdminAction({ req, action: "retreat.announcement.create", entityType: "retreat_announcement", entityId: row.rows[0].id, after: parsed.data });
    res.status(201).json(announcementJson(row.rows[0]));
  }),
);

adminRetreatsRouter.put(
  "/:id/announcements/:announcementId",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Give the announcement a title.");
    const row = await pool.query(
      `UPDATE retreat_announcements
          SET title = $3, body_md = $4, published = $5,
              published_at = CASE WHEN $5 THEN COALESCE(published_at, now()) ELSE NULL END,
              updated_at = now()
        WHERE id = $1 AND retreat_id = $2 RETURNING *`,
      [rowId(req.params.announcementId, "We couldn't find that announcement."), retreat.id, parsed.data.title, parsed.data.bodyMd, parsed.data.published],
    );
    if (!row.rows[0]) throw notFound("We couldn't find that announcement.");
    await recordAdminAction({ req, action: "retreat.announcement.update", entityType: "retreat_announcement", entityId: row.rows[0].id, after: parsed.data });
    res.json(announcementJson(row.rows[0]));
  }),
);

adminRetreatsRouter.delete(
  "/:id/announcements/:announcementId",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const row = await pool.query(`DELETE FROM retreat_announcements WHERE id = $1 AND retreat_id = $2 RETURNING id, title`, [
      rowId(req.params.announcementId, "We couldn't find that announcement."),
      retreat.id,
    ]);
    if (!row.rows[0]) throw notFound("We couldn't find that announcement.");
    await recordAdminAction({ req, action: "retreat.announcement.delete", entityType: "retreat_announcement", entityId: row.rows[0].id, before: row.rows[0] });
    res.json({ ok: true });
  }),
);

/* ─────────────────────────────── memories ────────────────────────────── */

async function adminMediaJson(row: MediaRow, req: Request) {
  const reports = await pool.query<{ id: number; reason: string; created_at: Date; resolved_at: Date | null; reporter: string | null }>(
    `SELECT r.id, r.reason, r.created_at, r.resolved_at, COALESCE(NULLIF(m.name, ''), m.email::text) AS reporter
       FROM retreat_media_reports r LEFT JOIN members m ON m.id = r.member_id
      WHERE r.media_id = $1 ORDER BY r.created_at DESC`,
    [row.id],
  );
  return {
    id: row.id,
    kind: row.kind,
    url: row.status === "removed" ? "" : mediaUrl(signMediaToken({ audience: "a", principalId: adminId(req), mediaId: row.id }), "a"),
    caption: row.caption,
    status: row.status,
    sharingConsent: row.sharing_consent,
    uploadedBy: row.member_id === null ? "FlourisHealer" : row.uploader_name || "A guest",
    memberId: row.member_id,
    sizeBytes: Number(row.size_bytes),
    createdAt: new Date(row.created_at).toISOString(),
    reports: reports.rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      reportedBy: r.reporter ?? "A guest",
      createdAt: new Date(r.created_at).toISOString(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    })),
  };
}

adminRetreatsRouter.get(
  "/:id/media",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const rows = await pool.query<MediaRow>(`${MEDIA_SELECT} WHERE m.retreat_id = $1 ORDER BY m.created_at DESC LIMIT 1000`, [retreat.id]);
    const storage = await pool.query<{ total: string | null }>(
      `SELECT SUM(size_bytes)::text AS total FROM retreat_media WHERE retreat_id = $1 AND status <> 'removed'`,
      [retreat.id],
    );
    const items = [];
    for (const row of rows.rows) items.push(await adminMediaJson(row, req));
    res.json({ items, storageBytes: Number(storage.rows[0]?.total ?? 0) });
  }),
);

const ownerUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => {
      const dir = partsDir("protected");
      fs.mkdir(dir, { recursive: true }).then(() => done(null, dir), (error) => done(error as Error, dir));
    },
    filename: (_req, _file, done) => done(null, `.retreat-${crypto.randomBytes(12).toString("hex")}`),
  }),
  limits: { fileSize: 400 * 1024 * 1024, files: 1, fields: 5 },
});

/** POST /:id/media — the owner's own upload, approved immediately. */
adminRetreatsRouter.post(
  "/:id/media",
  asyncHandler(async (req, _res, next) => {
    await retreatOf(req);
    next();
  }),
  ownerUpload.single("file"),
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const settings = normaliseSettings(retreat.settings);
    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 300) : "";
    const stored = await storeStagedMemory(req.file, retreat, settings.gallery);
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO retreat_media (retreat_id, admin_user_id, storage_ref, mime, kind, size_bytes, original_name, caption,
                                  sharing_consent, status, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'approved', $2, now()) RETURNING id`,
      [retreat.id, adminId(req), stored.reference, stored.mime, stored.kind, stored.sizeBytes, stored.originalName, caption],
    );
    const row = await pool.query<MediaRow>(`${MEDIA_SELECT} WHERE m.id = $1`, [inserted.rows[0].id]);
    await recordAdminAction({ req, action: "retreat.media.upload", entityType: "retreat_media", entityId: inserted.rows[0].id });
    res.status(201).json(await adminMediaJson(row.rows[0], req));
  }),
);

/**
 * PUT /:id/media/:mediaId — approve, hide, or remove. Remove deletes the stored
 * bytes as well, so removed content can no longer be viewed or downloaded.
 */
adminRetreatsRouter.put(
  "/:id/media/:mediaId",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = z.object({ status: z.enum(["approved", "hidden", "removed"]) }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose approve, hide or remove.");
    const updated = await pool.query<{ id: number; storage_ref: string; previous: string }>(
      `UPDATE retreat_media m
          SET status = $3, reviewed_by = $4, reviewed_at = now(),
              removed_at = CASE WHEN $3 = 'removed' THEN now() ELSE NULL END
         FROM (SELECT id, status AS previous FROM retreat_media WHERE id = $1 AND retreat_id = $2 FOR UPDATE) p
        WHERE m.id = p.id AND p.previous <> 'removed'
        RETURNING m.id, m.storage_ref, p.previous`,
      [rowId(req.params.mediaId, "We couldn't find that item."), retreat.id, parsed.data.status, adminId(req)],
    );
    const row = updated.rows[0];
    if (!row) throw notFound("We couldn't find that item, or it has already been removed.");
    if (parsed.data.status === "removed") {
      await removeStoredMedia(row.storage_ref).catch((error: unknown) => {
        console.error("[retreats] could not delete removed memory bytes", { id: row.id, error: error instanceof Error ? error.message : String(error) });
      });
    }
    await recordAdminAction({
      req,
      action: `retreat.media.${parsed.data.status}`,
      entityType: "retreat_media",
      entityId: row.id,
      before: { status: row.previous },
      after: { status: parsed.data.status },
    });
    const fresh = await pool.query<MediaRow>(`${MEDIA_SELECT} WHERE m.id = $1`, [row.id]);
    res.json(await adminMediaJson(fresh.rows[0], req));
  }),
);

adminRetreatsRouter.post(
  "/:id/media-reports/:reportId/resolve",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const resolved = await pool.query(
      `UPDATE retreat_media_reports r SET resolved_at = now(), resolved_by = $3
         FROM retreat_media m
        WHERE r.id = $1 AND m.id = r.media_id AND m.retreat_id = $2
        RETURNING r.id`,
      [rowId(req.params.reportId, "We couldn't find that report."), retreat.id, adminId(req)],
    );
    if (!resolved.rows[0]) throw notFound("We couldn't find that report.");
    res.json({ ok: true });
  }),
);

/* ─────────────────────────── alumni: feedback + interest ─────────────── */

interface AdminFeedbackDbRow {
  id: number;
  member_id: number;
  name: string | null;
  email: string;
  answers: Record<string, unknown>;
  testimonial_text: string;
  testimonial_consent: "no" | "first_name" | "first_name_role" | "full_name";
  testimonial_role: string;
  approved_for_publication_at: Date | null;
  updated_at: Date;
  submitted_at: Date | null;
}

function feedbackRowJson(row: AdminFeedbackDbRow) {
  const rating = typeof row.answers?.rating === "number" ? row.answers.rating : null;
  return {
    id: row.id,
    memberId: row.member_id,
    name: row.name ?? "",
    email: row.email,
    state: row.submitted_at ? "submitted" : "draft",
    rating,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
    answers: row.answers,
    testimonialText: row.testimonial_text,
    testimonialConsent: row.testimonial_consent,
    testimonialRole: row.testimonial_role,
    approvedForPublicationAt: row.approved_for_publication_at ? new Date(row.approved_for_publication_at).toISOString() : null,
  };
}

const FEEDBACK_SELECT = `SELECT f.id, f.member_id, m.name, m.email::text AS email, f.answers, f.testimonial_text,
    f.testimonial_consent, f.testimonial_role, f.approved_for_publication_at, f.updated_at, f.submitted_at
  FROM retreat_feedback f JOIN members m ON m.id = f.member_id`;

adminRetreatsRouter.get(
  "/:id/feedback",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const rows = await pool.query<AdminFeedbackDbRow>(`${FEEDBACK_SELECT} WHERE f.retreat_id = $1 ORDER BY f.updated_at DESC`, [retreat.id]);
    await recordAdminAction({ req, action: "retreat.feedback.list", entityType: "retreat", entityId: retreat.id });
    res.json({ feedback: rows.rows.map(feedbackRowJson) });
  }),
);

/**
 * PUT /:id/feedback/:feedbackId/publication — the separate "Approve for
 * publication" action. Allowed only for a submitted reflection whose guest
 * chose a public-use consent and wrote a testimonial; the database CHECK
 * refuses an approval without consent as well. Nothing is published from
 * here — this records the owner's approval of the guest's exact words.
 */
adminRetreatsRouter.put(
  "/:id/feedback/:feedbackId/publication",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = z.object({ approved: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose approve or withdraw.");
    const id = rowId(req.params.feedbackId, "We couldn't find that reflection.");
    const current = await pool.query<AdminFeedbackDbRow>(`${FEEDBACK_SELECT} WHERE f.id = $1 AND f.retreat_id = $2`, [id, retreat.id]);
    const row = current.rows[0];
    if (!row) throw notFound("We couldn't find that reflection.");
    if (parsed.data.approved && (!row.submitted_at || row.testimonial_consent === "no" || !row.testimonial_text.trim())) {
      throw badRequest("Only a submitted testimonial whose guest agreed to public use can be approved.");
    }
    await pool.query(
      `UPDATE retreat_feedback SET approved_for_publication_at = CASE WHEN $3 THEN now() ELSE NULL END,
              approved_by = CASE WHEN $3 THEN $4::int ELSE NULL END
        WHERE id = $1 AND retreat_id = $2`,
      [id, retreat.id, parsed.data.approved, adminId(req)],
    );
    await recordAdminAction({
      req,
      action: parsed.data.approved ? "retreat.testimonial.approve" : "retreat.testimonial.withdraw",
      entityType: "retreat_feedback",
      entityId: id,
      after: { consent: row.testimonial_consent },
    });
    const fresh = await pool.query<AdminFeedbackDbRow>(`${FEEDBACK_SELECT} WHERE f.id = $1`, [id]);
    res.json(feedbackRowJson(fresh.rows[0]));
  }),
);

adminRetreatsRouter.get(
  "/:id/interest",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const rows = await pool.query<{ member_id: number; name: string | null; email: string; interest: string; destinations: string; marketing_opt_in: boolean; updated_at: Date }>(
      `SELECT i.member_id, m.name, m.email::text AS email, i.interest, i.destinations, i.marketing_opt_in, i.updated_at
         FROM retreat_interest i JOIN members m ON m.id = i.member_id
        WHERE i.retreat_id = $1 ORDER BY i.updated_at DESC`,
      [retreat.id],
    );
    res.json({
      interest: rows.rows.map((row) => ({
        memberId: row.member_id,
        name: row.name ?? "",
        email: row.email,
        interest: row.interest,
        destinations: row.destinations,
        marketingOptIn: row.marketing_opt_in,
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    });
  }),
);

/** A spreadsheet cell that cannot be read as a formula. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** GET /:id/alumni.csv — preferences, consent and feedback STATUS per guest (no free-text answers). */
adminRetreatsRouter.get(
  "/:id/alumni.csv",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const people = await retreatPeople(retreat);
    const lines = [
      ["name", "email", "dashboard_access", "interest", "destinations", "marketing_opt_in", "feedback", "testimonial_consent", "approved_for_publication"].join(","),
    ];
    for (const person of people) {
      const [identity, interest, feedback] = await Promise.all([
        memberIdentity(person.member_id),
        loadInterest(retreat.id, person.member_id),
        loadFeedbackRow(retreat.id, person.member_id),
      ]);
      lines.push(
        [
          identity.name,
          identity.email,
          person.dashboard ? "yes" : "no",
          interest.interest ?? "",
          interest.destinations,
          interest.interest ? (interest.marketingOptIn ? "yes" : "no") : "",
          feedback ? (feedback.submitted_at ? "submitted" : "draft") : "",
          feedback?.testimonial_consent ?? "",
          feedback?.approved_for_publication_at ? new Date(feedback.approved_for_publication_at).toISOString() : "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    await recordAdminAction({ req, action: "retreat.alumni.export", entityType: "retreat", entityId: retreat.id });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${retreat.slug}-alumni.csv"`);
    res.send(`${lines.join("\r\n")}\r\n`);
  }),
);

/* ─────────────────────────────── join us again cards ─────────────────── */

const cardSchema = z
  .object({
    id: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(["international", "domestic_business"]).default("international"),
    destination: z.string().trim().max(200).default(""),
    datesText: z.string().trim().max(200).default(""),
    description: z.string().trim().max(4000).default(""),
    imageUrl: safeLink.default(""),
    status: z.enum(["draft", "interest_list", "registration_open", "sold_out"]).default("draft"),
    ctaLabel: z.string().trim().max(80).default(""),
    ctaUrl: safeLink.default(""),
    bookedProductId: z.number().int().positive().nullable().default(null),
    visible: z.boolean().default(false),
    displayFrom: z.string().datetime({ offset: true }).nullable().default(null),
    displayUntil: z.string().datetime({ offset: true }).nullable().default(null),
    sort: z.number().int().min(0).max(1000).default(0),
  })
  .strip();

function cardJson(row: Record<string, unknown>) {
  const iso = (value: unknown) => (value ? new Date(value as Date).toISOString() : null);
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    destination: row.destination,
    datesText: row.dates_text,
    description: row.description,
    imageUrl: row.image_url,
    status: row.status,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    bookedProductId: row.booked_product_id,
    visible: row.visible,
    displayFrom: iso(row.display_from),
    displayUntil: iso(row.display_until),
    sort: row.sort,
  };
}

function parseCard(body: unknown) {
  const parsed = cardSchema.safeParse(body);
  if (!parsed.success) throw badRequest("Some of the card's details don't look right.", parsed.error.flatten());
  const card = parsed.data;
  if (card.status === "registration_open" && !card.ctaUrl) {
    throw badRequest("A card marked Registration Open needs the verified booking link.");
  }
  if (card.displayFrom && card.displayUntil && card.displayUntil <= card.displayFrom) {
    throw badRequest("The display window ends before it starts.");
  }
  return card;
}

adminRetreatsRouter.get(
  "/:id/cards",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const rows = await pool.query(`SELECT * FROM retreat_offer_cards WHERE retreat_id = $1 ORDER BY sort, id`, [retreat.id]);
    res.json({ cards: rows.rows.map(cardJson) });
  }),
);

adminRetreatsRouter.post(
  "/:id/cards",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const card = parseCard(req.body);
    const row = await pool.query(
      `INSERT INTO retreat_offer_cards (retreat_id, title, kind, destination, dates_text, description, image_url, status,
                                        cta_label, cta_url, booked_product_id, visible, display_from, display_until, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [retreat.id, card.title, card.kind, card.destination, card.datesText, card.description, card.imageUrl, card.status,
       card.ctaLabel, card.ctaUrl, card.bookedProductId, card.visible, card.displayFrom, card.displayUntil, card.sort],
    );
    await recordAdminAction({ req, action: "retreat.card.create", entityType: "retreat_offer_card", entityId: row.rows[0].id, after: card });
    res.status(201).json(cardJson(row.rows[0]));
  }),
);

adminRetreatsRouter.put(
  "/:id/cards/:cardId",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const card = parseCard(req.body);
    const row = await pool.query(
      `UPDATE retreat_offer_cards SET title=$3, kind=$4, destination=$5, dates_text=$6, description=$7, image_url=$8, status=$9,
              cta_label=$10, cta_url=$11, booked_product_id=$12, visible=$13, display_from=$14, display_until=$15, sort=$16,
              updated_at = now()
        WHERE id = $1 AND retreat_id = $2 RETURNING *`,
      [rowId(req.params.cardId, "We couldn't find that card."), retreat.id, card.title, card.kind, card.destination, card.datesText, card.description, card.imageUrl,
       card.status, card.ctaLabel, card.ctaUrl, card.bookedProductId, card.visible, card.displayFrom, card.displayUntil, card.sort],
    );
    if (!row.rows[0]) throw notFound("We couldn't find that card.");
    await recordAdminAction({ req, action: "retreat.card.update", entityType: "retreat_offer_card", entityId: row.rows[0].id, after: card });
    res.json(cardJson(row.rows[0]));
  }),
);

adminRetreatsRouter.delete(
  "/:id/cards/:cardId",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const row = await pool.query(`DELETE FROM retreat_offer_cards WHERE id = $1 AND retreat_id = $2 RETURNING id, title`, [
      rowId(req.params.cardId, "We couldn't find that card."),
      retreat.id,
    ]);
    if (!row.rows[0]) throw notFound("We couldn't find that card.");
    await recordAdminAction({ req, action: "retreat.card.delete", entityType: "retreat_offer_card", entityId: row.rows[0].id, before: row.rows[0] });
    res.json({ ok: true });
  }),
);
