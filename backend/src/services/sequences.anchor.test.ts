import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sheet row 249 (migration 220): sequences timed from a retreat's end date.
 *
 * The engine change is additive: a sequence with no anchor_kind issues exactly
 * the queries it always did and is timed from the previous email; an anchored
 * one is timed from its retreat, holds an email whose link is not set yet, and
 * skips on the retreat rules (feedback given, invitations declined, ...).
 */

interface EmailRow {
  id: number;
  position: number;
  delay_minutes: number;
  anchor_offset_days: number | null;
  subject: string;
  body_md: string;
  preview_text: string;
  skip_rules: unknown;
  topic: string | null;
}

const ALUMNI: EmailRow[] = [
  { id: 1, position: 1, delay_minutes: 4320, anchor_offset_days: 3, subject: "We made those memories together", body_md: "Hey {{firstName}}, [OPEN]({{retreatMemoriesUrl}} \"button\")", preview_text: "", skip_rules: {}, topic: "" },
  { id: 2, position: 2, delay_minutes: 5760, anchor_offset_days: 7, subject: "Can I ask you something?", body_md: "[SHARE]({{retreatFeedbackUrl}} \"button\")", preview_text: "", skip_rules: { retreat: { feedbackSubmitted: true } }, topic: "" },
  { id: 3, position: 3, delay_minutes: 10080, anchor_offset_days: 14, subject: "Where next?", body_md: "[TELL]({{retreatInterestUrl}} \"button\")", preview_text: "", skip_rules: { retreat: { interestSet: true, marketingOptedOut: true } }, topic: "marketing" },
  { id: 4, position: 4, delay_minutes: 10080, anchor_offset_days: 21, subject: "Your turn", body_md: "[EXPLORE]({{retreatNextUrl}} \"button\")", preview_text: "", skip_rules: { retreat: { marketingOptedOut: true, bookedFeatured: true } }, topic: "marketing" },
];

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  anchorKind: null as string | null,
  status: "active",
  position: 1,
  anchorRetreatId: null as number | null,
  emails: [] as EmailRow[],
  retreat: { id: 5, slug: "bali-2027", title: "Bali 2027", end_date: "2027-06-20", timezone: "America/Los_Angeles" } as
    | { id: number; slug: string; title: string; end_date: string | null; timezone: string }
    | null,
  nextUrl: "",
  feedbackRows: 0,
  booked: 0,
  interestRows: [] as Array<{ retreat_id: number; interest: string | null; marketing_opt_in: boolean | null }>,
  existingSub: null as { id: string; status: string } | null,
  sendEmail: vi.fn(),
  publishDomainEvent: vi.fn(),
}));

