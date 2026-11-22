import { Router, type Request } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, conflict, HttpError, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { findRetreatById, type RetreatRow } from "../../services/retreats";
import {
  allQuestions,
  blankDefinition,
  createQuestionnaire,
  csvCell,
  loadQuestionnaire,
  loadQuestionnaires,
  parseDefinition,
  questionnaireKey,
  saveDefinition,
  type SnapshotEntry,
} from "../../services/retreatQuestionnaires";
import {
  RetreatAccessError,
  findAccount,
  grantRetreatAccess,
  previewAccessEmail,
  removeRetreatAccess,
  sendAccessEmail,
  setGuestRoomType,
} from "../../services/retreatAccess";
import { DuplicateError, duplicateRetreat, duplicateSchema } from "../../services/retreatDuplicate";
import { sendStoredFile } from "../member/retreatQuestionnaires";

/**
 * Organizer actions added for Yvette's item 7 (22 Nov 2026), mounted inside
 * adminRetreatsRouter AFTER its owner/admin check, so every route here is
 * owner/admin only:
 *
 *   questionnaires   add / edit (new immutable version per change) / reorder /
 *                    archive / delete-if-unanswered / versions / CSV export
 *   duplicate        a new draft retreat from this one
 *   access           find account, grant, remove, room type
 *   access email     preview (mints nothing) and an explicit per-guest send
 *
 * None of these charges anyone, changes a payment record or sends anything
 * except the access email's own explicit send action.
 */
export const adminRetreatExtrasRouter = Router();

function adminId(req: Request): number | null {
  const id = Number(req.user?.sub);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function idParam(raw: unknown, missing: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw notFound(missing);
  return id;
}

async function retreatOf(req: Request): Promise<RetreatRow> {
  const retreat = await findRetreatById(Number(req.params.id));
  if (!retreat) throw notFound("We couldn't find that retreat.");
  return retreat;
}

async function responseCounts(questionnaireIds: number[]) {
  if (questionnaireIds.length === 0) return new Map<number, { drafts: number; submitted: number }>();
  const result = await pool.query<{ questionnaire_id: number; drafts: number; submitted: number }>(
    `SELECT questionnaire_id,
            count(*) FILTER (WHERE state = 'draft')::int AS drafts,
            count(*) FILTER (WHERE state = 'submitted')::int AS submitted
       FROM retreat_questionnaire_responses WHERE questionnaire_id = ANY($1::int[]) GROUP BY questionnaire_id`,
    [questionnaireIds],
  );
  return new Map(result.rows.map((row) => [row.questionnaire_id, { drafts: row.drafts, submitted: row.submitted }]));
}

async function questionnairesJson(retreatId: number) {
  const rows = await loadQuestionnaires(retreatId, { includeArchived: true });
  const counts = await responseCounts(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    title: row.title,
    inChecklist: row.in_checklist,
    dueDate: row.due_date,
    sort: row.sort,
    archived: row.archived,
    version: row.current_version,
    definition: row.definition,
    updatedAt: new Date(row.updated_at).toISOString(),
    responses: counts.get(row.id) ?? { drafts: 0, submitted: 0 },
  }));
}

/* ─────────────────────────────── questionnaires ──────────────────────── */

adminRetreatExtrasRouter.get(
  "/:id/questionnaires",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    res.json({ questionnaires: await questionnairesJson(retreat.id) });
  }),
);

adminRetreatExtrasRouter.post(
  "/:id/questionnaires",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = z.object({ title: z.string().trim().min(1).max(200) }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Give the questionnaire a title.");
    const existing = await pool.query<{ key: string; sort: number }>(`SELECT key, sort FROM retreat_questionnaires WHERE retreat_id = $1`, [retreat.id]);
    const taken = new Set(existing.rows.map((row) => row.key));
    const base = questionnaireKey(parsed.data.title);
    let key = base;
    for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
    const sort = existing.rows.reduce((max, row) => Math.max(max, row.sort), 0) + 10;
    const id = await createQuestionnaire({
      retreatId: retreat.id,
      key,
      title: parsed.data.title,
      inChecklist: true,
      dueDate: null,
      sort,
      definition: blankDefinition(),
      adminId: adminId(req),
    });
    await recordAdminAction({ req, action: "retreat.questionnaire.create", entityType: "retreat_questionnaire", entityId: id, after: { title: parsed.data.title, key } });
    res.status(201).json({ questionnaires: await questionnairesJson(retreat.id), id });
  }),
);

const questionnaireUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    inChecklist: z.boolean(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    archived: z.boolean(),
    definition: z.unknown(),
  })
  .partial()
  .strict();

/**
 * PUT /:id/questionnaires/:qid — wording/settings. A changed definition is
 * saved as a NEW version (the old one is never modified), so answers already
 * given keep the wording they answered.
 */
adminRetreatExtrasRouter.put(
  "/:id/questionnaires/:qid",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const qid = idParam(req.params.qid, "We couldn't find that questionnaire.");
    const current = await loadQuestionnaire(retreat.id, qid);
    if (!current) throw notFound("We couldn't find that questionnaire.");
    const parsed = questionnaireUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Some of those details don't look right.", parsed.error.flatten());
    const body = parsed.data;

    let version = current.current_version;
    let changed = false;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (body.definition !== undefined) {
        const { definition, problems } = parseDefinition(body.definition);
        if (!definition) throw badRequest(problems.slice(0, 5).join(" "), { problems });
        ({ version, changed } = await saveDefinition(qid, definition, adminId(req), client));
      }
      await client.query(
        `UPDATE retreat_questionnaires
            SET title = COALESCE($3, title),
                in_checklist = COALESCE($4, in_checklist),
                due_date = CASE WHEN $5::boolean THEN $6::date ELSE due_date END,
                archived = COALESCE($7, archived),
                updated_at = now()
          WHERE id = $1 AND retreat_id = $2`,
        [qid, retreat.id, body.title ?? null, body.inChecklist ?? null, body.dueDate !== undefined, body.dueDate ?? null, body.archived ?? null],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await recordAdminAction({
      req,
      action: "retreat.questionnaire.update",
      entityType: "retreat_questionnaire",
      entityId: qid,
      before: { title: current.title, version: current.current_version },
      after: { title: body.title, inChecklist: body.inChecklist, dueDate: body.dueDate, archived: body.archived, version, newVersion: changed },
    });
    res.json({ questionnaires: await questionnairesJson(retreat.id), version, newVersion: changed });
  }),
);

adminRetreatExtrasRouter.post(
  "/:id/questionnaires/reorder",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = z.object({ ids: z.array(z.number().int().positive()).max(100) }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Nothing to reorder.");
    for (const [index, id] of parsed.data.ids.entries()) {
      await pool.query(`UPDATE retreat_questionnaires SET sort = $3, updated_at = now() WHERE id = $1 AND retreat_id = $2`, [id, retreat.id, (index + 1) * 10]);
    }
    res.json({ questionnaires: await questionnairesJson(retreat.id) });
  }),
);

/** DELETE — only a questionnaire nobody has answered. Answered ones can only be archived. */
adminRetreatExtrasRouter.delete(
  "/:id/questionnaires/:qid",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const qid = idParam(req.params.qid, "We couldn't find that questionnaire.");
    const answered = await pool.query(
      `SELECT 1 FROM retreat_questionnaire_responses WHERE questionnaire_id = $1
       UNION ALL SELECT 1 FROM retreat_questionnaire_files WHERE questionnaire_id = $1 LIMIT 1`,
      [qid],
    );
    if (answered.rows.length) throw conflict("A guest has already answered this questionnaire, so it can't be deleted. Archive it instead.");
    const removed = await pool.query(`DELETE FROM retreat_questionnaires WHERE id = $1 AND retreat_id = $2 RETURNING id, title`, [qid, retreat.id]);
    if (!removed.rows[0]) throw notFound("We couldn't find that questionnaire.");
    await recordAdminAction({ req, action: "retreat.questionnaire.delete", entityType: "retreat_questionnaire", entityId: qid, before: removed.rows[0] });
    res.json({ questionnaires: await questionnairesJson(retreat.id) });
  }),
);

