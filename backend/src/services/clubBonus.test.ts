import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Yvette, 22 Nov 2026, item 3 (migration 215): the saved per-subscriber window,
 * the order decision, and the signed /club link.
 */

vi.mock("../config/env", () => ({
  env: { jwtSecret: "club-bonus-test-secret", publicSiteUrl: "https://www.bossclinician.com" },
}));
vi.mock("../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../email/provider", () => ({
  mergeLinks: vi.fn(() => ({ unsubscribeUrl: "", loginUrl: "", startUrl: "" })),
  renderMarkdown: vi.fn((s: string) => s),
  renderTokens: vi.fn((s: string) => s),
  sendEmail: vi.fn(),
}));
vi.mock("./access", () => ({ grantAccess: vi.fn() }));

import {
  clubBonusLink,
  decideOrderBonus,
  ensureWindow,
  resetClubBonusCache,
  signClubBonusToken,
  usesClubBonusTokens,
  verifyClubBonusToken,
  windowState,
  type BonusWindow,
} from "./clubBonus";

const GO_LIVE = new Date("2026-11-22T16:00:00Z");

/** A small in-memory stand-in for the four queries ensureWindow makes. */
function fakeDb(submissions: Array<{ id: number; email: string; created_at: Date }>) {
  const windows: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT value FROM settings")) {
      return { rows: [{ value: { goLiveAt: GO_LIVE.toISOString(), registrationFormIds: [532] } }], rowCount: 1 };
    }
    if (text.includes("FROM club_bonus_windows WHERE email = $1")) {
      const row = windows.find((w) => w.email === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes("FROM form_submissions fs")) {
      const email = params[1] as string;
      const rows = submissions
        .filter((s) => s.email.toLowerCase() === email)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, 1)
        .map((s) => ({ id: s.id, created_at: s.created_at, contact_id: 7 }));
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith("INSERT INTO club_bonus_windows")) {
      if (!windows.some((w) => w.email === params[0])) {
        windows.push({
          id: String(nextId++),
          email: params[0],
          contact_id: params[1],
          first_registered_at: params[2],
          deadline_at: params[4],
          rule: params[5],
        });
      }
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  return { db: { query } as never, windows, submissions };
}

beforeEach(() => resetClubBonusCache());

describe("ensureWindow", () => {
  it("saves the deadline from the first registration, once", async () => {
    const { db, submissions } = fakeDb([
      { id: 1, email: "Reader@Example.com", created_at: new Date("2026-11-22T22:00:00Z") }, // Nov 22 2 p.m. PT
    ]);
    const first = await ensureWindow(db, "reader@example.com");
    expect(first?.deadlineAt?.toISOString()).toBe("2026-12-07T07:59:59.999Z");
    expect(first?.rule).toBe("first_registration");

    // Registering again a week later does not restart the window.
    submissions.push({ id: 2, email: "reader@example.com", created_at: new Date("2026-11-29T18:00:00Z") });
    const again = await ensureWindow(db, " READER@example.com ");
    expect(again?.id).toBe(first?.id);
    expect(again?.deadlineAt?.toISOString()).toBe("2026-12-07T07:59:59.999Z");
  });

  it("saves somebody who registered before go-live as undecided, never expired", async () => {
    const { db } = fakeDb([{ id: 3, email: "early@example.com", created_at: new Date("2026-10-22T08:58:00Z") }]);
    const window = await ensureWindow(db, "early@example.com");
    expect(window?.deadlineAt).toBeNull();
    expect(window?.rule).toBe("legacy_pending");
    expect(windowState(window, new Date("2026-12-25T00:00:00Z"))).toBe("pending");
  });

  it("returns null for an address that never registered", async () => {
    const { db } = fakeDb([]);
    expect(await ensureWindow(db, "nobody@example.com")).toBeNull();
    expect(await ensureWindow(db, "")).toBeNull();
  });
});

const OPEN: BonusWindow = {
  id: 11,
  email: "reader@example.com",
  contactId: 7,
  firstRegisteredAt: new Date("2026-11-22T22:00:00Z"),
  deadlineAt: new Date("2026-12-07T07:59:59.999Z"),
  rule: "first_registration",
};

describe("decideOrderBonus", () => {
  it("includes the bonus for an order placed at 11:59 p.m. Pacific on the last day", () => {
    expect(decideOrderBonus(OPEN, new Date("2026-12-06T23:59:00-08:00"), true)).toEqual({
      included: true,
      reason: "within_window",
      windowId: 11,
    });
  });

  it("does not include it for an order placed at midnight", () => {
    expect(decideOrderBonus(OPEN, new Date("2026-12-07T00:00:00-08:00"), true).included).toBe(false);
    expect(decideOrderBonus(OPEN, new Date("2026-12-07T00:00:00-08:00"), true).reason).toBe("expired");
  });

  it("does not include it for a buyer who never registered for the training", () => {
    expect(decideOrderBonus(null, new Date(), true)).toEqual({ included: false, reason: "not_registered", windowId: null });
  });

  it("follows the documented choice for undecided existing registrants", () => {
    const pending = { ...OPEN, deadlineAt: null, rule: "legacy_pending" };
    expect(decideOrderBonus(pending, new Date("2027-01-01"), true).included).toBe(true);
    expect(decideOrderBonus(pending, new Date("2027-01-01"), false).included).toBe(false);
  });
});

describe("the signed /club link", () => {
  it("round-trips the window id and nothing else", () => {
    const token = signClubBonusToken(11);
    expect(verifyClubBonusToken(token)).toBe(11);
    expect(token).not.toContain("@");
    expect(clubBonusLink(OPEN)).toBe(`https://www.bossclinician.com/club?b=${token}`);
  });

  it("refuses a forged or altered token", () => {
    const token = signClubBonusToken(11);
    const [body, sig] = token.split(".");
    const otherBody = Buffer.from("cb1.12", "utf8").toString("base64url");
    expect(verifyClubBonusToken(`${otherBody}.${sig}`)).toBeNull();
    expect(verifyClubBonusToken(`${body}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(verifyClubBonusToken("")).toBeNull();
    expect(verifyClubBonusToken("not-a-token")).toBeNull();
  });

  it("is plain /club for somebody with no window", () => {
    expect(clubBonusLink(null)).toBe("https://www.bossclinician.com/club");
  });
});

describe("usesClubBonusTokens", () => {
  it("spots the two tokens and nothing else", () => {
    expect(usesClubBonusTokens("Join The Club by {{clubBonusDeadline}} at 11:59 p.m.")).toBe(true);
    expect(usesClubBonusTokens('<a href="{{ clubBonusLink }}">')).toBe(true);
    expect(usesClubBonusTokens("Hey {{first_name}}", null, undefined)).toBe(false);
  });
});
