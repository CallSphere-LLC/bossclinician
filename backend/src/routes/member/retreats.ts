import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { Router, type Request } from "express";
import multer from "multer";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation } from "../../middleware/memberAuth";
import { partsDir } from "../../services/mediaStorage";
import { protectedRef, uploadPath } from "../../services/signedUrls";
import { finishStagedMedia, persistStagedMedia, removeStoredMedia, usesS3Media } from "../../services/objectStorage";
import { memberRetreatQuestionnairesRouter } from "./retreatQuestionnaires";
import { memberRetreatBalancePlansRouter } from "./retreatBalancePlans";
import { loadGuestBalancePlan } from "../../services/retreatBalancePlans";
import {
  MEDIA_SELECT,
  SELF_REPORTED_TASKS,
  buildDashboard,
  feedbackView,
  guestMayView,
  interestSchema,
  isOpen,
  listMemberRetreats,
  loadFeedbackRow,
  loadGuestRetreat,
  loadInterest,
  mediaUrl,
  memberIdentity,
  normaliseSettings,
  signMediaToken,
  sniffMemoryMime,
  todayIn,
  validateFeedback,
  type MediaRow,
  type RetreatRow,
} from "../../services/retreats";

/**
 * `/api/member/retreats/*` — a guest's own FlourisHealer retreat dashboard
 * (requireMember is applied by routes/member/index.ts).
 *
 * Every handler starts with loadGuestRetreat: published retreat + an active
 * grant on its dashboard product, or the same 404 whatever the reason. Every
 * read and write is then keyed on (retreat, req.member.id) — no handler takes a
 * member id, contact id or response id from the client, so one guest cannot
 * name another guest's records. Every write carries denyImpersonation: an
 * admin "viewing as" a guest can read but never change her answers.
 */
export const memberRetreatsRouter = Router();

function memberIdOf(req: Request): number {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member.id;
}

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many saves. Please wait a moment and try again." },
  keyGenerator: (req: Request) => (req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "")),
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "That's a lot of uploads in one go. Please wait a little and try again." },
  keyGenerator: (req: Request) => (req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "")),
});

function noStore(res: import("express").Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}

/** GET /retreats — the published retreats this member is a guest of (portal nav). */
memberRetreatsRouter.get(
  "/retreats",
  asyncHandler(async (req, res) => {
    noStore(res);
    res.json({ retreats: await listMemberRetreats(memberIdOf(req)) });
  }),
);

/** GET /retreats/:slug — the whole dashboard for the signed-in guest. */
memberRetreatsRouter.get(
  "/retreats/:slug",
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    noStore(res);
    const dashboard = await buildDashboard(retreat, memberId, { preview: false });
    // The balance plan (migration 230) is null unless the owner has opened one
    // for this guest. A failure reading it must not take the dashboard down.
    const balancePlan = await loadGuestBalancePlan(retreat, memberId).catch((err: unknown) => {
      console.error(`[retreat-balance] could not load the balance plan for member ${memberId}:`, err);
      return null;
    });
    res.json({ ...dashboard, balancePlan });
  }),
);

/* ───────────────────────────── balance plan ───────────────────────────── */

// Card on file + automatic monthly charges for a guest's remaining balance.
memberRetreatsRouter.use(memberRetreatBalancePlansRouter);

/* ───────────────────────────── questionnaires ─────────────────────────── */

// Guest Profile, Flight Preferences and Flight Details are owner-editable
// questionnaires now (migration 224); the old fixed forms endpoint is gone.
memberRetreatsRouter.use(memberRetreatQuestionnairesRouter);

/* ─────────────────────────── self-reported tasks ─────────────────────── */

/**
 * POST /retreats/:slug/tasks/:taskKey — the guest says she has checked her
 * passport. The most this can record is "submitted"; Verified comes only
 * from an organizer.
 */
