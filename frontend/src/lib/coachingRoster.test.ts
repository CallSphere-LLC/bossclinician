import { describe, expect, it } from "vitest";
import {
  clientsPerProgram,
  coachingTabFrom,
  hasSessionsOutsidePrograms,
  NO_PROGRAM,
  progressSummary,
  rosterRows,
  sessionsSummary,
  type CoachingRosterClient,
  type CoachingRosterProgram,
} from "./coachingRoster";

function program(overrides: Partial<CoachingRosterProgram>): CoachingRosterProgram {
  return {
    offerId: 8,
    title: "90-day practice accelerator",
    access: "active",
    joinedAt: "2026-09-01T12:00:00Z",
    sessionsUsed: 0,
    sessionsIncluded: 6,
    openEnded: false,
    nextSessionAt: null,
    lastSessionAt: null,
    sessionsTotal: 6,
    sessionsCompleted: 0,
    ...overrides,
  };
}

const ALICE: CoachingRosterClient = {
  key: "c10",
  contactId: 10,
  memberId: 100,
  name: "Alice Adams",
  email: "alice@example.com",
  joinedAt: "2026-09-01T12:00:00Z",
  programs: [
    program({
      sessionsUsed: 2,
      nextSessionAt: "2026-10-02T15:00:00Z",
      lastSessionAt: "2026-09-20T15:00:00Z",
    }),
    program({
      offerId: 9,
      title: "Group mastermind",
      joinedAt: "2026-09-10T12:00:00Z",
      sessionsUsed: 1,
      sessionsIncluded: 0,
      openEnded: true,
      sessionsTotal: null,
      nextSessionAt: "2026-09-30T15:00:00Z",
      lastSessionAt: "2026-09-25T15:00:00Z",
    }),
  ],
};

const DAN: CoachingRosterClient = {
  key: "m102",
  contactId: null,
  memberId: 102,
  name: "Dan",
  email: "dan@example.com",
  joinedAt: "2026-08-01T12:00:00Z",
  programs: [
    program({
      offerId: null,
      title: null,
      access: "sessions",
      joinedAt: "2026-08-01T12:00:00Z",
      sessionsUsed: 1,
      sessionsIncluded: null,
      sessionsTotal: null,
      lastSessionAt: "2026-08-09T12:00:00Z",
    }),
  ],
};

describe("coaching tab from the address", () => {
  it("opens Programs for the old ?tab=offers links, for programs, and for nothing", () => {
    expect(coachingTabFrom("offers")).toBe("programs");
    expect(coachingTabFrom("programs")).toBe("programs");
    expect(coachingTabFrom(null)).toBe("programs");
    expect(coachingTabFrom("nonsense")).toBe("programs");
  });

  it("opens Sessions and Clients by name, whatever the case", () => {
    expect(coachingTabFrom("sessions")).toBe("sessions");
    expect(coachingTabFrom("Clients")).toBe("clients");
  });
});

