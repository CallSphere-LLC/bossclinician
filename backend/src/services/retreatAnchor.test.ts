import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  ANCHOR_LATE_LIMIT_MINUTES,
  anchoredSendAt,
  firstSendableAnchoredEmail,
  isNotNowInterest,
  isTooLate,
  missingRetreatTokens,
  parseRetreatSkipRules,
  retreatMergeValues,
  retreatSkipReason,
} from "./retreatAnchor";
import { ALUMNI_EMAILS } from "./retreatAlumniEmails";

/**
 * Sheet row 249 (migration 220): the post-retreat alumni emails go Day +3, +7,
 * +14 and +21 after each retreat's END DATE at 9:00 a.m. in the retreat's zone.
 */

const iso = (d: Date) => d.toISOString();
const LA = "America/Los_Angeles";
const NINE = 540;

describe("anchoredSendAt", () => {
  it("Bali 15-20 June 2027 -> 23 Jun, 27 Jun, 4 Jul, 11 Jul 2027 at 9:00 a.m. Pacific", () => {
    const dates = ALUMNI_EMAILS.map((e) => iso(anchoredSendAt("2027-06-20", e.offsetDays, NINE, LA)));
    expect(dates).toEqual([
      "2027-06-23T16:00:00.000Z",
      "2027-06-27T16:00:00.000Z",
      "2027-07-04T16:00:00.000Z",
      "2027-07-11T16:00:00.000Z",
    ]);
  });

  it("keeps 9:00 a.m. local across the spring-forward change (retreat ending 12 Mar 2027)", () => {
    // DST starts Sunday 14 Mar 2027: the end date itself is PST, every email after is PDT.
    expect(iso(anchoredSendAt("2027-03-12", 0, NINE, LA))).toBe("2027-03-12T17:00:00.000Z");
    expect(iso(anchoredSendAt("2027-03-12", 3, NINE, LA))).toBe("2027-03-15T16:00:00.000Z");
    expect(iso(anchoredSendAt("2027-03-12", 7, NINE, LA))).toBe("2027-03-19T16:00:00.000Z");
    expect(iso(anchoredSendAt("2027-03-12", 21, NINE, LA))).toBe("2027-04-02T16:00:00.000Z");
  });

  it("keeps 9:00 a.m. local across the fall-back change (retreat ending 31 Oct 2027)", () => {
    // DST ends Sunday 7 Nov 2027.
    expect(iso(anchoredSendAt("2027-10-31", 3, NINE, LA))).toBe("2027-11-03T16:00:00.000Z");
    expect(iso(anchoredSendAt("2027-10-31", 7, NINE, LA))).toBe("2027-11-07T17:00:00.000Z");
    expect(iso(anchoredSendAt("2027-10-31", 14, NINE, LA))).toBe("2027-11-14T17:00:00.000Z");
  });

  it("rolls over months and years on the calendar", () => {
    expect(iso(anchoredSendAt("2027-12-28", 7, NINE, LA))).toBe("2028-01-04T17:00:00.000Z");
    expect(iso(anchoredSendAt("2028-02-25", 3, NINE, LA))).toBe("2028-02-28T17:00:00.000Z");
    expect(iso(anchoredSendAt("2028-02-27", 3, NINE, LA))).toBe("2028-03-01T17:00:00.000Z");
  });

  it("uses the retreat's own zone, not the server's", () => {
    expect(iso(anchoredSendAt("2027-06-20", 3, NINE, "America/New_York"))).toBe("2027-06-23T13:00:00.000Z");
    expect(iso(anchoredSendAt("2027-06-20", 3, NINE, "Asia/Makassar"))).toBe("2027-06-23T01:00:00.000Z");
  });

  it("defaults to 9:00 a.m. and survives a bad zone", () => {
    expect(iso(anchoredSendAt("2027-06-20", 3, null, LA))).toBe("2027-06-23T16:00:00.000Z");
    expect(iso(anchoredSendAt("2027-06-20", 3, NINE, "Not/AZone"))).toBe("2027-06-23T16:00:00.000Z");
  });

  it("refuses an unreadable end date instead of guessing", () => {
    expect(() => anchoredSendAt("", 3, NINE, LA)).toThrow();
  });
});