memberRetreatsRouter.post(
  "/retreats/:slug/tasks/:taskKey",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    const taskKey = String(req.params.taskKey);
    if (!(SELF_REPORTED_TASKS as readonly string[]).includes(taskKey)) throw notFound("We couldn't find that task.");
    const parsed = z.object({ done: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Nothing to save.");
    await pool.query(
      `INSERT INTO retreat_guest_tasks (retreat_id, member_id, task_key, guest_status, guest_updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (retreat_id, member_id, task_key)
       DO UPDATE SET guest_status = EXCLUDED.guest_status, guest_updated_at = now()`,
      [retreat.id, memberId, taskKey, parsed.data.done ? "submitted" : "none"],
    );
    const dashboard = await buildDashboard(retreat, memberId, { preview: false });
    noStore(res);
    res.json({ status: dashboard.checklist.find((item) => item.key === taskKey)?.status ?? "not_started" });
  }),
);

/** POST /retreats/:slug/group-call/rsvp — only once the owner has confirmed the call. */
memberRetreatsRouter.post(
  "/retreats/:slug/group-call/rsvp",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    const settings = normaliseSettings(retreat.settings);
    if (!settings.groupCall.confirmed || !settings.groupCall.startsAt) {
      throw badRequest("The group call details haven't been confirmed yet.");
    }
    const parsed = z.object({ rsvp: z.enum(["yes", "no", "maybe"]) }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose Yes, Maybe or No.");
    await pool.query(
      `INSERT INTO retreat_guest_tasks (retreat_id, member_id, task_key, guest_status, guest_data, guest_updated_at)
       VALUES ($1, $2, 'group_call', 'submitted', $3::jsonb, now())
       ON CONFLICT (retreat_id, member_id, task_key)
       DO UPDATE SET guest_status = 'submitted', guest_data = EXCLUDED.guest_data, guest_updated_at = now()`,
      [retreat.id, memberId, JSON.stringify({ rsvp: parsed.data.rsvp })],
    );
    noStore(res);
    res.json({ rsvp: parsed.data.rsvp });
  }),
);

/* ─────────────────────────────── memories ────────────────────────────── */

function galleryState(retreat: RetreatRow) {
  const settings = normaliseSettings(retreat.settings);
  const today = todayIn(retreat.timezone);
  const available = isOpen(settings.gallery.mode, retreat.end_date, today);
  return {
    settings,
    available,
    uploadsOpen: available && isOpen(settings.gallery.uploadsMode, retreat.end_date, today),
  };
}

export function memoryJson(row: MediaRow, viewerMemberId: number) {
  return {
    id: row.id,
    kind: row.kind,
    url: mediaUrl(signMediaToken({ audience: "m", principalId: viewerMemberId, mediaId: row.id })),
    caption: row.caption,
    mine: row.member_id === viewerMemberId,
    status: row.status === "approved" ? "approved" : "pending",
    uploadedBy: row.member_id === null ? "FlourisHealer" : row.uploader_name || "A guest",
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** GET /retreats/:slug/memories — this retreat's gallery, for this retreat's guests only. */
memberRetreatsRouter.get(
  "/retreats/:slug/memories",
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    const { settings, available, uploadsOpen } = galleryState(retreat);
    noStore(res);
    const base = {
      available,
      uploadsOpen,
      requireReview: settings.gallery.requireReview,
      maxPhotoMb: settings.gallery.maxPhotoMb,
      maxVideoMb: settings.gallery.maxVideoMb,
    };
    if (!available) {
      res.json({ ...base, items: [] });
      return;
    }
    const rows = await pool.query<MediaRow>(
      `${MEDIA_SELECT}
        WHERE m.retreat_id = $1 AND (m.status = 'approved' OR (m.status = 'pending' AND m.member_id = $2))
        ORDER BY m.created_at DESC LIMIT 500`,
      [retreat.id, memberId],
    );
    res.json({ ...base, items: rows.rows.filter((row) => guestMayView(row, memberId)).map((row) => memoryJson(row, memberId)) });
  }),
);

/**
 * Uploads stream to disk in the protected root's staging area (never memory,
 * never the public /uploads mount), are identified from their own bytes, then
 * committed under a random protected: reference.
 */
const memoryUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => {
      const dir = partsDir("protected");
      fs.mkdir(dir, { recursive: true }).then(() => done(null, dir), (error) => done(error as Error, dir));
    },
    filename: (_req, _file, done) => done(null, `.retreat-${crypto.randomBytes(12).toString("hex")}`),
  }),
  // The largest any retreat may allow; the retreat's own, smaller cap is checked after.
  limits: { fileSize: 400 * 1024 * 1024, files: 1, fields: 5 },
});

async function readHead(file: string): Promise<Buffer> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, 16, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Moves a staged upload to its protected reference (S3 or the protected disk root). */
export async function commitStagedMemory(staged: string, reference: string, mime: string): Promise<void> {
  if (usesS3Media()) {
    await persistStagedMedia(reference, staged, mime);
    await finishStagedMedia(staged);
    return;
  }
  const destination = uploadPath(reference);
  if (!destination) throw new Error("Invalid storage reference");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(staged, destination);
}

export interface StagedMemory {
  reference: string;
  mime: string;
  kind: "photo" | "video";
  sizeBytes: number;
  originalName: string;
}

/** Validates a staged file against the retreat's limits and stores it. The staged file is always consumed. */
export async function storeStagedMemory(
  file: Express.Multer.File | undefined,
  retreat: RetreatRow,
  limits: { maxPhotoMb: number; maxVideoMb: number },
): Promise<StagedMemory> {
  if (!file) throw badRequest("Choose a photo or video to upload.");
  try {
    if (file.size === 0) throw badRequest("That file is empty.");
    const sniffed = sniffMemoryMime(await readHead(file.path));
    if (!sniffed) {
      throw badRequest("Upload a photo (JPEG, PNG, WebP or GIF) or a video (MP4, MOV or WebM). On iPhone, choose “Most Compatible” for photos.");
    }
    const cap = (sniffed.kind === "photo" ? limits.maxPhotoMb : limits.maxVideoMb) * 1024 * 1024;
    if (file.size > cap) {
      throw badRequest(
        sniffed.kind === "photo"
          ? `Photos can be up to ${limits.maxPhotoMb} MB.`
          : `Videos can be up to ${limits.maxVideoMb} MB. Try a shorter clip.`,
      );
    }
    const reference = protectedRef(`retreat-memories/r${retreat.id}/${crypto.randomBytes(16).toString("hex")}${sniffed.ext}`);
    await commitStagedMemory(file.path, reference, sniffed.mime);
    return {
      reference,
      mime: sniffed.mime,
      kind: sniffed.kind,
      sizeBytes: file.size,
      originalName: (file.originalname || "").slice(0, 200),
    };
  } finally {
    await fs.unlink(file.path).catch(() => undefined);
  }
}

