import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";

/**
 * Owner-editable retreat questionnaires (Yvette's item 7, 22 Nov 2026;
 * migration 224). A questionnaire belongs to one retreat. Its questions are
 * DATA: an immutable, numbered version per save, so the owner can add, edit,
 * reorder and remove questions without a developer — and without ever changing
 * what an earlier guest was asked or answered:
 *
 *   * retreat_questionnaire_versions rows are only ever inserted.
 *   * a response stores the version it was saved against plus a snapshot of
 *     each answered question's wording (label, type, options, section);
 *   * every submission is copied, with that snapshot, into
 *     retreat_questionnaire_submissions and never updated;
 *   * an answer to a question that was later removed is kept, with its
 *     original wording, rather than dropped on the next save.
 *
 * Nothing here sends email or raises an automation event.
 */

type Queryable = Pick<PoolClient, "query"> | typeof pool;

/* ─────────────────────────────── definition ───────────────────────────── */

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multiple_choice",
  "dropdown",
  "date",
  "time",
  "file",
  "yes_no",
  "checkbox",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CHOICE_TYPES: readonly QuestionType[] = ["single_choice", "multiple_choice", "dropdown"];

/** Who a question is shown to. "shared_room": only guests booked into a shared room. */
export const AUDIENCES = ["all", "shared_room", "private_room"] as const;
export type QuestionAudience = (typeof AUDIENCES)[number];

export type RoomType = "private" | "shared";
/** The viewer a definition is filtered for. "all" = the owner's preview of every question. */
export type Audience = RoomType | "unknown" | "all";

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const text = (max: number) => z.string().trim().max(max);

export const questionSchema = z
  .object({
    id: z.string().regex(ID, "Question ids use lowercase letters, numbers, - and _."),
    type: z.enum(QUESTION_TYPES),
    label: text(1000).min(1, "Every question needs its wording."),
    help: text(2000).default(""),
    required: z.boolean().default(false),
    options: z.array(text(300).min(1)).max(60).default([]),
    showTo: z.enum(AUDIENCES).default("all"),
    /** Shown only when another question's answer is one of `anyOf` (empty = "has any answer"). */
    showIf: z
      .object({ questionId: z.string().regex(ID), anyOf: z.array(text(300)).max(60).default([]) })
      .nullable()
      .default(null),
    /** Health or similar: organizer-only, left out of exports unless asked for, never shown to other guests. */
    sensitive: z.boolean().default(false),
  })
  .strict();

export const sectionSchema = z
  .object({
    id: z.string().regex(ID),
    title: text(200).default(""),
    description: text(4000).default(""),
    questions: z.array(questionSchema).max(100),
  })
  .strict();

export const definitionSchema = z
  .object({
    intro: text(6000).default(""),
    sections: z.array(sectionSchema).min(1).max(30),
  })
  .strict();

export type Question = z.infer<typeof questionSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Definition = z.infer<typeof definitionSchema>;

export function allQuestions(definition: Definition): { question: Question; section: Section }[] {
  return definition.sections.flatMap((section) => section.questions.map((question) => ({ question, section })));
}

/**
 * Parses and checks a definition the owner saved. Returns the clean definition
 * or a list of plain-language problems.
 */
