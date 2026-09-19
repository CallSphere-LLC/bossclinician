import crypto from "crypto";
import type { Request, Response } from "express";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import type { VoiceIdentity, VoiceSurface } from "./contract";

/**
 * Everything the concierge remembers: who was talking, what was said, what she
 * approved, and where the audio ended up.
 *
 * The rule this whole file is built around is that **a session id is not a
 * capability**. It travels to the browser, it appears in a URL, and it is
 * guessable-adjacent the moment one is leaked — so naming a session proves
 * nothing. Every route that touches one re-derives who is asking from the
 * request's own credentials and compares. That is what `sessionBelongsTo` is,
 * and why it is a pure function with tests rather than a condition inlined in
 * three route handlers that will drift apart.
 */

/* ------------------------------------------------------------- the caller */

/**
 * Who a request to /api/voice/* has proved itself to be.
 *
 * `identity` is the contract's shape — what the surface is resolved against.
 * `visitorId` is the extra thing an anonymous visitor has: a first-party cookie
 * that makes a signed-out conversation ownable at all. Without it, an anonymous
 * session would have no owner, and "is this your transcript?" would have no
 * answer but yes.
 */
export type VoiceCaller = {
  identity: VoiceIdentity;
  visitorId: string | null;
};

/** The cookie an anonymous visitor is known by. Read by the server only. */
export const VOICE_VISITOR_COOKIE = "bc_voice_visitor";

/** A year: long enough that a walkthrough is not re-offered next month. */
const VISITOR_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * A cookie value is only an owner if it is one we minted.
 *
 * The value arrives from the browser and is then compared against stored rows,
 * so a caller who can put anything in it could go fishing for somebody else's
 * session by supplying their id. Constraining the shape does not stop that on
 * its own — 128 bits of entropy does — but it does stop the degenerate cases
 * (an empty string, a SQL-ish blob, a value shared by copy-paste) from ever
 * matching a row.
 */
const VISITOR_ID_SHAPE = /^[0-9a-f]{32}$/;

export function readVoiceVisitorId(req: Request): string | null {
  const raw: unknown = req.cookies?.[VOICE_VISITOR_COOKIE];
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return VISITOR_ID_SHAPE.test(value) ? value : null;
}

/**
 * The visitor id for this browser, minting and setting one if it has none.
 *
 * Called by every route that has a response to attach a cookie to — including
 * `POST /api/voice/session`, so that a session is opened with an owner already
 * in hand rather than claiming one afterwards.
 */
export function ensureVoiceVisitorId(req: Request, res: Response): string {
  const existing = readVoiceVisitorId(req);
  if (existing !== null) return existing;

  const minted = crypto.randomBytes(16).toString("hex");
  res.cookie(VOICE_VISITOR_COOKIE, minted, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_MS,
  });
  // Written back onto the request so a handler that reads it twice in one pass
  // gets the value it just minted rather than minting a second one.
  if (req.cookies) req.cookies[VOICE_VISITOR_COOKIE] = minted;
  return minted;
}

/**
 * Who is asking is decided by `identityFromRequest` in routes/voice/session.ts,
 * which runs the app's own admin and member middleware rather than a second
 * implementation of "is this person still allowed in". What it cannot know is
 * the anonymous half — hence the cookie above — so a caller is that identity
 * plus this visitor id, assembled by each route.
 */

/* ------------------------------------------------------------ the session */

export type VoiceSessionMode = "voice" | "text";

export type VoiceSessionRow = {
  id: string;
  surface: VoiceSurface;
  mode: VoiceSessionMode;
  memberId: number | null;
  adminUserId: number | null;
  visitorId: string | null;
  path: string;
  ip: string;
  userAgent: string;
  startedAt: string;
  endedAt: string | null;
  seconds: number | null;
  endReason: string;
  recordingKey: string | null;
  recordingBytes: number | null;
  recordingContentType: string | null;
  /** How many parts of the audio have arrived. Zero until the first one does. */
  recordingChunks: number;
  /** Set when the parts were joined into one playable object. */
  recordingFinalizedAt: string | null;
};

export type OpenSessionInput = {
  surface: VoiceSurface;
  identity: VoiceIdentity;
  path: string;
  ip: string;
  userAgent: string;
  /**
   * The anonymous visitor's cookie, from `ensureVoiceVisitorId`. Optional so
   * the broker's call compiles without it — but a session opened without one
   * for a signed-out visitor has no owner until the first transcript append
   * claims it (see `loadSessionForCaller`), which is a weaker guarantee than
   * passing it here.
   */
  visitorId?: string | null;
  /** Voice unless the typed transport says otherwise. */
  mode?: VoiceSessionMode;
};