memberRetreatsRouter.post(
  "/retreats/:slug/memories",
  denyImpersonation,
  uploadLimiter,
  // Membership is proven BEFORE any bytes are accepted.
  asyncHandler(async (req, _res, next) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    if (!galleryState(retreat).uploadsOpen) throw forbidden("Uploads to the retreat gallery aren't open right now.");
    (req as Request & { retreat?: RetreatRow }).retreat = retreat;
    next();
  }),
  memoryUpload.single("file"),
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = (req as Request & { retreat?: RetreatRow }).retreat!;
    const { settings } = galleryState(retreat);
    if (req.body?.sharingConsent !== "true") {
      if (req.file) await fs.unlink(req.file.path).catch(() => undefined);
      throw badRequest("Please confirm you have permission to share this and will respect the privacy of anyone shown.");
    }
    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 300) : "";
    const stored = await storeStagedMemory(req.file, retreat, settings.gallery);
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO retreat_media (retreat_id, member_id, storage_ref, mime, kind, size_bytes, original_name, caption, sharing_consent, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9) RETURNING id`,
      [
        retreat.id,
        memberId,
        stored.reference,
        stored.mime,
        stored.kind,
        stored.sizeBytes,
        stored.originalName,
        caption,
        settings.gallery.requireReview ? "pending" : "approved",
      ],
    );
    const row = await pool.query<MediaRow>(`${MEDIA_SELECT} WHERE m.id = $1`, [inserted.rows[0].id]);
    noStore(res);
    res.status(201).json(memoryJson(row.rows[0], memberId));
  }),
);

/** DELETE /retreats/:slug/memories/:id — a guest removes her OWN upload (bytes deleted too). */
memberRetreatsRouter.delete(
  "/retreats/:slug/memories/:id",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound("We couldn't find that upload.");
    const removed = await pool.query<{ storage_ref: string }>(
      `UPDATE retreat_media SET status = 'removed', removed_at = now()
        WHERE id = $1 AND retreat_id = $2 AND member_id = $3 AND status <> 'removed'
        RETURNING storage_ref`,
      [id, retreat.id, memberId],
    );
    if (!removed.rows[0]) throw notFound("We couldn't find that upload.");
    await removeStoredMedia(removed.rows[0].storage_ref).catch((error: unknown) => {
      console.error("[retreats] could not delete removed memory bytes", { id, error: error instanceof Error ? error.message : String(error) });
    });
    noStore(res);
    res.json({ ok: true });
  }),
);

/** POST /retreats/:slug/memories/:id/report — flag an item for the owner's review. */
memberRetreatsRouter.post(
  "/retreats/:slug/memories/:id/report",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    if (!galleryState(retreat).available) throw notFound("We couldn't find that upload.");
    const id = Number(req.params.id);
    const parsed = z.object({ reason: z.string().trim().max(1000).default("") }).strict().safeParse(req.body ?? {});
    if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) throw notFound("We couldn't find that upload.");
    const visible = await pool.query<{ status: MediaRow["status"]; member_id: number | null }>(
      `SELECT status, member_id FROM retreat_media WHERE id = $1 AND retreat_id = $2`,
      [id, retreat.id],
    );
    const row = visible.rows[0];
    if (!row || !guestMayView(row, memberId)) throw notFound("We couldn't find that upload.");
    await pool.query(
      `INSERT INTO retreat_media_reports (media_id, member_id, reason) VALUES ($1, $2, $3)
       ON CONFLICT (media_id, member_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = now(), resolved_at = NULL, resolved_by = NULL`,
      [id, memberId, parsed.data.reason],
    );
    noStore(res);
    res.json({ ok: true });
  }),
);

/* ─────────────────────────────── feedback ────────────────────────────── */

function feedbackAvailable(retreat: RetreatRow): boolean {
  const settings = normaliseSettings(retreat.settings);
  return isOpen(settings.feedback.mode, retreat.end_date, todayIn(retreat.timezone));
}

memberRetreatsRouter.get(
  "/retreats/:slug/feedback",
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    noStore(res);
    res.json({
      available: feedbackAvailable(retreat),
      labels: normaliseSettings(retreat.settings).feedback.labels,
      current: feedbackView(await loadFeedbackRow(retreat.id, memberId)),
    });
  }),
);

/**
 * PUT /retreats/:slug/feedback — the private reflection (Save & Finish Later or
 * submit) and, separately, the optional testimonial consent. Changing the
 * testimonial words or the consent withdraws any publication approval: the
 * owner approves exactly what the guest agreed to, never an older version.
 */
memberRetreatsRouter.put(
  "/retreats/:slug/feedback",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    if (!feedbackAvailable(retreat)) throw forbidden("The retreat reflection isn't open yet.");
    const submit = req.body?.submit === true;
    const { clean, errors } = validateFeedback(req.body, submit);
    if (Object.keys(errors).length > 0) {
      res.status(400).json({
        error: "Please check the highlighted answers.",
        fieldErrors: errors,
        details: { fieldErrors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]])) },
      });
      return;
    }
    const { contactId } = await memberIdentity(memberId);
    const saved = await pool.query(
      `INSERT INTO retreat_feedback
         (retreat_id, member_id, contact_id, answers, testimonial_text, testimonial_consent, testimonial_role,
          testimonial_consent_at, submitted_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7,
               CASE WHEN $6 <> 'no' THEN now() END,
               CASE WHEN $8 THEN now() END)
       ON CONFLICT (retreat_id, member_id) DO UPDATE SET
         contact_id = EXCLUDED.contact_id,
         answers = EXCLUDED.answers,
         testimonial_text = EXCLUDED.testimonial_text,
         testimonial_consent = EXCLUDED.testimonial_consent,
         testimonial_role = EXCLUDED.testimonial_role,
         testimonial_consent_at = CASE
           WHEN EXCLUDED.testimonial_consent = 'no' THEN NULL
           WHEN EXCLUDED.testimonial_consent IS DISTINCT FROM retreat_feedback.testimonial_consent THEN now()
           ELSE retreat_feedback.testimonial_consent_at END,
         approved_for_publication_at = CASE
           WHEN EXCLUDED.testimonial_consent = retreat_feedback.testimonial_consent
            AND EXCLUDED.testimonial_text = retreat_feedback.testimonial_text
            AND EXCLUDED.testimonial_role = retreat_feedback.testimonial_role
           THEN retreat_feedback.approved_for_publication_at ELSE NULL END,
         approved_by = CASE
           WHEN EXCLUDED.testimonial_consent = retreat_feedback.testimonial_consent
            AND EXCLUDED.testimonial_text = retreat_feedback.testimonial_text
            AND EXCLUDED.testimonial_role = retreat_feedback.testimonial_role
           THEN retreat_feedback.approved_by ELSE NULL END,
         submitted_at = COALESCE(retreat_feedback.submitted_at, CASE WHEN $8 THEN now() END),
         updated_at = now()
       RETURNING id, answers, testimonial_text, testimonial_consent, testimonial_role,
                 approved_for_publication_at, updated_at, submitted_at`,
      [
        retreat.id,
        memberId,
        contactId,
        JSON.stringify(clean.answers),
        clean.testimonialText,
        clean.testimonialConsent,
        clean.testimonialRole,
        submit,
      ],
    );
    noStore(res);
    res.json({ current: feedbackView(saved.rows[0]) });
  }),
);

/* ─────────────────────────────── interest ────────────────────────────── */

function interestAvailable(retreat: RetreatRow): boolean {
  const settings = normaliseSettings(retreat.settings);
  return isOpen(settings.interest.mode, retreat.end_date, todayIn(retreat.timezone));
}

memberRetreatsRouter.get(
  "/retreats/:slug/interest",
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    noStore(res);
    res.json({ available: interestAvailable(retreat), current: await loadInterest(retreat.id, memberId) });
  }),
);

/**
 * PUT /retreats/:slug/interest — her next-retreat preference and an optional
 * marketing opt-in, stored for this retreat only. It does not touch the
 * contact's email marketing status, and nothing is sent from here.
 */
memberRetreatsRouter.put(
  "/retreats/:slug/interest",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    if (!interestAvailable(retreat)) throw forbidden("This isn't open yet.");
    const parsed = interestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose one of the options.");
    const { contactId } = await memberIdentity(memberId);
    await pool.query(
      `INSERT INTO retreat_interest (retreat_id, member_id, contact_id, interest, destinations, marketing_opt_in, marketing_opt_in_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN now() END)
       ON CONFLICT (retreat_id, member_id) DO UPDATE SET
         contact_id = EXCLUDED.contact_id,
         interest = EXCLUDED.interest,
         destinations = EXCLUDED.destinations,
         marketing_opt_in = EXCLUDED.marketing_opt_in,
         marketing_opt_in_at = CASE
           WHEN NOT EXCLUDED.marketing_opt_in THEN NULL
           WHEN retreat_interest.marketing_opt_in THEN retreat_interest.marketing_opt_in_at
           ELSE now() END,
         updated_at = now()`,
      [retreat.id, memberId, contactId, parsed.data.interest, parsed.data.destinations, parsed.data.marketingOptIn],
    );
    noStore(res);
    res.json({ current: await loadInterest(retreat.id, memberId) });
  }),
);
