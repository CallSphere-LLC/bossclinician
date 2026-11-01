import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({ env: { publicSiteUrl: "https://www.bossclinician.com" } }));
vi.mock("../db/pool", () => ({ pool: { query: vi.fn() } }));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));

import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { sendCredentialingIntake } from "./credentialingIntake";

const order = {
  id: 42,
  offer_slug: "credential-for-you-package",
  offer_title: "Provider Credentialing Package",
  email: "buyer@example.test",
  billing_name: "Dr. Jane Doe",
  member_id: 7,
  contact_id: 8,
  gift_recipient_email: "",
};

describe("the credentialing intake email", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(pool.query).mockImplementation(async (sql: unknown) => {
      const query = String(sql);
      if (query.includes("FROM forms")) return { rows: [{ "?column?": 1 }] } as never;
      if (query.includes("INSERT INTO credentialing_intake_emails")) return { rows: [{ order_id: 42 }] } as never;
      return { rows: [] } as never;
    });
    vi.mocked(sendMail).mockResolvedValue({ sent: true, messageId: 1, providerMessageId: "test", error: "" });
  });

  it("sends the intake link with her next steps and her refund sentence, and records it", async () => {
    expect(await sendCredentialingIntake(order)).toBe(true);
    const message = vi.mocked(sendMail).mock.calls[0][0];
    expect(message.to).toBe(order.email);
    expect(message.text).toContain("Hi Jane,");
    expect(message.text).toContain("https://www.bossclinician.com/credentialing-intake");
    expect(message.html).toContain('href="https://www.bossclinician.com/credentialing-intake"');
    expect(message.text).toContain("Please watch for an email from: allondra@bossclinician.com");
    expect(message.text).toContain("your service agreement is completed, and all required documents and information have been received.");
    expect(message.text).toContain("All Credential For You purchases are final and non-refundable.");
    expect(message.text).not.toMatch(/14|within .* days/);
    expect(vi.mocked(pool.query).mock.calls.some(([sql]) => String(sql).includes("SET sent_at"))).toBe(true);
  });

  it("does not resend an order already claimed", async () => {
    vi.mocked(pool.query).mockImplementation(async (sql: unknown) =>
      (String(sql).includes("FROM forms") ? { rows: [{ "?column?": 1 }] } : { rows: [] }) as never);
    expect(await sendCredentialingIntake(order)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("releases the claim when the send fails, so a retry can try again", async () => {
    vi.mocked(sendMail).mockResolvedValueOnce({ sent: false, messageId: 1, providerMessageId: "", error: "offline" });
    expect(await sendCredentialingIntake(order)).toBe(false);
    expect(vi.mocked(pool.query).mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM credentialing_intake_emails"))).toBe(true);
  });

  it("ignores every other offer, gifts, and an unpublished form", async () => {
    expect(await sendCredentialingIntake({ ...order, offer_slug: "the-club" })).toBe(false);
    expect(await sendCredentialingIntake({ ...order, offer_slug: null })).toBe(false);
    expect(await sendCredentialingIntake({ ...order, gift_recipient_email: "gift@example.test" })).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    expect(await sendCredentialingIntake(order)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
