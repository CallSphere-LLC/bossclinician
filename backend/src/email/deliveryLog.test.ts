import { describe, expect, it, vi, beforeEach } from "vitest";
import { sendMail } from "./mailer";

/**
 * The delivery log exists because "Sent" was the only signal anyone had.
 *
 * Receipts, access emails, dunning and confirmations all went out through
 * `sendMail`, which wrote a console line and nothing else — so SES's delivery
 * and bounce notifications, which arrive keyed on the provider's message id,
 * had no row to attach to and were stored against a null message. "The customer
 * says the receipt never arrived" had no answer.
 *
 * These cases pin the two properties that make it answerable: a row exists for
 * every send with the provider's id on it, and a transport failure is written
 * down rather than only logged — while still never being thrown at a caller
 * that has already taken money.
 */

const query = vi.fn();
vi.mock("../db/pool", () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

const transportSend = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: (...args: unknown[]) => transportSend(...args) }),
  },
}));

// config/env reads process.env at import time and would demand JWT_SECRET and a
// database URL that have nothing to do with this suite. Mocked rather than
// satisfied, which also keeps the SMTP host set so the "sent" branch under test
// is the real one.
vi.mock("../config/env", () => ({
  env: {
    smtp: { host: "email-smtp.us-east-1.amazonaws.com", port: 587, user: "u", pass: "p", from: "Boss <no-reply@example.com>" },
    ses: { transactionalConfigSet: "bc-transactional", marketingConfigSet: "", snsTopicArn: "" },
  },
}));

function sqlOf(call: unknown[]): string {
  return String(call[0]).replace(/\s+/g, " ");
}

beforeEach(() => {
  query.mockReset();
  transportSend.mockReset();
  query.mockResolvedValue({ rows: [{ id: "77" }] });
});

describe("sendMail delivery log", () => {
  it("records the send and stamps the provider's id on success", async () => {
    transportSend.mockResolvedValue({ response: "250 Ok 010001a06d1d2e09abcdef", messageId: "<local@host>" });

    const outcome = await sendMail({
      to: "Success+Buyer@Simulator.AmazonSES.com",
      subject: "Your receipt",
      text: "Thanks",
      topic: "purchase_receipt",
      sourceId: 9,
    });

    expect(outcome.sent).toBe(true);
    expect(outcome.messageId).toBe(77);

    const insert = query.mock.calls.find((c) => sqlOf(c).includes("INSERT INTO email_messages"));
    expect(insert).toBeDefined();
    // Lower-cased, because the suppression list and every later event key on it.
    expect(insert?.[1]).toContain("success+buyer@simulator.amazonses.com");
    expect(insert?.[1]).toContain("purchase_receipt");
    expect(sqlOf(insert!)).toContain("'transactional'");

    const stamp = query.mock.calls.find((c) => sqlOf(c).includes("status = 'sent'"));
    expect(stamp).toBeDefined();
    // The id SES chose, not the Message-ID nodemailer generated locally: every
    // event SES ever posts about this message names the former.
    expect(stamp?.[1]).toContain("010001a06d1d2e09abcdef");
  });

  it("writes a failure down instead of only logging it, and does not throw", async () => {
    transportSend.mockRejectedValue(new Error("535 Authentication Credentials Invalid"));

    const outcome = await sendMail({ to: "success+buyer@simulator.amazonses.com", subject: "Your receipt", text: "Thanks" });

    expect(outcome.sent).toBe(false);
    expect(outcome.error).toContain("535");

    const failed = query.mock.calls.find((c) => sqlOf(c).includes("status = 'failed'"));
    expect(failed).toBeDefined();
    expect(String(failed?.[1]?.[1])).toContain("535");
  });

  it("still sends when the log cannot be written", async () => {
    // Bookkeeping must never cost a receipt. The insert fails, the send runs.
    query.mockRejectedValue(new Error("relation email_messages does not exist"));
    transportSend.mockResolvedValue({ response: "250 Ok 010001a0deadbeefcafe", messageId: "x" });

    const outcome = await sendMail({ to: "success+buyer@simulator.amazonses.com", subject: "Hi", text: "Hi" });

    expect(outcome.sent).toBe(true);
    expect(outcome.messageId).toBeNull();
    expect(transportSend).toHaveBeenCalledOnce();
  });

  it("refuses a message with no recipient without touching the transport", async () => {
    const outcome = await sendMail({ to: "", subject: "Hi", text: "Hi" });

    expect(outcome.sent).toBe(false);
    expect(transportSend).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
