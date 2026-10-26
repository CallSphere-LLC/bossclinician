import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db/pool";
import { conflict, unauthorized } from "../utils/httpError";
import { hasProductAccess, PRODUCT_CONTENT_COURSE_ID } from "./access";
import { loadCourseForMember } from "./curriculum";

export const BOARDROOM_ASSESSMENT_KEY = "boardroom-ceo-assessment";
export const BOARDROOM_ASSESSMENT_VERSION = "boardroom-ceo-v1" as const;
export const boardroomResponsesSchema = z.array(z.number().int().min(1).max(4)).length(12);

// Wording and order from the supplied package/index.html. Changing the scoring
// or these recommendations requires a new assessment version.
export const BOARDROOM_DOMAINS = [
  { id: "finance", name: "Financial Leadership", action: "Review the last three months of revenue, expenses, operating profit and liquidity before changing compensation or hiring." },
  { id: "team", name: "Team & Leadership", action: "Clarify one leadership role, its decision rights, and an observable performance expectation." },
  { id: "operations", name: "Operational Independence", action: "Document one owner-dependent operational process and assign a responsible role." },
  { id: "growth", name: "Strategic Growth", action: "Choose one proposed growth opportunity and model its demand, capacity, costs and downside." },
  { id: "risk", name: "Risk & Protection", action: "Identify the top two operational or financial risks and document a first response for each." },
  { id: "capacity", name: "CEO Capacity & Vision", action: "Protect one recurring executive strategy block and decide what routine activity to delegate or stop." },
] as const;

export interface BoardroomDomain { id: string; name: string; score: number }
export interface BoardroomReport {
  id: string;
  assessmentVersion: string;
  completedAt: string;
  quarter: string;
  responses: number[];
  overallScore: number;
  domains: BoardroomDomain[];
  priorities: BoardroomDomain[];
  firstAction: string;
}

export function scoreBoardroomAssessment(input: unknown): Pick<BoardroomReport, "responses" | "overallScore" | "domains" | "priorities" | "firstAction"> {
  const responses = boardroomResponsesSchema.parse(input);
  const domains = BOARDROOM_DOMAINS.map((domain, index) => ({
    id: domain.id, name: domain.name, score: responses[index * 2] + responses[index * 2 + 1],
  }));
  const priorities = domains.map((domain, index) => ({ domain, index }))
    .sort((a, b) => a.domain.score - b.domain.score || a.index - b.index)
    .slice(0, 3).map(({ domain }) => ({ ...domain }));
  return {
    responses,
    overallScore: Math.round(responses.reduce((sum, answer) => sum + answer, 0) / 48 * 100),
    domains,
    priorities,
    firstAction: BOARDROOM_DOMAINS.find(domain => domain.id === priorities[0].id)!.action,
  };
}

/** Legacy blank/invalid member zones use the member schema's default. */
export function validatedBoardroomTimezone(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) {
    try { return new Intl.DateTimeFormat("en-US", { timeZone: raw.trim() }).resolvedOptions().timeZone; }
    catch { /* fallback below */ }
  }
  return "America/New_York";
}

export function boardroomQuarter(completedAt: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validatedBoardroomTimezone(timezone), year: "numeric", month: "numeric",
  }).formatToParts(completedAt);
  const year = parts.find(part => part.type === "year")!.value;
  const month = Number(parts.find(part => part.type === "month")!.value);
  return `${year}-Q${Math.ceil(month / 3)}`;
}

export async function loadBoardroomTimezone(memberId: number): Promise<string> {
  const result = await pool.query<{ timezone: string }>("SELECT timezone FROM members WHERE id = $1", [memberId]);
  if (!result.rows[0]) throw unauthorized("Please sign in to continue");
  return validatedBoardroomTimezone(result.rows[0].timezone);
}

interface ReportRow {
  id: string; assessment_version: string;
  completed_at: Date; quarter: string; responses: number[]; overall_score: number;
  domains: BoardroomDomain[]; priorities: BoardroomDomain[]; first_action: string;
}

function toReport(row: ReportRow): BoardroomReport {
  return {
    id: row.id, assessmentVersion: row.assessment_version,
    completedAt: new Date(row.completed_at).toISOString(), quarter: row.quarter,
    responses: row.responses, overallScore: row.overall_score,
    domains: row.domains, priorities: row.priorities, firstAction: row.first_action,
  };
}

