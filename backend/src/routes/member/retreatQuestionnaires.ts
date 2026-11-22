import crypto from "crypto";
import fs from "fs/promises";
import nodePath from "path";
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, conflict, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation } from "../../middleware/memberAuth";
import { partsDir } from "../../services/mediaStorage";
import { protectedRef, resolveStoredFile, safeMime, uploadPath } from "../../services/signedUrls";
import { finishStagedMedia, persistStagedMedia, serveStoredMedia, usesS3Media } from "../../services/objectStorage";
import { loadGuestRetreat, normaliseSettings, wordingContext, type RetreatRow } from "../../services/retreats";
import {
  QUESTIONNAIRE_FILE_MAX_MB,
  allQuestions,
  audienceAllows,
  guestQuestionnaireView,
  guestRoomType,
  loadOwnedFiles,
  loadQuestionnaireByKey,
  saveResponse,
  sniffQuestionnaireFile,
  type LoadedQuestionnaire,
} from "../../services/retreatQuestionnaires";

/**
 * `/api/member/retreats/:slug/questionnaires/*` — a guest's own answers.
 *
 * Every handler first proves she is a guest of THIS retreat (published + active
 * dashboard grant, else the same 404) and then reads and writes only rows keyed
 * on (questionnaire of this retreat, req.member.id). No handler accepts a member
 * id or response id from the client; a file id is honoured only when that file
 * is hers. Writes refuse an admin "viewing as" her (denyImpersonation).
 */
export const memberRetreatQuestionnairesRouter = Router();

function memberIdOf(req: Request): number {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member.id;
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many saves. Please wait a moment and try again." },
  keyGenerator: (req: Request) => (req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "")),
});

const MISSING = "We couldn't find that questionnaire.";

async function loadContext(req: Request) {
  const memberId = memberIdOf(req);
  const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
  const key = String(req.params.key);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key) || key.length > 60) throw notFound(MISSING);
  const questionnaire = await loadQuestionnaireByKey(retreat.id, key);
  if (!questionnaire) throw notFound(MISSING);
  return { memberId, retreat, questionnaire };
}

async function viewFor(retreat: RetreatRow, questionnaire: LoadedQuestionnaire, memberId: number) {
  const [roomType, files, responses] = await Promise.all([
    guestRoomType(retreat.id, memberId),
    loadOwnedFiles(questionnaire.id, memberId),
    pool.query(
      `SELECT id, questionnaire_id, version, answers, question_snapshot, state, revision, review_status, review_note,
              reviewed_at, updated_at, submitted_at
         FROM retreat_questionnaire_responses WHERE questionnaire_id = $1 AND member_id = $2`,
      [questionnaire.id, memberId],
    ),
  ]);
  const ctx = wordingContext(retreat, normaliseSettings(retreat.settings));
  return guestQuestionnaireView(questionnaire, responses.rows[0], files, roomType, ctx);
}

/** GET …/questionnaires/:key — this questionnaire as she sees it, with her answers. */
memberRetreatQuestionnairesRouter.get(
  "/retreats/:slug/questionnaires/:key",
  asyncHandler(async (req, res) => {
    const { memberId, retreat, questionnaire } = await loadContext(req);
    noStore(res);
    res.json(await viewFor(retreat, questionnaire, memberId));
  }),
);

const saveSchema = z
  .object({
    answers: z.record(z.string(), z.unknown()),
    submit: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

/**
 * PUT …/questionnaires/:key — Save progress (submit=false: nothing required)
 * or submit (required questions she can see must be answered). A save from a
 * stale tab or second device is refused (409) rather than replacing newer answers.
 */
memberRetreatQuestionnairesRouter.put(
  "/retreats/:slug/questionnaires/:key",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { memberId, retreat, questionnaire } = await loadContext(req);
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Nothing to save.");
    if (Buffer.byteLength(JSON.stringify(parsed.data.answers), "utf8") > 200 * 1024) throw badRequest("That's more than this form can save.");
    const audience = await guestRoomType(retreat.id, memberId);
    const result = await saveResponse({
      questionnaire,
      memberId,
      audience,
      answers: parsed.data.answers,
      submit: parsed.data.submit,
      revision: parsed.data.revision,
    });
    if (!result.ok && result.conflict) throw conflict("These answers were updated on another device. Reload to see the latest answers.");
    if (!result.ok) {
      const errors = result.errors ?? {};
      res.status(400).json({
        error: "Please answer the questions marked below before submitting.",
        fieldErrors: errors,
        details: { fieldErrors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]])) },
      });
      return;
    }
    noStore(res);
    res.json(await viewFor(retreat, questionnaire, memberId));
  }),
);

