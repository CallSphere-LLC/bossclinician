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
  /**
   * `kajabi` — in this program because Kajabi listed them as holding its
   * Kajabi product (migration 078). Their sessions happened on Kajabi, so a
   * Kajabi-only program carries no allowance (`sessionsIncluded` null).
   */
  source?: "kajabi" | null;
  nextSessionAt: string | null;
  lastSessionAt: string | null;
  /**
   * Program progress's "of 6" (Kajabi's Program Progress column): the
   * enrollment's own total — a Kajabi client's, migration 086 — or else the
   * package's allowance. Null when unknown, when the package has no limit, or
   * when there's no package at all.
   */
  sessionsTotal: number | null;
  /**
   * Program progress's "Completed 3": sessions marked completed here, plus any
   * a Kajabi client completed on Kajabi before the move.
   */
  sessionsCompleted: number;
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
  /** At least one of the programs came over from Kajabi. */
  fromKajabi: boolean;
  /** Program progress: sessions completed in the row's programs. */
  sessionsCompleted: number;
  /**
   * Program progress's "of N": what the row's programs hold between them. Null
   * when none is known, or when a program with sessions completed has no known
   * total (an "of N" would then leave its sessions out of the N).
   */
  sessionsTotal: number | null;
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
    let fromKajabi = false;
    let sessionsCompleted = 0;
    let sessionsTotal: number | null = null;
    let totalUnknown = false;

    for (const program of programs) {
      if (program.source === "kajabi") fromKajabi = true;
      // Program progress is about programs, so sessions booked outside one
      // don't count towards it (the Sessions column still shows them). A
      // program nobody knows the size of adds nothing to the "of N", and only
      // spoils it once it has sessions completed that the N would leave out.
      if (program.offerId !== null) {
        sessionsCompleted += program.sessionsCompleted;
        if (program.sessionsTotal !== null) sessionsTotal = (sessionsTotal ?? 0) + program.sessionsTotal;
        else if (program.sessionsCompleted > 0) totalUnknown = true;
      }
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
      fromKajabi,
      sessionsCompleted,
      sessionsTotal: totalUnknown ? null : sessionsTotal,
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
  if (!outside && row.fromKajabi) {
    // Kajabi's session history didn't come over, so "No sessions booked" would
    // read as a client who never had one.
    return { main: "None booked here yet", note: "earlier sessions were on Kajabi" };
  }
  return { main: `${outside ?? "No sessions"} booked`, note: null };
}

/**
 * The Program progress cell, in Kajabi's words: "Completed 3 of 6 sessions";
 * "Completed 2 sessions" when nobody knows how many the program holds; a dash
 * when there's nothing to say (no known total and nothing completed).
 */
export function progressSummary(row: Pick<CoachingRosterRow, "sessionsCompleted" | "sessionsTotal">): string {
  const done = row.sessionsCompleted;
  const total = row.sessionsTotal;
  if (total !== null && total > 0) {
    return `Completed ${done} of ${total} ${total === 1 ? "session" : "sessions"}`;
  }
  if (done > 0) return `Completed ${done} ${done === 1 ? "session" : "sessions"}`;
  return "—";
}

/**
 * How many people are in each program, for the program cards: offer id →
 * clients. Somebody in a program twice (a grant and a Kajabi enrollment)
 * counts once, and sessions outside any program aren't a program's.
 */
export function clientsPerProgram(clients: CoachingRosterClient[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const client of clients) {
    const seen = new Set<number>();
    for (const program of client.programs) {
      if (program.offerId === null || seen.has(program.offerId)) continue;
      seen.add(program.offerId);
      counts.set(program.offerId, (counts.get(program.offerId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The programs in the filter menu: every program she has set up, plus
 * "Outside any program" only when somebody actually has a session like that.
 */
export function hasSessionsOutsidePrograms(clients: CoachingRosterClient[]): boolean {
  return clients.some((client) => client.programs.some((program) => program.offerId === null));
}
