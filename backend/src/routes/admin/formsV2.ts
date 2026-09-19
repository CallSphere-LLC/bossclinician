import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { badRequest, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";
import { CONDITION_OPERATORS, logicProblem } from "../../services/formLogic";
import {
  FILE_CATEGORIES,
  FORM_UPLOAD_HARD_CAP_MB,
  MAX_FILE_QUESTIONS,
} from "../../services/formUploads";
import { adminPreviewUrl } from "../../services/signedUrls";

/**
 * The form builder — mounted at /api/admin/forms.
 *
 * A form is a list of fields, what happens after somebody sends it, and where
 * the answers go on their contact record. That last part is the one that earns
 * the feature: a form that collects a phone number into a JSON blob nobody can
 * segment on is a form that may as well have been an email address.
 *
 * Field order is the array's own order. A `sort` column would be a second
 * source of truth for something the editor already expresses by dragging.
 */

export const adminFormsRouter = Router();

/**
 * Where a field's answer lands on the contact.
 *
 * The five named ones are columns; anything else is stored under its own key in
 * `custom_fields`, which is what makes "what's your biggest bottleneck" a thing
 * a segment can be built from later.
 */
const CONTACT_FIELDS = ["", "firstName", "lastName", "email", "phone", "timezone"] as const;

const fieldSchema = z.object({
  /** Stable. Every answer already collected is filed under it, so a rename must not change it. */
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "A field key is lowercase letters, numbers and underscores"),
  label: z.string().trim().min(1).max(200),
  type: z.enum([
    "text",
    "textarea",
    "email",
    "phone",
    "number",
    "select",
    "radio",
    "checkbox",
    "checkboxes",
    "date",
    "hidden",
    // A file somebody attaches. Stored in the protected root and the media
    // library against their contact — services/formUploads.ts.
    "file",
  ]),
  required: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  helpText: z.string().max(500).optional(),
  options: z.array(z.string().max(200)).max(100).optional(),
  /** Contact column or custom-field key this answer is written to. */
  contactField: z.string().max(60).optional(),
  minLength: z.number().int().min(0).max(10_000).nullable().optional(),
  maxLength: z.number().int().min(1).max(10_000).nullable().optional(),
  /** A JavaScript-compatible pattern, used by the browser and re-checked server side. */
  pattern: z.string().max(200).optional(),
  /**
   * Show this question only when an earlier question's answer meets a test.
   * Checked for sense in `fieldsError`, and evaluated again on every reply by
   * services/formLogic.ts — a hidden question is never required or stored.
   */
  showIf: z
    .object({
      field: z.string().trim().min(1).max(60),
      operator: z.enum(CONDITION_OPERATORS),
      value: z.string().max(200).optional(),
      values: z.array(z.string().max(200)).max(100).optional(),
    })
    .nullable()
    .optional(),
  /** File questions only: which kinds of file are accepted. */
  fileTypes: z.array(z.enum(FILE_CATEGORIES)).max(FILE_CATEGORIES.length).optional(),
  /** File questions only: the largest file, in MB. Capped in `fieldsError`. */
  maxSizeMb: z.number().positive().max(1000).optional(),
});

type FormField = z.infer<typeof fieldSchema>;

export const formSchema = z.object({
  name: z.string().trim().min(1, "Give this form a name").max(200),
  description: z.string().max(2000).optional(),
  descriptionMd: z.string().max(20_000).optional(),
  fields: z.array(fieldSchema).max(100).optional(),
  submitLabel: z.string().trim().max(100).optional(),
  successMessage: z.string().max(1000).optional(),
  postAction: z.enum(["message", "redirect", "download"]).optional(),
  redirectUrl: z.string().max(1000).optional(),
  downloadProductFileId: z.number().int().positive().nullable().optional(),
  applyTagIds: z.array(z.number().int().positive()).max(50).optional(),
  subscribeSequenceId: z.number().int().positive().nullable().optional(),
  spamProtection: z.enum(["honeypot", "turnstile", "recaptcha"]).optional(),
  doubleOptIn: z.boolean().optional(),
  createLead: z.boolean().optional(),
  published: z.boolean().optional(),
});