export function parseDefinition(raw: unknown): { definition: Definition | null; problems: string[] } {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) {
    return { definition: null, problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  const definition = parsed.data;
  const problems: string[] = [];
  const sectionIds = new Set<string>();
  for (const section of definition.sections) {
    if (sectionIds.has(section.id)) problems.push(`Two sections share the id "${section.id}".`);
    sectionIds.add(section.id);
  }
  const byId = new Map<string, Question>();
  const total = allQuestions(definition).length;
  if (total > 200) problems.push("A questionnaire can have up to 200 questions.");
  for (const { question } of allQuestions(definition)) {
    if (byId.has(question.id)) problems.push(`Two questions share the id "${question.id}".`);
    byId.set(question.id, question);
    if (CHOICE_TYPES.includes(question.type)) {
      if (question.options.length < 1) problems.push(`"${question.label}" needs at least one option.`);
      if (new Set(question.options).size !== question.options.length) problems.push(`"${question.label}" lists the same option twice.`);
    } else if (question.options.length > 0) {
      question.options = [];
    }
  }
  for (const { question } of allQuestions(definition)) {
    if (!question.showIf) continue;
    const target = byId.get(question.showIf.questionId);
    if (!target) problems.push(`"${question.label}" depends on a question that isn't in this questionnaire.`);
    else if (target.id === question.id) problems.push(`"${question.label}" can't depend on itself.`);
    else if (question.showIf.anyOf.some((value) => CHOICE_TYPES.includes(target.type) && !target.options.includes(value))) {
      problems.push(`"${question.label}" depends on an answer that "${target.label}" doesn't offer.`);
    }
  }
  return { definition: problems.length ? null : definition, problems };
}

/* ─────────────────────────────── wording ──────────────────────────────── */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2027-06-15".."2027-06-20" → "June 15–20, 2027" (no time-zone shift). */
export function formatDateRange(start: string, end: string): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(end);
  if (!a || !b) return "";
  const one = (m: RegExpExecArray) => `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  if (a[0] === b[0]) return one(a);
  if (a[1] === b[1] && a[2] === b[2]) return `${MONTHS[Number(a[2]) - 1]} ${Number(a[3])}–${Number(b[3])}, ${a[1]}`;
  if (a[1] === b[1]) return `${MONTHS[Number(a[2]) - 1]} ${Number(a[3])} – ${MONTHS[Number(b[2]) - 1]} ${Number(b[3])}, ${a[1]}`;
  return `${one(a)} – ${one(b)}`;
}

export interface WordingContext {
  destination: string;
  startDate: string;
  endDate: string;
  title: string;
  airport: string;
}

/**
 * Fills the reusable wording tokens from the retreat: {{destination}},
 * {{dates}}, {{retreat}} and {{airport}}. Anything else in double braces is
 * removed, so an unresolved placeholder can never reach a guest.
 */
export function renderWording(textIn: string, ctx: WordingContext): string {
  const values: Record<string, string> = {
    destination: ctx.destination,
    dates: formatDateRange(ctx.startDate, ctx.endDate),
    retreat: ctx.title,
    airport: ctx.airport,
  };
  return textIn
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, key: string) => values[key] ?? "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/[ \t]+([,.!?])/g, "$1");
}

/* ─────────────────────────────── visibility ───────────────────────────── */

export function audienceAllows(question: Question, audience: Audience): boolean {
  if (question.showTo === "all" || audience === "all") return true;
  if (question.showTo === "shared_room") return audience === "shared";
  return audience === "private";
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "" || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Whether a question's "show only if" condition holds for these answers. */
export function conditionHolds(question: Question, answers: Record<string, unknown>): boolean {
  if (!question.showIf) return true;
  const value = answers[question.showIf.questionId];
  if (question.showIf.anyOf.length === 0) return hasValue(value);
  const chosen = Array.isArray(value) ? value : [value];
  return chosen.some((item) => typeof item === "string" && question.showIf!.anyOf.includes(item));
}

/* ─────────────────────────────── answers ──────────────────────────────── */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^([01]\d|2[0-3]):[0-5]\d$/;

function validDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** One answer, cleaned for its question type, or undefined when it is not a usable answer. */
export function cleanAnswer(question: Question, value: unknown): unknown {
  switch (question.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim().slice(0, question.type === "short_text" ? 500 : 5000);
      return trimmed === "" ? undefined : trimmed;
    }
    case "single_choice":
    case "dropdown":
      return typeof value === "string" && question.options.includes(value) ? value : undefined;
    case "multiple_choice": {
      if (!Array.isArray(value)) return undefined;
      const picked = question.options.filter((option) => value.includes(option));
      return picked.length ? picked : undefined;
    }
    case "date":
      return typeof value === "string" && validDate(value) ? value : undefined;
    case "time":
      return typeof value === "string" && TIME_ONLY.test(value) ? value : undefined;
    case "yes_no":
      return value === "yes" || value === "no" ? value : undefined;
    case "checkbox":
      return value === true ? true : undefined;
    case "file": {
      const id = Number(value);
      return Number.isSafeInteger(id) && id > 0 ? id : undefined;
    }
  }
}

export interface SnapshotEntry {
  label: string;
  type: QuestionType;
  section: string;
  options: string[];
  sensitive: boolean;
  version: number;
}

export interface AnswerValidation {
  answers: Record<string, unknown>;
  snapshot: Record<string, SnapshotEntry>;
  errors: Record<string, string>;
}

/**
 * Builds the answers to store from what the guest sent and what is already
 * stored. Only questions she can see are taken from the request; a question
 * hidden from her by her room type keeps whatever was stored; a question the
 * owner has since removed keeps its stored answer and original wording; a
 * question hidden by her own answer (a "show only if" that no longer holds) is
 * cleared, because she changed the answer it depended on.
 *
 * `ownedFileIds` is the set of file ids this guest uploaded for this
 * questionnaire: a file answer naming any other id is ignored.
 */
export function buildAnswers(input: {
  definition: Definition;
  version: number;
  audience: Audience;
  submitted: unknown;
  stored: { answers: Record<string, unknown>; snapshot: Record<string, SnapshotEntry> };
  ownedFileIds: Map<number, string>;
  submit: boolean;
}): AnswerValidation {
  const sent = input.submitted !== null && typeof input.submitted === "object" && !Array.isArray(input.submitted)
    ? (input.submitted as Record<string, unknown>)
    : {};
  const currentIds = new Set(allQuestions(input.definition).map(({ question }) => question.id));
  const answers: Record<string, unknown> = {};
  const snapshot: Record<string, SnapshotEntry> = {};

  // Answers to removed questions: kept exactly as stored.
  for (const [id, value] of Object.entries(input.stored.answers)) {
    if (!currentIds.has(id)) {
      answers[id] = value;
      if (input.stored.snapshot[id]) snapshot[id] = input.stored.snapshot[id];
    }
  }

  const entry = (question: Question, section: Section): SnapshotEntry => ({
    label: question.label,
    type: question.type,
    section: section.title,
    options: [...question.options],
    sensitive: question.sensitive,
    version: input.version,
  });

  // First pass: the values themselves.
  const candidate: Record<string, unknown> = {};
  for (const { question } of allQuestions(input.definition)) {
    if (!audienceAllows(question, input.audience)) continue;
    let value = cleanAnswer(question, sent[question.id]);
    if (question.type === "file" && value !== undefined && input.ownedFileIds.get(value as number) !== question.id) value = undefined;
    if (value !== undefined) candidate[question.id] = value;
  }

  const errors: Record<string, string> = {};
  for (const { question, section } of allQuestions(input.definition)) {
    if (!audienceAllows(question, input.audience)) {
      // Not hers to see: keep what was stored, untouched.
      if (input.stored.answers[question.id] !== undefined) {
        answers[question.id] = input.stored.answers[question.id];
        if (input.stored.snapshot[question.id]) snapshot[question.id] = input.stored.snapshot[question.id];
      }
      continue;
    }
    if (!conditionHolds(question, candidate)) continue;
    const value = candidate[question.id];
    if (value !== undefined) {
      answers[question.id] = value;
      snapshot[question.id] = entry(question, section);
    } else if (input.submit && question.required) {
      errors[question.id] = question.type === "checkbox" ? "Please tick this box to continue." : "Please answer this question.";
    }
  }
  return { answers, snapshot, errors };
}

/* ─────────────────────────────── records ──────────────────────────────── */

export interface QuestionnaireRow {
  id: number;
  retreat_id: number;
  key: string;
  title: string;
  in_checklist: boolean;
  due_date: string | null;
  sort: number;
  archived: boolean;
  current_version: number;
  definition: unknown;
  updated_at: Date;
}

const QUESTIONNAIRE_SELECT = `SELECT q.id, q.retreat_id, q.key, q.title, q.in_checklist, q.due_date::text AS due_date, q.sort,
       q.archived, q.current_version, v.definition, q.updated_at
  FROM retreat_questionnaires q
  JOIN retreat_questionnaire_versions v ON v.questionnaire_id = q.id AND v.version = q.current_version`;

export async function loadQuestionnaires(retreatId: number, opts: { includeArchived?: boolean } = {}, db: Queryable = pool) {
  const result = await db.query<QuestionnaireRow>(
    `${QUESTIONNAIRE_SELECT} WHERE q.retreat_id = $1 ${opts.includeArchived ? "" : "AND NOT q.archived"} ORDER BY q.sort, q.id`,
    [retreatId],
  );
  return result.rows.map((row) => ({ ...row, definition: safeDefinition(row.definition) }));
}

export async function loadQuestionnaire(retreatId: number, questionnaireId: number, db: Queryable = pool) {
  const result = await db.query<QuestionnaireRow>(`${QUESTIONNAIRE_SELECT} WHERE q.retreat_id = $1 AND q.id = $2`, [retreatId, questionnaireId]);
  const row = result.rows[0];
  return row ? { ...row, definition: safeDefinition(row.definition) } : null;
}

export async function loadQuestionnaireByKey(retreatId: number, key: string, db: Queryable = pool) {
  const result = await db.query<QuestionnaireRow>(`${QUESTIONNAIRE_SELECT} WHERE q.retreat_id = $1 AND q.key = $2 AND NOT q.archived`, [retreatId, key]);
  const row = result.rows[0];
  return row ? { ...row, definition: safeDefinition(row.definition) } : null;
}

/** A stored definition that no longer parses is shown as empty, never as raw JSON. */
export function safeDefinition(raw: unknown): Definition {
  const parsed = definitionSchema.safeParse(raw);
  return parsed.success ? parsed.data : { intro: "", sections: [{ id: "main", title: "", description: "", questions: [] }] };
}

export type LoadedQuestionnaire = Awaited<ReturnType<typeof loadQuestionnaires>>[number];

export interface ResponseRow {
  id: number;
  questionnaire_id: number;
  version: number;
  answers: Record<string, unknown>;
  question_snapshot: Record<string, SnapshotEntry>;
  state: "draft" | "submitted";
  revision: number;
  review_status: "verified" | "needs_attention" | null;
  review_note: string;
  reviewed_at: Date | null;
  updated_at: Date;
  submitted_at: Date | null;
}

const RESPONSE_COLUMNS = `r.id, r.questionnaire_id, r.version, r.answers, r.question_snapshot, r.state, r.revision,
  r.review_status, r.review_note, r.reviewed_at, r.updated_at, r.submitted_at`;

/** This guest's responses on this retreat, keyed by questionnaire id. Always scoped to one member. */
export async function loadResponses(retreatId: number, memberId: number, db: Queryable = pool): Promise<Map<number, ResponseRow>> {
  const result = await db.query<ResponseRow>(
    `SELECT ${RESPONSE_COLUMNS}
       FROM retreat_questionnaire_responses r
       JOIN retreat_questionnaires q ON q.id = r.questionnaire_id
      WHERE q.retreat_id = $1 AND r.member_id = $2`,
    [retreatId, memberId],
  );
  return new Map(result.rows.map((row) => [row.questionnaire_id, row]));
}

export async function loadOwnedFiles(questionnaireId: number, memberId: number, db: Queryable = pool) {
  const result = await db.query<{ id: number; question_id: string; original_name: string; mime: string; size_bytes: string }>(
    `SELECT id, question_id, original_name, mime, size_bytes FROM retreat_questionnaire_files
      WHERE questionnaire_id = $1 AND member_id = $2`,
    [questionnaireId, memberId],
  );
  return result.rows;
}

/**
 * The room a guest booked: the organizer's own setting wins (imported/Kajabi
 * bookings have no order here), otherwise the room of her paid order on one of
 * this retreat's offers. "unknown" sees neither room-specific question.
 */
export async function guestRoomType(retreatId: number, memberId: number, db: Queryable = pool): Promise<RoomType | "unknown"> {
  const set = await db.query<{ room_type: RoomType | null }>(
    `SELECT room_type FROM retreat_guests WHERE retreat_id = $1 AND member_id = $2`,
    [retreatId, memberId],
  );
  if (set.rows[0]?.room_type) return set.rows[0].room_type;
  const ordered = await db.query<{ room_type: RoomType }>(
    `SELECT ro.room_type FROM orders o
       JOIN retreat_offers ro ON ro.offer_id = o.offer_id AND ro.retreat_id = $1
      WHERE o.member_id = $2 AND o.status = 'paid' AND ro.room_type IS NOT NULL
      ORDER BY o.created_at DESC LIMIT 1`,
    [retreatId, memberId],
  );
  return ordered.rows[0]?.room_type ?? "unknown";
}

/* ─────────────────────────────── views ────────────────────────────────── */

export type QuestionnaireStatus = "not_started" | "in_progress" | "submitted" | "verified" | "needs_attention";

export function responseStatus(row: ResponseRow | undefined): QuestionnaireStatus {
  if (!row) return "not_started";
  const base: QuestionnaireStatus = row.state === "submitted" ? "submitted" : "in_progress";
  if (row.review_status && row.reviewed_at && new Date(row.reviewed_at).getTime() >= new Date(row.updated_at).getTime()) {
    return row.review_status;
  }
  return base;
}

/** The questionnaire as one viewer sees it: questions for her audience, tokens filled in. */
export function viewDefinition(definition: Definition, audience: Audience, ctx: WordingContext) {
  return {
    intro: renderWording(definition.intro, ctx),
    sections: definition.sections
      .map((section) => ({
        id: section.id,
        title: renderWording(section.title, ctx),
        description: renderWording(section.description, ctx),
        questions: section.questions
          .filter((question) => audienceAllows(question, audience))
          .map((question) => ({
            id: question.id,
            type: question.type,
            label: renderWording(question.label, ctx),
            help: renderWording(question.help, ctx),
            required: question.required,
            options: question.options,
            showTo: question.showTo,
            showIf: question.showIf,
          })),
      }))
      .filter((section) => section.questions.length > 0),
  };
}

export function guestQuestionnaireView(
  q: LoadedQuestionnaire,
  response: ResponseRow | undefined,
  files: { id: number; question_id: string; original_name: string; mime: string }[],
  audience: Audience,
  ctx: WordingContext,
) {
  const definition = viewDefinition(q.definition, audience, ctx);
  const visibleIds = new Set(definition.sections.flatMap((s) => s.questions.map((qq) => qq.id)));
  const answers = Object.fromEntries(Object.entries(response?.answers ?? {}).filter(([id]) => visibleIds.has(id)));
  const status = responseStatus(response);
  return {
    id: q.id,
    key: q.key,
    title: q.title,
    dueDate: q.due_date,
    version: q.current_version,
    definition,
    status,
    reviewNote: status === "needs_attention" ? response?.review_note || null : null,
    response: {
      state: (response?.state ?? "none") as "none" | "draft" | "submitted",
      answers,
      revision: response?.revision ?? 0,
      updatedAt: response ? new Date(response.updated_at).toISOString() : null,
      submittedAt: response?.submitted_at ? new Date(response.submitted_at).toISOString() : null,
    },
    files: files
      .filter((file) => visibleIds.has(file.question_id))
      .map((file) => ({ id: file.id, questionId: file.question_id, name: file.original_name, mime: file.mime })),
  };
}

/* ─────────────────────────────── writes ───────────────────────────────── */

/**
 * Saves a guest's answers (draft, or a validated submission). `revision` is the
 * one she loaded: a save from a stale tab is refused rather than silently
 * replacing newer answers. Submitting copies the answers and their wording into
 * the append-only submissions table.
 */
export async function saveResponse(input: {
  questionnaire: LoadedQuestionnaire;
  memberId: number;
  audience: Audience;
  answers: unknown;
  submit: boolean;
  revision: number;
}): Promise<{ ok: true; row: ResponseRow } | { ok: false; conflict?: true; errors?: Record<string, string> }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<ResponseRow>(
      `SELECT ${RESPONSE_COLUMNS} FROM retreat_questionnaire_responses r
        WHERE r.questionnaire_id = $1 AND r.member_id = $2 FOR UPDATE`,
      [input.questionnaire.id, input.memberId],
    );
    const current = existing.rows[0];
    if ((current?.revision ?? 0) !== input.revision) {
      await client.query("ROLLBACK");
      return { ok: false, conflict: true };
    }
    const files = await loadOwnedFiles(input.questionnaire.id, input.memberId, client);
    const built = buildAnswers({
      definition: input.questionnaire.definition,
      version: input.questionnaire.current_version,
      audience: input.audience,
      submitted: input.answers,
      stored: { answers: current?.answers ?? {}, snapshot: current?.question_snapshot ?? {} },
      ownedFileIds: new Map(files.map((file) => [file.id, file.question_id])),
      submit: input.submit,
    });
    if (Object.keys(built.errors).length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, errors: built.errors };
    }
    // "Save progress" after a submission makes it a draft again (her changes are
    // not submitted yet); the earlier submission stays in the history table.
    const state = input.submit ? "submitted" : "draft";
    const saved = await client.query<ResponseRow>(
      current
        ? `UPDATE retreat_questionnaire_responses r
              SET version = $3, answers = $4::jsonb, question_snapshot = $5::jsonb, state = $6,
                  revision = revision + 1, updated_at = now(),
                  submitted_at = CASE WHEN $7 THEN now() ELSE submitted_at END
            WHERE questionnaire_id = $1 AND member_id = $2
            RETURNING ${RESPONSE_COLUMNS}`
        : `INSERT INTO retreat_questionnaire_responses AS r
             (questionnaire_id, member_id, version, answers, question_snapshot, state, submitted_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, CASE WHEN $7 THEN now() END)
           RETURNING ${RESPONSE_COLUMNS}`,
      [
        input.questionnaire.id,
        input.memberId,
        input.questionnaire.current_version,
        JSON.stringify(built.answers),
        JSON.stringify(built.snapshot),
        state,
        input.submit,
      ],
    );
    const row = saved.rows[0];
    if (input.submit) {
      await client.query(
        `INSERT INTO retreat_questionnaire_submissions (response_id, version, answers, question_snapshot)
         VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
        [row.id, row.version, JSON.stringify(row.answers), JSON.stringify(row.question_snapshot)],
      );
    }
    await client.query("COMMIT");
    return { ok: true, row };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Saves the owner's edited definition. Unchanged → no new version. Changed →
 * version N+1 is inserted and becomes current; version N is left exactly as it
 * was, so every earlier answer still points at the wording it was given.
 */
