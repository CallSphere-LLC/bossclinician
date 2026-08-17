import crypto from "crypto";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import type { EmailContent } from "../email/memberTemplates";
import { hasCourseAccess } from "./access";
import { resolveStoredFile, uploadPath } from "./signedUrls";

/**
 * CEU certificates.
 *
 * This is not a decorative PDF. Yvette's customers are licensed therapists who
 * file these with a licensing board, so the credit hours and the provider number
 * on the page are the whole point of the document: a certificate that says 1.5
 * hours when the course was approved for 2, or that omits the provider number,
 * is a compliance problem for the person who relied on it — and they only find
 * out at renewal, months later, when it is refused.
 *
 * Two consequences run through this file. Credit is stored and rendered from
 * `ceu_credit_quarter_hours`, an integer, because "1.5 hours" as a float in a
 * compliance record is a rounding dispute waiting to happen. And the numbers are
 * snapshotted onto the certificate row at issue time, so re-downloading a
 * certificate from 2024 renders the 2024 credit hours even if the course has
 * since been re-approved for a different number.
 */

/** Where certificate PDFs live, relative to the upload root. */
const CERTIFICATE_DIR = "certificates";

export const CERTIFICATE_COLUMNS = `id, template_id, member_id, product_id, course_id,
       verification_code, recipient_name, course_title, ceu_credit_quarter_hours,
       ceu_provider_number, completed_at, issued_at, revoked_at, pdf_path`;

export interface CertificateRow {
  id: number;
  template_id: number | null;
  member_id: number;
  product_id: number | null;
  course_id: number | null;
  verification_code: string;
  recipient_name: string;
  course_title: string;
  ceu_credit_quarter_hours: number;
  ceu_provider_number: string;
  completed_at: Date;
  issued_at: Date;
  revoked_at: Date | null;
  pdf_path: string;
}

interface TemplateRow {
  id: number;
  product_id: number | null;
  title: string;
  body: string;
  signature_image: string;
  signature_name: string;
  signature_title: string;
  logo_url: string;
  ceu_credit_quarter_hours: number;
  ceu_provider_number: string;
  ceu_provider_name: string;
}

/* ------------------------------------------------------- verification codes */

/**
 * Crockford's base32: no I, L, O or U.
 *
 * The code is read off a printed page and typed into a form by a board
 * administrator, so the characters that get misread as each other are simply not
 * in the alphabet, and U is out because removing it removes the accidental words.
 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CODE_PREFIX = "BC";
const CODE_BODY_LENGTH = 16;

function base32(bytes: Buffer): string {
  let value = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CODE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CODE_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function group(body: string): string {
  return `${CODE_PREFIX}-${(body.match(/.{1,4}/g) ?? []).join("-")}`;
}

/**
 * A fresh code: 80 random bits, grouped for legibility.
 *
 * /verify/:code is a public URL with no authentication on it, so the code is the
 * only thing standing between a stranger and confirming a real person completed
 * a real course. A sequential id or a hash of the certificate id would let anyone
 * enumerate every certificate ever issued; 80 bits from randomBytes cannot be
 * walked.
 */
function newVerificationCode(): string {
  return group(base32(crypto.randomBytes(10)));
}

/**
 * The canonical form of whatever somebody typed, or null if it cannot be one.
 *
 * Hyphens, spaces and case are all dropped, and the three characters the
 * alphabet excludes are mapped to what the reader almost certainly meant. This is
 * a code copied off paper: "did they type O or 0" must not be the reason a
 * genuine certificate reads as unverifiable.
 */
export function normalizeVerificationCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

  // The prefix is optional on input: people paste the code with or without it.
  const body = cleaned.startsWith(CODE_PREFIX)
    ? cleaned.slice(CODE_PREFIX.length)
    : cleaned;

  if (body.length !== CODE_BODY_LENGTH) return null;
  for (const char of body) {
    if (!CODE_ALPHABET.includes(char)) return null;
  }
  return group(body);
}

/* ------------------------------------------------------------- credit hours */

/**
 * "1.5 CE hours" from 6 quarter-hours.
 *
 * Exact division by four, with trailing zeros trimmed rather than rounded: 1
 * quarter-hour must render as "0.25 CE hours" and 8 as "2 CE hours". A course
 * with no CE credit returns "" and the credit line is left off the page
 * entirely, because "0 CE hours" on a certificate reads like a mistake.
 */