/**
 * The questions a brand-new form starts with.
 *
 * Created empty, a form is a page with a heading and a Send button under it,
 * and every reply it collects is an empty object — which is exactly what the
 * builder produced, because the create call sends nothing but a name and this
 * route defaulted the list to `[]`. The legacy screen seeded the same two
 * (frontend/src/pages/admin/Forms.tsx), and they are the two everything
 * downstream needs: a contact is keyed on its address, so a form with no email
 * question cannot make a lead, apply a tag or start a sequence no matter what
 * else is configured on it.
 *
 * `email` is pointed at the contact's address column so the mapping is right
 * from the first save; "Your name" is left off the menu deliberately — it is a
 * whole name and there is no whole-name column, and the submit path reads a
 * field keyed `name` as the display name anyway.
 */
export const STARTER_FIELDS: FormField[] = [
  { key: "name", label: "Your name", type: "text", required: true },
  { key: "email", label: "Email address", type: "email", required: true, contactField: "email" },
];

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

async function freeSlug(base: string): Promise<string> {
  const wanted = base || "form";
  const taken = await pool.query<{ slug: string }>(
    `SELECT slug FROM forms WHERE slug = $1 OR slug LIKE $2`,
    [wanted, `${wanted}-%`]
  );
  const used = new Set(taken.rows.map((row) => row.slug));
  if (!used.has(wanted)) return wanted;

  let suffix = 2;
  while (used.has(`${wanted}-${suffix}`)) suffix += 1;
  return `${wanted}-${suffix}`;
}

/**
 * The rules a field list has to satisfy before it is stored.
 *
 * Duplicate keys are the one that matters: two fields sharing a key means the
 * second silently overwrites the first in every submission, and the answers
 * already collected under that key become unreadable.
 */
export function fieldsError(fields: FormField[]): string | null {
  const seen = new Set<string>();
  let fileQuestions = 0;
  for (const field of fields) {
    if (seen.has(field.key)) return `Two questions are using the same answer key (${field.key}).`;
    seen.add(field.key);

    if (field.type === "file") {
      fileQuestions += 1;
      if (fileQuestions > MAX_FILE_QUESTIONS) {
        return `A form can ask for up to ${MAX_FILE_QUESTIONS} files.`;
      }
      if (field.key === "name" || field.key === "email") {
        return `“${field.label}” can't be a file question — that answer is their ${field.key === "name" ? "name" : "email address"}.`;
      }
      if (field.fileTypes !== undefined && field.fileTypes.length === 0) {
        return `“${field.label}” doesn't accept any kind of file yet. Tick at least one.`;
      }
      if (field.maxSizeMb !== undefined && field.maxSizeMb > FORM_UPLOAD_HARD_CAP_MB) {
        return `“${field.label}” can take files up to ${FORM_UPLOAD_HARD_CAP_MB} MB at most.`;
      }
      if (field.contactField) {
        // The file is attached to their contact on its own; a contact detail
        // holds text, and a file in one is a value nobody can read.
        return `“${field.label}” is a file, so it's attached to the contact rather than saved to a detail. Choose “Keep it on the form only”.`;
      }
    }

    if ((field.type === "select" || field.type === "radio" || field.type === "checkboxes") &&
        (field.options ?? []).length === 0) {
      return `“${field.label}” is a multiple-choice question with no choices on it.`;
    }

    if (
      field.minLength !== null &&
      field.minLength !== undefined &&
      field.maxLength !== null &&
      field.maxLength !== undefined &&
      field.minLength > field.maxLength
    ) {
      return `“${field.label}” asks for more characters than it allows.`;
    }

    if (field.pattern) {
      try {
        // Compiled here so a broken expression is a message she can act on
        // rather than a form that silently rejects every answer.
        new RegExp(field.pattern);
      } catch {
        return `The format rule on “${field.label}” isn't valid.`;
      }
    }

    if (field.contactField && !CONTACT_FIELDS.includes(field.contactField as never)) {
      // Anything else is a custom field, which only has to be a usable key.
      if (!/^[a-z][a-z0-9_]*$/.test(field.contactField)) {
        return `“${field.label}” is saving to a contact detail with an unusable name.`;
      }
    }
  }
  // Last, and over the whole list: a rule can only be judged against the
  // questions above it, and against their choices as they now stand.
  return logicProblem(fields);
}

