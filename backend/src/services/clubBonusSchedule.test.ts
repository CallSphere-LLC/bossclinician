import { describe, expect, it } from "vitest";
import { nextSendAt, type SequenceSendRules } from "./sequences";
import {
  bonusDeadlineFor,
  pacificDate,
  promotionConflict,
  reminderSlots,
  type ReminderKey,
  type ReminderLedger,
} from "./clubBonusDeadline";

/**
 * The Club nurture and C1-C3 together, walked with the engine's real
 * scheduler and the live delays of 'practice-prep-to-the-club' (sequence 497,
 * 9 a.m. America/Los_Angeles, no weekend skip), against the revised doc:
 * "Replace Email 8 with C1 and replace Email 11 with C2; retain Email 9 on
 * Day 10 and Email 10 on Day 11 ... preserve at least 24 hours between
 * promotions ... Keep R1-R3 as ordinary invitations after expiry."
 */
const RULES: SequenceSendRules = {
  skipWeekends: false,
  windowStartMinute: null,
  windowEndMinute: null,
  timezone: "America/Los_Angeles",
  sendAtMinute: 540,
};

/** position → delay_minutes, as live on 22 Nov 2026 (Email 1 … R3). */
const DELAYS: Array<[number, number]> = [
  [1, 0], [2, 1440], [3, 2880], [4, 1440], [5, 2880], [6, 1440], [7, 1440], [8, 1440],
  [9, 1440], [10, 1440], [11, 2880], [12, 2880], [13, 2880], [14, 2880],
];
/** Migration 221's replacement rules; migration 215's spacing rule is on 3-17. */
const REPLACES: Record<number, ReminderKey> = { 8: "C1", 11: "C2" };

function walk(registeredAt: Date) {
  const deadline = bonusDeadlineFor(registeredAt);
  const slots = reminderSlots(deadline);
  const sent: Array<{ label: string; at: Date }> = [];
  let at = registeredAt;
  for (const [position, delay] of DELAYS) {
    at = nextSendAt(at, delay, RULES);
    // Every reminder whose slot has come has gone, at its slot.
    const ledger: ReminderLedger = {};
    for (const s of slots) if (s.sendAt.getTime() <= at.getTime()) ledger[s.key] = { sentAt: s.sendAt, sent: true };
    const skipped = position >= 3 ? promotionConflict(deadline, at, ledger, REPLACES[position]) : "";
    if (!skipped) sent.push({ label: position <= 11 ? `E${position}` : `R${position - 11}`, at });
  }
  for (const s of slots) sent.push({ label: s.key, at: s.sendAt });
  sent.sort((a, b) => a.at.getTime() - b.at.getTime());
  const day0 = pacificDate(registeredAt);
  const dayOf = (d: Date) => {
    const p = pacificDate(d);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(day0.year, day0.month - 1, day0.day)) / 86_400_000);
  };
  return sent.map((s) => `${s.label}@D${dayOf(s.at)}`);
}

describe("Club nurture with C1-C3 (the doc's calendar)", () => {
  it("a 2 p.m. registrant: C1 replaces Email 8, C2 replaces Email 11, Emails 9-10 kept, R1-R3 after expiry", () => {
    expect(walk(new Date("2026-11-22T14:00:00-08:00"))).toEqual([
      "E1@D0", "E2@D1", "E3@D3", "E4@D4", "E5@D6", "E6@D7", "E7@D8",
      "C1@D9", "E9@D10", "E10@D11", "C2@D12", "C3@D14",
      "R1@D15", "R2@D17", "R3@D19",
    ]);
  });

  it("keeps a full day between every promotion from Day 3 on", () => {
    const deadline = bonusDeadlineFor(new Date("2026-11-22T14:00:00-08:00"));
    expect(deadline.toISOString()).toBe("2026-12-07T07:59:59.999Z"); // C3 day = D14
    const days = walk(new Date("2026-11-22T14:00:00-08:00"))
      .slice(2)
      .map((s) => Number(s.split("@D")[1]));
    for (let i = 1; i < days.length; i += 1) expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(1);
  });

  it("across the 14 March 2027 clock change", () => {
    expect(walk(new Date("2027-02-28T10:00:00-08:00"))).toEqual([
      "E1@D0", "E2@D1", "E3@D3", "E4@D4", "E5@D6", "E6@D7", "E7@D8",
      "C1@D9", "E9@D10", "E10@D11", "C2@D12", "C3@D14",
      "R1@D15", "R2@D17", "R3@D19",
    ]);
  });

  it("KNOWN DEVIATION: after 9 p.m. Pacific the engine puts Email 2 on Day 2, so the nurture runs a day late", () => {
    // The engine never sends more than 12 hours early, so Email N lands on
    // Day N+1 (the deadline is still Day 14). Two emails cannot share a day
    // with a reminder, so Email 7 (Day 9 = C1) and Email 10 (Day 12 = C2) are
    // suppressed besides the replaced 8 and 11; spacing still holds.
    expect(walk(new Date("2026-11-22T22:30:00-08:00"))).toEqual([
      "E1@D0", "E2@D2", "E3@D4", "E4@D5", "E5@D7", "E6@D8",
      "C1@D9", "E9@D11", "C2@D12", "C3@D14",
      "R1@D16", "R2@D18", "R3@D20",
    ]);
  });
});
