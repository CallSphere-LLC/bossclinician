import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation, type AuthedMember } from "../../middleware/memberAuth";
import { hasCourseAccess } from "../../services/access";
import {
  CERTIFICATE_COLUMNS,
  certificateFile,
  formatCreditHours,
  issueCertificateIfEarned,
  type CertificateRow,
} from "../../services/certificates";

/**
 * `/api/member/certificates` — the CEU record a therapist files with their board.
 *
 * The figures are read straight off the certificate row, never recomputed from
 * the template: a certificate is a statement about a course as it was approved on
 * the day it was completed, and re-deriving the credit hours now would silently
 * rewrite history for anyone who finished before the course changed.
 */
export const memberCertificatesRouter = Router();

const MAX_INT4 = 2_147_483_647;

const NOT_FOUND = "We couldn't find that certificate.";

const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

/** Claiming renders a PDF and can send an email, so it is capped well below that. */
const claimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a few minutes." },
  keyGenerator: byMember,
});

function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive().max(MAX_INT4),
});

const claimSchema = z.object({
  courseId: z.coerce.number().int().positive().max(MAX_INT4),
});

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

interface CertificateJson {
  id: number;
  courseId: number | null;
  courseSlug: string | null;
  courseTitle: string;
  recipientName: string;
  verificationCode: string;
  /** The public page a licensing board can open without an account. */
  verifyUrl: string;
  downloadUrl: string;
  creditQuarterHours: number;
  /** "1.5 CE hours", or "" for a course that carries no CE credit. */
  creditHours: string;
  providerNumber: string;
  completedAt: string;
  issuedAt: string;
  revoked: boolean;
  revokedAt: string | null;
}

function toCertificateJson(row: CertificateRow, courseSlug: string | null): CertificateJson {
  return {
    id: row.id,
    courseId: row.course_id,
    courseSlug,
    courseTitle: row.course_title,
    recipientName: row.recipient_name,
    verificationCode: row.verification_code,
    verifyUrl: `/verify/${row.verification_code}`,
    downloadUrl: `/api/member/certificates/${row.id}/download`,
    creditQuarterHours: row.ceu_credit_quarter_hours,
    creditHours: formatCreditHours(row.ceu_credit_quarter_hours),
    providerNumber: row.ceu_provider_number,
    completedAt: row.completed_at.toISOString(),
    issuedAt: row.issued_at.toISOString(),
    revoked: row.revoked_at !== null,
    revokedAt: iso(row.revoked_at),
  };
}

/**
 * The slug is fetched as a scalar subquery rather than a join so
 * CERTIFICATE_COLUMNS stays unambiguous and the row shape matches the service's.
 */
const CERTIFICATE_SELECT = `
  SELECT ${CERTIFICATE_COLUMNS},
         (SELECT c.slug FROM courses c WHERE c.id = certificates.course_id) AS course_slug
    FROM certificates
   WHERE member_id = $1`;

/** GET /api/member/certificates */
memberCertificatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const found = await pool.query<CertificateRow & { course_slug: string | null }>(
      `${CERTIFICATE_SELECT} ORDER BY issued_at DESC, id DESC`,
      [member.id]
    );

    res.json({
      certificates: found.rows.map((row) => toCertificateJson(row, row.course_slug)),
    });
  })
);

/**
 * GET /api/member/certificates/:id/download
 *
 * `member_id` is in the WHERE clause, so somebody else's certificate is a 404
 * rather than a 403 — a certificate names a person and the course they took, and
 * confirming one exists is already more than a stranger should learn.
 */
memberCertificatesRouter.get(
  "/:id/download",
  asyncHandler(async (req, res, next) => {
    const member = currentMember(req);

    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) throw notFound(NOT_FOUND);

    const found = await pool.query<CertificateRow>(
      `SELECT ${CERTIFICATE_COLUMNS} FROM certificates WHERE id = $2 AND member_id = $1`,
      [member.id, parsed.data.id]
    );
    const row = found.rows[0];
    if (!row) throw notFound(NOT_FOUND);

    // A revoked certificate is refused rather than watermarked. It exists and it
    // is theirs, hence 403 and not 404 — but handing over a PDF that claims CE
    // credit which has been withdrawn is the failure that lands on the therapist
    // at licence renewal.
    if (row.revoked_at !== null) {
      throw forbidden(
        "That certificate has been withdrawn. Please get in touch if you think that's a mistake."
      );
    }

    const { absolutePath, filename } = await certificateFile(row);

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(absolutePath, filename, (err) => {
      // Nothing can be said to the client once bytes are on the wire; before
      // that, a missing file is still a reportable error.
      if (err && !res.headersSent) next(err);
    });
  })
);

/**
 * POST /api/member/certificates/claim
 *
 * Issuing normally happens the moment progress reaches 100%. This is the door
 * back in when it did not: a course completed before its template existed, or a
 * progress write that landed while the mailer was down. Idempotent — an already
 * issued certificate is returned unchanged, with no second email.
 */
memberCertificatesRouter.post(
  "/claim",
  denyImpersonation,
  claimLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Which course?", parsed.error.flatten());
    const { courseId } = parsed.data;

    if (!(await hasCourseAccess(member.id, courseId))) throw notFound(NOT_FOUND);

    const row = await issueCertificateIfEarned(member.id, courseId);
    if (!row) {
      res.json({
        certificate: null,
        message: "Finish every lesson in the course and your certificate will appear here.",
      });
      return;
    }

    const slug = await pool.query<{ slug: string }>(`SELECT slug FROM courses WHERE id = $1`, [
      courseId,
    ]);

    res.json({
      certificate: toCertificateJson(row, slug.rows[0]?.slug ?? null),
      message: "Your certificate is ready.",
    });
  })
);
