/**
 * The admin Coaching page's pure logic: which tab the address asks for, and
 * how the roster the server sends becomes the rows of the Clients table.
 *
 * Kept out of `pages/admin/Coaching.tsx` so it can be tested without React, and
 * out of `coachingAdminApi.ts` so the test never pulls in the session transport.
 */

/* --------------------------------------------------------------------- tabs */

export type CoachingTab = "programs" | "sessions" | "clients";

/**
 * `?tab=` → the tab to show.
 *
 * The packages tab was called "Offers" until the owner asked for "Programs", so
 * `?tab=offers` — in bookmarks and in links other screens may still carry —
 * keeps opening it. Anything unrecognised, or no tab at all, opens Programs
 * rather than a blank page.
 */
export function coachingTabFrom(value: string | null | undefined): CoachingTab {
  const tab = (value ?? "").trim().toLowerCase();
  if (tab === "sessions" || tab === "clients") return tab;
  return "programs";
}

/* ------------------------------------------------------------------- roster */

/** One program a client is in, as `GET /admin/growth/coaching/roster` reports it. */
export interface CoachingRosterProgram {
  /** Null for sessions booked without a program. */
  offerId: number | null;
  title: string | null;
  /**
   * `active` — a live grant (bought or given); `ended` — the grant expired;
   * `sessions` — no package behind it, only sessions she booked for them.
   */
  access: "active" | "ended" | "sessions";
  joinedAt: string | null;
  /** Sessions not cancelled (no-shows count: the hour was held). */
  sessionsUsed: number;
  /** How many sessions the package holds; null when there's no package behind it. */
  sessionsIncluded: number | null;
  /** The package has no session limit. */
  openEnded: boolean;
  nextSessionAt: string | null;
  lastSessionAt: string | null;
}

export interface CoachingRosterClient {
  key: string;
  /** Set when the person has a contact record, which is what the profile link needs. */
  contactId: number | null;
  memberId: number | null;
  name: string;
  email: string;
  joinedAt: string | null;
  programs: CoachingRosterProgram[];
}

/** The program filter's value for sessions booked outside any program. */
export const NO_PROGRAM = "none";

/** One row of the Clients table: a person, narrowed to the chosen program. */
export interface CoachingRosterRow {
  key: string;
  contactId: number | null;
  name: string;
  email: string;
  programs: CoachingRosterProgram[];
  /** Sessions used against a package — the "2" in "2 of 6 used". */
  sessionsUsed: number;
  /** Sessions the packages hold between them; null when no package has a limit. */
  sessionsIncluded: number | null;
  /** At least one package has no session limit. */
  openEnded: boolean;
  /** Sessions booked that no package pays for. */
  sessionsOutside: number;
  nextSessionAt: string | null;
  lastSessionAt: string | null;
  joinedAt: string | null;
  /** Epoch ms for sorting; 0 when unknown so they sort to the end of "newest first". */
  joinedTime: number;
  lastSessionTime: number;
  /** Epoch ms, or +Infinity with nothing booked so "soonest first" puts them last. */
  nextSessionTime: number;
}

function timeOf(iso: string | null): number {
  const at = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isFinite(at) ? at : Number.NaN;
}

function matchesFilter(program: CoachingRosterProgram, filter: string): boolean {
  if (!filter) return true;
  if (filter === NO_PROGRAM) return program.offerId === null;
  return String(program.offerId ?? "") === filter;
}

/**
 * The server's roster → the table's rows, for one program or every program.
 *
 * The filter works on programs, not people: with a program chosen, somebody in
 * two programs shows only that one, and every count on the row — sessions,
 * next, last, joined — is about that program alone. People with nothing in the
 * chosen program drop out.
 *
 * A package's allowance and what it has used are kept apart from sessions that
 * no package pays for (a session she booked "not part of a program", or in a
 * program nobody bought). Folding those into "3 of 6 used" would spend a
 * package on an hour it never paid for.
 */
export function rosterRows(clients: CoachingRosterClient[], filter = ""): CoachingRosterRow[] {
  const rows: CoachingRosterRow[] = [];

  for (const client of clients) {
    const programs = client.programs.filter((program) => matchesFilter(program, filter));
    if (programs.length === 0) continue;

    let sessionsUsed = 0;
    let sessionsIncluded: number | null = null;
    let openEnded = false;
    let sessionsOutside = 0;
    let next = Number.POSITIVE_INFINITY;
    let nextSessionAt: string | null = null;
    let last = 0;
    let lastSessionAt: string | null = null;
    let joined = Number.POSITIVE_INFINITY;
    let joinedAt: string | null = null;

    for (const program of programs) {
      if (program.access === "sessions" || program.sessionsIncluded === null) {
        sessionsOutside += program.sessionsUsed;
      } else {
        sessionsUsed += program.sessionsUsed;
        if (program.openEnded) openEnded = true;
        else sessionsIncluded = (sessionsIncluded ?? 0) + program.sessionsIncluded;
      }

      const nextAt = timeOf(program.nextSessionAt);
      if (nextAt < next) {
        next = nextAt;
        nextSessionAt = program.nextSessionAt;
      }
      const lastAt = timeOf(program.lastSessionAt);
      if (lastAt > last) {
        last = lastAt;
        lastSessionAt = program.lastSessionAt;
      }
      const joinedAtTime = timeOf(program.joinedAt);
      if (joinedAtTime < joined) {
        joined = joinedAtTime;
        joinedAt = program.joinedAt;
      }
    }

    rows.push({
      key: client.key,
      contactId: client.contactId,
      name: client.name,
      email: client.email,
      programs,
      sessionsUsed,
      sessionsIncluded,
      openEnded,
      sessionsOutside,
      nextSessionAt,
      lastSessionAt,
      joinedAt,
      joinedTime: joinedAt ? joined : 0,
      lastSessionTime: last,
      nextSessionTime: next,
    });
  }

  return rows;
}

/**
 * The Sessions cell, in words: "2 of 6 used", "3 used · no limit", or — with
 * no package at all — "1 session booked". The second line is for sessions no
 * package pays for, so they're seen without being counted against one.
 */
export function sessionsSummary(row: CoachingRosterRow): { main: string; note: string | null } {
  const outside =
    row.sessionsOutside > 0
      ? `${row.sessionsOutside} ${row.sessionsOutside === 1 ? "session" : "sessions"}`
      : null;

  if (row.sessionsIncluded !== null || row.openEnded) {
    const main =
      row.sessionsIncluded !== null && !row.openEnded
        ? `${row.sessionsUsed} of ${row.sessionsIncluded} used`
        : `${row.sessionsUsed} used · no limit`;
    return { main, note: outside ? `+ ${outside} outside a package` : null };
  }
  return { main: `${outside ?? "No sessions"} booked`, note: null };
}

/**
 * The programs in the filter menu: every program she has set up, plus
 * "Outside any program" only when somebody actually has a session like that.
 */
export function hasSessionsOutsidePrograms(clients: CoachingRosterClient[]): boolean {
  return clients.some((client) => client.programs.some((program) => program.offerId === null));
}
