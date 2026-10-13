import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation } from "../../middleware/memberAuth";
import { leadsLimiter } from "../../middleware/rateLimit";
import {
  FILE_TYPE,
  answerProblem,
  asFields,
  keptAnswers,
  visibleQuestionKeys,
} from "../../services/formLogic";
import { receiveFormFiles, type StagedFile } from "../../services/formUploads";
import { recordActivity, upsertContactWithStatus } from "../../services/contacts";
import { publishDomainEvent } from "../../services/domainEvents";
import { wantsReplyEmail } from "../../services/formNotifications";
import { cleanFormSlug, loadLessonFormForMember } from "../../services/lessonForms";
import {
  afterSubmission,
  formUploadFormLimiter,
  formUploadIpLimiter,
  isMultipart,
  multipartPayload,
  notifyOwnerOfReply,
  storeSubmission,
} from "../public/growthPublic";

/**
 * Forms inside a lesson, for the signed-in member — mounted on the member
 * surface (requireMember is applied by routes/member/index.ts).
 *
 *   GET  /lesson-forms/:slug         the questions, who they're answering as,
 *                                    and when they last sent this form
 *   POST /lesson-forms/:slug/submit  one reply (JSON, or multipart with files)
 *
 * The reply lands in the same `form_submissions` table, through the same store
 * (files and all), as a reply on the public site, so the owner reads it in
 * Admin → Forms like any other. What differs is who it is from: never what the
 * page says, always the account. The name and address are filled from the
 * member row and the reply is filed against their contact — the owner asked
 * for "a form link I can receive from each individual student", and a Jotform
 * reply carried nothing tying it to one.
 *
 * Deliberately not done here, because a member answering a course worksheet is
 * not a new enquiry: no lead row, no form tags, no sequence enrolment. The
 * `form_submitted` event still fires, so an automation can react to it.
 * A member may send the same form as often as they like (it is a monthly
 * request); each send is its own reply.
 */
export const memberLessonFormsRouter = Router();

/** What the page shows the member as "you": never an editable box. */
interface MemberIdentity {
  name: string;
  email: string;
  contactId: number | null;
}

async function loadIdentity(memberId: number): Promise<MemberIdentity> {
  const result = await pool.query<{
    email: string;
    name: string;
    first_name: string;
    last_name: string;
    contact_id: number | null;
  }>(`SELECT email::text AS email, name, first_name, last_name, contact_id FROM members WHERE id = $1`, [memberId]);
  const row = result.rows[0];
  if (!row) throw notFound("Form not found");
  const email = row.email.trim().toLowerCase();
  const name =
    row.name.trim() || `${row.first_name} ${row.last_name}`.trim() || email.split("@")[0] || email;
  return { name, email, contactId: row.contact_id };
}

/** This member's earlier replies to the form, newest first. */
async function earlierReplies(formId: number, who: MemberIdentity): Promise<{ id: number; createdAt: string }[]> {
  const result = await pool.query<{ id: number; created_at: Date }>(
    `SELECT id, created_at FROM form_submissions
      WHERE form_id = $1
        AND (lower(email) = $2 OR ($3::int IS NOT NULL AND contact_id = $3))
      ORDER BY created_at DESC
      LIMIT 12`,
    [formId, who.email, who.contactId],
  );
  return result.rows.map((row) => ({ id: row.id, createdAt: new Date(row.created_at).toISOString() }));
}

/** The questions the member answers. Name and email come from the account, so they are not asked. */
function memberFields(fields: unknown): unknown[] {
  return (Array.isArray(fields) ? fields : []).filter((field) => {
    const key = (field as { key?: unknown } | null)?.key;
    return key !== "name" && key !== "email";
  });
}

function currentMemberId(req: Request): number {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member.id;
}

function slugParam(raw: unknown): string {
  const slug = cleanFormSlug(raw);
  if (!slug) throw notFound("Form not found");
  return slug;
}

memberLessonFormsRouter.get(
  "/lesson-forms/:slug",
  asyncHandler(async (req, res) => {
    const memberId = currentMemberId(req);
    const form = await loadLessonFormForMember(memberId, slugParam(req.params.slug));
    const who = await loadIdentity(memberId);
    res.json({
      form: {
        slug: form.slug,
        name: form.name,
        descriptionMd: form.description_md || form.description || "",
        fields: memberFields(form.fields),
        submitLabel: form.submit_label,
        successMessage: form.success_message,
      },
      member: { name: who.name, email: who.email },
      replies: await earlierReplies(form.id, who),
    });
  }),
);

const memberSubmitSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  elapsedMs: z.number().int().nonnegative().optional(),
});

memberLessonFormsRouter.post(
  "/lesson-forms/:slug/submit",
  // "View as member" is read-only: a reply sent through it would be filed as
  // the student's own.
  denyImpersonation,
  leadsLimiter,
  formUploadIpLimiter,
  asyncHandler(async (req, res, next) => {
    res.locals.form = await loadLessonFormForMember(currentMemberId(req), slugParam(req.params.slug));
    next();
  }),
  formUploadFormLimiter,
  asyncHandler(async (req, res) => {
    const form = res.locals.form as Awaited<ReturnType<typeof loadLessonFormForMember>>;
    const fields = asFields(form.fields);
    const fileFields = fields.filter((field) => field.type === FILE_TYPE);

    const multipart = isMultipart(req);
    let received: StagedFile[] = [];
    if (multipart) {
      try {
        received = await receiveFormFiles(req, res, fileFields);
      } catch (err) {
        req.resume();
        throw err;
      }
    }

    const parsed = memberSubmitSchema.safeParse(multipart ? multipartPayload(req.body) : req.body);
    if (!parsed.success) throw badRequest("Invalid submission", parsed.error.flatten());

    // The account is who sent it. Whatever the page put under `name` or
    // `email` is dropped, and so is anything claimed for a file question that
    // did not actually arrive as a file.
    const typed: Record<string, unknown> = { ...parsed.data.data };
    delete typed.name;
    delete typed.email;
    for (const field of fileFields) delete typed[field.key];
    const filesPresent = new Set(received.map((file) => file.fieldKey));
    const withFiles: Record<string, unknown> = { ...typed };
    for (const key of filesPresent) withFiles[key] = { file: true };

    const visible = visibleQuestionKeys(fields, withFiles);
    const problem = answerProblem(fields, withFiles, visible, filesPresent);
    if (problem) throw badRequest(problem);

    const who = await loadIdentity(currentMemberId(req));
    // Stored like a public reply's identity, so the reply list, the CSV and the
    // owner's email all name the student without knowing where it came from.
    const data = { ...keptAnswers(fields, typed, visible), name: who.name, email: who.email };
    const keptFiles = received.filter((file) => visible.has(file.fieldKey));

    const { submissionId, answers } = await storeSubmission({
      formId: form.id,
      data,
      email: who.email,
      ip: (req.ip ?? "").slice(0, 64),
      userAgent: String(req.get("user-agent") ?? "").slice(0, 500),
      files: keptFiles,
    });

    await afterSubmission(`the send counter on ${form.slug}`, () =>
      pool.query(`UPDATE forms SET submit_count = submit_count + 1 WHERE id = $1`, [form.id]),
    );

    // The member's own contact when the account has one; otherwise the contact
    // for their address (created if need be), exactly as a public reply would.
    const contactId =
      who.contactId ??
      (await afterSubmission(`the contact record for ${form.slug}`, async () =>
        (await upsertContactWithStatus({ email: who.email, name: who.name, source: `lesson form: ${form.slug}` })).id,
      ));

    if (contactId !== null) {
      await afterSubmission(`attaching submission ${submissionId} to its contact`, async () => {
        await pool.query(`UPDATE form_submissions SET contact_id = $2 WHERE id = $1 AND contact_id IS NULL`, [
          submissionId,
          contactId,
        ]);
        if (keptFiles.length > 0) {
          await pool.query(
            `UPDATE media_assets SET contact_id = $1 WHERE form_submission_id = $2 AND contact_id IS NULL`,
            [contactId, submissionId],
          );
        }
        await recordActivity({
          contactId,
          kind: "form.submitted",
          title: `Filled in ${form.name}`,
          subjectType: "form",
          subjectId: form.id,
        });
      });
    }

    if (wantsReplyEmail(form)) {
      void notifyOwnerOfReply(form, { name: who.name, email: who.email }, answers);
    }

    await publishDomainEvent("form_submitted", {
      eventKey: `form-submitted:${submissionId}`,
      contactId,
      email: who.email,
      name: who.name,
      subjectId: form.id,
      source: `form:${form.slug}`,
    });

    res.status(201).json({ ok: true, message: form.success_message, submittedAt: new Date().toISOString() });
  }),
);