export function formatCreditHours(quarterHours: number): string {
  if (!Number.isFinite(quarterHours) || quarterHours <= 0) return "";
  const hours = (quarterHours / 4)
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `${hours} ${hours === "1" ? "CE hour" : "CE hours"}`;
}

/* ----------------------------------------------------------------- PDF ----- */

/** US Letter, landscape — the shape a CE certificate gets printed and filed in. */
const PAPER = "LETTER";
const INK = "#1B1626";
const PLUM = "#4B2E83";
const GOLD = "#C9A46A";
const MUTED = "#6B6478";

interface CertificateArtwork {
  title: string;
  body: string;
  signatureName: string;
  signatureTitle: string;
  /** Absolute local paths; null when unset or not resolvable on this disk. */
  signatureImagePath: string | null;
  logoPath: string | null;
  providerName: string;
}

export interface CertificateContent {
  recipientName: string;
  courseTitle: string;
  completedAt: Date;
  verificationCode: string;
  creditQuarterHours: number;
  providerNumber: string;
  artwork: CertificateArtwork;
}

function longDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * Renders the certificate.
 *
 * Laid out with explicit coordinates rather than the flowing cursor, and every
 * variable-length string is capped, so a 300-character course title cannot push
 * the signature onto a second page — a two-page certificate is one somebody
 * prints and files without the half that has the credit hours on it.
 *
 * Only the built-in PDF fonts are used, so there is no font file to ship or to
 * go missing in a container image.
 */
export async function renderCertificatePdf(content: CertificateContent): Promise<Buffer> {
  const doc = new PDFDocument({
    size: PAPER,
    layout: "landscape",
    margin: 0,
    info: {
      Title: `${content.artwork.title} — ${content.courseTitle}`,
      Author: content.artwork.providerName || "Boss Clinician",
      Subject: `Certificate ${content.verificationCode}`,
    },
  });

  // Read back rather than assumed: pdfkit swaps the page dimensions for a
  // landscape layout, and every coordinate below is measured from these.
  const width = doc.page.width;
  const height = doc.page.height;
  const inner = { x: 64, width: width - 128 };
  const centered = { width: inner.width, align: "center" as const };

  doc.rect(0, 0, width, height).fill("#FFFFFF");
  doc.lineWidth(3).strokeColor(GOLD).rect(24, 24, width - 48, height - 48).stroke();
  doc.lineWidth(0.75).strokeColor(PLUM).rect(34, 34, width - 68, height - 68).stroke();

  let y = 56;

  if (content.artwork.logoPath) {
    // fit, not width: a logo of unknown aspect ratio must not grow taller than
    // its slot and shunt everything below it down the page.
    doc.image(content.artwork.logoPath, inner.x, y, { fit: [150, 48], align: "center" });
    y += 62;
  } else {
    y += 18;
  }

  doc
    .font("Times-Bold")
    .fontSize(28)
    .fillColor(PLUM)
    .text(content.artwork.title.slice(0, 80), inner.x, y, { ...centered, characterSpacing: 1 });
  y += 44;

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MUTED)
    .text("THIS CERTIFIES THAT", inner.x, y, { ...centered, characterSpacing: 2.4 });
  y += 26;

  doc
    .font("Times-Bold")
    .fontSize(34)
    .fillColor(INK)
    .text(content.recipientName.slice(0, 90), inner.x, y, centered);
  y += 46;

  doc
    .lineWidth(1)
    .strokeColor(GOLD)
    .moveTo(width / 2 - 90, y)
    .lineTo(width / 2 + 90, y)
    .stroke();
  y += 18;

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MUTED)
    .text("HAS SUCCESSFULLY COMPLETED", inner.x, y, { ...centered, characterSpacing: 2.4 });
  y += 24;

  const courseTitle = content.courseTitle.slice(0, 160);
  doc.font("Times-Bold").fontSize(20).fillColor(PLUM);
  const courseHeight = doc.heightOfString(courseTitle, centered);
  doc.text(courseTitle, inner.x, y, centered);
  y += courseHeight + 12;

  const body = content.artwork.body.trim().slice(0, 320);
  if (body !== "") {
    doc.font("Helvetica").fontSize(10.5).fillColor(MUTED);
    const bodyOptions = { width: 520, align: "center" as const };
    const bodyHeight = doc.heightOfString(body, bodyOptions);
    doc.text(body, (width - 520) / 2, y, bodyOptions);
    y += bodyHeight + 12;
  }

  const creditLabel = formatCreditHours(content.creditQuarterHours);
  if (creditLabel !== "") {
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(INK)
      .text(creditLabel, inner.x, y, centered);
    y += 20;

    // The provider number sits directly under the hours because that pairing is
    // what a licensing board checks: hours claimed, and who was approved to give
    // them. Rendered verbatim from the stored value, never reformatted.
    const provider = [
      content.providerNumber ? `Provider #${content.providerNumber}` : "",
      content.artwork.providerName,
    ]
      .filter((part) => part !== "")
      .join("  ·  ");
    if (provider !== "") {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(MUTED)
        .text(provider.slice(0, 160), inner.x, y, centered);
    }
  }

  /* The bottom band is anchored to the page, not to the flow above it. */
  const bandY = height - 150;

  if (content.artwork.signatureImagePath) {
    doc.image(content.artwork.signatureImagePath, 96, bandY - 6, {
      fit: [170, 46],
      align: "center",
    });
  }
  doc
    .lineWidth(0.75)
    .strokeColor("#D8D3E0")
    .moveTo(96, bandY + 46)
    .lineTo(266, bandY + 46)
    .stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(INK)
    .text(content.artwork.signatureName.slice(0, 60) || "Boss Clinician", 96, bandY + 54, {
      width: 170,
    });
  if (content.artwork.signatureTitle !== "") {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(MUTED)
      .text(content.artwork.signatureTitle.slice(0, 80), 96, bandY + 68, { width: 170 });
  }

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(MUTED)
    .text("COMPLETED", width - 266, bandY + 30, {
      width: 170,
      align: "right",
      characterSpacing: 1.6,
    });
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(INK)
    .text(longDate(content.completedAt), width - 266, bandY + 44, { width: 170, align: "right" });

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      `Verify at ${env.publicSiteUrl.replace(/^https?:\/\//, "")}/verify/${content.verificationCode}`,
      inner.x,
      height - 68,
      { ...centered, characterSpacing: 0.4 }
    );
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(INK)
    .text(content.verificationCode, inner.x, height - 56, { ...centered, characterSpacing: 1.2 });

  return pdfToBuffer(doc);
}