function answer(sql: string, params: unknown[]) {
  state.queries.push({ sql, params });
  const text = sql.replace(/\s+/g, " ").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [], rowCount: 0 };
  if (text.includes("FROM sequence_subscriptions WHERE id = $1 FOR UPDATE")) {
    return {
      rows: [
        {
          id: "77",
          sequence_id: 900,
          contact_id: 9,
          status: "active",
          position: state.position,
          next_send_at: new Date("2026-01-01T00:00:00Z"),
          source_offer_id: null,
          anchor_retreat_id: state.anchorRetreatId,
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM sequence_subscriptions WHERE sequence_id = $1 AND contact_id = $2")) {
    return state.existingSub ? { rows: [state.existingSub], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (text.includes("INSERT INTO sequence_subscriptions")) return { rows: [{ id: "88" }], rowCount: 1 };
  if (text.includes("FROM email_sequences WHERE id = $1")) {
    return {
      rows: [
        {
          id: 900,
          name: "Retreat Alumni",
          status: state.status,
          topic: "marketing",
          skip_weekends: false,
          send_window_start_minute: null,
          send_window_end_minute: null,
          use_contact_timezone: false,
          timezone: "America/Los_Angeles",
          exit_on_purchase: false,
          exit_tag_id: null,
          completion_tag_id: null,
          allow_reentry: true,
          requires_offer_id: null,
          send_at_minute: 540,
          anchor_kind: state.anchorKind,
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("SELECT timezone FROM contacts WHERE id = $1")) {
    return { rows: [{ timezone: "America/New_York" }], rowCount: 1 };
  }
  if (text.includes("FROM contacts WHERE id = $1")) {
    return {
      rows: [
        {
          email: "guest@example.com",
          name: "Guest",
          first_name: "Jasmine",
          last_name: "",
          timezone: "America/New_York",
          email_marketing_status: "subscribed",
          custom_fields: {},
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM retreats WHERE id = $1")) {
    return state.retreat ? { rows: [state.retreat], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (text.includes("SELECT next_url FROM retreat_alumni_settings")) {
    return { rows: [{ next_url: state.nextUrl }], rowCount: 1 };
  }
  if (text.includes("JOIN retreats fr")) return { rows: [], rowCount: state.booked };
  if (text.includes("FROM retreat_feedback")) return { rows: [], rowCount: state.feedbackRows };
  if (text.includes("FROM retreat_interest")) return { rows: state.interestRows, rowCount: state.interestRows.length };
  if (text.includes("FROM sequence_emails") && text.includes("position >= $2")) {
    const rows = state.emails.filter((e) => e.position >= Number(params[1]));
    if (text.includes("LIMIT 1")) return { rows: rows.slice(0, 1), rowCount: Math.min(rows.length, 1) };
    return { rows, rowCount: rows.length };
  }
  if (text.includes("FROM sequence_emails") && text.includes("position > $2")) {
    const next = state.emails.find((e) => e.position > Number(params[1]));
    return next ? { rows: [next], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 1 };
}

vi.mock("../db/pool", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => answer(sql, params)),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => answer(sql, params)),
      release: vi.fn(),
    })),
  },
}));
vi.mock("../config/env", () => ({ env: { publicSiteUrl: "https://www.bossclinician.com" } }));
vi.mock("../email/provider", () => ({
  mergeLinks: () => ({ unsubscribeUrl: "", loginUrl: "", startUrl: "" }),
  renderMarkdown: (s: string) => s,
  // The real renderer's token rule, so the retreat links can be seen in the output.
  renderTokens: (s: string, values: Record<string, string>) =>
    s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => values[k] ?? ""),
  sendEmail: state.sendEmail,
}));
vi.mock("../email/mergeValues", () => ({ buildMergeValues: () => ({ firstName: "Jasmine" }) }));
vi.mock("../jobs/queue", () => ({ PRIORITY: { normal: 5, bulk: 1 }, enqueueMany: vi.fn(async () => 0) }));
vi.mock("./contacts", () => ({ applyTags: vi.fn(), recordActivity: vi.fn() }));
vi.mock("./domainEvents", () => ({ publishDomainEvent: state.publishDomainEvent }));

import { enrollContact, sendDueEmail } from "./sequences";

const updates = () => state.queries.filter((q) => /UPDATE sequence_subscriptions/.test(q.sql));
const advance = () => updates().find((q) => /SET position = \$2, next_send_at = \$3/.test(q.sql));
const touchedRetreatTables = () =>
  state.queries.some((q) => /FROM retreats|retreat_alumni_settings|retreat_feedback|retreat_interest/.test(q.sql));

beforeEach(() => {
  state.queries = [];
  state.anchorKind = null;
  state.status = "active";
  state.position = 1;
  state.anchorRetreatId = null;
  state.emails = ALUMNI.map((e) => ({ ...e }));
  state.retreat = { id: 5, slug: "bali-2027", title: "Bali 2027", end_date: "2027-06-20", timezone: "America/Los_Angeles" };
  state.nextUrl = "";
  state.feedbackRows = 0;
  state.booked = 0;
  state.interestRows = [];
  state.existingSub = null;
  state.sendEmail.mockReset();
  state.sendEmail.mockResolvedValue({ messageId: 1, outcome: "sent", providerMessageId: "x", suppressedReason: "" });
  state.publishDomainEvent.mockReset();
});

describe("classic sequences are unchanged", () => {
  it("times the next email from the send, on its own delay, and never reads a retreat table", async () => {
    // Classic emails have no per-email topic either.
    state.emails = ALUMNI.map((e) => ({ ...e, anchor_offset_days: null, topic: null, skip_rules: {} }));
    const now = new Date("2026-11-16T12:00:00Z");

    const result = await sendDueEmail(77, now);

    expect(result.outcome).toBe("sent");
    expect(state.sendEmail.mock.calls[0][0]).toMatchObject({ topic: "marketing", sourceType: "sequence" });
    // Email 2 waits 4 days (5760 min) from now, landing 9am Pacific: Fri 20 Nov 2026, 17:00 UTC.
    expect(advance()?.params).toEqual(["77", 2, new Date("2026-11-20T17:00:00Z")]);
    expect(touchedRetreatTables()).toBe(false);
  });

  it("ignores retreat skip rules on a classic sequence", async () => {
    state.emails = ALUMNI.map((e) => ({ ...e, anchor_offset_days: null, topic: null }));
    state.position = 2;
    state.feedbackRows = 1;

    const result = await sendDueEmail(77, new Date("2026-11-16T12:00:00Z"));

    expect(result.outcome).toBe("sent");
    expect(touchedRetreatTables()).toBe(false);
  });

  it("enrols on the classic delay and stores no retreat", async () => {
    state.emails = ALUMNI.map((e) => ({ ...e, anchor_offset_days: null }));
    const now = new Date("2026-11-16T12:00:00Z");

    const result = await enrollContact(900, 9, { now, anchorRetreatId: 5 });

    expect(result.outcome).toBe("enrolled");
    const insert = state.queries.find((q) => /INSERT INTO sequence_subscriptions/.test(q.sql));
    // 3 days (4320 min) from now at 9am Pacific: Thu 19 Nov 2026, 17:00 UTC. Retreat id ignored.
    expect(insert?.params).toEqual([900, 9, 1, new Date("2026-11-19T17:00:00Z"), null, null, null]);
    expect(touchedRetreatTables()).toBe(false);
  });
});

describe("retreat-anchored sequences", () => {
  beforeEach(() => {
    state.anchorKind = "retreat_end";
    state.anchorRetreatId = 5;
  });

  it("enrols timed from the retreat end date, not from enrolment", async () => {
    const now = new Date("2027-06-21T03:00:00Z"); // evening of the end date in Pacific

    const result = await enrollContact(900, 9, { now, anchorRetreatId: 5, source: { offerId: 107, orderId: 28 } });

    expect(result.outcome).toBe("enrolled");
    const insert = state.queries.find((q) => /INSERT INTO sequence_subscriptions/.test(q.sql));
    expect(insert?.params).toEqual([900, 9, 1, new Date("2027-06-23T16:00:00Z"), 107, 28, 5]);
  });

  it("refuses an anchored enrolment with no retreat (admin add-by-hand, an automation)", async () => {
    const result = await enrollContact(900, 9, { now: new Date("2027-06-21T03:00:00Z") });

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/retreat/);
    expect(state.queries.some((q) => /INSERT INTO sequence_subscriptions/.test(q.sql))).toBe(false);
  });

  it("refuses a draft sequence, so nothing is enrolled before it is switched on", async () => {
    state.status = "draft";
    const result = await enrollContact(900, 9, { now: new Date("2027-06-21T03:00:00Z"), anchorRetreatId: 5 });
    expect(result).toMatchObject({ outcome: "blocked", reason: "sequence is not active" });
  });

  it("starts a late enrolment at the first email still inside its grace period", async () => {
    const now = new Date("2027-06-28T00:00:00Z"); // Email 1 is 4+ days past; Email 2 is 8 hours past
    const result = await enrollContact(900, 9, { now, anchorRetreatId: 5 });
    expect(result.outcome).toBe("enrolled");
    const insert = state.queries.find((q) => /INSERT INTO sequence_subscriptions/.test(q.sql));
    expect(insert?.params.slice(2, 4)).toEqual([2, new Date("2027-06-27T16:00:00Z")]);
  });

  it("sends Email 1 as relationship mail with the guest's memories link, then times Email 2 from the end date", async () => {
    const now = new Date("2027-06-23T16:00:30Z");

    const result = await sendDueEmail(77, now);

    expect(result.outcome).toBe("sent");
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.topic).toBe("");
    expect(sent.text).toContain("https://www.bossclinician.com/retreats/dashboard/bali-2027/memories");
    expect(advance()?.params).toEqual(["77", 2, new Date("2027-06-27T16:00:00Z")]);
  });

  it("skips Email 2 once the guest has shared feedback, and times Email 3 from the end date", async () => {
    state.position = 2;
    state.feedbackRows = 1;

    const result = await sendDueEmail(77, new Date("2027-06-27T16:05:00Z"));

    expect(result).toMatchObject({ outcome: "skipped" });
    expect(result.detail).toMatch(/feedback/);
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(advance()?.params).toEqual(["77", 3, new Date("2027-07-04T16:00:00Z")]);
  });

  it("skips Email 3 for a guest who said 'not at this time' on any retreat", async () => {
    state.position = 3;
    state.interestRows = [{ retreat_id: 2, interest: "Not at this time", marketing_opt_in: null }];

    const result = await sendDueEmail(77, new Date("2027-07-04T16:05:00Z"));

    expect(result.detail).toMatch(/declined/);
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("sends Email 3 as marketing when the guest has not answered", async () => {
    state.position = 3;
    const result = await sendDueEmail(77, new Date("2027-07-04T16:05:00Z"));
    expect(result.outcome).toBe("sent");
    expect(state.sendEmail.mock.calls[0][0].topic).toBe("marketing");
    expect(state.sendEmail.mock.calls[0][0].text).toContain("/retreats/dashboard/bali-2027/interest");
  });

  it("holds Email 4 while its link is not set, without sending or advancing", async () => {
    state.position = 4;
    const now = new Date("2027-07-11T16:05:00Z");

    const result = await sendDueEmail(77, now);

    expect(result.outcome).toBe("skipped");
    expect(result.detail).toMatch(/on hold .*retreatNextUrl/);
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(advance()).toBeUndefined();
    const hold = updates().find((q) => /SET next_send_at = \$2/.test(q.sql));
    expect(hold?.params).toEqual(["77", new Date(now.getTime() + 6 * 60 * 60_000)]);
  });

  it("skips Email 4 for a guest who already booked the featured retreat", async () => {
    state.position = 4;
    state.nextUrl = "https://www.bossclinician.com/retreats";
    state.booked = 1;
    const result = await sendDueEmail(77, new Date("2027-07-11T16:05:00Z"));
    expect(result.detail).toMatch(/booked/);
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("sends Email 4 once the link is set, and finishes the run", async () => {
    state.position = 4;
    state.nextUrl = "https://www.bossclinician.com/retreats";

    const result = await sendDueEmail(77, new Date("2027-07-11T16:05:00Z"));

    expect(result.outcome).toBe("completed");
    expect(state.sendEmail.mock.calls[0][0].text).toContain("https://www.bossclinician.com/retreats");
  });

  it("drops Email 4 if the link is still unset three days after its date", async () => {
    state.position = 4;
    const result = await sendDueEmail(77, new Date("2027-07-14T17:00:00Z"));
    expect(result.outcome).toBe("completed");
    expect(result.detail).toMatch(/too late/);
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("waits instead of sending when the retreat's dates were moved later", async () => {
    state.retreat = { ...state.retreat!, end_date: "2027-07-20" };

    const result = await sendDueEmail(77, new Date("2027-06-23T16:05:00Z"));

    expect(result).toMatchObject({ outcome: "not_due" });
    expect(state.sendEmail).not.toHaveBeenCalled();
    const moved = updates().find((q) => /SET next_send_at = \$2/.test(q.sql));
    expect(moved?.params).toEqual(["77", new Date("2027-07-23T16:00:00Z")]);
  });

  it("holds every email while the retreat dashboard is unpublished", async () => {
    state.retreat = { ...state.retreat!, published: false } as typeof state.retreat;
    const result = await sendDueEmail(77, new Date("2027-06-23T16:05:00Z"));
    expect(result.outcome).toBe("skipped");
    expect(result.detail).toMatch(/not published/);
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("goes by the guest's most recent consent answer", async () => {
    state.position = 4;
    state.nextUrl = "https://www.bossclinician.com/retreats";
    // Most recent first (the query orders by updated_at DESC): a later yes wins.
    state.interestRows = [
      { retreat_id: 9, interest: "both", marketing_opt_in: true },
      { retreat_id: 5, interest: "not_now", marketing_opt_in: false },
    ];
    const result = await sendDueEmail(77, new Date("2027-07-11T16:05:00Z"));
    expect(result.outcome).toBe("completed");
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
    const consent = state.queries.find((q) => /FROM retreat_interest/.test(q.sql));
    expect(consent?.sql).toMatch(/ORDER BY x\.updated_at DESC/);
  });

  it("ends the run when its retreat is gone", async () => {
    state.retreat = null;
    const result = await sendDueEmail(77, new Date("2027-06-23T16:05:00Z"));
    expect(result).toMatchObject({ outcome: "exited" });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });
});