const SELECT_SESSION = `
  SELECT id, surface, mode, member_id, admin_user_id, visitor_id, path, ip, user_agent,
         started_at, ended_at, seconds, end_reason,
         recording_key, recording_bytes, recording_content_type,
         recording_chunks, recording_finalized_at
    FROM voice_sessions`;

type SessionDbRow = {
  id: string;
  surface: string;
  mode: string;
  member_id: number | null;
  admin_user_id: number | null;
  visitor_id: string | null;
  path: string;
  ip: string;
  user_agent: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  seconds: number | null;
  end_reason: string;
  recording_key: string | null;
  recording_bytes: string | number | null;
  recording_content_type: string | null;
  recording_chunks: number;
  recording_finalized_at: Date | string | null;
};

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toSession(row: SessionDbRow): VoiceSessionRow {
  return {
    id: row.id,
    surface: row.surface as VoiceSurface,
    mode: row.mode as VoiceSessionMode,
    memberId: row.member_id,
    adminUserId: row.admin_user_id,
    visitorId: row.visitor_id,
    path: row.path,
    ip: row.ip,
    userAgent: row.user_agent,
    startedAt: asIso(row.started_at) ?? "",
    endedAt: asIso(row.ended_at),
    seconds: row.seconds,
    endReason: row.end_reason,
    recordingKey: row.recording_key,
    // BIGINT arrives from pg as a string, because it can hold more than a JS
    // number safely. A recording never will, so it is narrowed here once.
    recordingBytes: row.recording_bytes === null ? null : Number(row.recording_bytes),
    recordingContentType: row.recording_content_type,
    recordingChunks: row.recording_chunks,
    recordingFinalizedAt: asIso(row.recording_finalized_at),
  };
}

/**
 * Opens the row every later request hangs off.
 *
 * The id is minted here rather than by the database: the browser has to be told
 * what its session is called in the same response that opens it, and the voice
 * transport names that id from its first transcribed line — before any other
 * request of ours has been made.
 */