describe("firstSendableAnchoredEmail", () => {
  const emails = ALUMNI_EMAILS.map((e) => ({ position: e.position, anchorOffsetDays: e.offsetDays }));
  const anchor = { endDate: "2027-06-20", timezone: LA };

  it("starts at Email 1 when enrolled on the end date", () => {
    const pick = firstSendableAnchoredEmail(emails, anchor, NINE, new Date("2027-06-21T03:00:00Z"));
    expect(pick?.email.position).toBe(1);
    expect(iso(pick!.sendAt)).toBe("2027-06-23T16:00:00.000Z");
  });

  it("still sends an email due within the grace period, skips older ones", () => {
    const withinGrace = firstSendableAnchoredEmail(emails, anchor, NINE, new Date("2027-06-25T16:00:00Z"));
    expect(withinGrace?.email.position).toBe(1);
    const afterGrace = firstSendableAnchoredEmail(emails, anchor, NINE, new Date("2027-06-26T17:00:00Z"));
    expect(afterGrace?.email.position).toBe(2);
  });

  it("returns null when every email is past", () => {
    expect(firstSendableAnchoredEmail(emails, anchor, NINE, new Date("2027-08-30T00:00:00Z"))).toBeNull();
  });

  it("isTooLate matches the grace limit", () => {
    const due = new Date("2027-06-23T16:00:00Z");
    expect(isTooLate(due, new Date(due.getTime() + ANCHOR_LATE_LIMIT_MINUTES * 60_000))).toBe(false);
    expect(isTooLate(due, new Date(due.getTime() + ANCHOR_LATE_LIMIT_MINUTES * 60_000 + 1))).toBe(true);
  });
});

describe("retreat merge values", () => {
  it("builds the dashboard deep links, defaults Email 4 to /upcoming-retreats and refuses a non-https next link", () => {
    const v = retreatMergeValues({ siteUrl: "https://www.bossclinician.com/", slug: "bali-2027", title: "Bali", nextUrl: "" });
    expect(v.retreatMemoriesUrl).toBe("https://www.bossclinician.com/retreats/dashboard/bali-2027/memories");
    expect(v.retreatFeedbackUrl).toBe("https://www.bossclinician.com/retreats/dashboard/bali-2027/feedback");
    expect(v.retreatInterestUrl).toBe("https://www.bossclinician.com/retreats/dashboard/bali-2027/interest");
    expect(v.retreatDashboardUrl).toBe("https://www.bossclinician.com/retreats/dashboard/bali-2027");
    expect(v.retreatNextUrl).toBe("https://www.bossclinician.com/upcoming-retreats");
    expect(retreatMergeValues({ siteUrl: "x", slug: "s", title: "t", nextUrl: "http://insecure" }).retreatNextUrl).toBe("");
    expect(retreatMergeValues({ siteUrl: "x", slug: "s", title: "t", nextUrl: " https://ok.test/next " }).retreatNextUrl).toBe("https://ok.test/next");
  });

  it("flags Email 4 as blocked only while its owner-set link is unusable, and nothing else", () => {
    const fine = retreatMergeValues({ siteUrl: "https://s.test", slug: "bali-2027", title: "Bali", nextUrl: "" });
    expect(ALUMNI_EMAILS.map((e) => missingRetreatTokens([e.subject, e.previewText, e.bodyMd], fine))).toEqual([[], [], [], []]);
    const v = retreatMergeValues({ siteUrl: "https://s.test", slug: "bali-2027", title: "Bali", nextUrl: "not-a-link" });
    const blocked = ALUMNI_EMAILS.map((e) => missingRetreatTokens([e.subject, e.previewText, e.bodyMd], v));
    expect(blocked).toEqual([[], [], [], ["retreatNextUrl"]]);
    const set = { ...v, retreatNextUrl: "https://s.test/next" };
    expect(missingRetreatTokens([ALUMNI_EMAILS[3].bodyMd], set)).toEqual([]);
  });
});