/* ------------------------------------------------------------------- forms */

adminFormsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT f.id, f.slug, f.name, f.description, f.published, f.views, f.submit_count,
              f.post_action, f.updated_at,
              jsonb_array_length(f.fields) AS field_count,
              (SELECT count(*)::int FROM form_submissions s WHERE s.form_id = f.id) AS submission_count
         FROM forms f
        ORDER BY f.name`
    );
    res.json(rowsToCamel(result.rows));
  })
);

adminFormsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = formSchema.parse(req.body);
    // Only when the caller said nothing about questions. An explicit empty list
    // is somebody deliberately building the field list themselves, and seeding
    // over the top of that would be a form that grows two questions back.
    const fields = input.fields ?? STARTER_FIELDS;
    const problem = fieldsError(fields);
    if (problem) throw badRequest(problem);

    const slug = await freeSlug(slugify(input.name));

    const result = await pool.query(
      `INSERT INTO forms
         (slug, name, description, description_md, fields, submit_label, success_message,
          post_action, redirect_url, download_product_file_id, apply_tag_ids,
          subscribe_sequence_id, spam_protection, double_opt_in, create_lead, published)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        slug,
        input.name,
        input.description ?? "",
        input.descriptionMd ?? "",
        JSON.stringify(fields),
        input.submitLabel ?? "Submit",
        input.successMessage ?? "Thanks — we got it.",
        input.postAction ?? "message",
        input.redirectUrl ?? "",
        input.downloadProductFileId ?? null,
        input.applyTagIds ?? [],
        input.subscribeSequenceId ?? null,
        input.spamProtection ?? "honeypot",
        input.doubleOptIn ?? false,
        input.createLead ?? true,
        input.published ?? true,
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminFormsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT f.*, s.name AS sequence_name, p.title AS download_file_name
         FROM forms f
         LEFT JOIN email_sequences s ON s.id = f.subscribe_sequence_id
         LEFT JOIN product_files p   ON p.id = f.download_product_file_id
        WHERE f.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) throw notFound("Form not found");

    const tags = await pool.query(
      `SELECT id, name FROM tags WHERE id = ANY($1::int[]) ORDER BY name`,
      [result.rows[0].apply_tag_ids]
    );

    res.json({ ...rowToCamel(result.rows[0]), applyTags: rowsToCamel(tags.rows) });
  })
);

const FORM_COLUMNS = [
  "name",
  "description",
  "description_md",
  "fields",
  "submit_label",
  "success_message",
  "post_action",
  "redirect_url",
  "download_product_file_id",
  "apply_tag_ids",
  "subscribe_sequence_id",
  "spam_protection",
  "double_opt_in",
  "create_lead",
  "published",
] as const;

adminFormsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = formSchema.partial().parse(req.body);
    if (input.fields) {
      const problem = fieldsError(input.fields);
      if (problem) throw badRequest(problem);
    }
    if (input.postAction === "redirect" && input.redirectUrl !== undefined && !input.redirectUrl.trim()) {
      throw badRequest("Choose where people should go after they send this form.");
    }

    // `fields` is a jsonb column, so it has to arrive as text rather than as
    // the array pg would otherwise render as a Postgres array literal. The key
    // is added only when it was sent: `buildUpdate` reads the keys present, so
    // spreading an explicit `undefined` would emit `fields = NULL` against a
    // NOT NULL column and wipe the questions off a form that was only being
    // renamed.
    const patch: Record<string, unknown> = { ...input };
    if (input.fields) patch.fields = JSON.stringify(input.fields);

    const update = buildUpdate(patch, FORM_COLUMNS);
    if (!update) throw badRequest("Nothing to update");

    const result = await pool.query(
      `UPDATE forms SET ${update.clause}, updated_at = now()
        WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.id]
    );
    if (result.rowCount === 0) throw notFound("Form not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminFormsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM forms WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) throw notFound("Form not found");
    res.status(204).end();
  })
);

/* ------------------------------------------------------------- submissions */

adminFormsRouter.get(
  "/:id/submissions",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    // `?since=30d` — only the replies from the last N days. The Marketing
    // Overview links to a form this way; filtered here rather than on the page,
    // so the first hundred rows can't hide an older reply that is in range.
    const sinceDays = parseSinceDays(req.query.since);

    const result = await pool.query(
      `SELECT s.id, s.data, s.email, s.created_at, s.confirmed_at, s.contact_id,
              c.name AS contact_name
         FROM form_submissions s
         LEFT JOIN contacts c ON c.id = s.contact_id
        WHERE s.form_id = $1
          AND ($4::int IS NULL OR s.created_at >= now() - make_interval(days => $4::int))
        ORDER BY s.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset, sinceDays]
    );

    const total = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM form_submissions
        WHERE form_id = $1
          AND ($2::int IS NULL OR created_at >= now() - make_interval(days => $2::int))`,
      [req.params.id, sinceDays]
    );

    // The files each reply brought in, with a link the admin can open. A file
    // lives in the protected root and has no address of its own, so the link is
    // a signed one minted for this administrator on this request.
    const submissions = rowsToCamel<Record<string, unknown>>(result.rows);
    const files = await sentFiles(
      `m.form_submission_id = ANY($1::int[])`,
      [submissions.map((submission) => Number(submission.id))],
      adminId(req)
    );

    res.json({
      total: Number(total.rows[0]?.count ?? 0),
      sinceDays,
      submissions: submissions.map((submission) => ({
        ...submission,
        files: files.filter((file) => file.submissionId === Number(submission.id)),
      })),
    });
  })
);

/**
 * `30d` → 30. Anything else — a missing value, `abc`, `0d`, a year and a half —
 * is no filter at all, rather than an error on a link somebody followed.
 */
export function parseSinceDays(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,4})d$/.exec(value.trim());
  if (!match) return null;
  const days = Number(match[1]);
  return days >= 1 && days <= 3650 ? days : null;
}

/* ------------------------------------------------------- files people sent */

/** The signed-in administrator. Every route here is mounted behind requireAuth. */
function adminId(req: Request): number {
  return Number(req.user?.sub);
}

export interface SentFile {
  id: number;
  name: string;
  mime: string;
  kind: string;
  sizeBytes: number;
  createdAt: Date;
  contactId: number | null;
  submissionId: number | null;
  fieldKey: string;
  formId: number | null;
  formName: string | null;
  previewUrl: string;
}

/** Media-library rows that arrived through a form, with a signed link each. */
async function sentFiles(where: string, params: unknown[], adminUserId: number): Promise<SentFile[]> {
  const result = await pool.query<{
    id: number;
    title: string;
    mime: string;
    kind: string;
    size_bytes: string | number;
    created_at: Date;
    contact_id: number | null;
    form_submission_id: number | null;
    form_field_key: string;
    form_id: number | null;
    form_name: string | null;
  }>(
    `SELECT m.id, m.title, m.mime, m.kind, m.size_bytes, m.created_at, m.contact_id,
            m.form_submission_id, m.form_field_key, s.form_id, f.name AS form_name
       FROM media_assets m
       LEFT JOIN form_submissions s ON s.id = m.form_submission_id
       LEFT JOIN forms f            ON f.id = s.form_id
      WHERE ${where}
      ORDER BY m.created_at DESC, m.id DESC`,
    params
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.title,
    mime: row.mime,
    kind: row.kind,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    contactId: row.contact_id,
    submissionId: row.form_submission_id,
    fieldKey: row.form_field_key,
    formId: row.form_id,
    formName: row.form_name,
    previewUrl: adminPreviewUrl({ assetId: row.id, adminUserId }).url,
  }));
}

/**
 * GET /admin/forms-v2/contacts/:contactId/files — every file a contact has sent
 * through any form, newest first, for the contact's own page.
 */
adminFormsRouter.get(
  "/contacts/:contactId/files",
  asyncHandler(async (req, res) => {
    const contactId = Number(req.params.contactId);
    if (!Number.isSafeInteger(contactId) || contactId <= 0) throw badRequest("That isn't a contact.");
    res.json(await sentFiles(`m.contact_id = $1`, [contactId], adminId(req)));
  })
);

adminFormsRouter.delete(
  "/:id/submissions/:submissionId",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `DELETE FROM form_submissions WHERE id = $1 AND form_id = $2`,
      [req.params.submissionId, req.params.id]
    );
    if (result.rowCount === 0) throw notFound("Submission not found");
    res.status(204).end();
  })
);

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * A submission is text a stranger typed. `=cmd|'/c calc'!A1` in a name field is
 * a working command in Excel the moment the export is opened, and the person
 * opening it is the business owner on her own laptop. The cell is prefixed with
 * an apostrophe, which Excel and Sheets both read as "this is text" and neither
 * displays.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A file answer is stored as a small record (its library id, name and size);
 * the spreadsheet shows the file's name rather than that record as JSON.
 */
function exportValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as { file?: unknown; name?: unknown };
    if (record.file === true && typeof record.name === "string") return record.name;
  }
  return value;
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  // Quoting is unconditional: a value containing a comma, a quote or a newline
  // needs it, and deciding per cell is how one row ends up shifted by a column.
  return `"${guarded.replace(/"/g, '""')}"`;
}

