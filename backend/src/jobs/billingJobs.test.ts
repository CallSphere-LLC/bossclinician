import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, sendMail, readSetting } = vi.hoisted(() => ({
  query: vi.fn(),
  sendMail: vi.fn(),
  readSetting: vi.fn(),
}));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../email/mailer", () => ({ sendMail }));
vi.mock("../email/templateStore", () => ({
  withStoredTemplate: async (_key: string, _vars: unknown, fallback: unknown) => fallback,
}));
vi.mock("../email/templates", () => ({ escapeHtml: (value: string) => value }));
vi.mock("../config/env", () => ({ env: { publicSiteUrl: "https://example.test" } }));
vi.mock("../services/settings", () => ({ readSetting }));
vi.mock("../services/dunning", () => ({ sweepDunning: vi.fn() }));
vi.mock("./worker", () => ({ registerHandler: vi.fn() }));

import { sweepBillingReminders } from "./billingJobs";

const DUE = new Date("2026-09-14T12:00:00Z");

function row(id: number, email: string) {
  return { id, email, name: "ZZ Test Member", plan_name: "ZZ Membership", amount_cents: 4700, currency: "usd", due_at: DUE };
}

let candidates: { trial: unknown[]; upcoming: unknown[]; instalments: unknown[] };

beforeEach(() => {
  candidates = { trial: [], upcoming: [], instalments: [] };
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("s.status = 'trialing'")) return { rows: candidates.trial };
    if (sql.includes("s.status = 'active'")) return { rows: candidates.upcoming };
    if (sql.includes("FROM payment_plan_installments i")) return { rows: candidates.instalments };
    if (sql.startsWith("UPDATE")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  sendMail.mockReset();
  sendMail.mockResolvedValue({ sent: true });
  readSetting.mockReset();
});

const selects = () => query.mock.calls.filter(([sql]) => String(sql).includes("SELECT"));

describe("billing reminders", () => {
  it("sends nothing, and reads nothing, when both switches are off", async () => {
    readSetting.mockResolvedValue({
      sendTrialReminders: false,
      trialReminderDays: 3,
      sendUpcomingPaymentReminders: false,
      upcomingPaymentReminderDays: 3,
    });
    await expect(sweepBillingReminders()).resolves.toEqual({ trial: 0, upcoming: 0, instalments: 0 });
    expect(selects()).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends the trial-ending reminder on the owner's number of days", async () => {
    readSetting.mockResolvedValue({
      sendTrialReminders: true,
      trialReminderDays: 5,
      sendUpcomingPaymentReminders: false,
    });
    candidates.trial = [row(7, "sagar+zzd2trial@callsphere.ai")];

    await expect(sweepBillingReminders()).resolves.toMatchObject({ trial: 1, upcoming: 0 });

    const trialSelect = selects().find(([sql]) => String(sql).includes("trialing"));
    expect(trialSelect?.[1]).toEqual([5]);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "trial_ending",
        to: "sagar+zzd2trial@callsphere.ai",
        subject: "Your free trial ends September 14, 2026",
      })
    );
  });

  it("reminds about membership renewals and payment-plan instalments", async () => {
    readSetting.mockResolvedValue({
      sendTrialReminders: false,
      sendUpcomingPaymentReminders: true,
      upcomingPaymentReminderDays: 2,
    });
    candidates.upcoming = [row(8, "sagar+zzd2renew@callsphere.ai")];
    candidates.instalments = [row(9, "sagar+zzd2plan@callsphere.ai")];

    await expect(sweepBillingReminders()).resolves.toEqual({ trial: 0, upcoming: 1, instalments: 1 });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls.map(([input]) => input.subject)).toEqual([
      "Your $47.00 payment is coming up",
      "Your $47.00 payment is coming up",
    ]);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("UPDATE payment_plan_installments SET reminder_sent_at = now()"))
    ).toBe(true);
  });

  it("treats 0 days as off even with the switch on", async () => {
    readSetting.mockResolvedValue({
      sendTrialReminders: true,
      trialReminderDays: 0,
      sendUpcomingPaymentReminders: true,
      upcomingPaymentReminderDays: 0,
    });
    await sweepBillingReminders();
    expect(selects()).toHaveLength(0);
  });

  it("releases the claim when the send throws, so the next sweep tries again", async () => {
    readSetting.mockResolvedValue({ sendTrialReminders: true, trialReminderDays: 3, sendUpcomingPaymentReminders: false });
    candidates.trial = [row(7, "sagar+zzd2trial@callsphere.ai")];
    sendMail.mockRejectedValueOnce(new Error("SES down"));

    await expect(sweepBillingReminders()).rejects.toThrow("SES down");
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("SET trial_reminder_sent_at = NULL"))
    ).toBe(true);
  });
});