describe("retreat skip rules", () => {
  const none = { feedbackSubmitted: false, interestSet: false, marketingOptedOut: false, bookedFeatured: false };
  const rulesOf = (n: number) => parseRetreatSkipRules(ALUMNI_EMAILS[n - 1].skipRules);

  it("Email 1 is never skipped by a retreat rule", () => {
    const all = { feedbackSubmitted: true, interestSet: true, marketingOptedOut: true, bookedFeatured: true };
    expect(retreatSkipReason(rulesOf(1), all)).toBe("");
  });

  it("Email 2 is skipped once feedback is in, and only then", () => {
    expect(retreatSkipReason(rulesOf(2), { ...none, feedbackSubmitted: true })).toMatch(/feedback/);
    expect(retreatSkipReason(rulesOf(2), { ...none, marketingOptedOut: true, interestSet: true })).toBe("");
  });

  it("Email 3 is skipped once interest is given or invitations declined", () => {
    expect(retreatSkipReason(rulesOf(3), { ...none, interestSet: true })).toMatch(/interest/);
    expect(retreatSkipReason(rulesOf(3), { ...none, marketingOptedOut: true })).toMatch(/declined/);
    expect(retreatSkipReason(rulesOf(3), { ...none, feedbackSubmitted: true })).toBe("");
  });

  it("Email 4 is skipped for guests who declined or already booked the featured retreat", () => {
    expect(retreatSkipReason(rulesOf(4), { ...none, marketingOptedOut: true })).toMatch(/declined/);
    expect(retreatSkipReason(rulesOf(4), { ...none, bookedFeatured: true })).toMatch(/booked/);
    // Telling us an interest is not declining: they still get the invitation.
    expect(retreatSkipReason(rulesOf(4), { ...none, interestSet: true })).toBe("");
  });

  it("reads anything else as no rule", () => {
    expect(parseRetreatSkipRules(null)).toEqual(none);
    expect(parseRetreatSkipRules({ ownsOfferIds: [1] })).toEqual(none);
    expect(parseRetreatSkipRules({ retreat: { feedbackSubmitted: "yes" } })).toEqual(none);
  });

  it("recognises the 'not at this time' answers", () => {
    for (const v of ["not_now", "Not now", "Not at this time", "NOT-AT-THIS-TIME", "none"]) {
      expect(isNotNowInterest(v)).toBe(true);
    }
    for (const v of ["international", "domestic", "both", "", null]) expect(isNotNowInterest(v)).toBe(false);
  });
});

describe("migrations 220 + 225 carry exactly the email text in retreatAlumniEmails.ts", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../db/migrations/220_retreat_alumni_sequence.sql"),
    "utf8"
  );
  const sql225 = fs.readFileSync(
    path.join(__dirname, "../db/migrations/225_retreat_alumni_round2.sql"),
    "utf8"
  );
  /** A dollar-quoted literal from migration 225, e.g. tag "oldp". */
  const lit = (tag: string): string => {
    const m = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(sql225);
    if (!m) throw new Error(`no $${tag}$ literal in 225`);
    return m[1];
  };
  /** Email 4 as 220 inserted it, after 225's guarded revision. */
  const revised = (preview: string, body: string) => ({
    preview: preview === lit("old") ? lit("new") : preview,
    body: body.replace(lit("oldp"), lit("newp")).replace(lit("oldb"), lit("newb")),
  });

  it.each(ALUMNI_EMAILS.map((e) => [e.position, e] as const))("email %i", (_position, e) => {
    expect(sql).toContain(`$subj$${e.subject}$subj$`);
    if (e.position === 4) {
      const prev = /\$prev\$([^$]*)\$prev\$/g;
      const previews = [...sql.matchAll(prev)].map((m) => m[1]);
      const bodies = [...sql.matchAll(/\$body\$([\s\S]*?)\$body\$/g)].map((m) => m[1]);
      const after = revised(previews[3], bodies[3]);
      expect(after.preview).toBe(e.previewText);
      expect(after.body).toBe(e.bodyMd);
    } else {
      expect(sql).toContain(`$prev$${e.previewText}$prev$`);
      expect(sql).toContain(`$body$${e.bodyMd}$body$`);
    }
    expect(sql).toContain(`$rules$${JSON.stringify(e.skipRules)}$rules$`);
    expect(sql).toMatch(new RegExp(`\\(${e.position}, ${e.offsetDays}, \\d+, \\$subj\\$`));
  });

  it("ships the sequence as a draft and the enrolment job disabled", () => {
    expect(sql).toMatch(/'draft', 'marketing', false,/);
    expect(sql).toMatch(/'retreat-alumni-enrol', 'retreatAlumni\.enrol', 60, 'America\/Los_Angeles', false/);
  });
});
