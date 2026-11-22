import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  agreementView,
  buildChecklist,
  checklistProgress,
  effectiveStatus,
  guestMayView,
  isOpen,
  mergeSettings,
  normaliseSettings,
  retreatPhase,
  settingsPatchSchema,
  signMediaToken,
  sniffMemoryMime,
  summarisePayments,
  validateFeedback,
  validateFlightPreferences,
  validateTravelInsurance,
  verifyMediaToken,
  type PaymentsSummary,
  type QuestionnaireChecklistInput,
  type TaskKey,
  type TaskRecord,
} from "./retreats";

const INCOMPLETE = summarisePayments([], [], []);

function task(key: TaskKey, patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_key: key,
    guest_status: "none",
    guest_data: {},
    guest_updated_at: null,
    review_status: null,
    review_note: "",
    reviewed_at: null,
    ...patch,
  };
}

function checklist(input: {
  tasks?: TaskRecord[];
  questionnaires?: QuestionnaireChecklistInput[];
  signed?: boolean;
  payments?: PaymentsSummary;
  groupCallConfirmed?: boolean;
  enabled?: { passport: boolean; groupCall: boolean };
}) {
  return buildChecklist({
    agreement: agreementView(input.signed ? [{ id: 1, status: "signed", signed_at: new Date("2026-11-03T18:00:00Z") }] : []),
    tasks: new Map((input.tasks ?? []).map((t) => [t.task_key, t])),
    payments: input.payments ?? INCOMPLETE,
    groupCallConfirmed: input.groupCallConfirmed ?? false,
    questionnaires: input.questionnaires,
    enabled: input.enabled,
  });
}

const statusOf = (items: ReturnType<typeof checklist>, key: string) => items.find((i) => i.key === key)!.status;

const PROFILE: QuestionnaireChecklistInput = { key: "retreat-profile", title: "Retreat Profile", status: "not_started", updatedAt: null, reviewNote: null };

describe("settings", () => {
  it("fills every missing or mistyped value with the safe default", () => {
    const settings = normaliseSettings({ welcomeMessage: 42, shuttle: { confirmed: "yes" }, inclusions: ["A", 3] });
    expect(settings.welcomeMessage).toBe("");
    expect(settings.shuttle.confirmed).toBe(false);
    expect(settings.inclusions).toEqual(["A"]);
    expect(settings.joinUsAgain.mode).toBe("closed");
    expect(settings.gallery.requireReview).toBe(true);
  });

  it("merges a partial patch without dropping sibling values", () => {
    const base = normaliseSettings({ groupCall: { confirmed: false, timezone: "America/Los_Angeles", notes: "x" } });
    const next = mergeSettings(base, { groupCall: { joinUrl: "https://zoom.us/j/1" }, feedback: { labels: { rating: "How was it?" } } });
    expect(next.groupCall.notes).toBe("x");
    expect(next.groupCall.joinUrl).toBe("https://zoom.us/j/1");
    expect(next.feedback.labels.rating).toBe("How was it?");
    expect(next.feedback.labels.improve).toBe(DEFAULT_SETTINGS.feedback.labels.improve);
  });

  it("refuses links that are not https or on this site", () => {
    expect(settingsPatchSchema.safeParse({ guestProfileUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ guestProfileUrl: "http://form.jotform.com/1" }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ guestProfileUrl: "https://form.jotform.com/262158194471057" }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ unknownKey: 1 }).success).toBe(false);
  });
});

describe("dates", () => {
  it("counts down to the start, then reports in progress and ended", () => {
    expect(retreatPhase("2027-06-15", "2027-06-20", "2027-06-01")).toEqual({ phase: "upcoming", daysUntilStart: 14 });
    expect(retreatPhase("2027-06-15", "2027-06-20", "2027-06-15")).toEqual({ phase: "in_progress", daysUntilStart: 0 });
    expect(retreatPhase("2027-06-15", "2027-06-20", "2027-06-21")).toEqual({ phase: "ended", daysUntilStart: null });
  });

  it("opens 'auto' areas on the retreat's last day only", () => {
    expect(isOpen("auto", "2027-06-20", "2027-06-19")).toBe(false);
    expect(isOpen("auto", "2027-06-20", "2027-06-20")).toBe(true);
    expect(isOpen("closed", "2027-06-20", "2027-07-01")).toBe(false);
    expect(isOpen("open", "2027-06-20", "2026-11-22")).toBe(true);
  });
});