describe("coaching roster rows", () => {
  it("rolls every program into one row per person", () => {
    const [row] = rosterRows([ALICE]);
    expect(row.programs).toHaveLength(2);
    // The open-ended package's session counts as used, but it adds no limit.
    expect(row.sessionsUsed).toBe(3);
    expect(row.sessionsIncluded).toBe(6);
    expect(row.openEnded).toBe(true);
    expect(row.nextSessionAt).toBe("2026-09-30T15:00:00Z");
    expect(row.lastSessionAt).toBe("2026-09-25T15:00:00Z");
    expect(row.joinedAt).toBe("2026-09-01T12:00:00Z");
  });

  it("narrows each person to the chosen program, and drops people not in it", () => {
    const rows = rosterRows([ALICE, DAN], "9");
    expect(rows.map((row) => row.key)).toEqual(["c10"]);
    expect(rows[0].programs.map((p) => p.offerId)).toEqual([9]);
    expect(rows[0].joinedAt).toBe("2026-09-10T12:00:00Z");
    expect(rows[0].lastSessionAt).toBe("2026-09-25T15:00:00Z");
    expect(sessionsSummary(rows[0]).main).toBe("1 used · no limit");
  });

  it("filters to sessions booked outside any program", () => {
    const rows = rosterRows([ALICE, DAN], NO_PROGRAM);
    expect(rows.map((row) => row.key)).toEqual(["m102"]);
    expect(hasSessionsOutsidePrograms([ALICE])).toBe(false);
    expect(hasSessionsOutsidePrograms([ALICE, DAN])).toBe(true);
  });

  it("never spends a package on a session no package paid for", () => {
    const mixed: CoachingRosterClient = {
      ...ALICE,
      programs: [ALICE.programs[0], ...DAN.programs],
    };
    const [row] = rosterRows([mixed]);
    expect(row.sessionsUsed).toBe(2);
    expect(row.sessionsOutside).toBe(1);
    expect(sessionsSummary(row)).toEqual({ main: "2 of 6 used", note: "+ 1 session outside a package" });
  });

  it("says 'booked' for someone with sessions and no package", () => {
    const [row] = rosterRows([DAN]);
    expect(sessionsSummary(row)).toEqual({ main: "1 session booked", note: null });
    // Nothing coming up sorts last under "soonest first".
    expect(row.nextSessionTime).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads a bought package nobody has booked into yet as none used", () => {
    const buyer: CoachingRosterClient = { ...ALICE, programs: [program({})] };
    const [row] = rosterRows([buyer]);
    expect(sessionsSummary(row)).toEqual({ main: "0 of 6 used", note: null });
    expect(row.lastSessionTime).toBe(0);
  });

  it("says a Kajabi client's sessions were on Kajabi rather than 'none booked'", () => {
    const kajabi: CoachingRosterClient = {
      ...ALICE,
      programs: [program({ offerId: 11, source: "kajabi", sessionsIncluded: null })],
    };
    const [row] = rosterRows([kajabi]);
    expect(row.fromKajabi).toBe(true);
    expect(sessionsSummary(row)).toEqual({
      main: "None booked here yet",
      note: "earlier sessions were on Kajabi",
    });
  });

  it("counts a Kajabi client's sessions booked here like anyone else's", () => {
    const kajabi: CoachingRosterClient = {
      ...ALICE,
      programs: [program({ offerId: 11, source: "kajabi", sessionsIncluded: null, sessionsUsed: 2 })],
    };
    const [row] = rosterRows([kajabi]);
    expect(sessionsSummary(row)).toEqual({ main: "2 sessions booked", note: null });
  });
});

describe("program progress", () => {
  it("reads a Kajabi client's history as Kajabi does: 'Completed 3 of 6 sessions'", () => {
    const kajabi: CoachingRosterClient = {
      ...ALICE,
      programs: [
        program({ offerId: 11, source: "kajabi", sessionsIncluded: null, sessionsTotal: 6, sessionsCompleted: 3 }),
      ],
    };
    const [row] = rosterRows([kajabi]);
    expect(progressSummary(row)).toBe("Completed 3 of 6 sessions");
    // The Sessions column still says nothing was booked here.
    expect(sessionsSummary(row).main).toBe("None booked here yet");
  });

  it("says 'Completed 2 sessions' with no known total, and a dash with nothing to say", () => {
    expect(progressSummary({ sessionsCompleted: 2, sessionsTotal: null })).toBe("Completed 2 sessions");
    expect(progressSummary({ sessionsCompleted: 1, sessionsTotal: null })).toBe("Completed 1 session");
    expect(progressSummary({ sessionsCompleted: 0, sessionsTotal: null })).toBe("—");
    expect(progressSummary({ sessionsCompleted: 0, sessionsTotal: 6 })).toBe("Completed 0 of 6 sessions");
  });

  it("adds up programs, and drops the 'of N' once a program of unknown size has completions", () => {
    const [quiet] = rosterRows([ALICE]);
    expect(progressSummary(quiet)).toBe("Completed 0 of 6 sessions");

    const busy: CoachingRosterClient = {
      ...ALICE,
      programs: [
        program({ sessionsCompleted: 1 }),
        program({ offerId: 9, sessionsIncluded: 0, openEnded: true, sessionsTotal: null, sessionsCompleted: 2 }),
      ],
    };
    const [row] = rosterRows([busy]);
    expect(row.sessionsCompleted).toBe(3);
    expect(row.sessionsTotal).toBeNull();
    expect(progressSummary(row)).toBe("Completed 3 sessions");
  });

  it("leaves sessions outside any program out of program progress", () => {
    const dan: CoachingRosterClient = {
      ...DAN,
      programs: [{ ...DAN.programs[0], sessionsCompleted: 1 }],
    };
    const [row] = rosterRows([dan]);
    expect(row.sessionsCompleted).toBe(0);
    expect(progressSummary(row)).toBe("—");
  });
});

describe("clients per program", () => {
  it("counts each person once per program and ignores sessions outside one", () => {
    const twice: CoachingRosterClient = {
      ...ALICE,
      key: "c11",
      programs: [program({ offerId: 9 }), program({ offerId: 9, source: "kajabi" })],
    };
    const counts = clientsPerProgram([ALICE, DAN, twice]);
    expect(counts.get(8)).toBe(1);
    expect(counts.get(9)).toBe(2);
    expect([...counts.keys()].sort()).toEqual([8, 9]);
  });
});