export async function saveDefinition(
  questionnaireId: number,
  definition: Definition,
  adminId: number | null,
  db: Queryable = pool,
): Promise<{ version: number; changed: boolean }> {
  const current = await db.query<{ current_version: number; definition: unknown }>(
    `SELECT q.current_version, v.definition FROM retreat_questionnaires q
       JOIN retreat_questionnaire_versions v ON v.questionnaire_id = q.id AND v.version = q.current_version
      WHERE q.id = $1 FOR UPDATE OF q`,
    [questionnaireId],
  );
  const row = current.rows[0];
  if (row && JSON.stringify(safeDefinition(row.definition)) === JSON.stringify(definition)) {
    return { version: row.current_version, changed: false };
  }
  const next = await db.query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM retreat_questionnaire_versions WHERE questionnaire_id = $1`,
    [questionnaireId],
  );
  const version = next.rows[0].version;
  await db.query(
    `INSERT INTO retreat_questionnaire_versions (questionnaire_id, version, definition, created_by) VALUES ($1, $2, $3::jsonb, $4)`,
    [questionnaireId, version, JSON.stringify(definition), adminId],
  );
  await db.query(`UPDATE retreat_questionnaires SET current_version = $2, updated_at = now() WHERE id = $1`, [questionnaireId, version]);
  return { version, changed: true };
}

/** Creates a questionnaire with its version 1 (used by "add" and by "duplicate retreat"). */
export async function createQuestionnaire(
  input: { retreatId: number; key: string; title: string; inChecklist: boolean; dueDate: string | null; sort: number; definition: Definition; adminId: number | null },
  db: Queryable = pool,
): Promise<number> {
  const created = await db.query<{ id: number }>(
    `INSERT INTO retreat_questionnaires (retreat_id, key, title, in_checklist, due_date, sort, current_version)
     VALUES ($1, $2, $3, $4, $5::date, $6, 1) RETURNING id`,
    [input.retreatId, input.key, input.title, input.inChecklist, input.dueDate, input.sort],
  );
  const id = created.rows[0].id;
  await db.query(
    `INSERT INTO retreat_questionnaire_versions (questionnaire_id, version, definition, created_by) VALUES ($1, 1, $2::jsonb, $3)`,
    [id, JSON.stringify(input.definition), input.adminId],
  );
  return id;
}

/** Copies a retreat's questionnaires (current wording only, as version 1). Never copies a response or file. */
export async function copyQuestionnaires(fromRetreatId: number, toRetreatId: number, adminId: number | null, db: Queryable) {
  const source = await loadQuestionnaires(fromRetreatId, {}, db);
  for (const q of source) {
    await createQuestionnaire(
      { retreatId: toRetreatId, key: q.key, title: q.title, inChecklist: q.in_checklist, dueDate: null, sort: q.sort, definition: q.definition, adminId },
      db,
    );
  }
  return source.length;
}

/** A new, empty questionnaire's first version. */
export function blankDefinition(): Definition {
  return { intro: "", sections: [{ id: "section-1", title: "", description: "", questions: [] }] };
}

export function questionnaireKey(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/g, "") || "questionnaire"
  );
}

/* ─────────────────────────────── files ────────────────────────────────── */

/** Photos (JPEG, PNG, WebP, GIF) and PDFs (a flight confirmation), identified from their bytes. */
export function sniffQuestionnaireFile(head: Buffer): { mime: string; ext: string } | null {
  const starts = (...bytes: number[]) => head.length >= bytes.length && bytes.every((byte, i) => head[i] === byte);
  if (starts(0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: ".jpg" };
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: "image/png", ext: ".png" };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { mime: "image/gif", ext: ".gif" };
  if (starts(0x52, 0x49, 0x46, 0x46) && head.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: ".webp" };
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return { mime: "application/pdf", ext: ".pdf" };
  return null;
}

export const QUESTIONNAIRE_FILE_MAX_MB = 15;

/* ─────────────────────────────── CSV ──────────────────────────────────── */

/** A spreadsheet cell that cannot be read as a formula. */
export function csvCell(value: unknown): string {
  let out = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("; ") : typeof value === "boolean" ? (value ? "Yes" : "") : String(value);
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  return /[",\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}
