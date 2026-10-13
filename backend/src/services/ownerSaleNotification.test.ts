import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripeTestMode } from "../config/env";
import { sendMail } from "../email/mailer";
import { notificationRecipients } from "./notificationRecipients";
import { readSetting } from "./settings";
import {
  parseRecipientList,
  planDescription,
  saleRecipients,
  sendOwnerSaleNotification,
} from "./ownerSaleNotification";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../config/env", () => ({
  env: { publicSiteUrl: "https://example.test", adminOrigin: "https://admin.example.test", notifyEmail: "" },
  stripeTestMode: vi.fn(),
}));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("./settings", () => ({ readSetting: vi.fn() }));
vi.mock("./notificationRecipients", () => ({ notificationRecipients: vi.fn() }));

const ORDER = {
  id: 901,
  email: "zz-buyer@example.test",
  billing_name: "ZZ Buyer",
  total_cents: 4700,
  currency: "usd",
  coupon_code: "ZZHALF",
  gift_recipient_email: null,
  offer_id: 12,
  course_title: null,
  pricing_option_id: null,
};

const OFFER = {
  id: 12,
  title: "ZZ Toolkit",
  pricing_type: "payment_plan",
  amount_cents: 4700,
  interval: "month",
  interval_count: 1,
  installment_count: 3,
  trial_days: 0,
  notify_owner_on_sale: true,
  notify_owner_recipients: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(stripeTestMode).mockReturnValue(false);
  vi.mocked(readSetting).mockResolvedValue({ onSale: true });
  vi.mocked(notificationRecipients).mockResolvedValue("owner@example.test");
  vi.mocked(sendMail).mockResolvedValue({ messageId: 1, sent: true, providerMessageId: "x", error: "" });
});

describe("parseRecipientList", () => {
  it("splits on commas, semicolons and whitespace, drops junk and duplicates", () => {
    expect(parseRecipientList("A@x.test, b@x.test;\nnot-an-email a@x.test")).toEqual(["a@x.test", "b@x.test"]);
  });
});

describe("saleRecipients", () => {
  it("uses the site-wide address unless the offer names its own", async () => {
    expect(await saleRecipients([OFFER])).toEqual(["owner@example.test"]);
    expect(await saleRecipients([{ ...OFFER, notify_owner_recipients: "va@example.test" }])).toEqual(["va@example.test"]);
  });

  it("sends nothing for an offer switched off, or when the site-wide switch is off", async () => {
    expect(await saleRecipients([{ ...OFFER, notify_owner_on_sale: false }])).toEqual([]);
    vi.mocked(readSetting).mockResolvedValue({ onSale: false });
    expect(await saleRecipients([{ ...OFFER, notify_owner_recipients: "va@example.test" }])).toEqual([]);
  });

  it("merges a cart's offers into one list", async () => {
    expect(
      await saleRecipients([
        OFFER,
        { ...OFFER, id: 13, notify_owner_recipients: "va@example.test" },
        { ...OFFER, id: 14, notify_owner_on_sale: false, notify_owner_recipients: "nobody@example.test" },
      ]),
    ).toEqual(["owner@example.test", "va@example.test"]);
  });
});

describe("planDescription", () => {
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  it("describes plans and subscriptions", () => {
    expect(planDescription(OFFER, fmt)).toBe("Payment plan: 3 payments of $47.00 every month");
    expect(planDescription({ ...OFFER, pricing_type: "subscription", interval_count: 3, trial_days: 7 }, fmt)).toBe(
      "Subscription: $47.00 every 3 months (7-day free trial)",
    );
    expect(planDescription({ ...OFFER, pricing_type: "one_time" }, fmt)).toBe("One-time payment");
  });
});

describe("sendOwnerSaleNotification", () => {
  it("claims the order once and emails the offer, buyer, amount, plan, coupon and admin link", async () => {
    query.mockResolvedValueOnce({ rows: [ORDER] }).mockResolvedValueOnce({ rows: [OFFER] });

    const result = await sendOwnerSaleNotification(901);

    expect(result).toEqual({ sent: true, to: ["owner@example.test"] });
    expect(query.mock.calls[0][0]).toContain("owner_notified_at IS NULL");
    const mail = vi.mocked(sendMail).mock.calls[0][0];
    expect(mail.to).toBe("owner@example.test");
    expect(mail.subject).toContain("ZZ Toolkit");
    expect(mail.text).toContain("ZZ Buyer <zz-buyer@example.test>");
    expect(mail.text).toContain("Payment plan: 3 payments of");
    expect(mail.text).toContain("Coupon: ZZHALF");
    expect(mail.text).toContain("https://admin.example.test/admin/purchases/order-901");
  });

  it("does nothing on a redelivery that finds the order already announced", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await sendOwnerSaleNotification(901)).skipped).toBe("already notified");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("stays silent in sandbox without claiming the order", async () => {
    vi.mocked(stripeTestMode).mockReturnValue(true);
    expect((await sendOwnerSaleNotification(901)).skipped).toBe("sandbox");
    expect(query).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