adminFormsRouter.get(
  "/:id/submissions.csv",
  asyncHandler(async (req, res) => {
    const form = await pool.query<{ slug: string; name: string; fields: FormField[] }>(
      `SELECT slug, name, fields FROM forms WHERE id = $1`,
      [req.params.id]
    );
    if (form.rowCount === 0) throw notFound("Form not found");

    const submissions = await pool.query<{
      id: number;
      data: Record<string, unknown>;
      email: string;
      created_at: Date;
      confirmed_at: Date | null;
    }>(
      `SELECT id, data, email, created_at, confirmed_at
         FROM form_submissions WHERE form_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );

    const fields = form.rows[0].fields ?? [];
    // Columns come from the form's own field list, in its order, so the export
    // reads like the form rather than like whatever keys happened to arrive.
    // Anything a submission carries that the form no longer asks for is
    // appended, because deleting a question must not delete its answers.
    const extraKeys = new Set<string>();
    for (const submission of submissions.rows) {
      for (const key of Object.keys(submission.data ?? {})) {
        if (!fields.some((field) => field.key === key)) extraKeys.add(key);
      }
    }

    const columns = [
      ...fields.map((field) => ({ key: field.key, label: field.label })),
      ...[...extraKeys].map((key) => ({ key, label: key })),
    ];

    const lines = [
      ["Sent", "Email", "Confirmed", ...columns.map((column) => column.label)]
        .map(csvCell)
        .join(","),
      ...submissions.rows.map((submission) =>
        [
          submission.created_at.toISOString(),
          submission.email,
          submission.confirmed_at ? submission.confirmed_at.toISOString() : "",
          ...columns.map((column) => exportValue((submission.data ?? {})[column.key])),
        ]
          .map(csvCell)
          .join(",")
      ),
    ];

    res
      .type("text/csv; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${form.rows[0].slug}-submissions.csv"`)
      // A BOM, because Excel on Windows otherwise reads a UTF-8 export as
      // Latin-1 and turns every accented name into mojibake.
      .send(`\uFEFF${lines.join("\r\n")}\r\n`);
  })
);