adminRetreatExtrasRouter.get(
  "/:id/questionnaires/:qid/versions",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const qid = idParam(req.params.qid, "We couldn't find that questionnaire.");
    const rows = await pool.query<{ version: number; definition: unknown; created_at: Date; created_by_name: string | null }>(
      `SELECT v.version, v.definition, v.created_at, a.name AS created_by_name
         FROM retreat_questionnaire_versions v
         JOIN retreat_questionnaires q ON q.id = v.questionnaire_id AND q.retreat_id = $2
         LEFT JOIN admin_users a ON a.id = v.created_by
        WHERE v.questionnaire_id = $1 ORDER BY v.version DESC`,
      [qid, retreat.id],
    );
    res.json({
      versions: rows.rows.map((row) => ({
        version: row.version,
        definition: row.definition,
        createdAt: new Date(row.created_at).toISOString(),
        createdBy: row.created_by_name ?? null,
      })),
    });
  }),
);

/**
 * GET /:id/questionnaires/:qid/responses.csv — every guest's latest answers, in
 * the CURRENT question order, plus answers to removed questions under their
 * original wording. Health/sensitive questions are left out unless
 * ?sensitive=1, so a list for the villa or a vendor can be made without them.
 */
adminRetreatExtrasRouter.get(
  "/:id/questionnaires/:qid/responses.csv",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const qid = idParam(req.params.qid, "We couldn't find that questionnaire.");
    const questionnaire = await loadQuestionnaire(retreat.id, qid);
    if (!questionnaire) throw notFound("We couldn't find that questionnaire.");
    const includeSensitive = req.query.sensitive === "1";
    const rows = await pool.query<{ name: string | null; email: string; state: string; updated_at: Date; submitted_at: Date | null; answers: Record<string, unknown>; question_snapshot: Record<string, SnapshotEntry> }>(
      `SELECT m.name, m.email::text AS email, r.state, r.updated_at, r.submitted_at, r.answers, r.question_snapshot
         FROM retreat_questionnaire_responses r JOIN members m ON m.id = r.member_id
        WHERE r.questionnaire_id = $1 ORDER BY m.name, m.email`,
      [qid],
    );
    const current = allQuestions(questionnaire.definition)
      .map(({ question }) => question)
      .filter((q) => includeSensitive || !q.sensitive);
    const currentIds = new Set(allQuestions(questionnaire.definition).map(({ question }) => question.id));
    const retired = new Map<string, SnapshotEntry>();
    for (const row of rows.rows) {
      for (const [id, entry] of Object.entries(row.question_snapshot ?? {})) {
        if (!currentIds.has(id) && (includeSensitive || !entry.sensitive)) retired.set(id, entry);
      }
    }
    const columns = [...current.map((q) => ({ id: q.id, label: q.label, file: q.type === "file" })), ...[...retired].map(([id, e]) => ({ id, label: `${e.label} (removed question)`, file: e.type === "file" }))];
    const lines = [["name", "email", "status", "updated", "submitted", ...columns.map((c) => c.label)].map(csvCell).join(",")];
    for (const row of rows.rows) {
      lines.push(
        [
          row.name ?? "",
          row.email,
          row.state,
          new Date(row.updated_at).toISOString(),
          row.submitted_at ? new Date(row.submitted_at).toISOString() : "",
          ...columns.map((c) => (c.file ? (row.answers[c.id] ? "File uploaded" : "") : row.answers[c.id])),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    await recordAdminAction({ req, action: "retreat.questionnaire.export", entityType: "retreat_questionnaire", entityId: qid, after: { includeSensitive } });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${retreat.slug}-${questionnaire.key}${includeSensitive ? "-with-health" : ""}.csv"`);
    res.send(`${lines.join("\r\n")}\r\n`);
  }),
);

const reviewSchema = z
  .object({ status: z.enum(["verified", "needs_attention", "clear"]), note: z.string().trim().max(2000).default("") })
  .strict();

adminRetreatExtrasRouter.put(
  "/:id/guests/:memberId/questionnaires/:qid/review",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = idParam(req.params.memberId, "We couldn't find that guest.");
    const qid = idParam(req.params.qid, "We couldn't find that questionnaire.");
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose Verified, Needs attention or Clear.");
    if (parsed.data.status === "needs_attention" && !parsed.data.note) throw badRequest("Add a note so the guest knows what to change.");
    const status = parsed.data.status === "clear" ? null : parsed.data.status;
    const updated = await pool.query(
      `UPDATE retreat_questionnaire_responses r
          SET review_status = $4, review_note = $5,
              reviewed_at = CASE WHEN $4::text IS NULL THEN NULL ELSE now() END, reviewed_by = $6
         FROM retreat_questionnaires q
        WHERE q.id = r.questionnaire_id AND q.retreat_id = $1 AND r.questionnaire_id = $2 AND r.member_id = $3
        RETURNING r.id`,
      [retreat.id, qid, memberId, status, status ? parsed.data.note : "", adminId(req)],
    );
    if (!updated.rows[0]) throw notFound("She hasn't saved any answers to this questionnaire yet.");
    await recordAdminAction({
      req,
      action: "retreat.questionnaire.review",
      entityType: "retreat_guest",
      entityId: `${retreat.id}:${memberId}`,
      after: { questionnaireId: qid, status: parsed.data.status, note: parsed.data.note },
    });
    res.json({ ok: true });
  }),
);

