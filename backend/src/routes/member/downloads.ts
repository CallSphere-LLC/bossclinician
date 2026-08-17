import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation, type AuthedMember } from "../../middleware/memberAuth";
import { hasCourseAccess, hasProductAccess } from "../../services/access";
import {
  DEFAULT_DRIP_SETTINGS,
  describeUnlock,
  parseReleaseTime,
  resolveDripState,
  type DripSettings,
} from "../../services/drip";
import {
  DOWNLOAD_TTL_SECONDS,
  signDownload,
  type DownloadFileKind,
} from "../../services/signedUrls";

/**
 * `/api/member/downloads` — every file the member has paid for.
 *
 * Two kinds of file end up here. A `download` product's files are the whole
 * deliverable (the Practice Protection Pack), and a lesson's attachments are the
 * workbook beside a video. They are listed together because that is how a
 * customer thinks about it, and checked separately because they are entitled
 * through different routes: a product grant for the first, course access plus the
 * lesson's drip schedule for the second.
 *
 * Nothing here ever returns a storage path. A file is delivered only through a
 * signed token minted for one member, and the entitlement is re-checked when
 * that token is redeemed — see routes/public/verify.ts.
 */
export const memberDownloadsRouter = Router();

/** Postgres int4 ceiling. An id it cannot hold is a 404, not a failed query. */
const MAX_INT4 = 2_147_483_647;

const NOT_FOUND = "We couldn't find that file.";

/* ----------------------------------------------------------------- limiters */

const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

/**
 * Minting is cheap, but each call hands out a working credential, so the ceiling
 * is set where a person clicking through a course could never reach it and a
 * script harvesting every file in the catalogue would.
 */
const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many download requests. Please try again in a few minutes." },
  keyGenerator: byMember,
});

/* ------------------------------------------------------------------ helpers */

/** requireMember has already run; this keeps the guarantee in the type system too. */
function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

const kindSchema = z.enum(["product", "lesson"]);