export async function listBoardroomReports(memberId: number): Promise<BoardroomReport[]> {
  const result = await pool.query<ReportRow>(
    `WITH recent AS (
       SELECT id FROM member_boardroom_assessments
        WHERE member_id = $1
        ORDER BY completed_at DESC, id DESC LIMIT 100
     ), baselines AS (
       SELECT DISTINCT ON (quarter, assessment_version) id
         FROM member_boardroom_assessments
        WHERE member_id = $1
        ORDER BY quarter, assessment_version, completed_at DESC, id DESC
     ), retained AS (
       SELECT id FROM recent UNION SELECT id FROM baselines
     )
     SELECT report.* FROM member_boardroom_assessments report
       JOIN retained ON retained.id = report.id
      WHERE report.member_id = $1
      ORDER BY report.completed_at DESC, report.id DESC`,
    [memberId],
  );
  // Keep the latest 100 attempts plus each quarter/version's latest baseline.
  // UNION deduplicates overlapping IDs. Versions and stored scores are returned
  // unchanged so the client can warn against cross-version numeric comparison.
  // Missing quarters remain missing.
  return result.rows.map(toReport);
}

export async function submitBoardroomAssessment(memberId: number, responses: unknown, requestId: string): Promise<BoardroomReport> {
  const scored = scoreBoardroomAssessment(responses);
  const timezone = await loadBoardroomTimezone(memberId);
  const completedAt = new Date();
  const result = await pool.query<ReportRow>(
    `INSERT INTO member_boardroom_assessments
      (id, member_id, request_id, assessment_version, completed_at, timezone, quarter,
       responses, overall_score, domains, priorities, first_action)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
     ON CONFLICT (member_id, request_id) DO NOTHING RETURNING *`,
    [randomUUID(), memberId, requestId, BOARDROOM_ASSESSMENT_VERSION, completedAt, timezone,
      boardroomQuarter(completedAt, timezone), scored.responses, scored.overallScore,
      JSON.stringify(scored.domains), JSON.stringify(scored.priorities), scored.firstAction],
  );
  if (result.rows[0]) return toReport(result.rows[0]);
  // Separate statement intentionally: after a concurrent INSERT's conflict
  // wait, READ COMMITTED gets a fresh snapshot containing the winning row.
  const existing = await pool.query<ReportRow>(
    "SELECT * FROM member_boardroom_assessments WHERE member_id = $1 AND request_id = $2",
    [memberId, requestId],
  );
  const row = existing.rows[0];
  if (!row || row.assessment_version !== BOARDROOM_ASSESSMENT_VERSION ||
      JSON.stringify(row.responses) !== JSON.stringify(scored.responses)) {
    throw conflict("That submission ID has already been used for different answers. Start a new submission.");
  }
  return toReport(row);
}

type LessonLink = { title: string; href: string } | null;
export async function loadBoardroomLinks(memberId: number): Promise<{ dashboard: LessonLink; plan: LessonLink }> {
  const links: { dashboard: LessonLink; plan: LessonLink } = { dashboard: null, plan: null };
  const candidates = await pool.query<{
    id: number; course_id: number; tool_key: string; slug: string; title: string;
    product_id: number; product_slug: string;
  }>(
    `SELECT l.id, m.course_id, l.tool_key, l.slug, l.title,
            p.id AS product_id, p.slug AS product_slug
       FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
       JOIN products p ON ${PRODUCT_CONTENT_COURSE_ID} = c.id AND p.status = 'published'
      WHERE l.published AND l.tool_key IN ('boardroom-ceo-dashboard', 'living-business-plan')
      ORDER BY (c.slug = 'the-board-room') DESC, c.id, l.sort, l.id, p.id`,
  );
  const courses = new Map<number, Awaited<ReturnType<typeof loadCourseForMember>>>();
  for (const candidate of candidates.rows) {
    const key = candidate.tool_key === "boardroom-ceo-dashboard" ? "dashboard" : "plan";
    if (links[key] || !(await hasProductAccess(memberId, candidate.product_id))) continue;
    if (!courses.has(candidate.course_id)) {
      courses.set(candidate.course_id, await loadCourseForMember(memberId, candidate.course_id));
    }
    const lesson = courses.get(candidate.course_id)?.modules.flatMap(module => module.lessons)
      .find(entry => entry.id === candidate.id);
    if (!lesson?.unlocked) continue;
    links[key] = {
      title: candidate.title,
      href: `/library/${encodeURIComponent(candidate.product_slug)}/lessons/${encodeURIComponent(candidate.slug)}`,
    };
  }
  return links;
}