/* --------------------------------------------------------------- rendering  */

/**
 * An image the renderer can actually draw.
 *
 * signature_image and logo_url are whatever an admin pasted, which may be an
 * absolute URL on another host. Nothing is fetched over the network here: this
 * runs inside a request, and a slow CDN would turn a certificate download into a
 * timeout. Anything not on our own disk is simply left off the page.
 */
async function localImage(value: string): Promise<string | null> {
  if (value.trim() === "") return null;
  if (/^https?:\/\//i.test(value)) {
    // Our own uploads served through the public origin are still local files.
    const prefix = `${env.publicSiteUrl}/uploads/`;
    if (!value.startsWith(prefix)) return null;
    return resolveStoredFile(value.slice(prefix.length));
  }
  return resolveStoredFile(value);
}

async function artworkFor(template: TemplateRow | null): Promise<CertificateArtwork> {
  if (!template) {
    return {
      title: "Certificate of Completion",
      body: "",
      signatureName: "",
      signatureTitle: "",
      signatureImagePath: null,
      logoPath: null,
      providerName: "",
    };
  }

  const [signatureImagePath, logoPath] = await Promise.all([
    localImage(template.signature_image),
    localImage(template.logo_url),
  ]);

  return {
    title: template.title || "Certificate of Completion",
    body: template.body,
    signatureName: template.signature_name,
    signatureTitle: template.signature_title,
    signatureImagePath,
    logoPath,
    providerName: template.ceu_provider_name,
  };
}

/**
 * The template a completed course issues from.
 *
 * A template can be attached to the course or to the product that sells it; the
 * course-level one wins when both exist, being the more specific answer to "what
 * does a certificate for this course look like".
 *
 * `issue_on` is pinned to 'completion' here. An 'assessment' template waits for a
 * passing score and a 'manual' one waits for Yvette, and finishing the lessons is
 * not either of those things.
 */