/** GET /:id/questionnaire-files/:fileId — an organizer opening a guest's uploaded photo/PDF (audited). */
adminRetreatExtrasRouter.get(
  "/:id/questionnaire-files/:fileId",
  asyncHandler(async (req, res, next) => {
    const retreat = await retreatOf(req);
    const fileId = idParam(req.params.fileId, "We couldn't find that file.");
    const found = await pool.query<{ storage_ref: string; mime: string; member_id: number }>(
      `SELECT f.storage_ref, f.mime, f.member_id FROM retreat_questionnaire_files f
         JOIN retreat_questionnaires q ON q.id = f.questionnaire_id AND q.retreat_id = $2
        WHERE f.id = $1`,
      [fileId, retreat.id],
    );
    const row = found.rows[0];
    if (!row) throw notFound("We couldn't find that file.");
    await recordAdminAction({ req, action: "retreat.questionnaire.file.view", entityType: "retreat_guest", entityId: `${retreat.id}:${row.member_id}` });
    await sendStoredFile(req, res, next, row.storage_ref, row.mime);
  }),
);

/* ─────────────────────────────── duplicate ───────────────────────────── */

adminRetreatExtrasRouter.post(
  "/:id/duplicate",
  asyncHandler(async (req, res) => {
    const source = await retreatOf(req);
    const parsed = duplicateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Some of those details don't look right.", parsed.error.flatten());
    try {
      const created = await duplicateRetreat(source, parsed.data, adminId(req));
      await recordAdminAction({ req, action: "retreat.duplicate", entityType: "retreat", entityId: created.id, after: { from: source.id, ...parsed.data } });
      res.status(201).json({ id: created.id, slug: created.slug });
    } catch (error) {
      if (error instanceof DuplicateError) throw badRequest(error.message);
      throw error;
    }
  }),
);

/* ─────────────────────────────── access ──────────────────────────────── */

adminRetreatExtrasRouter.get(
  "/:id/access/lookup",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const email = z.string().trim().email().max(320).safeParse(req.query.email);
    if (!email.success) throw badRequest("Enter a full email address.");
    res.json({ account: await findAccount(retreat, email.data) });
  }),
);