const fileParamsSchema = z.object({
  kind: kindSchema,
  id: z.coerce.number().int().positive().max(MAX_INT4),
});

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** size_bytes is BIGINT, which pg returns as a string rather than lose precision. */
function bigintToNumber(value: string | number | null): number {
  const parsed = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** "2.4 MB" — the figure that tells someone whether to download it on mobile data. */
function sizeLabel(bytes: number): string {
  if (bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The site-wide release schedule.
 *
 * `settings` is free-form JSONB the owner edits herself, so every field is
 * checked and anything unusable falls back to the default rather than throwing —
 * a mistyped timezone would otherwise make Intl throw and turn the whole
 * downloads page into a 500.
 */
async function readDripSettings(): Promise<DripSettings> {
  const found = await pool.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = 'drip'`
  );
  const value = found.rows[0]?.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_DRIP_SETTINGS;
  }

  const record = value as Record<string, unknown>;
  const timezone = typeof record.timezone === "string" ? record.timezone.trim() : "";

  return {
    releaseMinute:
      typeof record.releaseTime === "string"
        ? parseReleaseTime(record.releaseTime)
        : DEFAULT_DRIP_SETTINGS.releaseMinute,
    timezone:
      timezone !== "" && isKnownTimezone(timezone) ? timezone : DEFAULT_DRIP_SETTINGS.timezone,
  };
}

/**
 * The courses a member owns, with the instant the drip schedule counts from.
 *
 * Entitlement itself is decided by services/access.ts; this reads the timestamp
 * that entitlement carries. MIN() matters when two products reach the same
 * course — a bundle bought last year and the course bought again last week —
 * because the earliest grant is the one the member has been waiting since, and
 * taking the later one would re-lock lessons they already had.
 */
const OWNED_COURSES = `
  SELECT p.course_id AS course_id, MIN(g.granted_at) AS granted_at
    FROM access_grants g
    JOIN products p ON p.id = g.product_id
   WHERE g.member_id = $1 AND g.status = 'active'
     AND (g.expires_at IS NULL OR g.expires_at > now())
     AND p.status <> 'archived' AND p.course_id IS NOT NULL
   GROUP BY p.course_id`;

async function dripAnchor(memberId: number, courseId: number): Promise<Date | null> {
  const found = await pool.query<{ granted_at: Date }>(
    `SELECT granted_at FROM (${OWNED_COURSES}) owned WHERE course_id = $2`,
    [memberId, courseId]
  );
  return found.rows[0]?.granted_at ?? null;
}

/* -------------------------------------------------------------- entitlement */

export interface EntitledFile {
  kind: DownloadFileKind;
  id: number;
  /** Relative to the upload root. Never leaves the server. */
  storagePath: string;
  filename: string;
  mime: string;
  title: string;
  sizeBytes: number;
}

interface FileRow {
  id: number;
  storage_path: string;
  filename: string;
  mime: string;
  title: string;
  size_bytes: string | number | null;
}

interface LessonFileRow extends FileRow {
  lesson_id: number;
  course_id: number;
  published: boolean;
  lesson_drip_days: number | null;
  lesson_drip_date: Date | null;
  module_drip_days: number | null;
  module_drip_date: Date | null;
}

function toEntitledFile(kind: DownloadFileKind, row: FileRow): EntitledFile {
  return {
    kind,
    id: row.id,
    storagePath: row.storage_path,
    filename: row.filename,
    mime: row.mime,
    title: row.title,
    sizeBytes: bigintToNumber(row.size_bytes),
  };
}

/**
 * The file behind a (kind, id), if this member may have it right now.
 *
 * Shared by the two routes that need the answer: minting a link, and redeeming
 * one. Both ask the same question, because fifteen minutes is long enough for a
 * refund to be processed and access to be revoked between the two.
 *
 * Everything it refuses is a 404. Ids are sequential, so a 403 on a file
 * belonging to somebody else would confirm the file exists and roughly how many
 * of them there are; a signed-in member with no grant gets exactly the answer a
 * stranger gets.
 */
export async function loadEntitledFile(
  memberId: number,
  kind: DownloadFileKind,
  fileId: number
): Promise<EntitledFile> {
  if (kind === "product") {
    const found = await pool.query<FileRow & { product_id: number }>(
      `SELECT pf.id, pf.product_id, pf.storage_path, pf.filename, pf.mime, pf.title, pf.size_bytes
         FROM product_files pf
         JOIN products p ON p.id = pf.product_id
        WHERE pf.id = $1 AND p.status <> 'archived'`,
      [fileId]
    );
    const row = found.rows[0];
    if (!row) throw notFound(NOT_FOUND);
    if (!(await hasProductAccess(memberId, row.product_id))) throw notFound(NOT_FOUND);
    return toEntitledFile("product", row);
  }

  const found = await pool.query<LessonFileRow>(
    `SELECT lf.id, lf.storage_path, lf.filename, lf.mime, lf.title, lf.size_bytes,
            l.id AS lesson_id, l.published,
            l.drip_days AS lesson_drip_days, l.drip_date AS lesson_drip_date,
            m.drip_days AS module_drip_days, m.drip_date AS module_drip_date,
            m.course_id
       FROM lesson_files lf
       JOIN course_lessons l ON l.id = lf.lesson_id
       JOIN course_modules m ON m.id = l.module_id
      WHERE lf.id = $1`,
    [fileId]
  );
  const row = found.rows[0];
  if (!row || !row.published) throw notFound(NOT_FOUND);
  if (!(await hasCourseAccess(memberId, row.course_id))) throw notFound(NOT_FOUND);

  const grantedAt = await dripAnchor(memberId, row.course_id);
  if (grantedAt === null) throw notFound(NOT_FOUND);

  const settings = await readDripSettings();
  const state = resolveDripState({
    lesson: { dripDays: row.lesson_drip_days, dripDate: row.lesson_drip_date },
    module: { dripDays: row.module_drip_days, dripDate: row.module_drip_date },
    grantedAt,
    now: new Date(),
    settings,
  });

  // An undripped lesson's workbook is content that has not been released yet, so
  // it is refused here rather than filtered out in the client. The unlock date is
  // the one thing the member is told, which is what the player shows too.
  if (!state.unlocked && state.unlocksAt) {
    throw notFound(`That file unlocks on ${describeUnlock(state.unlocksAt, settings.timezone)}.`);
  }

  return toEntitledFile("lesson", row);
}

/* ---------------------------------------------------------------- listing -- */

interface DownloadItem {
  kind: DownloadFileKind;
  id: number;
  title: string;
  description: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sizeLabel: string;
  /** false only for a lesson attachment that has not dripped yet. */
  available: boolean;
  unlocksAt: string | null;
  unlockLabel: string | null;
  /** Where to POST for a signed link. null while the file is still locked. */
  linkUrl: string | null;
  productId: number | null;
  productTitle: string;
  productSlug: string;
  courseId: number | null;
  courseTitle: string;
  lessonId: number | null;
  lessonTitle: string;
  moduleTitle: string;
  downloadCount: number;
  createdAt: string;
}

interface ProductFileListRow extends FileRow {
  description: string;
  download_count: number;
  created_at: Date;
  product_id: number;
  product_title: string;
  product_slug: string;
}

interface LessonFileListRow extends FileRow {
  created_at: Date;
  lesson_id: number;
  lesson_title: string;
  lesson_drip_days: number | null;
  lesson_drip_date: Date | null;
  module_title: string;
  module_drip_days: number | null;
  module_drip_date: Date | null;
  course_id: number;
  course_title: string;
  granted_at: Date;
}

function linkPath(kind: DownloadFileKind, id: number): string {
  return `/api/member/downloads/${kind}/${id}/link`;
}

/**
 * GET /api/member/downloads
 *
 * Both queries constrain on `member_id` inside the join rather than filtering
 * afterwards, so a file belonging to a product the member does not own is never
 * read in the first place.
 */
memberDownloadsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const [products, lessons, settings] = await Promise.all([
      pool.query<ProductFileListRow>(
        `SELECT pf.id, pf.title, pf.description, pf.storage_path, pf.filename, pf.mime,
                pf.size_bytes, pf.download_count, pf.created_at,
                p.id AS product_id, p.title AS product_title, p.slug AS product_slug
           FROM product_files pf
           JOIN products p      ON p.id = pf.product_id
           JOIN access_grants g ON g.product_id = p.id AND g.member_id = $1
          WHERE g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > now())
            AND p.status <> 'archived'
          ORDER BY p.title, pf.sort, pf.id`,
        [member.id]
      ),
      pool.query<LessonFileListRow>(
        `WITH owned AS (${OWNED_COURSES})
         SELECT lf.id, lf.title, lf.storage_path, lf.filename, lf.mime, lf.size_bytes,
                lf.created_at,
                l.id AS lesson_id, l.title AS lesson_title,
                l.drip_days AS lesson_drip_days, l.drip_date AS lesson_drip_date,
                m.title AS module_title,
                m.drip_days AS module_drip_days, m.drip_date AS module_drip_date,
                c.id AS course_id, c.title AS course_title, owned.granted_at
           FROM lesson_files lf
           JOIN course_lessons l ON l.id = lf.lesson_id
           JOIN course_modules m ON m.id = l.module_id
           JOIN courses c        ON c.id = m.course_id
           JOIN owned            ON owned.course_id = c.id
          WHERE l.published
          ORDER BY c.title, m.sort, l.sort, lf.sort, lf.id`,
        [member.id]
      ),
      readDripSettings(),
    ]);

    const now = new Date();

    const productItems: DownloadItem[] = products.rows.map((row) => {
      const sizeBytes = bigintToNumber(row.size_bytes);
      return {
        kind: "product",
        id: row.id,
        title: row.title || row.filename || "Download",
        description: row.description,
        filename: row.filename,
        mime: row.mime,
        sizeBytes,
        sizeLabel: sizeLabel(sizeBytes),
        available: true,
        unlocksAt: null,
        unlockLabel: null,
        linkUrl: linkPath("product", row.id),
        productId: row.product_id,
        productTitle: row.product_title,
        productSlug: row.product_slug,
        courseId: null,
        courseTitle: "",
        lessonId: null,
        lessonTitle: "",
        moduleTitle: "",
        downloadCount: row.download_count,
        createdAt: iso(row.created_at) ?? "",
      };
    });

    const lessonItems: DownloadItem[] = lessons.rows.map((row) => {
      const state = resolveDripState({
        lesson: { dripDays: row.lesson_drip_days, dripDate: row.lesson_drip_date },
        module: { dripDays: row.module_drip_days, dripDate: row.module_drip_date },
        grantedAt: row.granted_at,
        now,
        settings,
      });
      const sizeBytes = bigintToNumber(row.size_bytes);

      // A locked attachment keeps its title and gains an unlock date. That is
      // everything the player shows for a locked lesson, and no more.
      return {
        kind: "lesson",
        id: row.id,
        title: row.title || row.filename || "Download",
        description: "",
        filename: row.filename,
        mime: row.mime,
        sizeBytes,
        sizeLabel: sizeLabel(sizeBytes),
        available: state.unlocked,
        unlocksAt: state.unlocksAt === null ? null : state.unlocksAt.toISOString(),
        unlockLabel:
          state.unlocksAt === null ? null : describeUnlock(state.unlocksAt, settings.timezone),
        linkUrl: state.unlocked ? linkPath("lesson", row.id) : null,
        productId: null,
        productTitle: "",
        productSlug: "",
        courseId: row.course_id,
        courseTitle: row.course_title,
        lessonId: row.lesson_id,
        lessonTitle: row.lesson_title,
        moduleTitle: row.module_title,
        downloadCount: 0,
        createdAt: iso(row.created_at) ?? "",
      };
    });

    const files = [...productItems, ...lessonItems];

    res.json({
      files,
      total: files.length,
      availableCount: files.filter((file) => file.available).length,
      linkTtlSeconds: DOWNLOAD_TTL_SECONDS,
    });
  })
);

/**
 * POST /api/member/downloads/:kind/:id/link
 *
 * denyImpersonation, even though nothing is written here: redeeming the token
 * writes a download_events row attributed to the customer, and that log exists so
 * that when a paid PDF turns up in a Facebook group there is an answer to "who
 * downloaded it". A row naming a member for a download an admin made would
 * destroy the only thing the log is for.
 */
memberDownloadsRouter.post(
  "/:kind/:id/link",
  denyImpersonation,
  linkLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const parsed = fileParamsSchema.safeParse(req.params);
    if (!parsed.success) throw notFound(NOT_FOUND);
    const { kind, id } = parsed.data;

    const file = await loadEntitledFile(member.id, kind, id);
    const { token, expiresAt } = signDownload({ kind, fileId: file.id, memberId: member.id });

    res.json({
      // Relative on purpose: the link is for this member's browser on this
      // origin, and an absolute URL is the shape that ends up pasted elsewhere.
      url: `/api/files/${token}`,
      filename: file.filename,
      title: file.title,
      sizeBytes: file.sizeBytes,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    });
  })
);