async function loadCompletionTemplate(courseId: number): Promise<TemplateRow | null> {
  const found = await pool.query<TemplateRow>(
    `SELECT t.id, t.product_id, t.title, t.body, t.signature_image, t.signature_name,
            t.signature_title, t.logo_url, t.ceu_credit_quarter_hours,
            t.ceu_provider_number, t.ceu_provider_name
       FROM certificate_templates t
       LEFT JOIN products p ON p.id = t.product_id
      WHERE t.enabled
        AND t.issue_on = 'completion'
        AND (t.course_id = $1 OR p.course_id = $1)
      ORDER BY (t.course_id = $1) DESC, t.id
      LIMIT 1`,
    [courseId]
  );
  return found.rows[0] ?? null;
}

async function loadTemplateById(templateId: number): Promise<TemplateRow | null> {
  const found = await pool.query<TemplateRow>(
    `SELECT id, product_id, title, body, signature_image, signature_name, signature_title,
            logo_url, ceu_credit_quarter_hours, ceu_provider_number, ceu_provider_name
       FROM certificate_templates WHERE id = $1`,
    [templateId]
  );
  return found.rows[0] ?? null;
}

/** A filename the recipient will recognise a year later in their downloads folder. */
function certificateFilename(row: CertificateRow): string {
  const slug = row.course_title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "course"}-certificate.pdf`;
}

/** Renders, stores and records the PDF, updating `row.pdf_path` in place. */
async function writeCertificatePdf(row: CertificateRow): Promise<string> {
  const template = row.template_id === null ? null : await loadTemplateById(row.template_id);

  const pdf = await renderCertificatePdf({
    recipientName: row.recipient_name,
    courseTitle: row.course_title,
    completedAt: row.completed_at,
    verificationCode: row.verification_code,
    // From the certificate row, not the template: this is the compliance record,
    // and it has to keep saying what it said on the day it was issued.
    creditQuarterHours: row.ceu_credit_quarter_hours,
    providerNumber: row.ceu_provider_number,
    artwork: await artworkFor(template),
  });

  // Named for the verification code rather than the certificate id: the upload
  // directory is served as static files, so a predictable name would let anyone
  // walk /uploads/certificates/1.pdf upwards and collect other people's
  // certificates. 80 random bits cannot be walked.
  const relative = path.posix.join(CERTIFICATE_DIR, `${row.verification_code}.pdf`);
  const absolute = uploadPath(relative);
  if (absolute === null) throw new Error("Certificate path escaped the upload directory");

  await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
  await fs.promises.writeFile(absolute, pdf);

  await pool.query(`UPDATE certificates SET pdf_path = $2 WHERE id = $1`, [row.id, relative]);
  row.pdf_path = relative;
  return absolute;
}

/**
 * The PDF on disk, rendering it first if it is not there.
 *
 * Re-rendering rather than 500ing covers the two cases that actually happen: a
 * container rebuilt without the uploads volume, and a certificate issued while
 * the disk was full. The stored row is the record; the file is a cache of it.
 */
export async function certificateFile(
  row: CertificateRow
): Promise<{ absolutePath: string; filename: string }> {
  const existing = row.pdf_path === "" ? null : await resolveStoredFile(row.pdf_path);
  const absolutePath = existing ?? (await writeCertificatePdf(row));
  return { absolutePath, filename: certificateFilename(row) };
}

/* ------------------------------------------------------------------ issuing */

interface MemberRow {
  email: string;
  first_name: string;
  last_name: string;
  name: string;
}

/**
 * The name that goes on the certificate.
 *
 * A licensing board matches it against a licence, so the profile's own first and
 * last name are used in full and nothing is abbreviated. The email local part is
 * the last resort: a certificate reading "jhoward" is wrong, but it is at least
 * traceable, and it tells the member to go and fill in their name.
 */
function recipientName(member: MemberRow): string {
  const full = [member.first_name.trim(), member.last_name.trim()]
    .filter((part) => part !== "")
    .join(" ");
  return full || member.name.trim() || member.email.split("@")[0] || "Member";
}

function certificateEmail(input: {
  firstName: string;
  courseTitle: string;
  creditLabel: string;
  verificationCode: string;
}): EmailContent {
  const name = input.firstName.trim() || "there";
  const certificatesUrl = `${env.publicSiteUrl}/account/certificates`;
  const verifyUrl = `${env.publicSiteUrl}/verify/${input.verificationCode}`;
  const credit = input.creditLabel === "" ? "" : ` It's worth ${input.creditLabel}.`;

  const text = [
    `Hi ${name},`,
    ``,
    `You finished ${input.courseTitle} — congratulations. Your certificate is ready to download:`,
    ``,
    certificatesUrl,
    ``,
    `${input.creditLabel === "" ? "" : `${input.creditLabel}. `}Certificate number ${input.verificationCode}.`,
    `If your board wants to check it, they can do that here without needing an account: ${verifyUrl}`,
    ``,
    `— Yvette`,
  ].join("\n");

  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>You finished ${escapeHtml(input.courseTitle)} — congratulations.${escapeHtml(credit)}</p>`,
    `<p><a href="${escapeHtml(certificatesUrl)}">Download your certificate</a></p>`,
    `<p>Certificate number <strong>${escapeHtml(input.verificationCode)}</strong>. If your board wants to check it, they can <a href="${escapeHtml(verifyUrl)}">verify it here</a> without needing an account.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");

  return { subject: `Your certificate for ${input.courseTitle}`, text, html };
}