const grantSchema = z
  .object({
    memberId: z.number().int().positive().optional(),
    email: z.string().trim().email().max(320).optional(),
    name: z.string().trim().max(200).optional(),
    bookingEmail: z.union([z.literal(""), z.string().trim().email().max(320)]).optional(),
    acceptEmailMismatch: z.boolean().optional(),
    roomType: z.enum(["private", "shared"]).nullable().optional(),
  })
  .strict();

function accessError(error: unknown): never {
  if (error instanceof RetreatAccessError) {
    const status = error.code === "email_mismatch" ? 409 : error.code === "not_found" ? 404 : 400;
    throw new HttpError(status, error.message, { code: error.code, ...error.detail });
  }
  throw error;
}

/**
 * POST /:id/access — give a guest this retreat's dashboard (nothing else). No
 * email, no charge, no payment-plan or balance change, no automation; the
 * access email is a separate action.
 */
adminRetreatExtrasRouter.post(
  "/:id/access",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const parsed = grantSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.memberId && !parsed.data.email)) throw badRequest("Choose an account or enter an email address.");
    try {
      const result = await grantRetreatAccess({ retreat, adminId: adminId(req), ...parsed.data });
      await recordAdminAction({
        req,
        action: "retreat.access.grant",
        entityType: "retreat_guest",
        entityId: `${retreat.id}:${result.memberId}`,
        after: { ...result, bookingEmail: parsed.data.bookingEmail ?? "", acceptEmailMismatch: parsed.data.acceptEmailMismatch ?? false, roomType: parsed.data.roomType ?? null },
      });
      res.status(201).json(result);
    } catch (error) {
      accessError(error);
    }
  }),
);

adminRetreatExtrasRouter.delete(
  "/:id/access/:memberId",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = idParam(req.params.memberId, "We couldn't find that guest.");
    const revoked = await removeRetreatAccess(retreat, memberId, adminId(req));
    await recordAdminAction({ req, action: "retreat.access.remove", entityType: "retreat_guest", entityId: `${retreat.id}:${memberId}`, after: { revoked } });
    res.json({ revoked });
  }),
);

adminRetreatExtrasRouter.put(
  "/:id/guests/:memberId/room-type",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = idParam(req.params.memberId, "We couldn't find that guest.");
    const parsed = z.object({ roomType: z.enum(["private", "shared"]).nullable() }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Choose private, shared or not set.");
    const exists = await pool.query(`SELECT 1 FROM members WHERE id = $1`, [memberId]);
    if (!exists.rows[0]) throw notFound("We couldn't find that guest.");
    await setGuestRoomType(retreat.id, memberId, parsed.data.roomType);
    await recordAdminAction({ req, action: "retreat.guest.room_type", entityType: "retreat_guest", entityId: `${retreat.id}:${memberId}`, after: parsed.data });
    res.json({ roomType: parsed.data.roomType });
  }),
);

/** GET — the access email exactly as it would be sent, with a marked sample link. Mints and sends nothing. */
adminRetreatExtrasRouter.get(
  "/:id/guests/:memberId/access-email",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = idParam(req.params.memberId, "We couldn't find that guest.");
    const preview = await previewAccessEmail(retreat, memberId);
    if (!preview) throw notFound("We couldn't find that guest.");
    res.json(preview);
  }),
);

/** POST — sends the access email to this one guest. Requires {confirm: true}. */
adminRetreatExtrasRouter.post(
  "/:id/guests/:memberId/access-email",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = idParam(req.params.memberId, "We couldn't find that guest.");
    const parsed = z.object({ confirm: z.literal(true) }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("Confirm that you want to send this email.");
    const result = await sendAccessEmail(retreat, memberId, adminId(req));
    await recordAdminAction({ req, action: "retreat.access.email", entityType: "retreat_guest", entityId: `${retreat.id}:${memberId}`, after: result });
    if (!result.sent) throw badRequest(result.error ?? "The email could not be sent.");
    res.json(result);
  }),
);