export async function openSession(input: OpenSessionInput): Promise<{ sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const memberId = input.identity.audience === "member" ? input.identity.memberId : null;
  const adminUserId = input.identity.audience === "admin" ? input.identity.adminUserId : null;
  // Only an otherwise-unidentified caller is owned by a cookie. Storing it for
  // a signed-in member as well would give a shared browser two ways to claim
  // the same conversation.
  const visitorId = memberId === null && adminUserId === null ? (input.visitorId ?? null) : null;

  await pool.query(
    `INSERT INTO voice_sessions
       (id, surface, mode, member_id, admin_user_id, visitor_id, path, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      sessionId,
      input.surface,
      input.mode ?? "voice",
      memberId,
      adminUserId,
      visitorId,
      input.path.slice(0, 2000),
      input.ip.slice(0, 100),
      input.userAgent.slice(0, 1000),
    ]
  );

  return { sessionId };
}

/* ------------------------------------------------------------- ownership */

/**
 * Whether this caller may read and write this conversation.
 *
 * Pure, and deliberately so: it is the security decision the three public
 * routes share, it has to be identical in all three, and it is the one thing
 * here that can be proved without a database.
 *
 * A signed-in identity matches by id. A signed-out one matches only by the
 * visitor cookie, and a row with no owner at all matches nobody — an
 * unclaimable row is refused rather than treated as public.
 */
export function sessionBelongsTo(
  row: Pick<VoiceSessionRow, "memberId" | "adminUserId" | "visitorId">,
  caller: VoiceCaller
): boolean {
  if (row.adminUserId !== null) {
    return caller.identity.audience === "admin" && caller.identity.adminUserId === row.adminUserId;
  }
  if (row.memberId !== null) {
    return caller.identity.audience === "member" && caller.identity.memberId === row.memberId;
  }
  if (row.visitorId !== null) {
    return caller.visitorId !== null && caller.visitorId === row.visitorId;
  }
  return false;
}

/** A row with no owner recorded: nobody has claimed this conversation yet. */
function unclaimed(row: VoiceSessionRow): boolean {
  return row.memberId === null && row.adminUserId === null && row.visitorId === null;
}

/**
 * The session this caller named, if it is theirs.
 *
 * The claim in the middle is for one case only: a session the broker opened
 * before this browser had a visitor cookie, which therefore has no owner. The
 * first request to name it claims it, atomically, and every request afterwards
 * has to match. In practice the claimant is the browser that opened the call
 * milliseconds earlier; the window is one request wide and closes for good.
 *
 * Returns null for "no such session" and for "not yours" alike. A route that
 * distinguished them would confirm the existence of other people's
 * conversations to anyone who guessed an id.
 */
export async function loadSessionForCaller(
  sessionId: string,
  caller: VoiceCaller
): Promise<VoiceSessionRow | null> {
  const found = await pool.query<SessionDbRow>(`${SELECT_SESSION} WHERE id = $1`, [sessionId]);
  const row = found.rows[0];
  if (!row) return null;

  const session = toSession(row);
  if (sessionBelongsTo(session, caller)) return session;

  if (unclaimed(session) && caller.identity.audience === "anonymous" && caller.visitorId) {
    const claimed = await pool.query<SessionDbRow>(
      `UPDATE voice_sessions SET visitor_id = $2
        WHERE id = $1 AND member_id IS NULL AND admin_user_id IS NULL AND visitor_id IS NULL
        RETURNING id, surface, mode, member_id, admin_user_id, visitor_id, path, ip, user_agent,
                  started_at, ended_at, seconds, end_reason,
                  recording_key, recording_bytes, recording_content_type,
                  recording_chunks, recording_finalized_at`,
      [sessionId, caller.visitorId]
    );
    const won = claimed.rows[0];
    return won ? toSession(won) : null;
  }

  if (unclaimed(session) && caller.identity.audience !== "anonymous") {
    const owner =
      caller.identity.audience === "member"
        ? { column: "member_id", value: caller.identity.memberId }
        : { column: "admin_user_id", value: caller.identity.adminUserId };
    const claimed = await pool.query<SessionDbRow>(
      `UPDATE voice_sessions SET ${owner.column} = $2
        WHERE id = $1 AND member_id IS NULL AND admin_user_id IS NULL AND visitor_id IS NULL
        RETURNING id, surface, mode, member_id, admin_user_id, visitor_id, path, ip, user_agent,
                  started_at, ended_at, seconds, end_reason,
                  recording_key, recording_bytes, recording_content_type,
                  recording_chunks, recording_finalized_at`,
      [sessionId, owner.value]
    );
    const won = claimed.rows[0];
    return won ? toSession(won) : null;
  }

  return null;
}

/* ------------------------------------------------------------ transcripts */

export type TranscriptLineInput = { role: "user" | "agent"; text: string; atMs: number };

export type TranscriptLine = TranscriptLineInput & { id: string };

/**
 * The digest that makes a retried flush harmless.
 *
 * Lines are appended in batches while the call is live, and a flush whose
 * response was lost is sent again with the same contents. Keyed on the line
 * itself — who said it, when, and the words — a repeat collides with the row it
 * would have duplicated and is dropped. Two genuinely identical lines at the
 * same millisecond would collide too; that is a "yes" said twice in the same
 * frame, which is not a thing a transcript needs to show twice.
 */
export function transcriptLineKey(line: TranscriptLineInput): string {
  return crypto
    .createHash("sha256")
    .update(`${line.role}\n${line.atMs}\n${line.text}`)
    .digest("hex");
}

/** Appends a batch. Returns how many lines were new, which is what a retry reports as 0. */
export async function appendTranscript(
  sessionId: string,
  lines: TranscriptLineInput[]
): Promise<number> {
  if (lines.length === 0) return 0;

  const values: string[] = [];
  const params: unknown[] = [sessionId];
  for (const line of lines) {
    const base = params.length;
    values.push(`($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    params.push(line.role, line.text, Math.max(0, Math.trunc(line.atMs)), transcriptLineKey(line));
  }

  const inserted = await pool.query(
    `INSERT INTO voice_transcript_lines (session_id, role, text, at_ms, line_key)
     VALUES ${values.join(", ")}
     ON CONFLICT (session_id, line_key) DO NOTHING`,
    params
  );

  // The conversation is plainly still alive if words are arriving in it, and a
  // call that ends by having its tab closed will never say so itself.
  await pool.query(`UPDATE voice_sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]);

  return inserted.rowCount ?? 0;
}

export async function transcriptFor(sessionId: string): Promise<TranscriptLine[]> {
  const res = await pool.query<{ id: string; role: string; text: string; at_ms: number }>(
    `SELECT id, role, text, at_ms FROM voice_transcript_lines
      WHERE session_id = $1 ORDER BY at_ms, id`,
    [sessionId]
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    role: row.role as "user" | "agent",
    text: row.text,
    atMs: row.at_ms,
  }));
}

/* ---------------------------------------------------------------- endings */

/**
 * Closes a call and records how it ended.
 *
 * `ended_at IS NULL` in the WHERE clause, because both the browser's goodbye
 * and the server's own timeout can arrive: the first one wins and the second is
 * a no-op, rather than the length of the call being rewritten by whichever
 * message was slower.
 */
export async function endSession(sessionId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE voice_sessions
        SET ended_at = now(),
            seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int),
            end_reason = $2
      WHERE id = $1 AND ended_at IS NULL`,
    [sessionId, reason.slice(0, 200)]
  );
}

/**
 * Records that one slice of the audio has arrived.
 *
 * The key is deliberately NOT written here: the store only names the finished
 * object when the slices are joined, and a key written before that would point
 * at a file that does not exist yet. What the owner's page needs in the
 * meantime is the count — "this conversation has audio, it just has not been
 * closed" — and it moves to the highest sequence number seen rather than by
 * one, so a slice that was retried does not inflate it and a slice that never
 * arrived does not stall it.
 *
 * The size is not written here either. Bytes are counted when the slices are
 * joined, because a retried slice would otherwise be added to the total twice
 * and the page would report a length the file does not have.
 */
export async function noteRecordingChunk(
  sessionId: string,
  chunk: { seq: number; contentType: string }
): Promise<void> {
  await pool.query(
    `UPDATE voice_sessions
        SET recording_content_type = COALESCE(recording_content_type, $3),
            recording_chunks = GREATEST(recording_chunks, $2),
            last_seen_at = now()
      WHERE id = $1`,
    [sessionId, chunk.seq + 1, chunk.contentType]
  );
}

/**
 * Writes the finished recording onto its session.
 *
 * Also the single-upload path: a browser that hands over one whole blob is a
 * conversation whose parts are already joined.
 */
export async function setSessionRecording(
  sessionId: string,
  recording: { key: string; bytes: number; contentType: string }
): Promise<void> {
  await pool.query(
    `UPDATE voice_sessions
        SET recording_key = $2, recording_bytes = $3, recording_content_type = $4,
            recording_finalized_at = now()
      WHERE id = $1`,
    [sessionId, recording.key, recording.bytes, recording.contentType]
  );
}

/* -------------------------------------------------------------- approvals */

/**
 * One thing the agent asked to do in the admin, and what came back.
 *
 * Mirrors `ApprovalRequest`/`ApprovalOutcome` from the browser contract rather
 * than importing them: the frontend and the backend are separate TypeScript
 * projects, and a type that crossed that line would be a build dependency
 * between them for no gain.
 */
export type ApprovalRecord = {
  sessionId: string;
  actionId: string;
  title: string;
  summary: string;
  details: { label: string; value: string }[];
  risk: "normal" | "destructive";
  approved: boolean;
  answeredVia: "voice" | "chat" | "click" | "timeout" | "cancelled";
  note?: string;
  /**
   * Whether the action actually ran.
   *
   * Almost always false at this point, and deliberately so: approval and
   * execution are two moments with a fallible step between them, so the row is
   * written when she answers and `markApprovalExecuted` is what later says it
   * went ahead. A row that claimed to have run because it was about to is the
   * one thing an audit trail must never contain.
   */
  executed: boolean;
};

/**
 * Writes down one thing the agent asked to do, and the answer.
 *
 * Written whether the answer was yes or no. A decline is the more valuable of
 * the two records — it is the evidence that the assistant asked and was told
 * not to — and a trail that only holds the yeses cannot answer the question
 * anybody actually asks it.
 */
export async function recordApproval(record: ApprovalRecord): Promise<{ approvalId: string }> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO voice_approvals
       (session_id, action_id, title, summary, details, risk, approved, answered_via, note,
        executed, executed_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10, CASE WHEN $10 THEN now() ELSE NULL END)
     RETURNING id`,
    [
      record.sessionId,
      record.actionId,
      record.title,
      record.summary,
      JSON.stringify(record.details ?? []),
      record.risk,
      record.approved,
      record.answeredVia,
      record.note ?? "",
      record.executed,
    ]
  );
  return { approvalId: String(inserted.rows[0]!.id) };
}

/**
 * Closes the loop on an approval: it ran, or it did not.
 *
 * A second call rather than a field on the first, because the action happens
 * after the answer and can fail in between — a row written optimistically would
 * say the owner's instruction was carried out when the only thing that actually
 * happened was that she agreed to it. `note` carries the reason when something
 * went wrong, which is the part she will want to read.
 *
 * Scoped to the session as well as the id, so an approval id is no more a
 * capability than a session id is: an entry can only be closed by a caller who
 * has already been proved to own the conversation it belongs to.
 */
export async function markApprovalExecuted(input: {
  approvalId: string;
  sessionId: string;
  executed: boolean;
  note?: string;
}): Promise<boolean> {
  const updated = await pool.query(
    `UPDATE voice_approvals
        SET executed = $3,
            executed_at = CASE WHEN $3 THEN now() ELSE NULL END,
            note = COALESCE(NULLIF($4, ''), note)
      WHERE id = $1 AND session_id = $2`,
    [Number(input.approvalId), input.sessionId, input.executed, input.note ?? ""]
  );
  return (updated.rowCount ?? 0) > 0;
}

export type ApprovalRow = {
  id: string;
  actionId: string;
  title: string;
  summary: string;
  details: { label: string; value: string }[];
  risk: string;
  approved: boolean;
  answeredVia: string;
  note: string;
  executed: boolean;
  createdAt: string;
};

export async function approvalsFor(sessionId: string): Promise<ApprovalRow[]> {
  const res = await pool.query(
    `SELECT id, action_id, title, summary, details, risk, approved, answered_via, note,
            executed, created_at
       FROM voice_approvals WHERE session_id = $1 ORDER BY created_at, id`,
    [sessionId]
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    actionId: row.action_id,
    title: row.title,
    summary: row.summary,
    details: Array.isArray(row.details) ? row.details : [],
    risk: row.risk,
    approved: row.approved,
    answeredVia: row.answered_via,
    note: row.note,
    executed: row.executed,
    createdAt: asIso(row.created_at) ?? "",
  }));
}

/* ------------------------------------------------- what the owner reads */

export type VoiceSessionSummary = {
  id: string;
  surface: VoiceSurface;
  mode: VoiceSessionMode;
  /** Who it was, already resolved to something a person can read. */
  personName: string;
  personEmail: string;
  startedAt: string;
  endedAt: string | null;
  /** True once something closed the call properly. */
  ended: boolean;
  /** The last moment anything arrived, which is how long an unfinished one ran. */
  lastSeenAt: string;
  /** Length in seconds — measured when it ended, or up to the last thing heard. */
  seconds: number | null;
  endReason: string;
  path: string;
  lineCount: number;
  approvalCount: number;
  hasRecording: boolean;
};

export type SessionListFilters = {
  surface?: VoiceSurface;
  mode?: VoiceSessionMode;
  /** Only conversations that have audio to play. */
  withRecording?: boolean;
  from?: Date;
  to?: Date;
};

/**
 * The owner's list.
 *
 * The counts are subqueries rather than joins with a GROUP BY, because the page
 * shows fifty rows at a time and this way the transcript table is touched only
 * for the rows on screen — its index is (session_id, at_ms, id), so each one is
 * a count over a contiguous slice.
 */
export async function listSessions(
  filters: SessionListFilters,
  page: number,
  limit: number
): Promise<{ items: VoiceSessionSummary[]; total: number }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const next = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.surface) clauses.push(`s.surface = ${next(filters.surface)}`);
  if (filters.mode) clauses.push(`s.mode = ${next(filters.mode)}`);
  // A conversation whose tab was closed has slices and no finished object yet,
  // and it is still a conversation with audio in it.
  if (filters.withRecording) {
    clauses.push(`(s.recording_key IS NOT NULL OR s.recording_chunks > 0)`);
  }
  if (filters.from) clauses.push(`s.started_at >= ${next(filters.from)}`);
  if (filters.to) clauses.push(`s.started_at <= ${next(filters.to)}`);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const totalRes = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM voice_sessions s ${where}`,
    params
  );

  const rows = await pool.query(
    `SELECT s.id, s.surface, s.mode, s.started_at, s.ended_at, s.end_reason, s.path,
            s.ended_at IS NOT NULL AS ended,
            COALESCE(s.seconds,
                     GREATEST(0, EXTRACT(EPOCH FROM (s.last_seen_at - s.started_at))::int)
            ) AS seconds,
            s.last_seen_at,
            (s.recording_key IS NOT NULL OR s.recording_chunks > 0) AS has_recording,
            m.name AS member_name, m.email AS member_email,
            a.name AS admin_name, a.email AS admin_email,
            (SELECT count(*) FROM voice_transcript_lines l WHERE l.session_id = s.id) AS line_count,
            (SELECT count(*) FROM voice_approvals v WHERE v.session_id = s.id) AS approval_count
       FROM voice_sessions s
       LEFT JOIN members m ON m.id = s.member_id
       LEFT JOIN admin_users a ON a.id = s.admin_user_id
       ${where}
      ORDER BY s.started_at DESC
      LIMIT ${next(limit)} OFFSET ${next((page - 1) * limit)}`,
    params
  );

  return {
    items: rows.rows.map((row) => ({
      id: row.id,
      surface: row.surface,
      mode: row.mode,
      personName: row.admin_name || row.member_name || "",
      personEmail: row.admin_email || row.member_email || "",
      startedAt: asIso(row.started_at) ?? "",
      endedAt: asIso(row.ended_at),
      ended: row.ended,
      lastSeenAt: asIso(row.last_seen_at) ?? "",
      seconds: row.seconds,
      endReason: row.end_reason,
      path: row.path,
      lineCount: Number(row.line_count),
      approvalCount: Number(row.approval_count),
      hasRecording: row.has_recording,
    })),
    total: Number(totalRes.rows[0]?.count ?? 0),
  };
}

