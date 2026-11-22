import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sheet rows 243, 244 and 246 (migration 202): per-email skip rules.
 *
 * "Send the matching Email 2 training invitation if the subscriber has not
 * registered for the Club training or purchased the Club." "Send the two
 * downsell emails only to nonmembers who have not already purchased the
 * Ramp-Up Rate Formula." A skip sends nothing, and the run moves on to the next
 * email timed from the skip — never leaving it due at once — or finishes.
 */

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  skipRules: {} as unknown,
  previewText: "" as string,
  nextEmail: { position: 3, delay_minutes: 2880 } as { position: number; delay_minutes: number } | null,
  ownsRows: [] as Array<{ offer_id: number }>,
  formRows: [] as Array<{ form_id: number }>,
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
          sequence_id: 476,
          contact_id: 9,
          status: "active",
          position: 2,
          next_send_at: new Date("2026-11-01T00:00:00Z"),
          source_offer_id: null,
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM email_sequences WHERE id = $1")) {
    return {
      rows: [
        {
          id: 476,
          name: "Quiz — Not Quite Yet",
          status: "active",
          topic: "marketing",
          skip_weekends: false,
          send_window_start_minute: null,
          send_window_end_minute: null,
          use_contact_timezone: false,
          timezone: "America/Los_Angeles",
          exit_on_purchase: false,
          exit_tag_id: null,
          completion_tag_id: null,
          allow_reentry: false,
          requires_offer_id: null,
          send_at_minute: 540,
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM contacts WHERE id = $1")) {
    return {
      rows: [
        {
          email: "Reader@Example.com",
          name: "Reader",
          first_name: "Rea",
          last_name: "Der",
          timezone: "America/New_York",
          email_marketing_status: "subscribed",
          custom_fields: {},
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM access_grants")) return { rows: state.ownsRows, rowCount: state.ownsRows.length };
  if (text.includes("FROM form_submissions")) return { rows: state.formRows, rowCount: state.formRows.length };
  if (text.includes("FROM contact_tags")) return { rows: [], rowCount: 0 };
  if (text.includes("FROM sequence_emails") && text.includes("position >= $2")) {
    return {
      rows: [
        {
          id: 1535,
          position: 2,
          subject: "You can explore private practice while keeping your job",
          body_md: "Hey {{first_name}},",
          from_name: "",
          from_email: "",
          preview_text: state.previewText,
          skip_rules: state.skipRules,
        },
      ],
      rowCount: 1,
    };
  }
  if (text.includes("FROM sequence_emails") && text.includes("position > $2")) {
    return state.nextEmail ? { rows: [state.nextEmail], rowCount: 1 } : { rows: [], rowCount: 0 };
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
vi.mock("../email/provider", () => ({
  mergeLinks: (s: string) => s,
  renderMarkdown: (s: string) => s,
  renderTokens: (s: string) => s,
  sendEmail: state.sendEmail,
}));
vi.mock("../email/mergeValues", () => ({ buildMergeValues: () => ({}) }));
vi.mock("../jobs/queue", () => ({ PRIORITY: { normal: 5, bulk: 1 }, enqueueMany: vi.fn(async () => 0) }));
vi.mock("./contacts", () => ({ applyTags: vi.fn(), recordActivity: vi.fn() }));
vi.mock("./domainEvents", () => ({ publishDomainEvent: state.publishDomainEvent }));

import { hasSkipRules, parseSkipRules, sendDueEmail } from "./sequences";

describe("parseSkipRules", () => {
  it("reads the three lists and nothing else", () => {
    expect(parseSkipRules({ ownsOfferIds: [39, "20", 39], submittedFormIds: [532], hasTagIds: [] })).toEqual({
      ownsOfferIds: [39, 20],
      submittedFormIds: [532],
      hasTagIds: [],
    });
  });

  it("treats anything it cannot read as no rule at all", () => {
    for (const raw of [null, undefined, "", "x", [], 5, { ownsOfferIds: "39" }, { ownsOfferIds: [0, -1, 1.5, "a"] }]) {
      const rules = parseSkipRules(raw);
      expect(hasSkipRules(rules)).toBe(false);
    }
  });

  it("reads the Club bonus reminder-day rule only when it is exactly true (migration 215)", () => {
    expect(parseSkipRules({ clubBonusReminderDay: true }).clubBonusReminderDay).toBe(true);
    expect(hasSkipRules(parseSkipRules({ clubBonusReminderDay: true }))).toBe(true);
    for (const raw of [{ clubBonusReminderDay: "true" }, { clubBonusReminderDay: 1 }, { clubBonusReminderDay: false }]) {
      expect(parseSkipRules(raw).clubBonusReminderDay).toBeUndefined();
      expect(hasSkipRules(parseSkipRules(raw))).toBe(false);
    }
  });
});

describe("sendDueEmail with skip rules", () => {
  // 04:00 in Los Angeles on Monday 16 November.
  const now = new Date("2026-11-16T12:00:00Z");
  const updates = () => state.queries.filter((q) => /UPDATE sequence_subscriptions/.test(q.sql));

  beforeEach(() => {
    state.queries = [];
    state.skipRules = {};
    state.previewText = "";
    state.nextEmail = { position: 3, delay_minutes: 2880 };
    state.ownsRows = [];
    state.formRows = [];
    state.sendEmail.mockReset();
    state.sendEmail.mockResolvedValue({ messageId: 1, outcome: "sent", providerMessageId: "x", suppressedReason: "" });
    state.publishDomainEvent.mockReset();
  });

  it("skips the invitation for somebody who already registered, and times the next one from now", async () => {
    state.skipRules = { ownsOfferIds: [39], submittedFormIds: [532] };
    state.formRows = [{ form_id: 532 }];

    const result = await sendDueEmail(77, now);

    expect(result).toMatchObject({ outcome: "skipped", detail: "email 2 skipped: submitted form 532" });
    expect(state.sendEmail).not.toHaveBeenCalled();
    // Two days on at 9am Pacific: Wednesday 18 November, 17:00 UTC.
    const advance = updates().find((q) => /SET position = \$2, next_send_at = \$3/.test(q.sql));
    expect(advance?.params).toEqual(["77", 3, new Date("2026-11-18T17:00:00Z")]);
    // Matched on the address too, case-insensitively, as requires_offer_id is.
    const formQuery = state.queries.find((q) => /FROM form_submissions/.test(q.sql));
    expect(formQuery?.params).toEqual([[532], 9, "Reader@Example.com"]);
    expect(formQuery?.sql).toMatch(/lower\(email::text\) = lower\(\$3\)/);
  });

  it("skips a downsell for an owner of the offer", async () => {
    state.skipRules = { ownsOfferIds: [20, 39] };
    state.ownsRows = [{ offer_id: 20 }];

    const result = await sendDueEmail(77, now);

    expect(result).toMatchObject({ outcome: "skipped", detail: "email 2 skipped: owns offer 20" });
    expect(state.sendEmail).not.toHaveBeenCalled();
    // Owning the offer is checked first; the form list is empty and not queried.
    expect(state.queries.some((q) => /FROM form_submissions/.test(q.sql))).toBe(false);
  });

  it("finishes the run when the skipped email was the last one", async () => {
    state.skipRules = { submittedFormIds: [532] };
    state.formRows = [{ form_id: 532 }];
    state.nextEmail = null;

    const result = await sendDueEmail(77, now);

    expect(result.outcome).toBe("completed");
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(updates().some((q) => /status = 'completed'/.test(q.sql))).toBe(true);
  });

  it("sends as usual when no rule matches, carrying the preview text", async () => {
    state.skipRules = { ownsOfferIds: [39], submittedFormIds: [532] };
    state.previewText = "Start with the question that makes the next step feel uncertain.";

    const result = await sendDueEmail(77, now);

    expect(result.outcome).toBe("sent");
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
    expect(state.sendEmail.mock.calls[0][0]).toMatchObject({
      preheader: "Start with the question that makes the next step feel uncertain.",
    });
    const advance = updates().find((q) => /SET position = \$2, next_send_at = \$3/.test(q.sql));
    expect(advance?.params).toEqual(["77", 3, new Date("2026-11-18T17:00:00Z")]);
  });

  it("does not query anything extra for an email with no rules", async () => {
    await sendDueEmail(77, now);

    expect(state.sendEmail).toHaveBeenCalledTimes(1);
    expect(state.queries.some((q) => /FROM access_grants|FROM form_submissions|FROM contact_tags/.test(q.sql))).toBe(false);
  });
});