describe("checklist statuses come from records, never from a click", () => {
  it("starts every task at Not started (agreement included) for a new guest, with no insurance task", () => {
    const items = checklist({ questionnaires: [PROFILE, { ...PROFILE, key: "flight-details", title: "Flight Details" }] });
    expect(items.map((i) => i.key)).toEqual([
      "agreement", "questionnaire:retreat-profile", "questionnaire:flight-details", "passport", "payments", "group_call",
    ]);
    for (const key of ["agreement", "questionnaire:retreat-profile", "questionnaire:flight-details", "passport", "group_call"]) {
      expect(statusOf(items, key)).toBe("not_started");
    }
    expect(items.find((i) => i.key === "group_call")!.detail).toBe("Details coming soon.");
  });

  it("leaves out the passport and group call when a retreat doesn't use them", () => {
    expect(checklist({ enabled: { passport: false, groupCall: false } }).map((i) => i.key)).toEqual(["agreement", "payments"]);
  });

  it("marks the agreement Verified only from a signed record", () => {
    expect(statusOf(checklist({}), "agreement")).toBe("not_started");
    const pending = agreementView([{ id: 1, status: "pending", signed_at: null }]);
    expect(pending).toEqual({ status: "not_started", signedAt: null, awaitingSignature: true });
    expect(statusOf(checklist({ signed: true }), "agreement")).toBe("verified");
  });

  it("ignores an admin review on the agreement", () => {
    const items = checklist({ tasks: [task("agreement", { review_status: "verified", reviewed_at: new Date() })] });
    expect(statusOf(items, "agreement")).toBe("not_started");
  });

  it("shows a questionnaire's own status and the organizer's note only when it needs attention", () => {
    const items = checklist({ questionnaires: [{ ...PROFILE, status: "needs_attention", reviewNote: "Add your emergency contact" }] });
    expect(items[1]).toMatchObject({ status: "needs_attention", reviewNote: "Add your emergency contact", section: "questionnaire-retreat-profile" });
    const ok = checklist({ questionnaires: [{ ...PROFILE, status: "submitted", reviewNote: "old note" }] });
    expect(ok[1].reviewNote).toBeNull();
  });

  it("records a passport self-report as Submitted at most", () => {
    const items = checklist({ tasks: [task("passport", { guest_status: "submitted", guest_updated_at: new Date() })] });
    expect(statusOf(items, "passport")).toBe("submitted");
  });

  it("keeps the group call Not started until the owner confirms it", () => {
    const rsvp = task("group_call", { guest_status: "submitted", guest_data: { rsvp: "yes" }, guest_updated_at: new Date() });
    expect(statusOf(checklist({ tasks: [rsvp], groupCallConfirmed: false }), "group_call")).toBe("not_started");
    expect(statusOf(checklist({ tasks: [rsvp], groupCallConfirmed: true }), "group_call")).toBe("submitted");
  });

  it("says 'Contact us' for payments without a complete record, and lets the organizer verify", () => {
    const items = checklist({});
    expect(items.find((i) => i.key === "payments")!.detail).toBe("Contact us about your payment schedule.");
    const reviewed = checklist({ tasks: [task("payments", { review_status: "verified", reviewed_at: new Date() })] });
    expect(statusOf(reviewed, "payments")).toBe("verified");
  });

  it("counts Submitted and Verified as progress", () => {
    const items = checklist({ signed: true, tasks: [task("passport", { guest_status: "submitted", guest_updated_at: new Date() })] });
    expect(checklistProgress(items)).toEqual({ completed: 2, total: 4 });
  });

  it("lets a review win only while it is newer than the guest's change", () => {
    const at = new Date("2027-01-02T00:00:00Z");
    expect(effectiveStatus("submitted", new Date("2027-01-01T00:00:00Z"), { status: "verified", at })).toBe("verified");
    expect(effectiveStatus("submitted", new Date("2027-01-03T00:00:00Z"), { status: "verified", at })).toBe("submitted");
    expect(effectiveStatus("in_progress", null, { status: null, at: null })).toBe("in_progress");
  });
});

describe("payments come from real records only", () => {
  const order = {
    id: 10,
    total_cents: 50000,
    refunded_cents: 0,
    currency: "usd",
    pricing_type: "payment_plan",
    balance_due_by: "2027-06-08",
    offer_label: "Private Room",
    enrollment_terms: { paymentArrangement: "6 payments totaling $5,500.00" },
  };

  it("is incomplete without an order on this site (a Kajabi-billed booking)", () => {
    expect(summarisePayments([], [], []).status).toBe("incomplete");
  });

  it("is incomplete for a plan order whose plan record is missing", () => {
    expect(summarisePayments([order], [], []).status).toBe("incomplete");
  });

  it("is incomplete with two orders, or after a refund", () => {
    expect(summarisePayments([order, { ...order, id: 11 }], [], []).status).toBe("incomplete");
    expect(summarisePayments([{ ...order, refunded_cents: 100 }], [], []).status).toBe("incomplete");
  });

  it("adds up a plan's schedule", () => {
    const summary = summarisePayments(
      [order],
      [{ id: 5, order_id: 10, status: "active" }],
      [
        { payment_plan_id: 5, sequence: 1, amount_cents: 50000, due_at: new Date("2026-12-01T00:00:00Z"), paid_at: new Date("2026-12-01T00:00:00Z") },
        { payment_plan_id: 5, sequence: 2, amount_cents: 100000, due_at: new Date("2027-01-01T00:00:00Z"), paid_at: null },
        { payment_plan_id: 5, sequence: 3, amount_cents: 100000, due_at: new Date("2027-02-01T00:00:00Z"), paid_at: null },
      ],
    );
    expect(summary).toMatchObject({
      status: "complete",
      agreedCents: 250000,
      paidCents: 50000,
      balanceCents: 200000,
      nextPayment: { amountCents: 100000, dueDate: "2027-01-01" },
      finalPaymentDue: "2027-06-08",
      arrangement: "6 payments totaling $5,500.00",
      roomLabel: "Private Room",
    });
  });

  it("reports a one-time payment as paid in full", () => {
    const summary = summarisePayments([{ ...order, pricing_type: "one_time", total_cents: 550000, enrollment_terms: null }], [], []);
    expect(summary).toMatchObject({ status: "complete", agreedCents: 550000, paidCents: 550000, balanceCents: 0, arrangement: "Paid in full" });
  });
});