export type VoiceSessionDetail = VoiceSessionSummary & {
  transcript: TranscriptLine[];
  approvals: ApprovalRow[];
  /** The stored key, so the admin route can ask the right store for a link. */
  recordingKey: string | null;
  recordingBytes: number | null;
  recordingContentType: string | null;
  /**
   * Null while the audio is still a pile of numbered parts — a conversation
   * whose tab was closed before anything joined them. The admin route joins
   * them on the way to a playback link, which is why it needs to know.
   */
  recordingFinalizedAt: string | null;
  recordingChunks: number;
};

export async function sessionDetail(sessionId: string): Promise<VoiceSessionDetail | null> {
  const res = await pool.query(
    `SELECT s.id, s.surface, s.mode, s.started_at, s.ended_at, s.end_reason, s.path,
            s.ended_at IS NOT NULL AS ended,
            COALESCE(s.seconds,
                     GREATEST(0, EXTRACT(EPOCH FROM (s.last_seen_at - s.started_at))::int)
            ) AS seconds,
            s.last_seen_at,
            s.recording_key, s.recording_bytes, s.recording_content_type,
            s.recording_finalized_at, s.recording_chunks,
            m.name AS member_name, m.email AS member_email,
            a.name AS admin_name, a.email AS admin_email
       FROM voice_sessions s
       LEFT JOIN members m ON m.id = s.member_id
       LEFT JOIN admin_users a ON a.id = s.admin_user_id
      WHERE s.id = $1`,
    [sessionId]
  );
  const row = res.rows[0];
  if (!row) return null;

  const [transcript, approvals] = await Promise.all([
    transcriptFor(sessionId),
    approvalsFor(sessionId),
  ]);

  return {
    id: row.id,
    surface: row.surface,
    mode: row.mode,
    personName: row.admin_name || row.member_name || "",
    personEmail: row.admin_email || row.member_email || "",
    startedAt: asIso(row.started_at) ?? "",
    endedAt: asIso(row.ended_at),
    ended: row.ended,
    lastSeenAt: asIso(row.last_seen_at) ?? "",
    seconds: row.seconds,
    endReason: row.end_reason,
    path: row.path,
    lineCount: transcript.length,
    approvalCount: approvals.length,
    hasRecording: row.recording_key !== null || row.recording_chunks > 0,
    recordingKey: row.recording_key,
    recordingBytes: row.recording_bytes === null ? null : Number(row.recording_bytes),
    recordingContentType: row.recording_content_type,
    recordingFinalizedAt: asIso(row.recording_finalized_at),
    recordingChunks: row.recording_chunks,
    transcript,
    approvals,
  };
}

/**
 * Removes one conversation.
 *
 * Returns the recording key so the caller can delete the audio too: the row
 * cascades to its transcript and its approvals, but bytes in a bucket or on a
 * volume are not the database's to forget. "Delete this conversation" has to
 * mean the audio as well, or the promise the page makes is not true.
 */
export async function deleteSession(sessionId: string): Promise<{ recordingKey: string | null } | null> {
  const res = await pool.query<{ recording_key: string | null }>(
    `DELETE FROM voice_sessions WHERE id = $1 RETURNING recording_key`,
    [sessionId]
  );
  const row = res.rows[0];
  return row ? { recordingKey: row.recording_key } : null;
}