/**
 * Issues the certificate for a finished course, or returns null.
 *
 * Called from wherever progress is written, and safe to call on every lesson
 * completion: it is a no-op until the rollup reaches 100, and idempotent
 * afterwards. Idempotency rests on the UNIQUE (member_id, course_id) constraint
 * rather than on the read that precedes it — two lessons completed in the same
 * second are two concurrent transactions, and the loser of that race must get
 * the winner's certificate back, not a second one and not an error.
 */
export async function issueCertificateIfEarned(
  memberId: number,
  courseId: number
): Promise<CertificateRow | null> {
  const existing = await pool.query<CertificateRow>(
    `SELECT ${CERTIFICATE_COLUMNS} FROM certificates WHERE member_id = $1 AND course_id = $2`,
    [memberId, courseId]
  );
  if (existing.rows[0]) return existing.rows[0];

  // Entitlement, not just completion: a course whose access was clawed back with
  // a refund must not mint a fresh certificate afterwards.
  if (!(await hasCourseAccess(memberId, courseId))) return null;

  const progress = await pool.query<{ percent: number; completed_at: Date | null }>(
    `SELECT percent, completed_at FROM course_progress WHERE member_id = $1 AND course_id = $2`,
    [memberId, courseId]
  );
  const earned = progress.rows[0];
  if (!earned || earned.percent < 100) return null;

  const template = await loadCompletionTemplate(courseId);
  if (!template) return null;

  const found = await pool.query<MemberRow & { course_title: string }>(
    `SELECT m.email, m.first_name, m.last_name, m.name, c.title AS course_title
       FROM members m
       CROSS JOIN courses c
      WHERE m.id = $1 AND c.id = $2`,
    [memberId, courseId]
  );
  const who = found.rows[0];
  if (!who) return null;

  const inserted = await pool.query<CertificateRow>(
    `INSERT INTO certificates
       (template_id, member_id, product_id, course_id, verification_code, recipient_name,
        course_title, ceu_credit_quarter_hours, ceu_provider_number, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (member_id, course_id) DO NOTHING
     RETURNING ${CERTIFICATE_COLUMNS}`,
    [
      template.id,
      memberId,
      template.product_id,
      courseId,
      newVerificationCode(),
      recipientName(who),
      who.course_title,
      template.ceu_credit_quarter_hours,
      template.ceu_provider_number,
      earned.completed_at ?? new Date(),
    ]
  );

  const row = inserted.rows[0];
  if (!row) {
    // Lost the race. The winner is sending the email; hand back their row.
    const winner = await pool.query<CertificateRow>(
      `SELECT ${CERTIFICATE_COLUMNS} FROM certificates WHERE member_id = $1 AND course_id = $2`,
      [memberId, courseId]
    );
    return winner.rows[0] ?? null;
  }

  // The row is the certificate; the PDF and the email are consequences of it.
  // Neither failing should undo an earned certificate, so both are allowed to
  // fail loudly in the log and quietly to the caller — /certificates/:id/download
  // re-renders on demand.
  try {
    await writeCertificatePdf(row);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[certificates] render failed for certificate ${row.id}:`, err);
  }

  await sendMail({
    to: who.email,
    ...certificateEmail({
      firstName: who.first_name || who.name,
      courseTitle: row.course_title,
      creditLabel: formatCreditHours(row.ceu_credit_quarter_hours),
      verificationCode: row.verification_code,
    }),
  });

  return row;
}