/* ─────────────────────────────── files ────────────────────────────────── */

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => {
      const dir = partsDir("protected");
      fs.mkdir(dir, { recursive: true }).then(() => done(null, dir), (error) => done(error as Error, dir));
    },
    filename: (_req, _file, done) => done(null, `.retreatq-${crypto.randomBytes(12).toString("hex")}`),
  }),
  limits: { fileSize: QUESTIONNAIRE_FILE_MAX_MB * 1024 * 1024, files: 1, fields: 3 },
});

/** Moves a staged upload to its protected reference (S3 or the protected disk root). */
async function commitStaged(staged: string, reference: string, mime: string): Promise<void> {
  if (usesS3Media()) {
    await persistStagedMedia(reference, staged, mime);
    await finishStagedMedia(staged);
    return;
  }
  const destination = uploadPath(reference);
  if (!destination) throw new Error("Invalid storage reference");
  await fs.mkdir(nodePath.dirname(destination), { recursive: true });
  await fs.rename(staged, destination);
}

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

type WithContext = Request & { questionnaireContext?: Awaited<ReturnType<typeof loadContext>> };

/**
 * POST …/questionnaires/:key/files — one photo or PDF for a "file / photo"
 * question. Membership is proven before any bytes are accepted; the file is
 * identified from its own bytes and kept in protected storage. The answer only
 * points at it once she saves the form.
 */
memberRetreatQuestionnairesRouter.post(
  "/retreats/:slug/questionnaires/:key/files",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    (req as WithContext).questionnaireContext = await loadContext(req);
    next();
  }),
  fileUpload.single("file"),
  asyncHandler(async (req, res) => {
    const { memberId, retreat, questionnaire } = (req as WithContext).questionnaireContext!;
    const file = req.file;
    try {
      const questionId = typeof req.body?.questionId === "string" ? req.body.questionId : "";
      const audience = await guestRoomType(retreat.id, memberId);
      const question = allQuestions(questionnaire.definition).find(({ question: q }) => q.id === questionId)?.question;
      if (!question || question.type !== "file" || !audienceAllows(question, audience)) throw badRequest("That question doesn't take a file.");
      if (!file || file.size === 0) throw badRequest("Choose a photo or PDF to upload.");
      const sniffed = sniffQuestionnaireFile(await readHead(file.path));
      if (!sniffed) throw badRequest("Upload a photo (JPEG, PNG, WebP or GIF) or a PDF. On iPhone, choose “Most Compatible” for photos.");
      const reference = protectedRef(`retreat-questionnaires/r${retreat.id}/${crypto.randomBytes(16).toString("hex")}${sniffed.ext}`);
      await commitStaged(file.path, reference, sniffed.mime);
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO retreat_questionnaire_files (questionnaire_id, member_id, question_id, storage_ref, mime, size_bytes, original_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [questionnaire.id, memberId, question.id, reference, sniffed.mime, file.size, (file.originalname || "").slice(0, 200)],
      );
      noStore(res);
      res.status(201).json({ id: inserted.rows[0].id, questionId: question.id, name: (file.originalname || "").slice(0, 200), mime: sniffed.mime });
    } finally {
      if (file) await fs.unlink(file.path).catch(() => undefined);
    }
  }),
);

/** GET …/questionnaires/:key/files/:fileId — her OWN file only (any other id is a 404). */
memberRetreatQuestionnairesRouter.get(
  "/retreats/:slug/questionnaires/:key/files/:fileId",
  asyncHandler(async (req, res, next) => {
    const { memberId, questionnaire } = await loadContext(req);
    const fileId = Number(req.params.fileId);
    if (!Number.isSafeInteger(fileId) || fileId <= 0 || fileId > 2_147_483_647) throw notFound("We couldn't find that file.");
    const found = await pool.query<{ storage_ref: string; mime: string }>(
      `SELECT storage_ref, mime FROM retreat_questionnaire_files WHERE id = $1 AND questionnaire_id = $2 AND member_id = $3`,
      [fileId, questionnaire.id, memberId],
    );
    const row = found.rows[0];
    if (!row) throw notFound("We couldn't find that file.");
    await sendStoredFile(req, res, next, row.storage_ref, row.mime);
  }),
);

export async function sendStoredFile(req: Request, res: Response, next: NextFunction, reference: string, mime: string): Promise<void> {
  res.setHeader("Content-Type", safeMime(mime));
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  if (usesS3Media()) {
    await serveStoredMedia(req, res, reference);
    return;
  }
  const path = await resolveStoredFile(reference);
  if (!path) throw notFound("That file isn't available at the moment.");
  res.sendFile(path, (error) => {
    if (error && !res.headersSent) next(error);
  });
}