describe("form validation", () => {
  it("saves any partial Flight Preferences draft but requires the key answers to submit", () => {
    expect(validateFlightPreferences({ departureAirport: "LAX" }, false).errors).toEqual({});
    const submit = validateFlightPreferences({ departureAirport: "LAX" }, true);
    expect(Object.keys(submit.errors).sort()).toEqual(["connections", "groupTravel"]);
  });

  it("drops unknown keys (no passport numbers or medical fields can be stored)", () => {
    const { clean } = validateFlightPreferences({ departureAirport: "SFO", passportNumber: "X123", connections: "bogus" }, false);
    expect(clean).toEqual({ departureAirport: "SFO" });
  });

  it("requires the insurance acknowledgement and a coverage status to submit, never a purchase", () => {
    expect(Object.keys(validateTravelInsurance({}, true).errors).sort()).toEqual(["acknowledged", "coverageStatus"]);
    expect(validateTravelInsurance({ acknowledged: true, coverageStatus: "not_purchased" }, true).errors).toEqual({});
  });

  it("keeps testimonial consent separate and defaults it to no", () => {
    const draft = validateFeedback({ answers: { rating: 5, favoriteMoment: "The flower bath" } }, false);
    expect(draft.clean.testimonialConsent).toBe("no");
    expect(validateFeedback({ answers: {} }, true).errors.rating).toBeDefined();
    const consentWithoutWords = validateFeedback({ answers: { rating: 4 }, testimonialConsent: "full_name" }, true);
    expect(consentWithoutWords.errors.testimonialText).toBeDefined();
    const roleMissing = validateFeedback({ answers: { rating: 4 }, testimonialConsent: "first_name_role", testimonialText: "Lovely" }, true);
    expect(roleMissing.errors.testimonialRole).toBeDefined();
  });
});

describe("gallery media", () => {
  it("signs links that name one item and one viewer, and refuses tampering and expiry", () => {
    const now = new Date("2027-06-21T00:00:00Z");
    const token = signMediaToken({ audience: "m", principalId: 7, mediaId: 42 }, now);
    expect(verifyMediaToken(token, now)).toMatchObject({ audience: "m", principalId: 7, mediaId: 42 });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(Buffer.from(body, "base64url").toString().replace(".7.", ".8."), "utf8").toString("base64url");
    expect(verifyMediaToken(`${forged}.${sig}`, now)).toBeNull();
    expect(verifyMediaToken(token, new Date(now.getTime() + 3 * 60 * 60 * 1000))).toBeNull();
    expect(verifyMediaToken("garbage", now)).toBeNull();
  });

  it("shows a guest approved items and only her own pending uploads", () => {
    expect(guestMayView({ status: "approved", member_id: 2 }, 1)).toBe(true);
    expect(guestMayView({ status: "pending", member_id: 1 }, 1)).toBe(true);
    expect(guestMayView({ status: "pending", member_id: 2 }, 1)).toBe(false);
    expect(guestMayView({ status: "hidden", member_id: 1 }, 1)).toBe(false);
    expect(guestMayView({ status: "removed", member_id: 1 }, 1)).toBe(false);
  });

  it("identifies files by their bytes and refuses anything else", () => {
    expect(sniffMemoryMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffMemoryMime(Buffer.from("....ftypisom....", "latin1"))?.mime).toBe("video/mp4");
    expect(sniffMemoryMime(Buffer.from("....ftypqt  ....", "latin1"))?.mime).toBe("video/quicktime");
    expect(sniffMemoryMime(Buffer.from("....ftypheic....", "latin1"))).toBeNull();
    expect(sniffMemoryMime(Buffer.from("<svg onload=alert(1)>", "latin1"))).toBeNull();
    expect(sniffMemoryMime(Buffer.from("<html>", "latin1"))).toBeNull();
  });
});
